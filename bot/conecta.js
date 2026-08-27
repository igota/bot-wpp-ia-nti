// conecta.js - Módulo para integração com o CONECTA via API

const axios = require('axios');
const path = require('path');

// 🔥 VARIÁVEIS QUE SERÃO CARREGADAS DO .env
let CONECTA_API_CONFIG = null;
let NOVA_SENHA = null;
let conectaAuthToken = null;
let transporter = null;
let config = null;

// 🔥 NOVA FUNÇÃO setTransporter ATUALIZADA
function setTransporter(mailTransporter, appConfig) {
    transporter = mailTransporter;
    config = appConfig;

    console.log('🔍 CONECTA: Recebendo configurações...');

    // Exige as configurações do .env - sem fallback com credenciais hardcoded.
    if (!config?.conecta?.password || !config?.conecta?.novaSenha) {
        throw new Error('CONECTA: credenciais não configuradas - defina CONECTA_API_URL, CONECTA_USERNAME, CONECTA_PASSWORD e CONECTA_NOVA_SENHA no .env');
    }

    CONECTA_API_CONFIG = {
        baseURL: config.conecta.apiUrl || 'https://isghconecta.mybeehome.com',
        loginUrl: '/api/userdata/dosafelogin',
        buscarUsuarioUrl: '/api/directory/list/datatable/generic',
        buscarDadosUsuarioUrl: '/api/directory/full',
        updateUserUrl: '/api/directory/admin/',
        username: config.conecta.username,
        password: config.conecta.password,
        tenant: 'isghconecta'
    };

    NOVA_SENHA = config.conecta.novaSenha;

    console.log('✅ CONECTA: Configurações carregadas do .env');
    console.log(`   baseURL: ${CONECTA_API_CONFIG.baseURL}`);
    console.log(`   username: ${CONECTA_API_CONFIG.username}`);
    console.log(`   tenant: ${CONECTA_API_CONFIG.tenant}`);
}

// Funções auxiliares
function converterTimestampParaData(timestamp) {
    if (!timestamp || timestamp === 'Não informada') return null;
    const data = new Date(timestamp);
    const dia = String(data.getUTCDate()).padStart(2, '0');
    const mes = String(data.getUTCMonth() + 1).padStart(2, '0');
    const ano = data.getUTCFullYear();
    return `${dia}/${mes}/${ano}`;
}

function limparEmail(email) {
    if (!email || email === 'Não informado') return null;
    return email.replace(/_INATIVO_/gi, '');
}

