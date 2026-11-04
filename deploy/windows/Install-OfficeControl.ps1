[CmdletBinding()]
param([string]$RepositoryRoot=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path,[bool]$AutoResume=$false)
$ErrorActionPreference='Stop'
$root='C:\ProgramData\StackBI\OfficeControl';$service='StackBI-OfficeControl';$identity='NT SERVICE\'+$service
if((Test-Path $root) -or (Get-Service $service -ErrorAction SilentlyContinue)){throw 'La instalación ya existe; revisar antes de sustituirla'}
if((& git -C $RepositoryRoot status --porcelain) -join ''){throw 'Instalar desde un commit limpio'}
$commit=(& git -C $RepositoryRoot rev-parse HEAD).Trim()
foreach($dir in @('','program','program\server','program\office','service','secrets','private','state','receipts','requests','logs')){New-Item -ItemType Directory -Path (Join-Path $root $dir) -Force|Out-Null}
icacls $root /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)(F)' '*S-1-5-32-544:(OI)(CI)(F)'|Out-Null
Copy-Item (Join-Path $RepositoryRoot 'office\*') (Join-Path $root 'program\office') -Recurse
Copy-Item (Join-Path $RepositoryRoot 'server\src') (Join-Path $root 'program\server\src') -Recurse
foreach($file in @('package.json','package-lock.json')){Copy-Item (Join-Path $RepositoryRoot ('server\'+$file)) (Join-Path $root 'program\server')}
$appMeta=Get-Content 'C:\ProgramData\StackBI\Applications\agentes-ia-3d\deployment.json' -Raw|ConvertFrom-Json
Copy-Item (Join-Path $appMeta.release 'server\node_modules') (Join-Path $root 'node_modules') -Recurse
foreach($file in @('Start-NodeApplication.ps1','Run-OfficeController.ps1','Office-Host.ps1')){Copy-Item (Join-Path $RepositoryRoot ('deploy\windows\'+$file)) (Join-Path $root 'service')}
$wrapper='C:\ProgramData\StackBI\Installers\WinSW-x64.exe'
if((Get-FileHash $wrapper).Hash.ToLowerInvariant() -ne '05b82d46ad331cc16bdc00de5c6332c1ef818df8ceefcd49c726553209b3a0da'){throw 'WinSW no coincide'}
$exe=Join-Path $root ('service\'+$service+'.exe');Copy-Item $wrapper $exe
$xml=@"
<service><id>$service</id><name>$service</name><description>StackBI CEO office control and static closed notice</description><executable>C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe</executable><arguments>-NoProfile -NonInteractive -ExecutionPolicy Bypass -File &quot;$root\service\Start-NodeApplication.ps1&quot; -EnvironmentFile &quot;$root\secrets\gateway.p7m&quot; -EntryScript &quot;$root\program\office\gateway.mjs&quot;</arguments><workingdirectory>$root\program</workingdirectory><startmode>Automatic</startmode><stoptimeout>30sec</stoptimeout><onfailure action="restart" delay="20sec"/><logpath>$root\logs</logpath><log mode="roll-by-size"><sizeThreshold>4096</sizeThreshold><keepFiles>3</keepFiles></log></service>
"@
[IO.File]::WriteAllText((Join-Path $root ('service\'+$service+'.xml')),$xml,(New-Object Text.UTF8Encoding($false)))
& $exe install|Out-Null;if($LASTEXITCODE){throw 'No se registró el servicio'}
& sc.exe config $service obj= $identity|Out-Null;if($LASTEXITCODE){throw 'No se configuró la identidad'}
& sc.exe sidtype $service unrestricted|Out-Null
icacls $root /grant ($identity+':(RX)')|Out-Null
foreach($dir in @('program','node_modules','service','state','receipts','secrets')){icacls (Join-Path $root $dir) /grant ($identity+':(OI)(CI)(RX)')|Out-Null}
foreach($dir in @('requests','logs')){icacls (Join-Path $root $dir) /grant ($identity+':(OI)(CI)(M)')|Out-Null}
icacls (Join-Path $root 'state') /grant 'NT SERVICE\StackBI-HumanApprovals:(OI)(CI)(R)'|Out-Null
icacls $root /grant 'NT SERVICE\StackBI-HumanApprovals:(RX)'|Out-Null
$cert=New-SelfSignedCertificate -Type DocumentEncryptionCert -Subject 'CN=StackBI Office Control CMS' -CertStoreLocation Cert:\LocalMachine\My -KeyAlgorithm RSA -KeyLength 3072 -KeySpec KeyExchange -Provider 'Microsoft Enhanced RSA and AES Cryptographic Provider' -KeyExportPolicy NonExportable -NotAfter (Get-Date).AddYears(2)
$key=Join-Path 'C:\ProgramData\Microsoft\Crypto\RSA\MachineKeys' $cert.PrivateKey.CspKeyContainerInfo.UniqueKeyContainerName
icacls $key /grant ($identity+':(R)')|Out-Null
$operator=New-SelfSignedCertificate -Type DocumentEncryptionCert -Subject 'CN=StackBI Office Controller CMS' -CertStoreLocation Cert:\LocalMachine\My -KeyAlgorithm RSA -KeyLength 3072 -KeySpec KeyExchange -Provider 'Microsoft Enhanced RSA and AES Cryptographic Provider' -KeyExportPolicy NonExportable -NotAfter (Get-Date).AddYears(2)
$operatorKey=Join-Path 'C:\ProgramData\Microsoft\Crypto\RSA\MachineKeys' $operator.PrivateKey.CspKeyContainerInfo.UniqueKeyContainerName
icacls $operatorKey /inheritance:r /grant:r '*S-1-5-18:(F)' '*S-1-5-32-544:(F)'|Out-Null
try{
 $production=Unprotect-CmsMessage -Path 'C:\ProgramData\StackBI\Secrets\agentes-ia-3d\environment.p7m'|ConvertFrom-Json
 $variables=@{};foreach($v in $production.variables.PSObject.Properties){if($v.Name -match '^CORE_DB_'){$variables[$v.Name]=[string]$v.Value}}
 $variables.APP_OFFICE_ROOT=$root;$variables.PUBLIC_ORIGIN=[string]$production.variables.PUBLIC_ORIGIN
 Protect-CmsMessage -To $cert -Content (@{format='environment-v1';variables=$variables}|ConvertTo-Json -Depth 5 -Compress) -OutFile (Join-Path $root 'secrets\gateway.p7m')
 Protect-CmsMessage -To $operator -Content (@{format='environment-v1';variables=$variables}|ConvertTo-Json -Depth 5 -Compress) -OutFile (Join-Path $root 'secrets\controller.p7m')
}finally{$production=$null;$variables=$null}
icacls (Join-Path $root 'secrets\controller.p7m') /inheritance:r /grant:r '*S-1-5-18:(F)' '*S-1-5-32-544:(F)'|Out-Null
@{format='stackbi-office-state-v1';mode='open';revision=0;autoResume=$AutoResume;timeZone='America/Mexico_City'}|ConvertTo-Json|Set-Content (Join-Path $root 'state\office.json') -Encoding UTF8
@{format='stackbi-office-deployment-v1';commit=$commit;service=$service;gatewayCmsThumbprint=$cert.Thumbprint;controllerCmsThumbprint=$operator.Thumbprint}|ConvertTo-Json|Set-Content (Join-Path $root 'deployment.json') -Encoding UTF8
$action=New-ScheduledTaskAction -Execute 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' -Argument ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+(Join-Path $root 'service\Run-OfficeController.ps1')+'"')
$repeat=New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
$daily=New-ScheduledTaskTrigger -Daily -At '07:00';$boot=New-ScheduledTaskTrigger -AtStartup
$principal=New-ScheduledTaskPrincipal -UserId SYSTEM -LogonType ServiceAccount -RunLevel Highest
$settings=New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun -ExecutionTimeLimit (New-TimeSpan -Minutes 5) -MultipleInstances IgnoreNew
$triggers=if($AutoResume){@($repeat,$daily,$boot)}else{@($repeat,$boot)}
Register-ScheduledTask -TaskName StackBI-OfficeController -Action $action -Trigger $triggers -Principal $principal -Settings $settings|Out-Null
@{installed=$true;service=$service;controller='StackBI-OfficeController';gatewayPort=10014;autoResume=$AutoResume;requiresDatabaseProvision=$true;publicProxyUnchanged=$true}|ConvertTo-Json -Compress
