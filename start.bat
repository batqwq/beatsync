@echo off
set PATH=C:\Users\13086\.bun\bin;%PATH%
cd /d "%~dp0"
".\node_modules\.bin\turbo.exe" run start
