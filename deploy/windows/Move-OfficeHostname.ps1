[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$NewHost)
$ErrorActionPreference='Stop'
if($NewHost -notmatch '^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)+$'){throw 'Se requiere un nombre de host válido'}
Import-Module WebAdministration
$appRoot='C:\ProgramData\StackBI\Applications\agentes-ia-3d'
$officeRoot='C:\ProgramData\StackBI\OfficeControl'
$manifest=Join-Path $appRoot 'deployment.json'
$deployment=Get-Content -LiteralPath $manifest -Raw|ConvertFrom-Json
$office=Get-Content -LiteralPath (Join-Path $officeRoot 'deployment.json') -Raw|ConvertFrom-Json
$newOrigin='https://'+$NewHost
if($deployment.origin -eq $newOrigin){throw 'El origen solicitado ya está activo'}
$oldOrigin=[string]$deployment.origin
$backup=Join-Path $appRoot ('hostname-migrations\'+(Get-Date -Format 'yyyyMMdd-HHmmssfff'))
New-Item -ItemType Directory -Path $backup -Force|Out-Null
& icacls $backup /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)(F)' '*S-1-5-32-544:(OI)(CI)(F)'|Out-Null
if($LASTEXITCODE){throw 'No se pudo proteger el respaldo de publicación'}
$web='C:\inetpub\stackbi-agentes-public\web.config'
$tunnel='C:\ProgramData\cloudflared\config.yml'
$cloudflared='C:\Program Files\cloudflared\cloudflared.exe'
$items=@(
  @{path=$web;name='web.config'},
  @{path=$tunnel;name='tunnel.yml'},
  @{path=$manifest;name='deployment.json'},
  @{path='C:\ProgramData\StackBI\Secrets\agentes-ia-3d\environment.p7m';name='api.p7m';cert=$deployment.cmsThumbprint},
  @{path=(Join-Path $officeRoot 'secrets\gateway.p7m');name='gateway.p7m';cert=$office.gatewayCmsThumbprint},
  @{path=(Join-Path $officeRoot 'secrets\controller.p7m');name='controller.p7m';cert=$office.controllerCmsThumbprint}
)
foreach($item in $items){Copy-Item -LiteralPath $item.path -Destination (Join-Path $backup $item.name)}
$site=Get-Website -Name StackBI
if($site.PhysicalPath -ne 'C:\inetpub\stackbi-agentes-public'){throw 'El sitio IIS no coincide con la instalación revisada'}
$binding='*:80:'+$NewHost
$hasBinding=@($site.Bindings.Collection.bindingInformation) -contains $binding
if(-not $hasBinding -and (Get-WebBinding|Where-Object {$_.bindingInformation -eq $binding})){throw 'El host ya pertenece a otro sitio IIS'}
$task=Get-ScheduledTask -TaskName StackBI-OfficeController
$taskEnabled=$task.Settings.Enabled
$changed=$false;$bindingAdded=$false
try {
  if($taskEnabled){Disable-ScheduledTask -TaskName StackBI-OfficeController|Out-Null}
  for($i=0;$i -lt 30 -and (Get-ScheduledTask -TaskName StackBI-OfficeController).State -eq 'Running';$i++){Start-Sleep -Seconds 1}
  if((Get-ScheduledTask -TaskName StackBI-OfficeController).State -eq 'Running'){throw 'El controlador de oficina sigue ocupado; se conserva el origen anterior'}
  $health=Invoke-RestMethod http://127.0.0.1:10014/_office/health -TimeoutSec 10
  if(-not $health.ok -or $health.mode -ne 'open' -or -not $health.permissionsRestricted){throw 'La oficina no está lista para cambiar de origen'}
  $config=[IO.File]::ReadAllText($tunnel)
  if($config.Contains('hostname: '+$NewHost)){throw 'El túnel ya contiene este host; revisar antes de sustituirlo'}
  if([regex]::Matches($config,'(?m)^ingress:\s*$').Count -ne 1){throw 'Configuración de rutas del túnel inesperada'}
  $entry="ingress:`r`n  - hostname: $NewHost`r`n    service: http://127.0.0.1:80`r`n    originRequest:`r`n      httpHostHeader: $NewHost`r`n"
  $updated=[regex]::Replace($config,'(?m)^ingress:[ \t]*\r?\n',$entry)
  $candidate=Join-Path $backup 'tunnel-candidate.yml'
  [IO.File]::WriteAllText($candidate,$updated,(New-Object Text.UTF8Encoding($false)))
  & $cloudflared --config $candidate tunnel ingress validate|Out-Null
  if($LASTEXITCODE){throw 'Las rutas preparadas del túnel no son válidas'}
  foreach($item in $items|Where-Object {$_.cert}){
    try{
      $package=Unprotect-CmsMessage -Path $item.path|ConvertFrom-Json
      if($package.format -ne 'environment-v1' -or $package.variables.PUBLIC_ORIGIN -ne $oldOrigin){throw 'Los orígenes de los servicios no coinciden'}
      $package.variables.PUBLIC_ORIGIN=$newOrigin
      $cert=Get-Item ('Cert:\LocalMachine\My\'+$item.cert)
      Protect-CmsMessage -To $cert -Content ($package|ConvertTo-Json -Depth 12 -Compress) -OutFile (Join-Path $backup ($item.name+'.new'))
    }finally{$package=$null}
  }
  $xml=[xml][IO.File]::ReadAllText($web)
  $canonical=$xml.SelectSingleNode('/configuration/system.webServer/rewrite/rules/rule[@name="Canonical HTTPS origin"]')
  if(-not $canonical){throw 'No se encontró la regla de origen canónico'}
  $conditions=$canonical.SelectSingleNode('conditions');$conditions.RemoveAll();$conditions.SetAttribute('logicalGrouping','MatchAny')
  $hostCondition=$xml.CreateElement('add');$hostCondition.SetAttribute('input','{HTTP_HOST}');$hostCondition.SetAttribute('pattern',('^'+[regex]::Escape($NewHost)+'$'));$hostCondition.SetAttribute('negate','true');[void]$conditions.AppendChild($hostCondition)
  $httpsCondition=$xml.CreateElement('add');$httpsCondition.SetAttribute('input','{HTTP_X_FORWARDED_PROTO}');$httpsCondition.SetAttribute('pattern','^https$');$httpsCondition.SetAttribute('negate','true');[void]$conditions.AppendChild($httpsCondition)
  $canonical.SelectSingleNode('action').SetAttribute('url',($newOrigin+'/{R:1}'))
  $changed=$true
  foreach($item in $items|Where-Object {$_.cert}){Copy-Item -LiteralPath (Join-Path $backup ($item.name+'.new')) -Destination $item.path -Force}
  if(-not $hasBinding){New-WebBinding -Name StackBI -Protocol http -Port 80 -IPAddress '*' -HostHeader $NewHost;$bindingAdded=$true}
  [IO.File]::WriteAllText($tunnel,$updated,(New-Object Text.UTF8Encoding($false)))
  $xml.Save($web)
  Restart-Service node-agentes-ia-3d
  Restart-Service StackBI-OfficeControl
  Restart-Service Cloudflared
  $ready=$false
  for($attempt=0;$attempt -lt 30;$attempt++){
    try{
      $db=Invoke-RestMethod ($newOrigin+'/health/db') -TimeoutSec 5
      $status=Invoke-RestMethod ($newOrigin+'/_office/status') -TimeoutSec 5
      if($db.ok -and $db.permissionsRestricted -and $db.certificateValidated -and $status.mode -eq 'open'){$ready=$true;break}
    }catch{}
    Start-Sleep -Seconds 1
  }
  if(-not $ready){throw 'No se pudo verificar la oficina en el nuevo origen'}
  $page=Invoke-WebRequest $newOrigin -UseBasicParsing -TimeoutSec 15
  if($page.StatusCode -ne 200 -or $page.Content -notmatch '<div id="root"'){throw 'El nuevo host no muestra la aplicación'}
  # Read again to retain any additional release metadata written by maintenance.
  $current=Get-Content -LiteralPath $manifest -Raw|ConvertFrom-Json
  $current.origin=$newOrigin
  $current|Add-Member -NotePropertyName previousOrigin -NotePropertyValue $oldOrigin -Force
  $current|Add-Member -NotePropertyName originChangedAt -NotePropertyValue ([DateTime]::UtcNow.ToString('o')) -Force
  $current|ConvertTo-Json -Depth 12|Set-Content -LiteralPath $manifest -Encoding UTF8
  @{format='stackbi-hostname-migration-v1';verified=$true;oldOrigin=$oldOrigin;origin=$newOrigin;backup=$backup;previousHostRedirects=$true;databaseUnchanged=$true;release=$current.release}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $backup 'result.json') -Encoding UTF8
  @{migrated=$true;origin=$newOrigin;previousOrigin=$oldOrigin;databaseVerified=$true;officeVerified=$true;backup=$backup}|ConvertTo-Json -Compress
}catch{
  if($changed){
    foreach($item in $items){Copy-Item -LiteralPath (Join-Path $backup $item.name) -Destination $item.path -Force}
    if($bindingAdded){Remove-WebBinding -Name StackBI -Protocol http -Port 80 -IPAddress '*' -HostHeader $NewHost}
    Restart-Service node-agentes-ia-3d;Restart-Service StackBI-OfficeControl;Restart-Service Cloudflared
    throw 'No se pudo completar el cambio de host. Se restauró la publicación anterior.'
  }
  throw
}finally{if($taskEnabled){Enable-ScheduledTask -TaskName StackBI-OfficeController|Out-Null};$package=$null}
