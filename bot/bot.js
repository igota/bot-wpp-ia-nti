// ==================== CARREGAR CONFIGURAÇÕES ====================
require('dotenv').config();
const config = require('./config.js'); // Você precisa criar este arquivo

// ==================== BOT PRINCIPAL ====================
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

// Importação dos módulos
const glpi = require('./glpi.js');
const conecta = require('./conecta.js');
const vitae = require('./vitae.js');
const ia = require('./ia.js'); // 🔥 PROTÓTIPO: camada de IA (Gemini) para respostas mais naturais
const inventarioRede = require('./inventarioRede.js'); // Busca de IP na planilha (uso interno @nti)
const { pingIP } = require('./ping.js'); // Ping de diagnóstico (uso interno @nti)
const notificacoesSobreaviso = require('./notificacoesSobreaviso.js'); // Avisa quem está de sobreaviso (8h/15:55)

// Variável global LISTA_CARGOS (vinda do glpi.js)
let LISTA_CARGOS = glpi.LISTA_CARGOS;

// Importações específicas (opcional, para facilitar o uso)
const { 
    setTransporter,              // ← ADICIONE ESTA
    conectaLogin,
    buscarUsuarioPorCPF,
    buscarUsuariosPorNome,
    resetarSenhaConectaPorCPF,
    resetarSenhaConectaPorId,
    buscarDadosSeguranca,
    converterTimestampParaData,
    limparEmail,
    conectaBuscarDadosCompletos,
    enviarCodigoEmailConecta,
    getNovaSenha
} = conecta;

const { 
    enviarCodigoEmail,
    buscarLoginPorNome
} = glpi;

const {
    iniciarNavegador,
    buscarEAlterarEmailVitae,
    buscarUsuarioVitae,
    obterOpcoesUnidades,
    gerarCodigoVerificacao,
    enviarCodigoEmailVitae,
    codigosEnviados,
    carregarUnidades,
    fecharSessao,
    transferirUnidadeUsuario,
    obterSessao,
    buscarEspecialidadesDisponiveis,
    adicionarEspecialidade,
    excluirEspecialidade,
    salvarAlteracoesEspecialidade,
    capturarGruposUsuario
} = vitae;

// ==================== CONFIGURAÇÃO DE EMAIL (USANDO .ENV) ====================
const transporter = nodemailer.createTransport({
    service: config.email.service,
    auth: {
        user: config.email.user,
        pass: config.email.pass
    }
});

// ==================== CONFIGURAÇÕES DO BOT (USANDO .ENV) ====================
const TIMEOUT_INATIVIDADE = (config.bot?.timeoutInatividade || 5) * 60 * 1000;

const COMANDO_SECRETO = '@nti'; // ← Comando que só o NTI sabe

// Allowlist configurada via NUMEROS_NTI no .env (ver bot/config.js) - lista de JIDs
// separados por vírgula. Não editar aqui; editar bot/.env.
const NUMEROS_NTI = config.bot.numerosNti;

// Menu oculto irmão do @nti — mesmo fluxo hoje, mas mantido com steps e allowlist
// próprios (prefixo NAC_) para que opções futuras adicionadas só ao @nti não vazem
// para cá e vice-versa.
const COMANDO_SECRETO_NAC = '@nac'; // ← Comando que só o NAC sabe

// Allowlist configurada via NUMEROS_NAC no .env (ver bot/config.js) - lista de JIDs
// separados por vírgula. Não editar aqui; editar bot/.env.
const NUMEROS_NAC = config.bot.numerosNac;

// 🔥 INJETA O TRANSPORTER E CONFIG NOS MÓDULOS (CORRIGIDO)
glpi.setTransporter(transporter, config);
conecta.setTransporter(transporter, config);
vitae.setTransporter(transporter, config);
ia.setConfig(config);
inventarioRede.setConfig(config);

// ==================== CONFIGURAÇÕES GERAIS ====================
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 🔥 Saudações simples ("oi", "bom dia"...) são reconhecidas por palavra-chave, sem chamar a IA -
// evita o round-trip do Gemini (10-20s em timeout/retry, ver ia.js) só pra descobrir que a
// mensagem não pede nada específico e cair no menu de qualquer forma.
const REGEX_SAUDACAO_SIMPLES = /^(oi+|ol[aá]|opa+|eae+|e\s*a[ií]|salve|hey+|hello|al[oô]|fala|bom\s*dia|boa\s*tarde|boa\s*noite|tudo\s*bem|tudo\s*bom|beleza|blz)[\s!?.,]*$/i;

