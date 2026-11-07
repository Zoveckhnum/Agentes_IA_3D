[CmdletBinding()]
param([string]$RepositoryRoot=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path)
$ErrorActionPreference='Stop'
$root='C:\ProgramData\StackBI\HumanApprovals'
$state='C:\ProgramData\StackBI\OfficeControl\state\office.json'
if(-not(Test-Path -LiteralPath $state)){throw 'Instalar OfficeControl primero'}
if((& git -C $RepositoryRoot status --porcelain) -join ''){throw 'Usar un commit limpio'}
$meta=Get-Content (Join-Path $root 'deployment.json') -Raw|ConvertFrom-Json
$secret=Join-Path $root 'secrets\broker.p7m'
$script=Join-Path $root 'program\motor\hitl\server.mjs'
Copy-Item -LiteralPath $secret -Destination ($secret+'.before-office') -Force
Copy-Item -LiteralPath $script -Destination ($script+'.before-office') -Force
try{
 Stop-Service StackBI-HumanApprovals
 New-Item -ItemType Directory -Path (Join-Path $root 'program\office') -Force|Out-Null
 Copy-Item -LiteralPath (Join-Path $RepositoryRoot 'office\core.mjs') -Destination (Join-Path $root 'program\office\core.mjs') -Force
 Copy-Item -LiteralPath (Join-Path $RepositoryRoot 'motor\hitl\server.mjs') -Destination $script -Force
 $package=Unprotect-CmsMessage -Path $secret|ConvertFrom-Json
 $package.variables|Add-Member -NotePropertyName APP_OFFICE_STATE_FILE -NotePropertyValue $state -Force
 Protect-CmsMessage -To (Get-Item ('Cert:\LocalMachine\My\'+$meta.brokerCmsThumbprint)) -Content ($package|ConvertTo-Json -Depth 5 -Compress) -OutFile $secret
 Start-Service StackBI-HumanApprovals
 $healthy=$false
 for($n=0;$n -lt 30;$n++){try{$h=Invoke-RestMethod http://127.0.0.1:10013/health -TimeoutSec 2;if($h.ok -and $h.telegramOnline){$healthy=$true;break}}catch{};Start-Sleep -Seconds 1}
 if(-not $healthy){throw 'Telegram no confirma conexión'}
 $meta|Add-Member -NotePropertyName officeSourceCommit -NotePropertyValue ((& git -C $RepositoryRoot rev-parse HEAD).Trim()) -Force
 $meta|ConvertTo-Json -Depth 5|Set-Content (Join-Path $root 'deployment.json') -Encoding UTF8
 @{ok=$true;officeNoticeEnabled=$true;telegramOnline=$true;aiUsed=$false}|ConvertTo-Json -Compress
}catch{
 Stop-Service StackBI-HumanApprovals -ErrorAction SilentlyContinue
 Copy-Item -LiteralPath ($secret+'.before-office') -Destination $secret -Force
 Copy-Item -LiteralPath ($script+'.before-office') -Destination $script -Force
 Start-Service StackBI-HumanApprovals
 throw 'No se pudo activar el aviso de oficina; se restauró Telegram anterior'
}finally{$package=$null}
