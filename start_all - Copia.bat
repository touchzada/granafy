@echo off
title Securo Finance - Iniciar Tudo
echo ===================================================
echo   Iniciando Securo Finance + AI + SynaBun...
echo ===================================================

:: 1. PostgreSQL
echo [1/6] Iniciando Banco de Dados PostgreSQL...
start "PostgreSQL (Securo)" cmd /c "cd /d %~dp0 & tools\pgsql\bin\postgres.exe -D tools\pgsql\data"

:: 2. Redis
echo [2/6] Iniciando Redis Cache...
start "Redis (Securo)" cmd /c "cd /d %~dp0 & tools\redis\redis-server.exe"

:: 3. SynaBun
echo [3/6] Iniciando SynaBun Local Memory...
start "SynaBun (HTTP Server)" cmd /k "cd /d C:\Users\Bruno\Documents\Individuais\Synabun\mcp-server & npm run dev:http"

:: Aguardar Banco e Redis Subirem
timeout /t 3 /nobreak >nul

:: 4. Backend (FastAPI)
echo [4/6] Iniciando Backend da IA e API...
start "FastAPI Backend" cmd /k "cd /d %~dp0backend & call venv\Scripts\activate.bat & uvicorn app.main:app --reload --port 8000"

:: 5. Worker (Celery)
echo [5/6] Iniciando Processamento em Segundo Plano...
start "Celery Worker" cmd /k "cd /d %~dp0backend & call venv\Scripts\activate.bat & python -m celery -A app.worker.celery_app worker --loglevel=info --pool=solo"

:: 6. Frontend (Vite)
echo [6/6] Iniciando Frontend React...
start "Vite Frontend" cmd /k "cd /d %~dp0frontend & npm run dev"

echo.
echo ===================================================
echo ✅ Todos os servicos foram iniciados com sucesso!
echo 🌐 Acesse o Securo em: http://localhost:5173
echo ===================================================
pause
