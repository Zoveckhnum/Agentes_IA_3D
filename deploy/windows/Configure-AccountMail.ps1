[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$SecretInputFile,[Parameter(Mandatory=$true)][string]$Sender,[string]$SenderName='Stackbi Office')
$ErrorActionPreference='Stop'
$appRoot='C:\ProgramData\StackBI\Applications\agentes-ia-3d'
$secret='C:\ProgramData\StackBI\Secrets\agentes-ia-3d\environment.p7m'
$temporary=$secret+'.account-mail.pending'
try {
  if($Sender -notmatch '^[^\s@]+@[^\s@]+\.[^\s@]+$'){throw 'Invalid sender'}
  $source=[IO.File]::ReadAllText((Resolve-Path -LiteralPath $SecretInputFile).Path)
  $match=[regex]::Match($source,'xkeysib-[A-Za-z0-9_-]+')
  if(-not $match.Success){throw 'Missing Brevo key'}
  $apiKey=$match.Value
  $source=$null;$match=$null
  $senders=Invoke-RestMethod -Uri 'https://api.brevo.com/v3/senders' -Headers @{'api-key'=$apiKey;accept='application/json'} -TimeoutSec 20
  if(-not($senders.senders|Where-Object {$_.email -eq $Sender -and $_.active})){throw 'Sender not active'}
  $deployment=Get-Content -LiteralPath (Join-Path $appRoot 'deployment.json') -Raw|ConvertFrom-Json
  $package=Unprotect-CmsMessage -Path $secret|ConvertFrom-Json
  if($package.format -ne 'environment-v1'){throw 'Invalid environment'}
  $package.variables|Add-Member -NotePropertyName APP_BREVO_API_KEY -NotePropertyValue $apiKey -Force
  $package.variables|Add-Member -NotePropertyName APP_MAIL_SENDER -NotePropertyValue $Sender -Force
  $package.variables|Add-Member -NotePropertyName APP_MAIL_SENDER_NAME -NotePropertyValue $SenderName -Force
  if(-not $package.variables.APP_SECURITY_CODE_SECRET){
    $bytes=New-Object byte[] 32
    $rng=[Security.Cryptography.RandomNumberGenerator]::Create()
    try{$rng.GetBytes($bytes)}finally{$rng.Dispose()}
    $package.variables|Add-Member -NotePropertyName APP_SECURITY_CODE_SECRET -NotePropertyValue ([Convert]::ToBase64String($bytes)) -Force
    $bytes=$null
  }
  $certificate=Get-Item ('Cert:\LocalMachine\My\'+$deployment.cmsThumbprint)
  Protect-CmsMessage -To $certificate -Content ($package|ConvertTo-Json -Depth 8 -Compress) -OutFile $temporary
  Copy-Item -LiteralPath $secret -Destination ($secret+'.before-account-mail') -Force
  Move-Item -LiteralPath $temporary -Destination $secret -Force
  @{configured=$true;sender=$Sender;encryptedStorage=$true;serviceRestarted=$false}|ConvertTo-Json -Compress
}catch{
  # Do not expose provider response bodies or decrypted configuration.
  throw 'No se pudo configurar el correo de seguridad. La clave no se ha mostrado.'
}finally{$apiKey=$null;$package=$null;$source=$null;$senders=$null}
