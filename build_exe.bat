@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 桌面挂件 - 一键打包

where python >nul 2>nul
if errorlevel 1 (
    echo [错误] 未检测到 Python，请先从 https://www.python.org/downloads/ 安装
    echo        安装时务必勾选 "Add Python to PATH"
    pause
    exit /b 1
)

echo [1/2] 安装 PyInstaller ...
python -m pip install pyinstaller --quiet --disable-pip-version-warning
if errorlevel 1 (
    echo [错误] PyInstaller 安装失败，请检查网络后重试
    pause
    exit /b 1
)

echo [2/2] 打包 desktop_widget_v4.py ...
python -m PyInstaller --onefile --noconsole --clean --name 桌面挂件 desktop_widget_v4.py
if errorlevel 1 (
    echo [错误] 打包失败，请把上方报错截图反馈
    pause
    exit /b 1
)

echo.
echo ============================================
echo  打包完成！exe 文件位于：dist\桌面挂件.exe
echo  双击即可运行，可把它单独复制到任意位置
echo ============================================
pause
