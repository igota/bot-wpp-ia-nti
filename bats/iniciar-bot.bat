@echo off
title Iniciar WhatsApp Bot
echo ========================================
echo    Iniciando WhatsApp Bot
echo ========================================
cd /d "C:\Mega\Projeto BOT WPP\pm2"
pm2 start ecosystem.config.js
echo.
echo ✅ Bot iniciado!
echo.
pm2 status
echo.
echo Para ver os logs: pm2 logs whatsapp-bot
pause