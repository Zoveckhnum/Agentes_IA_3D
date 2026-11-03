[CmdletBinding()]
param([Parameter(Mandatory=$true)][ValidateSet('prepare','request','status')][string]$Action,[string]$Kind,[string]$Project='stackbi',[string]$Summary,[string]$Document,[string]$FolderId,[string]$Name,[string]$PlanId,[string]$RequestId,[string]$TaskId)
$ErrorActionPreference='Stop'
$root='C:\ProgramData\StackBI\HumanApprovals'
$old=@{}
try{
  $package=Unprotect-CmsMessage -Path (Join-Path $root 'secrets\operator.p7m')|ConvertFrom-Json
  if($package.format -ne 'environment-v1'){throw 'Configuración de operador inválida'}
  foreach($variable in $package.variables.PSObject.Properties){if($variable.Name -notmatch '^APP_HITL_[A-Z0-9_]+$' -or $variable.Value -isnot [string]){throw 'Variable no permitida'};$old[$variable.Name]=[Environment]::GetEnvironmentVariable($variable.Name,'Process');[Environment]::SetEnvironmentVariable($variable.Name,$variable.Value,'Process')}
  $argsList=@((Join-Path $root 'program\tools\hitl.mjs'),$Action)
  if($Action -eq 'prepare'){
    $argsList+=@('--kind',$Kind,'--project',$Project,'--summary',$Summary)
    if($Document){$argsList+=@('--file',$Document)};if($FolderId){$argsList+=@('--folder',$FolderId)};if($Name){$argsList+=@('--name',$Name)}
  }elseif($Action -eq 'request'){$argsList+=@('--plan',$PlanId);if($TaskId){$argsList+=@('--task',$TaskId)}}else{$argsList+=@('--id',$RequestId)}
  & 'C:\Program Files\nodejs\node.exe' @argsList
  $result=$LASTEXITCODE
}finally{foreach($key in $old.Keys){[Environment]::SetEnvironmentVariable($key,$old[$key],'Process')};$package=$null}
exit $result
