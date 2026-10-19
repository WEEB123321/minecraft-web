@echo off
chcp 65001 >nul
title 方块世界 - 本地服务器
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  echo [错误] 没有找到 Python。
  echo 请先安装 Python 3 ^( https://www.python.org/downloads/ ^)，
  echo 或者直接用浏览器打开 mc\1.8.8\index.html 打开游戏（单文件客户端，无需服务器也能玩）。
  pause
  exit /b 1
)

echo 正在启动 方块世界 本地服务器...
python serve.py %*
pause
