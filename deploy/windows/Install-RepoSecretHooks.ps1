[CmdletBinding()]
param([string]$RepositoryRoot=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path)
$ErrorActionPreference='Stop'
$root='C:\ProgramData\StackBI\SecurityTools'
$hooks=Join-Path $root 'hooks'
$existing=(& git -C $RepositoryRoot config --get core.hooksPath) -join ''
if($existing -and $existing.Replace('/','\') -ne $hooks){throw 'Hay ganchos Git propios; conservarlos y revisar su integración antes de cambiar la ruta'}
$defaultHooks=(& git -C $RepositoryRoot rev-parse --git-path hooks).Trim()
if(-not [IO.Path]::IsPathRooted($defaultHooks)){$defaultHooks=Join-Path $RepositoryRoot $defaultHooks}
if(-not $existing){foreach($name in @('pre-commit','pre-push')){if(Test-Path (Join-Path $defaultHooks $name)){throw 'Hay ganchos Git existentes; no se sobrescriben'}}}
New-Item -ItemType Directory -Path $hooks -Force|Out-Null
icacls $root /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)(F)' '*S-1-5-32-544:(OI)(CI)(F)' '*S-1-5-32-545:(OI)(CI)(RX)'|Out-Null
if($LASTEXITCODE){throw 'No se pudo proteger el escáner'}
Copy-Item (Join-Path $RepositoryRoot 'tools\security-scan.mjs') (Join-Path $root 'security-scan.mjs') -Force
$prefix=@'
#!/bin/sh
# StackBI managed secret gate v1
exec "C:/Program Files/nodejs/node.exe" "C:/ProgramData/StackBI/SecurityTools/security-scan.mjs" --cwd
'@
foreach($name in @('pre-commit','pre-push')){
 $text=$prefix.TrimEnd()+$(if($name -eq 'pre-commit'){' --staged'}else{''})+"`n"
 [IO.File]::WriteAllText((Join-Path $hooks $name),$text.Replace("`r`n","`n"),(New-Object Text.UTF8Encoding($false)))
}
& git -C $RepositoryRoot config --local core.hooksPath ($hooks.Replace('\','/'))
if($LASTEXITCODE){throw 'No se pudo registrar la ruta de ganchos'}
@{installed=$true;scope='repository and its local worktrees';preCommit='staged index';prePush='all local history';scannerProtected=$true}|ConvertTo-Json -Compress
