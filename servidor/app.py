import subprocess
import base64
import json
import xml.etree.ElementTree as ET
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
import os
from threading import Thread
import secrets
import time
from datetime import datetime
import logging
from logging.handlers import RotatingFileHandler
from dotenv import load_dotenv

# Carrega variáveis do arquivo .env
load_dotenv()

# ==================== CONFIGURAÇÃO DE LOG ====================
log_formatter = logging.Formatter('%(asctime)s - %(levelname)s - %(message)s')
log_handler = RotatingFileHandler('reset_senha.log', maxBytes=10485760, backupCount=5)
log_handler.setFormatter(log_formatter)
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)
logger.addHandler(log_handler)

# Também mostra no console
console_handler = logging.StreamHandler()
console_handler.setFormatter(log_formatter)
logger.addHandler(console_handler)

app = Flask(__name__)
CORS(app)

# ==================== CONFIGURAÇÕES DO AMBIENTE ====================
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ENV = os.getenv('ENV', 'development')
SECRET_KEY = os.getenv('SECRET_KEY', secrets.token_hex(32))
app.config['SECRET_KEY'] = SECRET_KEY

# ==================== CONFIGURAÇÕES DO DOMÍNIO ====================
AD_SERVER = os.getenv('AD_SERVER', 'svradhrn1')
DOMAIN = os.getenv('DOMAIN', 'hrn')
AD_USER = os.getenv('AD_USER', 'testenti')
AD_PASS = os.getenv('AD_PASS')  # Obrigatório!

# Valida se a senha do AD foi configurada
if not AD_PASS:
    logger.error("AD_PASS não configurada no arquivo .env!")
    raise ValueError("AD_PASS environment variable is required")

# ==================== CONFIGURAÇÕES DE TOKEN ====================
TOKEN_EXPIRY_SECONDS = int(os.getenv('TOKEN_EXPIRY_SECONDS', 240))
MAX_TOKEN_ATTEMPTS = int(os.getenv('MAX_TOKEN_ATTEMPTS', 3))
BASE_URL = os.getenv('BASE_URL', 'https://bot-nti.resetsenhaglpi.qzz.io')
GLPI_URL = os.getenv('GLPI_URL', 'https://sistemasnti.isgh.org.br/glpi/')

# ==================== ARMAZENAMENTO ====================
# Armazenamento de tokens (em produção use Redis)
tokens = {}  # formato: {token: {'login': login, 'nome': nome, 'expira': timestamp, 'usado': False}}

# ==================== FUNÇÕES ====================
def remover_token_expirado(token):
    """Remove token após expirar"""
    time.sleep(TOKEN_EXPIRY_SECONDS)
    if token in tokens:
        if tokens[token].get('usado', False) or time.time() > tokens[token]['expira']:
            del tokens[token]
            logger.info(f"Token removido (expirado): {token[:8]}...")

def gerar_token(login, nome):
    """Gera token único e agenda expiração"""
    token = secrets.token_hex(32)
    expira = time.time() + TOKEN_EXPIRY_SECONDS
    
    tokens[token] = {
        'login': login,
        'nome': nome,
        'expira': expira,
        'usado': False,
        'tentativas': 0
    }
    
    Thread(target=remover_token_expirado, args=(token,), daemon=True).start()
    
    logger.info(f"Token gerado para usuário: {login} | Expira em: {datetime.fromtimestamp(expira).strftime('%H:%M:%S')}")
    return token

def validar_token(token, marcar_como_usado=True):
    """
    Valida se token existe, não expirou e não foi usado.
    Retorna: (token_data, erro)
    """
    if token not in tokens:
        return None, "Token inválido ou não encontrado"
    
    token_data = tokens[token]
    
    # Verifica se já foi usado
    if token_data.get('usado', False):
        return None, "Este link já foi utilizado e não pode ser reutilizado"
    
    # Verifica se expirou
    if time.time() > token_data['expira']:
        del tokens[token]
        return None, f"Link expirado (o prazo de {TOKEN_EXPIRY_SECONDS//60} minutos foi ultrapassado)"
    
    # 🔥 COMENTAR A VERIFICAÇÃO DE TENTATIVAS
    # if token_data.get('tentativas', 0) >= MAX_TOKEN_ATTEMPTS:
    #     del tokens[token]
    #     return None, "Muitas tentativas. Solicite um novo link."
    
    # Incrementa tentativas (apenas para log, não bloqueia)
    token_data['tentativas'] = token_data.get('tentativas', 0) + 1
    logger.info(f"Token {token[:8]}... - Tentativa #{token_data['tentativas']} (limite ignorado)")
    
    if marcar_como_usado:
        token_data['usado'] = True
    
    return token_data, None

