[CmdletBinding()]
param([string]$RepositoryRoot=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path)
$ErrorActionPreference='Stop'
Import-Module WebAdministration
$broker='StackBI-DeployBroker'
$brokerIdentity='NT SERVICE\'+$broker
$appService='node-agentes-ia-3d-staging'
$appIdentity='NT SERVICE\'+$appService
$brokerRoot='C:\ProgramData\StackBI\DeployBroker'
$appRoot='C:\ProgramData\StackBI\Applications\agentes-ia-3d-staging'
if((Get-Service -Name $broker -ErrorAction SilentlyContinue) -or (Get-Service -Name $appService -ErrorAction SilentlyContinue)){throw 'Pilot services already exist; inspect instead of replacing'}
$program=Join-Path $brokerRoot 'program'
$secret=Join-Path $brokerRoot 'secrets'
$release=Join-Path $appRoot 'releases\bootstrap'
foreach($dir in @($program,$secret,(Join-Path $brokerRoot 'state'),(Join-Path $brokerRoot 'logs'),(Join-Path $brokerRoot 'quarantine'),(Join-Path $brokerRoot 'approvals'),(Join-Path $brokerRoot 'receipts'),(Join-Path $brokerRoot 'service'),$release,(Join-Path $appRoot 'secrets'),(Join-Path $appRoot 'logs'),(Join-Path $appRoot 'service'))){New-Item -ItemType Directory -Path $dir -Force|Out-Null}
foreach($dir in @($brokerRoot,$appRoot)){icacls $dir /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)(F)' '*S-1-5-32-544:(OI)(CI)(F)'|Out-Null;if($LASTEXITCODE){throw 'Could not restrict pilot root ACL'}}
Copy-Item -LiteralPath (Join-Path $RepositoryRoot 'deploy\cicd') -Destination (Join-Path $program 'cicd') -Recurse
Copy-Item -LiteralPath (Join-Path $RepositoryRoot 'deploy\cicd\Deploy-Staging.ps1') -Destination (Join-Path $program 'Deploy-Staging.ps1')
Copy-Item -LiteralPath (Join-Path $RepositoryRoot 'deploy\windows\Start-NodeApplication.ps1') -Destination (Join-Path $program 'Start-NodeApplication.ps1')
Copy-Item -LiteralPath (Join-Path $RepositoryRoot 'deploy\windows\Start-NodeApplication.ps1') -Destination (Join-Path $appRoot 'service\Start-NodeApplication.ps1')
$live=Get-Content -LiteralPath 'C:\ProgramData\StackBI\Applications\agentes-ia-3d\deployment.json' -Raw|ConvertFrom-Json
Copy-Item -LiteralPath (Join-Path $live.release 'server') -Destination (Join-Path $release 'server') -Recurse
Copy-Item -LiteralPath (Join-Path $live.release 'public') -Destination (Join-Path $release 'public') -Recurse
@{format='stackbi-ci-installed-v1';verified=$true;createdAt=(Get-Date).ToUniversalTime().ToString('o');baseline=$true}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $release '.release.json') -Encoding UTF8
$wrapper='C:\ProgramData\StackBI\Installers\WinSW-x64.exe'
if((Get-FileHash -LiteralPath $wrapper -Algorithm SHA256).Hash.ToLowerInvariant() -ne '05b82d46ad331cc16bdc00de5c6332c1ef818df8ceefcd49c726553209b3a0da'){throw 'Unexpected WinSW binary'}
function Register-PilotService([string]$Name,[string]$ServiceRoot,[string]$Entry,[string]$Environment,[string]$Working,[string]$Logs){
  $exe=Join-Path $ServiceRoot ($Name+'.exe')
  Copy-Item -LiteralPath $wrapper -Destination $exe
  $launcher=if($Name -eq $appService){Join-Path $appRoot 'service\Start-NodeApplication.ps1'}else{Join-Path $program 'Start-NodeApplication.ps1'}
  $content=@"
<service><id>$Name</id><name>$Name</name><description>StackBI isolated CI pilot</description>
<executable>C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe</executable>
<arguments>-NoProfile -NonInteractive -ExecutionPolicy Bypass -File &quot;$launcher&quot; -EnvironmentFile &quot;$Environment&quot; -EntryScript &quot;$Entry&quot;</arguments>
<workingdirectory>$Working</workingdirectory><startmode>Automatic</startmode><stoptimeout>40sec</stoptimeout>
<onfailure action="restart" delay="30sec"/><logpath>$Logs</logpath><log mode="roll-by-size"><sizeThreshold>10240</sizeThreshold><keepFiles>5</keepFiles></log></service>
"@
  [IO.File]::WriteAllText((Join-Path $ServiceRoot ($Name+'.xml')),$content,(New-Object Text.UTF8Encoding($false)))
  & $exe install|Out-Null;if($LASTEXITCODE){throw 'Could not register pilot service'}
  & sc.exe config $Name obj= ('NT SERVICE\'+$Name)|Out-Null;if($LASTEXITCODE){throw 'Could not assign pilot identity'}
  & sc.exe sidtype $Name unrestricted|Out-Null;if($LASTEXITCODE){throw 'Could not enable pilot service SID'}
}
Register-PilotService $appService (Join-Path $appRoot 'service') (Join-Path $release 'server\src\main.mjs') (Join-Path $appRoot 'secrets\environment.p7m') $release (Join-Path $appRoot 'logs')
Register-PilotService $broker (Join-Path $brokerRoot 'service') (Join-Path $program 'cicd\broker.mjs') (Join-Path $secret 'github.p7m') $program (Join-Path $brokerRoot 'logs')
foreach($dir in @($brokerRoot,$appRoot)){icacls $dir /grant ($brokerIdentity+':(OI)(CI)(RX)')|Out-Null;if($LASTEXITCODE){throw 'Broker read ACL failed'}}
foreach($dir in @('state','logs','quarantine','receipts')){icacls (Join-Path $brokerRoot $dir) /grant ($brokerIdentity+':(OI)(CI)(M)')|Out-Null;if($LASTEXITCODE){throw 'Broker state ACL failed'}}
icacls $appRoot /grant ($brokerIdentity+':(OI)(CI)(M)') ($appIdentity+':(OI)(CI)(RX)')|Out-Null;if($LASTEXITCODE){throw 'Staging ACL failed'}
icacls (Join-Path $appRoot 'logs') /grant ($appIdentity+':(OI)(CI)(M)')|Out-Null;if($LASTEXITCODE){throw 'Staging log ACL failed'}
function New-PilotCertificate([string]$Subject,[string[]]$Identities){
  $cert=New-SelfSignedCertificate -Type DocumentEncryptionCert -Subject $Subject -CertStoreLocation Cert:\LocalMachine\My -KeyAlgorithm RSA -KeyLength 3072 -KeySpec KeyExchange -Provider 'Microsoft Enhanced RSA and AES Cryptographic Provider' -KeyExportPolicy NonExportable -NotAfter (Get-Date).AddYears(2)
  $key=Join-Path 'C:\ProgramData\Microsoft\Crypto\RSA\MachineKeys' $cert.PrivateKey.CspKeyContainerInfo.UniqueKeyContainerName
  foreach($identity in $Identities){icacls $key /grant ($identity+':(R)')|Out-Null;if($LASTEXITCODE){throw 'Certificate key ACL failed'}}
  return $cert
}
$cms=New-PilotCertificate 'CN=StackBI CI staging CMS' @($appIdentity,$brokerIdentity)
$githubCms=New-PilotCertificate 'CN=StackBI deploy broker CMS' @($brokerIdentity)
$connection=New-Object System.Data.SqlClient.SqlConnection 'Server=lpc:.\STACKBI;Database=master;Integrated Security=True;Encrypt=False'
$connection.Open()
try{
  $cmd=$connection.CreateCommand();$cmd.CommandTimeout=120
  $cmd.CommandText="IF DB_ID(N'AgentesIA3D_Staging') IS NOT NULL THROW 50000,'Staging database already exists; inspect before setup',1; CREATE DATABASE [AgentesIA3D_Staging] ON PRIMARY (NAME=N'AgentesIA3D_Staging',FILENAME=N'C:\ProgramData\StackBI\Databases\AgentesIA3D_Staging.mdf',SIZE=64MB,MAXSIZE=512MB,FILEGROWTH=32MB) LOG ON (NAME=N'AgentesIA3D_Staging_log',FILENAME=N'C:\ProgramData\StackBI\Databases\AgentesIA3D_Staging_log.ldf',SIZE=16MB,MAXSIZE=128MB,FILEGROWTH=32MB); ALTER DATABASE [AgentesIA3D_Staging] SET RECOVERY SIMPLE; ALTER DATABASE [AgentesIA3D_Staging] SET AUTO_CLOSE OFF; ALTER DATABASE [AgentesIA3D_Staging] SET AUTO_SHRINK OFF;"
  [void]$cmd.ExecuteNonQuery()
  $connection.ChangeDatabase('AgentesIA3D_Staging')
  $cmd=$connection.CreateCommand();$cmd.CommandText="CREATE TABLE dbo.SchemaMigrations(Name nvarchar(200) NOT NULL PRIMARY KEY,SHA256 char(64) NOT NULL,AppliedAt datetime2 NOT NULL DEFAULT SYSUTCDATETIME());";[void]$cmd.ExecuteNonQuery()
  $migrations=[ordered]@{}
  foreach($file in Get-ChildItem -LiteralPath (Join-Path $RepositoryRoot 'server\migrations') -Filter '*.sql'|Sort-Object Name){
    if($file.Name -notmatch '^\d+-[a-z0-9-]+\.sql$'){throw 'Unrecognized migration'}
    $text=Get-Content -LiteralPath $file.FullName -Raw
    foreach($batch in [regex]::Split($text,'(?im)^\s*GO\s*$')){if($batch.Trim()){$cmd=$connection.CreateCommand();$cmd.CommandText=$batch;[void]$cmd.ExecuteNonQuery()}}
    $migrations[$file.Name]=(Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    $cmd=$connection.CreateCommand();$cmd.CommandText='INSERT INTO dbo.SchemaMigrations(Name,SHA256) VALUES(@name,@hash)';[void]$cmd.Parameters.AddWithValue('@name',$file.Name);[void]$cmd.Parameters.AddWithValue('@hash',$migrations[$file.Name]);[void]$cmd.ExecuteNonQuery()
  }
  $cmd=$connection.CreateCommand();$cmd.CommandText="IF NOT EXISTS(SELECT 1 FROM sys.server_principals WHERE name=N'$appIdentity') CREATE LOGIN [$appIdentity] FROM WINDOWS; CREATE USER [$appIdentity] FOR LOGIN [$appIdentity]; GRANT CONNECT TO [$appIdentity]; GRANT SELECT,INSERT,UPDATE,DELETE ON SCHEMA::app TO [$appIdentity];";[void]$cmd.ExecuteNonQuery()
}finally{$connection.Close()}
$random=New-Object byte[] 48;$rng=[Security.Cryptography.RandomNumberGenerator]::Create();$rng.GetBytes($random);$rng.Dispose()
$vars=@{CORE_DB_SERVER='sql.stackbi.com.mx';CORE_DB_PORT='1433';CORE_DB_NAME='AgentesIA3D_Staging';CORE_DB_ODBC_DRIVER='ODBC Driver 18 for SQL Server';CORE_DB_TRUSTED_CONNECTION='true';CORE_DB_ENCRYPT='true';CORE_DB_TRUST_SERVER_CERTIFICATE='false';NODE_ENV='production';PORT='10012';PUBLIC_ORIGIN='http://127.0.0.1:11091';ALLOW_LOCAL_HTTP='true';WORKER_API_TOKEN=[Convert]::ToBase64String($random);WORKER_UID='ci-worker';WORKER_EMAIL='worker@ci.example.invalid';APP_OWNER_UID='ci-owner';APP_STATIC_ROOT=(Join-Path $release 'public')}
Protect-CmsMessage -To $cms -Content (@{format='environment-v1';variables=$vars}|ConvertTo-Json -Depth 5 -Compress) -OutFile (Join-Path $appRoot 'secrets\environment.p7m')
$vars=$null;$random=$null
@{service=$appService;release=$release;origin='http://127.0.0.1:11091';port=10012;cmsThumbprint=$cms.Thumbprint}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $appRoot 'deployment.json') -Encoding UTF8
$web='C:\inetpub\stackbi-ci-staging'
New-Item -ItemType Directory -Path $web -Force|Out-Null
Copy-Item -LiteralPath (Join-Path $RepositoryRoot 'deploy\iis\web.config') -Destination (Join-Path $web 'web.config')
$config=[IO.File]::ReadAllText((Join-Path $web 'web.config')).Replace('127.0.0.1:10011','127.0.0.1:10012')
[IO.File]::WriteAllText((Join-Path $web 'web.config'),$config,(New-Object Text.UTF8Encoding($false)))
New-WebAppPool -Name 'StackBI-CI-Staging'|Out-Null
Set-ItemProperty -Path 'IIS:\AppPools\StackBI-CI-Staging' -Name managedRuntimeVersion -Value ''
New-Website -Name 'StackBI-CI-Staging' -IPAddress '127.0.0.1' -Port 11091 -PhysicalPath $web -ApplicationPool 'StackBI-CI-Staging'|Out-Null
$sid=([Security.Principal.NTAccount]$brokerIdentity).Translate([Security.Principal.SecurityIdentifier]).Value
$sddl=(& sc.exe sdshow $appService|Where-Object {$_ -match '^D:'}) -join ''
if(-not $sddl){throw 'Cannot read staging service DACL'}
$ace='(A;;CCLCSWRPWPLO;;;'+$sid+')'
if($sddl.Contains('S:')){$parts=$sddl.Split(@('S:'),[StringSplitOptions]::None);$sddl=$parts[0]+$ace+'S:'+$parts[1]}else{$sddl+=$ace}
& sc.exe sdset $appService $sddl|Out-Null;if($LASTEXITCODE){throw 'Cannot grant staging-only service control'}
$policy=@{format='stackbi-deploy-policy-v1';project='agentes-ia-3d';repository='Zoveckhnum/Agentes_IA_3D';environment='staging';allowProduction=$false;service=$appService;applicationRoot=$appRoot;origin='http://127.0.0.1:11091';apiOrigin='http://127.0.0.1:10012';allowedBranches=@('feat/cicd-iis-pilot','feat/sql-local','main');migrations=$migrations;githubCmsThumbprint=$githubCms.Thumbprint;buildCommand='npm run sql:build';checkCommand='node tools/ci/checks.mjs';workflow='.github/workflows/ci.yml'}
$policy|ConvertTo-Json -Depth 6|Set-Content -LiteralPath (Join-Path $brokerRoot 'policy.json') -Encoding UTF8
Start-Service -Name $appService
@{installed=$true;staging='http://127.0.0.1:11091';brokerStarted=$false;githubCredentialPending=$true;productionChanged=$false}|ConvertTo-Json
