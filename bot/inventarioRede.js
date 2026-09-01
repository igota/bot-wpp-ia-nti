// inventarioRede.js - Busca em planilhas de inventário (Google Sheets): REDE COM FIO (IP de
// computador/impressora), REDE SEM FIO (dispositivos wifi por Nome/MAC), MODELO IMPRESSORA (dados
// de contador/toner por setor, uma aba por mês) e SOBREAVISO, todas do menu oculto @nti/@nac; e
// RAMAIS (telefone por setor), essa aberta a qualquer funcionário pelo menu principal do bot.
//
// Segurança: a busca é 100% determinística (sem IA) - o dado retornado é sempre uma linha exata
// da planilha, então aqui não corremos o risco de o modelo "aproximar" ou inventar um valor. As
// planilhas são só-leitura via conta de serviço do Google Cloud (ver bot/credentials/, gitignored).

const { google } = require('googleapis');

const MESES = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos - equilíbrio entre atualização e não estourar a API

let AUTH_CONFIG = null; // { keyPath }
let FONTES = null; // { redeComFio, redeSemFio, modeloImpressora }, cada uma com { sheetId, aba? }

let cacheRedeComFio = { linhas: [], carregadoEm: 0 };
let cacheRedeSemFio = { linhas: [], carregadoEm: 0 };
let cacheImpressora = { aba: null, registrosSetor: [], lookupToner: new Map(), carregadoEm: 0 };
let cacheRamais = { linhas: [], carregadoEm: 0 };

function setConfig(appConfig) {
    const sheets = appConfig?.googleSheets || {};
    AUTH_CONFIG = { keyPath: sheets.keyPath || null };
    FONTES = {
        redeComFio: { sheetId: sheets.redeComFio?.sheetId || null, aba: sheets.redeComFio?.aba || null },
        redeSemFio: { sheetId: sheets.redeSemFio?.sheetId || null, aba: sheets.redeSemFio?.aba || null },
        modeloImpressora: { sheetId: sheets.modeloImpressora?.sheetId || null },
        sobreaviso: { sheetId: sheets.sobreaviso?.sheetId || null },
        ramais: { sheetId: sheets.ramais?.sheetId || null, aba: sheets.ramais?.aba || null }
    };

    const status = (nome, fonte) => {
        const ativo = Boolean(AUTH_CONFIG.keyPath && fonte.sheetId);
        console.log(ativo
            ? `✅ Inventário de rede: planilha ${nome} configurada`
            : `⚠️ Inventário de rede: ${nome} desativado (sem GOOGLE_SERVICE_ACCOUNT_KEY_PATH ou ID da planilha no .env)`);
    };
    status('REDE COM FIO', FONTES.redeComFio);
    status('REDE SEM FIO', FONTES.redeSemFio);
    status('MODELO IMPRESSORA', FONTES.modeloImpressora);
    status('SOBREAVISO', FONTES.sobreaviso);
    status('RAMAIS', FONTES.ramais);
}

function normalizar(texto) {
    return (texto || '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toUpperCase()
        .trim();
}

// Normaliza cabeçalho de coluna para casar por nome mesmo com variação de pontuação/espaço
// (ex: "CONT.ATUAL", "CONT. ATUAL" e "Cont Atual" viram todos "CONTATUAL").
function normalizarCabecalho(texto) {
    return normalizar(texto).replace(/[^A-Z0-9]/g, '');
}

function getSheetsClient() {
    const auth = new google.auth.GoogleAuth({
        keyFile: AUTH_CONFIG.keyPath,
        scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
    });
    return google.sheets({ version: 'v4', auth });
}

// Lê uma aba inteira e devolve { cabecalhos: [...], linhas: [[...], ...] } (linhas após o
// cabeçalho). `linhaCabecalho` é o índice (0-based) da linha que tem os títulos de coluna -
// normalmente 0 (primeira linha), mas algumas planilhas têm uma linha de título acima do
// cabeçalho de verdade (ex: MODELO IMPRESSORA).
async function lerAba(sheetId, aba, linhaCabecalho = 0) {
    const sheets = getSheetsClient();
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: `'${aba}'!A1:Z1000`
    });
    const valores = res.data.values || [];
    const cabecalhos = valores[linhaCabecalho] || [];
    const linhas = valores.slice(linhaCabecalho + 1);
    return { cabecalhos, linhas };
}

