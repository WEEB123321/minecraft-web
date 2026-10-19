@echo off
chcp 65001 >nul
title 方块世界 - 推送到 GitHub
cd /d "%~dp0"

echo ==================================================
echo    方块世界 - 推送到 GitHub
echo ==================================================
echo.
echo  本脚本用 git 命令行推送，不受网页 25MB 限制。
echo  推送体积约 172MB，首次视网络需要几分钟。
echo.
echo  前提：已在 GitHub 网页上创建好一个【空仓库】
echo        （不要勾选 Add a README / .gitignore / license）
echo.

set /p GHUSER=请输入 GitHub 用户名:
if "%GHUSER%"=="" goto :bad
set /p GHREPO=请输入仓库名（例如 cube-world）:
if "%GHREPO%"=="" goto :bad

set "REMOTE=https://github.com/%GHUSER%/%GHREPO%.git"

echo.
echo  目标仓库: %REMOTE%
echo.

git remote remove origin >nul 2>nul
git remote add origin "%REMOTE%"
git branch -M main

echo  开始推送。首次会弹出 GitHub 登录窗口，请完成授权...
echo.
git push -u origin main

if errorlevel 1 (
  echo.
  echo  --------------------------------------------------
  echo  [失败] 推送没有完成。常见原因：
  echo    1. 仓库名拼错，或仓库还没创建
  echo    2. 登录授权窗口被关闭 / 没有完成授权
  echo    3. 创建仓库时勾选了 README，仓库不是空的
  echo.
  echo  若是第 3 种，执行下面这条后再重新运行本脚本：
  echo    git pull origin main --allow-unrelated-histories
  echo.
  echo  若反复要求登录，改用 Token 方式：
  echo    用户名填 GitHub 用户名，密码位置粘贴 Personal Access Token
  echo    （GitHub - Settings - Developer settings - Tokens 生成，勾选 repo）
  echo  --------------------------------------------------
) else (
  echo.
  echo  --------------------------------------------------
  echo  [成功] 代码已推送到 GitHub。
  echo.
  echo  接下来开启网页访问：
  echo    仓库页 - Settings - Pages
  echo    Source 选 Deploy from a branch
  echo    分支选 main，目录选 / (root)，保存
  echo.
  echo  约 1 分钟后访问：
  echo    https://%GHUSER%.github.io/%GHREPO%/
  echo  --------------------------------------------------
)

echo.
pause
exit /b 0

:bad
echo.
echo [错误] 用户名和仓库名都不能为空。
pause
exit /b 1
