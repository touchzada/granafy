$ErrorActionPreference = "Stop"

$PgDataDir = Join-Path $PSScriptRoot "tools\pgsql\data"

Write-Host "Iniciando Banco de Dados PostgreSQL..." -ForegroundColor Yellow
$pgCommand = "Set-Location '$PSScriptRoot'; .\tools\pgsql\bin\postgres.exe -D `"$PgDataDir`""
Start-Process "powershell" -ArgumentList "-NoExit", "-Command", $pgCommand

Write-Host "Iniciando Redis (Cache & Fila)..." -ForegroundColor Yellow
$redisCommand = "Set-Location '$PSScriptRoot'; .\tools\redis\redis-server.exe"
Start-Process "powershell" -ArgumentList "-NoExit", "-Command", $redisCommand

Start-Sleep -Seconds 3

Write-Host "Iniciando Backend (FastAPI)..." -ForegroundColor Yellow
$backendCommand = "Set-Location '$PSScriptRoot\backend'; .\venv\Scripts\Activate.ps1; uvicorn app.main:app --reload --port 8000"
Start-Process "powershell" -ArgumentList "-NoExit", "-Command", $backendCommand

Write-Host "Iniciando Worker de Tarefas (Celery)..." -ForegroundColor Yellow
$celeryCommand = "Set-Location '$PSScriptRoot\backend'; .\venv\Scripts\Activate.ps1; python -m celery -A app.worker.celery_app worker --loglevel=info --pool=solo"
Start-Process "powershell" -ArgumentList "-NoExit", "-Command", $celeryCommand

Write-Host "Iniciando Frontend (React/Vite)..." -ForegroundColor Yellow
$frontendCommand = "Set-Location '$PSScriptRoot\frontend'; npm run dev"
Start-Process "powershell" -ArgumentList "-NoExit", "-Command", $frontendCommand

Write-Host "✅ Todos os serviços foram iniciados em novas janelas!" -ForegroundColor Green
Write-Host "Acesse o sistema em: http://localhost:5173" -ForegroundColor Cyan
Write-Host "Para desligar o sistema, basta fechar as 5 janelas azuis que foram abertas." -ForegroundColor Cyan
