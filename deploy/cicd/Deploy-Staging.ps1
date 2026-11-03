[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$ReleaseDirectory,[Parameter(Mandatory=$true)][string]$ArtifactSHA256,[Parameter(Mandatory=$true)][string]$Commit,[Parameter(Mandatory=$true)][string]$RunId)
$ErrorActionPreference='Stop'
$root='C:\ProgramData\StackBI\Applications\agentes-ia-3d-staging'
$service='node-agentes-ia-3d-staging'
$release=[IO.Path]::GetFullPath($ReleaseDirectory)
$releases=Join-Path $root 'releases'
if([IO.Path]::GetDirectoryName($release) -ne $releases -or (Split-Path $release -Leaf) -notmatch '^ci-\d+-[a-f0-9]{12}(?:-[a-f0-9]{8})?$' -or $ArtifactSHA256 -notmatch '^[a-f0-9]{64}$' -or $Commit -notmatch '^[a-f0-9]{40}$' -or $RunId -notmatch '^\d+$'){throw 'Invalid staging deployment identity'}
if((Get-Item -LiteralPath $release).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Release is a link'}
$manifest=Get-Content -LiteralPath (Join-Path $release 'manifest.json') -Raw|ConvertFrom-Json
if($manifest.commit -ne $Commit -or [string]$manifest.runId -ne $RunId){throw 'Release identity mismatch'}
$deploymentPath=Join-Path $root 'deployment.json'
$deployment=Get-Content -LiteralPath $deploymentPath -Raw|ConvertFrom-Json
if($deployment.service -ne $service -or $deployment.origin -ne 'http://127.0.0.1:11091'){throw 'Target is not the isolated staging service'}
$environment=Join-Path $root 'secrets\environment.p7m'
$xmlPath=Join-Path $root ('service\'+$service+'.xml')
$beforeXml=Get-Content -LiteralPath $xmlPath -Raw
$beforeDeployment=Get-Content -LiteralPath $deploymentPath -Raw
Copy-Item -LiteralPath $environment -Destination ($environment+'.previous') -Force
$package=Unprotect-CmsMessage -Path $environment|ConvertFrom-Json
if($package.format -ne 'environment-v1' -or $package.variables.CORE_DB_NAME -ne 'AgentesIA3D_Staging'){throw 'Staging database mismatch'}
$certificate=Get-Item ('Cert:\LocalMachine\My\'+$deployment.cmsThumbprint)
try{
  Stop-Service -Name $service
  $package.variables.APP_STATIC_ROOT=Join-Path $release 'public'
  Protect-CmsMessage -To $certificate -Content ($package|ConvertTo-Json -Depth 5 -Compress) -OutFile $environment
  $xml=[xml]$beforeXml
  $node=$xml.SelectSingleNode('/service/arguments')
  $node.InnerText=$node.InnerText.Replace([string]$deployment.release,[string]$release)
  $xml.SelectSingleNode('/service/workingdirectory').InnerText=$release
  $xml.Save($xmlPath)
  Start-Service -Name $service
  $ready=$false
  for($i=0;$i -lt 25;$i++){
    try{$health=Invoke-RestMethod -Uri http://127.0.0.1:10012/health/db -TimeoutSec 2;if($health.ok -and $health.permissionsRestricted -and $health.certificateValidated){$ready=$true;break}}catch{}
    Start-Sleep -Seconds 1
  }
  if(-not $ready){throw 'Staging database health failed'}
  $page=Invoke-WebRequest -Uri http://127.0.0.1:11091 -UseBasicParsing -TimeoutSec 10
  $expected=[IO.File]::ReadAllText((Join-Path $release 'public\index.html'))
  if($page.StatusCode -ne 200 -or $page.Content -ne $expected){throw 'Staging serves a different frontend'}
  $unauthorized=$false
  try{Invoke-WebRequest -Uri http://127.0.0.1:11091/api/auth/me -UseBasicParsing -TimeoutSec 10|Out-Null}catch{if($_.Exception.Response.StatusCode.value__ -eq 401){$unauthorized=$true}}
  if(-not $unauthorized){throw 'Anonymous authentication boundary failed'}
  $deployment|Add-Member -NotePropertyName previousRelease -NotePropertyValue $deployment.release -Force
  $deployment.release=$release
  $deployment|Add-Member -NotePropertyName commit -NotePropertyValue $Commit -Force
  $deployment|Add-Member -NotePropertyName artifactSHA256 -NotePropertyValue $ArtifactSHA256 -Force
  $deployment|Add-Member -NotePropertyName workflowRunId -NotePropertyValue $RunId -Force
  $deployment|ConvertTo-Json -Depth 5|Set-Content -LiteralPath $deploymentPath -Encoding UTF8
  @{format='stackbi-ci-installed-v1';createdAt=(Get-Date).ToUniversalTime().ToString('o');verified=$true;commit=$Commit;digest=$ArtifactSHA256}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $release '.release.json') -Encoding UTF8
  @{ok=$true;environment='staging';commit=$Commit;frontendVerified=$true;databaseVerified=$true;anonymousAccessRejected=$true;productionChanged=$false}|ConvertTo-Json -Compress
}catch{
  Stop-Service -Name $service -ErrorAction SilentlyContinue
  Copy-Item -LiteralPath ($environment+'.previous') -Destination $environment -Force
  [IO.File]::WriteAllText($xmlPath,$beforeXml,(New-Object Text.UTF8Encoding($false)))
  [IO.File]::WriteAllText($deploymentPath,$beforeDeployment,(New-Object Text.UTF8Encoding($false)))
  $rollbackHealthy=$false
  try{Start-Service -Name $service;Start-Sleep -Seconds 2;$health=Invoke-RestMethod -Uri http://127.0.0.1:10012/health/db -TimeoutSec 10;$rollbackHealthy=[bool]$health.ok}catch{}
  @{ok=$false;environment='staging';rollbackAttempted=$true;rollbackHealthy=$rollbackHealthy;productionChanged=$false}|ConvertTo-Json -Compress
  exit 1
}finally{$package=$null}
