[CmdletBinding()]
param([string]$RepositoryRoot=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path,[string]$PublicOrigin='http://127.0.0.1:11090')
$ErrorActionPreference='Stop'
$appRoot='C:\ProgramData\StackBI\Applications\agentes-ia-3d'
$deploymentPath=Join-Path $appRoot 'deployment.json'
$deployment=Get-Content -LiteralPath $deploymentPath -Raw | ConvertFrom-Json
$releases=[IO.Path]::GetFullPath((Join-Path $appRoot 'releases'))
$oldRelease=[IO.Path]::GetFullPath($deployment.release)
if($deployment.service -ne 'node-agentes-ia-3d' -or -not $oldRelease.StartsWith($releases+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Manifiesto de despliegue inesperado'}
$newRelease=Join-Path $releases (Get-Date -Format 'yyyyMMdd-HHmmss')
if(Test-Path -LiteralPath $newRelease){throw 'La versión destino ya existe'}
New-Item -ItemType Directory -Path (Join-Path $newRelease 'server') -Force | Out-Null
foreach($name in @('src','node_modules')){Copy-Item -LiteralPath (Join-Path $RepositoryRoot ('server\'+$name)) -Destination (Join-Path $newRelease ('server\'+$name)) -Recurse}
foreach($name in @('package.json','package-lock.json')){Copy-Item -LiteralPath (Join-Path $RepositoryRoot ('server\'+$name)) -Destination (Join-Path $newRelease 'server')}
Copy-Item -LiteralPath (Join-Path $RepositoryRoot 'deploy\sql-preview') -Destination (Join-Path $newRelease 'public') -Recurse
$sourceFiles=@()
foreach($relative in @('server\src','server\migrations','shared','app\src')){
  foreach($file in Get-ChildItem -LiteralPath (Join-Path $RepositoryRoot $relative) -Recurse -File){$sourceFiles+=($file.FullName.Substring($RepositoryRoot.Length)+':'+(Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash)}
}
$sourceText=($sourceFiles|Sort-Object)-join "`n"
$hash=[Security.Cryptography.SHA256]::Create()
$sourceHash=([BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($sourceText)))).Replace('-','').ToLowerInvariant();$hash.Dispose()
$secret='C:\ProgramData\StackBI\Secrets\agentes-ia-3d\environment.p7m'
$xmlPath=Join-Path $appRoot 'service\node-agentes-ia-3d.xml'
$xmlBefore=Get-Content -LiteralPath $xmlPath -Raw
$package=Unprotect-CmsMessage -Path $secret | ConvertFrom-Json
if($package.format -ne 'environment-v1'){throw 'Paquete de entorno inesperado'}
$backup=$secret+'.previous'
Copy-Item -LiteralPath $secret -Destination $backup -Force
$package.variables.APP_STATIC_ROOT=Join-Path $newRelease 'public'
$package.variables.PUBLIC_ORIGIN=$PublicOrigin
$package.variables.ALLOW_LOCAL_HTTP=if($PublicOrigin -match '^http://127\.0\.0\.1:'){'true'}else{'false'}
$certificate=Get-Item ('Cert:\LocalMachine\My\'+$deployment.cmsThumbprint)
try{
  $phase='stop-service'
  Stop-Service -Name $deployment.service
  $phase='protect-environment'
  Protect-CmsMessage -To $certificate -Content ($package|ConvertTo-Json -Depth 5 -Compress) -OutFile $secret
  $phase='update-service-xml'
  $xml=[xml]$xmlBefore
  $argumentNode=$xml.SelectSingleNode('/service/arguments')
  $argumentNode.InnerText=([string]$argumentNode.InnerText).Replace([string]$oldRelease,[string]$newRelease)
  $xml.SelectSingleNode('/service/workingdirectory').InnerText=[string]$newRelease
  $xml.Save($xmlPath)
  $phase='start-service'
  Start-Service -Name $deployment.service
  $phase='health-check'
  $ready=$false
  for($attempt=0;$attempt -lt 20;$attempt++){
    try{$health=Invoke-RestMethod -Uri 'http://127.0.0.1:10011/health/db' -TimeoutSec 2;if($health.ok -and $health.permissionsRestricted){$ready=$true;break}}catch{}
    Start-Sleep -Seconds 1
  }
  if(-not $ready){throw 'La nueva versión no cumple salud y permisos SQL'}
  @{format='stackbi-app-release-v1';release=(Split-Path $newRelease -Leaf);verified=$true;sourceSHA256=$sourceHash;createdAt=(Get-Date).ToUniversalTime().ToString('o')}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $newRelease '.release.json') -Encoding UTF8
  if(-not(Test-Path -LiteralPath (Join-Path $oldRelease '.release.json'))){@{format='stackbi-app-release-v1';release=(Split-Path $oldRelease -Leaf);verified=$true;baseline=$true}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $oldRelease '.release.json') -Encoding UTF8}
  $deployment.release=$newRelease;$deployment.origin=$PublicOrigin
  $deployment|ConvertTo-Json -Depth 4|Set-Content -LiteralPath $deploymentPath -Encoding UTF8
}catch{
  $failureType=$_.Exception.GetType().Name
  $failureCode=$_.FullyQualifiedErrorId
  Stop-Service -Name $deployment.service -ErrorAction SilentlyContinue
  Copy-Item -LiteralPath $backup -Destination $secret -Force
  [IO.File]::WriteAllText($xmlPath,$xmlBefore,(New-Object Text.UTF8Encoding($false)))
  Start-Service -Name $deployment.service
  @{format='stackbi-app-release-v1';release=(Split-Path $newRelease -Leaf);verified=$false;state='failed';failurePhase=$phase}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $newRelease '.release.json') -Encoding UTF8
  throw ('La actualizacion fallo en '+$phase+' ('+$failureType+', '+$failureCode+'); se restauro la version anterior.')
}finally{$package=$null}
$versions=@(Get-ChildItem -LiteralPath $releases -Directory|Sort-Object Name -Descending)
$keep=New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
[void]$keep.Add($newRelease);[void]$keep.Add($oldRelease)
foreach($version in $versions){if($keep.Count -ge 3){break};[void]$keep.Add($version.FullName)}
foreach($candidate in $versions|Where-Object {-not $keep.Contains($_.FullName)}){
  $target=[IO.Path]::GetFullPath($candidate.FullName)
  if(-not $target.StartsWith($releases+'\',[StringComparison]::OrdinalIgnoreCase) -or $target -in @($newRelease,$oldRelease)){throw 'Versión fuera del alcance de depuración'}
  if($candidate.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'No se depuran enlaces de versiones'}
  $marker=Join-Path $target '.release.json'
  if(-not(Test-Path -LiteralPath $marker)){throw 'Versión sin manifiesto; se conserva para revisión'}
  $owned=Get-Content -LiteralPath $marker -Raw|ConvertFrom-Json
  if($owned.format -ne 'stackbi-app-release-v1' -or $owned.release -ne $candidate.Name -or (-not $owned.verified -and $owned.state -ne 'failed')){throw 'Manifiesto de versión no reconocido'}
  Remove-Item -LiteralPath $target -Recurse -Force
}
$bytes=(Get-ChildItem -LiteralPath $releases -Recurse -File|Measure-Object Length -Sum).Sum
if($bytes -gt 2GB){throw 'Las versiones exceden 2 GiB; revisar dependencias antes del próximo despliegue'}
[pscustomobject]@{Release=$newRelease;Preview=$PublicOrigin;SourceSHA256=$sourceHash;RetainedReleases=[Math]::Min($versions.Count,3);ReleaseBytes=$bytes;HealthVerified=$true}|ConvertTo-Json