function ehSaudacaoSimples(texto) {
    const normalizado = (texto || '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .trim();
    return REGEX_SAUDACAO_SIMPLES.test(normalizado);
}

// 🔥 PROTÓTIPO DE IA: guarda os últimos turnos da conversa por sessão, pra IA responder
// de forma reativa (não amnésica) nos pontos que usam ia.responderNatural(). Mantém só
// as últimas 3 trocas (6 entradas) - não precisa de mais que isso pra dar contexto.
function registrarHistoricoIA(session, mensagemUsuario, respostaBot) {
    if (!session.data.historicoIA) session.data.historicoIA = [];
    session.data.historicoIA.push({ papel: 'usuario', texto: mensagemUsuario });
    session.data.historicoIA.push({ papel: 'bot', texto: respostaBot });
    if (session.data.historicoIA.length > 6) {
        session.data.historicoIA = session.data.historicoIA.slice(-6);
    }
}

// 🔥 Extraído do bloco do STEP 0 pra poder ser chamado tanto de lá quanto do sub-fluxo de
// dúvida NTI (quando o usuário resolve trocar de assunto no meio de uma conversa livre).
async function iniciarFluxoSistema(from, session, opcao) {
    if (opcao === '1') {
        session.data.sistema = 'GLPI';
        await client.sendMessage(from,
            `✅ Sistema: *${session.data.sistema}*\n\n` +
            `Digite seu *CPF* (apenas números):`
        );
        session.step = 1;

    } else if (opcao === '2') {
        session.data.sistema = 'CONECTA';
        await client.sendMessage(from,
            `✅ Sistema: *${session.data.sistema}*\n\n` +
            `Digite seu *CPF* (apenas números):`
        );
        session.step = 1;

    } else if (opcao === '3') {
        session.data.sistema = 'VITAE';

        await client.sendMessage(from, '⏳ *Preparando ambiente VITAE...* Aguarde um momento.');

        const iniciado = await iniciarNavegador(from);

        if (!iniciado) {
            await client.sendMessage(from,
                `❌ *Erro ao iniciar sistema VITAE*\n\n` +
                `Tente novamente mais tarde.\n\n` +
                `Digite *MENU* para voltar.`
            );
            delete sessions[from];
            return;
        }

        await sleep(1000);

        await client.sendMessage(from,
            `✅ *Sistema VITAE pronto!*\n\n` +
            `Digite o *CPF* do usuário (apenas números):`
        );

        session.step = 'STEP_VITAE_CPF';
    }
}
puppeteer.use(StealthPlugin());

// ==================== SESSÕES ====================
const sessions = {};
const EMAILS_CACHE_FILE = path.join(__dirname, 'json', 'emails_cache.json');





// Armazena timeouts para cada usuário
const expirationTimeouts = new Map();

// Carrega o cache de e-mails
function carregarCacheEmails() {
    try {
        if (fs.existsSync(EMAILS_CACHE_FILE)) {
            const data = fs.readFileSync(EMAILS_CACHE_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error('❌ Erro ao carregar cache de e-mails:', error);
    }
    return {};
}

// Salva o cache de e-mails
function salvarCacheEmails(cache) {
    try {
        fs.writeFileSync(EMAILS_CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8');
        console.log('✅ Cache de e-mails salvo');
    } catch (error) {
        console.error('❌ Erro ao salvar cache de e-mails:', error);
    }
}

// Busca email alternativo por CPF
function buscarEmailCache(cpf, sistema) {
    const cache = carregarCacheEmails();
    const key = `${sistema}_${cpf}`;
    
    if (cache[key]) {
        return cache[key].email;
    }
    return null;
}

// Salva ou atualiza email alternativo
function salvarEmailCache(cpf, sistema, login, email) {
    const cache = carregarCacheEmails();
    const key = `${sistema}_${cpf}`;
    
    cache[key] = {
        email: email,
        login: login,
        sistema: sistema,
        cpf: cpf,
        data_cadastro: cache[key]?.data_cadastro || new Date().toISOString(),
        ultimo_uso: new Date().toISOString()
    };
    
    salvarCacheEmails(cache);
    console.log(`📧 Email alternativo salvo para ${sistema} - CPF: ${cpf} -> ${email}`);
}

// Remove email alternativo (se usuário quiser trocar)
function removerEmailCache(cpf, sistema) {
    const cache = carregarCacheEmails();
    const key = `${sistema}_${cpf}`;
    
    if (cache[key]) {
        delete cache[key];
        salvarCacheEmails(cache);
        console.log(`🗑️ Email alternativo removido para ${sistema} - CPF: ${cpf}`);
        return true;
    }
    return false;
}




// Atualiza o timestamp da última atividade do usuário
function atualizarAtividade(from) {
    if (!sessions[from]) return;
    
    const tempoAnterior = sessions[from].ultimaAtividade;
    sessions[from].ultimaAtividade = Date.now();
    
    // 🔥 RESETA O TIMEOUT DE EXPIRAÇÃO SEMPRE QUE HOUVER ATIVIDADE
    resetarTimeoutExpiracao(from);
    
    console.log(`🕐 Atividade atualizada para ${from}`);
}

// Reseta o timeout de expiração para um usuário
function resetarTimeoutExpiracao(from) {
    // Remove o timeout anterior se existir
    if (expirationTimeouts.has(from)) {
        clearTimeout(expirationTimeouts.get(from));
        expirationTimeouts.delete(from);
        console.log(`🔄 Timeout de expiração resetado para ${from}`);
    }
    
    // Cria novo timeout para expirar após o tempo de inatividade
    const timeout = setTimeout(async () => {
        await expirarSessao(from);
    }, TIMEOUT_INATIVIDADE);
    
    expirationTimeouts.set(from, timeout);
    console.log(`⏰ Timeout de expiração agendado para ${from} em ${TIMEOUT_INATIVIDADE / 60000} minutos`);
}

// Função que expira a sessão automaticamente
async function expirarSessao(from) {
    console.log(`⏰ Sessão EXPIRADA por inatividade: ${from}`);
    
    // Verifica se a sessão ainda existe
    const session = sessions[from];
    if (!session) {
        console.log(`   ℹ️ Sessão já não existe para: ${from}`);
        return;
    }
    
    // Fecha o navegador VITAE se existir
    try {
        await fecharSessao(from);
        console.log(`   ✅ Navegador VITAE fechado`);
    } catch (error) {
        console.log(`   ⚠️ Erro ao fechar navegador: ${error.message}`);
    }
    
    // Remove a sessão
    delete sessions[from];
    
    // 🔥 ENVIA MENSAGEM AUTOMATICAMENTE (sem o usuário precisar enviar nada)
    try {
        // Precisa do client - vamos armazenar o client globalmente
        if (globalWhatsAppClient) {
            await globalWhatsAppClient.sendMessage(from, 
                `⏰ *ATENDIMENTO ENCERRADO*\n\n` +
                `Seu atendimento foi encerrado automaticamente por *inatividade*.\n` +
                `Digite *MENU* para iniciar um novo atendimento.`
            );
            console.log(`   ✅ Mensagem de expiração enviada com sucesso para ${from}`);
        } else {
            console.log(`   ❌ Cliente WhatsApp não disponível para enviar mensagem`);
        }
    } catch (err) {
        console.error(`   ❌ Erro ao enviar mensagem de expiração: ${err.message}`);
    }
    
    // Remove o timeout do map
    expirationTimeouts.delete(from);
}

// Limpa sessões órfãs (caso alguém tenha fechado sem limpar o timeout)
async function limparSessoesOrfas() {
    const agora = Date.now();
    let removidas = 0;
    
    for (const [from, session] of Object.entries(sessions)) {
        const tempoInativo = agora - (session.ultimaAtividade || agora);
        
        // Sessões que passaram muito do tempo (limpeza de segurança)
        if (tempoInativo > TIMEOUT_INATIVIDADE + 60000) {
            console.log(`🧹 Limpeza automática: removendo sessão órfã de ${from} (${Math.floor(tempoInativo / 1000)}s inativo)`);
            
            try {
                await fecharSessao(from);
            } catch (error) {
                console.log(`   ⚠️ Erro ao fechar navegador: ${error.message}`);
            }
            
            delete sessions[from];
            removidas++;
            
            // Limpa o timeout também
            if (expirationTimeouts.has(from)) {
                clearTimeout(expirationTimeouts.get(from));
                expirationTimeouts.delete(from);
            }
        }
    }
    
    if (removidas > 0) {
        console.log(`🧹 Limpeza automática: ${removidas} sessões órfãs removidas`);
    }
}

// Timer para limpeza de sessões órfãs (a cada 5 minutos)
setInterval(async () => {
    await limparSessoesOrfas();
}, 5 * 60 * 1000);


// ==================== CRIA O CLIENTE DO WHATSAPP ====================
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: config.whatsapp.headless,
        args: config.whatsapp.args,
        executablePath: config.whatsapp.executablePath
    }
});

globalWhatsAppClient = client;

// ==================== WhatsApp Bot ====================

// Mostra a lista de especialidades disponíveis para adicionar ao usuário cujo cadastro está
// aberto na sessão. Usada tanto antes quanto depois de uma transferência, por isso fica fora
// do handler de mensagens para não duplicar essa lógica em cada ponto que oferece essa opção.
async function mostrarMenuAdicionarEspecialidade(from, session) {
    const page = obterSessao(from)?.page;
    if (!page) {
        await client.sendMessage(from, `❌ *Sessão expirada.* Reinicie o processo.`);
        delete sessions[from];
        return;
    }

    await client.sendMessage(from, `🔍 *Buscando especialidades disponíveis...*`);

    const especialidades = await buscarEspecialidadesDisponiveis(page);

    if (!especialidades || especialidades.length === 0) {
        await client.sendMessage(from, `❌ *Nenhuma especialidade disponível para adicionar.*`);
        delete sessions[from];
        return;
    }

    let listaMsg = `📋 *Especialidades disponíveis:*\n\n`;
    especialidades.forEach((esp, index) => {
        listaMsg += `${index + 1} - ${esp.nome}\n`;
    });
    listaMsg += `\nDigite o *NÚMERO* da especialidade que deseja adicionar:`;

    session.data.listaEspecialidades = especialidades;
    session.step = 'NTI_ESCOLHER_ESPECIALIDADE';

    await client.sendMessage(from, listaMsg);
}

// Mostra a lista de especialidades já cadastradas no usuário (capturada antes, em
// session.data.especialidadesAtuais) para escolher qual excluir.
async function mostrarMenuExcluirEspecialidade(from, session) {
    const page = obterSessao(from)?.page;
    if (!page) {
        await client.sendMessage(from, `❌ *Sessão expirada.* Reinicie o processo.`);
        delete sessions[from];
        return;
    }

    const especialidadesAtuais = session.data.especialidadesAtuais;
    if (!especialidadesAtuais || especialidadesAtuais.length === 0) {
        await client.sendMessage(from, `❌ *Este usuário não possui especialidades cadastradas para excluir.*`);
        await fecharSessao(from);
        delete sessions[from];
        return;
    }

    let listaMsg = `📋 *Especialidades cadastradas:*\n\n`;
    especialidadesAtuais.forEach((esp, index) => {
        listaMsg += `${index + 1} - ${esp.especialidade} (Ambulatório: ${esp.atendeAmbulatorio}, Ativo: ${esp.ativo})\n`;
    });
    listaMsg += `\nDigite o *NÚMERO* da especialidade que deseja excluir:`;

    session.step = 'NTI_ESCOLHER_ESPECIALIDADE_EXCLUIR';

    await client.sendMessage(from, listaMsg);
}

// Equivalentes das duas funções acima, usadas pelo fluxo @nac (isolado do @nti).
async function mostrarMenuAdicionarEspecialidadeNac(from, session) {
    const page = obterSessao(from)?.page;
    if (!page) {
        await client.sendMessage(from, `❌ *Sessão expirada.* Reinicie o processo.`);
        delete sessions[from];
        return;
    }

    await client.sendMessage(from, `🔍 *Buscando especialidades disponíveis...*`);

    const especialidades = await buscarEspecialidadesDisponiveis(page);

    if (!especialidades || especialidades.length === 0) {
        await client.sendMessage(from, `❌ *Nenhuma especialidade disponível para adicionar.*`);
        delete sessions[from];
        return;
    }

    let listaMsg = `📋 *Especialidades disponíveis:*\n\n`;
    especialidades.forEach((esp, index) => {
        listaMsg += `${index + 1} - ${esp.nome}\n`;
    });
    listaMsg += `\nDigite o *NÚMERO* da especialidade que deseja adicionar:`;

    session.data.listaEspecialidades = especialidades;
    session.step = 'NAC_ESCOLHER_ESPECIALIDADE';

    await client.sendMessage(from, listaMsg);
}

async function mostrarMenuExcluirEspecialidadeNac(from, session) {
    const page = obterSessao(from)?.page;
    if (!page) {
        await client.sendMessage(from, `❌ *Sessão expirada.* Reinicie o processo.`);
        delete sessions[from];
        return;
    }

    const especialidadesAtuais = session.data.especialidadesAtuais;
    if (!especialidadesAtuais || especialidadesAtuais.length === 0) {
        await client.sendMessage(from, `❌ *Este usuário não possui especialidades cadastradas para excluir.*`);
        await fecharSessao(from);
        delete sessions[from];
        return;
    }

    let listaMsg = `📋 *Especialidades cadastradas:*\n\n`;
    especialidadesAtuais.forEach((esp, index) => {
        listaMsg += `${index + 1} - ${esp.especialidade} (Ambulatório: ${esp.atendeAmbulatorio}, Ativo: ${esp.ativo})\n`;
    });
    listaMsg += `\nDigite o *NÚMERO* da especialidade que deseja excluir:`;

    session.step = 'NAC_ESCOLHER_ESPECIALIDADE_EXCLUIR';

    await client.sendMessage(from, listaMsg);
}

// QR Code
client.on('qr', (qr) => {
    console.log('📱 Escaneie o QR Code com o WhatsApp do BOT:');
    qrcode.generate(qr, { small: true });
});

// Bot pronto
client.on('ready', () => {
    console.log('✅ WhatsApp BOT conectado!');
    console.log('🎯 Bot ouvindo mensagens...');

    notificacoesSobreaviso.iniciarAgendamento(client);
});


async function processarMensagem(message) {
    const from = message.from;

    // Atualizações de Status/Stories chegam com from === 'status@broadcast' e não
    // são um chat de verdade — responder a elas quebra o whatsapp-web.js
    // (canCheckStatusRankingPosterGating is not a function) e cria sessões fantasma.
    if (from === 'status@broadcast') return;

    const body = (message.body || '').trim();
    console.log(`📱 FROM exato: "${from}"`); // ← Vai mostrar o formato correto



    if (message.isGroupMsg) return;
    if (from === client.info.wid._serialized) return;

        if (!body) {
        console.log(`⚠️ Mensagem vazia ignorada de ${from}`);
        return;
    }

    // 🔥 ========== COMANDO SECRETO NTI (ADICIONE AQUI) ==========
    if (body === COMANDO_SECRETO) {
        // Verifica se é um número autorizado
        if (!NUMEROS_NTI.includes(from)) {
            await client.sendMessage(from, '❌ Comando não reconhecido. Num é assim não!');
            return;
        }

        // Salva a sessão como menu NTI
        sessions[from] = {
            step: 'NTI_MENU_PRINCIPAL',
            data: {},
            ultimaAtividade: Date.now()
        };
        resetarTimeoutExpiracao(from);

        await client.sendMessage(from,
            `🔐 *HELPZIN ADMIN - ACESSO RESTRITO*\n\n` +
            `1 - TRANSFERÊNCIA DE USUÁRIOS\n` +
            `2 - PLANILHAS\n` +
            `3 - PING\n\n` +
            `Digite o número da opção:`
        );
        return;
    }

    // 🔥 ========== COMANDO SECRETO NAC (isolado do @nti) ==========
    if (body === COMANDO_SECRETO_NAC) {
        // Verifica se é um número autorizado
        if (!NUMEROS_NAC.includes(from)) {
            await client.sendMessage(from, '❌ Comando não reconhecido. Num é assim não!');
            return;
        }

        // Salva a sessão como menu NAC
        sessions[from] = {
            step: 'NAC_MENU_PRINCIPAL',
            data: {},
            ultimaAtividade: Date.now()
        };
        resetarTimeoutExpiracao(from);

        await client.sendMessage(from,
            `🔐 *HELPZIN NAC - ACESSO RESTRITO*\n\n` +
            `1 - TRANSFERÊNCIA DE USUÁRIOS\n\n` +
            `Digite o número da opção:`
        );
        return;
    }

    console.log('====================================');
    console.log(`📩 Mensagem: ${body}`);
    console.log(`🆔 ID: ${message.id.id}`);
    console.log(`👤 FROM: ${from}`);
    console.log(`🕒 ${new Date().toISOString()}`);
    console.log('====================================');

    console.log({
        type: message.type,
        body: message.body,
        hasMedia: message.hasMedia,
        from
    });

    
    // Verifica se quer sair
    if (body.toUpperCase() === 'SAIR') {
        // Limpa o timeout antes de fechar
        if (expirationTimeouts.has(from)) {
            clearTimeout(expirationTimeouts.get(from));
            expirationTimeouts.delete(from);
        }
        
        try {
            await fecharSessao(from);
            console.log(`   ✅ Navegador VITAE fechado para SAIR: ${from}`);
        } catch (error) {
            console.log(`   ⚠️ Erro ao fechar navegador: ${error.message}`);
        }
        delete sessions[from];
        await client.sendMessage(from, '❌ *Atendimento cancelado.*\n\nDigite *MENU* para recomeçar.');
        return;
    }
    
    // Verifica se digitou MENU
    if (body.toUpperCase() === 'MENU') {
        // Limpa o timeout antes de fechar
        if (expirationTimeouts.has(from)) {
            clearTimeout(expirationTimeouts.get(from));
            expirationTimeouts.delete(from);
        }
        
        try {
            await fecharSessao(from);
            console.log(`   ✅ Navegador VITAE fechado para MENU: ${from}`);
        } catch (error) {
            console.log(`   ⚠️ Erro ao fechar navegador: ${error.message}`);
        }
        
        delete sessions[from];
        
        sessions[from] = { 
            step: 0, 
            data: {},
            ultimaAtividade: Date.now()
        };
        
        // 🔥 CRIA NOVO TIMEOUT PARA A NOVA SESSÃO
        resetarTimeoutExpiracao(from);
        console.log(`📤 ENVIANDO MENU PARA ${from}`);
        await client.sendMessage(from, 
            `🔄 *Voltando ao menu principal...*\n\n` +
            `🤖 *HELPZIN - Menu Principal*\n\n` +
            '1️⃣ *GLPI (Usuário Windows)* - Alterar Senha \n' +
            '2️⃣ *CONECTA* - Alterar Senha \n' +
            '3️⃣ *VITAE* - Alterar Email \n\n' +
            'Digite o número da opção:'
        );
        return;
    }
    
    // Cria sessão se não existir
    if (!sessions[from]) {
        console.log(`🆕 CRIANDO SESSÃO PARA ${from}`);
        sessions[from] = { 
            step: 0, 
            data: {},
            ultimaAtividade: Date.now()
        };
        // 🔥 CRIA TIMEOUT PARA A NOVA SESSÃO
        resetarTimeoutExpiracao(from);
    }
    console.log(`📊 STEP ATUAL: ${sessions[from].step}`);
    // Atualiza atividade (já reseta o timeout internamente)
    atualizarAtividade(from);
    
    const session = sessions[from];
    
    try {
        // ==================== FLUXO NTI ADMIN (menu oculto @nti) ====================
        if (session.step === 'NTI_MENU_PRINCIPAL') {
            if (body === '1') {
                await client.sendMessage(from,
                    `🔄 *TRANSFERÊNCIA DE USUÁRIOS*\n\n` +
                    `Escolha o Tipo de Consulta do Usuário:\n\n` +
                    `1 - Login\n` +
                    `2 - Nome Completo\n` +
                    `3 - CPF\n\n` +
                    `Digite o número da opção:`
                );
                session.step = 'NTI_MENU';
            } else if (body === '2') {
                await client.sendMessage(from,
                    `📋 *PLANILHAS*\n\n` +
                    `1 - REDE COM FIO\n` +
                    `2 - REDE SEM FIO\n` +
                    `3 - MODELO IMPRESSORA\n` +
                    `4 - SOBREAVISO\n\n` +
                    `Digite o número da opção:`
                );
                session.step = 'NTI_MENU_PLANILHAS';
            } else if (body === '3') {
                await client.sendMessage(from,
                    `📡 *PING*\n\n` +
                    `Digite o IP (formato XXX.XXX.XXX.XXX):`
                );
                session.step = 'NTI_PING_IP';
            } else {
                await client.sendMessage(from,
                    `🔐 *HELPZIN ADMIN*\n\n` +
                    `1 - TRANSFERÊNCIA DE USUÁRIOS\n` +
                    `2 - PLANILHAS\n` +
                    `3 - PING\n\n` +
                    `Digite o número da opção:`
                );
            }
            return;
        }

        if (session.step === 'NTI_MENU_PLANILHAS') {
            if (body === '1') {
                await client.sendMessage(from,
                    `🔎 *REDE COM FIO*\n\n` +
                    `Digite o nome do equipamento, ou setor:`
                );
                session.step = 'NTI_BUSCAR_IP';
            } else if (body === '2') {
                await client.sendMessage(from,
                    `🔎 *REDE SEM FIO*\n\n` +
                    `Digite o nome ou o MAC do dispositivo:`
                );
                session.step = 'NTI_BUSCAR_WIFI';
            } else if (body === '3') {
                await client.sendMessage(from,
                    `🔎 *MODELO IMPRESSORA*\n\n` +
                    `Digite o setor:`
                );
                session.step = 'NTI_BUSCAR_IMPRESSORA';
            } else if (body === '4') {
                // Diferente das outras 3 opções, SOBREAVISO não pede termo de busca - a resposta
                // é sempre "quem está de sobreaviso hoje", então já dispara a consulta aqui e
                // permanece no mesmo step (permite digitar 4 de novo pra atualizar).
                await client.sendMessage(from, `🔍 *Consultando escala de sobreaviso...* Aguarde.`);

                const resultado = await inventarioRede.buscarSobreaviso();

                if (resultado === null) {
                    await client.sendMessage(from,
                        `❌ *Busca indisponível no momento.*\n\n` +
                        `Verifique se a planilha SOBREAVISO está configurada (GOOGLE_SHEETS_ID_SOBREAVISO/GOOGLE_SERVICE_ACCOUNT_KEY_PATH no .env) ou tente novamente mais tarde.\n\n` +
                        `Digite *@nti* para voltar ao menu.`
                    );
                } else if (resultado.abaNaoEncontrada) {
                    await client.sendMessage(from,
                        `❌ *Escala de ${resultado.mesEsperado} ainda não disponível.*\n\n` +
                        `A planilha desse mês ainda não foi criada/preenchida.\n\n` +
                        `Digite *@nti* para voltar ao menu.`
                    );
                } else if (resultado.pessoas.length === 0) {
                    const dataFmt = resultado.data.toLocaleDateString('pt-BR');
                    await client.sendMessage(from,
                        `❌ *Ninguém escalado de sobreaviso hoje (${dataFmt}).*\n\n` +
                        `Digite *@nti* para voltar ao menu.`
                    );
                } else {
                    const dataFmt = resultado.data.toLocaleDateString('pt-BR');
                    let msg = `🚨 *SOBREAVISO de hoje (${dataFmt}):*\n\n`;
                    resultado.pessoas.forEach((p, i) => {
                        msg += `*${i + 1}.* 👤 *${p.nome}*\n` +
                            `   Setor: ${p.setor} - ${p.funcao}\n` +
                            `   Turno: ${p.turno}\n\n`;
                    });
                    msg += `Digite *4* de novo para atualizar, ou *@nti* para voltar ao menu.`;
                    await client.sendMessage(from, msg);
                }
            } else {
                await client.sendMessage(from,
                    `📋 *PLANILHAS*\n\n` +
                    `1 - REDE COM FIO\n` +
                    `2 - REDE SEM FIO\n` +
                    `3 - MODELO IMPRESSORA\n` +
                    `4 - SOBREAVISO\n\n` +
                    `Digite o número da opção:`
                );
            }
            return;
        }

        if (session.step === 'NTI_BUSCAR_WIFI') {
            const termo = body.trim();

            await client.sendMessage(from, `🔍 *Buscando na planilha...* Aguarde.`);

            const resultados = await inventarioRede.buscarRedeSemFio(termo);

            if (resultados === null) {
                await client.sendMessage(from,
                    `❌ *Busca indisponível no momento.*\n\n` +
                    `Verifique se a planilha REDE SEM FIO está configurada (GOOGLE_SHEETS_ID_WIFI/GOOGLE_SERVICE_ACCOUNT_KEY_PATH no .env) ou tente novamente mais tarde.\n\n` +
                    `Digite *@nti* para voltar ao menu.`
                );
            } else if (resultados.length === 0) {
                await client.sendMessage(from,
                    `❌ *Nada encontrado para "${termo}".*\n\n` +
                    `Tente com outro termo (nome ou MAC do dispositivo).\n\n` +
                    `Digite outro termo, ou *@nti* para voltar ao menu.`
                );
            } else {
                let msg = `📋 *${resultados.length} resultado(s) para "${termo}":*\n\n`;
                resultados.forEach((r, i) => {
                    msg += `*${i + 1}.* 📶 *${r.nome || '(sem nome cadastrado)'}*\n` +
                        `   MAC: ${r.mac || '-'}\n\n`;
                });
                msg += `Digite outro termo para nova busca, ou *@nti* para voltar ao menu.`;
                await client.sendMessage(from, msg);
            }
            return;
        }

        if (session.step === 'NTI_BUSCAR_IMPRESSORA') {
            const termo = body.trim();

            await client.sendMessage(from, `🔍 *Buscando na planilha...* Aguarde.`);

            const resultados = await inventarioRede.buscarModeloImpressora(termo);

            if (resultados === null) {
                await client.sendMessage(from,
                    `❌ *Busca indisponível no momento.*\n\n` +
                    `Verifique se a planilha MODELO IMPRESSORA está configurada (GOOGLE_SHEETS_ID_IMPRESSORA/GOOGLE_SERVICE_ACCOUNT_KEY_PATH no .env) ou tente novamente mais tarde.\n\n` +
                    `Digite *@nti* para voltar ao menu.`
                );
            } else if (resultados.abaNaoEncontrada) {
                await client.sendMessage(from,
                    `❌ *Dados de ${resultados.mesEsperado} ainda não disponíveis.*\n\n` +
                    `A planilha desse mês ainda não foi criada/preenchida.\n\n` +
                    `Digite *@nti* para voltar ao menu.`
                );
            } else if (resultados.length === 0) {
                await client.sendMessage(from,
                    `❌ *Nada encontrado para "${termo}".*\n\n` +
                    `Tente com outro termo (nome do setor).\n\n` +
                    `Digite outro termo, ou *@nti* para voltar ao menu.`
                );
            } else {
                let msg = `📋 *${resultados.length} resultado(s) para "${termo}":*\n\n`;
                if (resultados.abaDesatualizada) {
                    msg += `⚠️ _Aba do mês atual ainda não disponível - mostrando dados de ${resultados.abaUsada}._\n\n`;
                }
                resultados.forEach((r, i) => {
                    msg += `*${i + 1}.* 🖨️ *${r.setor}*\n` +
                        `   Equip.: ${r.equip || '-'}\n` +
                        `   Série: ${r.serie || '-'}\n` +
                        `   Cont. atual: ${r.contAtual || '-'}\n` +
                        `   Mod. toner: ${r.modToner || '-'}\n\n`;
                });
                msg += `Digite outro termo para nova busca, ou *@nti* para voltar ao menu.`;
                await client.sendMessage(from, msg);
            }
            return;
        }

        if (session.step === 'NTI_PING_IP') {
            const ip = body.trim();

            await client.sendMessage(from, `📡 *Pingando ${ip}...* Aguarde.`);

            const resultado = await pingIP(ip);

            if (!resultado.ok) {
                await client.sendMessage(from,
                    `❌ *${resultado.erro}*\n\n` +
                    `Digite outro IP, ou *@nti* para voltar ao menu.`
                );
            } else {
                await client.sendMessage(from,
                    `📡 *Resultado do ping para ${ip}:*\n\n` +
                    '```' + resultado.saida + '```' + '\n\n' +
                    `Digite outro IP, ou *@nti* para voltar ao menu.`
                );
            }
            return;
        }

        if (session.step === 'NTI_BUSCAR_IP') {
            // Se o usuário digitar "PING" (com resultado único) ou "PING <número>", faz o ping
            // de um dos resultados da última busca guardada na sessão, sem precisar sair pra
            // opção 3 do menu separadamente.
            const comandoPing = body.trim().match(/^PING(?:\s+(\d+))?$/i);
            if (comandoPing) {
                const ultimaBusca = session.data.ultimaBuscaIP || [];
                const indice = comandoPing[1] ? parseInt(comandoPing[1], 10) - 1 : 0;
                const alvo = ultimaBusca[indice];

                if (!alvo) {
                    await client.sendMessage(from,
                        `❌ *Resultado não encontrado.* Faça uma busca antes, ou use *PING <número>* válido da lista.`
                    );
                    return;
                }

                await client.sendMessage(from, `📡 *Pingando ${alvo.ip} (${alvo.sala || alvo.equipamento})...* Aguarde.`);

                const resultado = await pingIP(alvo.ip);

                if (!resultado.ok) {
                    await client.sendMessage(from,
                        `❌ *${resultado.erro}*\n\n` +
                        `Digite outro termo para buscar, ou *@nti* para voltar ao menu.`
                    );
                } else {
                    await client.sendMessage(from,
                        `📡 *Resultado do ping para ${alvo.ip}:*\n\n` +
                        '```' + resultado.saida + '```' + '\n\n' +
                        `Digite outro termo para buscar, ou *@nti* para voltar ao menu.`
                    );
                }
                return;
            }

            const termo = body.trim();

            await client.sendMessage(from, `🔍 *Buscando na planilha...* Aguarde.`);

            const resultados = await inventarioRede.buscarEquipamento(termo);
            session.data.ultimaBuscaIP = resultados || [];

            if (resultados === null) {
                await client.sendMessage(from,
                    `❌ *Busca indisponível no momento.*\n\n` +
                    `Verifique se a planilha está configurada (GOOGLE_SHEETS_ID/GOOGLE_SERVICE_ACCOUNT_KEY_PATH no .env) ou tente novamente mais tarde.\n\n` +
                    `Digite *@nti* para voltar ao menu.`
                );
            } else if (resultados.length === 0) {
                await client.sendMessage(from,
                    `❌ *Nada encontrado para "${termo}".*\n\n` +
                    `Tente com outro termo (ex: só o nome da sala, ou só "impressora").\n\n` +
                    `Digite outro termo, ou *@nti* para voltar ao menu.`
                );
            } else {
                let msg = `📋 *${resultados.length} resultado(s) para "${termo}":*\n\n`;
                resultados.forEach((r, i) => {
                    msg += `*${i + 1}.* 📍 *${r.sala || '(sem sala cadastrada)'}*\n` +
                        `   Equipamento: ${r.equipamento || '-'}\n` +
                        `   IP: ${r.ip}` +
                        `${r.status ? `\n   Status: ${r.status}` : ''}\n\n`;
                });
                msg += resultados.length === 1
                    ? `Digite *PING* para testar a conectividade desse IP, outro termo para nova busca, ou *@nti* para voltar ao menu.`
                    : `Digite *PING <número>* para testar a conectividade de um resultado (ex: PING 1), outro termo para nova busca, ou *@nti* para voltar ao menu.`;
                await client.sendMessage(from, msg);
            }
            return;
        }

        if (session.step === 'NTI_MENU') {
            if (body === '1') {
                session.data.tipoBusca = 'login';
                await client.sendMessage(from, `Digite o *LOGIN*:`);
                session.step = 'NTI_AGUARDA_VALOR';
            } else if (body === '2') {
                session.data.tipoBusca = 'nome';
                await client.sendMessage(from, `Digite o *NOME COMPLETO*:`);
                session.step = 'NTI_AGUARDA_VALOR';
            } else if (body === '3') {
                session.data.tipoBusca = 'cpf';
                await client.sendMessage(from, `Digite o *CPF* (apenas números):`);
                session.step = 'NTI_AGUARDA_VALOR';
            } else {
                await client.sendMessage(from,
                    `🔄 *TRANSFERÊNCIA DE USUÁRIOS*\n\n` +
                    `Escolha o Tipo de Consulta do Usuário:\n\n` +
                    `1 - Login\n` +
                    `2 - Nome Completo\n` +
                    `3 - CPF\n\n` +
                    `Digite o número da opção:`
                );
            }
            return;
        }

        if (session.step === 'NTI_AGUARDA_VALOR') {
            const tipoBusca = session.data.tipoBusca;
            let valor = body.trim();

            if (tipoBusca === 'cpf') {
                valor = valor.replace(/\D/g, '');
                if (valor.length !== 11) {
                    await client.sendMessage(from,
                        `❌ *CPF INVÁLIDO*\n\nDigite um CPF válido com 11 dígitos:`
                    );
                    return;
                }
            }

            await client.sendMessage(from, `🔍 *Buscando usuário...* Aguarde um momento.`);

            const iniciado = await iniciarNavegador(from);
            if (!iniciado) {
                await client.sendMessage(from,
                    `❌ *Erro ao iniciar sistema VITAE*\n\nTente novamente mais tarde.`
                );
                delete sessions[from];
                return;
            }

            // 🔥 CHAMA A BUSCA COM CAPTURA DE ESPECIALIDADE (true)
            const resultado = await buscarUsuarioVitae(from, valor, tipoBusca, true);

            const nome = resultado.nome_completo || resultado.nome;
            const login = resultado.login_atual || resultado.login;
            const unidade = resultado.unidade_atual || resultado.unidade;

            if (!resultado.encontrado && resultado.caso !== 2) {
                await client.sendMessage(from, `❌ ${resultado.erro || 'Usuário não encontrado.'}`);
                await fecharSessao(from);
                delete sessions[from];
                return;
            }

            // 🔥 MONTA A MENSAGEM COM ESPECIALIDADE (se disponível)
            // 🔥 MONTA A MENSAGEM COM ESPECIALIDADES (se disponível)
            let msgEspecialidade = '';
            if (resultado.dados_especialidade && resultado.dados_especialidade.length > 0) {
                const lista = resultado.dados_especialidade.map(esp => 
                    `${esp.especialidade} (Ambulatório: ${esp.atendeAmbulatorio}, Ativo: ${esp.ativo})`
                ).join('\n   • ');
                
                msgEspecialidade = `\n📋 *Especialidades:*\n   • ${lista}`;
            }

            const jaNoHRN = (unidade || '').trim().toUpperCase() === 'HOSPITAL REGIONAL NORTE';

            // Mantém a sessão do VITAE aberta em ambos os casos abaixo: tanto a transferência
            // quanto adicionar/excluir especialidade reaproveitam essa mesma sessão/página.
            session.data.valor = valor;
            session.data.nomeEncontrado = nome;
            session.data.especialidadesAtuais = resultado.dados_especialidade;

            if (jaNoHRN) {
                const grupos = await capturarGruposUsuario(obterSessao(from)?.page);
                let msgGrupos = '';
                if (grupos && grupos.length > 0) {
                    msgGrupos = `\n👥 *Grupos:*\n   • ${grupos.join('\n   • ')}`;
                }

                await client.sendMessage(from,
                    `✅ *Usuário encontrado*\n\n` +
                    `👤 Nome: ${nome || 'Não informado'}\n` +
                    `🔑 Login: ${login || 'Não informado'}\n` +
                    `🏥 Unidade: ${unidade}\n\n` +  // ← \n\n depois da unidade
                    (msgEspecialidade ? msgEspecialidade + '\n\n' : '') +  // ← \n\n depois da especialidade (se existir)
                    (msgGrupos ? msgGrupos + '\n\n' : '') +  // ← \n\n depois dos grupos (se existir)
                    `⚠️ Usuário já está no *HOSPITAL REGIONAL NORTE*. Nenhuma transferência necessária.\n\n` +
                    `❓ O que deseja fazer?\n\n` +
                    `1 - Adicionar Especialidade\n` +
                    `2 - Excluir Especialidade\n` +
                    `3 - Sair`
                );
                session.step = 'NTI_AGUARDA_ESPECIALIDADE';
                return;
            }

            await client.sendMessage(from,
                `✅ *Usuário encontrado*\n\n` +
                `👤 Nome: ${nome || 'Não informado'}\n` +
                `🔑 Login: ${login || 'Não informado'}\n` +
                `🏥 Unidade atual: ${unidade || 'Não informada'}` +
                msgEspecialidade +
                `\n\nDeseja transferir para o *HOSPITAL REGIONAL NORTE*?\n\n` +
                `1 - SIM\n2 - NAO`
            );
            session.step = 'NTI_CONFIRMA_TRANSFERENCIA';
            return;
        }

        if (session.step === 'NTI_CONFIRMA_TRANSFERENCIA') {
            if (body === '1') {
                await client.sendMessage(from, `⏳ *Transferindo usuário...* Isso pode levar um minuto.`);

                const valorBusca = session.data.valor;
                const tipoBusca = session.data.tipoBusca;
                const nomeEncontrado = session.data.nomeEncontrado;

                const resultado = await transferirUnidadeUsuario(from, valorBusca, tipoBusca);

                if (resultado.sucesso) {
                    if (resultado.jaEstavaNaUnidade) {
                        await client.sendMessage(from,
                            `⚠️ *${resultado.nome_completo || nomeEncontrado}* já está no *HOSPITAL REGIONAL NORTE*. Nenhuma transferência necessária.`
                        );
                        await fecharSessao(from);
                        delete sessions[from];
                        return;
                    } else {
                        // 🔥 NÃO FECHA A SESSÃO AQUI
                        // Reabre a sessão se necessário (já deve estar aberta)
                        let page = obterSessao(from)?.page;
                        if (!page) {
                            // Se a sessão foi fechada, reabre
                            const iniciado = await iniciarNavegador(from);
                            if (!iniciado) {
                                await client.sendMessage(from, `❌ *Erro ao reabrir sessão.*`);
                                delete sessions[from];
                                return;
                            }
                            page = obterSessao(from)?.page;
                        }

                        // Busca os dados atualizados
                        const dadosAtualizados = await buscarUsuarioVitae(from, valorBusca, tipoBusca, true);
                        
                        let msgEspecialidade = '';
                        if (dadosAtualizados.dados_especialidade && dadosAtualizados.dados_especialidade.length > 0) {
                            const lista = dadosAtualizados.dados_especialidade.map(esp =>
                                `${esp.especialidade} (Ambulatório: ${esp.atendeAmbulatorio}, Ativo: ${esp.ativo})`
                            ).join('\n   • ');
                            msgEspecialidade = `\n📋 *Especialidades:*\n   • ${lista}`;
                        }

                        const grupos = await capturarGruposUsuario(page);
                        let msgGrupos = '';
                        if (grupos && grupos.length > 0) {
                            msgGrupos = `\n👥 *Grupos:*\n   • ${grupos.join('\n   • ')}`;
                        }

                        await client.sendMessage(from,
                            `✅ *Transferência concluída!*\n\n` +
                            `👤 Usuário: ${resultado.usuario || nomeEncontrado}\n` +
                            `🔑 Login: ${resultado.login || 'Não informado'}\n` +
                            `🏥 De: ${resultado.unidade_origem || 'Não informada'}\n` +
                            `🏥 Para: ${resultado.unidade_destino || 'HOSPITAL REGIONAL NORTE'}\n\n` +  // ← \n\n depois do Para
                            (msgEspecialidade ? msgEspecialidade + '\n\n' : '') +  // ← \n\n depois da especialidade
                            (msgGrupos ? msgGrupos + '\n\n' : '') +  // ← \n\n depois dos grupos
                            `❓ O que deseja fazer?\n\n` +
                            `1 - Adicionar Especialidade\n` +
                            `2 - Excluir Especialidade\n` +
                            `3 - Sair`
                        );

                        session.data.aguardandoEspecialidade = true;
                        session.data.loginParaEspecialidade = resultado.login;
                        session.data.nomeParaEspecialidade = resultado.usuario || nomeEncontrado;
                        session.data.especialidadesAtuais = dadosAtualizados.dados_especialidade;
                        session.step = 'NTI_AGUARDA_ESPECIALIDADE';
                        return;
                    }
                } else {
                    await client.sendMessage(from, `❌ *Erro ao transferir:* ${resultado.erro || 'Erro desconhecido.'}`);
                    await fecharSessao(from);
                    delete sessions[from];
                    return;
                }
            } else if (body === '2') {
                await fecharSessao(from);
                await client.sendMessage(from, `❌ *Transferência cancelada.*`);
                delete sessions[from];
                return;
            } else {
                await client.sendMessage(from, `Digite *1* para SIM ou *2* para NAO.`);
                return;
            }

            // 🔥 REMOVA O FECHAMENTO DA SESSÃO AQUI
            // await fecharSessao(from);
            // delete sessions[from];
            // return;
        }

        // ==================== FLUXO ADICIONAR/EXCLUIR ESPECIALIDADE ====================
        if (session.step === 'NTI_AGUARDA_ESPECIALIDADE') {
            if (body === '1') {
                await mostrarMenuAdicionarEspecialidade(from, session);
                return;
            } else if (body === '2') {
                await mostrarMenuExcluirEspecialidade(from, session);
                return;
            } else if (body === '3') {
                await fecharSessao(from);
                await client.sendMessage(from, `✅ *Operação finalizada.*`);
                delete sessions[from];
                return;
            } else {
                await client.sendMessage(from, `Digite *1* para adicionar, *2* para excluir ou *3* para sair.`);
                return;
            }
        }

            if (session.step === 'NTI_ESCOLHER_ESPECIALIDADE') {
                const opcao = parseInt(body);
                const lista = session.data.listaEspecialidades;
                
                if (isNaN(opcao) || opcao < 1 || opcao > lista.length) {
                    await client.sendMessage(from,
                        `❌ *Opção inválida!*\n\nDigite um número entre 1 e ${lista.length}:`
                    );
                    return;
                }
                
                const especialidadeEscolhida = lista[opcao - 1];
                session.data.especialidadeEscolhida = especialidadeEscolhida;
                
                await client.sendMessage(from,
                    `✅ *Especialidade selecionada:* ${especialidadeEscolhida.nome}\n\n` +
                    `❓ Esta especialidade *atende Ambulatório?*\n\n` +
                    `1 - SIM\n` +
                    `2 - NAO`
                );
                session.step = 'NTI_AMBULATORIO_ESPECIALIDADE';
                return;
            }

            if (session.step === 'NTI_AMBULATORIO_ESPECIALIDADE') {
                let fazAmbulatorio;
                if (body === '1') {
                    fazAmbulatorio = 'SIM';
                } else if (body === '2') {
                    fazAmbulatorio = 'NÃO';
                } else {
                    await client.sendMessage(from, `❌ Opção inválida. Digite *1* para SIM ou *2* para NÃO.`);
                    return;
                }
                
                session.data.fazAmbulatorio = fazAmbulatorio;
                
                await client.sendMessage(from,
                    `⏳ *Adicionando especialidade...* Aguarde um momento.`
                );
                
                // 🔥 EXECUTA A ADIÇÃO
                const page = obterSessao(from)?.page;
                if (!page) {
                    await client.sendMessage(from, `❌ *Sessão expirada.* Reinicie o processo.`);
                    delete sessions[from];
                    return;
                }
                
                const esp = session.data.especialidadeEscolhida;
                const adicionado = await adicionarEspecialidade(page, esp.valor, fazAmbulatorio);
                
                if (adicionado) {
                    // Salva as alterações
                    const salvo = await salvarAlteracoesEspecialidade(page);
                    
                    if (salvo) {
                        await client.sendMessage(from,
                            `✅ *Especialidade adicionada com sucesso!*\n\n` +
                            `📋 *Especialidade:* ${esp.nome}\n` +
                            `🩺 *Atende Ambulatório:* ${fazAmbulatorio}\n` +
                            `✅ *Status:* ATIVO\n\n` +
                            `Digite *@nti* para uma nova operação.`
                        );
                    } else {
                        await client.sendMessage(from,
                            `⚠️ *Especialidade adicionada, mas pode não ter sido salva.*\n\n` +
                            `Verifique manualmente no sistema.`
                        );
                    }
                } else {
                    await client.sendMessage(from,
                        `❌ *Erro ao adicionar especialidade.*\n\nTente novamente ou faça manualmente.`
                    );
                }
                
                await fecharSessao(from);
                delete sessions[from];
                return;
            }

            if (session.step === 'NTI_ESCOLHER_ESPECIALIDADE_EXCLUIR') {
                const opcao = parseInt(body);
                const lista = session.data.especialidadesAtuais;

                if (isNaN(opcao) || opcao < 1 || opcao > lista.length) {
                    await client.sendMessage(from,
                        `❌ *Opção inválida!*\n\nDigite um número entre 1 e ${lista.length}:`
                    );
                    return;
                }

                const especialidadeEscolhida = lista[opcao - 1];
                const rowIndex = opcao - 1;

                await client.sendMessage(from, `⏳ *Excluindo especialidade...* Aguarde um momento.`);

                const page = obterSessao(from)?.page;
                if (!page) {
                    await client.sendMessage(from, `❌ *Sessão expirada.* Reinicie o processo.`);
                    delete sessions[from];
                    return;
                }

                const excluido = await excluirEspecialidade(page, rowIndex);

                if (excluido) {
                    const salvo = await salvarAlteracoesEspecialidade(page);

                    if (salvo) {
                        await client.sendMessage(from,
                            `✅ *Especialidade excluída com sucesso!*\n\n` +
                            `📋 *Especialidade:* ${especialidadeEscolhida.especialidade}\n\n` +
                            `Digite *@nti* para uma nova operação.`
                        );
                    } else {
                        await client.sendMessage(from,
                            `⚠️ *Especialidade removida da tela, mas pode não ter sido salva.*\n\n` +
                            `Verifique manualmente no sistema.`
                        );
                    }
                } else {
                    await client.sendMessage(from,
                        `❌ *Erro ao excluir especialidade.*\n\nTente novamente ou faça manualmente.`
                    );
                }

                await fecharSessao(from);
                delete sessions[from];
                return;
            }

        // ==================== FLUXO NAC ADMIN (menu oculto @nac, isolado do @nti) ====================
        if (session.step === 'NAC_MENU_PRINCIPAL') {
            if (body === '1') {
                await client.sendMessage(from,
                    `🔄 *TRANSFERÊNCIA DE USUÁRIOS*\n\n` +
                    `Escolha o Tipo de Consulta do Usuário:\n\n` +
                    `1 - Login\n` +
                    `2 - Nome Completo\n` +
                    `3 - CPF\n\n` +
                    `Digite o número da opção:`
                );
                session.step = 'NAC_MENU';
            } else {
                await client.sendMessage(from,
                    `🔐 *HELPZIN NAC*\n\n` +
                    `1 - TRANSFERÊNCIA DE USUÁRIOS\n\n` +
                    `Digite o número da opção:`
                );
            }
            return;
        }

        if (session.step === 'NAC_MENU') {
            if (body === '1') {
                session.data.tipoBusca = 'login';
                await client.sendMessage(from, `Digite o *LOGIN*:`);
                session.step = 'NAC_AGUARDA_VALOR';
            } else if (body === '2') {
                session.data.tipoBusca = 'nome';
                await client.sendMessage(from, `Digite o *NOME COMPLETO*:`);
                session.step = 'NAC_AGUARDA_VALOR';
            } else if (body === '3') {
                session.data.tipoBusca = 'cpf';
                await client.sendMessage(from, `Digite o *CPF* (apenas números):`);
                session.step = 'NAC_AGUARDA_VALOR';
            } else {
                await client.sendMessage(from,
                    `🔄 *TRANSFERÊNCIA DE USUÁRIOS*\n\n` +
                    `Escolha o Tipo de Consulta do Usuário:\n\n` +
                    `1 - Login\n` +
                    `2 - Nome Completo\n` +
                    `3 - CPF\n\n` +
                    `Digite o número da opção:`
                );
            }
            return;
        }

        if (session.step === 'NAC_AGUARDA_VALOR') {
            const tipoBusca = session.data.tipoBusca;
            let valor = body.trim();

            if (tipoBusca === 'cpf') {
                valor = valor.replace(/\D/g, '');
                if (valor.length !== 11) {
                    await client.sendMessage(from,
                        `❌ *CPF INVÁLIDO*\n\nDigite um CPF válido com 11 dígitos:`
                    );
                    return;
                }
            }

            await client.sendMessage(from, `🔍 *Buscando usuário...* Aguarde um momento.`);

            const iniciado = await iniciarNavegador(from);
            if (!iniciado) {
                await client.sendMessage(from,
                    `❌ *Erro ao iniciar sistema VITAE*\n\nTente novamente mais tarde.`
                );
                delete sessions[from];
                return;
            }

            // 🔥 CHAMA A BUSCA COM CAPTURA DE ESPECIALIDADE (true)
            const resultado = await buscarUsuarioVitae(from, valor, tipoBusca, true);

            const nome = resultado.nome_completo || resultado.nome;
            const login = resultado.login_atual || resultado.login;
            const unidade = resultado.unidade_atual || resultado.unidade;

            if (!resultado.encontrado && resultado.caso !== 2) {
                await client.sendMessage(from, `❌ ${resultado.erro || 'Usuário não encontrado.'}`);
                await fecharSessao(from);
                delete sessions[from];
                return;
            }

            // 🔥 MONTA A MENSAGEM COM ESPECIALIDADES (se disponível)
            let msgEspecialidade = '';
            if (resultado.dados_especialidade && resultado.dados_especialidade.length > 0) {
                const lista = resultado.dados_especialidade.map(esp =>
                    `${esp.especialidade} (Ambulatório: ${esp.atendeAmbulatorio}, Ativo: ${esp.ativo})`
                ).join('\n   • ');

                msgEspecialidade = `\n📋 *Especialidades:*\n   • ${lista}`;
            }

            const jaNoHRN = (unidade || '').trim().toUpperCase() === 'HOSPITAL REGIONAL NORTE';

            // Mantém a sessão do VITAE aberta em ambos os casos abaixo: tanto a transferência
            // quanto adicionar/excluir especialidade reaproveitam essa mesma sessão/página.
            session.data.valor = valor;
            session.data.nomeEncontrado = nome;
            session.data.especialidadesAtuais = resultado.dados_especialidade;

            if (jaNoHRN) {
                const grupos = await capturarGruposUsuario(obterSessao(from)?.page);
                let msgGrupos = '';
                if (grupos && grupos.length > 0) {
                    msgGrupos = `\n👥 *Grupos:*\n   • ${grupos.join('\n   • ')}`;
                }

                await client.sendMessage(from,
                    `✅ *Usuário encontrado*\n\n` +
                    `👤 Nome: ${nome || 'Não informado'}\n` +
                    `🔑 Login: ${login || 'Não informado'}\n` +
                    `🏥 Unidade: ${unidade}\n\n` +
                    (msgEspecialidade ? msgEspecialidade + '\n\n' : '') +
                    (msgGrupos ? msgGrupos + '\n\n' : '') +
                    `⚠️ Usuário já está no *HOSPITAL REGIONAL NORTE*. Nenhuma transferência necessária.\n\n` +
                    `❓ O que deseja fazer?\n\n` +
                    `1 - Adicionar Especialidade\n` +
                    `2 - Excluir Especialidade\n` +
                    `3 - Sair`
                );
                session.step = 'NAC_AGUARDA_ESPECIALIDADE';
                return;
            }

            await client.sendMessage(from,
                `✅ *Usuário encontrado*\n\n` +
                `👤 Nome: ${nome || 'Não informado'}\n` +
                `🔑 Login: ${login || 'Não informado'}\n` +
                `🏥 Unidade atual: ${unidade || 'Não informada'}` +
                msgEspecialidade +
                `\n\nDeseja transferir para o *HOSPITAL REGIONAL NORTE*?\n\n` +
                `1 - SIM\n2 - NAO`
            );
            session.step = 'NAC_CONFIRMA_TRANSFERENCIA';
            return;
        }

        if (session.step === 'NAC_CONFIRMA_TRANSFERENCIA') {
            if (body === '1') {
                await client.sendMessage(from, `⏳ *Transferindo usuário...* Isso pode levar um minuto.`);

                const valorBusca = session.data.valor;
                const tipoBusca = session.data.tipoBusca;
                const nomeEncontrado = session.data.nomeEncontrado;

                const resultado = await transferirUnidadeUsuario(from, valorBusca, tipoBusca);

                if (resultado.sucesso) {
                    if (resultado.jaEstavaNaUnidade) {
                        await client.sendMessage(from,
                            `⚠️ *${resultado.nome_completo || nomeEncontrado}* já está no *HOSPITAL REGIONAL NORTE*. Nenhuma transferência necessária.`
                        );
                        await fecharSessao(from);
                        delete sessions[from];
                        return;
                    } else {
                        // Reabre a sessão se necessário (já deve estar aberta)
                        let page = obterSessao(from)?.page;
                        if (!page) {
                            const iniciado = await iniciarNavegador(from);
                            if (!iniciado) {
                                await client.sendMessage(from, `❌ *Erro ao reabrir sessão.*`);
                                delete sessions[from];
                                return;
                            }
                            page = obterSessao(from)?.page;
                        }

                        // Busca os dados atualizados
                        const dadosAtualizados = await buscarUsuarioVitae(from, valorBusca, tipoBusca, true);

                        let msgEspecialidade = '';
                        if (dadosAtualizados.dados_especialidade && dadosAtualizados.dados_especialidade.length > 0) {
                            const lista = dadosAtualizados.dados_especialidade.map(esp =>
                                `${esp.especialidade} (Ambulatório: ${esp.atendeAmbulatorio}, Ativo: ${esp.ativo})`
                            ).join('\n   • ');
                            msgEspecialidade = `\n📋 *Especialidades:*\n   • ${lista}`;
                        }

                        const grupos = await capturarGruposUsuario(page);
                        let msgGrupos = '';
                        if (grupos && grupos.length > 0) {
                            msgGrupos = `\n👥 *Grupos:*\n   • ${grupos.join('\n   • ')}`;
                        }

                        await client.sendMessage(from,
                            `✅ *Transferência concluída!*\n\n` +
                            `👤 Usuário: ${resultado.usuario || nomeEncontrado}\n` +
                            `🔑 Login: ${resultado.login || 'Não informado'}\n` +
                            `🏥 De: ${resultado.unidade_origem || 'Não informada'}\n` +
                            `🏥 Para: ${resultado.unidade_destino || 'HOSPITAL REGIONAL NORTE'}\n\n` +
                            (msgEspecialidade ? msgEspecialidade + '\n\n' : '') +
                            (msgGrupos ? msgGrupos + '\n\n' : '') +
                            `❓ O que deseja fazer?\n\n` +
                            `1 - Adicionar Especialidade\n` +
                            `2 - Excluir Especialidade\n` +
                            `3 - Sair`
                        );

                        session.data.aguardandoEspecialidade = true;
                        session.data.loginParaEspecialidade = resultado.login;
                        session.data.nomeParaEspecialidade = resultado.usuario || nomeEncontrado;
                        session.data.especialidadesAtuais = dadosAtualizados.dados_especialidade;
                        session.step = 'NAC_AGUARDA_ESPECIALIDADE';
                        return;
                    }
                } else {
                    await client.sendMessage(from, `❌ *Erro ao transferir:* ${resultado.erro || 'Erro desconhecido.'}`);
                    await fecharSessao(from);
                    delete sessions[from];
                    return;
                }
            } else if (body === '2') {
                await fecharSessao(from);
                await client.sendMessage(from, `❌ *Transferência cancelada.*`);
                delete sessions[from];
                return;
            } else {
                await client.sendMessage(from, `Digite *1* para SIM ou *2* para NAO.`);
                return;
            }
        }

        // ==================== FLUXO ADICIONAR/EXCLUIR ESPECIALIDADE (NAC) ====================
        if (session.step === 'NAC_AGUARDA_ESPECIALIDADE') {
            if (body === '1') {
                await mostrarMenuAdicionarEspecialidadeNac(from, session);
                return;
            } else if (body === '2') {
                await mostrarMenuExcluirEspecialidadeNac(from, session);
                return;
            } else if (body === '3') {
                await fecharSessao(from);
                await client.sendMessage(from, `✅ *Operação finalizada.*`);
                delete sessions[from];
                return;
            } else {
                await client.sendMessage(from, `Digite *1* para adicionar, *2* para excluir ou *3* para sair.`);
                return;
            }
        }

        if (session.step === 'NAC_ESCOLHER_ESPECIALIDADE') {
            const opcao = parseInt(body);
            const lista = session.data.listaEspecialidades;

            if (isNaN(opcao) || opcao < 1 || opcao > lista.length) {
                await client.sendMessage(from,
                    `❌ *Opção inválida!*\n\nDigite um número entre 1 e ${lista.length}:`
                );
                return;
            }

            const especialidadeEscolhida = lista[opcao - 1];
            session.data.especialidadeEscolhida = especialidadeEscolhida;

            await client.sendMessage(from,
                `✅ *Especialidade selecionada:* ${especialidadeEscolhida.nome}\n\n` +
                `❓ Esta especialidade *atende Ambulatório?*\n\n` +
                `1 - SIM\n` +
                `2 - NAO`
            );
            session.step = 'NAC_AMBULATORIO_ESPECIALIDADE';
            return;
        }

        if (session.step === 'NAC_AMBULATORIO_ESPECIALIDADE') {
            let fazAmbulatorio;
            if (body === '1') {
                fazAmbulatorio = 'SIM';
            } else if (body === '2') {
                fazAmbulatorio = 'NÃO';
            } else {
                await client.sendMessage(from, `❌ Opção inválida. Digite *1* para SIM ou *2* para NÃO.`);
                return;
            }

            session.data.fazAmbulatorio = fazAmbulatorio;

            await client.sendMessage(from,
                `⏳ *Adicionando especialidade...* Aguarde um momento.`
            );

            // 🔥 EXECUTA A ADIÇÃO
            const page = obterSessao(from)?.page;
            if (!page) {
                await client.sendMessage(from, `❌ *Sessão expirada.* Reinicie o processo.`);
                delete sessions[from];
                return;
            }

            const esp = session.data.especialidadeEscolhida;
            const adicionado = await adicionarEspecialidade(page, esp.valor, fazAmbulatorio);

            if (adicionado) {
                const salvo = await salvarAlteracoesEspecialidade(page);

                if (salvo) {
                    await client.sendMessage(from,
                        `✅ *Especialidade adicionada com sucesso!*\n\n` +
                        `📋 *Especialidade:* ${esp.nome}\n` +
                        `🩺 *Atende Ambulatório:* ${fazAmbulatorio}\n` +
                        `✅ *Status:* ATIVO\n\n` +
                        `Digite *@nac* para uma nova operação.`
                    );
                } else {
                    await client.sendMessage(from,
                        `⚠️ *Especialidade adicionada, mas pode não ter sido salva.*\n\n` +
                        `Verifique manualmente no sistema.`
                    );
                }
            } else {
                await client.sendMessage(from,
                    `❌ *Erro ao adicionar especialidade.*\n\nTente novamente ou faça manualmente.`
                );
            }

            await fecharSessao(from);
            delete sessions[from];
            return;
        }

        if (session.step === 'NAC_ESCOLHER_ESPECIALIDADE_EXCLUIR') {
            const opcao = parseInt(body);
            const lista = session.data.especialidadesAtuais;

            if (isNaN(opcao) || opcao < 1 || opcao > lista.length) {
                await client.sendMessage(from,
                    `❌ *Opção inválida!*\n\nDigite um número entre 1 e ${lista.length}:`
                );
                return;
            }

            const especialidadeEscolhida = lista[opcao - 1];
            const rowIndex = opcao - 1;

            await client.sendMessage(from, `⏳ *Excluindo especialidade...* Aguarde um momento.`);

            const page = obterSessao(from)?.page;
            if (!page) {
                await client.sendMessage(from, `❌ *Sessão expirada.* Reinicie o processo.`);
                delete sessions[from];
                return;
            }

            const excluido = await excluirEspecialidade(page, rowIndex);

            if (excluido) {
                const salvo = await salvarAlteracoesEspecialidade(page);

                if (salvo) {
                    await client.sendMessage(from,
                        `✅ *Especialidade excluída com sucesso!*\n\n` +
                        `📋 *Especialidade:* ${especialidadeEscolhida.especialidade}\n\n` +
                        `Digite *@nac* para uma nova operação.`
                    );
                } else {
                    await client.sendMessage(from,
                        `⚠️ *Especialidade removida da tela, mas pode não ter sido salva.*\n\n` +
                        `Verifique manualmente no sistema.`
                    );
                }
            } else {
                await client.sendMessage(from,
                    `❌ *Erro ao excluir especialidade.*\n\nTente novamente ou faça manualmente.`
                );
            }

            await fecharSessao(from);
            delete sessions[from];
            return;
        }

        // ==================== STEP 0: MENU PRINCIPAL ====================
        if (session.step === 0) {

            const menuHeader = `🤖 *HELPZIN - Menu Principal*`;
            const menuOpcoes =
                'Bem-Vindo ao Assistente de Sistemas do NTI\n\n' +
                '1️⃣ *GLPI (Usuário Windows)* - Alterar Senha \n' +
                '2️⃣ *CONECTA* - Alterar Senha \n' +
                '3️⃣ *VITAE* - Alterar Email \n\n' +
                'Digite o número da opção:\n\n' +
                '- *MENU* para voltar ao menu principal\n' +
                '- *SAIR* para cancelar atendimento';
            const menuBase = `${menuHeader}\n\n${menuOpcoes}`;

            // 🔥 Saudação simples ("oi", "bom dia"...) não precisa de IA nenhuma - nem pro
            // classificador de intenção, nem pra "humanizar" o texto do menu. Detecta por
            // palavra-chave (sem round-trip ao Gemini, que pode levar de 10 a 20s em timeout/retry
            // - ver ia.js) e manda o menu padrão na hora.
            if (ehSaudacaoSimples(body)) {
                console.log(`👋 Saudação simples de ${from}, enviando menu direto (sem IA)`);
                await client.sendMessage(from, menuBase);
                return;
            }

            // 🔥 PROTÓTIPO DE IA: se a mensagem não for 1/2/3, tenta interpretar a intenção
            // do usuário em texto livre antes de cair no menu padrão. Se a IA estiver
            // desativada, sem chave configurada, ou não conseguir identificar com confiança,
            // isso simplesmente retorna null e o fluxo segue igual ao original.
            let opcaoEfetiva = body;
            let interpretadaPorIA = false;

            if (!['1', '2', '3'].includes(opcaoEfetiva)) {
                const interpretada = await ia.interpretarOpcaoMenu(body);
                // RAMAL só é aceito se o texto realmente citar ramal/telefone - sem essa checagem,
                // a IA às vezes classifica um número solto (ex: "1234", digitado por engano ou
                // tentando adivinhar uma opção) como pedido de ramal sem contexto nenhum.
                if (interpretada === 'RAMAL' && !/\b(ramal|ramais|telefone)\b/i.test(body)) {
                    console.log(`🤖 IA interpretou "${body}" como RAMAL mas sem palavra-chave no texto - ignorando`);
                } else if (interpretada) {
                    console.log(`🤖 IA interpretou "${body}" como ${interpretada}`);
                    // RAMAL não aparece no menu numérico (só é acessível quando o funcionário
                    // menciona em texto livre, ex: "qual o ramal da farmácia") - internamente
                    // reaproveita o código '4' só pra cair no mesmo bloco de tratamento abaixo.
                    opcaoEfetiva = interpretada === 'RAMAL' ? '4' : interpretada;
                    interpretadaPorIA = true;
                }
            }

            if (interpretadaPorIA && ['1', '2', '3', '4'].includes(opcaoEfetiva)) {
                const nomesSistema = { '1': 'GLPI', '2': 'CONECTA', '3': 'VITAE', '4': 'RAMAIS' };
                await client.sendMessage(from, `🤖 Entendi! Vamos te ajudar com o *${nomesSistema[opcaoEfetiva]}*.`);
            }

            // 🔥 Casos de e-mail: não são resolvidos por nenhum dos 3 sistemas do menu. Em vez de
            // mandar um texto pronto, a IA compõe a resposta a partir dos fatos abaixo, reagindo
            // ao que o usuário escreveu - se ela falhar, o textoFallback garante a informação certa.
            if (opcaoEfetiva === 'EMAIL_SENHA') {
                const textoFallback =
                    `📧 *SENHA DE E-MAIL*\n\n` +
                    `O reset de senha do e-mail corporativo não é feito por aqui.\n\n` +
                    `📌 Procure o *NTI presencialmente* ou ligue para o ramal *9385*.\n\n` +
                    `Se precisar de outro atendimento, digite o número de uma das opções do menu ou *SAIR* para encerrar.`;

                const resposta = await ia.responderNatural({
                    evento: 'O usuário perguntou sobre resetar/recuperar a senha do e-mail corporativo. ' +
                        'Isso NÃO é feito por nenhum sistema automatizado deste bot.',
                    fatos: {
                        'o que fazer': 'procurar o NTI presencialmente OU ligar para o ramal 9385',
                        'motivo': 'reset de senha de e-mail não é automatizado, precisa ser feito manualmente pelo NTI',
                        'outros atendimentos disponíveis no bot': 'GLPI (senha do Windows/AD, digite 1), CONECTA (senha do portal RH, digite 2), VITAE (alterar e-mail cadastrado, digite 3)'
                    },
                    mensagemUsuario: body,
                    historico: session.data.historicoIA || [],
                    textoFallback
                });

                registrarHistoricoIA(session, body, resposta);
                await client.sendMessage(from, resposta);
                return;
            }

            if (opcaoEfetiva === 'EMAIL_NOVO') {
                const textoFallback =
                    `📧 *CADASTRO DE NOVO E-MAIL*\n\n` +
                    `Para cadastrar um e-mail novo, a *coordenação do setor* deve abrir um chamado através do *GLPI*.\n\n` +
                    `Se precisar de outro atendimento, digite o número de uma das opções do menu ou *SAIR* para encerrar.`;

                const resposta = await ia.responderNatural({
                    evento: 'O usuário quer cadastrar/criar um e-mail corporativo novo (que ainda não existe). ' +
                        'Isso NÃO é feito por nenhum sistema automatizado deste bot.',
                    fatos: {
                        'o que fazer': 'a coordenação do setor do usuário deve abrir um chamado através do GLPI',
                        'quem faz o pedido': 'não é o próprio usuário quem abre o chamado, é a coordenação do setor dele',
                        'outros atendimentos disponíveis no bot': 'GLPI (senha do Windows/AD, digite 1), CONECTA (senha do portal RH, digite 2), VITAE (alterar e-mail cadastrado, digite 3)'
                    },
                    mensagemUsuario: body,
                    historico: session.data.historicoIA || [],
                    textoFallback
                });

                registrarHistoricoIA(session, body, resposta);
                await client.sendMessage(from, resposta);
                return;
            }

            // 🔥 Dúvidas gerais sobre normas/procedimentos do NTI (Wi-Fi, computador sem rede,
            // impressora, crachá, etc.) - respondidas com base em base_conhecimento_nti.md.
            if (opcaoEfetiva === 'DUVIDA_NTI') {
                const resposta = await ia.responderDuvidaNTI(body, {
                    historico: session.data.historicoIA || []
                });

                registrarHistoricoIA(session, body, resposta);
                // 🔥 Mantém a conversa neste sub-fluxo em vez de voltar pro STEP 0: sem isso, a
                // PRÓXIMA mensagem do usuário (ex: uma resposta de acompanhamento como "sim") caía
                // de novo no classificador de intenção do menu principal, que não reconhece
                // continuações de conversa e resetava o atendimento pro menu.
                session.step = 'STEP_DUVIDA_NTI';
                await client.sendMessage(from, resposta);
                return;
            }

            // 🔥 RAMAIS: diferente de GLPI/CONECTA/VITAE, não é um "sistema" com fluxo de senha -
            // é uma busca determinística (sem IA) na planilha de ramais, aberta a qualquer
            // funcionário (sem allowlist, diferente das outras planilhas do menu oculto @nti/@nac).
            // interpretadaPorIA aqui é obrigatório: '4' não é uma opção literal do menu (só 1/2/3
            // aparecem no texto), então um "4" digitado cru pelo usuário não deve cair em RAMAIS -
            // só chega aqui quando a IA de fato classificou a mensagem como RAMAL (já filtrado
            // acima pela palavra-chave).
            if (opcaoEfetiva === '4' && interpretadaPorIA) {
                await client.sendMessage(from,
                    `☎️ *RAMAIS*\n\n` +
                    `Digite o nome do *setor* (ex: Farmácia, UTI, RH) ou o *número do ramal* que você quer consultar:`
                );
                session.step = 'STEP_RAMAL_BUSCA';
                return;
            }

            if (['1', '2', '3'].includes(opcaoEfetiva)) {
                await iniciarFluxoSistema(from, session, opcaoEfetiva);

            } else {
                console.log(`📤 ENVIANDO MENU (STEP 0) PARA ${from}`);

                // 🔥 PROTÓTIPO DE IA: reescreve o menu de forma mais natural.
                // Se a IA falhar/estiver desativada, envia o texto original (menuBase).
                const menuNatural = await ia.humanizarMensagem(menuBase);
                await client.sendMessage(from, menuNatural);
            }
            return;
        }

        // ==================== STEP_RAMAL_BUSCA: busca de ramal por setor ====================
        // Busca 100% determinística na planilha (sem IA) - mesmo padrão de segurança das buscas do
        // menu oculto @nti/@nac (ver inventarioRede.js): o resultado é sempre uma linha exata da
        // planilha. Fica no mesmo step pra permitir nova busca em seguida, sem voltar ao menu.
        if (session.step === 'STEP_RAMAL_BUSCA') {
            atualizarAtividade(from);
            const termo = body.trim();

            await client.sendMessage(from, `🔍 *Buscando na planilha...* Aguarde.`);

            const resultados = await inventarioRede.buscarRamal(termo);

            if (resultados === null) {
                await client.sendMessage(from,
                    `❌ *Busca indisponível no momento.*\n\n` +
                    `Tente novamente mais tarde ou contate o NTI (ramal 9385).\n\n` +
                    `Digite *MENU* para voltar ao início.`
                );
            } else if (resultados.length === 0) {
                await client.sendMessage(from,
                    `❌ *Nenhum ramal encontrado para "${termo}".*\n\n` +
                    `Tente com outro termo (ex: só o nome do setor).\n\n` +
                    `Digite outro termo, ou *MENU* para voltar ao início.`
                );
            } else {
                let msg = `☎️ *${resultados.length} ramal(is) para "${termo}":*\n\n`;
                resultados.forEach((r, i) => {
                    msg += `*${i + 1}.* 📞 *${r.ramal}* - ${r.setor}` +
                        `${r.localizacao ? `\n   ${r.localizacao}` : ''}` +
                        `${r.sublocalizacao ? ` - ${r.sublocalizacao}` : ''}\n\n`;
                });
                msg += `Digite outro termo para nova busca, ou *MENU* para voltar ao início.`;
                await client.sendMessage(from, msg);
            }
            return;
        }

        // ==================== SUB-FLUXO: DÚVIDA NTI (conversa livre) ====================
        // Mantém o usuário aqui até ele digitar MENU/SAIR (interceptados globalmente antes da
        // lógica de step) - continuações de conversa (ex: respostas de acompanhamento como "sim")
        // são tratadas como parte da mesma dúvida, em vez de caírem no classificador de intenção
        // do STEP 0.
        //
        // Um dígito solto (1/2/3) só é tratado como escolha do Menu Principal se a ÚLTIMA resposta
        // do próprio bot mencionou "opção N" (ex: "...através da opção 1 do Menu Principal") - é o
        // caso de dúvidas tipo "preciso do acesso do GLPI" onde a IA orienta a usar o fluxo fixo, e
        // o usuário naturalmente responde só "1" em vez de digitar MENU primeiro. Sem essa checagem
        // de contexto, esse "1" virava só mais uma mensagem solta pra IA, que tentava "continuar"
        // um procedimento que não existe (ex: pedir nome) em vez de abrir o fluxo fixo de verdade.
        // Uma lista numerada SEM a palavra "opção" (ex: sub-menu de modelo de impressora) não bate
        // nesse regex, então continua sendo tratada como resposta normal da conversa - não hijacka
        // dígitos que respondem outras perguntas da IA.
        if (session.step === 'STEP_DUVIDA_NTI') {
            atualizarAtividade(from);

            if (['1', '2', '3'].includes(body)) {
                const ultimaRespostaBot = [...(session.data.historicoIA || [])].reverse().find(h => h.papel === 'bot')?.texto || '';
                const mencionouOpcao = new RegExp(`op[çc][ãa]o\\s*${body}\\b`, 'i').test(ultimaRespostaBot);

                if (mencionouOpcao) {
                    session.step = 0;
                    await iniciarFluxoSistema(from, session, body);
                    return;
                }
            }

            // 🔥 RAMAL: pergunta sobre ramal/telefone no MEIO da conversa (não só na primeira
            // mensagem, que já passa pelo classificador do STEP 0) também precisa cair na busca -
            // base_conhecimento_nti.md não tem esse dado (vem de planilha), então sem isso a IA de
            // dúvida geral só diria "não encontrei orientação específica". Só chama a IA quando
            // essas palavras aparecem, pra não gastar um round-trip extra em toda mensagem do
            // sub-fluxo.
            if (/\b(ramal|ramais|telefone)\b/i.test(body)) {
                const interpretada = await ia.interpretarOpcaoMenu(body);
                if (interpretada === 'RAMAL') {
                    await client.sendMessage(from,
                        `☎️ *RAMAIS*\n\n` +
                        `Digite o nome do *setor* (ex: Farmácia, UTI, RH) ou o *número do ramal* que você quer consultar:`
                    );
                    session.step = 'STEP_RAMAL_BUSCA';
                    return;
                }
            }

            const resposta = await ia.responderDuvidaNTI(body, {
                historico: session.data.historicoIA || []
            });

            registrarHistoricoIA(session, body, resposta);
            await client.sendMessage(from, resposta);
            return;
        }

        // ==================== FLUXO VITAE ====================

        if (session.step === 'STEP_VITAE_CPF') {
            atualizarAtividade(from);
            
            if (body.toUpperCase() === 'SAIR') {
                await fecharSessao(from);
                delete sessions[from];
                await client.sendMessage(from, '❌ *Operação cancelada.*\n\nDigite *MENU* para recomeçar.');
                return;
            }
            
            const cpf = body.replace(/\D/g, '');
            
            if (cpf.length !== 11) {
                await client.sendMessage(from, 
                    `❌ *CPF INVÁLIDO*\n\n` +
                    `Digite um CPF válido com 11 dígitos:\n\n` +
                    `Digite *SAIR* para cancelar.`
                );
                return;
            }
            
            session.data.cpf = cpf;
            
            await client.sendMessage(from, '⏳ *Buscando informações do usuário...* Aguarde.');
            
            // 🔥 AQUI O MODAL SERÁ ABERTO (dentro do buscarUsuarioVitae)
            const usuario = await buscarUsuarioVitae(from, cpf);
            
            // 🔥 VERIFICA OS CASOS ESPECIAIS
            if (!usuario.encontrado) {
                // Caso 1: Usuário INATIVO (todas as linhas são INATIVO)
                if (usuario.caso === 1) {
                    await client.sendMessage(from,
                        `❌ *USUÁRIO INATIVO*\n\n` +
                        `O Usuário está cadastrado como *INATIVO* no sistema.\n\n` +
                        `📌 *O que fazer?*\n` +
                        `Procure o *NTI presencialmente* para regularizar seu cadastro.\n\n` +
                        `Digite *SAIR* para cancelar ou *1* para tentar outro CPF.`
                    );
                    return;
                }
                
                // 🔥 CASO 2: Usuário ATIVO mas sem botão de editar (não está no HRN)
                if (usuario.caso === 2) {
                    let mensagem = 
                        `❌ *USUÁRIO NÃO CADASTRADO NO HRN*\n\n` +
                        `O Usuário está ativo no sistema, mas você *não está cadastrado* no *Hospital Regional Norte*.\n\n`;
                    
                    // Adiciona nome e unidade se disponíveis
                    if (usuario.nome) {
                        mensagem += `👤 *Nome:* ${usuario.nome}\n`;
                    }
                    
                    if (usuario.unidade) {
                        mensagem += `🏢 *Unidade atual:* ${usuario.unidade}\n`;
                    }
                    
                    mensagem += 
                        `\n📌 *O que fazer?*\n` +
                        `Procure o *NTI presencialmente* para realizar a *transferência de Unidade*.\n\n` +
                        `Digite *SAIR* para cancelar ou *1* para tentar outro CPF.`;
                    
                    await client.sendMessage(from, mensagem);
                    return;
                }
                
                // Caso genérico: CPF não encontrado
                await client.sendMessage(from,
                    `❌ *CPF NÃO ENCONTRADO*\n\n` +
                    `CPF informado: *${cpf}*\n\n` +
                    `Digite *SAIR* para cancelar ou *1* para tentar outro CPF.`
                );
                return;
            }
            
            // Se chegou aqui, é um usuário ATIVO com botão de editar (caso normal)
            session.data.nomeEncontrado = usuario.nome_completo;
            session.data.emailAtual = usuario.email_atual;
            session.data.unidadeAtual = usuario.unidade_atual;
            session.data.loginAtual = usuario.login_atual;
            
            await client.sendMessage(from,
                `🔍 *USUÁRIO ENCONTRADO - VITAE*\n\n` +
                `┌\n` +
                `│ 👤 *Nome:* ${usuario.nome_completo}\n` +
                `│ 📧 *Email atual:* ${usuario.email_atual || 'Não informado'}\n` +
                `│ 🔢 *CPF:* ${cpf}\n` +
                `└\n\n` +
                `❓ Deseja alterar o email?\n\n` +
                `1️⃣ - *SIM*, quero alterar\n` +
                `2️⃣ - *NÃO*, cancelar`
            );
            session.step = 'STEP_VITAE_CONFIRMAR_ALTERACAO';
            return;
        }
        
        // ==================== CONTINUAÇÃO DO FLUXO VITAE ====================
        
        if (session.step === 'STEP_VITAE_CONFIRMAR_ALTERACAO') {
            atualizarAtividade(from);
            
            if (body === '1') {
                await client.sendMessage(from,
                    `🔐 *VERIFICAÇÃO DE SEGURANÇA*\n\n` +
                    `Informe seu *LOGIN* de acesso:\n\n` +
                    `(Você tem 2 tentativas)`
                );
                session.step = 'STEP_VITAE_VERIFICAR_LOGIN';
                session.data.tentativasLogin = 0;
            } else if (body === '2') {
                await fecharSessao(from);
                delete sessions[from];
                await client.sendMessage(from, '❌ *Operação cancelada.*\n\nDigite *MENU* para recomeçar.');
            } else {
                await client.sendMessage(from, `❌ Opção inválida. Digite *1* para SIM ou *2* para NÃO.`);
            }
            return;
        }
        
        if (session.step === 'STEP_VITAE_VERIFICAR_LOGIN') {
            atualizarAtividade(from);
            session.data.tentativasLogin = (session.data.tentativasLogin || 0) + 1;
            
            // Compara com o login REAL capturado do sistema
            const loginCorreto = (body.toUpperCase() === (session.data.loginAtual || '').toUpperCase());
            
            if (loginCorreto) {
                // Login correto, prepara verificação de unidade
                const opcoesUnidade = obterOpcoesUnidades(session.data.unidadeAtual);
                session.data.opcoesUnidade = opcoesUnidade;
                session.data.unidadeCorreta = session.data.unidadeAtual;
                
                let mensagemOpcoes = `🏥 *VERIFICAÇÃO DE UNIDADE*\n\nQual a unidade que este usuário pertence?\n\n`;
                for (let i = 0; i < opcoesUnidade.length; i++) {
                    mensagemOpcoes += `${i + 1}️⃣ - ${opcoesUnidade[i]}\n`;
                }
                mensagemOpcoes += `\nDigite o *NÚMERO* da opção correta (apenas 1 tentativa):`;
                
                await client.sendMessage(from, mensagemOpcoes);
                session.step = 'STEP_VITAE_VERIFICAR_UNIDADE';
            } else {
                if (session.data.tentativasLogin >= 2) {
                    await client.sendMessage(from, `❌ *LOGIN INCORRETO*\n\nNúmero máximo de tentativas excedido. Operação cancelada.`);
                    await fecharSessao(from);
                    delete sessions[from];
                } else {
                    await client.sendMessage(from, `❌ *LOGIN INCORRETO*\n\nTente novamente (tentativa ${session.data.tentativasLogin + 1} de 2):`);
                }
            }
            return;
        }
        
        if (session.step === 'STEP_VITAE_VERIFICAR_UNIDADE') {
            atualizarAtividade(from);
            const opcao = parseInt(body);
            const opcoesUnidade = session.data.opcoesUnidade;
            
            if (opcao >= 1 && opcao <= opcoesUnidade.length && opcoesUnidade[opcao - 1] === session.data.unidadeCorreta) {
                await client.sendMessage(from,
                    `✅ *VERIFICAÇÃO CONCLUÍDA!*\n\n` +
                    `Agora informe o *NOVO E-MAIL* que deseja cadastrar:`
                    
                );
                session.step = 'STEP_VITAE_NOVO_EMAIL';
            } else {
                await client.sendMessage(from, `❌ *UNIDADE INCORRETA*\n\nOperação cancelada por segurança.`);
                await fecharSessao(from);
                delete sessions[from];
            }
            return;
        }
        
        if (session.step === 'STEP_VITAE_NOVO_EMAIL') {
            atualizarAtividade(from);
            
            if (body.toLowerCase() === 'sair') {
                await fecharSessao(from);
                delete sessions[from];
                await client.sendMessage(from, '❌ *Operação cancelada.*\n\nDigite *MENU* para recomeçar.');
                return;
            }
            
            if (!body.includes('@') || !body.includes('.')) {
                await client.sendMessage(from, `❌ *E-MAIL INVÁLIDO*\n\nDigite um e-mail válido (exemplo@dominio.com):`);
                return;
            }
            
            session.data.novoEmail = body;
            
            const codigo = gerarCodigoVerificacao();
            session.data.codigoVerificacao = codigo;
            codigosEnviados.set(from, codigo);
            
            // 🔥 PEGA O NOME DO USUÁRIO DA SESSÃO
            const nomeUsuario = session.data.nomeEncontrado || session.data.nomeCompleto || 'Usuário';
            
            // 🔥 PASSA O NOME COMO TERCEIRO PARÂMETRO
            await enviarCodigoEmailVitae(session.data.novoEmail, codigo, nomeUsuario);
            
            await client.sendMessage(from,
                `📧 *CÓDIGO DE VERIFICAÇÃO ENVIADO!*\n\n` +
                `Enviamos um código de 6 dígitos para o e-mail:\n` +
                `*${session.data.novoEmail}*\n\n` +
                `⚠️ Verifique o SPAM e LIXO ELETRÔNICO\n\n` +
                `Digite o código recebido para confirmar a alteração:`
                
            );
            session.step = 'STEP_VITAE_CODIGO';
            return;
        }
        
        if (session.step === 'STEP_VITAE_CODIGO') {
            atualizarAtividade(from);
            
            if (body.toLowerCase() === 'sair') {
                await fecharSessao(from);
                delete sessions[from];
                await client.sendMessage(from, '❌ *Operação cancelada.*\n\nDigite *MENU* para recomeçar.');
                return;
            }
            
            const codigoInformado = body.trim();
            const codigoCorreto = session.data.codigoVerificacao;
            
            if (codigoInformado === codigoCorreto) {
                await client.sendMessage(from, `✅ *CÓDIGO CORRETO!*\n\n⏳ *Alterando e-mail...* Aguarde.`);
                
                const resultado = await buscarEAlterarEmailVitae(from, session.data.novoEmail);
                
                if (resultado.sucesso) {
                    await client.sendMessage(from,
                        `✅ *EMAIL ALTERADO COM SUCESSO!*\n\n` +
                        `📊 *RESUMO DA ALTERAÇÃO*\n\n` +
                        `┌\n` +
                        `│ 👤 *Nome:* ${resultado.nome_completo}\n` +
                        `│ 📧 *Email anterior:* ${resultado.email_anterior || 'Não informado'}\n` +
                        `│ 📧 *Novo email:* ${resultado.email_novo}\n` +
                        `└\n\n` +
                        `Digite *1*, *2* ou *3* para uma nova operação.`
                    );
                } else {
                    await client.sendMessage(from,
                        `❌ *ERRO AO ALTERAR EMAIL*\n\n` +
                        `Motivo: ${resultado.erro}\n\n` +
                        `Contate o suporte técnico.`
                    );
                }
                
                await fecharSessao(from);
                delete sessions[from];
            } else {
                await client.sendMessage(from,
                    `❌ *CÓDIGO INCORRETO*\n\n` +
                    `Operação cancelada por segurança.\n\n` +
                    `Digite *MENU* para recomeçar.`
                );
                await fecharSessao(from);
                delete sessions[from];
            }
            return;
        }
        
        // ==================== STEP 1: AGUARDANDO CPF ====================
        if (session.step === 1) {
            atualizarAtividade(from);
            const cpf = body.replace(/\D/g, '');
            
            if (cpf.length !== 11) {
                await client.sendMessage(from, 
                    `❌ *CPF INVÁLIDO*\n\n` +
                    `Digite um CPF válido com 11 dígitos:\n\n` +
                    `Digite *SAIR* para cancelar.`
                );
                return;
            }
            
            session.data.cpf = cpf;
            
            // 🔥 MENSAGEM ÚNICA DE CARREGAMENTO (será substituída)
            const loadingMsg = await client.sendMessage(from, '⏳ *Buscando informações do usuário...* Aguarde.');
            
            // Busca o usuário pelo CPF no CONECTA
            const usuario = await buscarUsuarioPorCPF(cpf);
            
            if (!usuario) {
                await client.sendMessage(from,
                    `❌ *CPF NÃO ENCONTRADO*\n\n` +
                    `CPF informado: *${cpf}*\n\n` +
                    `📋 *Escolha uma opção:*\n\n` +
                    `1️⃣ - Tentar outro *CPF*\n` +
                    `2️⃣ - Buscar por *NOME COMPLETO*\n` +
                    `3️⃣ - *SAIR*\n\n` +
                    `Digite o número da opção:`
                );
                session.step = 2;
                return;
            }
            
            // Usuário encontrado pelo CPF
            session.data.conectaUserId = usuario.id;
            session.data.nomeEncontrado = usuario.fullName;
            session.data.conectaDados = {
                email: usuario.email,
                dataNascimento: usuario.dataNascimento,
                dataAdmissao: usuario.dataAdmissao,
                cargo: usuario.cargo
            };
            
            
            
            // Busca dados completos do CONECTA em background
            const dadosCompletos = await conectaBuscarDadosCompletos(session.data.conectaUserId);
            
            if (dadosCompletos) {
                // 🔥 O endpoint de LISTA (usado pra achar o usuário pelo CPF) não traz o e-mail de
                // forma confiável (vem null mesmo com allUserInfo:true) - só o endpoint de DETALHES
                // (dadosCompletos) tem o valor certo, por isso sobrescreve aqui em vez de manter o
                // que veio de `usuario.email` lá em cima.
                session.data.conectaDados.email = dadosCompletos.email ? limparEmail(dadosCompletos.email) : session.data.conectaDados.email;
                session.data.conectaDados.dataNascimento = dadosCompletos.birthday ? converterTimestampParaData(dadosCompletos.birthday) : session.data.conectaDados.dataNascimento;
                session.data.conectaDados.dataAdmissao = (dadosCompletos.admissionDate || dadosCompletos.hireDate) ? converterTimestampParaData(dadosCompletos.admissionDate || dadosCompletos.hireDate) : session.data.conectaDados.dataAdmissao;
                session.data.conectaDados.cargo = dadosCompletos.jobTitle || session.data.conectaDados.cargo;
                console.log(`✅ Dados completos carregados para: ${session.data.nomeEncontrado}`);
            }
            
            if (session.data.sistema === 'GLPI') {
                // Busca o login no AD pelo nome
                
                
                const login = await buscarLoginPorNome(session.data.nomeEncontrado);
                
                if (!login) {
                    await client.sendMessage(from,
                        `❌ *USUÁRIO NÃO ENCONTRADO NO AD*\n\n` +
                        `Nome: *${session.data.nomeEncontrado}*\n` +
                        `CPF: *${cpf}*\n\n` +
                        `Contate o suporte manualmente.\n\n` +
                        `Digite *SAIR* para encerrar ou *1* para tentar outro CPF.`
                    );
                    session.step = 2;
                    return;
                }
                
                session.data.login = login;
                
                // VERIFICA SE JÁ EXISTE EMAIL NO CACHE
                const emailCache = buscarEmailCache(cpf, 'GLPI');
                
                // 🔥 MENSAGEM ÚNICA (dados + pergunta do email)
                let mensagemUnica = `🔍 *DADOS ENCONTRADOS - GLPI*\n\n` +
                    `👤 *Nome:* ${session.data.nomeEncontrado}\n` +
                    `🔑 *Usuário AD:* ${login}\n` +
                    `🔢 *CPF:* ${cpf}\n\n`;
                    
                
                if (emailCache) {
                    mensagemUnica += `📧 *E-MAIL CADASTRADO*\n` +
                        `E-mail salvo: *${emailCache}*\n\n` +
                        `❓ *O que deseja fazer?*\n\n` +
                        `1️⃣ - Enviar código para este e-mail\n` +
                        `2️⃣ - Usar outro e-mail (responder perguntas de segurança)\n` +
                        `3️⃣ - *SAIR*`;
                    session.step = 'STEP_EMAIL_CACHE';
                    session.data.emailCache = emailCache;
                } else {
                    mensagemUnica += `📧 *E-MAIL CADASTRADO NO SISTEMA*\n` +
                        `E-mail atual: *${session.data.conectaDados.email || 'Não informado'}*\n\n` +
                        `❓ *Este e-mail ainda é utilizado por você?*\n\n` +
                        `1️⃣ - *SIM*, enviar código para este e-mail\n` +
                        `2️⃣ - *NÃO*, quero informar outro e-mail\n` +
                        `3️⃣ - *SAIR*`;
                    session.step = 3;
                }
                
                // 🔥 ENVIA A MENSAGEM ÚNICA
                await client.sendMessage(from, mensagemUnica);
                
            } else if (session.data.sistema === 'CONECTA') {
                
                // VERIFICA SE JÁ EXISTE EMAIL NO CACHE PARA CONECTA
                const emailCache = buscarEmailCache(cpf, 'CONECTA');
                
                // 🔥 MENSAGEM ÚNICA (dados + pergunta do email)
                let mensagemUnica = `🔍 *USUÁRIO ENCONTRADO - CONECTA*\n\n` +
                    `👤 *Nome:* ${usuario.fullName}\n` +
                    `🔢 *CPF:* ${cpf}\n\n`;
                    
                
                if (emailCache) {
                    mensagemUnica += `📧 *E-MAIL CADASTRADO*\n` +
                        `E-mail salvo: *${emailCache}*\n\n` +
                        `❓ *O que deseja fazer?*\n\n` +
                        `1️⃣ - Enviar código para este e-mail\n` +
                        `2️⃣ - Usar outro e-mail (responder perguntas de segurança)\n` +
                        `3️⃣ - *SAIR*`;
                    session.step = 'STEP_EMAIL_CACHE';
                    session.data.emailCache = emailCache;
                } else {
                    mensagemUnica += `📧 *E-MAIL CADASTRADO NO SISTEMA*\n` +
                        `E-mail atual: *${session.data.conectaDados.email || 'Não informado'}*\n\n` +
                        `❓ *Este e-mail ainda é utilizado por você?*\n\n` +
                        `1️⃣ - *SIM*, enviar código para este e-mail\n` +
                        `2️⃣ - *NÃO*, quero informar outro e-mail\n` +
                        `3️⃣ - *SAIR*`;
                    session.step = 3;
                }
                
                // 🔥 ENVIA A MENSAGEM ÚNICA
                await client.sendMessage(from, mensagemUnica);
            }
            return;
        }
        // ==================== STEP 2: MENU QUANDO CPF NÃO É ENCONTRADO ====================
        if (session.step === 2) {
            atualizarAtividade(from);
            if (body === '1') {
                await client.sendMessage(from, 
                    `📝 *Digite o CPF novamente* (apenas números):`
                    
                );
                session.step = 1;
                return;
            } else if (body === '2') {
                await client.sendMessage(from,
                    `📝 *Digite o NOME COMPLETO*:`
                    
                );
                session.step = 4;
                return;
            } else if (body === '3') {
                await client.sendMessage(from, '❌ *Atendimento cancelado.*\n\nDigite *MENU* para voltar ao início.');
                delete sessions[from];
                return;
            } else {
                await client.sendMessage(from, '❌ Opção inválida. Digite 1, 2 ou 3:');
                return;
            }
        }
        // ==================== STEP EMAIL CACHE (usuário já tem email salvo) ====================
        if (session.step === 'STEP_EMAIL_CACHE') {
            if (body === '1') {
                // Usar email do cache
                const codigo = Math.floor(100000 + Math.random() * 900000).toString();
                session.data.codigoVerificacao = codigo;
                session.data.tentativasCodigo = 0;
                
                await client.sendMessage(from, '📧 *Enviando código de verificação...* Aguarde.');
                
                // 🔥 ESCOLHE A FUNÇÃO DE E-MAIL BASEADO NO SISTEMA
                let emailEnviado;
                if (session.data.sistema === 'GLPI') {
                    emailEnviado = await enviarCodigoEmail(
                        session.data.emailCache,
                        codigo,
                        session.data.nomeEncontrado
                    );
                } else if (session.data.sistema === 'CONECTA') {
                    emailEnviado = await enviarCodigoEmailConecta(
                        session.data.emailCache,
                        codigo,
                        session.data.nomeEncontrado
                    );
                }
                
                if (!emailEnviado) {
                    await client.sendMessage(from,
                        `❌ *ERRO AO ENVIAR E-MAIL*\n\n` +
                        `Não foi possível enviar o código para:\n*${session.data.emailCache}*\n\n` +
                        `Deseja tentar outro e-mail? (SIM/NÃO)`
                    );
                    session.step = 'STEP_CACHE_FALHA';
                    return;
                }
                
                await client.sendMessage(from,
                    `📧 *CÓDIGO ENVIADO!*\n\n` +
                    `Um código foi enviado para:\n*${session.data.emailCache}*\n\n` +
                    `⚠️ Verifique o SPAM e LIXO ELETRÔNICO\n\n` +
                    `📝 *Digite o código de 6 dígitos recebido:*`
                    
                );
                session.step = 6;
                
            } else if (body === '2') {
                // Usar outro email - remove cache e vai para segurança
                // 🔥 USA O SISTEMA CORRETO PARA REMOVER O CACHE
                removerEmailCache(session.data.cpf, session.data.sistema);
                
                await client.sendMessage(from,
                    `🔒 *VERIFICAÇÃO DE SEGURANÇA*\n\n` +
                    `Por questões de segurança, vamos validar sua identidade.\n\n` +
                    `📅 *Qual sua DATA DE NASCIMENTO?*\n` +
                    `Formato: *DD/MM/AAAA*` 
                    
                );
                session.step = 'perguntas_seguranca';
                session.data.perguntaAtual = 'nascimento';
                session.data.seguranca = {
                    dataNascimento: session.data.conectaDados.dataNascimento,
                    dataAdmissao: session.data.conectaDados.dataAdmissao,
                    cargo: session.data.conectaDados.cargo,
                    tentativas: 0
                };
                
            } else if (body === '3') {
                await client.sendMessage(from, '❌ *Atendimento cancelado.*\n\nDigite *MENU* para voltar ao início.');
                delete sessions[from];
            } else {
                await client.sendMessage(from, '❌ Opção inválida. Digite 1, 2 ou 3:');
            }
            return;
        }

        // ==================== STEP CACHE FALHA (email do cache falhou) ====================
        if (session.step === 'STEP_CACHE_FALHA') {
            if (body.toUpperCase() === 'SIM') {
                // 🔥 REMOVE O CACHE DO SISTEMA CORRETO
                removerEmailCache(session.data.cpf, session.data.sistema);
                
                await client.sendMessage(from,
                    `🔒 *VERIFICAÇÃO DE SEGURANÇA*\n\n` +
                    `Por questões de segurança, vamos validar sua identidade.\n\n` +
                    `📅 *Qual sua DATA DE NASCIMENTO?*\n` +
                    `Formato: *DD/MM/AAAA*`
                    
                );
                session.step = 'perguntas_seguranca';
                session.data.perguntaAtual = 'nascimento';
                session.data.seguranca = {
                    dataNascimento: session.data.conectaDados.dataNascimento,
                    dataAdmissao: session.data.conectaDados.dataAdmissao,
                    cargo: session.data.conectaDados.cargo,
                    tentativas: 0
                };
            } else if (body.toUpperCase() === 'NAO') {
                await client.sendMessage(from, '❌ *Atendimento cancelado.*\n\nDigite *MENU* para voltar ao início.');
                delete sessions[from];
            } else {
                await client.sendMessage(from, '❌ Digite *SIM* para tentar outro e-mail ou *NAO* para cancelar.');
            }
            return;
        }

        // ==================== STEP 3: CONFIRMAÇÃO E ENVIO DE CÓDIGO ====================
        if (session.step === 3) {
            atualizarAtividade(from);
            if (body === '1') {
                // Opção 1: Enviar código para o e-mail cadastrado
                if (!session.data.conectaDados.email) {
                    await client.sendMessage(from,
                        `❌ *E-MAIL NÃO ENCONTRADO*\n\n` +
                        `Não há e-mail cadastrado para este usuário.\n\n` +
                        `Digite *2* para validar por perguntas de segurança.`
                    );
                    return;
                }
                
                const codigo = Math.floor(100000 + Math.random() * 900000).toString();
                session.data.codigoVerificacao = codigo;
                session.data.tentativasCodigo = 0;
                
                await client.sendMessage(from, '📧 *Enviando código de verificação...* Aguarde.');
                
                // 🔥 ESCOLHE A FUNÇÃO CORRETA BASEADO NO SISTEMA
                let emailEnviado;
                if (session.data.sistema === 'GLPI') {
                    emailEnviado = await enviarCodigoEmail(
                        session.data.conectaDados.email,
                        codigo,
                        session.data.nomeEncontrado
                    );
                } else if (session.data.sistema === 'CONECTA') {
                    emailEnviado = await enviarCodigoEmailConecta(
                        session.data.conectaDados.email,
                        codigo,
                        session.data.nomeEncontrado
                    );
                }
                
                if (!emailEnviado) {
                    await client.sendMessage(from,
                        `❌ *ERRO AO ENVIAR E-MAIL*\n\n` +
                        `Não foi possível enviar o código para:\n*${session.data.conectaDados.email}*\n\n` +
                        `Digite *2* para validar por perguntas de segurança.`
                    );
                    return;
                }
                
                await client.sendMessage(from,
                    `📧 *CÓDIGO ENVIADO!*\n\n` +
                    `Um código foi enviado para:\n*${session.data.conectaDados.email}*\n\n` +
                    `⚠️ Verifique o SPAM e LIXO ELETRÔNICO\n\n` +
                    `📝 *Digite o código de 6 dígitos recebido:*`
                    
                );
                session.step = 6;
                
            } else if (body === '2') {
                // Opção 2: Validar por perguntas de segurança
                // 🔥 OS DADOS JÁ ESTÃO EM session.data.conectaDados (carregados no STEP 1)
                
                // Verifica se os dados de segurança estão disponíveis
                if (!session.data.conectaDados.dataNascimento || !session.data.conectaDados.dataAdmissao || session.data.conectaDados.cargo === 'N/A') {
                    await client.sendMessage(from,
                        `❌ *DADOS INCOMPLETOS*\n\n` +
                        `O sistema não possui todas as informações de segurança\n` +
                        `para validar sua identidade.\n\n` +
                        `📌 Entre em contato com o *RH* para atualizar seus dados cadastrais no CONECTA.`
                    );
                    delete sessions[from];
                    return;
                }
                
                session.data.seguranca = {
                    dataNascimento: session.data.conectaDados.dataNascimento,
                    dataAdmissao: session.data.conectaDados.dataAdmissao,
                    cargo: session.data.conectaDados.cargo,
                    tentativas: 0
                };
                
                // Inicia as perguntas
                await client.sendMessage(from,
                    `🔒 *VERIFICAÇÃO DE SEGURANÇA*\n\n` +
                    `Para sua segurança, vamos validar algumas informações.\n\n` +
                    `📅 *Qual sua DATA DE NASCIMENTO?*\n` +
                    `Formato: *DD/MM/AAAA*`
                    
                );
                session.step = 'perguntas_seguranca';
                session.data.perguntaAtual = 'nascimento';
                
            } else if (body === '3') {
                await client.sendMessage(from, '❌ *Atendimento cancelado.*\n\nDigite *MENU* para voltar ao início.');
                delete sessions[from];
            } else {
                await client.sendMessage(from, '❌ Opção inválida. Digite 1, 2 ou 3:');
            }
            return;
        }

        // ==================== PERGUNTAS DE SEGURANÇA ====================
        if (session.step === 'perguntas_seguranca') {
            if (body.toUpperCase() === 'SAIR') {
                await client.sendMessage(from, '❌ *Atendimento cancelado.*\n\nDigite *MENU* para voltar ao início.');
                delete sessions[from];
                return;
            }
            
            // PERGUNTA 1: DATA DE NASCIMENTO
            if (session.data.perguntaAtual === 'nascimento') {
                if (body === session.data.seguranca.dataNascimento) {
                    await client.sendMessage(from, '✅ *DATA CORRETA!*\n\n📅 *Qual o ANO da sua ADMISSÃO?*\nDigite apenas o ano (ex: 2020)');
                    session.data.perguntaAtual = 'admissao';
                    session.data.seguranca.tentativas = 2;
                } else {
                    session.data.seguranca.tentativas++;
                    if (session.data.seguranca.tentativas >= 2) {
                        await client.sendMessage(from, '❌ *Limite de tentativas excedido!* Atendimento cancelado.\n\nDigite *MENU* para recomeçar.');
                        delete sessions[from];
                        return;
                    }
                    await client.sendMessage(from,
                        `❌ *DATA INCORRETA!*\n` +
                        `Tentativas restantes: ${2 - session.data.seguranca.tentativas}\n\n` +
                        `📅 *Qual sua DATA DE NASCIMENTO?* (DD/MM/AAAA)`
                    );
                }
                return;
            }
            
            // PERGUNTA 2: ANO DE ADMISSÃO
            if (session.data.perguntaAtual === 'admissao') {
                const anoCorreto = session.data.seguranca.dataAdmissao.split('/')[2];
                
                if (body === anoCorreto) {
                    await client.sendMessage(from, '✅ *ANO CORRETO!*\n\n📋 *Preparando perguntas sobre seu cargo...*');
                    
                    // 🔥 REMOVEU a lista local e agora usa a variável GLOBAL LISTA_CARGOS
                    // Certifique-se de que LISTA_CARGOS foi carregada no início do arquivo
                    
                    // Pega 2 cargos aleatórios diferentes do cargo real
                    const outrosCargos = LISTA_CARGOS.filter(c => c !== session.data.seguranca.cargo);
                    const aleatorios = outrosCargos.sort(() => 0.5 - Math.random()).slice(0, 4);
                    const opcoes = [session.data.seguranca.cargo, ...aleatorios];
                    session.data.opcoesCargo = opcoes.sort(() => 0.5 - Math.random());
                    
                    let msgCargos = `📋 *Qual seu CARGO?*\n\n`;
                    session.data.opcoesCargo.forEach((cargo, idx) => {
                        msgCargos += `${idx + 1}️⃣ - ${cargo}\n`;
                    });
                    msgCargos += `\nDigite o *NÚMERO* da opção correta.\nVocê tem 1 tentativa.`;
                    
                    await client.sendMessage(from, msgCargos);
                    session.data.perguntaAtual = 'cargo';
                    session.data.seguranca.tentativas = 0;
                } else {
                    session.data.seguranca.tentativas++;
                    if (session.data.seguranca.tentativas >= 1) {
                        await client.sendMessage(from, '❌ *Limite de tentativas excedido!* Atendimento cancelado.\n\nDigite *MENU* para recomeçar.');
                        delete sessions[from];
                        return;
                    }
                    await client.sendMessage(from,
                        `❌ *ANO INCORRETO!*\n` +
                        `Tentativas restantes: ${2 - session.data.seguranca.tentativas}\n\n` +
                        `📅 *Qual o ANO da sua ADMISSÃO?*`
                    );
                }
                return;
            }
            
            // PERGUNTA 3: CARGO (com opções)
            if (session.data.perguntaAtual === 'cargo') {
                const opcaoNum = parseInt(body);
                
                if (isNaN(opcaoNum) || opcaoNum < 1 || opcaoNum > 5) {
                    await client.sendMessage(from, '❌ Opção inválida! Digite o número (1, 2, 3, 4 ou 5):');
                    return;
                }
                
                const cargoSelecionado = session.data.opcoesCargo[opcaoNum - 1];
                
                if (cargoSelecionado === session.data.seguranca.cargo) {
                    // 🔥 PERGUNTAS DE SEGURANÇA CONCLUÍDAS COM SUCESSO!
                    await client.sendMessage(from, 
                        '✅ *CARGO CORRETO!*\n\n' +
                        '🔐 *VERIFICAÇÃO CONCLUÍDA*\n\n' +
                        'Suas respostas foram validadas com sucesso.\n\n' +
                        '📧 *Digite o E-MAIL* para onde enviaremos o código de verificação:\n\n' +
                        '⚠️ *Este e-mail será salvo para próximas solicitações.*'
                    );
                    session.step = 'STEP_SOLICITAR_EMAIL_SEGURANCA';
                } else {
                    session.data.seguranca.tentativas++;
                    if (session.data.seguranca.tentativas >= 1) {
                        await client.sendMessage(from, '❌ *Limite de tentativas excedido!* Atendimento cancelado.\n\nDigite *MENU* para recomeçar.');
                        delete sessions[from];
                        return;
                    }
                    
                    let msgCargos = `❌ *CARGO INCORRETO!*\nTentativas restantes: ${1 - session.data.seguranca.tentativas}\n\n📋 *Qual seu CARGO?*\n\n`;
                    session.data.opcoesCargo.forEach((cargo, idx) => {
                        msgCargos += `${idx + 1}️⃣ - ${cargo}\n`;
                    });
                    msgCargos += `\nDigite o *NÚMERO* da opção correta.`;
                    
                    await client.sendMessage(from, msgCargos);
                }
                return;
            }
            return;
        }

        // ==================== STEP SOLICITAR EMAIL APÓS SEGURANÇA ====================
        if (session.step === 'STEP_SOLICITAR_EMAIL_SEGURANCA') {
            if (body.toUpperCase() === 'CANCELAR') {
                await client.sendMessage(from, '❌ *Operação cancelada.*\n\nDigite *MENU* para recomeçar.');
                delete sessions[from];
                return;
            }
            
            const email = body.trim();
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            
            if (!emailRegex.test(email)) {
                await client.sendMessage(from, '❌ *E-MAIL INVÁLIDO*\n\nDigite um e-mail válido (exemplo: usuario@empresa.com):');
                return;
            }
            
            // 🔥 SALVA O EMAIL NO CACHE
            const login = session.data.login || session.data.conectaUserId;
            salvarEmailCache(session.data.cpf, session.data.sistema, login, email);
            
            await client.sendMessage(from,
                `✅ *E-MAIL SALVO COM SUCESSO!*\n\n` +
                `📧 *${email}*\n\n` +
                `📧 *Enviando código de verificação...* Aguarde.`
            );
            
            const codigo = Math.floor(100000 + Math.random() * 900000).toString();
            session.data.codigoVerificacao = codigo;
            session.data.tentativasCodigo = 0;
            
            // Envia o código para o e-mail informado
            let emailEnviado;
            if (session.data.sistema === 'GLPI') {
                emailEnviado = await enviarCodigoEmail(email, codigo, session.data.nomeEncontrado);
            } else {
                emailEnviado = await enviarCodigoEmailConecta(email, codigo, session.data.nomeEncontrado);
            }
            
            if (!emailEnviado) {
                await client.sendMessage(from,
                    `❌ *ERRO AO ENVIAR E-MAIL*\n\n` +
                    `Não foi possível enviar o código para:\n*${email}*\n\n` +
                    `Digite *TENTAR* para outro e-mail ou *SAIR* para cancelar.`
                );
                session.step = 'STEP_REENVIAR_EMAIL_FALHA';
                return;
            }
            
            await client.sendMessage(from,
                `📧 *CÓDIGO ENVIADO!*\n\n` +
                `⚠️ Verifique o SPAM e LIXO ELETRÔNICO\n\n` +
                `📝 *Digite o código de 6 dígitos recebido:*` 
                
            );
            session.step = 6;
            return;
        }
        
        // ==================== STEP 4: BUSCAR POR NOME COMPLETO (FALLBACK) ====================
        if (session.step === 4) {
            atualizarAtividade(from);
            const nomeCompleto = body;
            
            await client.sendMessage(from, '⏳ *Buscando usuário pelo nome...* Aguarde.');

            try {
                const candidatos = await buscarUsuariosPorNome(nomeCompleto);
                const usuarioEncontrado = candidatos[0];

                if (!usuarioEncontrado) {
                    await client.sendMessage(from,
                        `❌ *NOME NÃO ENCONTRADO NO CONECTA*\n\n` +
                        `Nome informado: *${nomeCompleto}*\n\n` +
                        `📋 *Opções:*\n` +
                        `1️⃣ - Tentar outro *NOME*\n` +
                        `2️⃣ - Tentar *CPF*\n` +
                        `3️⃣ - *SAIR*\n\n` +
                        `Digite o número da opción:`
                    );
                    session.step = 5;
                    return;
                }
                
                const dadosCompletos = await conectaBuscarDadosCompletos(usuarioEncontrado.id);
                
                session.data.conectaUserId = usuarioEncontrado.id;
                session.data.nomeEncontrado = usuarioEncontrado.nomeCompleto;

                // 🔥 SALVAR O CPF DO USUÁRIO ENCONTRADO
                const cpfEncontrado = dadosCompletos?.document || usuarioEncontrado.document;
                if (cpfEncontrado) {
                    session.data.cpf = cpfEncontrado;
                    console.log(`📝 CPF encontrado: ${cpfEncontrado}`);
                }
                
                session.data.conectaDados = {
                    email: limparEmail(dadosCompletos?.email || usuarioEncontrado.email),
                    dataNascimento: dadosCompletos?.birthday ? converterTimestampParaData(dadosCompletos.birthday) : null,
                    dataAdmissao: (dadosCompletos?.admissionDate || dadosCompletos?.hireDate) ? converterTimestampParaData(dadosCompletos.admissionDate || dadosCompletos.hireDate) : null,
                    cargo: dadosCompletos?.jobTitle || 'N/A'
                };
                
                if (session.data.sistema === 'GLPI') {
                    // Busca o login no AD pelo nome
                    await client.sendMessage(from, '⏳ *Buscando usuário no AD...* Aguarde.');
                    
                    const login = await buscarLoginPorNome(session.data.nomeEncontrado);
                    
                    if (!login) {
                        await client.sendMessage(from,
                            `❌ *USUÁRIO NÃO ENCONTRADO NO AD*\n\n` +
                            `Nome: *${session.data.nomeEncontrado}*\n\n` +
                            `Contate o suporte manualmente.\n\n` +
                            `Digite *SAIR* para encerrar.`
                        );
                        delete sessions[from];
                        return;
                    }
                    
                    session.data.login = login;
                }
                
                // ========== MENSAGEM 1: DADOS DO USUÁRIO ENCONTRADO ==========
                let dadosMsg = `✅ *USUÁRIO ENCONTRADO PELO NOME!*\n\n`;
                dadosMsg += `┌\n`;
                dadosMsg += `│ 👤 *Nome:* ${session.data.nomeEncontrado}\n`;
                if (session.data.login) {
                    dadosMsg += `│ 🔑 *Usuário AD:* ${session.data.login}\n`;
                }
                dadosMsg += `│ 🔢 *CPF:* ${session.data.cpf || 'Não informado'}\n`;
                dadosMsg += `│ 💻 *Sistema:* ${session.data.sistema}\n`;
                dadosMsg += `└`;
                
                await client.sendMessage(from, dadosMsg);
                
                // ========== MENSAGEM 2: PERGUNTA SOBRE E-MAIL ==========
                await client.sendMessage(from,
                    `📧 *E-MAIL CADASTRADO NO SISTEMA*\n\n` +
                    `E-mail atual: *${session.data.conectaDados.email || 'Não informado'}*\n\n` +
                    `❓ *Este e-mail ainda é utilizado por você?*\n\n` +
                    `1️⃣ - *SIM*, enviar código para este e-mail\n` +
                    `2️⃣ - *NÃO*, quero informar outro e-mail\n` +
                    `3️⃣ - *SAIR*`
                );
                session.step = 3;
                
            } catch (error) {
                console.error(error);
                await client.sendMessage(from, '❌ *Atendimento cancelado. Digite *MENU* para recomeçar.');
                session.step = 2;
            }
            return;
        }
        
        // ==================== STEP 5: MENU FALLBACK APÓS NOME NÃO ENCONTRADO ====================
        if (session.step === 5) {
            atualizarAtividade(from);
            if (body === '1') {
                await client.sendMessage(from, '📝 *Digite o NOME COMPLETO novamente:*');
                session.step = 4;
            } else if (body === '2') {
                await client.sendMessage(from, '📝 *Digite o CPF:*');
                session.step = 1;
            } else if (body === '3') {
                await client.sendMessage(from, '❌ *Atendimento cancelado. Digite *MENU* para recomeçar.');
                delete sessions[from];
            } else {
                await client.sendMessage(from, '❌ Opção inválida. Digite 1, 2 ou 3:');
            }
            return;
        }

        // ==================== STEP 6: VALIDANDO CÓDIGO E ENVIANDO LINK ====================
        if (session.step === 6) {
            atualizarAtividade(from);
            if (body === session.data.codigoVerificacao) {
                
                if (session.data.sistema === 'GLPI') {
                    // GLPI: envia link com token
                    if (!session.data.login) {
                        const login = await buscarLoginPorNome(session.data.nomeEncontrado);
                        if (!login) {
                            await client.sendMessage(from,
                                `❌ *USUÁRIO NÃO ENCONTRADO NO AD*\n\n` +
                                `Nome: *${session.data.nomeEncontrado}*\n\n` +
                                `Contate o suporte manualmente.`
                            );
                            delete sessions[from];
                            return;
                        }
                        session.data.login = login;
                    }
                    
                    await client.sendMessage(from, '✅ *Código verificado com sucesso!*\n\n🔗 *Gerando link seguro...* Aguarde um momento.');
                    
                    // 🔥 CHAMA O SERVIDOR PARA GERAR UM TOKEN TEMPORÁRIO
                    try {
                        const response = await fetch('https://bot-nti.resetsenhaglpi.dpdns.org/api/gerar-token', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({
                                login: session.data.login,
                                nome: session.data.nomeEncontrado
                            })
                        });
                        
                        const data = await response.json();
                        
                        if (!data.success) {
                            throw new Error(data.error || 'Erro ao gerar token');
                        }
                        
                        const link = data.link;  // URL com token: https://...?token=abc123...
                        const linkGLPI = 'https://sistemasnti.isgh.org.br/glpi/';
                        

                                                // ========== MENSAGEM 2: INFORMAÇÕES E INSTRUÇÕES ==========
                        await client.sendMessage(from,
                            `⚠️*INFO:*\n` +
                            `• A senha expira a cada *3 meses*\n` +
                            `• Escolha *HRN* no Banco de Dados ao acessar o GLPI\n\n` +
                            `🔗 *Link Sistema GLPI:*\n` +
                            `${linkGLPI}\n\n` 
                            
                        );
                                             
                        
                        // ========== MENSAGEM 1: LINK PARA RESETAR SENHA ==========                  
                        await client.sendMessage(from,
                            `🔗 *LINK PARA RESETAR SUA SENHA*\n\n` +
                            `Clique no link abaixo para definir sua nova senha:\n\n` +
                            `${link}\n\n` +
                            `⏰ *Este link é único e expira em 4 minutos!*\n` +
                            `🔒 *Só pode ser usado uma vez.*\n\n` +
                            `⚠️ *ATENÇÃO:* Se o link expirar, você precisará solicitar um novo.\n\n`+
                            `Atendimento concluído! 😊`
                        );

                        // 🔥 ESPERA 10 SEGUNDOS ANTES DE ENVIAR A SEGUNDA MENSAGEM
                       //await new Promise(resolve => setTimeout(resolve, 1000)); // 10 segundos   


                        

                        

                                

                        
                    } catch (error) {
                        console.error('❌ Erro ao gerar token:', error);
                        await client.sendMessage(from,
                            `❌ *ERRO AO GERAR LINK SEGURO*\n\n` +
                            `Não foi possível gerar o link de recuperação.\n\n` +
                            `Por favor, tente novamente mais tarde ou contate o NTI presencialmente.`
                        );
                    }
                    
                    delete sessions[from];
                    
                } else if (session.data.sistema === 'CONECTA') {
                    // CONECTA: reset direto (não usa link, então mantém igual)
                    await client.sendMessage(from, '✅ *Código verificado com sucesso!*\n\n⏳ *Resetando senha no CONECTA...* Aguarde.');
                    
                    let result;
                    if (session.data.conectaUserId) {
                        result = await resetarSenhaConectaPorId(session.data.conectaUserId);
                    } else {
                        result = await resetarSenhaConectaPorCPF(session.data.cpf);
                    }
                    
                    if (result.success) {
                        await client.sendMessage(from,
                            `✅ *SENHA RESETADA COM SUCESSO!*\n\n` +
                            `👤 Nome: *${session.data.nomeEncontrado}*\n` +
                            `💻 Sistema: *CONECTA*\n` +
                            `🔑 Nova senha: \`${getNovaSenha()}\`\n\n` +
                            `⚠️ *ATENÇÃO:* Esta é uma senha temporária.\n` +
                            `Você será obrigado a alterá-la no primeiro acesso.\n\n` +
                            `🔗 *Acesse o sistema CONECTA:*\n` +
                            `https://isghconecta.mybeehome.com\n\n` +
                            `Atendimento concluído! 😊`
                        );
                    } else {
                        await client.sendMessage(from,
                            `❌ *ERRO AO RESETAR SENHA*\n\n` +
                            `👤 Nome: *${session.data.nomeEncontrado}*\n` +
                            `❌ Erro: ${result.error}\n\n` +
                            `Contate o suporte manualmente.`
                        );
                    }
                    delete sessions[from];
                }
                
            } else {
                session.data.tentativasCodigo = (session.data.tentativasCodigo || 0) + 1;
                
                if (session.data.tentativasCodigo >= 3) {
                    await client.sendMessage(from,
                        `❌ *CÓDIGO INVÁLIDO - LIMITE EXCEDIDO*\n\n` +
                        `Atendimento cancelado. Digite *MENU* para recomeçar.`
                    );
                    delete sessions[from];
                } else {
                    await client.sendMessage(from,
                        `❌ *CÓDIGO INVÁLIDO*\n` +
                        `Tentativas restantes: *${3 - session.data.tentativasCodigo}*\n\n` +
                        `Digite o código novamente ou *SAIR* para cancelar.`
                    );
                }
            }
            return;
        }

        // ==================== STEP 7: SOLICITAR E-MAIL ALTERNATIVO (SEM CACHE) ====================
        // Este STEP é usado APENAS quando o usuário NÃO quer usar o e-mail do cache
        // e NÃO quer passar pelas perguntas de segurança (fallback rápido)
        if (session.step === 7) {
            atualizarAtividade(from);
            const novoEmail = body.trim();
            
            if (!novoEmail.includes('@') || !novoEmail.includes('.')) {
                await client.sendMessage(from, '❌ *E-mail inválido!* Digite um e-mail válido (exemplo: usuario@empresa.com):');
                return;
            }
            
            // 🔥 PERGUNTA SE QUER SALVAR ESTE E-MAIL PARA PRÓXIMAS VEZES
            await client.sendMessage(from,
                `✅ *E-MAIL RECEBIDO!*\n\n` +
                `📧 *${novoEmail}*\n\n` +
                `❓ *Deseja salvar este e-mail para próximas solicitações?*\n\n` +
                `1️⃣ - *SIM*, salvar e enviar código\n` +
                `2️⃣ - *NÃO*, apenas enviar código (não salvar)\n` +
                `3️⃣ - *CANCELAR*`
            );
            session.step = 'STEP_CONFIRMAR_SALVAR_EMAIL';
            session.data.emailAlternativo = novoEmail;
            return;
        }

        // ==================== STEP CONFIRMAR_SALVAR_EMAIL ====================
        if (session.step === 'STEP_CONFIRMAR_SALVAR_EMAIL') {
            if (body === '1') {
                // SALVAR E-MAIL NO CACHE
                const login = session.data.login || session.data.conectaUserId;
                salvarEmailCache(session.data.cpf, session.data.sistema, login, session.data.emailAlternativo);
                
                await client.sendMessage(from,
                    `✅ *E-MAIL SALVO COM SUCESSO!*\n\n` +
                    `📧 *${session.data.emailAlternativo}*\n\n` +
                    `📧 *Enviando código de verificação...* Aguarde.`
                );
                
            } else if (body === '2') {
                // NÃO SALVAR, APENAS ENVIAR CÓDIGO
                await client.sendMessage(from,
                    `📧 *E-MAIL NÃO SALVO*\n\n` +
                    `O código será enviado apenas desta vez.\n\n` +
                    `📧 *Enviando código de verificação...* Aguarde.`
                );
                
            } else if (body === '3') {
                await client.sendMessage(from, '❌ *Operação cancelada.*\n\nDigite *MENU* para recomeçar.');
                delete sessions[from];
                return;
                
            } else {
                await client.sendMessage(from, '❌ Opção inválida. Digite 1, 2 ou 3:');
                return;
            }
            
            // GERA CÓDIGO E ENVIA PARA O E-MAIL ALTERNATIVO
            const codigo = Math.floor(100000 + Math.random() * 900000).toString();
            session.data.codigoVerificacao = codigo;
            session.data.tentativasCodigo = 0;
            
            let emailEnviado;
            if (session.data.sistema === 'GLPI') {
                emailEnviado = await enviarCodigoEmail(
                    session.data.emailAlternativo,
                    codigo,
                    session.data.nomeEncontrado
                );
            } else if (session.data.sistema === 'CONECTA') {
                emailEnviado = await enviarCodigoEmailConecta(
                    session.data.emailAlternativo,
                    codigo,
                    session.data.nomeEncontrado
                );
            }
            
            if (!emailEnviado) {
                await client.sendMessage(from,
                    `❌ *ERRO AO ENVIAR E-MAIL*\n\n` +
                    `Não foi possível enviar o código para:\n*${session.data.emailAlternativo}*\n\n` +
                    `Tente novamente mais tarde.`
                );
                delete sessions[from];
                return;
            }
            
            await client.sendMessage(from,
                `📧 *CÓDIGO ENVIADO!*\n\n` +
                `Um código foi enviado para:\n*${session.data.emailAlternativo}*\n\n` +
                `⚠️ Verifique o SPAM e LIXO ELETRÔNICO\n\n` +
                `📝 *Digite o código de 6 dígitos recebido:*\n\n` +
                `Digite *SAIR* para cancelar.`
            );
            session.step = 6;
            return;
        }

        // ==================== STEP REENVIAR_EMAIL_FALHA (quando email do cache falha) ====================
        if (session.step === 'STEP_REENVIAR_EMAIL_FALHA') {
            if (body.toUpperCase() === 'TENTAR') {
                await client.sendMessage(from,
                    `📧 *Digite um novo e-mail* para receber o código:\n\n` +
                    `Exemplo: *seuemail@dominio.com*\n\n` +
                    `Digite *CANCELAR* para cancelar.`
                );
                session.step = 7;
            } else if (body.toUpperCase() === 'SAIR') {
                await client.sendMessage(from, '❌ *Atendimento cancelado. Digite *MENU* para recomeçar.');
                delete sessions[from];
            } else {
                await client.sendMessage(from, '❌ Digite *TENTAR* para outro e-mail ou *SAIR* para cancelar.');
            }
            return;
        }
        
    } catch (error) {
        console.error(`❌ Erro no handler: ${error.message}`);
        await client.sendMessage(from, 
            `❌ *Erro interno*\n\n` +
            `Ocorreu um erro inesperado.\n\n` +
            `Digite *MENU* para recomeçar.`
        );
        delete sessions[from];
    }
}

