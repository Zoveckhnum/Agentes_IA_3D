[CmdletBinding()]
param([ValidateSet('inspect','execute')][string]$Mode='inspect',[string]$PlanDirectory)
$ErrorActionPreference='Stop'
if($Mode -eq 'execute'){
  $registry='C:\ProgramData\StackBI\HumanApprovals\registry'
  $planPath=[IO.Path]::GetFullPath($PlanDirectory)
  if([IO.Path]::GetDirectoryName($planPath) -ne $registry -or (Split-Path $planPath -Leaf) -notmatch '^[a-f0-9-]{36}$'){throw 'Invalid registered SQL plan'}
  $plan=Get-Content -LiteralPath (Join-Path $planPath 'plan.json') -Raw|ConvertFrom-Json
  if($plan.kind -ne 'sql-schema' -or $plan.target.database -ne 'AgentesIA3D' -or $plan.payload.file -ne 'migration.sql'){throw 'Invalid SQL target'}
  $file=Join-Path $planPath 'migration.sql'
  if((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() -ne $plan.payload.sha256){throw 'SQL revision changed'}
}
$connection=New-Object System.Data.SqlClient.SqlConnection 'Server=lpc:.\STACKBI;Database=AgentesIA3D;Integrated Security=True;Encrypt=False;Connect Timeout=15'
$connection.Open()
function Schema-Digest {
  $cmd=$connection.CreateCommand()
  $cmd.CommandText=@'
SELECT CAST((SELECT
 (SELECT s.name AS [schema],o.name AS [object],o.type AS objectType,c.name AS [column],ty.name AS dataType,c.max_length,c.precision,c.scale,c.is_nullable,c.is_identity,c.collation_name,dc.definition AS [default]
  FROM sys.objects o JOIN sys.schemas s ON s.schema_id=o.schema_id JOIN sys.columns c ON c.object_id=o.object_id JOIN sys.types ty ON ty.user_type_id=c.user_type_id LEFT JOIN sys.default_constraints dc ON dc.object_id=c.default_object_id
  WHERE o.is_ms_shipped=0 ORDER BY s.name,o.name,c.column_id FOR JSON PATH,INCLUDE_NULL_VALUES) AS columnsJSON,
 (SELECT s.name AS [schema],o.name,o.type,m.definition,m.uses_ansi_nulls,m.uses_quoted_identifier FROM sys.objects o JOIN sys.schemas s ON s.schema_id=o.schema_id LEFT JOIN sys.sql_modules m ON m.object_id=o.object_id WHERE o.is_ms_shipped=0 ORDER BY s.name,o.name,o.type FOR JSON PATH,INCLUDE_NULL_VALUES) AS modulesJSON,
 (SELECT OBJECT_SCHEMA_NAME(i.object_id) AS [schema],OBJECT_NAME(i.object_id) AS [object],i.name,i.type,i.is_unique,i.is_primary_key,i.filter_definition,c.index_column_id,c.column_id,c.is_descending_key,c.is_included_column FROM sys.indexes i JOIN sys.index_columns c ON c.object_id=i.object_id AND c.index_id=i.index_id WHERE OBJECTPROPERTY(i.object_id,'IsMSShipped')=0 ORDER BY i.object_id,i.index_id,c.index_column_id FOR JSON PATH,INCLUDE_NULL_VALUES) AS indexesJSON,
 (SELECT name,definition,is_disabled,is_not_trusted FROM sys.check_constraints ORDER BY name FOR JSON PATH,INCLUDE_NULL_VALUES) AS checksJSON,
 (SELECT name,parent_object_id,referenced_object_id,delete_referential_action,update_referential_action,is_disabled,is_not_trusted FROM sys.foreign_keys ORDER BY name FOR JSON PATH,INCLUDE_NULL_VALUES) AS foreignKeysJSON
 FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) AS nvarchar(max))
'@
  $text=[string]$cmd.ExecuteScalar()
  if($text.Length -gt 1048576){throw 'Schema baseline too large'}
  $hash=[Security.Cryptography.SHA256]::Create()
  try{return ([BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($text)))).Replace('-','').ToLowerInvariant()}finally{$hash.Dispose()}
}
try{
  $before=Schema-Digest
  if($Mode -eq 'inspect'){@{database='AgentesIA3D';schemaSHA256=$before}|ConvertTo-Json -Compress;exit 0}
  if($before -ne $plan.target.schemaSHA256){throw 'Database schema changed after review'}
  $script=[IO.File]::ReadAllText($file)
  if($script.Length -gt 524288 -or $script -match '(?im)^\s*[:!]' -or $script -match '(?i)\b(USE|EXEC|EXECUTE|OPENROWSET|OPENDATASOURCE|RECONFIGURE|SHUTDOWN)\b|\b(ALTER|DROP|CREATE)\s+(DATABASE|LOGIN|SERVER|CREDENTIAL|ENDPOINT)\b|\bxp_\w+'){throw 'This runner accepts reviewed database-local DDL only'}
  $backup=Join-Path $PSScriptRoot 'Backup-LocalSql.ps1'
  & $backup -RestoreDrill|Out-Null
  if(-not $?){throw 'Pre-migration backup verification failed'}
  if((Schema-Digest) -ne $before){throw 'Schema changed during backup'}
  $transaction=$connection.BeginTransaction()
  try{
    $cmd=$connection.CreateCommand();$cmd.Transaction=$transaction;$cmd.CommandText='SET XACT_ABORT ON;';[void]$cmd.ExecuteNonQuery()
    foreach($batch in [regex]::Split($script,'(?im)^\s*GO\s*(?:--[^\r\n]*)?$')){if($batch.Trim()){$cmd=$connection.CreateCommand();$cmd.Transaction=$transaction;$cmd.CommandTimeout=600;$cmd.CommandText=$batch;[void]$cmd.ExecuteNonQuery()}}
    $transaction.Commit()
  }catch{$transaction.Rollback();throw}
  @{ok=$true;database='AgentesIA3D';beforeSchemaSHA256=$before;afterSchemaSHA256=(Schema-Digest);backupVerified=$true}|ConvertTo-Json -Compress
}finally{$connection.Close()}
