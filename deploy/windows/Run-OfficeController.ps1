$ErrorActionPreference='Stop'
$root='C:\ProgramData\StackBI\OfficeControl'
$log=Join-Path $root 'logs\controller.log'
if((Test-Path $log) -and (Get-Item $log).Length -gt 4MB){if(Test-Path ($log+'.3')){Remove-Item -LiteralPath ($log+'.3')};for($n=2;$n -ge 1;$n--){if(Test-Path ($log+'.'+$n)){Move-Item -LiteralPath ($log+'.'+$n) -Destination ($log+'.'+($n+1))}};Move-Item -LiteralPath $log -Destination ($log+'.1')}
$ErrorActionPreference='Continue'
& 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $root 'service\Start-NodeApplication.ps1') -EnvironmentFile (Join-Path $root 'secrets\controller.p7m') -EntryScript (Join-Path $root 'program\office\controller.mjs') *>> $log
exit $LASTEXITCODE
