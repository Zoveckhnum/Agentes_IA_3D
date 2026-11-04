[CmdletBinding()]
param([string]$RepositoryRoot=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path)
$ErrorActionPreference='Stop'
$root='C:\ProgramData\StackBI\HumanApprovals'
$service='StackBI-HumanApprovals'
$identity='NT SERVICE\'+$service
if((Test-Path -LiteralPath $root) -or (Get-Service $service -ErrorAction SilentlyContinue)){throw 'Existe instalación previa; revisar antes de sustituirla'}
if((& git -C $RepositoryRoot status --porcelain) -join ''){throw 'Instalar desde un commit limpio'}
$commit=(& git -C $RepositoryRoot rev-parse HEAD).Trim()
foreach($folder in @('','program\motor','program\deploy','program\deploy\windows','program\support','program\support\tools','program\support\motor','program\support\app','program\tools','registry','work','state','state\requests','service','secrets','logs')){New-Item -ItemType Directory -Path (Join-Path $root $folder) -Force|Out-Null}
icacls $root /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)(F)' '*S-1-5-32-544:(OI)(CI)(F)'|Out-Null;if($LASTEXITCODE){throw 'Fallo de ACL'}
Copy-Item -LiteralPath (Join-Path $RepositoryRoot 'motor\hitl') -Destination (Join-Path $root 'program\motor') -Recurse
New-Item -ItemType Directory -Path (Join-Path $root 'program\office') -Force|Out-Null
Copy-Item -LiteralPath (Join-Path $RepositoryRoot 'office\core.mjs') -Destination (Join-Path $root 'program\office\core.mjs')
Copy-Item -LiteralPath (Join-Path $RepositoryRoot 'deploy\cicd') -Destination (Join-Path $root 'program\deploy') -Recurse
foreach($file in @('Invoke-HumanSql.ps1','Update-SqlPreview.ps1','Backup-LocalSql.ps1')){Copy-Item -LiteralPath (Join-Path $RepositoryRoot ('deploy\windows\'+$file)) -Destination (Join-Path $root 'program\deploy\windows')}
Copy-Item -LiteralPath (Join-Path $RepositoryRoot 'server\tools\backup-plan.mjs') -Destination (Join-Path $root 'program\deploy\windows')
Copy-Item -LiteralPath (Join-Path $RepositoryRoot 'tools\hitl.mjs') -Destination (Join-Path $root 'program\tools')
foreach($dir in @('roles','shared')){Copy-Item -LiteralPath (Join-Path $RepositoryRoot $dir) -Destination (Join-Path $root ('program\support\'+$dir)) -Recurse}
Copy-Item -LiteralPath (Join-Path $RepositoryRoot 'app\src') -Destination (Join-Path $root 'program\support\app\src') -Recurse
Copy-Item -LiteralPath (Join-Path $RepositoryRoot 'tools\roles.mjs') -Destination (Join-Path $root 'program\support\tools')
Copy-Item -LiteralPath (Join-Path $RepositoryRoot 'motor\role-skills.mjs') -Destination (Join-Path $root 'program\support\motor')
Copy-Item -LiteralPath (Join-Path $RepositoryRoot 'deploy\windows\Start-NodeApplication.ps1') -Destination (Join-Path $root 'service')
Copy-Item -LiteralPath (Join-Path $RepositoryRoot 'deploy\windows\Run-HumanExecutor.ps1') -Destination (Join-Path $root 'service')
Copy-Item -LiteralPath (Join-Path $RepositoryRoot 'deploy\windows\Invoke-HumanApproval.ps1') -Destination (Join-Path $root 'service')
$wrapper='C:\ProgramData\StackBI\Installers\WinSW-x64.exe'
if((Get-FileHash -LiteralPath $wrapper -Algorithm SHA256).Hash.ToLowerInvariant() -ne '05b82d46ad331cc16bdc00de5c6332c1ef818df8ceefcd49c726553209b3a0da'){throw 'WinSW no coincide'}
$exe=Join-Path $root ('service\'+$service+'.exe');Copy-Item -LiteralPath $wrapper -Destination $exe
$xml=@"
<service><id>$service</id><name>$service</name><description>StackBI private Telegram human approval service</description><executable>C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe</executable><arguments>-NoProfile -NonInteractive -ExecutionPolicy Bypass -File &quot;$root\service\Start-NodeApplication.ps1&quot; -EnvironmentFile &quot;$root\secrets\broker.p7m&quot; -EntryScript &quot;$root\program\motor\hitl\server.mjs&quot;</arguments><workingdirectory>$root\program</workingdirectory><startmode>Automatic</startmode><stoptimeout>40sec</stoptimeout><onfailure action="restart" delay="30sec"/><logpath>$root\logs</logpath><log mode="roll-by-size"><sizeThreshold>5120</sizeThreshold><keepFiles>3</keepFiles></log></service>
"@
[IO.File]::WriteAllText((Join-Path $root ('service\'+$service+'.xml')),$xml,(New-Object Text.UTF8Encoding($false)))
& $exe install|Out-Null;if($LASTEXITCODE){throw 'Fallo de registro del servicio'}
& sc.exe config $service obj= $identity|Out-Null;if($LASTEXITCODE){throw 'Fallo de identidad'}
& sc.exe sidtype $service unrestricted|Out-Null;if($LASTEXITCODE){throw 'Fallo de SID'}
icacls $root /grant ($identity+':(OI)(CI)(RX)')|Out-Null
foreach($dir in @('state','logs')){icacls (Join-Path $root $dir) /grant ($identity+':(OI)(CI)(M)')|Out-Null;if($LASTEXITCODE){throw 'Fallo ACL de estado'}}
function New-Cms([string]$Subject,[string]$Reader=''){
  $cert=New-SelfSignedCertificate -Type DocumentEncryptionCert -Subject $Subject -CertStoreLocation Cert:\LocalMachine\My -KeyAlgorithm RSA -KeyLength 3072 -KeySpec KeyExchange -Provider 'Microsoft Enhanced RSA and AES Cryptographic Provider' -KeyExportPolicy NonExportable -NotAfter (Get-Date).AddYears(2)
  if($Reader){$key=Join-Path 'C:\ProgramData\Microsoft\Crypto\RSA\MachineKeys' $cert.PrivateKey.CspKeyContainerInfo.UniqueKeyContainerName;icacls $key /grant ($Reader+':(R)')|Out-Null;if($LASTEXITCODE){throw 'Fallo ACL de clave'}}
  return $cert
}
$brokerCert=New-Cms 'CN=StackBI Telegram Approvals CMS' $identity
$operatorCert=New-Cms 'CN=StackBI Human Executor CMS'
function Random-Key{$data=New-Object byte[] 48;$rng=[Security.Cryptography.RandomNumberGenerator]::Create();try{$rng.GetBytes($data);return [Convert]::ToBase64String($data)}finally{$rng.Dispose()}}
function Key-Hash([string]$Value){$hasher=[Security.Cryptography.SHA256]::Create();try{return ([BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($Value)))).Replace('-','').ToLowerInvariant()}finally{$hasher.Dispose()}}
$submit=Random-Key;$execute=Random-Key
$vars=@{APP_HITL_ROOT=$root;APP_HITL_SUBMIT_HASH=(Key-Hash $submit);APP_HITL_EXECUTE_HASH=(Key-Hash $execute)}
Protect-CmsMessage -To $brokerCert -Content (@{format='environment-v1';variables=$vars}|ConvertTo-Json -Depth 5 -Compress) -OutFile (Join-Path $root 'secrets\broker.p7m')
$operator=@{APP_HITL_ROOT=$root;APP_HITL_REQUEST_TOKEN=$submit;APP_HITL_EXECUTE_TOKEN=$execute}
Protect-CmsMessage -To $operatorCert -Content (@{format='environment-v1';variables=$operator}|ConvertTo-Json -Depth 5 -Compress) -OutFile (Join-Path $root 'secrets\operator.p7m')
$motor=Get-Content 'C:\ProgramData\StackBI\AgentMotor\deployment.json' -Raw|ConvertFrom-Json
$motorCert=Get-Item ('Cert:\LocalMachine\My\'+$motor.cmsThumbprint)
$request=@{APP_HITL_ENDPOINT='http://127.0.0.1:10013';APP_HITL_REQUEST_TOKEN=$submit}
Protect-CmsMessage -To $motorCert -Content (@{format='environment-v1';variables=$request}|ConvertTo-Json -Depth 5 -Compress) -OutFile 'C:\ProgramData\StackBI\AgentMotor\secrets\approval-request.p7m'
Copy-Item -LiteralPath (Join-Path $RepositoryRoot 'deploy\windows\Get-ApprovalCredential.ps1') -Destination 'C:\ProgramData\StackBI\AgentMotor\service\Get-ApprovalCredential.ps1'
$submit=$null;$execute=$null;$request=$null;$operator=$null;$vars=$null
@{format='stackbi-human-service-v1';service=$service;sourceCommit=$commit;brokerCmsThumbprint=$brokerCert.Thumbprint;operatorCmsThumbprint=$operatorCert.Thumbprint}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $root 'deployment.json') -Encoding UTF8
$action=New-ScheduledTaskAction -Execute 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' -Argument ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+(Join-Path $root 'service\Run-HumanExecutor.ps1')+'"')
$trigger=New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
$principal=New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings=New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 35) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName 'StackBI-HumanExecutor' -Action $action -Trigger $trigger -Principal $principal -Settings $settings|Out-Null
Disable-ScheduledTask -TaskName 'StackBI-HumanExecutor'|Out-Null
@{installed=$true;credentialProvisioningPending=$true;started=$false;businessEffects=$false}|ConvertTo-Json -Compress
