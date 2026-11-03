[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$root='C:\ProgramData\StackBI\Installers'
New-Item -ItemType Directory -Path $root -Force | Out-Null
$packages=@(
  @{Name='rewrite_amd64_en-US.msi';Url='https://download.microsoft.com/download/1/2/8/128E2E22-C1B9-44A4-BE2A-5859ED1D4592/rewrite_amd64_en-US.msi';Module='RewriteModule'},
  @{Name='requestRouter_amd64.msi';Url='https://download.microsoft.com/download/E/9/8/E9849D6A-020E-47E4-9FD0-A023E99B54EB/requestRouter_amd64.msi';Module='ApplicationRequestRouting'}
)
Import-Module WebAdministration
foreach($package in $packages) {
  if(Get-WebGlobalModule -Name $package.Module -ErrorAction SilentlyContinue){continue}
  $file=Join-Path $root $package.Name
  Invoke-WebRequest -UseBasicParsing -Uri $package.Url -OutFile $file -TimeoutSec 90
  $signature=Get-AuthenticodeSignature -LiteralPath $file
  if($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'Microsoft Corporation'){throw 'Firma de módulo IIS no válida'}
  $log=$file+'.install.log'
  $p=Start-Process -FilePath msiexec.exe -ArgumentList ('/i "'+$file+'" /qn /norestart /L*v "'+$log+'"') -WindowStyle Hidden -Wait -PassThru
  if($p.ExitCode -notin @(0,3010)){throw ('No se pudo instalar '+$package.Name)}
  [pscustomobject]@{Installed=$package.Name;ExitCode=$p.ExitCode}|ConvertTo-Json
}
