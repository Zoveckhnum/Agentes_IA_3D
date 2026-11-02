# Java 21 portable solo para este proyecto (Windows x64).
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$javaDir = Join-Path $projectRoot '.local/java'
New-Item -ItemType Directory -Force -Path $javaDir | Out-Null
$release = Invoke-RestMethod 'https://api.adoptium.net/v3/assets/latest/21/hotspot?architecture=x64&image_type=jre&os=windows&vendor=eclipse'
$package = $release[0].binary.package
$archivePath = Join-Path $projectRoot '.local/java.zip'
Invoke-WebRequest -Uri $package.link -OutFile $archivePath
if ((Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $package.checksum) {
    throw 'La descarga de Java no coincide con su checksum SHA-256.'
}
Expand-Archive -LiteralPath $archivePath -DestinationPath $javaDir -Force
Write-Output 'Java 21 portable listo. Ejecuta npm run local.'
