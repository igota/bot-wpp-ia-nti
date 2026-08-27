// ia.js - Camada de IA (Google Gemini, free tier) para deixar as respostas do bot mais naturais.
// Protótipo: se a IA falhar, estiver sem chave ou demorar demais, o bot cai no comportamento
// padrão (mensagens fixas) — a IA nunca é obrigatória para o fluxo funcionar.

const axios = require('axios');
const fs = require('fs');
const path = require('path');

let IA_CONFIG = null;

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

// Base de conhecimento do NTI (regras/fluxos internos), carregada uma única vez em memória.
// Fica na raiz do projeto, fora do bot/ - documento é mantido pelo NTI, não é código.
const CAMINHO_BASE_CONHECIMENTO = path.join(__dirname, '..', 'base_conhecimento_nti.md');
let BASE_CONHECIMENTO = null;

function carregarBaseConhecimento() {
    if (BASE_CONHECIMENTO !== null) return BASE_CONHECIMENTO;

    try {
        BASE_CONHECIMENTO = fs.readFileSync(CAMINHO_BASE_CONHECIMENTO, 'utf-8');
        console.log('✅ IA: base de conhecimento do NTI carregada');
    } catch (error) {
        console.warn(`⚠️ IA: não foi possível carregar base_conhecimento_nti.md (${error.message}) - dúvidas gerais sobre o NTI não serão respondidas`);
        BASE_CONHECIMENTO = '';
    }

    return BASE_CONHECIMENTO;
}

// 🔥 A base de conhecimento tende a crescer com o tempo (o NTI vai adicionando procedimentos), e
// mandar o documento inteiro em toda pergunta gasta tokens/latência à toa quando só uma parte dele
// é relevante pra pergunta atual. Por isso dividimos o documento em seções (por título "## ") e
// mandamos só as seções relevantes - mais o histórico, pra continuar reconhecendo o assunto em
// respostas de acompanhamento tipo "sim"/"não". Se nada bater, cai no documento inteiro - fallback
// seguro que nunca faz a IA "perder" informação por causa da filtragem.
let SECOES_BASE_CONHECIMENTO = null;

// Seções de comportamento/formatação da resposta - independem do assunto perguntado, então sempre
// entram junto (nomes já normalizados, sem acento, pra bater com normalizarTexto()).
const SECOES_SEMPRE_INCLUIDAS = [
    'comportamento conversacional da ia',
    'seguranca e respostas desconhecidas',
    'prioridade entre ia e fluxos fixos'
];

