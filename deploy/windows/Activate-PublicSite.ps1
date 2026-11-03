[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$PublicOrigin,[string]$SiteName='StackBI')
$ErrorActionPreference='Stop'
Import-Module WebAdministration
$origin=[Uri]$PublicOrigin
if($origin.Scheme -ne 'https' -or -not $origin.IsDefaultPort -or $origin.AbsolutePath -ne '/' -or $origin.Query -or $origin.Fragment -or $origin.UserInfo){throw 'Se requiere un origen HTTPS sin ruta ni credenciales'}
$PublicOrigin=$origin.GetLeftPart([UriPartial]::Authority)
$domain=$origin.DnsSafeHost
if($domain -notmatch '^[a-z0-9.-]+$'){throw 'Dominio no permitido'}
$site=Get-Website -Name $SiteName
if(-not $site -or -not (@($site.Bindings.Collection.bindingInformation) -contains ('*:80:'+$domain))){throw 'El sitio no tiene el binding del dominio solicitado'}
$appRoot='C:\ProgramData\StackBI\Applications\agentes-ia-3d'
$manifest=Join-Path $appRoot 'deployment.json'
$deployment=Get-Content -LiteralPath $manifest -Raw|ConvertFrom-Json
if($deployment.service -ne 'node-agentes-ia-3d'){throw 'Servicio inesperado'}
$secret='C:\ProgramData\StackBI\Secrets\agentes-ia-3d\environment.p7m'
$secretBackup=$secret+'.public-before'
$manifestBackup=$manifest+'.public-before'
$oldPhysicalPath=[string]$site.PhysicalPath
$preview=Get-Website -Name 'StackBI-Agentes-SQL-Preview'
$previewWasStarted=$preview -and $preview.State -eq 'Started'
$publicPath='C:\inetpub\stackbi-agentes-public'
if(Test-Path -LiteralPath $publicPath){throw 'El directorio publico ya existe; revisar antes de volver a activar'}
$beforeHealth=Invoke-RestMethod -Uri 'http://127.0.0.1:10011/health/db' -TimeoutSec 10
if(-not $beforeHealth.ok -or -not $beforeHealth.permissionsRestricted){throw 'La base no cumple los requisitos'}
$backupName='StackBI-Public-'+(Get-Date -Format 'yyyyMMdd-HHmmss')
& "$env:windir\system32\inetsrv\appcmd.exe" add backup $backupName | Out-Null
if($LASTEXITCODE -ne 0){throw 'No se pudo respaldar IIS'}
Copy-Item -LiteralPath $secret -Destination $secretBackup
Copy-Item -LiteralPath $manifest -Destination $manifestBackup
$package=Unprotect-CmsMessage -Path $secret|ConvertFrom-Json
if($package.format -ne 'environment-v1'){throw 'Paquete CMS inesperado'}
$package.variables.PUBLIC_ORIGIN=$PublicOrigin
$package.variables.ALLOW_LOCAL_HTTP='false'
$certificate=Get-Item ('Cert:\LocalMachine\My\'+$deployment.cmsThumbprint)
$escapedHost=[Security.SecurityElement]::Escape($PublicOrigin)
$domainPattern=[regex]::Escape($domain)
$config=@"
<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <system.webServer>
    <directoryBrowse enabled="false" />
    <httpErrors errorMode="DetailedLocalOnly" />
    <security><requestFiltering removeServerHeader="true"><requestLimits maxAllowedContentLength="2097152" /></requestFiltering></security>
    <httpProtocol><customHeaders><remove name="X-Powered-By" /><add name="Cache-Control" value="no-store" /></customHeaders></httpProtocol>
    <rewrite><rules>
      <rule name="Canonical HTTPS origin" stopProcessing="true">
        <match url="(.*)" />
        <conditions logicalGrouping="MatchAny">
          <add input="{HTTP_HOST}" pattern="^www\.$domainPattern$" />
          <add input="{HTTP_X_FORWARDED_PROTO}" pattern="^https$" negate="true" />
        </conditions>
        <action type="Redirect" url="$escapedHost/{R:1}" appendQueryString="true" redirectType="Permanent" />
      </rule>
      <rule name="Agentes IA 3D public proxy" stopProcessing="true">
        <match url="(.*)" /><action type="Rewrite" url="http://127.0.0.1:10011/{R:1}" appendQueryString="true" />
      </rule>
    </rules></rewrite>
  </system.webServer>
</configuration>
"@
New-Item -ItemType Directory -Path $publicPath|Out-Null
[IO.File]::WriteAllText((Join-Path $publicPath 'web.config'),$config,(New-Object Text.UTF8Encoding($false)))
try {
  Stop-Service -Name $deployment.service
  Protect-CmsMessage -To $certificate -Content ($package|ConvertTo-Json -Depth 5 -Compress) -OutFile $secret
  Start-Service -Name $deployment.service
  $ready=$false
  for($attempt=0;$attempt -lt 20;$attempt++){
    try{$health=Invoke-RestMethod -Uri 'http://127.0.0.1:10011/health/db' -TimeoutSec 2;if($health.ok -and $health.permissionsRestricted){$ready=$true;break}}catch{}
    Start-Sleep -Seconds 1
  }
  if(-not $ready){throw 'La API no inicio correctamente'}
  Set-ItemProperty -Path ('IIS:\Sites\'+$SiteName) -Name physicalPath -Value $publicPath
  $publicHealth=Invoke-RestMethod -Uri ($PublicOrigin+'/health/db') -TimeoutSec 30
  if(-not $publicHealth.ok -or -not $publicHealth.certificateValidated -or -not $publicHealth.permissionsRestricted){throw 'La comprobacion publica fallo'}
  $page=Invoke-WebRequest -Uri $PublicOrigin -UseBasicParsing -TimeoutSec 30
  if($page.StatusCode -ne 200 -or $page.Content -notmatch '<div id="root"'){throw 'La pagina publica no contiene la aplicacion'}
  if($previewWasStarted){Stop-Website -Name 'StackBI-Agentes-SQL-Preview'}
  $deployment.origin=$PublicOrigin
  $deployment|ConvertTo-Json -Depth 5|Set-Content -LiteralPath $manifest -Encoding UTF8
  @{format='stackbi-public-activation-v1';origin=$PublicOrigin;site=$SiteName;physicalPath=$publicPath;previousPhysicalPath=$oldPhysicalPath;iisBackup=$backupName;cmsBackup=$secretBackup;deploymentBackup=$manifestBackup;previewPreviouslyStarted=[bool]$previewWasStarted;verified=$true;activatedAt=(Get-Date).ToUniversalTime().ToString('o')}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $appRoot 'public-activation.json') -Encoding UTF8
  [pscustomobject]@{Origin=$PublicOrigin;PublicHealthVerified=$true;SecureCookies=$true;PreviewStopped=[bool]$previewWasStarted;IisBackup=$backupName}|ConvertTo-Json
}catch{
  Set-ItemProperty -Path ('IIS:\Sites\'+$SiteName) -Name physicalPath -Value $oldPhysicalPath
  Stop-Service -Name $deployment.service -ErrorAction SilentlyContinue
  Copy-Item -LiteralPath $secretBackup -Destination $secret -Force
  Copy-Item -LiteralPath $manifestBackup -Destination $manifest -Force
  Start-Service -Name $deployment.service
  if($previewWasStarted){Start-Website -Name 'StackBI-Agentes-SQL-Preview'}
  throw 'No se pudo verificar la activacion publica; se restauro el sitio y el entorno anteriores.'
}finally{$package=$null}
