// ping.js - Ping de diagnóstico de rede para uso interno do menu oculto @nti/@nac.
//
// Segurança: usa execFile (nunca exec/shell) com o IP como argumento separado, e valida
// estritamente o formato IPv4 antes de executar - evita tanto injeção de comando quanto o
// ping.exe interpretar um valor digitado como flag (ex: usuário mandando "-t", que faria
// ping contínuo e travaria a chamada).

const { execFile } = require('child_process');
const iconv = require('iconv-lite');

const IPV4_REGEX = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function validarIPv4(ip) {
    const match = ip.match(IPV4_REGEX);
    if (!match) return false;
    return match.slice(1, 5).every(octeto => Number(octeto) >= 0 && Number(octeto) <= 255);
}

function pingIP(ip) {
    return new Promise((resolve) => {
        if (!validarIPv4(ip)) {
            resolve({ ok: false, erro: 'IP inválido. Use o formato XXX.XXX.XXX.XXX (ex: 10.2.4.174).' });
            return;
        }

        // encoding: 'buffer' porque o ping.exe do Windows escreve no codepage OEM do console
        // (cp850 no Windows em pt-BR), não em UTF-8 - decodificar como string direto vira
        // "Estat�sticas" em vez de "Estatísticas".
        execFile('ping', ['-n', '4', ip], { timeout: 20000, encoding: 'buffer' }, (error, stdoutBuffer) => {
            const stdout = stdoutBuffer ? iconv.decode(stdoutBuffer, 'cp850') : '';

            // Host fora do ar/sem resposta faz o ping.exe sair com código != 0 mesmo assim
            // produzindo saída útil ("Esgotado o tempo limite do pedido.") - só trata como
            // erro de execução de verdade quando não veio saída nenhuma.
            if (error && !stdout) {
                resolve({ ok: false, erro: error.message });
                return;
            }
            resolve({ ok: true, saida: stdout.trim() });
        });
    });
}

module.exports = { pingIP, validarIPv4 };
