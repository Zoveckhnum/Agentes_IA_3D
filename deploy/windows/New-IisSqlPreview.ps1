[CmdletBinding()]
param([string]$RepositoryRoot=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path)
$ErrorActionPreference='Stop'
Import-Module WebAdministration
if(-not (Get-WebGlobalModule -Name RewriteModule -ErrorAction SilentlyContinue)){throw 'Falta URL Rewrite'}
if(-not (Get-WebGlobalModule -Name ApplicationRequestRouting -ErrorAction SilentlyContinue)){throw 'Falta ARR'}
Backup-WebConfiguration -Name ('Before-AgentesSQL-Preview-'+(Get-Date -Format 'yyyyMMdd-HHmmss')) | Out-Null
Set-WebConfigurationProperty -PSPath 'MACHINE/WEBROOT/APPHOST' -Filter 'system.webServer/proxy' -Name enabled -Value $true
$pool='AgentesIA3DPreview'
$site='StackBI-Agentes-SQL-Preview'
$root='C:\inetpub\stackbi-agentes-sql-preview'
New-Item -ItemType Directory -Path $root -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $RepositoryRoot 'deploy\iis\web.config') -Destination $root -Force
if(-not(Test-Path ('IIS:\AppPools\'+$pool))){New-WebAppPool -Name $pool | Out-Null}
Set-ItemProperty ('IIS:\AppPools\'+$pool) -Name managedRuntimeVersion -Value ''
icacls $root /grant ('IIS AppPool\'+$pool+':(OI)(CI)(RX)') | Out-Null
if($LASTEXITCODE -ne 0){throw 'No se pudo conceder lectura al grupo IIS'}
if(-not(Test-Path ('IIS:\Sites\'+$site))){New-Website -Name $site -PhysicalPath $root -ApplicationPool $pool -IPAddress '127.0.0.1' -Port 11090 | Out-Null}
Start-Website -Name $site
[pscustomobject]@{Site=$site;Preview='http://127.0.0.1:11090';Binding='127.0.0.1:11090:';PublicSiteChanged=$false}|ConvertTo-Json