// Dado o cabeçalho de uma aba, monta { NOMECOLUNA: [indices...] } para acesso por nome em vez de
// letra. Guarda todas as ocorrências (não só a última) porque algumas planilhas repetem o mesmo
// título de coluna em blocos diferentes da mesma aba (ex: MODELO IMPRESSORA tem "SERIE" e
// "CONT.ATUAL" duas vezes, em tabelas não relacionadas).
function indiceColunas(cabecalhos) {
    const indices = {};
    cabecalhos.forEach((titulo, i) => {
        const chave = normalizarCabecalho(titulo);
        if (!chave) return;
        (indices[chave] = indices[chave] || []).push(i);
    });
    return indices;
}

// Índice da N-ésima ocorrência (0-based) de uma coluna pelo nome normalizado, ou undefined se a
// coluna não existe na aba.
function nesimoIndice(indices, chave, ocorrencia = 0) {
    return indices[chave]?.[ocorrencia];
}

// ==================== REDE COM FIO (IP de computador/impressora) ====================

async function carregarRedeComFio() {
    const { aba, sheetId } = FONTES.redeComFio;
    const { linhas: linhasBrutas } = await lerAba(sheetId, aba);
    const linhas = [];

    // Cabeçalho conhecido: IP | Computador/Impressora | Sala | STATUS IP IMP
    for (const [ip, equipamento, sala, status] of linhasBrutas) {
        // Ignora linhas de IP sem equipamento/sala cadastrado (endereço livre no mapa de rede)
        if (!equipamento && !sala) continue;
        linhas.push({ aba, ip: ip || '', equipamento: equipamento || '', sala: sala || '', status: status || '' });
    }
    return linhas;
}

async function garantirCacheRedeComFio() {
    const expirado = Date.now() - cacheRedeComFio.carregadoEm > CACHE_TTL_MS;
    if (!expirado && cacheRedeComFio.linhas.length) return cacheRedeComFio.linhas;

    cacheRedeComFio = { linhas: await carregarRedeComFio(), carregadoEm: Date.now() };
    console.log(`✅ Inventário de rede: ${cacheRedeComFio.linhas.length} linhas carregadas da planilha REDE COM FIO`);
    return cacheRedeComFio.linhas;
}

// Busca por texto livre (ex: "impressora uci neo", "IP CASRM-44") nas colunas Equipamento e Sala.
// Todas as palavras do termo precisam aparecer (em qualquer uma das duas colunas) para dar match -
// evita retornar a planilha inteira em buscas muito genéricas.
async function buscarEquipamento(termo) {
    if (!FONTES?.redeComFio?.sheetId || !AUTH_CONFIG?.keyPath) return null;

    let linhas;
    try {
        linhas = await garantirCacheRedeComFio();
    } catch (error) {
        console.warn(`⚠️ Inventário de rede: falha ao ler a planilha REDE COM FIO (${error.response?.data?.error?.message || error.message})`);
        return null;
    }

    // Na planilha, impressoras são identificadas pelo prefixo "IMP-" no campo Equipamento (ex:
    // "IMP-174"), não pela palavra "impressora" por extenso - então tratamos isso à parte em vez
    // de exigir a palavra literal no texto da linha.
    const PALAVRAS_IMPRESSORA = ['IMPRESSORA', 'IMPRESSORAS'];
    let palavras = normalizar(termo).split(/\s+/).filter(Boolean);
    const buscaImpressora = palavras.some(p => PALAVRAS_IMPRESSORA.includes(p));
    palavras = palavras.filter(p => !PALAVRAS_IMPRESSORA.includes(p));

    if (!palavras.length && !buscaImpressora) return [];

    let resultados = linhas.filter(linha => {
        const alvo = normalizar(`${linha.equipamento} ${linha.sala}`);
        return palavras.every(palavra => alvo.includes(palavra));
    });

    if (buscaImpressora) {
        resultados = resultados.filter(linha => normalizar(linha.equipamento).startsWith('IMP'));
    }

    return resultados.slice(0, 30);
}

// ==================== REDE SEM FIO (dispositivos wifi por Nome/MAC) ====================

