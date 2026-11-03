[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$root='C:\ProgramData\StackBI\AgentMotor'
$deployment=Get-Content -LiteralPath (Join-Path $root 'deployment.json') -Raw|ConvertFrom-Json
if($deployment.service -ne 'StackBI-AgentMotor'){throw 'Servicio inesperado'}
$before=$env:CODEX_HOME
try{
  $env:CODEX_HOME=Join-Path $root 'codex'
  & $deployment.codexExecutable login
  if($LASTEXITCODE){throw 'No se completó la autenticación de Codex'}
}finally{$env:CODEX_HOME=$before}
