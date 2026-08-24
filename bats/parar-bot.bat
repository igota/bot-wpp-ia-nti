@echo off
title Parar WhatsApp Bot
echo ========================================
echo    Parando WhatsApp Bot
echo ========================================
cd /d "C:\Mega\Projeto BOT WPP\pm2"
pm2 stop whatsapp-bot reset-senha-api
echo.
echo ✅ Serviços parados!
echo.
pm2 status
pause