async function carregarRedeSemFio() {
    const { aba, sheetId } = FONTES.redeSemFio;
    const { cabecalhos, linhas: linhasBrutas } = await lerAba(sheetId, aba);
    const indices = indiceColunas(cabecalhos);
    const iNome = nesimoIndice(indices, 'NOME');
    const iMac = nesimoIndice(indices, 'MAC');

    const linhas = [];
    for (const linha of linhasBrutas) {
        const nome = iNome !== undefined ? (linha[iNome] || '') : '';
        const mac = iMac !== undefined ? (linha[iMac] || '') : '';
        if (!nome && !mac) continue;
        linhas.push({ nome, mac });
    }
    return linhas;
}

async function garantirCacheRedeSemFio() {
    const expirado = Date.now() - cacheRedeSemFio.carregadoEm > CACHE_TTL_MS;
    if (!expirado && cacheRedeSemFio.linhas.length) return cacheRedeSemFio.linhas;

    cacheRedeSemFio = { linhas: await carregarRedeSemFio(), carregadoEm: Date.now() };
    console.log(`✅ Inventário de rede: ${cacheRedeSemFio.linhas.length} linhas carregadas da planilha REDE SEM FIO`);
    return cacheRedeSemFio.linhas;
}

// Busca por texto livre no Nome OU no MAC do dispositivo (todas as palavras do termo precisam
// aparecer em um dos dois campos).
async function buscarRedeSemFio(termo) {
    if (!FONTES?.redeSemFio?.sheetId || !AUTH_CONFIG?.keyPath) return null;

    let linhas;
    try {
        linhas = await garantirCacheRedeSemFio();
    } catch (error) {
        console.warn(`⚠️ Inventário de rede: falha ao ler a planilha REDE SEM FIO (${error.response?.data?.error?.message || error.message})`);
        return null;
    }

    const palavras = normalizar(termo).split(/\s+/).filter(Boolean);
    if (!palavras.length) return [];

    const resultados = linhas.filter(linha => {
        const alvo = normalizar(`${linha.nome} ${linha.mac}`);
        return palavras.every(palavra => alvo.includes(palavra));
    });

    return resultados.slice(0, 30);
}

// ==================== MODELO IMPRESSORA (contador/toner por setor, uma aba por mês) ====================
//
// Cada aba mensal tem, lado a lado, DUAS tabelas não alinhadas por linha:
//   - tabela do setor:   SETOR | EQUIP. | SERIE | CONT. ANT | CONT. ATUAL | TOTAL
//   - tabela de toner:   SERIE | CONT.ATUAL | (vazio) | IMPRESSORA | QDE. | MOD. TONER
// (a linha 1 é um título solto acima do cabeçalho de verdade, que fica na linha 2)
//
// O MOD.TONER de um equipamento não está na mesma linha do setor - tem que procurar o valor de
// EQUIP. na coluna IMPRESSORA da tabela de toner (em qualquer linha da aba) e pegar o MOD.TONER
// daquela linha.

function abaDoMesAtual() {
    return MESES[new Date().getMonth()];
}

async function garantirCacheImpressora(aba) {
    const expirado = Date.now() - cacheImpressora.carregadoEm > CACHE_TTL_MS;
    if (!expirado && cacheImpressora.aba === aba && cacheImpressora.registrosSetor.length) {
        return cacheImpressora;
    }

    const { sheetId } = FONTES.modeloImpressora;
    const { cabecalhos, linhas: linhasBrutas } = await lerAba(sheetId, aba, 1);
    const indices = indiceColunas(cabecalhos);
    const iSetor = nesimoIndice(indices, 'SETOR');
    const iEquip = nesimoIndice(indices, 'EQUIP');
    const iSerieSetor = nesimoIndice(indices, 'SERIE', 0);
    const iContAtualSetor = nesimoIndice(indices, 'CONTATUAL', 0);
    const iImpressora = nesimoIndice(indices, 'IMPRESSORA');
    const iModToner = nesimoIndice(indices, 'MODTONER');

    const registrosSetor = [];
    const lookupToner = new Map();

    for (const linha of linhasBrutas) {
        const setor = iSetor !== undefined ? (linha[iSetor] || '') : '';
        if (setor) {
            registrosSetor.push({
                setor,
                equip: iEquip !== undefined ? (linha[iEquip] || '') : '',
                serie: iSerieSetor !== undefined ? (linha[iSerieSetor] || '') : '',
                contAtual: iContAtualSetor !== undefined ? (linha[iContAtualSetor] || '') : ''
            });
        }

        const impressora = iImpressora !== undefined ? (linha[iImpressora] || '') : '';
        if (impressora) {
            lookupToner.set(normalizar(impressora), iModToner !== undefined ? (linha[iModToner] || '') : '');
        }
    }

    cacheImpressora = { aba, registrosSetor, lookupToner, carregadoEm: Date.now() };
    console.log(`✅ Inventário de rede: ${registrosSetor.length} setores / ${lookupToner.size} modelos de toner carregados da planilha MODELO IMPRESSORA (aba ${aba})`);
    return cacheImpressora;
}

