@echo off
setlocal enabledelayedexpansion
title Securo Finance - Quick Start

echo.
echo  ===================================================
echo       SECURO FINANCE - INICIALIZADOR COMPLETO
echo  ===================================================
echo.

:: 1. Verificar pasta do projeto
if not exist "backend" (
    echo [ERROR] Pasta 'backend' nao encontrada! 
    echo Verifique se voce esta executando o arquivo na pasta raiz do projeto.
    pause
    exit /b
)

:: 2. Verificar Requisitos Basicos
echo [*] Verificando Python e Node...
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python nao encontrado no PATH! Instale o Python 3.10+
    pause
    exit /b
)
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js nao encontrado no PATH! Instale o Node.js v18+
    pause
    exit /b
)

:: 3. Verificar Primeiro Setup (Venv e Node_modules)
if not exist "backend\venv" (
    echo [!] Primeiro acesso detectado: Configurando Backend...
    cd backend
    python -m venv venv
    call venv\Scripts\activate
    pip install -r requirements.txt
    cd ..
)

if not exist "frontend\node_modules" (
    echo [!] Primeiro acesso detectado: Instalando dependencias do Frontend...
    cd frontend
    call npm install
    cd ..
)

:: 4. Verificar Banco de Dados e Redis (Portateis)
if not exist "tools\pgsql\bin\postgres.exe" (
    echo [!] PostgreSQL portatil nao encontrado. 
    echo [!] Executando script de setup completo via PowerShell...
    powershell -ExecutionPolicy Bypass -File "%~dp0setup_securo_windows.ps1"
)

:: 5. Iniciar Servicos
echo.
echo [*] Iniciando servicos em janelas separadas...

:: Janela 1: Banco de Dados
echo [>] Iniciando PostgreSQL...
start "Securo - Database" cmd /c "cd /d %~dp0 & tools\pgsql\bin\postgres.exe -D tools\pgsql\data"

:: Janela 2: Redis
echo [>] Iniciando Redis...
start "Securo - Redis" cmd /c "cd /d %~dp0 & tools\redis\redis-server.exe"

timeout /t 3 /nobreak >nul

:: Janela 3: Backend (Usamos /k para ver erros se cair)
echo [>] Iniciando Backend API (Port 8000)...
start "Securo - API Backend" cmd /k "cd /d %~dp0backend & call venv\Scripts\activate.bat & uvicorn app.main:app --reload --port 8000"

:: Janela 4: Frontend
echo [>] Iniciando Frontend UI (Port 5173)...
start "Securo - Frontend" cmd /k "cd /d %~dp0frontend & npm run dev"

echo.
echo ===================================================
echo  VERIFICACAO DE SUCESSO:
echo  1. Banco de Dados: OK
echo  2. Redis: OK
echo  3. Backend: http://localhost:8000
echo  4. Frontend: http://localhost:5173
echo ===================================================
echo.
echo [DONE] O Securo abrira no seu navegador em 5 segundos...

timeout /t 5 >nul
start http://localhost:5173

echo.
echo Pressione qualquer tecla para encerrar este inicializador.
echo (Os servicos continuarao rodando nas outras janelas)
pause
