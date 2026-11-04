$ErrorActionPreference='Stop'
try{
 $inputText=[Console]::In.ReadToEnd()
 if($inputText.Length -gt 2048){throw 'size'}
 $value=$inputText|ConvertFrom-Json
 $actions=@{run_started=1001;run_finished=1002;tool_started=2001;tool_finished=2002;tool_denied=3001;file_read=2101;file_list=2102;file_written=2103;skill_read=2104;command_denied=3002;gate_probe=9001}
 if($value.format -ne 'stackbi-security-event-v1' -or -not $actions.ContainsKey([string]$value.action) -or $value.allowed -isnot [bool] -or $value.reason -notmatch '^[a-z_]{1,60}$' -or $value.runId -notmatch '^[a-f0-9-]{0,64}$'){throw 'schema'}
 foreach($key in @('taskSHA256','projectSHA256','subjectSHA256')){if($value.$key -notmatch '^[a-f0-9]{64}$'){throw 'fingerprint'}}
 $event=[ordered]@{format='stackbi-security-event-v1';time=[DateTime]::UtcNow.ToString('o');action=[string]$value.action;allowed=[bool]$value.allowed;reason=[string]$value.reason;taskSHA256=[string]$value.taskSHA256;projectSHA256=[string]$value.projectSHA256;subjectSHA256=[string]$value.subjectSHA256;runId=[string]$value.runId}
 $log=[Diagnostics.EventLog]::new('StackBI-Security','.','StackBI.AgentSecurity')
 try{$type=if($event.allowed){[Diagnostics.EventLogEntryType]::Information}else{[Diagnostics.EventLogEntryType]::Warning};$log.WriteEntry(($event|ConvertTo-Json -Compress),$type,[int]$actions[$value.action])}finally{$log.Dispose()}
 exit 0
}catch{
 [Console]::Error.WriteLine('security_audit_write_failed')
 exit 1
}
