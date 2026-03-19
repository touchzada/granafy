$ErrorActionPreference = "Stop"

$ToolsDir = Join-Path $PSScriptRoot "tools"
if (-not (Test-Path $ToolsDir)) { New-Item -ItemType Directory -Force -Path $ToolsDir | Out-Null }

$PgsqlDir = Join-Path $ToolsDir "pgsql"
$PgsqlZip = Join-Path $ToolsDir "pgsql.zip"
$PgDataDir = Join-Path $PgsqlDir "data"
$PgPwFile = Join-Path $ToolsDir "pg_pw.txt"

if (-not (Test-Path $PgsqlDir)) {
    Write-Host "Baixando PostgreSQL Portátil... PODE DEMORAR ALGUNS MINUTOS" -ForegroundColor Yellow
    Invoke-WebRequest -Uri "https://get.enterprisedb.com/postgresql/postgresql-16.2-1-windows-x64-binaries.zip" -OutFile $PgsqlZip
    Write-Host "Extraindo PostgreSQL..." -ForegroundColor Yellow
    Expand-Archive -Path $PgsqlZip -DestinationPath $ToolsDir -Force
    Remove-Item $PgsqlZip
}

if (-not (Test-Path $PgDataDir)) {
    Write-Host "Inicializando Banco de Dados PostgreSQL..." -ForegroundColor Yellow
    "postgres" | Out-File -Encoding ASCII $PgPwFile
    & "$PgsqlDir\bin\initdb.exe" -D $PgDataDir -U postgres -A md5 -E UTF8 --locale=C --pwfile=$PgPwFile
    Remove-Item $PgPwFile

    Write-Host "Iniciando banco temporariamente para criar base 'securo'..." -ForegroundColor Yellow
    $pgProc = Start-Process -NoNewWindow -PassThru -FilePath "$PgsqlDir\bin\pg_ctl.exe" -ArgumentList "start -D `"$PgDataDir`""
    Start-Sleep -Seconds 5
    & "$PgsqlDir\bin\createdb.exe" -U postgres -E UTF8 securo
    & "$PgsqlDir\bin\pg_ctl.exe" stop -D $PgDataDir
}

$RedisDir = Join-Path $ToolsDir "redis"
$RedisZip = Join-Path $ToolsDir "redis.zip"
if (-not (Test-Path $RedisDir)) {
    Write-Host "Baixando Redis Portátil..." -ForegroundColor Yellow
    Invoke-WebRequest -Uri "https://github.com/tporadowski/redis/releases/download/v5.0.14.1/Redis-x64-5.0.14.1.zip" -OutFile $RedisZip
    Write-Host "Extraindo Redis..." -ForegroundColor Yellow
    Expand-Archive -Path $RedisZip -DestinationPath $RedisDir -Force
    Remove-Item $RedisZip
}

Write-Host "Configurando Backend Python..." -ForegroundColor Green
$BackendDir = Join-Path $PSScriptRoot "backend"
Set-Location $BackendDir

$VenvDir = Join-Path $BackendDir "venv"
if (-not (Test-Path $VenvDir)) {
    python -m venv venv
}
& "$VenvDir\Scripts\python.exe" -m pip install -e .

Write-Host "Criando .env do Backend..." -ForegroundColor Green
$envContent = @"
DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/securo
REDIS_URL=redis://localhost:6379/0
FRONTEND_URL=http://localhost:5173
DEBUG=True
"@
$envContent | Out-File -Encoding UTF8 ".env"

Write-Host "Rodando as migrações do banco (Alembic)..." -ForegroundColor Yellow
# Ligue o banco para as migrações
& "$PgsqlDir\bin\pg_ctl.exe" start -D $PgDataDir
Start-Sleep -Seconds 3
$env:DATABASE_URL="postgresql+asyncpg://postgres:postgres@localhost:5432/securo"
& "$VenvDir\Scripts\alembic.exe" upgrade head
& "$PgsqlDir\bin\pg_ctl.exe" stop -D $PgDataDir
Remove-Item Env:\DATABASE_URL -ErrorAction SilentlyContinue

Write-Host "Configurando Frontend Node.js..." -ForegroundColor Green
$FrontendDir = Join-Path $PSScriptRoot "frontend"
Set-Location $FrontendDir
npm install

Write-Host "Criando .env do Frontend..." -ForegroundColor Green
$envFront = @"
VITE_API_URL=http://localhost:8000
"@
$envFront | Out-File -Encoding UTF8 ".env"

Set-Location $PSScriptRoot

Write-Host "Tudo pronto! Setup finalizado com sucesso." -ForegroundColor Green
Write-Host "Para iniciar o Securo agora e sempre, basta rodar: .\start_securo.ps1" -ForegroundColor Cyan