def encode_ps_command(command):
    """Codifica comando PowerShell em base64"""
    encoded = base64.b64encode(command.encode('utf-16le')).decode('ascii')
    return encoded

def limpar_stream_clixml(bruto):
    """Extrai só as mensagens de erro/aviso reais de uma saída CLIXML do
    PowerShell, descartando o stream de "progress" (barra de progresso do
    Invoke-Command) que aparece em TODA execução via -EncodedCommand, mesmo
    quando o comando é bem-sucedido - sem isso, `stderr` nunca vem vazio e o
    código que escolhe a mensagem de erro (`stderr or stdout`) nunca chega a
    olhar o stdout, que é onde ferramentas externas como net.exe realmente
    escrevem o motivo do erro (ex: "Access is denied").
    """
    if not bruto or '<Objs' not in bruto:
        return (bruto or '').strip()

    ns = {'ps': 'http://schemas.microsoft.com/powershell/2004/04'}
    try:
        root = ET.fromstring(bruto[bruto.index('<Objs'):])
    except ET.ParseError:
        return bruto.strip()

    mensagens = []
    for obj in root.findall('ps:Obj', ns):
        stream = (obj.get('S') or '').lower()
        if stream in ('progress', 'verbose', 'debug', 'information'):
            continue
        to_string = obj.find('ps:ToString', ns)
        texto = (to_string.text or '').strip() if to_string is not None else ''
        if not texto:
            texto = ' '.join(t.strip() for t in obj.itertext() if t.strip())
        if texto:
            mensagens.append(texto)

    return '\n'.join(mensagens)

def run_powershell_with_creds(script_block, arg_list=None, timeout=60):
    """Executa um script PowerShell com credenciais de domínio.

    `script_block` deve começar com um `param(...)` e usar somente essas
    variáveis - nunca interpolar valores vindos do usuário (login, senha etc.)
    diretamente no texto do script, para não abrir brecha de injeção de
    comando. Valores de entrada devem ser passados em `arg_list`, que é
    serializado e entregue via -ArgumentList do Invoke-Command.
    """
    arg_list = arg_list or []

    # Escapa aspas simples (delimitador de string do PowerShell) para o caso
    # de a senha de serviço do AD conter uma.
    ad_pass_escaped = AD_PASS.replace("'", "''")

    # Os argumentos do usuário trafegam como JSON codificado em base64 e só
    # viram valores PowerShell via ConvertFrom-Json - nunca são colados como
    # texto de script, então aspas/`;`/backticks neles não têm efeito algum.
    args_b64 = base64.b64encode(json.dumps(arg_list).encode('utf-8')).decode('ascii')

    ps_command = f'''
    $securePass = ConvertTo-SecureString '{ad_pass_escaped}' -AsPlainText -Force
    $cred = New-Object System.Management.Automation.PSCredential('{DOMAIN}\\{AD_USER}', $securePass)
    $parsedArgs = ConvertFrom-Json ([System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('{args_b64}')))
    $remoteArgs = @($parsedArgs)
    Invoke-Command -ComputerName {AD_SERVER} -Credential $cred -ScriptBlock {{ {script_block} }} -ArgumentList $remoteArgs
    '''

    encoded_cmd = encode_ps_command(ps_command)
    
    try:
        result = subprocess.run(
            ['powershell.exe', '-NoProfile', '-EncodedCommand', encoded_cmd],
            capture_output=True,
            text=True,
            timeout=timeout,
            encoding='utf-8',
            errors='ignore'
        )
        
        # Filtra saída do CLIXML
        stdout = result.stdout
        if '<Objs' in stdout or 'progress' in stdout:
            lines = []
            for line in stdout.split('\n'):
                if line and not line.startswith('<') and 'progress' not in line and 'CLIXML' not in line:
                    lines.append(line)
            stdout = '\n'.join(lines)
        
        return {
            'success': result.returncode == 0,
            'stdout': stdout.strip(),
            'stderr': limpar_stream_clixml(result.stderr),
            'returncode': result.returncode
        }
    except subprocess.TimeoutExpired:
        logger.error(f"Timeout ao executar comando PowerShell")
        return {'success': False, 'stderr': 'Timeout na execução', 'stdout': '', 'returncode': -1}
    except Exception as e:
        logger.error(f"Erro ao executar PowerShell: {str(e)}")
        return {'success': False, 'stderr': str(e), 'stdout': '', 'returncode': -1}

