@echo off
title KEM BOT SHOP
color 0B
cls

echo ======================================================
echo                  KEM BOT SHOP v2.5
echo ======================================================
echo.

if not exist "node_modules\" (
    echo [*] Dang cai dat thu vien, vui long cho...
    call npm install
)

echo [*] Dang khoi dong Bot...
echo [*] Nhan Ctrl + C de dung.
echo.

node src/bot.js

echo.
echo [!] Bot da dung.
pause