function mesAnteriorA(aba) {
    const idx = MESES.indexOf(aba);
    return MESES[(idx - 1 + MESES.length) % MESES.length];
}

// Busca por SETOR (texto livre, todas as palavras do termo precisam aparecer). Sempre tenta a aba
// do mês atual primeiro (JAN..DEZ) - se ela já existir na planilha, usa sempre essa (dado mais
// atual). Se ainda não existir (mês recém-virado e planilha não preenchida), cai pro mês anterior
// em vez de simplesmente não mostrar nada; só avisa "ainda não disponível" se nem o mês anterior
// existir.
async function buscarModeloImpressora(termo) {
    if (!FONTES?.modeloImpressora?.sheetId || !AUTH_CONFIG?.keyPath) return null;

    const abaAtual = abaDoMesAtual();
    let cache;
    let aba = abaAtual;
    try {
        cache = await garantirCacheImpressora(abaAtual);
    } catch (error) {
        const mensagemApi = error.response?.data?.error?.message || error.message;
        // A API do Sheets retorna 400 quando a aba pedida não existe - é o caso normal de "mês
        // ainda não criado", não um erro de configuração.
        if (error.code === 400 || /unable to parse range/i.test(mensagemApi)) {
            const abaAnterior = mesAnteriorA(abaAtual);
            try {
                cache = await garantirCacheImpressora(abaAnterior);
                aba = abaAnterior;
            } catch (error2) {
                const mensagemApi2 = error2.response?.data?.error?.message || error2.message;
                if (error2.code === 400 || /unable to parse range/i.test(mensagemApi2)) {
                    return { abaNaoEncontrada: true, mesEsperado: abaAtual };
                }
                console.warn(`⚠️ Inventário de rede: falha ao ler a planilha MODELO IMPRESSORA (${mensagemApi2})`);
                return null;
            }
        } else {
            console.warn(`⚠️ Inventário de rede: falha ao ler a planilha MODELO IMPRESSORA (${mensagemApi})`);
            return null;
        }
    }

    const palavras = normalizar(termo).split(/\s+/).filter(Boolean);
    if (!palavras.length) return [];

    const resultados = cache.registrosSetor
        .filter(registro => {
            const alvo = normalizar(registro.setor);
            return palavras.every(palavra => alvo.includes(palavra));
        })
        .map(registro => ({
            ...registro,
            modToner: cache.lookupToner.get(normalizar(registro.equip)) ?? ''
        }));

    const finalResultados = resultados.slice(0, 30);
    finalResultados.abaUsada = aba;
    finalResultados.abaDesatualizada = aba !== abaAtual;
    return finalResultados;
}

// ==================== SOBREAVISO (quem está de plantão agora, uma aba por mês) ====================
//
// Grade "SETOR | FUNÇÃO | NOME | 1 | 2 | ... | 31 | TOTAL | TOTAL ORIGINAL" (cabeçalho na linha 5,
// índice 4) - cada linha é um funcionário, cada coluna de dia guarda o código do turno daquele dia
// (M1, M2, F = férias, L = licença, ou vazio = não está de sobreaviso). Pela LEGENDA da própria aba:
//   M1: 17h às 07h do dia seguinte (14h contínuas)
//   M2: 07h às 07h do dia seguinte (24h contínuas)
// A consulta é sempre pelo dia de HOJE (data corrente) e traz M1 e M2 juntos - as duas pessoas que
// cobrem o dia inteiro, não só quem estaria tecnicamente "no turno" na hora exata da consulta.
//
// Nomenclatura das abas: o mês corrente (e o seguinte, já planejado) usa só a abreviação de 3
// letras ("AGO", "SET"); quando o mês vira, alguém arquiva renomeando a aba pra "MES AA" (ex:
// "JUL 26"). Por isso tentamos a abreviação pura primeiro e caímos pro nome com ano se não existir.