function normalizarTexto(texto) {
    return (texto || '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase();
}

function dividirEmSecoes(documento) {
    const linhas = documento.split('\n');
    const introducao = [];
    const secoes = [];
    let atual = null;

    for (const linha of linhas) {
        if (/^## /.test(linha)) {
            if (atual) secoes.push(atual);
            atual = { titulo: linha.replace(/^## \d+(\.\d+)?\.?\s*/, '').trim(), texto: linha + '\n' };
        } else if (atual) {
            atual.texto += linha + '\n';
        } else {
            introducao.push(linha);
        }
    }
    if (atual) secoes.push(atual);

    return { introducao: introducao.join('\n'), secoes };
}

function obterSecoesBaseConhecimento() {
    if (SECOES_BASE_CONHECIMENTO !== null) return SECOES_BASE_CONHECIMENTO;
    SECOES_BASE_CONHECIMENTO = dividirEmSecoes(carregarBaseConhecimento());
    return SECOES_BASE_CONHECIMENTO;
}

// Palavras genéricas demais pra servir de critério de busca (verbos/pronomes/conectores comuns que
// aparecem nos próprios exemplos de intenção de VÁRIAS seções do documento, ex: "consigo", "onde",
// "informar") - sem filtrar essas, praticamente qualquer pergunta batia com quase todo o documento
// e a filtragem não reduzia nada. Lista normalizada (sem acento), pra bater com normalizarTexto().
const PALAVRAS_IGNORADAS = new Set([
    'para', 'como', 'onde', 'quando', 'porque', 'qual', 'quais', 'quero', 'preciso', 'consigo',
    'consegue', 'consegui', 'informar', 'gostaria', 'poderia', 'pode', 'podem', 'fazer', 'sobre',
    'esta', 'estou', 'sendo', 'sido', 'isso', 'essa', 'esse', 'aquele', 'aquela', 'meu', 'minha',
    'seu', 'sua', 'muito', 'mais', 'menos', 'ainda', 'tambem', 'apenas', 'agora', 'aqui', 'depois',
    'antes', 'sempre', 'nunca', 'alguma', 'algum', 'nenhum', 'nenhuma', 'outro', 'outra', 'mesmo',
    'mesma', 'tudo', 'nada', 'algo', 'coisa', 'obrigado', 'obrigada', 'ajuda', 'ajudar', 'alguem',
    'voce', 'favor', 'bom', 'boa', 'dia', 'tarde', 'noite'
]);

// Seleciona as seções cujo título ou conteúdo tem alguma palavra (4+ letras, fora as ignoradas) em
// comum com o texto de consulta (pergunta atual + histórico recente). Sempre inclui as seções de
// comportamento/segurança. Se nenhuma seção de assunto bater, manda o documento inteiro - mais
// seguro do que arriscar faltar informação por causa de uma palavra-chave que não bateu.
function selecionarSecoesRelevantes(textoConsulta) {
    const { introducao, secoes } = obterSecoesBaseConhecimento();
    const palavras = [...new Set(normalizarTexto(textoConsulta).match(/[a-z0-9]{4,}/g) || [])]
        .filter(p => !PALAVRAS_IGNORADAS.has(p));

    const éSempreIncluida = (s) => SECOES_SEMPRE_INCLUIDAS.includes(normalizarTexto(s.titulo));
    const sempre = secoes.filter(éSempreIncluida);
    const relevantes = palavras.length
        ? secoes.filter(s => {
            if (éSempreIncluida(s)) return false;
            const alvo = normalizarTexto(s.titulo + ' ' + s.texto);
            return palavras.some(p => alvo.includes(p));
        })
        : [];

    if (!relevantes.length) {
        return introducao + '\n' + secoes.map(s => s.texto).join('\n');
    }

    return introducao + '\n' + [...sempre, ...relevantes].map(s => s.texto).join('\n');
}

function setConfig(appConfig) {
    const apiKey = appConfig?.ia?.apiKey || null;
    IA_CONFIG = {
        apiKey,
        modelo: appConfig?.ia?.modelo || 'gemini-2.0-flash',
        ativo: Boolean(apiKey) && appConfig?.ia?.ativo !== false
    };

    console.log(IA_CONFIG.ativo
        ? `✅ IA: Gemini (${IA_CONFIG.modelo}) configurado`
        : '⚠️ IA: desativada (sem GEMINI_API_KEY no .env) - bot segue no modo padrão');

    if (IA_CONFIG.ativo) carregarBaseConhecimento();
}

// `tentativas` > 1 refaz a chamada quando o motivo da falha for passageiro (timeout ou 503 -
// modelo sobrecarregado no free tier) - erros de outra natureza (ex: 400, chave inválida) não
// tendem a se resolver numa segunda tentativa, então não vale gastar mais tempo repetindo.
async function chamarGemini(prompt, { timeoutMs = 6000, temperature = 0.4, tentativas = 1, thinkingBudget = null } = {}) {
    if (!IA_CONFIG?.ativo) return null;

    for (let tentativa = 1; tentativa <= tentativas; tentativa++) {
        try {
            const url = `${GEMINI_BASE_URL}/${IA_CONFIG.modelo}:generateContent?key=${IA_CONFIG.apiKey}`;
            const generationConfig = {
                temperature,
                // Modelos com "raciocínio" (thinking) gastam parte do maxOutputTokens pensando
                // antes de gerar o texto visível - por isso o valor generoso aqui. O guard de
                // finishReason abaixo é quem garante que nunca sai uma resposta cortada.
                maxOutputTokens: 2048
            };
            // thinkingBudget baixo evita que o modelo "pense" antes de responder (medido: ~10s de
            // thinking até pra um prompt trivial, sem thinkingConfig). Não pode ser 0 (a API rejeita
            // com 400 nesse modelo) - 1 é o mínimo aceito e já derruba a latência pra menos de 1s.
            if (thinkingBudget !== null) generationConfig.thinkingConfig = { thinkingBudget };

            const resposta = await axios.post(url, {
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig
            }, { timeout: timeoutMs });

            const candidato = resposta.data?.candidates?.[0];
            const finishReason = candidato?.finishReason;

            // Só aceita resposta completa (STOP). Qualquer corte (MAX_TOKENS, SAFETY, etc.)
            // é tratado como falha - é mais seguro cair no texto padrão do que mandar algo cortado.
            if (finishReason && finishReason !== 'STOP') {
                console.warn(`⚠️ IA: resposta incompleta do Gemini (finishReason=${finishReason}) - usando fallback padrão`);
                return null;
            }

            const texto = candidato?.content?.parts?.map(p => p.text || '').join('');
            // O prompt pede negrito no formato do WhatsApp (*asterisco simples*), mas o modelo às vezes
            // ignora e usa **negrito duplo** (Markdown) mesmo assim - normaliza aqui em vez de confiar
            // 100% na instrução, pra nunca mandar asterisco duplo literal pro usuário.
            return texto ? texto.trim().replace(/\*\*(.+?)\*\*/g, '*$1*') : null;
        } catch (error) {
            const status = error.response?.status;
            const éPassageiro = status === 503 || error.code === 'ECONNABORTED' || /timeout/i.test(error.message);

            if (éPassageiro && tentativa < tentativas) {
                console.warn(`⚠️ IA: falha passageira ao chamar Gemini (${status || error.message}) - tentativa ${tentativa}/${tentativas}, tentando de novo...`);
                continue;
            }

            console.warn(`⚠️ IA: falha ao chamar Gemini (${status || error.message}) - usando fallback padrão`);
            return null;
        }
    }

    return null;
}

// Interpreta uma mensagem livre no menu principal e mapeia para uma intenção conhecida.
// Retorna null se não conseguir identificar a intenção com confiança (ou se a IA estiver desativada).
//
// Códigos possíveis:
//   '1' = GLPI, '2' = CONECTA, '3' = VITAE (mesmas opções do menu numérico)
//   'EMAIL_SENHA' = esqueceu/quer resetar a senha do e-mail corporativo (não é feito por nenhum sistema aqui)
//   'EMAIL_NOVO'  = quer cadastrar um e-mail novo (não é feito por nenhum sistema aqui)
async function interpretarOpcaoMenu(mensagemUsuario) {
    const prompt =
        'Você é o roteador de intenção do menu principal de um bot de TI interno (HELPZIN). ' +
        'O usuário digitou uma mensagem livre em vez de escolher uma opção numérica. As intenções possíveis são:\n' +
        '1 = GLPI - pedido DIRETO para resetar/trocar a senha do usuário do Windows/Active Directory ' +
        '(ex: "esqueci minha senha do windows", "quero resetar minha senha do glpi")\n' +
        '2 = CONECTA (resetar senha do sistema CONECTA, portal de RH)\n' +
        '3 = VITAE - pedido DIRETO para consultar ou alterar o e-mail JÁ CADASTRADO no sistema VITAE ' +
        '(ex: "quero saber meu e-mail do vitae", "preciso trocar o e-mail do vitae", "meu e-mail no vitae está ' +
        'errado"). NÃO use este código para problemas de LOGIN/ACESSO ao Vitae (não consigo entrar, não consigo ' +
        'acessar, esqueci a senha, dá erro ao tentar entrar) - isso é DUVIDA_NTI, pois antes de mexer no e-mail é ' +
        'preciso entender qual é o problema\n' +
        'EMAIL_SENHA = o usuário esqueceu a senha do e-mail corporativo (Outlook/e-mail) ou quer resetar/redefinir essa senha\n' +
        'EMAIL_NOVO = o usuário quer cadastrar/criar um e-mail corporativo novo (que ainda não existe)\n' +
        'DUVIDA_NTI = qualquer outra dúvida sobre normas/procedimentos internos do NTI do hospital - ex: voucher de ' +
        'Wi-Fi (HRN WIFI), voucher expirando antes do tempo, computador sem rede, computador não liga, impressora com ' +
        'mensagem de toner, impressora sem ligar ou sem rede, como abrir chamado no GLPI, acesso de crachá em porta, ' +
        'transferência de hospital, dúvida sobre QUAL é o usuário/login do computador ou do Windows (ou se essas ' +
        'credenciais são as mesmas do GLPI), mensagem de "usuário bloqueado" ao tentar logar no computador/Windows, ' +
        'dificuldade para manusear/utilizar a impressora de etiquetas ou qualquer outro problema com ela, ' +
        'como baixar/instalar/acessar o aplicativo CONECTA (também chamado de Beehome) ou qual o endereço de acesso ' +
        'dele, dúvida ou problema sobre o sistema Notifica, dúvida ou problema sobre o sistema Meu RH, ' +
        'não conseguir entrar/acessar o VITAE ou esquecimento de senha do VITAE, mensagem de "acesso não ' +
        'permitido" em qualquer sistema, ' +
        'ou qualquer outro procedimento administrativo do NTI que não seja um dos sistemas acima\n\n' +
        `Mensagem do usuário: "${mensagemUsuario}"\n\n` +
        'Responda com APENAS um destes tokens: 1, 2, 3, EMAIL_SENHA, EMAIL_NOVO, DUVIDA_NTI, ou 0 se não ' +
        'for possível identificar a intenção com confiança (mensagem ambígua ou fora de contexto, incluindo ' +
        'cumprimentos/saudações como oi, olá, bom dia, tudo bem?, etc. sem pedir nada específico). ' +
        'Não escreva mais nada além do token.';

    const resposta = await chamarGemini(prompt, { timeoutMs: 6000, temperature: 0, tentativas: 2, thinkingBudget: 1 });
    if (!resposta) return null;

    const token = resposta.trim().split(/\s+/)[0].toUpperCase();
    return ['1', '2', '3', 'EMAIL_SENHA', 'EMAIL_NOVO', 'DUVIDA_NTI'].includes(token) ? token : null;
}

// Reescreve uma mensagem padrão do bot para soar mais natural, preservando todo o conteúdo factual
// (números, opções, nomes de sistema, instruções). Se a IA falhar, retorna a mensagem original.
async function humanizarMensagem(mensagemBase) {
    const prompt =
        'Reescreva a mensagem abaixo, de um bot de suporte de TI interno, em português do Brasil, ' +
        'deixando o tom mais natural e conversacional, como um atendente humano digitando no WhatsApp. ' +
        'Regras: mantenha TODOS os números, opções, nomes de sistemas e instruções técnicas exatamente ' +
        'como estão (não invente nem remova nenhuma informação); pode reorganizar as frases livremente; ' +
        'pode usar negrito no formato do WhatsApp (um único asterisco de cada lado, ex: *assim*; ' +
        'NUNCA dois asteriscos, isso é Markdown e não funciona no WhatsApp). Responda só com a ' +
        'mensagem final, sem comentários sobre a tarefa.\n\n' +
        `Mensagem original:\n"""\n${mensagemBase}\n"""`;

    const resposta = await chamarGemini(prompt, { timeoutMs: 6000, temperature: 0.5, thinkingBudget: 1 });
    return resposta || mensagemBase;
}

// Compõe uma resposta do zero (não reescreve um texto pronto) a partir de fatos soltos e do
// histórico recente da conversa, reagindo ao que o usuário disse - como um atendente humano faria.
//
// IMPORTANTE (segurança): a IA aqui NUNCA decide uma ação (validar CPF, resetar senha, etc.) -
// isso continua 100% no código determinístico do bot.js. Ela só decide COMO dizer, e só pode usar
// os fatos exatos passados em `fatos` (é instruída a não inventar nenhuma informação além deles).
// Se a IA falhar/timeout, `textoFallback` é enviado como está - o atendimento nunca fica sem resposta.
async function responderNatural({ evento, fatos = {}, mensagemUsuario = '', historico = [], textoFallback }) {
    let prompt =
        'Você é um atendente humano de TI (HELPZIN) respondendo pelo WhatsApp - natural, breve e cordial, ' +
        'como uma pessoa de verdade digitaria, não como um robô lendo um roteiro decorado. ' +
        'Varie a forma de escrever a cada resposta, não repita sempre a mesma estrutura de frase.\n\n' +
        `Situação: ${evento}\n\n`;

    const fatosEntries = Object.entries(fatos);
    if (fatosEntries.length) {
        prompt += 'Fatos que você PODE usar na resposta (não invente nenhuma informação além destes, ' +
            'e não omita nenhum fato importante da lista):\n';
        for (const [chave, valor] of fatosEntries) {
            prompt += `- ${chave}: ${valor}\n`;
        }
        prompt += '\n';
    }

    if (historico.length) {
        prompt += 'Histórico recente da conversa:\n';
        for (const turno of historico) {
            prompt += `${turno.papel === 'usuario' ? 'Usuário' : 'Você'}: ${turno.texto}\n`;
        }
        prompt += '\n';
    }

    prompt += `Última mensagem do usuário: "${mensagemUsuario}"\n\n` +
        'Responda de forma natural e humana, mantendo os fatos exatamente corretos. Pode usar negrito ' +
        'no formato do WhatsApp (um único asterisco de cada lado, ex: *assim*; NUNCA dois asteriscos, ' +
        'isso é Markdown e não funciona no WhatsApp) e emojis com moderação. Responda só com a mensagem ' +
        'final, sem comentários sobre a tarefa.';

    const resposta = await chamarGemini(prompt, { timeoutMs: 6000, temperature: 0.8, thinkingBudget: 1, tentativas: 2 });
    return resposta || textoFallback;
}

// Responde uma dúvida geral do funcionário usando a base_conhecimento_nti.md como única fonte
// de verdade. Diferente de responderNatural(), aqui a IA não recebe "fatos" escolhidos a dedo -
// ela recebe as seções relevantes do documento (ver selecionarSecoesRelevantes) e precisa
// localizar a informação dentro delas sozinha.
//
// Segurança: instrução explícita pra NUNCA inventar procedimento fora do documento (mesma regra
// que o próprio documento define em "Regra de segurança da informação"). Se a base não carregou
// ou a IA falhar, cai no textoFallback (orientar a procurar o NTI).
async function responderDuvidaNTI(mensagemUsuario, { historico = [], textoFallback } = {}) {
    const base = carregarBaseConhecimento();

    const fallbackPadrao = textoFallback ||
        `🤖 Não encontrei uma orientação específica pra isso na nossa base.\n\n` +
        `📌 Procure o *NTI* pelo ramal *9385* (segunda a sexta, 07h às 17h) para te ajudar.`;

    if (!base) return fallbackPadrao;

    const textoConsulta = mensagemUsuario + ' ' + historico.map(h => h.texto).join(' ');
    const secoesRelevantes = selecionarSecoesRelevantes(textoConsulta);

    let prompt =
        'Você é um atendente humano de TI (HELPZIN) respondendo dúvidas de funcionários de um hospital pelo ' +
        'WhatsApp, com base EXCLUSIVAMENTE nas seções do documento de regras internas do NTI abaixo (um ' +
        'recorte do documento completo, com as partes relevantes pra esta conversa). ' +
        'Não invente nenhum procedimento, telefone, prazo ou sistema que não esteja no documento. ' +
        'Se a dúvida não estiver coberta pelo documento, diga que não encontrou uma orientação específica ' +
        'e sugira procurar o setor responsável ou o NTI (ramal 9385, seg-sex 07h-17h).\n\n' +
        '=== TRECHO DO DOCUMENTO DE REGRAS DO NTI ===\n' +
        `${secoesRelevantes}\n` +
        '=== FIM DO TRECHO ===\n\n';

    if (historico.length) {
        prompt += 'Histórico recente da conversa:\n';
        for (const turno of historico) {
            prompt += `${turno.papel === 'usuario' ? 'Usuário' : 'Você'}: ${turno.texto}\n`;
        }
        prompt += '\n';
    }

    prompt += `Pergunta do funcionário: "${mensagemUsuario}"\n\n` +
        'Responda de forma natural, breve e cordial, como um atendente humano digitando no WhatsApp. ' +
        'Pode usar negrito no formato do WhatsApp (um único asterisco de cada lado, ex: *assim*; NUNCA dois ' +
        'asteriscos) e emojis com moderação. Responda só com a mensagem final, sem comentários sobre a tarefa.';

    const resposta = await chamarGemini(prompt, { timeoutMs: 7000, temperature: 0.3, thinkingBudget: 1, tentativas: 2 });
    return resposta || fallbackPadrao;
}

module.exports = {
    setConfig,
    interpretarOpcaoMenu,
    responderNatural,
    humanizarMensagem,
    responderDuvidaNTI
};
