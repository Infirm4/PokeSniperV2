@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Instalando apenas o controle local (nao precisa Playwright)...
where python >nul 2>nul
if %errorlevel%==0 (
    python -m pip install -r requirements.txt
) else (
    py -3 -m pip install -r requirements.txt
)
if errorlevel 1 (
    echo ERRO ao instalar. Envie uma foto desta tela.
    pause
    exit /b 1
)
echo.
echo Concluido! Agora instale a pasta extensao_chrome em chrome://extensions
pause
