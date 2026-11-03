[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
if($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted'){throw 'This installer is only for disposable GitHub-hosted CI runners'}
$media=Join-Path $env:RUNNER_TEMP 'stackbi-sql'
New-Item -ItemType Directory -Path $media -Force|Out-Null
function Download-Microsoft([string]$Url,[string]$File){
  & curl.exe --fail --location --retry 3 --silent --show-error --output $File $Url
  if($LASTEXITCODE -ne 0){throw 'Microsoft download failed'}
  $signature=Get-AuthenticodeSignature -LiteralPath $File
  if($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notlike '*Microsoft Corporation*'){throw 'Microsoft Authenticode verification failed'}
}
if(-not(Get-OdbcDriver -Name 'ODBC Driver 18 for SQL Server' -Platform '64-bit' -ErrorAction SilentlyContinue)){
  $msi=Join-Path $media 'odbc18.msi'
  Download-Microsoft 'https://go.microsoft.com/fwlink/?clcid=0x409&linkid=2378279' $msi
  $install=Start-Process msiexec.exe -ArgumentList @('/i',('"'+$msi+'"'),'/qn','/norestart','IACCEPTMSODBCSQLLICENSETERMS=YES') -Wait -PassThru -WindowStyle Hidden
  if($install.ExitCode -notin 0,3010){throw 'ODBC installation failed'}
}
if(-not(Get-Service -Name 'MSSQL$STACKBI' -ErrorAction SilentlyContinue)){
  $bootstrap=Join-Path $media 'sql-bootstrap.exe'
  Download-Microsoft 'https://aka.ms/sql2025express' $bootstrap
  $download=Start-Process $bootstrap -ArgumentList @('/ACTION=Download','/MEDIATYPE=Core','/LANGUAGE=en-US','/ENU','/QUIET',('/MEDIAPATH="'+$media+'"')) -Wait -PassThru -WindowStyle Hidden
  if($download.ExitCode -notin 0,3010){throw 'SQL media download failed'}
  $core=Get-ChildItem -LiteralPath $media -Filter 'SQLEXPR*x64*ENU.exe' -Recurse|Select-Object -First 1
  if(-not $core){throw 'English SQL core media missing'}
  $setupRoot=Join-Path $media 'core'
  $extract=Start-Process $core.FullName -ArgumentList @('/q',('/x:"'+$setupRoot+'"')) -Wait -PassThru -WindowStyle Hidden
  if($extract.ExitCode -notin 0,3010){throw 'SQL extraction failed'}
  $identity=[Security.Principal.WindowsIdentity]::GetCurrent().Name
  $setup=Start-Process (Join-Path $setupRoot 'setup.exe') -ArgumentList @('/Q','/ACTION=Install','/FEATURES=SQLEngine','/INSTANCENAME=STACKBI','/IACCEPTSQLSERVERLICENSETERMS','/SQLSVCACCOUNT="NT SERVICE\MSSQL$STACKBI"',('/SQLSYSADMINACCOUNTS="'+$identity+'"'),'/SQLSVCSTARTUPTYPE=Automatic','/TCPENABLED=1','/NPENABLED=0','/BROWSERSVCSTARTUPTYPE=Disabled','/UPDATEENABLED=FALSE') -Wait -PassThru -WindowStyle Hidden
  if($setup.ExitCode -notin 0,3010){throw 'SQL installation failed; inspect SQL setup logs on the disposable runner'}
}
& (Join-Path $PSScriptRoot '..\..\deploy\windows\Initialize-LocalSql.ps1')
