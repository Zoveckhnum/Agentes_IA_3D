[CmdletBinding()]
param([string]$RepositoryRoot=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path)
$ErrorActionPreference='Stop'
$root='C:\ProgramData\StackBI\AgentMotor'
$metaPath=Join-Path $root 'deployment.json'
$meta=Get-Content -LiteralPath $metaPath -Raw|ConvertFrom-Json
if($meta.service -ne 'StackBI-AgentMotor'){throw 'Servicio inesperado'}
if((& git -C $RepositoryRoot status --porcelain) -join ''){throw 'Actualizar desde un commit limpio'}
$commit=(& git -C $RepositoryRoot rev-parse HEAD).Trim()
if((Get-FileHash -LiteralPath (Join-Path $root 'package-lock.json')).Hash -ne (Get-FileHash -LiteralPath (Join-Path $RepositoryRoot 'deploy\motor-runtime\package-lock.json')).Hash){throw 'El runtime cambió; requiere mantenimiento independiente'}
$release=Join-Path $root ('releases\'+$commit)
if(Test-Path -LiteralPath $release){throw 'Ya existe esa versión; revisar antes de reintentar'}
New-Item -ItemType Directory -Path (Join-Path $release 'motor') -Force|Out-Null
foreach($file in Get-ChildItem -LiteralPath (Join-Path $RepositoryRoot 'motor') -File|Where-Object {$_.Name -eq 'AGENTS.md' -or ($_.Extension -eq '.mjs' -and $_.Name -notlike '*.test.mjs')}){Copy-Item -LiteralPath $file.FullName -Destination (Join-Path $release 'motor')}
Copy-Item -LiteralPath (Join-Path $RepositoryRoot 'motor\hitl') -Destination (Join-Path $release 'motor') -Recurse
foreach($dir in @('roles','shared')){Copy-Item -LiteralPath (Join-Path $RepositoryRoot $dir) -Destination (Join-Path $release $dir) -Recurse}
$xmlPath=Join-Path $root 'service\StackBI-AgentMotor.xml'
$beforeXml=Get-Content -LiteralPath $xmlPath -Raw
$beforeMeta=Get-Content -LiteralPath $metaPath -Raw
$secret=Join-Path $root 'secrets\environment.p7m'
Copy-Item -LiteralPath $secret -Destination ($secret+'.before-human') -Force
Stop-Service StackBI-AgentMotor
try{
  if(Test-Path -LiteralPath (Join-Path $root 'data\state\worker.lock')){throw 'El motor dejó un bloqueo; verificar que no quedan ejecuciones antes de retirarlo'}
  $package=Unprotect-CmsMessage -Path $secret|ConvertFrom-Json
  $package.variables|Add-Member -NotePropertyName APP_HITL_CREDENTIAL_FILE -NotePropertyValue 'C:\ProgramData\StackBI\AgentMotor\secrets\approval-request.p7m' -Force
  Protect-CmsMessage -To (Get-Item ('Cert:\LocalMachine\My\'+$meta.cmsThumbprint)) -Content ($package|ConvertTo-Json -Depth 5 -Compress) -OutFile $secret
  $xml=[xml]$beforeXml;$xml.service.arguments=$xml.service.arguments.Replace([string]$meta.release,$release);$xml.service.workingdirectory=$release;$xml.Save($xmlPath)
  $meta|Add-Member -NotePropertyName previousRelease -NotePropertyValue $meta.release -Force
  $meta.release=$release;$meta.commit=$commit;$meta|ConvertTo-Json -Depth 5|Set-Content -LiteralPath $metaPath -Encoding UTF8
  Start-Service StackBI-AgentMotor
}catch{
  Copy-Item -LiteralPath ($secret+'.before-human') -Destination $secret -Force
  [IO.File]::WriteAllText($xmlPath,$beforeXml,(New-Object Text.UTF8Encoding($false)));[IO.File]::WriteAllText($metaPath,$beforeMeta,(New-Object Text.UTF8Encoding($false)))
  Start-Service StackBI-AgentMotor
  throw 'No se actualizó el motor; se restauró su configuración anterior'
}finally{$package=$null}
@{updated=$true;commit=$commit;policyPreserved=$true;credentialScope='request-only'}|ConvertTo-Json -Compress
