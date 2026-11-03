$ErrorActionPreference='Stop'
$root='C:\ProgramData\StackBI\HumanApprovals'
try{
  $incoming=[Console]::In.ReadToEnd()|ConvertFrom-Json
  if(-not $incoming.botToken -or [string]$incoming.ownerId -notmatch '^[1-9]\d{3,19}$'){throw 'Falta la conexión y propietario de Telegram'}
  $meta=Get-Content -LiteralPath (Join-Path $root 'deployment.json') -Raw|ConvertFrom-Json
  $broker=Unprotect-CmsMessage -Path (Join-Path $root 'secrets\broker.p7m')|ConvertFrom-Json
  $broker.variables|Add-Member -NotePropertyName APP_HITL_BOT_TOKEN -NotePropertyValue ([string]$incoming.botToken) -Force
  $broker.variables|Add-Member -NotePropertyName APP_HITL_OWNER_ID -NotePropertyValue ([string]$incoming.ownerId) -Force
  Protect-CmsMessage -To (Get-Item ('Cert:\LocalMachine\My\'+$meta.brokerCmsThumbprint)) -Content ($broker|ConvertTo-Json -Depth 5 -Compress) -OutFile (Join-Path $root 'secrets\broker.p7m')
  if($incoming.google){
    $operator=Unprotect-CmsMessage -Path (Join-Path $root 'secrets\operator.p7m')|ConvertFrom-Json
    foreach($pair in @{APP_HITL_GOOGLE_CLIENT_ID=$incoming.google.clientId;APP_HITL_GOOGLE_CLIENT_SECRET=$incoming.google.clientSecret;APP_HITL_GOOGLE_REFRESH_TOKEN=$incoming.google.refreshToken;APP_HITL_GOOGLE_ROOT=$incoming.google.root}.GetEnumerator()){$operator.variables|Add-Member -NotePropertyName $pair.Key -NotePropertyValue ([string]$pair.Value) -Force}
    Protect-CmsMessage -To (Get-Item ('Cert:\LocalMachine\My\'+$meta.operatorCmsThumbprint)) -Content ($operator|ConvertTo-Json -Depth 5 -Compress) -OutFile (Join-Path $root 'secrets\operator.p7m')
  }
  @{protected=$true;telegramConfigured=$true;driveConfigured=[bool]$incoming.google}|ConvertTo-Json -Compress
}finally{$incoming=$null;$broker=$null;$operator=$null}
