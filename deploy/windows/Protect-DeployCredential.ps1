[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
try{
  $root='C:\ProgramData\StackBI\DeployBroker'
  $policy=Get-Content -LiteralPath (Join-Path $root 'policy.json') -Raw|ConvertFrom-Json
  $package=[Console]::In.ReadToEnd()|ConvertFrom-Json
  if($package.format -ne 'environment-v1' -or @($package.variables.PSObject.Properties).Count -ne 1 -or -not $package.variables.APP_CI_GITHUB_TOKEN){throw 'Invalid credential envelope'}
  $cert=Get-Item ('Cert:\LocalMachine\My\'+$policy.githubCmsThumbprint)
  Protect-CmsMessage -To $cert -Content ($package|ConvertTo-Json -Depth 4 -Compress) -OutFile (Join-Path $root 'secrets\github.p7m')
  Write-Output 'Protected deployment credential installed.'
}finally{$package=$null}
