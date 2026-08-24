# Bot WhatsApp de Autoatendimento — NTI

Bot de WhatsApp para autoatendimento de TI (Node.js + `whatsapp-web.js`) que permite a funcionários resetarem senha/e-mail em um de três sistemas internos, sem precisar abrir chamado ou ligar para o suporte. Complementado por um servidor Flask separado que conclui resets de senha do AD/GLPI a partir de um link enviado por e-mail.

Todo o texto voltado ao usuário (mensagens do bot, logs, comentários de código) está em pt-BR, e o **CPF** é a chave primária de busca de usuário nos três sistemas.

## Sumário

- [O que o bot resolve](#o-que-o-bot-resolve)
- [Arquitetura](#arquitetura)
- [Estrutura do repositório](#estrutura-do-repositório)
- [Como rodar](#como-rodar)
- [Configuração (`.env`)](#configuração-env)
- [Deploy em produção (PM2)](#deploy-em-produção-pm2)
- [Segurança e dados sensíveis](#segurança-e-dados-sensíveis)

## O que o bot resolve

Um funcionário manda mensagem pro número do bot no WhatsApp e, pelo menu, reseta senha ou altera e-mail em um destes sistemas:

| Sistema | O que é | Como o bot mexe nele |
|---|---|---|
| **GLPI** | Sistema de chamados/ticketing | A "senha do GLPI" é na verdade a conta do **Active Directory** — o reset roda PowerShell remoto contra o AD. É a mesma senha do login do Windows do funcionário. |
| **CONECTA** | Portal/RH interno | API REST própria — login, busca por CPF/nome e reset de senha via chamadas HTTP (sem navegador). |
| **VITAE** | Sistema hospitalar | Não tem API utilizável para alterar e-mail, então o bot automatiza o navegador (Puppeteer) para fazer a alteração pela própria interface web do sistema. |

Além do fluxo de autoatendimento, existe um **menu oculto para operadores do NTI/NAC** (`@nti` / `@nac`, liberado só para números autorizados) com busca de usuário nos sistemas, busca de IP de equipamento numa planilha de inventário de rede e ping de diagnóstico.

Há também uma camada opcional de IA (Google Gemini, free tier) que deixa as respostas do bot mais naturais e responde dúvidas gerais consultando uma base de conhecimento do NTI (`base_conhecimento_nti.md`). É só um verniz: se a IA falhar, não tiver chave configurada ou demorar demais, o bot cai automaticamente no comportamento padrão de mensagens fixas — nunca é obrigatória para o fluxo funcionar.

## Arquitetura

### `bot/bot.js` — máquina de estados única

Tudo passa por um único handler `client.on('message', ...)`. O estado da conversa de cada usuário fica em `sessions[from]` (`from` = JID do WhatsApp), e `session.step` guia uma cadeia longa de `if/else` — não há router/tabela de dispatch, cada passo novo é mais um bloco `if (session.step === ...)`.

Dois comandos são interceptados globalmente antes da lógica de step: `MENU` (reseta a sessão pro passo 0) e `SAIR` (cancela e apaga a sessão) — ambos também encerram qualquer sessão de navegador aberta no VITAE. O comando oculto `@nti` (e seu irmão `@nac`), liberado por uma allowlist fixa de JIDs no próprio código-fonte, abre um fluxo de menu separado (`NTI_MENU`/`NAC_MENU`) para operadores.

`bot/config.js` carrega `bot/.env` e é injetado em cada módulo de integração via `<módulo>.setTransporter(transporter, config)` — apesar do nome, é assim que tanto o transporter de e-mail (nodemailer) quanto o objeto de config chegam a `glpi.js`/`conecta.js`/`vitae.js`, evitando `require` circular de volta pro `bot.js`.

### Módulos de integração (um por sistema)

- **`bot/glpi.js`** — AD/GLPI. Reseta senha e busca contas via `powershell.exe -EncodedCommand` rodando `Invoke-Command` contra o servidor AD, com credencial de admin do domínio. Faz busca de login por nome com correspondência aproximada (wildcard/similaridade) sobre saída de `dsquery`. Lista de cargos vem de `bot/json/cargos.json`.
- **`bot/conecta.js`** — cliente REST puro (axios) contra a API do CONECTA: login, busca por CPF/nome, reset de senha, tudo via HTTP.
- **`bot/vitae.js`** — híbrido: login via HTTP puro (axios + cookie jar), e o resto do fluxo (busca, troca de e-mail) via Puppeteer + plugin stealth, porque o restante do sistema não tem API. Sessões de navegador por usuário ficam num `Map` em memória.
- **`bot/ia.js`** — camada opcional de IA (Gemini) descrita acima.
- **`bot/inventarioRede.js`** — busca de IP de computador/impressora numa planilha do Google Sheets (só leitura, via conta de serviço), usada só no menu oculto `@nti`/`@nac`. Busca 100% determinística — sem IA envolvida.
- **`bot/ping.js`** — ping de diagnóstico de rede, também restrito ao menu oculto.

`bot/json/*.json` é o estado em arquivo plano do bot: `cargos.json` e `unidades.json` (cache de dropdowns) são versionados; `emails_cache.json` e `dados_alteracao.json` contêm dados reais de funcionários (PII) e **nunca são versionados** (ver [Segurança](#segurança-e-dados-sensíveis)).

### `servidor/` — fluxo web de reset de senha (processo Flask separado)

`servidor/app.py` (servido via waitress pelo `servidor/run.py`) gera tokens de uso único (`/api/gerar-token`, `/api/validar-token`, `/api/resetar-senha`) para completar um reset de senha do AD a partir de um link enviado por e-mail, usando o mesmo padrão `subprocess` + `powershell -EncodedCommand` + `Invoke-Command` do `bot/glpi.js`. Os tokens ficam em memória — reiniciar o processo invalida todos os links pendentes. É um processo de SO totalmente independente do bot; eles não compartilham memória, só o mesmo padrão de credencial de admin do AD.

## Estrutura do repositório

```
bot/                  bot de WhatsApp (Node.js)
  bot.js              máquina de estados / handler de mensagens
  glpi.js             integração GLPI/AD (reset via PowerShell remoto)
  conecta.js          integração CONECTA (API REST)
  vitae.js            integração VITAE (HTTP + Puppeteer)
  ia.js               camada opcional de IA (Gemini)
  inventarioRede.js   busca de IP (menu oculto @nti/@nac)
  ping.js             ping de diagnóstico (menu oculto)
  config.js           carrega bot/.env
  json/               estado em arquivo plano (cargos, unidades, caches)
servidor/             servidor Flask do fluxo web de reset de senha
  app.py
  run.py
  resetar_senha.html
pm2/ecosystem.config.js  configuração de deploy dos dois processos
bats/                 scripts .bat de operação (start/stop/restart/limpeza)
base_conhecimento_nti.md  base de conhecimento consultada pela camada de IA
```

## Como rodar

Não há build, linter ou suíte de testes automatizada configurada (`test/` tem só scripts manuais avulsos).

**Bot** (requer `bot/.env`, ver [Configuração](#configuração-env)):
```bash
node bot/bot.js
```
Na primeira execução, um QR code aparece no terminal — escaneie com a conta de WhatsApp que vai atuar como o bot.

**Servidor de reset de senha** (requer `servidor/.env`):
```bash
python servidor/run.py
```

## Configuração (`.env`)

Ambos os processos carregam credenciais de arquivos `.env` (gitignored, não presentes no repositório): `bot/.env` e `servidor/.env`.

Variáveis lidas por `bot/config.js`:

| Variável | Uso |
|---|---|
| `EMAIL_USER`, `EMAIL_PASS`, `EMAIL_SERVICE` | SMTP para envio de códigos de verificação por e-mail |
| `GLPI_AD_SERVER`, `GLPI_AD_DOMAIN`, `GLPI_AD_USER`, `GLPI_AD_PASS` | Credencial de admin do AD para reset de senha via PowerShell remoto |
| `CONECTA_API_URL`, `CONECTA_USERNAME`, `CONECTA_PASSWORD`, `CONECTA_NOVA_SENHA` | Acesso à API do CONECTA |
| `VITAE_URL`, `VITAE_USERNAME`, `VITAE_PASSWORD` | Login no VITAE |
| `TIMEOUT_INATIVIDADE_MINUTES`, `MAX_RECONNECT_ATTEMPTS`, `SESSION_CLEANUP_INTERVAL_MINUTES` | Comportamento de sessão do bot |
| `PUPPETEER_HEADLESS`, `PUPPETEER_EXECUTABLE_PATH`, `PUPPETEER_ARGS` | Configuração do navegador headless (VITAE) |
| `GEMINI_API_KEY`, `GEMINI_MODEL`, `IA_ATIVA` | Camada opcional de IA — sem `GEMINI_API_KEY`, o bot roda normalmente no modo padrão |
| `GOOGLE_SHEETS_ID`, `GOOGLE_SERVICE_ACCOUNT_KEY_PATH` | Planilha de inventário de rede (menu oculto `@nti`/`@nac`) — precisa também de uma chave de conta de serviço do Google Cloud em `bot/credentials/` (gitignored) |

`servidor/app.py` carrega seu próprio conjunto de variáveis via `load_dotenv()` (servidor/domínio AD, SMTP, expiração de token, URLs base) — ver o topo do arquivo para a lista completa.

A allowlist de operadores do NTI/NAC (`NUMEROS_NTI`/`NUMEROS_NAC` em `bot/bot.js`) **não é configurável por `.env`** — para adicionar ou remover operadores é preciso editar o código-fonte diretamente.

## Deploy em produção (PM2)

Produção roda os dois processos (`whatsapp-bot` e `reset-senha-api`) via PM2, a partir de `pm2/ecosystem.config.js`. Operadores usam os scripts em `bats/` em vez de comandos `pm2` diretos:

- `bats/iniciar-bot.bat` — `pm2 start ecosystem.config.js`
- `bats/parar-bot.bat` — para os dois apps
- `bats/reiniciar-bot.bat` — `pm2 restart all`
- `bats/limpeza-cache-bot.bat` — para o bot, apaga `.wwebjs_auth/`/`.wwebjs_cache/` (força reautenticação via novo QR code) e reinicia — usar quando a sessão do WhatsApp travar ou corromper.

`servidor/run.spec`/`servidor.spec` são specs do PyInstaller para empacotar o Flask app num `.exe` standalone; não fazem parte do ciclo normal de desenvolvimento.

## Segurança e dados sensíveis

- **Nunca versionar** `.env`, `bot/credentials/` (chave de conta de serviço Google), `bot/json/dados_alteracao.json` e `bot/json/emails_cache.json` — todos já cobertos pelo `.gitignore`.
- `pm2/ecosystem.config.js` é versionado — **nunca adicione credenciais em texto plano nele**. Toda credencial deve vir de `bot/.env` / `servidor/.env`, carregados dentro de cada processo.
- Os módulos de integração (`glpi.js`, `conecta.js`, `config.js`) exigem as variáveis de ambiente correspondentes e lançam erro explícito se faltarem — não há fallback com credencial hardcoded.
- Este é um repositório **privado**: mesmo sem credenciais expostas, o código revela nomes de sistemas internos, lógica de negócio e superfície de ataque do NTI. Mantenha assim.