# ==================== ROTAS ====================
@app.route('/')
def index():
    return send_file(os.path.join(BASE_DIR, 'resetar_senha.html'))

@app.route('/resetar_senha.html')
def resetar_senha():
    token = request.args.get('token')
    
    if not token:
        return "Link inválido - Token não fornecido", 400
    
    # Valida o token (NÃO marcar como usado aqui - só para exibir a página)
    token_data, erro = validar_token(token, marcar_como_usado=False)
    
    if erro:
        return f"""
        <!DOCTYPE html>
        <html>
        <head><title>Link Inválido</title></head>
        <body style="font-family: Arial; text-align: center; padding: 50px;">
            <h1>{erro}</h1>
            <p>Por favor, solicite um novo link de recuperação de senha.</p>
            <button onclick="window.location.href='{GLPI_URL}'" 
                    style="margin-top: 20px; padding: 10px 20px; background: #667eea; color: white; border: none; border-radius: 5px; cursor: pointer;">
                Ir para o GLPI
            </button>
        </body>
        </html>
        """, 400 if "expirado" in erro else 403
    
    # Token válido, carrega a página
    with open(os.path.join(BASE_DIR, 'resetar_senha.html'), 'r', encoding='utf-8') as f:
        html_content = f.read()
    
    # Insere o token e dados do usuário no HTML
    html_content = html_content.replace(
        '<!-- TOKEN_PLACEHOLDER -->',
        f'<script>window.INITIAL_TOKEN = "{token}"; window.USER_NAME = "{token_data["nome"]}";</script>'
    )
    
    return html_content

@app.route('/api/gerar-token', methods=['POST'])
def gerar_token_api():
    """Gera um token temporário para reset de senha (chamado pelo WhatsApp bot)"""
    dados = request.json
    login = dados.get('login')
    nome = dados.get('nome')
    
    if not login:
        return jsonify({"success": False, "error": "Login não fornecido"}), 400
    
    if not nome:
        return jsonify({"success": False, "error": "Nome não fornecido"}), 400
    
    token = gerar_token(login, nome)
    link = f"{BASE_URL}/resetar_senha.html?token={token}"
    
    return jsonify({
        "success": True,
        "link": link,
        "expira_em_segundos": TOKEN_EXPIRY_SECONDS
    })

@app.route('/api/validar-token', methods=['POST'])
def validar_token_api():
    """Valida o token e retorna os dados do usuário (sem consumir o token)"""
    dados = request.json
    token = dados.get('token')
    
    if not token:
        return jsonify({"success": False, "error": "Token não fornecido"}), 400
    
    token_data, erro = validar_token(token, marcar_como_usado=False)
    
    if erro:
        return jsonify({"success": False, "error": erro}), 403 if "expirado" in erro else 404
    
    return jsonify({
        "success": True,
        "login": token_data['login'],
        "nome": token_data['nome']
    })

