[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$root='C:\ProgramData\StackBI\AgentMotor'
$backups=Join-Path $root 'backups'
New-Item -ItemType Directory -Path $backups -Force|Out-Null
$snapshot=Join-Path $backups ('pending-'+[guid]::NewGuid().ToString('N'))
$archive=Join-Path $backups ('memory-'+(Get-Date -Format yyyyMMdd)+'.zip')
if(Test-Path -LiteralPath $archive){@{skipped=$true;reason='Already backed up today'}|ConvertTo-Json -Compress;exit 0}
New-Item -ItemType Directory -Path $snapshot|Out-Null
try{
  $memory=Join-Path $root 'data\memories'
  if((Get-Item -LiteralPath $memory).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'La carpeta de memoria es un enlace'}
  $sources=@(Get-ChildItem -LiteralPath $memory -File|Where-Object Name -match '^[a-f0-9]{64}\.md$')
  if(($sources|Measure-Object Length -Sum).Sum -gt 16MB -or $sources.Count -gt 1000){throw 'La memoria excede su presupuesto'}
  foreach($file in Get-ChildItem -LiteralPath $memory -File){
    if($file.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Enlace en memoria'}
    if($file.Name -match '^[a-f0-9]{64}\.md$'){Copy-Item -LiteralPath $file.FullName -Destination $snapshot}
  }
  Copy-Item -LiteralPath (Join-Path $root 'policy.json') -Destination $snapshot
  $budget=Join-Path $root 'data\daily-budget.json'
  if(Test-Path -LiteralPath $budget){Copy-Item -LiteralPath $budget -Destination $snapshot}
  [IO.Compression.ZipFile]::CreateFromDirectory($snapshot,$archive,[IO.Compression.CompressionLevel]::Optimal,$false)
  $zip=[IO.Compression.ZipFile]::OpenRead($archive)
  try{foreach($entry in $zip.Entries){$stream=$entry.Open();try{$sink=New-Object IO.MemoryStream;$stream.CopyTo($sink);$sink.Dispose()}finally{$stream.Dispose()}}}finally{$zip.Dispose()}
  $inventory=@(Get-ChildItem -LiteralPath $backups -File|Where-Object Name -match '^memory-\d{8}\.zip$'|Sort-Object Name -Descending)
  foreach($file in $inventory|Select-Object -Skip 7){
    if([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($file.FullName)) -ne $backups){throw 'Retención fuera de la carpeta autorizada'}
    Remove-Item -LiteralPath $file.FullName
  }
  $bytes=(Get-ChildItem -LiteralPath $backups -File -Filter 'memory-*.zip'|Measure-Object Length -Sum).Sum
  if($bytes -gt 128MB){throw 'Presupuesto de respaldos de memoria excedido'}
  @{ok=$true;archive=(Split-Path $archive -Leaf);sha256=(Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant();retention=7;bytes=$bytes;externalCopy=$false}|ConvertTo-Json -Compress
}finally{
  if([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($snapshot)) -ne $backups -or (Split-Path $snapshot -Leaf) -notmatch '^pending-[a-f0-9]{32}$'){throw 'Ruta temporal de respaldo inválida'}
  Remove-Item -LiteralPath $snapshot -Recurse -Force
}
