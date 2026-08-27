// notificacoesSobreaviso.js - Agendamento de avisos automáticos de sobreaviso via WhatsApp.
// Duas vezes por dia (08:00 e 15:55) verifica quem está de sobreaviso hoje (mesma lógica da opção
// 4 do menu PLANILHAS, ver inventarioRede.buscarSobreaviso) e manda uma mensagem pro WhatsApp da
// pessoa - mas só se o nome dela estiver cadastrado em json/sobreaviso_contatos.json.
//
// 🔥 MODO TESTE: por enquanto o arquivo de contatos só tem "Igor Maciel de Sousa" cadastrado, então
// só ele recebe mensagem de verdade - qualquer outra pessoa escalada é ignorada (só loga). Pra
// habilitar o resto da equipe, basta adicionar o nome (exatamente como aparece na planilha), o
// número de WhatsApp e o gênero ("M" ou "F") nesse JSON - não precisa mexer em código. Formato:
// { "Nome Completo": { "numero": "88999999999", "genero": "M" } }

const fs = require('fs');
const path = require('path');
const inventarioRede = require('./inventarioRede');

const CAMINHO_CONTATOS = path.join(__dirname, 'json', 'sobreaviso_contatos.json');
const HORARIOS_ENVIO = ['08:00', '15:55'];

// {termo} vira "bixinha" (genero: "F") ou "bixin" (qualquer outro valor, default "M").
const MENSAGEM =
    'Eiii {nome}, não esquece de levar o sobreaviso, hoje é tu viu {termo}! Coloca na bolsa. ' +
    'E verifica se não tá me levando kkkk. Vlw, flw. 😂';

function termoPorGenero(genero) {
    return (genero || '').toUpperCase() === 'F' ? 'bixinha' : 'bixin';
}

function carregarContatos() {
    try {
        return JSON.parse(fs.readFileSync(CAMINHO_CONTATOS, 'utf-8'));
    } catch (error) {
        console.warn(`⚠️ Sobreaviso: não foi possível carregar sobreaviso_contatos.json (${error.message})`);
        return {};
    }
}

function normalizarNome(nome) {
    return (nome || '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .trim().toLowerCase();
}

function primeiroNome(nomeCompleto) {
    return (nomeCompleto || '').trim().split(/\s+/)[0] || nomeCompleto;
}

// Resolve o número (formato livre, ex: "88999290293") pro ID de WhatsApp de verdade antes de
// mandar - client.getNumberId confirma que o número existe no WhatsApp e devolve o formato exato
// que o client.sendMessage espera (evita mandar às cegas pra um JID montado na mão).
async function enviarParaNumero(client, numero, texto) {
    const numeroLimpo = numero.replace(/\D/g, '');
    const comDDI = numeroLimpo.startsWith('55') ? numeroLimpo : `55${numeroLimpo}`;

    try {
        const idResolvido = await client.getNumberId(comDDI);
        if (!idResolvido) {
            console.warn(`⚠️ Sobreaviso: número ${numero} não está registrado no WhatsApp - mensagem não enviada`);
            return false;
        }
        await client.sendMessage(idResolvido._serialized, texto);
        return true;
    } catch (error) {
        console.warn(`⚠️ Sobreaviso: falha ao enviar mensagem pra ${numero} (${error.message})`);
        return false;
    }
}

async function verificarEEnviar(client) {
    const resultado = await inventarioRede.buscarSobreaviso();
    if (!resultado || resultado.abaNaoEncontrada || !resultado.pessoas?.length) {
        console.log('ℹ️ Sobreaviso: nenhum sobreaviso encontrado pra hoje (ou planilha indisponível) - nenhuma mensagem enviada');
        return;
    }

    const contatos = carregarContatos();
    const contatosNormalizados = {};
    for (const [nome, contato] of Object.entries(contatos)) {
        contatosNormalizados[normalizarNome(nome)] = contato;
    }

    for (const pessoa of resultado.pessoas) {
        const contato = contatosNormalizados[normalizarNome(pessoa.nome)];
        if (!contato?.numero) {
            console.log(`ℹ️ Sobreaviso: ${pessoa.nome} está de sobreaviso hoje, mas não tem número cadastrado (modo teste) - não enviado`);
            continue;
        }

        const texto = MENSAGEM
            .replace('{nome}', primeiroNome(pessoa.nome))
            .replace('{termo}', termoPorGenero(contato.genero));
        const enviado = await enviarParaNumero(client, contato.numero, texto);
        console.log(enviado
            ? `✅ Sobreaviso: mensagem enviada pra ${pessoa.nome} (${pessoa.turno})`
            : `⚠️ Sobreaviso: falha ao enviar mensagem pra ${pessoa.nome}`);
    }
}

// Calcula o próximo Date em que `horaAlvo` ("HH:MM") vai acontecer - hoje, se ainda não passou, ou
// amanhã no mesmo horário caso contrário.
function proximaOcorrencia(horaAlvo) {
    const [h, m] = horaAlvo.split(':').map(Number);
    const agora = new Date();
    const alvo = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate(), h, m, 0, 0);
    if (alvo <= agora) alvo.setDate(alvo.getDate() + 1);
    return alvo;
}

// Agenda um único setTimeout pro próximo horário exato (em vez de ficar checando o relógio em
// loop) - ao disparar, executa a verificação e já se reagenda pro dia seguinte no mesmo horário.
function agendarProximoDisparo(client, horaAlvo) {
    const alvo = proximaOcorrencia(horaAlvo);
    const esperaMs = alvo.getTime() - Date.now();

    console.log(`⏰ Sobreaviso: próximo envio das ${horaAlvo} agendado para ${alvo.toLocaleString('pt-BR')}`);

    setTimeout(() => {
        console.log(`⏰ Sobreaviso: disparando verificação agendada das ${horaAlvo}`);
        verificarEEnviar(client).catch(error => {
            console.error(`❌ Sobreaviso: erro na verificação agendada (${error.message})`);
        });
        agendarProximoDisparo(client, horaAlvo);
    }, esperaMs);
}

function iniciarAgendamento(client) {
    for (const horario of HORARIOS_ENVIO) {
        agendarProximoDisparo(client, horario);
    }
    console.log(`✅ Sobreaviso: agendamento ativo (envio às ${HORARIOS_ENVIO.join(' e ')})`);
}

module.exports = { iniciarAgendamento };