// 🔥 Fila de processamento por sessão: sem isso, duas mensagens da MESMA pessoa chegando em
// sequência rápida (comum quando a IA demora pra responder - ver retries em ia.js, até ~20s no
// pior caso) eram processadas em PARALELO. Cada chamada concorrente lia session.data.historicoIA
// antes da outra terminar de gravar sua própria troca, então a segunda pergunta ia pro Gemini sem
// o contexto da primeira - a IA "perdia o fio" da conversa (ex: perguntar sobre as luzes da porta
// de rede e não levar em conta a resposta que o usuário já tinha mandado). Mensagens de pessoas
// diferentes continuam sendo processadas em paralelo normalmente, só a fila é por `from`.
const filaPorSessao = new Map();

client.on('message', (message) => {
    const from = message.from;
    const anterior = filaPorSessao.get(from) || Promise.resolve();
    const atual = anterior
        .catch(() => {}) // uma falha na mensagem anterior não pode travar a fila dessa sessão
        .then(() => processarMensagem(message))
        .catch(error => console.error(`❌ Erro não tratado no handler de ${from}: ${error.message}`));

    filaPorSessao.set(from, atual);
    atual.finally(() => {
        if (filaPorSessao.get(from) === atual) filaPorSessao.delete(from);
    });
});

client.initialize();