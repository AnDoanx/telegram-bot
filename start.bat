@echo off
chcp 65001 > nul
title 👾 [KEM BOT SHOP] - TELEGRAM AUTOMATION CORE
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
echo   ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
echo               ✦ KEM BOT SHOP - TELEGRAM AUTOMATED SYSTEM v2.5 ✦
echo   ──────────────────────────────────────────────────────────────────────────────────────────
echo.
echo    [1] 🚀 Khởi chạy Bot ngay
echo    [2] 🎨 Đổi màu giao diện (Color Themes)
echo    [3] ❌ Thoát
echo.
set /p OPT="  👉 Chọn thao tác [1/2/3]: "

if "%OPT%"=="1" goto RUN_BOT
if "%OPT%"=="2" goto COLOR_SETTINGS
if "%OPT%"=="3" exit /b
goto MAIN_MENU

:: ========================================
:: MENU ĐỔI MÀU GIAO DIỆN
:: ========================================
:COLOR_SETTINGS
cls
echo.
echo    ┌────────────────────────────────────────────────────────────┐
echo    │             🎨 BẢNG CHỌN MÀU THEME RETRO PIXEL            │
echo    └────────────────────────────────────────────────────────────┘
echo.
echo    [1] 💧 Cyan Neon (Mặc định)
echo    [2] 💚 Hacker Green (Xanh lá Matrix)
echo    [3] 💜 Cyberpunk Purple (Tím neon)
echo    [4] 💛 Retro Amber (Vàng hổ phách)
echo    [5] 🤍 High-Tech White (Trắng sáng)
echo    [6] ◀️  Quay lại Menu chính
echo.
set /p C_OPT="  👉 Chọn màu bạn thích [1-6]: "

if "%C_OPT%"=="1" set THEME_COLOR=0B
if "%C_OPT%"=="2" set THEME_COLOR=0A
if "%C_OPT%"=="3" set THEME_COLOR=0D
if "%C_OPT%"=="4" set THEME_COLOR=0E
if "%C_OPT%"=="5" set THEME_COLOR=0F
if "%C_OPT%"=="6" goto MAIN_MENU

color %THEME_COLOR%
goto MAIN_MENU

:: ========================================
:: TIẾN TRÌNH KHỞI CHẠY BOT
:: ========================================
:RUN_BOT
cls
echo.
echo    ✦ KEM BOT SHOP - HỆ THỐNG ĐANG KHỞI ĐỘNG...
echo   ────────────────────────────────────────────────────────────

:: 1. Kiểm tra Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    color 0C
    echo   [✖] LỖI: Máy tính chưa cài đặt Node.js!
    echo   [!] Tải và cài đặt tại: https://nodejs.org/
    echo.
    pause
    exit /b
)

for /f "tokens=*" %%v in ('node -v') do set NODE_VER=%%v
echo   [◆] CORE RUNTIME : Node.js %NODE_VER% [OK]

:: 2. Kiểm tra file .env
if not exist ".env" (
    color 0E
    echo   [▲] CẢNH BÁO: Chưa tìm thấy file [.env]
    if exist ".env.example" (
        copy .env.example .env > nul
        echo   [+] Đã tự tạo file [.env] từ [.env.example]
        echo   [!] Vui lòng mở file .env nhập Bot Token và API rồi chạy lại!
    ) else (
        echo   [✖] Không tìm thấy file mẫu .env.example!
    )
    echo.
    pause
    exit /b
)
echo   [◆] CONFIG FILE  : .env loaded [OK]

:: 3. Kiểm tra Dependencies
if not exist "node_modules\" (
    echo.
    echo   ┌────────────────────────────────────────────────────────────┐
    echo   │ [!] PHÁT HIỆN THIẾU THƯ VIỆN -> ĐANG TỰ CÀI ĐẶT...        │
    echo   └────────────────────────────────────────────────────────────┘
    echo.
    call npm install
    if %errorlevel% neq 0 (
        color 0C
        echo   [✖] Cài đặt dependencies thất bại! Kiểm tra mạng.
        pause
        exit /b
    )
    cls
)

:: 4. Hiệu ứng khởi động
echo   [◆] STATUS       : INITIALIZING KEM BOT ENGINE...
echo.
echo   [██████████████████████████████████████████████████] 100%%
echo.
echo   ┌────────────────────────────────────────────────────────────┐
echo   │  🎮 KEM BOT SHOP ĐÃ SẴN SÀNG HOẠT ĐỘNG!                    │
echo   │  💡 Nhấn phím [Ctrl + C] nếu muốn tạm dừng Bot             │
echo   └────────────────────────────────────────────────────────────┘
echo.

node src/bot.js

:: 5. Xử lý khi ngắt hoặc gặp lỗi
echo.
echo   ────────────────────────────────────────────────────────────
color 0C
echo   [✖] TIẾN TRÌNH BOT ĐÃ DỪNG HOẶC GẶP SỰ CỐ!
echo   [!] Vui lòng kiểm tra lại log lỗi bên trên trước khi tắt.
echo   ────────────────────────────────────────────────────────────
echo.
pause > nul
