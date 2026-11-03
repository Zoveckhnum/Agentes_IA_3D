[CmdletBinding()]
param([string]$Instance='STACKBI',[string]$Database='AgentesIA3D',[long]$BudgetBytes=21474836480,[switch]$RestoreDrill,[string]$PlannerPath=(Join-Path $PSScriptRoot 'backup-plan.mjs'))
$ErrorActionPreference='Stop'
if($Instance -notmatch '^[A-Z][A-Z0-9_]{0,15}$' -or $Database -ne 'AgentesIA3D' -or $BudgetBytes -lt 1GB){throw 'Parámetros de respaldo inválidos'}
$root=[IO.Path]::GetFullPath('C:\ProgramData\StackBI\Backups\AgentesIA3D')
$restoreRoot=[IO.Path]::GetFullPath('C:\ProgramData\StackBI\RestoreChecks')
New-Item -ItemType Directory -Path $root,$restoreRoot -Force | Out-Null
$sqlIdentity='NT SERVICE\MSSQL$'+$Instance
foreach($directory in @($root,$restoreRoot)) {
  if((Get-Item -LiteralPath $directory).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'No se admiten enlaces en los directorios de respaldo'}
  icacls $directory /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)(F)' '*S-1-5-32-544:(OI)(CI)(F)' ($sqlIdentity+':(OI)(CI)(M)') | Out-Null
  if($LASTEXITCODE -ne 0){throw 'No se pudieron proteger los respaldos'}
}
$stamp=(Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssfffZ')
foreach($oldFile in Get-ChildItem -LiteralPath $root -Filter '*.bak' -File) {
  if(-not (Test-Path -LiteralPath ($oldFile.FullName+'.manifest.json'))){throw 'Existe un respaldo incompleto; se requiere revisarlo antes de crear más copias'}
}
$name=$Database+'-'+$stamp+'.bak'
$backup=Join-Path $root $name
$restoreDatabase='AgentesIA3D_Restore_'+$stamp.Replace('T','').Replace('Z','')
$connection=New-Object System.Data.SqlClient.SqlConnection ('Server=lpc:.\'+$Instance+';Database=master;Integrated Security=True;Encrypt=False;Connect Timeout=15')
$connection.Open()
$restored=$false
try {
  $command=$connection.CreateCommand();$command.CommandTimeout=20
  $command.CommandText="DECLARE @r int; EXEC @r=sp_getapplock @Resource='StackBI.Backup.AgentesIA3D',@LockMode='Exclusive',@LockOwner='Session',@LockTimeout=0; SELECT @r;"
  if([int]$command.ExecuteScalar() -lt 0){throw 'Ya hay un respaldo en ejecución'}
  $command=$connection.CreateCommand();$command.CommandText="USE [$Database]; SELECT SUM(CAST(size AS bigint))*8192 FROM sys.database_files;"
  $allocated=[long]$command.ExecuteScalar()
  $available=(Get-Volume -DriveLetter C).SizeRemaining
  if($available -lt ($allocated*3+2GB)){throw 'Espacio insuficiente para respaldar y verificar sin llenar el disco'}
  $command=$connection.CreateCommand();$command.CommandTimeout=600
  $command.CommandText="BACKUP DATABASE [$Database] TO DISK=@file WITH CHECKSUM,INIT; RESTORE VERIFYONLY FROM DISK=@file WITH CHECKSUM;"
  [void]$command.Parameters.AddWithValue('@file',$backup)
  [void]$command.ExecuteNonQuery()
  $manifest=@{format='stackbi-sql-backup-v1';database=$Database;name=$name;createdAt=(Get-Date).ToUniversalTime().ToString('o');bytes=(Get-Item -LiteralPath $backup).Length;sha256=(Get-FileHash -LiteralPath $backup -Algorithm SHA256).Hash.ToLowerInvariant();verified=$true;restoreDrill=$false}
  if($RestoreDrill) {
    $command=$connection.CreateCommand();$command.CommandText='RESTORE FILELISTONLY FROM DISK=@file';[void]$command.Parameters.AddWithValue('@file',$backup)
    $table=New-Object System.Data.DataTable
    $reader=$command.ExecuteReader();$table.Load($reader);$reader.Close()
    $moves=@();$index=0
    foreach($row in $table.Rows) {
      $logical=([string]$row.LogicalName).Replace("'","''")
      $extension=if($row.Type -eq 'L'){'.ldf'}else{'.mdf'}
      $destination=Join-Path $restoreRoot ($restoreDatabase+'-'+$index+$extension)
      $moves+=('MOVE N'''+$logical+''' TO N'''+$destination.Replace("'","''")+'''');$index++
    }
    $command=$connection.CreateCommand();$command.CommandTimeout=600
    $command.CommandText="IF DB_ID('$restoreDatabase') IS NOT NULL THROW 50002,'Destino de prueba existente',1; RESTORE DATABASE [$restoreDatabase] FROM DISK=@file WITH "+($moves -join ',')+',RECOVERY,CHECKSUM;'
    [void]$command.Parameters.AddWithValue('@file',$backup)
    [void]$command.ExecuteNonQuery();$restored=$true
    $command=$connection.CreateCommand();$command.CommandTimeout=600
    $command.CommandText="DBCC CHECKDB ([$restoreDatabase]) WITH NO_INFOMSGS; USE [$restoreDatabase]; SELECT (SELECT COUNT(*) FROM app.Documents) AS Documents,(SELECT COUNT(*) FROM app.Accounts) AS Accounts,(SELECT COUNT(*) FROM dbo.SchemaMigrations) AS SchemaVersions;"
    $table=New-Object System.Data.DataTable
    $reader=$command.ExecuteReader();$table.Load($reader);$reader.Close()
    if($table.Rows.Count -ne 1 -or [int]$table.Rows[0].SchemaVersions -lt 1){throw 'No se verificó el esquema restaurado'}
    $manifest.restoreDrill=$true
    $manifest.documentCount=[int]$table.Rows[0].Documents
    $manifest.accountCount=[int]$table.Rows[0].Accounts
  }
  $manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath ($backup+'.manifest.json') -Encoding UTF8
} finally {
  if($restored) {
    # Only the unique database created by this invocation can be dropped.
    if($restoreDatabase -notmatch '^AgentesIA3D_Restore_\d{17}$'){throw 'Identificador de restauración inesperado'}
    $cleanup=$connection.CreateCommand();$cleanup.CommandTimeout=120
    $cleanup.CommandText="USE master; ALTER DATABASE [$restoreDatabase] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [$restoreDatabase];"
    [void]$cleanup.ExecuteNonQuery()
  }
  $connection.Close()
}
$candidates=@()
foreach($file in Get-ChildItem -LiteralPath $root -Filter '*.bak.manifest.json' -File) {
  if($file.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Manifiesto de respaldo con enlace no permitido'}
  $entry=Get-Content -LiteralPath $file.FullName -Raw | ConvertFrom-Json
  if($entry.format -ne 'stackbi-sql-backup-v1' -or $entry.database -ne $Database -or $entry.name -notmatch '^AgentesIA3D-\d{8}T\d{9}Z\.bak$' -or -not $entry.verified){throw 'Manifiesto no reconocido; no se depuran archivos'}
  $candidate=[IO.Path]::GetFullPath((Join-Path $root $entry.name))
  if(-not $candidate.StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Respaldo fuera del directorio permitido'}
  $item=Get-Item -LiteralPath $candidate
  if($item.Attributes -band [IO.FileAttributes]::ReparsePoint -or $item.Length -ne $entry.bytes){throw 'Respaldo modificado; no se depuran archivos'}
  $candidates+=$entry
}
$planner=$PlannerPath
$planJson=@{backups=@($candidates);budget=$BudgetBytes}|ConvertTo-Json -Depth 5 -Compress
$planOutput=$planJson | & 'C:\Program Files\nodejs\node.exe' $planner
if($LASTEXITCODE -ne 0){throw 'No se pudo calcular la retención; los respaldos se conservan'}
$plan=$planOutput | ConvertFrom-Json
foreach($expired in $plan.remove) {
  if($expired -notmatch '^AgentesIA3D-\d{8}T\d{9}Z\.bak$'){throw 'Nombre de depuración inválido'}
  $target=[IO.Path]::GetFullPath((Join-Path $root $expired))
  if(-not $target.StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Destino de depuración fuera de la carpeta permitida'}
  Remove-Item -LiteralPath $target -Force
  Remove-Item -LiteralPath ($target+'.manifest.json') -Force
}
$status=@{ok=$true;lastBackup=$name;verified=$true;restoreDrill=$manifest.restoreDrill;retained=$plan.keep.Count;retainedBytes=$plan.bytes;budgetBytes=$BudgetBytes;updatedAt=(Get-Date).ToUniversalTime().ToString('o')}
$status | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $root 'status.json') -Encoding UTF8
$status | ConvertTo-Json -Depth 4
