[CmdletBinding()]
param([string]$RepositoryRoot=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path)
$ErrorActionPreference='Stop'
$root='C:\ProgramData\StackBI\AgentMotor'
$service='StackBI-AgentMotor'
$identity='NT SERVICE\'+$service
if(Get-Service -Name $service -ErrorAction SilentlyContinue){throw 'El servicio ya existe; revisar antes de actualizar.'}
if(Test-Path -LiteralPath $root){throw 'La carpeta ya existe; revisar antes de instalar.'}
$commit=(& git -C $RepositoryRoot rev-parse HEAD).Trim()
if((& git -C $RepositoryRoot status --porcelain) -join ''){throw 'Instalar desde un commit con árbol limpio.'}
$release=Join-Path $root ('releases\'+$commit)
foreach($folder in @($root,$release,(Join-Path $release 'motor'),(Join-Path $root 'secrets'),(Join-Path $root 'service'),(Join-Path $root 'config'),(Join-Path $root 'logs'),(Join-Path $root 'data'),(Join-Path $root 'codex'),(Join-Path $root 'workspaces'))){New-Item -ItemType Directory -Path $folder -Force|Out-Null}
icacls $root /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)(F)' '*S-1-5-32-544:(OI)(CI)(F)'|Out-Null;if($LASTEXITCODE){throw 'Fallo de ACL'}
foreach($file in Get-ChildItem -LiteralPath (Join-Path $RepositoryRoot 'motor') -File|Where-Object {$_.Name -eq 'AGENTS.md' -or ($_.Extension -eq '.mjs' -and $_.Name -notlike '*.test.mjs')}){Copy-Item -LiteralPath $file.FullName -Destination (Join-Path $release 'motor')}
foreach($dir in @('shared','roles')){Copy-Item -LiteralPath (Join-Path $RepositoryRoot $dir) -Destination (Join-Path $release $dir) -Recurse}
foreach($file in @('package.json','package-lock.json')){Copy-Item -LiteralPath (Join-Path $RepositoryRoot ('deploy\motor-runtime\'+$file)) -Destination $root}
& npm.cmd ci --prefix $root --ignore-scripts --omit=dev|Out-Null;if($LASTEXITCODE){throw 'Falló la instalación del runtime fijado por lockfile'}
$codex=Join-Path $root 'node_modules\@openai\codex-win32-x64\vendor\x86_64-pc-windows-msvc\bin\codex.exe'
if(-not(Test-Path -LiteralPath $codex)){throw 'No se encontró Codex Windows'}
$exe=Join-Path $root ('service\'+$service+'.exe')
$wrapper='C:\ProgramData\StackBI\Installers\WinSW-x64.exe'
if((Get-FileHash -LiteralPath $wrapper -Algorithm SHA256).Hash.ToLowerInvariant() -ne '05b82d46ad331cc16bdc00de5c6332c1ef818df8ceefcd49c726553209b3a0da'){throw 'WinSW no coincide'}
Copy-Item -LiteralPath $wrapper -Destination $exe
$launcher=Join-Path $root 'service\Start-NodeApplication.ps1'
Copy-Item -LiteralPath (Join-Path $RepositoryRoot 'deploy\windows\Start-NodeApplication.ps1') -Destination $launcher
Copy-Item -LiteralPath (Join-Path $RepositoryRoot 'deploy\windows\Backup-AgentMemory.ps1') -Destination (Join-Path $root 'service\Backup-AgentMemory.ps1')
New-Item -ItemType Directory -Path (Join-Path $root 'data\memories') -Force|Out-Null
$environment=Join-Path $root 'secrets\environment.p7m'
$entry=Join-Path $release 'motor\daemon.mjs'
$xml=@"
<service><id>$service</id><name>$service</name><description>StackBI task loop with scoped persistent memory</description><executable>C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe</executable><arguments>-NoProfile -NonInteractive -File &quot;$launcher&quot; -EnvironmentFile &quot;$environment&quot; -EntryScript &quot;$entry&quot;</arguments><workingdirectory>$release</workingdirectory><startmode>Automatic</startmode><stoptimeout>40sec</stoptimeout><onfailure action="restart" delay="30sec"/><logpath>$root\logs</logpath><log mode="roll-by-size"><sizeThreshold>10240</sizeThreshold><keepFiles>5</keepFiles></log></service>
"@
[IO.File]::WriteAllText((Join-Path $root ('service\'+$service+'.xml')),$xml,(New-Object Text.UTF8Encoding($false)))
& $exe install|Out-Null;if($LASTEXITCODE){throw 'Fallo de registro'}
& sc.exe config $service obj= $identity|Out-Null;if($LASTEXITCODE){throw 'Fallo de identidad'}
& sc.exe sidtype $service unrestricted|Out-Null;if($LASTEXITCODE){throw 'Fallo de SID'}
icacls $root /grant ($identity+':(OI)(CI)(RX)')|Out-Null
foreach($folder in @('data','codex','workspaces','logs')){icacls (Join-Path $root $folder) /grant ($identity+':(OI)(CI)(M)')|Out-Null;if($LASTEXITCODE){throw 'Fallo ACL de datos'}}
$certificate=New-SelfSignedCertificate -Type DocumentEncryptionCert -Subject 'CN=StackBI AgentMotor CMS' -CertStoreLocation Cert:\LocalMachine\My -KeyAlgorithm RSA -KeyLength 3072 -KeySpec KeyExchange -Provider 'Microsoft Enhanced RSA and AES Cryptographic Provider' -KeyExportPolicy NonExportable -NotAfter (Get-Date).AddYears(2)
$key=Join-Path 'C:\ProgramData\Microsoft\Crypto\RSA\MachineKeys' $certificate.PrivateKey.CspKeyContainerInfo.UniqueKeyContainerName
icacls $key /grant ($identity+':(R)')|Out-Null;if($LASTEXITCODE){throw 'Fallo ACL de certificado'}
$package=Unprotect-CmsMessage -Path 'C:\ProgramData\StackBI\Secrets\agentes-ia-3d\worker-environment.p7m'|ConvertFrom-Json
if($package.format -ne 'environment-v1' -or $package.variables.AGENTES_DATA_BACKEND -ne 'sql'){throw 'Configuración SQL no válida'}
$business=Join-Path $root 'config\business.json'
if(Test-Path -LiteralPath $package.variables.AGENTES_BUSINESS_CONFIG){Copy-Item -LiteralPath $package.variables.AGENTES_BUSINESS_CONFIG -Destination $business}else{'{}'|Set-Content -LiteralPath $business -Encoding UTF8}
$package.variables.AGENTES_BUSINESS_CONFIG=$business
$vars=@{AGENTES_STATE_ROOT=(Join-Path $root 'data');AGENTES_PROJECT_ROOT=(Join-Path $root 'workspaces');AGENTES_PROJECTS_CONFIG=(Join-Path $root 'config\projects.json');AGENTES_LOOP_POLICY=(Join-Path $root 'policy.json');AGENTES_CODEX_EXE=$codex;CODEX_HOME=(Join-Path $root 'codex')}
foreach($name in $vars.Keys){$package.variables|Add-Member -NotePropertyName $name -NotePropertyValue $vars[$name] -Force}
'{}'|Set-Content -LiteralPath $vars.AGENTES_PROJECTS_CONFIG -Encoding ascii
icacls $vars.AGENTES_PROJECTS_CONFIG /grant ($identity+':(M)')|Out-Null
Protect-CmsMessage -To $certificate -Content ($package|ConvertTo-Json -Depth 5 -Compress) -OutFile $environment
$package=$null
@{format='stackbi-auto-loop-v1';mode='disabled';acceptAfter=(Get-Date).ToUniversalTime().ToString('o');maxAttempts=3;maxTasksPerDay=10}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $root 'policy.json') -Encoding UTF8
@{service=$service;release=$release;commit=$commit;codexExecutable=$codex;cmsThumbprint=$certificate.Thumbprint}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $root 'deployment.json') -Encoding UTF8
$action=New-ScheduledTaskAction -Execute 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' -Argument ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+(Join-Path $root 'service\Backup-AgentMemory.ps1')+'"')
$trigger=New-ScheduledTaskTrigger -Daily -At '03:30'
$principal=New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings=New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 15)
Register-ScheduledTask -TaskName 'StackBI-AgentMotor-Backup' -Action $action -Trigger $trigger -Principal $principal -Settings $settings|Out-Null
Start-Service $service
@{installed=$true;mode='disabled';loginRequired=$true;productionTasksProcessed=0}|ConvertTo-Json -Compress
