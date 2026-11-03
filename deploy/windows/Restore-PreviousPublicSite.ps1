[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
Import-Module WebAdministration
$root='C:\ProgramData\StackBI\Applications\agentes-ia-3d'
$activation=Get-Content -LiteralPath (Join-Path $root 'public-activation.json') -Raw|ConvertFrom-Json
if($activation.format -ne 'stackbi-public-activation-v1' -or $activation.site -ne 'StackBI' -or -not $activation.verified){throw 'Activacion no reconocida'}
$secret='C:\ProgramData\StackBI\Secrets\agentes-ia-3d\environment.p7m'
if($activation.cmsBackup -ne ($secret+'.public-before') -or $activation.deploymentBackup -ne (Join-Path $root 'deployment.json.public-before')){throw 'Ruta de respaldo inesperada'}
if(-not(Test-Path -LiteralPath $activation.previousPhysicalPath) -or -not(Test-Path -LiteralPath $activation.cmsBackup) -or -not(Test-Path -LiteralPath $activation.deploymentBackup)){throw 'Falta un respaldo anterior'}
$current=Get-Content -LiteralPath (Join-Path $root 'deployment.json') -Raw|ConvertFrom-Json
$previous=Get-Content -LiteralPath $activation.deploymentBackup -Raw|ConvertFrom-Json
if($current.release -ne $previous.release -or -not(Test-Path -LiteralPath $previous.release)){throw 'Hubo cambios de version posteriores; revisar la recuperacion antes de continuar'}
Stop-Service -Name node-agentes-ia-3d
Copy-Item -LiteralPath $activation.cmsBackup -Destination $secret -Force
Copy-Item -LiteralPath $activation.deploymentBackup -Destination (Join-Path $root 'deployment.json') -Force
Start-Service -Name node-agentes-ia-3d
Set-ItemProperty -Path 'IIS:\Sites\StackBI' -Name physicalPath -Value $activation.previousPhysicalPath
if($activation.previewPreviouslyStarted){Start-Website -Name 'StackBI-Agentes-SQL-Preview'}
$activation|Add-Member -NotePropertyName revertedAt -NotePropertyValue ((Get-Date).ToUniversalTime().ToString('o')) -Force
$activation.verified=$false
$activation|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $root 'public-activation.json') -Encoding UTF8
Write-Output 'Sitio y entorno anteriores restaurados; la base de datos no se modifica.'
