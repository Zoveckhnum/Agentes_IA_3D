[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$Domain,[Parameter(Mandatory=$true)][string]$OfficeHost)
$ErrorActionPreference='Stop'
if($Domain -notmatch '^[a-z0-9.-]+$' -or $OfficeHost -notmatch '^[a-z0-9.-]+$' -or $Domain -eq $OfficeHost){throw 'Se requieren hosts distintos y válidos'}
Import-Module WebAdministration
$officeSite='StackBI';$publicSite='StackBI-Public';$publicRoot='C:\inetpub\stackbi-public'
if((Test-Path -LiteralPath $publicRoot) -or (Test-Path ('IIS:\Sites\'+$publicSite)) -or (Test-Path ('IIS:\AppPools\'+$publicSite))){throw 'El sitio público ya existe; se conserva para revisión'}
$site=Get-Website -Name $officeSite
$bindings=@($site.Bindings.Collection.bindingInformation)
foreach($hostName in @($Domain,('www.'+$Domain),$OfficeHost)){if($bindings -notcontains ('*:80:'+$hostName)){throw 'Las vinculaciones no coinciden con la publicación revisada'}}
$appRoot='C:\ProgramData\StackBI\Applications\agentes-ia-3d'
$backup=Join-Path $appRoot ('hostname-migrations\reserve-'+(Get-Date -Format 'yyyyMMdd-HHmmssfff'))
New-Item -ItemType Directory -Path $backup -Force|Out-Null
& $env:windir\system32\inetsrv\appcmd.exe add backup ('StackBI-Reserve-'+(Get-Date -Format 'yyyyMMdd-HHmmssfff'))|Out-Null
if($LASTEXITCODE){throw 'No se pudo respaldar IIS'}
New-Item -ItemType Directory -Path $publicRoot|Out-Null
Copy-Item -LiteralPath (Join-Path $PSScriptRoot '..\iis\domain-reserved.html') -Destination (Join-Path $publicRoot 'index.html')
$origin='https://'+$Domain;$wwwPattern='^www\.'+[regex]::Escape($Domain)+'$'
$xml=@"
<?xml version="1.0" encoding="utf-8"?>
<configuration><system.webServer>
 <directoryBrowse enabled="false" />
 <defaultDocument><files><clear /><add value="index.html" /></files></defaultDocument>
 <httpErrors errorMode="DetailedLocalOnly" />
 <security><requestFiltering removeServerHeader="true" /></security>
 <httpProtocol><customHeaders><remove name="X-Powered-By" /><add name="Cache-Control" value="no-store" /><add name="Content-Security-Policy" value="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'" /><add name="Strict-Transport-Security" value="max-age=31536000" /><add name="X-Content-Type-Options" value="nosniff" /></customHeaders></httpProtocol>
 <rewrite><rules><rule name="Public domain HTTPS" stopProcessing="true"><match url="(.*)" /><conditions logicalGrouping="MatchAny"><add input="{HTTP_HOST}" pattern="$wwwPattern" /><add input="{HTTP_X_FORWARDED_PROTO}" pattern="^https$" negate="true" /></conditions><action type="Redirect" url="$origin/{R:1}" appendQueryString="true" redirectType="Permanent" /></rule></rules></rewrite>
</system.webServer></configuration>
"@
[IO.File]::WriteAllText((Join-Path $publicRoot 'web.config'),$xml,(New-Object Text.UTF8Encoding($false)))
$removed=@();$created=$false;$poolCreated=$false
try {
  New-WebAppPool -Name $publicSite|Out-Null;$poolCreated=$true
  Set-ItemProperty -LiteralPath ('IIS:\AppPools\'+$publicSite) -Name managedRuntimeVersion -Value ''
  foreach($hostName in @($Domain,('www.'+$Domain))){Remove-WebBinding -Name $officeSite -Protocol http -Port 80 -IPAddress '*' -HostHeader $hostName;$removed+=$hostName}
  New-Website -Name $publicSite -PhysicalPath $publicRoot -ApplicationPool $publicSite -Port 80 -IPAddress '*' -HostHeader $Domain|Out-Null;$created=$true
  New-WebBinding -Name $publicSite -Protocol http -Port 80 -IPAddress '*' -HostHeader ('www.'+$Domain)
  $root=Invoke-WebRequest $origin -UseBasicParsing -TimeoutSec 20
  if($root.StatusCode -ne 200 -or $root.Content -notmatch 'noindex,nofollow' -or $root.Content -match '<div id="root"'){throw 'El dominio principal no muestra la reserva estática'}
  $office=Invoke-RestMethod ('https://'+$OfficeHost+'/health/db') -TimeoutSec 20
  if(-not $office.ok -or -not $office.permissionsRestricted){throw 'La oficina no supera la verificación de salud'}
  $result=@{reserved=$true;domain=$Domain;site=$publicSite;root=$publicRoot;officeOrigin=('https://'+$OfficeHost);officeUnchanged=$true;officeRedirectRemoved=$true;verifiedAt=[DateTime]::UtcNow.ToString('o')}
  $result|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $backup 'result.json') -Encoding UTF8
  $result|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $appRoot 'public-domain.json') -Encoding UTF8
  $result|ConvertTo-Json -Compress
}catch{
  if($created){Remove-Website -Name $publicSite}
  foreach($hostName in $removed){New-WebBinding -Name $officeSite -Protocol http -Port 80 -IPAddress '*' -HostHeader $hostName}
  if($poolCreated){Remove-WebAppPool -Name $publicSite}
  throw 'No se pudo reservar el dominio; se restauraron las vinculaciones de la oficina. Los archivos preparados se conservaron.'
}
