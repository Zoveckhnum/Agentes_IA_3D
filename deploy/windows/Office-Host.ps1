$ErrorActionPreference='Stop'
$WarningPreference='SilentlyContinue'
$ProgressPreference='SilentlyContinue'
try{
 $inputText=[Console]::In.ReadToEnd();if($inputText.Length -gt 16384){throw 'Invalid operation'}
 $value=$inputText|ConvertFrom-Json
 $names=@('node-agentes-ia-3d','node-agentes-ia-3d-staging','StackBI-DeployBroker','StackBI-AgentMotor')
 switch($value.operation){
  'snapshot'{
   Import-Module WebAdministration
   $services=@(Get-Service -Name $names|ForEach-Object {@{name=$_.Name;running=$_.Status -eq 'Running';startType=$_.StartType.ToString()}})
   $sites=@(Get-Website|Where-Object {$_.Name -in @('StackBI-CI-Staging','StackBI-Agentes-SQL-Preview')}|ForEach-Object {@{name=$_.Name;started=$_.State -eq 'Started'}})
   @{services=$services;sites=$sites;humanExecutorEnabled=(Get-ScheduledTask -TaskName StackBI-HumanExecutor).State -ne 'Disabled'}|ConvertTo-Json -Depth 6 -Compress
  }
  'quiesce'{Disable-ScheduledTask -TaskName StackBI-HumanExecutor|Out-Null;@{ok=$true}|ConvertTo-Json -Compress}
  'busy'{$scheduler=New-Object -ComObject Schedule.Service;$scheduler.Connect();$task=$scheduler.GetFolder('\').GetTask('StackBI-HumanExecutor');@{busy=$task.GetInstances(0).Count -gt 0}|ConvertTo-Json -Compress}
  'stop'{
   foreach($name in @('StackBI-AgentMotor','StackBI-DeployBroker','node-agentes-ia-3d-staging','node-agentes-ia-3d')){Set-Service $name -StartupType Manual;if((Get-Service $name).Status -ne 'Stopped'){Stop-Service $name}}
   Import-Module WebAdministration
   foreach($site in @('StackBI-CI-Staging','StackBI-Agentes-SQL-Preview')){if((Get-Website -Name $site).State -eq 'Started'){Stop-Website -Name $site}}
   @{ok=$true}|ConvertTo-Json -Compress
  }
  'start'{
   foreach($entry in $value.snapshot.services){if($entry.name -notin $names -or $entry.startType -notin @('Automatic','Manual','Disabled')){throw 'Invalid snapshot'}}
   foreach($name in $names){$entry=$value.snapshot.services|Where-Object name -eq $name;if(-not $entry){throw 'Incomplete snapshot'};Set-Service $name -StartupType $entry.startType;if($entry.running -and (Get-Service $name).Status -ne 'Running'){Start-Service $name}}
   $ready=$false;for($n=0;$n -lt 25;$n++){try{$health=Invoke-RestMethod http://127.0.0.1:10011/health/db -TimeoutSec 2;if($health.ok -and $health.permissionsRestricted){$ready=$true;break}}catch{};Start-Sleep -Seconds 1};if(-not $ready){throw 'Application not ready'}
   Import-Module WebAdministration
   foreach($site in $value.snapshot.sites){if($site.name -notin @('StackBI-CI-Staging','StackBI-Agentes-SQL-Preview')){throw 'Invalid site'};if($site.started -and (Get-Website -Name $site.name).State -ne 'Started'){Start-Website $site.name}}
   @{ok=$true}|ConvertTo-Json -Compress
  }
  'resume'{if($value.snapshot.humanExecutorEnabled){Enable-ScheduledTask -TaskName StackBI-HumanExecutor|Out-Null};@{ok=$true}|ConvertTo-Json -Compress}
  default{throw 'Operation not supported'}
 }
 exit 0
}catch{[Console]::Error.WriteLine('office_host_operation_failed');exit 1}