const LABEL_TURNO = { M1: 'M1 (17h às 07h)', M2: 'M2 (07h às 07h, 24h)' };
const CODIGOS_SOBREAVISO = ['M1', 'M2'];

function candidatosAbaSobreaviso(data) {
    const abrev = MESES[data.getMonth()];
    const anoCurto = String(data.getFullYear()).slice(-2);
    return [abrev, `${abrev} ${anoCurto}`];
}

// Lê a grade de uma aba de SOBREAVISO - range mais largo que lerAba() porque a grade tem colunas
// até a AJ (dia 31 + 2 colunas de total, lerAba() só vai até a Z). Tenta cada nome candidato até
// um funcionar; se nenhum existir, relança o erro da última tentativa (tratado por quem chama).
async function lerAbaSobreaviso(sheetId, candidatos) {
    const sheets = getSheetsClient();
    let ultimoErro;
    for (const aba of candidatos) {
        try {
            const res = await sheets.spreadsheets.values.get({
                spreadsheetId: sheetId,
                range: `'${aba}'!A1:AJ60`
            });
            return { aba, valores: res.data.values || [] };
        } catch (error) {
            ultimoErro = error;
        }
    }
    throw ultimoErro;
}

// Diferente das outras 3 planilhas (buscas por termo, sujeitas a rajada de mensagens), SOBREAVISO
// é uma consulta pontual (o usuário escolhe a opção 4 e recebe a resposta na hora) - por isso lê a
// planilha direto a cada chamada, sem cache, pra sempre refletir edições recentes na escala.
async function carregarAbaSobreaviso(candidatos) {
    const { sheetId } = FONTES.sobreaviso;
    const { aba, valores } = await lerAbaSobreaviso(sheetId, candidatos);

    const diaParaIndice = {};
    (valores[4] || []).forEach((titulo, i) => {
        const texto = String(titulo || '').trim();
        if (/^\d+$/.test(texto)) diaParaIndice[texto] = i;
    });

    // Linhas de funcionário têm SETOR, FUNÇÃO e NOME preenchidos - isso separa a grade da linha em
    // branco e do bloco de LEGENDA logo abaixo, sem depender de um número fixo de linhas de dados.
    const linhas = valores.slice(5)
        .filter(linha => linha[0] && linha[1] && linha[2])
        .map(linha => ({ setor: linha[0], funcao: linha[1], nome: linha[2], dias: linha }));

    console.log(`✅ Inventário de rede: ${linhas.length} funcionários lidos da planilha SOBREAVISO (aba ${aba})`);
    return { diaParaIndice, linhas };
}

// Identifica quem está de sobreaviso hoje (M1 e M2, o dia inteiro). Diferente das outras buscas,
// não recebe termo - é sempre a consulta da data atual.
async function buscarSobreaviso() {
    if (!FONTES?.sobreaviso?.sheetId || !AUTH_CONFIG?.keyPath) return null;

    const diaAlvo = new Date();
    const codigos = CODIGOS_SOBREAVISO;
    const candidatos = candidatosAbaSobreaviso(diaAlvo);

    let aba;
    try {
        aba = await carregarAbaSobreaviso(candidatos);
    } catch (error) {
        const mensagemApi = error.response?.data?.error?.message || error.message;
        // A API do Sheets retorna 400 quando a aba pedida não existe - é o caso normal de "mês
        // ainda não criado/nomeado", não um erro de configuração.
        if (error.code === 400 || /unable to parse range/i.test(mensagemApi)) {
            return { abaNaoEncontrada: true, mesEsperado: candidatos[0] };
        }
        console.warn(`⚠️ Inventário de rede: falha ao ler a planilha SOBREAVISO (${mensagemApi})`);
        return null;
    }

    const indiceDia = aba.diaParaIndice[String(diaAlvo.getDate())];
    if (indiceDia === undefined) return { data: diaAlvo, codigos, pessoas: [] };

    const pessoas = [];
    for (const linha of aba.linhas) {
        const codigo = String(linha.dias[indiceDia] || '').trim().toUpperCase();
        if (codigos.includes(codigo)) {
            pessoas.push({
                setor: linha.setor,
                funcao: linha.funcao,
                nome: linha.nome,
                codigo,
                turno: LABEL_TURNO[codigo] || codigo
            });
        }
    }

    return { data: diaAlvo, codigos, pessoas };
}