@app.route('/api/resetar-senha', methods=['POST', 'OPTIONS'])
def resetar_senha_api():
    if request.method == 'OPTIONS':
        return '', 200
    
    # Suporta JSON e Form Data
    if request.is_json:
        dados = request.json
        token = dados.get('token')
        nova_senha = dados.get('novaSenha') or dados.get('nova_senha')
    else:
        token = request.form.get('token')
        nova_senha = request.form.get('novaSenha') or request.form.get('nova_senha')
    
    # VALIDA O TOKEN PRIMEIRO
    if not token:
        logger.warning("Tentativa de reset sem token")
        return jsonify({"success": False, "error": "Token não fornecido. Link inválido."}), 400
    
    token_data, erro_validacao = validar_token(token, marcar_como_usado=True)
    
    if erro_validacao:
        logger.warning(f"Token inválido usado: {erro_validacao}")
        return jsonify({"success": False, "error": erro_validacao}), 403 if "expirado" in erro_validacao else 400
    
    # Token válido - extrai os dados
    login = token_data['login']
    nome = token_data['nome']
    
    logger.info("=" * 60)
    logger.info(f"SOLICITAÇÃO DE RESET DE SENHA (VIA TOKEN)")
    logger.info(f"Token: {token[:8]}...")
    logger.info(f"Usuário: {login} ({nome})")
    logger.info("=" * 60)
    
    if not nova_senha or nova_senha == 'None' or len(nova_senha) < 6:
        logger.warning(f"Senha inválida ou muito curta para usuário: {login}")
        return jsonify({"success": False, "error": "Senha não fornecida ou inválida"}), 400
    
    # Comando para resetar senha - NÃO LOGAR A SENHA!
    # login e nova_senha chegam como dados via -ArgumentList (nunca colados no
    # texto do script), então caracteres como aspas ou ";" neles não quebram
    # o comando nem executam código extra no servidor do AD.
    comando = 'param($login, $novaSenha) net user "$login" "$novaSenha" /domain ; net user "$login" /passwordchg:yes /domain ; net user "$login" /active:yes /domain'

    logger.info(f"Executando reset de senha para usuário: {login} (tamanho da senha: {len(nova_senha)} caracteres)")

    resultado = run_powershell_with_creds(comando, arg_list=[login, nova_senha], timeout=45)
    
    # Verifica se foi bem sucedido
    stdout = resultado['stdout'].lower()
    stderr = resultado['stderr'].lower()
    
    if resultado['success'] and not ('error' in stdout or 'not found' in stdout or 'acesso negado' in stdout):
        logger.info(f"Senha resetada com sucesso para: {login}")
        
        # Remove token imediatamente
        if token in tokens:
            del tokens[token]
            logger.info(f"Token removido após uso bem-sucedido")
        
        return jsonify({
            "success": True,
            "message": f"Senha resetada com sucesso para {nome}!"
        })
    else:
        # Extrai mensagem de erro
        erro = resultado['stderr'] or resultado['stdout'] or resultado.get('error', 'Erro desconhecido')
        
        # Trata erros comuns
        if 'acesso negado' in erro or 'access denied' in erro:
            erro = f"Permissão negada. A conta {DOMAIN}\\{AD_USER} não tem direito de resetar senhas."
        elif 'not found' in erro or 'não encontrado' in erro:
            erro = f"Usuário {login} não encontrado no domínio."
        elif 'password does not meet' in erro or 'complexidade' in erro:
            erro = f"A senha não atende aos requisitos de complexidade do domínio."
        
        logger.error(f"Erro ao resetar senha para {login}: {erro[:100]}")
        
        return jsonify({
            "success": False,
            "error": erro[:500]
        }), 500

@app.route('/health')
def health_check():
    """Endpoint para health check"""
    return jsonify({
        'status': 'healthy',
        'environment': ENV,
        'timestamp': datetime.now().isoformat()
    })

# ==================== MAIN ====================
if __name__ == '__main__':
    logger.info("=" * 60)
    logger.info(f"[OK] Servidor rodando em producao com Waitress")
    logger.info(f"[INFO] Ambiente: {ENV}")
    logger.info(f"[INFO] Dominio: {DOMAIN}")
    logger.info(f"[INFO] Usuario AD: {AD_USER}")
    logger.info(f"[INFO] URL base: {BASE_URL}")
    logger.info(f"[INFO] Expiracao do token: {TOKEN_EXPIRY_SECONDS} segundos")
    logger.info("=" * 60)
    logger.info("[OK] Aguardando Waitress iniciar...")
    
    # Se for desenvolvimento, usa o servidor embutido
    if ENV == 'development':
        logger.warning("Rodando em modo de desenvolvimento!")
        app.run(host='0.0.0.0', port=int(os.getenv('PORT', 5000)), debug=True)
    else:
        # Em produção, o run.py vai chamar o Waitress
        logger.info("Aguardando Waitress iniciar...")