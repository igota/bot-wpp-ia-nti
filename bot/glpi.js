// glpi.js - Módulo para integração com GLPI/AD

const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const exec = promisify(require('child_process').exec);

// 🔥 VARIÁVEIS QUE SERÃO CARREGADAS DO .env
let AD_SERVER = null;
let DOMAIN = null;
let AD_ADMIN_USER = null;
let AD_ADMIN_PASS = null;
let EMAIL_FROM = null;

// Variável global para cargos (será preenchida)
let LISTA_CARGOS = [];

// Configuração de email (será injetada pelo bot.js)
let transporter = null;
let config = null;

// 🔥 NOVA FUNÇÃO setTransporter ATUALIZADA
function setTransporter(mailTransporter, appConfig) {
    transporter = mailTransporter;
    config = appConfig;
    
    console.log('🔍 GLPI: Recebendo configurações...');

    // Exige as configurações do .env - sem fallback com credenciais hardcoded.
    if (!config?.glpi?.password) {
        throw new Error('GLPI: credenciais do AD não configuradas - defina GLPI_AD_SERVER, GLPI_AD_DOMAIN, GLPI_AD_USER e GLPI_AD_PASS no .env');
    }

    AD_SERVER = config.glpi.adServer;
    DOMAIN = config.glpi.adDomain;
    AD_ADMIN_USER = config.glpi.username;
    AD_ADMIN_PASS = config.glpi.password;
    EMAIL_FROM = config.email?.user || 'no-reply@localhost';

    console.log('✅ GLPI: Configurações carregadas do .env');
    console.log(`   AD_SERVER: ${AD_SERVER}`);
    console.log(`   DOMAIN: ${DOMAIN}`);
    console.log(`   AD_USER: ${AD_ADMIN_USER}`);
    console.log(`   Email From: ${EMAIL_FROM}`);
}

// Carrega a lista de cargos do arquivo JSON
try {
    const cargosPath = path.join(__dirname, 'json','cargos.json');
    if (fs.existsSync(cargosPath)) {
        const cargosData = fs.readFileSync(cargosPath, 'utf8');
        LISTA_CARGOS = JSON.parse(cargosData);
        console.log(`✅ ${LISTA_CARGOS.length} cargos carregados com sucesso!`);
    } else {
        console.warn('⚠️ cargos.json não encontrado, usando lista padrão');
        LISTA_CARGOS = [
            "TECNICO EM INFORMATICA", 
            "ANALISTA DE SISTEMAS", 
            "SUPORTE TECNICO",
            "ADMINISTRADOR DE REDES", 
            "DESENVOLVEDOR", 
            "COORDENADOR DE TI"
        ];
    }
} catch (error) {
    console.error('❌ Erro ao carregar cargos.json:', error);
    LISTA_CARGOS = [
        "TECNICO EM INFORMATICA", 
        "ANALISTA DE SISTEMAS", 
        "SUPORTE TECNICO",
        "ADMINISTRADOR DE REDES", 
        "DESENVOLVEDOR", 
        "COORDENADOR DE TI"
    ];
}

// Função auxiliar para executar PowerShell
async function execPromise(command, options) {
    try {
        const { stdout, stderr } = await exec(command, options);
        return { stdout, stderr };
    } catch (error) {
        throw error;
    }
}

// Função auxiliar para codificar PowerShell em base64
function encodePSCommand(command) {
    const utf16le = Buffer.from(command, 'utf16le');
    return utf16le.toString('base64');
}

// Função para executar comando PowerShell com credenciais
async function runWithCredentials(scriptBlock, timeout = 30000) {
    // 🔥 VERIFICA SE AS CONFIGURAÇÕES FORAM CARREGADAS
    if (!AD_SERVER || !DOMAIN || !AD_ADMIN_USER || !AD_ADMIN_PASS) {
        console.error('❌ GLPI: Configurações não carregadas. Verifique o .env');
        throw new Error('Configurações do AD não carregadas');
    }
    
    // 🔥 IMPORTANTE: NÃO usar [Console]::OutputEncoding aqui.
    // Essa propriedade exige um console interativo (handle de console válido).
    // Em execução via -EncodedCommand / Invoke-Command remoto não existe esse
    // handle, e a atribuição lança "Exception setting OutputEncoding: The
    // handle is invalid", o que interrompe o ScriptBlock antes do dsquery rodar.
    // $OutputEncoding (variável de preferência do PowerShell) e chcp 65001
    // não dependem de console interativo e são suficientes para corrigir
    // o encoding de saída do dsquery.
    const psScript = `
        $OutputEncoding = [System.Text.Encoding]::UTF8
        $securePass = ConvertTo-SecureString '${AD_ADMIN_PASS}' -AsPlainText -Force
        $cred = New-Object System.Management.Automation.PSCredential('${DOMAIN}\\${AD_ADMIN_USER}', $securePass)
        Invoke-Command -ComputerName ${AD_SERVER} -Credential $cred -ScriptBlock {
            $OutputEncoding = [System.Text.Encoding]::UTF8
            chcp 65001 | Out-Null
            ${scriptBlock}
        }
    `;
    
    const encoded = encodePSCommand(psScript);
    
    try {
        // 🔥 encoding 'utf8' garante que o Node decodifique o stdout corretamente
        // em vez de usar a codepage padrão do sistema (que corrompia acentos)
        const { stdout, stderr } = await execPromise(`powershell -EncodedCommand "${encoded}"`, {
            timeout: timeout,
            maxBuffer: 1024 * 1024 * 10,
            shell: 'powershell.exe',
            encoding: 'utf8'
        });
        
        if (stderr && !stderr.includes('Warning') && stderr.trim()) {
            console.log(`⚠️ Stderr: ${stderr}`);
        }
        
        return stdout;
    } catch (error) {
        console.log(`❌ Erro na execução remota: ${error.message}`);
        throw error;
    }
}