// ==================== RAMAIS (telefone por setor - aberto a qualquer funcionário) ====================
//
// Aba "LISTA EM UPDATE": linha 1 é um título solto ("LISTA TELEFÔNICA - RAMAIS EM ORDEM NUMÉRICA"),
// cabeçalho de verdade na linha 2 (RAMAL | SETOR | LOCALIZAÇÃO | SUBLOCALIZAÇÃO). O mesmo SETOR se
// repete em várias linhas (um ramal por sublocalização), então a busca considera as 3 colunas de
// texto - não só SETOR - pra deixar o funcionário refinar (ex: "farmácia central").

async function carregarRamais() {
    const { sheetId, aba } = FONTES.ramais;
    const { cabecalhos, linhas: linhasBrutas } = await lerAba(sheetId, aba, 1);
    const indices = indiceColunas(cabecalhos);
    const iRamal = nesimoIndice(indices, 'RAMAL');
    const iSetor = nesimoIndice(indices, 'SETOR');
    const iLocalizacao = nesimoIndice(indices, 'LOCALIZACAO');
    const iSublocalizacao = nesimoIndice(indices, 'SUBLOCALIZACAO');

    const linhas = [];
    for (const linha of linhasBrutas) {
        const ramal = iRamal !== undefined ? (linha[iRamal] || '') : '';
        const setor = iSetor !== undefined ? (linha[iSetor] || '') : '';
        if (!ramal || !setor) continue;
        linhas.push({
            ramal,
            setor,
            localizacao: iLocalizacao !== undefined ? (linha[iLocalizacao] || '') : '',
            sublocalizacao: iSublocalizacao !== undefined ? (linha[iSublocalizacao] || '') : ''
        });
    }
    return linhas;
}

async function garantirCacheRamais() {
    const expirado = Date.now() - cacheRamais.carregadoEm > CACHE_TTL_MS;
    if (!expirado && cacheRamais.linhas.length) return cacheRamais.linhas;

    cacheRamais = { linhas: await carregarRamais(), carregadoEm: Date.now() };
    console.log(`✅ Inventário de rede: ${cacheRamais.linhas.length} ramais carregados da planilha RAMAIS`);
    return cacheRamais.linhas;
}

// Busca por texto livre (ex: "farmácia", "uti adulto", "nac faturamento") em RAMAL, SETOR,
// LOCALIZAÇÃO e SUBLOCALIZAÇÃO. Todas as palavras do termo precisam aparecer (em qualquer um dos
// quatro campos) - incluir RAMAL permite que o funcionário também digite direto o número do ramal
// (ex: "9312") pra descobrir de quem é.
async function buscarRamal(termo) {
    if (!FONTES?.ramais?.sheetId || !AUTH_CONFIG?.keyPath) return null;

    let linhas;
    try {
        linhas = await garantirCacheRamais();
    } catch (error) {
        console.warn(`⚠️ Inventário de rede: falha ao ler a planilha RAMAIS (${error.response?.data?.error?.message || error.message})`);
        return null;
    }

    const palavras = normalizar(termo).split(/\s+/).filter(Boolean);
    if (!palavras.length) return [];

    const resultados = linhas.filter(linha => {
        const alvo = normalizar(`${linha.ramal} ${linha.setor} ${linha.localizacao} ${linha.sublocalizacao}`);
        return palavras.every(palavra => alvo.includes(palavra));
    });

    return resultados.slice(0, 30);
}

module.exports = {
    setConfig,
    buscarEquipamento,
    buscarRedeSemFio,
    buscarModeloImpressora,
    buscarSobreaviso,
    buscarRamal
};
