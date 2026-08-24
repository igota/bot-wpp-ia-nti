@echo off
cd /d "C:\Mega\Projeto BOT WPP\pm2"
pm2 stop whatsapp-bot
cd /d "C:\Mega\Projeto BOT WPP\bot"
rmdir /s /q .wwebjs_auth 2>nul
rmdir /s /q .wwebjs_cache 2>nul
cd /d "C:\Mega\Projeto BOT WPP\pm2"
pm2 start whatsapp-bot
echo Cache limpo e bot reiniciado!
pm2 status
pause