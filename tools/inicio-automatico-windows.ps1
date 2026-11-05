# Crea un acceso directo en la carpeta Inicio de Windows para que el motor de agentes
# arranque solo al iniciar sesión (minimizado). Para quitarlo, borra el acceso directo
# "Motor de agentes IA 3D" de shell:startup.
$motor = (Resolve-Path (Join-Path $PSScriptRoot '..\motor')).Path
$startup = [Environment]::GetFolderPath('Startup')
$lnkPath = Join-Path $startup 'Motor de agentes IA 3D.lnk'
$shell = New-Object -ComObject WScript.Shell
$lnk = $shell.CreateShortcut($lnkPath)
$lnk.TargetPath = Join-Path $motor 'iniciar-agentes.bat'
$lnk.WorkingDirectory = $motor
$lnk.WindowStyle = 7
$lnk.Description = 'Motor de agentes de Stackbi Office'
$lnk.Save()
Write-Output "Inicio automatico configurado: $lnkPath"
