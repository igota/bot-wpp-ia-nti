# Guia de Deploy em um Novo Servidor

Passo a passo para colocar os dois processos (bot de WhatsApp e servidor de reset de senha) rodando do zero num servidor Windows novo. Para entender o que cada peça faz, veja o [README](README.md) primeiro.

> ⚠️ **Antes de seguir este guia**: os scripts em `bats/*.bat` têm **caminhos absolutos hardcoded** (`C:\Mega\Projeto BOT WPP\...`, de uma instalação antiga) e referenciam nomes de processo PM2 diferentes dos declarados em `pm2/ecosystem.config.js` (`whatsapp-bot` vs `whatsapp-bot-ia-proto`, `reset-senha-api` vs `reset-senha-api-ia-proto`). **Ajuste os `.bat` antes de usá-los** — o passo 6 abaixo detalha isso. (O `cwd` do `ecosystem.config.js` em si **não precisa de ajuste**: ele é calculado automaticamente a partir da posição do próprio arquivo, então funciona em qualquer caminho onde o repositório for clonado.)

## 0. Pré-requisitos no servidor

- **Windows Server** (ou Windows normal) com acesso de rede aos sistemas internos: AD/GLPI, CONECTA, VITAE, e ao SMTP usado para envio de e-mail.
- **Node.js** (mesma major usada em dev — atualmente v24.x) e **npm**.
- **Python 3.11+** com `pip`.
- **Git**.
- **PowerShell Remoting habilitado** entre este servidor e o `AD_SERVER` — é assim que `bot/glpi.js` e `servidor/app.py` executam o reset de senha (`Invoke-Command` via `powershell.exe -EncodedCommand`). Sem isso, o reset de GLPI/AD não funciona.
- Conta de admin do AD com permissão de reset de senha (será usada via `.env`, nunca hardcoded).
- **PM2** instalado globalmente: `npm install -g pm2`.

## 1. Clonar o repositório

```powershell
git clone https://github.com/igota/bot-wpp-ia-nti.git
cd bot-wpp-ia-nti
```

Anote o caminho absoluto onde o repositório ficou — ele é usado no passo 6.

## 2. Instalar dependências Node.js

```powershell
npm ci
```

Isso recria o `node_modules/` a partir do `package-lock.json` (ele nunca é versionado — não precisa, e não deve, ser copiado manualmente entre servidores). O `puppeteer` (usado por `bot/vitae.js`) baixa uma versão do Chromium durante essa instalação, então o servidor precisa de acesso à internet nesse momento — ou configure `PUPPETEER_EXECUTABLE_PATH` no `.env` apontando para um Chrome/Chromium já instalado, se o download automático não for viável.

## 3. Instalar dependências Python

```powershell
cd servidor
pip install -r requirements.txt
cd ..
```

## 4. Criar os arquivos `.env`

Nenhum dos dois é versionado (ambos gitignored) — precisam ser criados manualmente em cada servidor.

### `bot/.env`

| Variável | Descrição |
|---|---|
| `EMAIL_USER`, `EMAIL_PASS`, `EMAIL_SERVICE` | SMTP para envio de códigos de verificação |
| `GLPI_AD_SERVER`, `GLPI_AD_DOMAIN`, `GLPI_AD_USER`, `GLPI_AD_PASS` | Credencial de admin do AD (reset via PowerShell remoto) |
| `CONECTA_API_URL`, `CONECTA_USERNAME`, `CONECTA_PASSWORD`, `CONECTA_NOVA_SENHA` | Acesso à API do CONECTA |
| `VITAE_URL`, `VITAE_USERNAME`, `VITAE_PASSWORD` | Login no VITAE |
| `TIMEOUT_INATIVIDADE_MINUTES`, `MAX_RECONNECT_ATTEMPTS`, `SESSION_CLEANUP_INTERVAL_MINUTES` | Comportamento de sessão (opcionais, têm default) |
| `PUPPETEER_HEADLESS`, `PUPPETEER_EXECUTABLE_PATH`, `PUPPETEER_ARGS` | Configuração do navegador headless (VITAE) |
| `GEMINI_API_KEY`, `GEMINI_MODEL`, `IA_ATIVA` | Camada opcional de IA — pode deixar em branco, o bot funciona sem ela |
| `GOOGLE_SHEETS_ID`, `GOOGLE_SERVICE_ACCOUNT_KEY_PATH` | Planilha de inventário de rede (menu oculto `@nti`/`@nac`) |
| `NUMEROS_NTI`, `NUMEROS_NAC` | Allowlist de operadores do menu oculto `@nti`/`@nac` — JIDs do WhatsApp separados por vírgula (ex: `NUMEROS_NTI=1111@lid,2222@lid`). Sem isso, ninguém acessa o menu oculto neste servidor. |

