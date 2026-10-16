@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 正在启动腹透日记，稍候会自动打开浏览器...
start "" http://localhost:8080
node server.js
pause