@echo off
title Reiniciar Todos os Serviços
echo ========================================
echo    Reiniciando todos os serviços
echo ========================================
cd /d "C:\Mega\Projeto BOT WPP\pm2"
pm2 restart all
echo.
echo ✅ Todos os serviços reiniciados!
echo.
pm2 status
pause