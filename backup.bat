@echo off
setlocal enabledelayedexpansion

:: Define backup root directory
set "BACKUP_ROOT=backups"

:: Get date and time using PowerShell (More reliable than WMIC)
for /f "usebackq tokens=*" %%a in (`powershell -Command "Get-Date -Format 'yyyyMMdd_HHmmss'"`) do set TIMESTAMP=%%a

set "TARGET_DIR=%BACKUP_ROOT%\backup_%TIMESTAMP%"

echo ==========================================
echo      INICIANDO BACKUP DO SISTEMA
echo ==========================================
echo.
echo [1/3] Criando pasta de destino...
echo Destino: %TARGET_DIR%
if not exist "%TARGET_DIR%" mkdir "%TARGET_DIR%"

echo.
echo [2/3] Copiando arquivos...
echo (Isso pode levar alguns segundos...)

:: Robocopy Options:
:: /E  :: Copy subdirectories, including Empty ones.
:: /DCOPY:T :: Copy Directory Timestamps.
:: /XJ :: Exclude Junction points (prevents loops).
:: /XD :: Exclude Directories.
:: /XF :: Exclude Files.
:: /R:1 /W:1 :: Retry once, wait 1 sec on error.
:: REMOVED /ZB (Requires Admin rights)

robocopy . "%TARGET_DIR%" /E /DCOPY:T /XJ ^
 /XD node_modules .git dist backups .vscode coverage .idea ^
 /XF *.log *.tmp *.lock

:: Check Robocopy Exit Code (0-7 is success/partial success)
if %ERRORLEVEL% LSS 8 (
    echo.
    echo [3/3] Backup concluido com sucesso!
) else (
    echo.
    echo [ERRO] Houve falhas durante a copia. Codigo: %ERRORLEVEL%
)

echo.
echo Backup salvo em: %CD%\%TARGET_DIR%
echo ==========================================
pause
