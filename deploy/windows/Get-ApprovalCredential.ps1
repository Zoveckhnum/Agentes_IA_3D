[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$EnvironmentFile)
$ErrorActionPreference='Stop'
if([IO.Path]::GetFullPath($EnvironmentFile) -ne 'C:\ProgramData\StackBI\AgentMotor\secrets\approval-request.p7m'){throw 'Canal no permitido'}
try{
  $package=Unprotect-CmsMessage -Path $EnvironmentFile|ConvertFrom-Json
  if($package.format -ne 'environment-v1' -or $package.variables.APP_HITL_ENDPOINT -ne 'http://127.0.0.1:10013' -or $package.variables.APP_HITL_REQUEST_TOKEN.Length -lt 48){throw 'Paquete no válido'}
  # Private stdout pipe to the MCP process; never run interactively or log output.
  @{endpoint=$package.variables.APP_HITL_ENDPOINT;token=$package.variables.APP_HITL_REQUEST_TOKEN}|ConvertTo-Json -Compress
}finally{$package=$null}
