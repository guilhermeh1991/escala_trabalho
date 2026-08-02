$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root
$port = 8000
$python = 'C:/Users/guilh/AppData/Local/Microsoft/WindowsApps/python3.11.exe'
Write-Host "Abrindo o projeto em http://127.0.0.1:$port"
& $python -m http.server $port
