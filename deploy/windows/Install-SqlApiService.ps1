[CmdletBinding()]
param([string]$RepositoryRoot=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path,[string]$PublicOrigin='http://127.0.0.1:10011',[int]$Port=10011)
$ErrorActionPreference='Stop'
$serviceId='node-agentes-ia-3d'
$appRoot='C:\ProgramData\StackBI\Applications\agentes-ia-3d'
$existing=Get-Service -Name $serviceId -ErrorAction SilentlyContinue
if ($existing -and ($existing.Status -ne 'Stopped' -or (Test-Path -LiteralPath (Join-Path $appRoot 'deployment.json')))) { throw 'El servicio ya esta configurado; no se sustituye automaticamente' }
$releaseName=Get-Date -Format 'yyyyMMdd-HHmmss'
$release=Join-Path $appRoot ('releases\'+$releaseName)
if ($existing) {
  $pending=Get-ChildItem -LiteralPath (Join-Path $appRoot 'releases') -Directory | Sort-Object Name -Descending | Select-Object -First 1
  if (-not $pending -or $pending.Name -notmatch '^\d{8}-\d{6}$') { throw 'No se identifica la instalacion incompleta' }
  $release=$pending.FullName
}
$serviceRoot=Join-Path $appRoot 'service'
$logRoot=Join-Path $appRoot 'logs'
$secretRoot='C:\ProgramData\StackBI\Secrets\agentes-ia-3d'
$platform='C:\ProgramData\StackBI\Platform'
New-Item -ItemType Directory -Path $release,$serviceRoot,$logRoot,$secretRoot,$platform -Force | Out-Null
foreach($dir in @($appRoot,$secretRoot,$platform)) {
  icacls $dir /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)(F)' '*S-1-5-32-544:(OI)(CI)(F)' | Out-Null
  if($LASTEXITCODE -ne 0){throw 'No se pudo restringir una carpeta de servicio'}
}
$serverRoot=Join-Path $release 'server'
New-Item -ItemType Directory -Path $serverRoot -Force | Out-Null
foreach($name in @('src','node_modules')) { if (-not (Test-Path -LiteralPath (Join-Path $serverRoot $name))) { Copy-Item -LiteralPath (Join-Path $RepositoryRoot ('server\'+$name)) -Destination (Join-Path $serverRoot $name) -Recurse } }
Copy-Item -LiteralPath (Join-Path $RepositoryRoot 'server\package.json') -Destination $serverRoot
Copy-Item -LiteralPath (Join-Path $RepositoryRoot 'server\package-lock.json') -Destination $serverRoot
if (-not (Test-Path -LiteralPath (Join-Path $release 'public'))) { Copy-Item -LiteralPath (Join-Path $RepositoryRoot 'deploy\sql-preview') -Destination (Join-Path $release 'public') -Recurse }
Copy-Item -LiteralPath (Join-Path $RepositoryRoot 'deploy\windows\Start-NodeApplication.ps1') -Destination $platform
$wrapper=Join-Path $serviceRoot ($serviceId+'.exe')
Copy-Item -LiteralPath 'C:\ProgramData\StackBI\Installers\WinSW-x64.exe' -Destination $wrapper
if ((Get-FileHash -LiteralPath $wrapper -Algorithm SHA256).Hash.ToLowerInvariant() -ne '05b82d46ad331cc16bdc00de5c6332c1ef818df8ceefcd49c726553209b3a0da') { throw 'Hash del wrapper WinSW no coincide' }
$entry=Join-Path $serverRoot 'src\main.mjs'
$environment=Join-Path $secretRoot 'environment.p7m'
$launcher=Join-Path $platform 'Start-NodeApplication.ps1'
$xml=@"
<service>
  <id>$serviceId</id><name>Agentes IA 3D SQL API</name>
  <description>API local para Agentes IA 3D, SQL integrado y configuración CMS.</description>
  <executable>C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe</executable>
  <arguments>-NoProfile -NonInteractive -ExecutionPolicy Bypass -File &quot;$launcher&quot; -EnvironmentFile &quot;$environment&quot; -EntryScript &quot;$entry&quot;</arguments>
  <workingdirectory>$release</workingdirectory><startmode>Automatic</startmode>
  <depend>MSSQL`$STACKBI</depend><stoptimeout>20sec</stoptimeout>
  <onfailure action="restart" delay="10 sec"/><onfailure action="restart" delay="30 sec"/>
  <logpath>$logRoot</logpath><log mode="roll-by-size"><sizeThreshold>10240</sizeThreshold><keepFiles>5</keepFiles></log>
</service>
"@
[IO.File]::WriteAllText((Join-Path $serviceRoot ($serviceId+'.xml')),$xml,(New-Object Text.UTF8Encoding($false)))
if (-not $existing) { & $wrapper install; if($LASTEXITCODE -ne 0){throw 'No se pudo instalar el servicio'} }
$identity='NT SERVICE\'+$serviceId
$null=& sc.exe config $serviceId obj= $identity
if($LASTEXITCODE -ne 0){throw 'No se pudo asignar la identidad virtual'}
$null=& sc.exe sidtype $serviceId unrestricted
if($LASTEXITCODE -ne 0){throw 'No se pudo habilitar el SID del servicio'}
foreach($dir in @($appRoot,$platform,$secretRoot)) { icacls $dir /grant ($identity+':(OI)(CI)(RX)') | Out-Null; if($LASTEXITCODE -ne 0){throw 'Fallo ACL de lectura'} }
icacls $logRoot /grant ($identity+':(OI)(CI)(M)') | Out-Null
if($LASTEXITCODE -ne 0){throw 'Fallo ACL de logs'}
$cms=New-SelfSignedCertificate -Type DocumentEncryptionCert -Subject 'CN=StackBI Agentes IA 3D CMS' -CertStoreLocation Cert:\LocalMachine\My -KeyAlgorithm RSA -KeyLength 3072 -KeySpec KeyExchange -Provider 'Microsoft Enhanced RSA and AES Cryptographic Provider' -KeyExportPolicy NonExportable -NotAfter (Get-Date).AddYears(2)
$privatePath=Join-Path 'C:\ProgramData\Microsoft\Crypto\RSA\MachineKeys' $cms.PrivateKey.CspKeyContainerInfo.UniqueKeyContainerName
icacls $privatePath /grant ($identity+':(R)') | Out-Null
if($LASTEXITCODE -ne 0){throw 'Fallo ACL de clave CMS'}
$migration=Get-Content -LiteralPath 'C:\ProgramData\StackBI\MigrationSources\migration-report.json' -Raw | ConvertFrom-Json
$random=New-Object byte[] 48
$generator=[Security.Cryptography.RandomNumberGenerator]::Create();$generator.GetBytes($random);$generator.Dispose()
$workerToken=[Convert]::ToBase64String($random)
$variables=@{CORE_DB_SERVER='sql.stackbi.com.mx';CORE_DB_PORT='1433';CORE_DB_NAME='AgentesIA3D';CORE_DB_ODBC_DRIVER='ODBC Driver 18 for SQL Server';CORE_DB_TRUSTED_CONNECTION='true';CORE_DB_ENCRYPT='true';CORE_DB_TRUST_SERVER_CERTIFICATE='false';NODE_ENV='production';PORT=[string]$Port;PUBLIC_ORIGIN=$PublicOrigin;ALLOW_LOCAL_HTTP=$(if($PublicOrigin -match '^http://127\.0\.0\.1:'){ 'true' }else{'false'});WORKER_API_TOKEN=$workerToken;WORKER_UID=$migration.workerUid;WORKER_EMAIL=$migration.workerEmail;APP_OWNER_UID=$migration.ownerUid;APP_STATIC_ROOT=(Join-Path $release 'public')}
Protect-CmsMessage -To $cms -Content (@{format='environment-v1';variables=$variables}|ConvertTo-Json -Depth 4 -Compress) -OutFile $environment
$worker=@{AGENTES_DATA_BACKEND='sql';AGENTES_API_ORIGIN=('http://127.0.0.1:'+$Port);WORKER_API_TOKEN=$workerToken;WORKER_EMAIL=$migration.workerEmail;AGENTES_BUSINESS_CONFIG='C:\Users\Rodrigo\Documents\GitHub\Agentes_IA_3D\motor\negocio.json'}
Protect-CmsMessage -To $cms -Content (@{format='environment-v1';variables=$worker}|ConvertTo-Json -Depth 4 -Compress) -OutFile (Join-Path $secretRoot 'worker-environment.p7m')
$workerToken=$null;$variables=$null;$worker=$null
$connection=New-Object System.Data.SqlClient.SqlConnection 'Server=lpc:.\STACKBI;Database=master;Integrated Security=True;Encrypt=False'
$connection.Open()
try {
  $command=$connection.CreateCommand()
  $command.CommandText="IF NOT EXISTS(SELECT 1 FROM sys.server_principals WHERE name=N'$identity') CREATE LOGIN [$identity] FROM WINDOWS; USE [AgentesIA3D]; IF NOT EXISTS(SELECT 1 FROM sys.database_principals WHERE name=N'$identity') CREATE USER [$identity] FOR LOGIN [$identity]; GRANT CONNECT TO [$identity]; GRANT SELECT,INSERT,UPDATE,DELETE ON SCHEMA::app TO [$identity];"
  [void]$command.ExecuteNonQuery()
} finally {$connection.Close()}
@{service=$serviceId;release=$release;origin=$PublicOrigin;port=$Port;cmsThumbprint=$cms.Thumbprint;cmsExpires=$cms.NotAfter.ToUniversalTime().ToString('o');sqlCertificate=(Get-ChildItem Cert:\LocalMachine\My | Where-Object Subject -eq 'CN=sql.stackbi.com.mx' | Sort-Object NotAfter -Descending | Select-Object -First 1).Thumbprint} | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $appRoot 'deployment.json') -Encoding UTF8
Start-Service -Name $serviceId
Get-Service -Name $serviceId | Select-Object Name,Status,StartType | ConvertTo-Json
[pscustomobject]@{Release=$release;Preview=$PublicOrigin;SecretsProtected=$true;PublicRoutingChanged=$false} | ConvertTo-Json
