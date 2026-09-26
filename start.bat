@echo off
chcp 65001 > nul
title 🚀 TELEGRAM SHOP BOT - PRODUCTION LAUNCHER
color 0B
cls

echo.
echo  ╭──────────────────────────────────────────────────────────╮
echo  │                                                          │
echo  │          ⚡ TELEGRAM AUTOMATED SHOP BOT SYSTEM ⚡        │
echo  │                                                          │
echo  ╰──────────────────────────────────────────────────────────╯
echo.

:: 1. Kiểm tra môi trường Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    color 0C
    echo  [✖] LỖI: Chưa cài đặt Node.js trên máy tính!
    echo  [→] Vui lòng tải và cài đặt tại: https://nodejs.org/
    echo.
    pause
    exit /b
)

for /f "tokens=*" %%v in ('node -v') do set NODE_VER=%%v
echo  [✔] Môi trường: Node.js %NODE_VER% đã sẵn sàng.

:: 2. Kiểm tra file cấu hình .env
if not exist ".env" (
    color 0E
    echo  [!] CẢNH BÁO: Chưa tìm thấy file cấu hình [.env]!
    echo  [→] Đang tạo file .env từ file mẫu .env.example...
    if exist ".env.example" (
        copy .env.example .env > nul
        echo  [✔] Đã tạo file .env. Vui lòng mở ra điền Token và API trước khi chạy lại!
    ) else (
        echo  [✖] Không tìm thấy cả file .env.example để sao chép!
    )
    echo.
    pause
    exit /b
)

:: 3. Kiểm tra và tự động cài đặt thư viện
if not exist "node_modules\" (
    echo.
    echo  ╭──────────────────────────────────────────────────────────╮
    echo  │  [!] Đang cài đặt thư viện cần thiết (npm install)...    │
    echo  │      Quá trình này chỉ diễn ra ở lần chạy đầu tiên.      │
    echo  ╰──────────────────────────────────────────────────────────╯
    echo.
    call npm install
    if %errorlevel% neq 0 (
        color 0C
        echo.
        echo  [✖] Cài đặt dependencies thất bại! Vui lòng kiểm tra lại mạng.
        pause
        exit /b
    )
    cls
    echo.
    echo  [✔] Cài đặt thư viện thành công!
    echo.
)

:: 4. Khởi chạy Bot
echo.
echo  ────────────────────────────────────────────────────────────
echo   [*] Trạng thái : ĐANG KHỞI CHẠY TIẾN TRÌNH BOT...
echo   [*] Phím tắt   : Nhấn [Ctrl + C] nếu muốn dừng Bot
echo  ────────────────────────────────────────────────────────────
echo.

node src/bot.js

:: 5. Xử lý khi Bot bị ngắt hoặc gặp sự cố
echo.
echo  ────────────────────────────────────────────────────────────
color 0C
echo  [!] Tiến trình Bot đã dừng lại (Exit Code: %errorlevel%).
echo  [!] Vui lòng xem log lỗi ở trên trước khi bấm phím để tắt.
echo  ────────────────────────────────────────────────────────────
echo.
pause > nul
