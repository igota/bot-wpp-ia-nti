// inventarioRede.js - Busca de IP de computador/impressora na planilha de inventário de rede
// (Google Sheets). Uso interno do menu oculto @nti/@nac.
//
// Segurança: a busca é 100% determinística (sem IA) - IP é dado exato, então aqui não corremos
// o risco de o modelo "aproximar" ou inventar um valor. A planilha é só-leitura via conta de
// serviço do Google Cloud (ver bot/credentials/, gitignored).

const { google } = require('googleapis');

// A planilha tem várias abas (uma por setor), mas por enquanto só coletamos dados desta aba.
const ABA_ALVO = 'ADM - 4';

let SHEETS_CONFIG = null;

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos - equilíbrio entre atualização e não estourar a API
let cache = { linhas: [], carregadoEm: 0 };

function setConfig(appConfig) {
    const sheetId = appConfig?.googleSheets?.sheetId || null;
    const keyPath = appConfig?.googleSheets?.keyPath || null;

    SHEETS_CONFIG = {
        sheetId,
        keyPath,
        ativo: Boolean(sheetId && keyPath)
    };

    console.log(SHEETS_CONFIG.ativo
        ? '✅ Inventário de rede: planilha do Google Sheets configurada'
        : '⚠️ Inventário de rede: desativado (sem GOOGLE_SHEETS_ID/GOOGLE_SERVICE_ACCOUNT_KEY_PATH no .env)');
}

function normalizar(texto) {
    return (texto || '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toUpperCase()
        .trim();
}

async function carregarPlanilha() {
    const auth = new google.auth.GoogleAuth({
        keyFile: SHEETS_CONFIG.keyPath,
        scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
    });
    const sheets = google.sheets({ version: 'v4', auth });

    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEETS_CONFIG.sheetId,
        range: `'${ABA_ALVO}'!A1:D1000`
    });

    const valores = res.data.values || [];
    const linhas = [];

    // Pula a linha 0 (cabeçalho: IP | Computador/Impressora | Sala | STATUS IP IMP)
    for (let i = 1; i < valores.length; i++) {
        const [ip, equipamento, sala, status] = valores[i];
        // Ignora linhas de IP sem equipamento/sala cadastrado (endereço livre no mapa de rede)
        if (!equipamento && !sala) continue;

        linhas.push({ aba: ABA_ALVO, ip: ip || '', equipamento: equipamento || '', sala: sala || '', status: status || '' });
    }

    return linhas;
}

async function garantirCache() {
    const expirado = Date.now() - cache.carregadoEm > CACHE_TTL_MS;
    if (!expirado && cache.linhas.length) return cache.linhas;

    cache = { linhas: await carregarPlanilha(), carregadoEm: Date.now() };
    console.log(`✅ Inventário de rede: ${cache.linhas.length} linhas carregadas da planilha`);
    return cache.linhas;
}

// Busca por texto livre (ex: "impressora uci neo", "IP CASRM-44") nas colunas Equipamento e Sala.
// Todas as palavras do termo precisam aparecer (em qualquer uma das duas colunas) para dar match -
// evita retornar a planilha inteira em buscas muito genéricas.
async function buscarEquipamento(termo) {
    if (!SHEETS_CONFIG?.ativo) return null;

    let linhas;
    try {
        linhas = await garantirCache();
    } catch (error) {
        console.warn(`⚠️ Inventário de rede: falha ao ler a planilha (${error.response?.data?.error?.message || error.message})`);
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

module.exports = {
    setConfig,
    buscarEquipamento
};
