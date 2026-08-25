// config.js
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// 🔥 DEBUG: Verificar se as variáveis estão carregando
console.log('=== CONFIG.JS LOADED ===');
console.log('EMAIL_USER:', process.env.EMAIL_USER ? '✅' : '❌');
console.log('EMAIL_PASS:', process.env.EMAIL_PASS ? '✅' : '❌');
console.log('VITAE_URL:', process.env.VITAE_URL ? '✅' : '❌');
console.log('CONECTA_API_URL:', process.env.CONECTA_API_URL ? '✅' : '❌');
console.log('========================');

module.exports = {
    // Email Configurations
    email: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
        service: process.env.EMAIL_SERVICE || 'gmail'
    },
    
    // GLPI/AD Configurations
    glpi: {
        adServer: process.env.GLPI_AD_SERVER,
        adDomain: process.env.GLPI_AD_DOMAIN,
        username: process.env.GLPI_AD_USER,
        password: process.env.GLPI_AD_PASS
    },
    
    // CONECTA Configurations
    conecta: {
        apiUrl: process.env.CONECTA_API_URL,
        username: process.env.CONECTA_USERNAME,
        password: process.env.CONECTA_PASSWORD,
        novaSenha: process.env.CONECTA_NOVA_SENHA
    },
    
    // VITAE Configurations
    vitae: {
        url: process.env.VITAE_URL,
        username: process.env.VITAE_USERNAME,
        password: process.env.VITAE_PASSWORD
    },
    
    // Bot Configurations
    bot: {
        timeoutInatividade: parseInt(process.env.TIMEOUT_INATIVIDADE_MINUTES) || 5,
        maxReconnectAttempts: parseInt(process.env.MAX_RECONNECT_ATTEMPTS) || 5,
        sessionCleanupInterval: parseInt(process.env.SESSION_CLEANUP_INTERVAL_MINUTES) || 5,
        // Allowlist de operadores do menu oculto @nti/@nac (JIDs do WhatsApp), separados por
        // vírgula no .env. Sem essa variável configurada, a allowlist fica vazia - ninguém
        // acessa o menu oculto, em vez de liberar geral por engano.
        numerosNti: (process.env.NUMEROS_NTI || '').split(',').map(n => n.trim()).filter(Boolean),
        numerosNac: (process.env.NUMEROS_NAC || '').split(',').map(n => n.trim()).filter(Boolean)
    },
    
    // WhatsApp Configurations
    whatsapp: {
        headless: process.env.PUPPETEER_HEADLESS === 'true' || true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: (process.env.PUPPETEER_ARGS || '--no-sandbox,--disable-setuid-sandbox').split(',')
    },

    // IA (protótipo - Google Gemini free tier)
    ia: {
        apiKey: process.env.GEMINI_API_KEY,
        modelo: process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
        ativo: process.env.IA_ATIVA !== 'false'
    },

    // Planilhas de inventário (IPs, dispositivos wifi, modelos de impressora) - uso interno @nti/@nac
    // Todas as 3 planilhas são lidas pela mesma service account (keyPath compartilhado).
    googleSheets: {
        keyPath: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH
            ? path.join(__dirname, process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH)
            : null,
        redeComFio: {
            sheetId: process.env.GOOGLE_SHEETS_ID,
            aba: 'ADM - 4'
        },
        redeSemFio: {
            sheetId: process.env.GOOGLE_SHEETS_ID_WIFI,
            aba: 'HRN ADM'
        },
        modeloImpressora: {
            sheetId: process.env.GOOGLE_SHEETS_ID_IMPRESSORA
            // aba é escolhida em tempo de execução (mês atual: JAN..DEZ), ver inventarioRede.js
        }
    }
};