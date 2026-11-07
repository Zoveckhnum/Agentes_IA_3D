[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$TargetEmail)
$ErrorActionPreference='Stop'
$secret='C:\ProgramData\StackBI\Secrets\agentes-ia-3d\environment.p7m'
$temporary=$secret+'.demo-email.pending'
$connection=$null
try {
  $target=$TargetEmail.Trim().ToLowerInvariant()
  if($target -notmatch '^[^\s@]+@[^\s@]+\.[^\s@]+$' -or $target.Length -gt 320 -or $target.EndsWith('.local')){throw 'Se requiere un correo real válido'}
  $package=Unprotect-CmsMessage -Path $secret|ConvertFrom-Json
  if($package.format -ne 'environment-v1' -or -not $package.variables.APP_OWNER_UID){throw 'Entorno no compatible'}
  $deployment=Get-Content -LiteralPath 'C:\ProgramData\StackBI\Applications\agentes-ia-3d\deployment.json' -Raw|ConvertFrom-Json
  $connection=New-Object System.Data.SqlClient.SqlConnection 'Server=lpc:.\STACKBI;Database=AgentesIA3D;Integrated Security=True;Encrypt=False;Connect Timeout=15'
  $connection.Open()
  $command=$connection.CreateCommand()
  $command.CommandText='SELECT Email,CredentialVersion FROM app.Accounts WHERE Uid=@uid AND Disabled=0 AND EmailVerified=0'
  [void]$command.Parameters.AddWithValue('@uid',[string]$package.variables.APP_OWNER_UID)
  $table=New-Object System.Data.DataTable
  $reader=$command.ExecuteReader();$table.Load($reader);$reader.Close()
  if($table.Rows.Count -ne 1 -or [string]$table.Rows[0].Email -notmatch '^[^\s@]+@[^\s@]+\.local$'){throw 'El propietario no es una cuenta de demostración sin verificar'}
  $approval=@{sourceEmail=([string]$table.Rows[0].Email).ToLowerInvariant();targetEmail=$target;credentialVersion=[int]$table.Rows[0].CredentialVersion;expiresAt=[DateTime]::UtcNow.AddHours(24).ToString('o')}
  $package.variables|Add-Member -NotePropertyName APP_OWNER_EMAIL_RECOVERY -NotePropertyValue ($approval|ConvertTo-Json -Compress) -Force
  $certificate=Get-Item ('Cert:\LocalMachine\My\'+$deployment.cmsThumbprint)
  Protect-CmsMessage -To $certificate -Content ($package|ConvertTo-Json -Depth 8 -Compress) -OutFile $temporary
  Copy-Item -LiteralPath $secret -Destination ($secret+'.before-demo-email-recovery') -Force
  Move-Item -LiteralPath $temporary -Destination $secret -Force
  $command=$connection.CreateCommand()
  $command.CommandText="INSERT INTO app.AuditLog(Actor,Action,DocumentPath) VALUES(N'local-operator','demo-email-recovery-approved',@path)"
  [void]$command.Parameters.AddWithValue('@path','users/'+[string]$package.variables.APP_OWNER_UID)
  [void]$command.ExecuteNonQuery()
  @{authorized=$true;targetEmail=$target;expiresAt=$approval.expiresAt;accountChanged=$false;serviceRestarted=$false}|ConvertTo-Json -Compress
}finally{if($connection){$connection.Close()};$package=$null}
