@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

set "NODE_EXE=%CD%\.conda\node.exe"
if not exist "%NODE_EXE%" (
  echo [错误] 未找到项目专用环境 .conda。
  echo 请先按照 README.md 的环境要求创建项目专用 Anaconda 环境。
  pause
  exit /b 1
)

if not exist ".env" (
  echo [错误] 未找到 .env。
  echo 请参考 .env.example 创建并填写本地模型配置。
  pause
  exit /b 1
)

set "APP_PORT="
for /f "usebackq delims=" %%P in (`""%NODE_EXE%" --env-file=.env -p "process.env.PORT??4174""`) do set "APP_PORT=%%P"

if not defined APP_PORT (
  echo [错误] .env 中的 PORT 配置无效。
  pause
  exit /b 1
)

set "APP_URL=http://127.0.0.1:%APP_PORT%/"
set "HEALTH_URL=%APP_URL%api/health"

echo 正在启动时间管理助手：%APP_URL%
if "%TIME_ASSISTANT_NO_BROWSER%"=="1" goto run_server

start "" /b powershell.exe -NoProfile -Command ^
  "$healthUrl = '%HEALTH_URL%'; $appUrl = '%APP_URL%';" ^
  "for ($attempt = 0; $attempt -lt 60; $attempt++) {" ^
  "  try { $response = Invoke-WebRequest -UseBasicParsing -Uri $healthUrl -TimeoutSec 1; if ($response.StatusCode -eq 200) { Start-Process $appUrl; exit 0 } } catch {};" ^
  "  Start-Sleep -Milliseconds 500" ^
  "}; Write-Host '[提示] 浏览器未自动打开，请手动访问' $appUrl"

:run_server
"%NODE_EXE%" --env-file=.env server\index.js
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
  echo [错误] 服务启动失败，请检查上方错误信息和 .env 配置。
  pause
)

exit /b %EXIT_CODE%
