@echo off
setlocal
cd /d "%~dp0"
for /d %%D in ("%~dp0.runtime\node-*-win-x64") do (
  if exist "%%D\node.exe" (
    "%%D\node.exe" server.cjs
    exit /b
  )
)
node server.cjs
