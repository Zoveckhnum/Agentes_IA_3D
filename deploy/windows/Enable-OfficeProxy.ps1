[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$root='C:\ProgramData\StackBI\OfficeControl'
$path='C:\inetpub\stackbi-agentes-public\web.config'
$health=Invoke-RestMethod http://127.0.0.1:10014/_office/health -TimeoutSec 10
if(-not $health.ok -or -not $health.permissionsRestricted -or $health.mode -ne 'open'){throw 'El control no está listo para activar el proxy'}
$before=[IO.File]::ReadAllText($path);$config=[xml]$before
$actions=$config.SelectNodes('/configuration/system.webServer/rewrite/rules/rule[match/@url="(.*)"]/action[@type="Rewrite"]')
if($actions.Count -ne 1){throw 'Se requiere una única regla de proxy público'}
$action=$actions[0]
if(-not $action -or $action.url -notin @('http://127.0.0.1:10011/{R:1}','http://127.0.0.1:10014/{R:1}')){throw 'Destino IIS inesperado'}
$backup=Join-Path $root 'private\public-web.config.before-office'
if(-not(Test-Path -LiteralPath $backup)){Copy-Item -LiteralPath $path -Destination $backup}
try{
 $action.ParentNode.SetAttribute('name','Stackbi Office public proxy')
 $action.SetAttribute('url','http://127.0.0.1:10014/{R:1}')
 $config.SelectSingleNode('/configuration/system.webServer/httpErrors').SetAttribute('existingResponse','PassThrough')
 $config.Save($path)
 $status=Invoke-RestMethod https://stackbi.com.mx/_office/status -TimeoutSec 20
 $db=Invoke-RestMethod https://stackbi.com.mx/health/db -TimeoutSec 20
 if($status.mode -ne 'open' -or -not $db.ok -or -not $db.certificateValidated -or -not $db.permissionsRestricted){throw 'Falla la comprobación HTTPS'}
 @{ok=$true;publicGatewayPort=10014;maintenanceBodyPreserved=$true;httpsVerified=$true;databaseVerified=$true}|ConvertTo-Json -Compress
}catch{
 [IO.File]::WriteAllText($path,$before,(New-Object Text.UTF8Encoding($false)))
 throw 'No se activó el control público; se restauró el proxy anterior'
}