// Função para enviar código por email
async function enviarCodigoEmail(email, codigo, nome) {
    if (!transporter) {
        console.error('❌ Transporter não configurado');
        return false;
    }
    
    console.log(`📧 Tentando enviar email para: ${email}`);
    
    // 🔥 USA O EMAIL_FROM DAS CONFIGURAÇÕES
    const fromEmail = EMAIL_FROM || config?.email?.user || 'cleanleito@gmail.com';
    
    const mailOptions = {
        from: `"Suporte TI - Reset de Senha" <${fromEmail}>`,
        to: email,
        subject: '🔐 Código de Verificação - Reset de Senha GLPI',
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #667eea;">🔐 Código de Verificação</h2>
                <p>Olá <strong>${nome}</strong>,</p>
                <p>Recebemos uma solicitação para resetar sua senha no sistema <strong>GLPI</strong>.</p>
                <p>Utilize o código abaixo para confirmar a operação:</p>
                <div style="background-color: #f0f4ff; padding: 20px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 5px; border-radius: 10px; margin: 20px 0;">
                    ${codigo}
                </div>
                <p>Este código é válido por <strong>10 minutos</strong>.</p>
                <p>Se você não solicitou esta alteração, ignore este e-mail.</p>
                <hr style="margin: 20px 0;">
                <p style="color: #888; font-size: 12px;">⚠️ Mantenha este código em segurança. Não compartilhe com ninguém.</p>
            </div>
        `
    };

    try {
        const info = await transporter.sendMail(mailOptions);
        console.log(`✅ Email enviado com sucesso para ${email}`);
        return true;
    } catch (error) {
        console.error(`❌ Erro ao enviar email: ${error.message}`);
        return false;
    }
}

// Funções de normalização e busca
function normalizar(texto) {
    if (!texto) return '';
    return texto
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        // 🔥 HISTÓRICO: '.replace(/�/g, 'a')' substituía QUALQUER caractere
        // corrompido (í, é, ç, ã, etc.) sempre por 'a', distorcendo o nome.
        // Tentamos depois apenas REMOVER o caractere, mas isso desalinhava
        // o tamanho da palavra e quebrava a comparação posicional (ex:
        // "leticia" vs "letcia" não batem mais por prefixo/tamanho).
        // AGORA: marcamos a posição corrompida com '?' (wildcard), que
        // palavrasParecidas trata explicitamente como "qualquer caractere
        // aceito apenas aqui", sem abrir tolerância genérica para outras
        // palavras que não tiveram corrupção real.
        .replace(/\uFFFD/g, '?')
        // 🔥 Mesmo problema dos acentos "soltos" (quando o diacrítico chega
        // separado da letra, ex: "H^nio" em vez de "Hênio"): antes eram
        // REMOVIDOS (".replace(/[\^~´`]/g, '')"), o que desalinhava o
        // tamanho da palavra do mesmo jeito que o '�'. Agora também
        // marcamos como '?' em vez de remover.
        .replace(/[\^~´`]/g, '?')
        .replace(/[^a-zA-Z0-9\s?]/g, ' ')
        .replace(/\s+/g, ' ')
        .toLowerCase()
        .trim();
}

function limparPartes(nome) {
    const ignorar = ['da','de','do','das','dos'];
    return normalizar(nome)
        .split(' ')
        .filter(p => p.length > 2 && !ignorar.includes(p));
}

// Compara duas strings de mesmo tamanho permitindo que '?' (marcador de
// caractere corrompido, ver normalizar()) case com qualquer caractere na
// mesma posição. Usado apenas quando uma das palavras contém '?'.
function casaComWildcard(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] === '?' || b[i] === '?') continue;
        if (a[i] !== b[i]) return false;
    }
    return true;
}

function palavrasParecidas(a, b) {
    if (!a || !b) return false;
    if (a === b) return true;
    if (a.startsWith(b) || b.startsWith(a)) {
        return Math.abs(a.length - b.length) <= 2;
    }
    // 🔥 Só ativa a tolerância se uma das palavras tiver o marcador '?'
    // (caractere corrompido detectado em normalizar) E o restante bater
    // exatamente. Isso evita abrir tolerância genérica para nomes
    // diferentes que coincidentemente têm 1 letra de diferença
    // (ex: "Maria"/"Marcia", "Fernanda"/"Fernando" continuam não batendo).
    if ((a.includes('?') || b.includes('?')) && casaComWildcard(a, b)) {
        return true;
    }
    return false;
}

function primeiroNomeValido(busca, ad) {
    const a = busca[0];
    const b = ad[0];
    if (!a || !b) return false;
    return palavrasParecidas(a, b) || b.includes(a.substring(0, 3)) || a.includes(b.substring(0, 3));
}

function calcularScore(nomeBusca, nomeAD) {
    const partesBusca = limparPartes(nomeBusca);
    const partesAD = limparPartes(nomeAD);
    if (!partesBusca.length || !partesAD.length) return 0;
    if (!primeiroNomeValido(partesBusca, partesAD)) return 0;
    
    let score = 0;
    let pesoTotal = 0;
    
    partesBusca.forEach((parte, index) => {
        let peso = 1;
        if (index === 0) peso = 3;
        else if (index === partesBusca.length - 1) peso = 2;
        pesoTotal += peso;
        if (partesAD.some(p => palavrasParecidas(parte, p))) score += peso;
    });
    
    return score / pesoTotal;
}

function gerarBuscas(nome) {
    const partes = limparPartes(nome);
    let buscas = [];
    if (partes.length >= 2) buscas.push(`${partes[0]}*${partes[1]}`);
    if (partes.length >= 3) buscas.push(`${partes[0]}*${partes[1]}*${partes[2]}`);
    if (partes.length >= 2) buscas.push(`${partes[0]}*${partes[partes.length - 1]}`);
    return buscas;
}

async function buscarLoginPorNome(nomeCompleto) {
    // 🔥 VERIFICA SE AS CONFIGURAÇÕES FORAM CARREGADAS
    if (!AD_SERVER || !DOMAIN || !AD_ADMIN_USER || !AD_ADMIN_PASS) {
        console.error('❌ GLPI: Configurações do AD não carregadas');
        return null;
    }
    
    console.log(`🔍 Buscando login AD para: ${nomeCompleto}`);
    const nomeNormalizado = normalizar(nomeCompleto);
    const buscas = gerarBuscas(nomeNormalizado);
    
    let melhorLogin = null;
    let melhorScore = 0;
    
    for (const termo of buscas) {
        console.log(`🧠 Tentando busca: ${termo}`);
        const comando = `chcp 65001 > $null; dsquery * -limit 0 -filter "(&(objectClass=user)(name=*${termo}*))" -attr samAccountName name`;
        
        try {
            const stdout = await runWithCredentials(comando, 30000);
            if (!stdout || stdout.trim() === '') continue;
            
            const linhas = stdout.split('\n');
            for (const linha of linhas) {
                const clean = linha.trim();
                if (clean === '' || clean === 'samAccountName' || clean === 'name' || clean.includes('dsquery')) continue;
                
                const match = clean.match(/^([a-zA-Z0-9._-]+)\s+(.+)$/);
                if (!match) continue;
                
                const login = match[1];
                const nomeAD = match[2].trim();
                const score = calcularScore(nomeCompleto, nomeAD);
                
                console.log(`📊 ${login} → ${nomeAD} (score: ${Math.round(score * 100)}%)`);
                
                if (score >= 0.8) return login;
                if (score > melhorScore) {
                    melhorScore = score;
                    melhorLogin = login;
                }
            }
        } catch (error) {
            console.log(`❌ Erro: ${error.message}`);
        }
    }
    
    // 🔥 SEM fallback de "melhor esforço" abaixo de 80%: nomes com primeiro nome + sobrenome
    // genérico (ex: "Junior") iguais mas partes do meio completamente diferentes já pontuaram até
    // 71% aqui - o suficiente pra um fallback de 65% devolver o login de uma pessoa TOTALMENTE
    // diferente. Como esse login alimenta o reset de senha do GLPI/AD, um match errado reseta a
    // conta da pessoa errada sem consentimento - mais seguro dizer "não encontrado" (o funcionário
    // é orientado a contatar o suporte manualmente) do que arriscar isso.
    if (melhorLogin) {
        console.log(`❌ Nenhum usuário com confiança suficiente (melhor candidato: ${melhorLogin}, score: ${Math.round(melhorScore * 100)}% - abaixo do mínimo de 80%)`);
    } else {
        console.log(`❌ Nenhum usuário encontrado`);
    }
    return null;
}

module.exports = {
    LISTA_CARGOS,
    setTransporter,
    enviarCodigoEmail,
    buscarLoginPorNome,
    runWithCredentials
};
