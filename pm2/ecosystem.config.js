module.exports = {
  apps: [
    {
      name: 'whatsapp-bot-ia-proto',
      script: '../bot/bot.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      cwd: 'C:/Mega/Projeto BOT WPP - IA/bot',
      // Todas as credenciais e URLs de sistemas ficam em bot/.env (gitignored), carregado
      // por bot/config.js independente de como o processo é iniciado. Este bloco só define
      // o que é config de processo (não segredo) - não adicione credenciais aqui de volta.
      env: {
        NODE_ENV: 'production'
      },
      error_file: './logs/whatsapp-error.log',
      out_file: './logs/whatsapp-out.log',
      log_file: './logs/whatsapp-combined.log',
      time: true,
      kill_timeout: 15000,
      restart_delay: 5000,
      exp_backoff_restart_delay: 100,
      min_uptime: '5s',
      max_restarts: 10
    },
    {
      name: 'reset-senha-api-ia-proto',
      script: 'run.py',
      interpreter: 'python',
      cwd: 'C:/Mega/Projeto BOT WPP - IA/servidor',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      // Todas as credenciais e configurações ficam em servidor/.env (gitignored), carregado
      // por servidor/app.py via load_dotenv() - não adicione credenciais aqui de volta.
      env: {},
      error_file: './logs/python-error.log',
      out_file: './logs/python-out.log',
      log_file: './logs/python-combined.log',
      time: true,
      kill_timeout: 30000,
      restart_delay: 5000
    }
  ]
};