// Função para enviar código por email (CONECTA)
async function enviarCodigoEmailConecta(email, codigo, nome) {
    if (!transporter) {
        console.error('❌ Transporter não configurado');
        return false;
    }
    
    console.log(`📧 Tentando enviar email CONECTA para: ${email}`);
    
    const fromEmail = config?.email?.user || 'cleanleito@gmail.com';
    
    const mailOptions = {
        from: `"Suporte TI - Reset de Senha" <${fromEmail}>`,
        to: email,
        subject: '🔐 Código de Verificação - Reset de Senha CONECTA',
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #667eea;">🔐 Código de Verificação</h2>
                <p>Olá <strong>${nome}</strong>,</p>
                <p>Recebemos uma solicitação para resetar sua senha no sistema <strong>CONECTA</strong>.</p>
                <p>Utilize o código abaixo para confirmar a operação:</p>
                <div style="background-color: #f0f4ff; padding: 20px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 5px; border-radius: 10px; margin: 20px 0;">
                    ${codigo}
                </div>
                <p>Este código é válido por <strong>10 minutos</strong>.</p>
                <p>Se você não solicitou esta alteração, ignore este e-mail.</p>
                <hr style="margin: 20px 0;">
                <p style="color: #888; font-size: 12px;">⚠️ Mantenha este código em segurança. Não compartilhe com ninguém.</p>
            </div>
        `
    };

    try {
        const info = await transporter.sendMail(mailOptions);
        console.log(`✅ Email CONECTA enviado para ${email}`);
        return true;
    } catch (error) {
        console.error(`❌ Erro ao enviar email CONECTA: ${error.message}`);
        return false;
    }
}

async function conectaLogin() {
    console.log(`🔐 Login no CONECTA via API...`);
    
    if (!CONECTA_API_CONFIG) {
        console.error('❌ CONECTA: Configurações não carregadas');
        console.error('   CONECTA_API_CONFIG está vazio!');
        return false;
    }
    
    console.log(`   URL: ${CONECTA_API_CONFIG.baseURL}${CONECTA_API_CONFIG.loginUrl}`);
    console.log(`   Username: ${CONECTA_API_CONFIG.username}`);
    console.log(`   Tenant: ${CONECTA_API_CONFIG.tenant}`);
    
    try {
        const response = await axios.post(`${CONECTA_API_CONFIG.baseURL}${CONECTA_API_CONFIG.loginUrl}`, {
            username: CONECTA_API_CONFIG.username,
            password: CONECTA_API_CONFIG.password,
            tennant: CONECTA_API_CONFIG.tenant,
            recaptchaToken: " ",
            reCaptchaType: ""
        }, {
            headers: {
                'Content-Type': 'application/json',
                'Origin': CONECTA_API_CONFIG.baseURL,
                'Referer': `${CONECTA_API_CONFIG.baseURL}/login`
            },
            timeout: 10000  // Aumentei para 10 segundos
        });
        
        console.log(`   Status: ${response.status}`);
        console.log(`   Resposta:`, response.data);
        
        if (response.data && response.data.token) {
            conectaAuthToken = response.data.token;
            console.log(`✅ Login no CONECTA realizado! Token: ${conectaAuthToken.substring(0, 20)}...`);
            return true;
        }
        
        console.error('❌ Resposta não contém token');
        return false;
    } catch (error) {
        console.error(`❌ Erro no login do CONECTA:`);
        if (error.response) {
            console.error(`   Status: ${error.response.status}`);
            console.error(`   Data:`, error.response.data);
        } else if (error.request) {
            console.error(`   Sem resposta do servidor: ${error.message}`);
        } else {
            console.error(`   Erro: ${error.message}`);
        }
        return false;
    }
}

// Refaz login e repete a requisição quando o token expirou (401/403)
async function conectaRequest(requestFn) {
    if (!conectaAuthToken) {
        const logado = await conectaLogin();
        if (!logado) throw new Error('Falha no login do CONECTA');
    }

    try {
        return await requestFn(conectaAuthToken);
    } catch (error) {
        const status = error.response?.status;
        if (status === 401 || status === 403) {
            console.warn(`⚠️ CONECTA: token expirado (status ${status}), refazendo login...`);
            conectaAuthToken = null;
            const logado = await conectaLogin();
            if (!logado) throw error;
            return await requestFn(conectaAuthToken);
        }
        throw error;
    }
}

async function buscarUsuarioPorCPF(cpf) {
    console.log(`🔍 Buscando usuário no CONECTA pelo CPF: ${cpf}`);
    const startTime = Date.now();

    if (!CONECTA_API_CONFIG) {
        console.error('❌ CONECTA: Configurações não carregadas');
        return null;
    }

    try {
        const response = await conectaRequest(token => axios.get(`${CONECTA_API_CONFIG.baseURL}${CONECTA_API_CONFIG.buscarUsuarioUrl}`, {
            params: {
                first: 0,
                pagesize: 30,
                statusList: 'ATIVO,INATIVO,PENDENTE,SENHA_EXPIRADA,RECUSOU_TERMO,BLOQUEADO',
                text: cpf,
                isNewUserStatusLogic: true,
                allUserInfo: true
            },
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            timeout: 5000
        }));
        
        // A API já filtra o resultado pelo parâmetro "text" (CPF) no servidor;
        // os itens da lista não trazem document/cpf/username para filtrar aqui.
        const usuarios = response.data?.data?.list || [];
        const usuario = usuarios[0];

        if (!usuario) return null;
        
        console.log(`✅ Usuário encontrado: ${usuario.fullName}`);
        return {
            id: usuario.id,
            fullName: usuario.fullName,
            email: limparEmail(usuario.email),
            status: usuario.status,
            dataNascimento: usuario.birthday ? converterTimestampParaData(usuario.birthday) : null,
            dataAdmissao: (usuario.admissionDate || usuario.hireDate) ? converterTimestampParaData(usuario.admissionDate || usuario.hireDate) : null,
            cargo: usuario.jobTitle || 'N/A'
        };
    } catch (error) {
        console.error(`❌ Erro na busca: ${error.message}`);
        return null;
    }
}

async function resetarSenhaConectaPorCPF(cpf) {
    console.log(`🔐 Resetando senha no CONECTA para CPF: ${cpf}`);
    
    if (!CONECTA_API_CONFIG) {
        return { success: false, error: 'Configurações não carregadas' };
    }
    
    const usuario = await buscarUsuarioPorCPF(cpf);
    if (!usuario) return { success: false, error: 'Usuário não encontrado' };
    
    try {
        const payload = {
            ...usuario,
            password: NOVA_SENHA,
            temporaryPassword: true
        };
        delete payload.lastUpdatedOn;
        delete payload.passwordChangedOn;
        delete payload.firstLogin;
        delete payload.temporaryPasswordChangedOn;
        
        const response = await conectaRequest(token => axios.put(
            `${CONECTA_API_CONFIG.baseURL}${CONECTA_API_CONFIG.updateUserUrl}?userId=${usuario.id}`,
            payload,
            {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                timeout: 5000
            }
        ));
        
        if (response.status === 200) {
            console.log(`✅ Senha resetada para: ${usuario.fullName}`);
            return { success: true, nome: usuario.fullName };
        }
        return { success: false, error: `Status ${response.status}` };
    } catch (error) {
        console.error(`❌ Erro:`, error.response?.data || error.message);
        return { success: false, error: error.response?.data || error.message };
    }
}

// Função para resetar a senha no CONECTA por ID (mais confiável)
async function resetarSenhaConectaPorId(userId) {
    console.log(`🔐 Resetando senha no CONECTA para ID: ${userId}`);
    
    if (!CONECTA_API_CONFIG) {
        return { success: false, error: 'Configurações não carregadas' };
    }
    
    try {
        // Busca dados completos do usuário
        const dadosCompletos = await conectaBuscarDadosCompletos(userId);
        
        if (!dadosCompletos) {
            return { success: false, error: 'Não foi possível obter dados do usuário' };
        }
        
        // Prepara payload para atualização
        const payload = {
            ...dadosCompletos,
            password: NOVA_SENHA,
            temporaryPassword: true  // Força troca no próximo login
        };
        
        // Remove campos que podem causar conflito
        delete payload.lastUpdatedOn;
        delete payload.passwordChangedOn;
        delete payload.firstLogin;
        delete payload.temporaryPasswordChangedOn;
        
        // Envia requisição PUT para atualizar
        const response = await conectaRequest(token => axios.put(
            `${CONECTA_API_CONFIG.baseURL}${CONECTA_API_CONFIG.updateUserUrl}?userId=${userId}`,
            payload,
            {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            }
        ));
        
        if (response.status === 200) {
            console.log(`✅ Senha resetada com sucesso para ID: ${userId}`);
            return { success: true, nome: dadosCompletos.fullName };
        }
        
        return { success: false, error: `Status ${response.status}` };
        
    } catch (error) {
        console.error(`❌ Erro no reset do CONECTA:`, error.response?.data || error.message);
        return { success: false, error: error.response?.data || error.message };
    }
}

// 🔥 NOVA FUNÇÃO: Buscar dados de segurança (para validação de perguntas)
async function buscarDadosSeguranca(cpf) {
    console.log(`🔍 Buscando dados de segurança para o CPF: ${cpf}`);
    
    const usuario = await buscarUsuarioPorCPF(cpf);
    
    if (!usuario) {
        return null;
    }
    
    return {
        dataNascimento: usuario.dataNascimento,
        dataAdmissao: usuario.dataAdmissao,
        cargo: usuario.cargo,
        nomeCompleto: usuario.fullName,
        email: limparEmail(usuario.email) 
    };
}

// Remove acentos (ex: "João" -> "Joao") - a base do CONECTA guarda os nomes sem diacríticos, então
// buscar com o texto acentuado como o funcionário digitou não bate nada no servidor deles.
function removerAcentos(texto) {
    return (texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Função para buscar usuário no CONECTA pelo Nome Completo
async function buscarUsuariosPorNome(nomeCompleto) {
    console.log(`🔍 Buscando usuários no CONECTA pelo nome: ${nomeCompleto}`);

    if (!CONECTA_API_CONFIG) {
        console.error('❌ CONECTA: Configurações não carregadas');
        return [];
    }

    const termoBusca = removerAcentos(nomeCompleto);

    try {
        const response = await conectaRequest(token => axios.get(`${CONECTA_API_CONFIG.baseURL}${CONECTA_API_CONFIG.buscarUsuarioUrl}`, {
            params: {
                first: 0,
                pagesize: 30,
                statusList: 'ATIVO,INATIVO,PENDENTE,SENHA_EXPIRADA,RECUSOU_TERMO,BLOQUEADO',
                text: termoBusca,
                isNewUserStatusLogic: true,
                allUserInfo: false
            },
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        }));

        if (response.data && response.data.data && response.data.data.list && response.data.data.list.length > 0) {
            // Filtra para garantir que o nome corresponde (compara sem acento nos dois lados, já
            // que tanto o texto digitado quanto o nome vindo da API podem ou não ter diacríticos)
            const usuariosFiltrados = response.data.data.list.filter(usuario =>
                usuario.fullName && removerAcentos(usuario.fullName).toLowerCase().includes(termoBusca.toLowerCase())
            );
            
            // Para cada usuário, busca dados completos
            const usuariosCompletos = [];
            for (const usuario of usuariosFiltrados) {
                const dadosCompletos = await conectaBuscarDadosCompletos(usuario.id);
                usuariosCompletos.push({
                    id: usuario.id,
                    nomeCompleto: usuario.fullName,
                    email: limparEmail(dadosCompletos?.email || usuario.email),
                    cargo: dadosCompletos?.jobTitle || 'N/A',
                    status: usuario.status,
                    document: usuario.document || usuario.cpf
                });
            }
            
            console.log(`✅ Encontrados ${usuariosCompletos.length} usuários para o nome: ${nomeCompleto}`);
            return usuariosCompletos;
        }
        
        console.log(`❌ Nenhum usuário encontrado para o nome: ${nomeCompleto}`);
        return [];
        
    } catch (error) {
        console.error(`❌ Erro na busca por nome: ${error.response?.data || error.message}`);
        return [];
    }
}

// Função para buscar dados completos do usuário
async function conectaBuscarDadosCompletos(userId) {
    console.log(`🔍 Buscando dados completos do usuário ID: ${userId}`);
    
    if (!CONECTA_API_CONFIG) {
        console.error('❌ CONECTA: Configurações não carregadas');
        return null;
    }
    
    try {
        const response = await conectaRequest(token => axios.get(`${CONECTA_API_CONFIG.baseURL}${CONECTA_API_CONFIG.buscarDadosUsuarioUrl}/${userId}`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        }));
        
        if (response.data) {
            console.log(`✅ Dados completos obtidos para: ${response.data.fullName}`);
            return response.data;
        }
        
        return null;
        
    } catch (error) {
        console.error(`❌ Erro ao buscar dados completos: ${error.response?.data || error.message}`);
        return null;
    }
}

// Exportar funções
module.exports = { 
    setTransporter,
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
    NOVA_SENHA
};