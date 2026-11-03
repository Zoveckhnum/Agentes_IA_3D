[CmdletBinding()]
param([switch]$Pause)
$ErrorActionPreference='Stop'
$root='C:\ProgramData\StackBI\AgentMotor'
$path=Join-Path $root 'policy.json'
$policy=Get-Content -LiteralPath $path -Raw|ConvertFrom-Json
if($policy.format -ne 'stackbi-auto-loop-v1'){throw 'Política inesperada'}
if($Pause){Stop-Service StackBI-AgentMotor;$policy.mode='disabled'}else{
  $proof=Get-Content -LiteralPath (Join-Path $root 'data\state\codex-probe.json') -Raw|ConvertFrom-Json
  if(-not $proof.passed){throw 'Codex todavía no pasó la prueba bajo la identidad del servicio'}
  if(-not $policy.PSObject.Properties['activatedAt']){$policy.acceptAfter=(Get-Date).ToUniversalTime().ToString('o');$policy|Add-Member -NotePropertyName activatedAt -NotePropertyValue $policy.acceptAfter}
  $policy.mode='tasks-only'
}
$policy|ConvertTo-Json|Set-Content -LiteralPath $path -Encoding UTF8
if(-not $Pause){Restart-Service StackBI-AgentMotor}
@{mode=$policy.mode;acceptAfter=$policy.acceptAfter;maxTasksPerDay=$policy.maxTasksPerDay;externalNotifications=$false}|ConvertTo-Json -Compress
