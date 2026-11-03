$ErrorActionPreference='Stop'
$log='C:\ProgramData\StackBI\Backups\AgentesIA3D\maintenance.log'
try {
  & 'C:\ProgramData\StackBI\Platform\Backup-LocalSql.ps1' -RestoreDrill *> $log
  exit 0
} catch {
  ('Maintenance failed: '+$_.Exception.Message) | Add-Content -LiteralPath $log -Encoding UTF8
  exit 1
}
