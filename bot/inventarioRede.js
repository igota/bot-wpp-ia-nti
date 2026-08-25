// inventarioRede.js - Busca em planilhas de inventário (Google Sheets) do menu oculto @nti/@nac:
// REDE COM FIO (IP de computador/impressora), REDE SEM FIO (dispositivos wifi por Nome/MAC) e
// MODELO IMPRESSORA (dados de contador/toner por setor, uma aba por mês).
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

function setConfig(appConfig) {
    const sheets = appConfig?.googleSheets || {};
    AUTH_CONFIG = { keyPath: sheets.keyPath || null };
    FONTES = {
        redeComFio: { sheetId: sheets.redeComFio?.sheetId || null, aba: sheets.redeComFio?.aba || null },
        redeSemFio: { sheetId: sheets.redeSemFio?.sheetId || null, aba: sheets.redeSemFio?.aba || null },
        modeloImpressora: { sheetId: sheets.modeloImpressora?.sheetId || null }
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

    return resultados.slice(0, 15);
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

    return resultados.slice(0, 15);
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

// Busca por SETOR (texto livre, todas as palavras do termo precisam aparecer). Sempre lê a aba do
// mês atual (JAN..DEZ); se essa aba ainda não existir na planilha, avisa em vez de usar mês
// anterior (dado de contador/toner desatualizado poderia levar a troca de toner errada).
async function buscarModeloImpressora(termo) {
    if (!FONTES?.modeloImpressora?.sheetId || !AUTH_CONFIG?.keyPath) return null;

    const aba = abaDoMesAtual();
    let cache;
    try {
        cache = await garantirCacheImpressora(aba);
    } catch (error) {
        const mensagemApi = error.response?.data?.error?.message || error.message;
        // A API do Sheets retorna 400 quando a aba pedida não existe - é o caso normal de "mês
        // ainda não criado", não um erro de configuração.
        if (error.code === 400 || /unable to parse range/i.test(mensagemApi)) {
            return { abaNaoEncontrada: true, mesEsperado: aba };
        }
        console.warn(`⚠️ Inventário de rede: falha ao ler a planilha MODELO IMPRESSORA (${mensagemApi})`);
        return null;
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

    return resultados.slice(0, 15);
}

module.exports = {
    setConfig,
    buscarEquipamento,
    buscarRedeSemFio,
    buscarModeloImpressora
};
