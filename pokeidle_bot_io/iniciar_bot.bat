@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Iniciando bot de captura do pokeidle.io ...
echo Pode minimizar este CMD. Mantenha o Chrome aberto em uma hunt.
where python >nul 2>nul
if %errorlevel%==0 (
    python bot_local.py
) else (
    py -3 bot_local.py
)
echo.
echo Processo encerrado. Veja bot.log se houver erros.
pause
