@echo off
setlocal enabledelayedexpansion

:: Navigate to repository root directory
cd /d "%~dp0"

echo ============================================================
echo   AI-Tadpole-Eye-View (GEV v2) - Dev Startup
echo ============================================================
echo.

:: 1. Check Node.js
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js is not found in PATH.
    echo Please install Node.js 24+ and try again.
    goto :error
)

for /f "tokens=*" %%v in ('node -v') do set NODE_VERSION=%%v
echo [OK] Node.js version: %NODE_VERSION%

:: 2. Check pnpm
where pnpm >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] pnpm is not found in PATH.
    echo Please install pnpm via 'npm install -g pnpm@10' and try again.
    goto :error
)

for /f "tokens=*" %%v in ('pnpm -v') do set PNPM_VERSION=%%v
echo [OK] pnpm version: %PNPM_VERSION%

:: 3. Check dependencies
if not exist "node_modules" (
    echo.
    echo [INFO] node_modules not found. Installing dependencies with pnpm...
    call pnpm install
    if !ERRORLEVEL! neq 0 (
        echo [ERROR] pnpm install failed.
        goto :error
    )
)

:: 4. Check workspace builds
:: Monorepo packages (contracts, core, security, cli) must be built at least once
if not exist "packages\contracts\dist" (
    echo.
    echo [INFO] Workspace packages not built yet. Running initial build...
    call pnpm build
    if !ERRORLEVEL! neq 0 (
        echo [ERROR] Initial build failed.
        goto :error
    )
)

:: 5. Set default environment
if "%GEV_SEED_MODE%"=="" (
    set GEV_SEED_MODE=1
)
echo [INFO] GEV_SEED_MODE=%GEV_SEED_MODE% (keyless seed mode by default)
echo.
echo Starting development servers (Vite web + Hono server)...
echo Web UI:     http://localhost:5173
echo API Server: http://localhost:3000
echo.
echo Press Ctrl+C to stop all servers.
echo ============================================================
echo.

:: 6. Launch development server
call pnpm dev %*
if !ERRORLEVEL! neq 0 (
    goto :error
)

exit /b 0

:error
echo.
echo [Dev Startup Failed] Exited with error code %ERRORLEVEL%.
pause
exit /b 1
