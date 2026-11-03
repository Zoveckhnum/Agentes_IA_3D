$ErrorActionPreference='Stop'
$root='C:\ProgramData\StackBI\HumanApprovals'
$log=Join-Path $root 'logs\executor.log'
if(Test-Path -LiteralPath $log){if((Get-Item -LiteralPath $log).Length -gt 5MB){if(Test-Path -LiteralPath ($log+'.3')){Remove-Item -LiteralPath ($log+'.3')};for($n=2;$n -ge 1;$n--){if(Test-Path -LiteralPath ($log+'.'+$n)){Move-Item -LiteralPath ($log+'.'+$n) -Destination ($log+'.'+($n+1))}};Move-Item -LiteralPath $log -Destination ($log+'.1')}}
$ErrorActionPreference='Continue'
& 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $root 'service\Start-NodeApplication.ps1') -EnvironmentFile (Join-Path $root 'secrets\operator.p7m') -EntryScript (Join-Path $root 'program\motor\hitl\executors.mjs') *>> $log
exit $LASTEXITCODE