Se for usar `GOOGLE_SHEETS_ID`, também é preciso colocar a chave de conta de serviço do Google Cloud em `bot/credentials/` (pasta gitignored, criar manualmente).

### `servidor/.env`

| Variável | Descrição |
|---|---|
| `ENV` | `production` |
| `SECRET_KEY` | Chave secreta do Flask (gere uma nova, não reaproveite entre ambientes) |
| `AD_SERVER`, `DOMAIN`, `AD_USER`, `AD_PASS` | Mesmo padrão de credencial de admin do AD usado pelo bot — `AD_PASS` é obrigatório, o processo não sobe sem ele |
| `TOKEN_EXPIRY_SECONDS`, `MAX_TOKEN_ATTEMPTS` | Expiração/tentativas do token de reset (opcionais, têm default) |
| `BASE_URL` | URL pública onde este servidor Flask fica acessível (usada nos links de reset enviados por e-mail) |
| `GLPI_URL` | URL do GLPI (informativa, aparece nas mensagens) |
| `PORT`, `HOST` | Porta/host do Flask (default `5000` / `0.0.0.0`) |

## 5. Primeira execução do bot (escanear o QR code)

Antes de colocar em produção via PM2, rode o bot manualmente uma vez para autenticar a sessão do WhatsApp:

```powershell
node bot/bot.js
```

Um QR code aparece no terminal — escaneie com a conta de WhatsApp que vai atuar como o bot (WhatsApp > Aparelhos conectados > Conectar um aparelho). A sessão fica salva em `.wwebjs_auth/` (gitignored). Depois que aparecer confirmação de conexão, pare o processo (`Ctrl+C`) — o PM2 assume a partir daqui.

## 6. Ajustar `bats/*.bat` para este servidor

`pm2/ecosystem.config.js` não precisa de edição — o `cwd` de cada app é resolvido automaticamente a partir de onde o arquivo está (`path.join(__dirname, '..', 'bot')` / `'..', 'servidor'`).

Já os scripts em `bats/` (`iniciar-bot.bat`, `parar-bot.bat`, `reiniciar-bot.bat`, `limpeza-cache-bot.bat`) precisam de dois ajustes manuais:
1. Corrija o `cd /d "..."` de cada um para o caminho real onde você clonou o repositório neste servidor (passo 1) — hoje eles apontam para `C:\Mega\Projeto BOT WPP\pm2` / `...\bot`, de uma instalação antiga.
2. Corrija os nomes de processo nos comandos `pm2 stop`/`pm2 start` para bater com os nomes declarados em `ecosystem.config.js` (`whatsapp-bot-ia-proto` e `reset-senha-api-ia-proto`) — os scripts atuais usam nomes antigos (`whatsapp-bot`, `reset-senha-api`) que não existem no `ecosystem.config.js` deste repositório.

## 7. Subir com PM2

```powershell
cd pm2
pm2 start ecosystem.config.js
pm2 status
```

Ou, depois de corrigido o passo 6, use `bats/iniciar-bot.bat`.

Para manter os processos rodando após reboot do servidor:
```powershell
pm2 save
pm2-startup install    # ou: pm2 startup, seguindo as instruções que o comando imprime
```

## 8. Verificação pós-deploy

- `pm2 status` — os dois apps devem estar `online`.
- `pm2 logs whatsapp-bot-ia-proto` — confirme que carregou o `.env` sem erro (`bot/config.js` imprime `✅`/`❌` para cada variável obrigatória) e que a sessão do WhatsApp reconectou sem pedir novo QR code.
- Mande uma mensagem de teste pro número do bot no WhatsApp e percorra o menu principal.
- `pm2 logs reset-senha-api-ia-proto` — confirme que subiu na porta configurada, e teste o fluxo de reset de senha por link de e-mail ponta a ponta.

## 9. Operação do dia a dia

Depois de corrigidos os caminhos (passo 6), use os scripts em `bats/` em vez de comandos `pm2` diretos — ver [README § Deploy em produção](README.md#deploy-em-produção-pm2). Use `bats/limpeza-cache-bot.bat` sempre que a sessão do WhatsApp travar/corromper (ele apaga `.wwebjs_auth/`/`.wwebjs_cache/` e força um novo QR code).

## 10. Se este servidor também vai operar o menu oculto `@nti`/`@nac`

Configure `NUMEROS_NTI`/`NUMEROS_NAC` no `bot/.env` deste servidor (passo 4) com os JIDs dos operadores autorizados. Sem essas variáveis, a allowlist fica vazia e o menu oculto não é acessível por ninguém — comportamento seguro por padrão, mas lembre de configurá-las se este ambiente também atende operadores do NTI/NAC.
