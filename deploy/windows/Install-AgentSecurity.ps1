[CmdletBinding()]
param([string]$RepositoryRoot=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path)
$ErrorActionPreference='Stop'
$root='C:\ProgramData\StackBI\AgentMotor'
$meta=Get-Content (Join-Path $root 'deployment.json') -Raw|ConvertFrom-Json
if($meta.service -ne 'StackBI-AgentMotor'){throw 'Servicio inesperado'}
$identity=New-Object Security.Principal.NTAccount('NT SERVICE\StackBI-AgentMotor')
$sid=$identity.Translate([Security.Principal.SecurityIdentifier]).Value
if(-not [Diagnostics.EventLog]::SourceExists('StackBI.AgentSecurity')){New-EventLog -LogName 'StackBI-Security' -Source 'StackBI.AgentSecurity'}
if([Diagnostics.EventLog]::LogNameFromSourceName('StackBI.AgentSecurity','.') -ne 'StackBI-Security'){throw 'Origen de eventos inesperado'}
Limit-EventLog -LogName 'StackBI-Security' -MaximumSize 32MB -OverflowAction OverwriteAsNeeded
$sddl='O:BAG:SYD:(A;;0xf0007;;;SY)(A;;0x7;;;BA)(A;;0x2;;;'+$sid+')'
& wevtutil.exe sl StackBI-Security ('/ca:'+$sddl)
if($LASTEXITCODE){throw 'No se pudo configurar el canal de auditoría'}
$writer=Join-Path $root 'service\Write-AgentSecurityEvent.ps1'
Copy-Item (Join-Path $RepositoryRoot 'deploy\windows\Write-AgentSecurityEvent.ps1') $writer -Force
icacls $writer /inheritance:r /grant:r '*S-1-5-18:(F)' '*S-1-5-32-544:(F)' ('*'+$sid+':(R)')|Out-Null
if($LASTEXITCODE){throw 'No se pudo proteger el escritor de auditoría'}
$secret=Join-Path $root 'secrets\environment.p7m'
Copy-Item $secret ($secret+'.before-security') -Force
try{
 $package=Unprotect-CmsMessage -Path $secret|ConvertFrom-Json
 if($package.format -ne 'environment-v1'){throw 'Entorno no compatible'}
 # No MCP servers inherited from a private user config. Do not print that config.
 $homePath=$package.variables.CODEX_HOME
 $config=Join-Path $homePath 'config.toml'
 if(Test-Path $config){throw 'El perfil estricto requiere CODEX_HOME exclusivo sin config.toml heredado'}
 $package.variables|Add-Member -NotePropertyName AGENTES_SECURITY_MODE -NotePropertyValue 'strict' -Force
 $package.variables|Add-Member -NotePropertyName AGENTES_SECURITY_AUDIT_WRITER -NotePropertyValue $writer -Force
 Protect-CmsMessage -To (Get-Item ('Cert:\LocalMachine\My\'+$meta.cmsThumbprint)) -Content ($package|ConvertTo-Json -Depth 5 -Compress) -OutFile $secret
}finally{$package=$null}
@{configured=$true;log='StackBI-Security';serviceWriteOnly=$true;maxLogBytes=33554432;requiresMotorUpdate=$true}|ConvertTo-Json -Compress
