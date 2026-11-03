[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$EnvironmentFile,[Parameter(Mandatory=$true)][string]$EntryScript)
$ErrorActionPreference='Stop'
$old=@{}
try {
  $package=Unprotect-CmsMessage -Path $EnvironmentFile | ConvertFrom-Json
  if ($package.format -ne 'environment-v1' -or -not $package.variables) { throw 'Paquete CMS no compatible' }
  $variables=@($package.variables.PSObject.Properties)
  if ($variables.Count -gt 64) { throw 'Demasiadas variables protegidas' }
  foreach($variable in $variables) {
    $name=$variable.Name
    if ($name -notmatch '^(CORE_DB_[A-Z0-9_]+|WORKER_[A-Z0-9_]+|APP_[A-Z0-9_]+|AGENTES_[A-Z0-9_]+|NODE_ENV|PORT|PUBLIC_ORIGIN|ALLOW_LOCAL_HTTP)$') { throw 'Nombre de variable no permitido' }
    if ($variable.Value -isnot [string] -or $variable.Value.Length -gt 8192 -or $variable.Value.Contains([char]0)) { throw 'Valor de variable no permitido' }
    $old[$name]=[Environment]::GetEnvironmentVariable($name,'Process')
    [Environment]::SetEnvironmentVariable($name,$variable.Value,'Process')
  }
  $package=$null
  & 'C:\Program Files\nodejs\node.exe' $EntryScript
  $result=$LASTEXITCODE
} catch {
  # Never print decrypted values, connection strings or private exception payloads.
  Write-Error 'No se pudo iniciar la aplicación con la configuración protegida.'
  $result=1
} finally {
  foreach($name in $old.Keys) { [Environment]::SetEnvironmentVariable($name,$old[$name],'Process') }
}
exit $result
