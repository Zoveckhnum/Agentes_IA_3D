[CmdletBinding()]
param([string]$RepositoryRoot=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path)
$ErrorActionPreference='Stop'
$platform='C:\ProgramData\StackBI\Platform'
New-Item -ItemType Directory -Path $platform -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Backup-LocalSql.ps1') -Destination $platform -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Run-DatabaseMaintenance.ps1') -Destination $platform -Force
Copy-Item -LiteralPath (Join-Path $RepositoryRoot 'server\tools\backup-plan.mjs') -Destination $platform -Force
$connection=New-Object System.Data.SqlClient.SqlConnection 'Server=lpc:.\STACKBI;Database=master;Integrated Security=True;Encrypt=False'
$connection.Open()
try {
  $command=$connection.CreateCommand()
  # SYSTEM is the privileged DBA/maintenance identity, never the application identity.
  # Restore checks require control of the restored database, whose owner is retained by RESTORE.
  $command.CommandText="IF NOT EXISTS(SELECT 1 FROM sys.server_principals WHERE name=N'NT AUTHORITY\SYSTEM') CREATE LOGIN [NT AUTHORITY\SYSTEM] FROM WINDOWS; ALTER SERVER ROLE sysadmin ADD MEMBER [NT AUTHORITY\SYSTEM];"
  [void]$command.ExecuteNonQuery()
} finally {$connection.Close()}
$action=New-ScheduledTaskAction -Execute 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' -Argument '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "C:\ProgramData\StackBI\Platform\Run-DatabaseMaintenance.ps1"'
$trigger=New-ScheduledTaskTrigger -Daily -At '03:00'
$principal=New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings=New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName 'StackBI-AgentesIA3D-Backup' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Respaldo diario con checksum, restauración de prueba y retención limitada a 20 GiB.' -Force | Out-Null
Get-ScheduledTask -TaskName 'StackBI-AgentesIA3D-Backup' | Select-Object TaskName,State | ConvertTo-Json
