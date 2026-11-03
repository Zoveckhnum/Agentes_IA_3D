[CmdletBinding()]
param([string]$Instance='STACKBI', [string]$Database='AgentesIA3D', [string]$SqlHost='sql.stackbi.com.mx', [int]$Port=1433)
$ErrorActionPreference='Stop'
if ($Instance -notmatch '^[A-Z][A-Z0-9_]{0,15}$' -or $Database -notmatch '^[A-Za-z][A-Za-z0-9_]{0,63}$' -or $SqlHost -notmatch '^[a-zA-Z0-9.-]+$') { throw 'Identificador invalido' }
$root='C:\ProgramData\StackBI'
$data=Join-Path $root 'Databases'
$pki=Join-Path $root 'PKI'
New-Item -ItemType Directory -Path $data,$pki -Force | Out-Null
$sqlIdentity='NT SERVICE\MSSQL$'+$Instance
icacls $data /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)(F)' '*S-1-5-32-544:(OI)(CI)(F)' ($sqlIdentity+':(OI)(CI)(M)') | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Fallo ACL del directorio SQL' }
$connection=New-Object System.Data.SqlClient.SqlConnection ('Server=lpc:.\'+$Instance+';Database=master;Integrated Security=True;Encrypt=False;Connect Timeout=15')
$connection.Open()
try {
  $command=$connection.CreateCommand()
  $command.CommandText="SELECT COUNT(*) FROM sys.databases WHERE name=@name"
  [void]$command.Parameters.AddWithValue('@name',$Database)
  $exists=[int]$command.ExecuteScalar()
  if (-not $exists) {
    $command=$connection.CreateCommand()
    $command.CommandText="CREATE DATABASE [$Database] ON PRIMARY (NAME=N'$Database',FILENAME=N'$data\$Database.mdf',SIZE=64MB,MAXSIZE=8192MB,FILEGROWTH=64MB) LOG ON (NAME=N'$($Database)_log',FILENAME=N'$data\$($Database)_log.ldf',SIZE=16MB,MAXSIZE=1024MB,FILEGROWTH=64MB); ALTER DATABASE [$Database] SET RECOVERY SIMPLE; ALTER DATABASE [$Database] SET AUTO_CLOSE OFF; ALTER DATABASE [$Database] SET AUTO_SHRINK OFF;"
    $command.CommandTimeout=120
    [void]$command.ExecuteNonQuery()
  }
  $command=$connection.CreateCommand()
  $command.CommandText="EXEC sp_configure 'show advanced options',1; RECONFIGURE; EXEC sp_configure 'max server memory (MB)',1024; RECONFIGURE;"
  [void]$command.ExecuteNonQuery()
} finally { $connection.Close() }
$ca=Get-ChildItem Cert:\LocalMachine\My | Where-Object {$_.Subject -eq 'CN=StackBI Local SQL CA' -and $_.NotAfter -gt (Get-Date).AddDays(400)} | Select-Object -First 1
if (-not $ca) {
  $ca=New-SelfSignedCertificate -Subject 'CN=StackBI Local SQL CA' -CertStoreLocation Cert:\LocalMachine\My -KeyAlgorithm RSA -KeyLength 3072 -HashAlgorithm SHA256 -KeyExportPolicy NonExportable -KeyUsage CertSign,CRLSign,DigitalSignature -TextExtension @('2.5.29.19={critical}{text}ca=1&pathlength=0') -NotAfter (Get-Date).AddYears(5)
}
$publicCa=Join-Path $pki 'sql-local-ca.cer'
Export-Certificate -Cert $ca -FilePath $publicCa -Force | Out-Null
Import-Certificate -FilePath $publicCa -CertStoreLocation Cert:\LocalMachine\Root | Out-Null
$leaf=Get-ChildItem Cert:\LocalMachine\My | Where-Object {$_.Subject -eq ('CN='+$SqlHost) -and $_.Issuer -eq $ca.Subject -and $_.NotAfter -gt (Get-Date).AddDays(60)} | Select-Object -First 1
if (-not $leaf) {
  $leaf=New-SelfSignedCertificate -Subject ('CN='+$SqlHost) -DnsName @($SqlHost,$env:COMPUTERNAME) -Signer $ca -CertStoreLocation Cert:\LocalMachine\My -KeyAlgorithm RSA -KeyLength 2048 -HashAlgorithm SHA256 -KeySpec KeyExchange -Provider 'Microsoft RSA SChannel Cryptographic Provider' -KeyExportPolicy NonExportable -KeyUsage DigitalSignature,KeyEncipherment -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.1') -NotAfter (Get-Date).AddDays(365)
}
$keyName=$leaf.PrivateKey.CspKeyContainerInfo.UniqueKeyContainerName
$keyPath=Join-Path 'C:\ProgramData\Microsoft\Crypto\RSA\MachineKeys' $keyName
icacls $keyPath /grant ($sqlIdentity+':(R)') | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'SQL no puede leer su clave privada TLS' }
$instanceNames=Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server\Instance Names\SQL'
$instanceId=$instanceNames.$Instance
if (-not $instanceId) { throw 'No existe la instancia SQL esperada' }
$network='HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server\'+$instanceId+'\MSSQLServer\SuperSocketNetLib'
Set-ItemProperty -LiteralPath $network -Name Certificate -Value $leaf.Thumbprint.ToLowerInvariant()
Set-ItemProperty -LiteralPath $network -Name ForceEncryption -Value 1
$tcp=Join-Path $network 'Tcp'
Set-ItemProperty -LiteralPath $tcp -Name Enabled -Value 1
Set-ItemProperty -LiteralPath $tcp -Name ListenOnAllIPs -Value 0
$loopbackCount=0
foreach ($ip in Get-ChildItem -LiteralPath $tcp | Where-Object PSChildName -ne 'IPAll') {
  $properties=Get-ItemProperty -LiteralPath $ip.PSPath
  $isLoopback=$properties.IPAddress -in @('127.0.0.1','::1')
  Set-ItemProperty -LiteralPath $ip.PSPath -Name Enabled -Value ([int]$isLoopback)
  Set-ItemProperty -LiteralPath $ip.PSPath -Name TcpDynamicPorts -Value ''
  Set-ItemProperty -LiteralPath $ip.PSPath -Name TcpPort -Value $(if($isLoopback){[string]$Port}else{''})
  if ($isLoopback) { $loopbackCount++ }
}
if (-not $loopbackCount) { throw 'No se encontro la interfaz loopback SQL' }
$hosts='C:\Windows\System32\drivers\etc\hosts'
$lines=Get-Content -LiteralPath $hosts
$matching=$lines | Where-Object {$_ -notmatch '^\s*#' -and $_ -match ('\s'+[regex]::Escape($SqlHost)+'(?:\s|$)')}
if ($matching -and ($matching | Where-Object {$_ -notmatch '^\s*127\.0\.0\.1\s'})) { throw 'El nombre SQL tiene una asignacion hosts conflictiva' }
if (-not $matching) { Add-Content -LiteralPath $hosts -Value ("`r`n127.0.0.1`t"+$SqlHost+' # StackBI SQL local') -Encoding ascii }
$ntlm='HKLM:\SYSTEM\CurrentControlSet\Control\Lsa\MSV1_0'
$aliases=(Get-ItemProperty -LiteralPath $ntlm -Name BackConnectionHostNames -ErrorAction SilentlyContinue).BackConnectionHostNames
New-ItemProperty -LiteralPath $ntlm -Name BackConnectionHostNames -PropertyType MultiString -Value @((@($aliases | Where-Object {$_})+@($SqlHost)) | Select-Object -Unique) -Force | Out-Null
Restart-Service -Name ('MSSQL$'+$Instance)
Clear-DnsClientCache
[pscustomobject]@{Instance=$Instance;Database=$Database;SqlHost=$SqlHost;Port=$Port;CertificateThumbprint=$leaf.Thumbprint;CertificateExpires=$leaf.NotAfter;LocalOnly=$true} | ConvertTo-Json
