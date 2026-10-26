$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$localNode = Get-ChildItem -Path (Join-Path $PSScriptRoot '.runtime') -Filter node.exe -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
if ($localNode) { & $localNode.FullName server.cjs }
else { & node server.cjs }
