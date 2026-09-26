@echo off
chcp 65001 > nul
title [KEM BOT SHOP] - TELEGRAM AUTOMATION CORE
set THEME_COLOR=0B
color %THEME_COLOR%
cls

:MAIN_MENU
cls
echo.
echo    ██╗  ██╗███████╗███╗   ███╗    ██████╗  ██████╗ ████████╗    ███████╗██╗  ██╗ ██████╗ ██████╗ 
echo    ██║ ██╔╝██╔════╝████╗ ████║    ██╔══██╗██╔═══██╗╚══██╔══╝    ██╔════╝██║  ██║██╔═══██╗██╔══██╗
echo    █████╔╝ █████╗  ██╔████╔██║    ██████╔╝██║   ██║   ██║       ███████╗███████║██║   ██║██████╔╝
echo    ██╔═██╗ ██╔══╝  ██║╚██╔╝██║    ██╔══██╗██║   ██║   ██║       ╚════██║██╔══██║██║   ██║██╔═══╝ 
echo    ██║  ██╗███████╗██║ ╚═╝ ██║    ██████╔╝╚██████╔╝   ██║       ███████║██║  ██║╚██████╔╝██║     
echo    ╚═╝  ╚═╝╚══════╝╚═╝     ╚═╝    ╚═════╝  ╚═════╝    ╚═╝       ╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚═╝     
echo   ......................................................................................................
echo               + KEM BOT SHOP - TELEGRAM AUTOMATED SYSTEM v2.5 +
echo   ------------------------------------------------------------------------------------------
echo.
echo    [1] Khởi chạy Bot ngay
echo    [2] Đổi màu giao diện (Color Themes)
echo    [3] Thoát
echo.
set /p OPT="  >> Chọn thao tác (1/2/3): "

if "%OPT%"=="1" goto RUN_BOT
if "%OPT%"=="2" goto COLOR_SETTINGS
if "%OPT%"=="3" exit /b
goto MAIN_MENU

:COLOR_SETTINGS
cls
echo.
echo    ------------------------------------------------------------
echo                  BANG CHON MAU GIAO DIEN
echo    ------------------------------------------------------------
echo.
echo    [1] Cyan Neon (Mac dinh)
echo    [2] Hacker Green (Xanh la)
echo    [3] Cyberpunk Purple (Tim neon)
echo    [4] Retro Amber (Vang ho phach)
echo    [5] High-Tech White (Trang sang)
echo    [6] Quay lai Menu chinh
echo.
set /p C_OPT="  >> Chon mau ban thich (1-6): "

if "%C_OPT%"=="1" set THEME_COLOR=0B
if "%C_OPT%"=="2" set THEME_COLOR=0A
if "%C_OPT%"=="3" set THEME_COLOR=0D
if "%C_OPT%"=="4" set THEME_COLOR=0E
if "%C_OPT%"=="5" set THEME_COLOR=0F
if "%C_OPT%"=="6" goto MAIN_MENU

color %THEME_COLOR%
goto MAIN_MENU

:RUN_BOT
cls
echo.
echo    + KEM BOT SHOP - HE THONG DANG KHOI DONG...
echo   ------------------------------------------------------------

:: 1. Kiem tra Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    color 0C
    echo   [X] LOI: May tinh chua cai dat Node.js!
    echo   [!] Tai va cai dat tai: https://nodejs.org/
    echo.
    pause
    exit /b
)

for /f "tokens=*" %%v in ('node -v') do set NODE_VER=%%v
echo   [OK] CORE RUNTIME : Node.js %NODE_VER%

:: 2. Kiem tra file .env
if not exist ".env" (
    color 0E
    echo   [!] CANH BAO: Chua tim thay file .env
    if exist ".env.example" (
        copy .env.example .env > nul
        echo   [+] Da tu tao file .env tu .env.example
        echo   [!] Vui long mo file .env nhap Bot Token va API roi chay lai!
    ) else (
        echo   [X] Khong tim thay file mau .env.example!
    )
    echo.
    pause
    exit /b
)
echo   [OK] CONFIG FILE  : .env loaded

:: 3. Kiem tra Dependencies
if not exist "node_modules\" (
    echo.
    echo   ------------------------------------------------------------
    echo    [!] PHAT HIEN THIEU THU VIEN - DANG TU CAI DAT...
    echo   ------------------------------------------------------------
    echo.
    call npm install
    if %errorlevel% neq 0 (
        color 0C
        echo   [X] Cai dat dependencies that bai! Kiem tra mang.
        pause
        exit /b
    )
    cls
)

:: 4. Tien trinh khoi chay
echo   [OK] STATUS       : INITIALIZING KEM BOT ENGINE...
echo.
echo   [==================================================] 100%%
echo.
echo   ------------------------------------------------------------
echo    * KEM BOT SHOP DA SAN SANG HOAT DONG!
echo    * Nhan phim [Ctrl + C] neu muon tam dung Bot
echo   ------------------------------------------------------------
echo.

node src/bot.js

:: 5. Xu ly khi ngat hoac gap loi
echo.
echo   ------------------------------------------------------------
color 0C
echo   [X] TIEN TRINH BOT DA DUNG HOAC GAP SU CO!
echo   [!] Vui long kiem tra lai log loi ben tren truoc khi tat.
echo   ------------------------------------------------------------
echo.
pause > nul
