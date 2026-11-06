# Gera NovaCut-Setup-<versão>.exe: o NovaCut com motor próprio (Chromium via Electron, oficial e conferido por SHA-256)
# A versão vem de um lugar só: electron\app\package.json. O script confere se a página e o instalador dizem a mesma coisa.
param([string]$Version = '')
$ErrorActionPreference = 'Stop'
$root   = $PSScriptRoot
$src    = Join-Path $root 'src'
$el     = Join-Path $root 'electron'
$pkgVer = (Get-Content (Join-Path $el 'app\package.json') -Raw | ConvertFrom-Json).version
if (-not $Version) { $Version = $pkgVer }
if ($Version -ne $pkgVer) { throw "Versão $Version diferente da do package.json ($pkgVer)" }
if (-not (Select-String -LiteralPath (Join-Path $src 'NovaCut.html') -Pattern "const APP_VERSION = '$Version'" -SimpleMatch -Quiet)) { throw "NovaCut.html não está marcado como $Version (const APP_VERSION)" }
$vendor = Join-Path $el 'vendor'
$stage  = (Join-Path $env:USERPROFILE 'ncbuild')          # caminho curto: o IExpress falha com caminhos longos
$appOut = Join-Path $stage 'NovaCut'
$out    = Join-Path (Split-Path $root -Parent) "NovaCut-Setup-$Version.exe"
$zipEl  = Join-Path $vendor 'electron-v45.2.1-win32-x64.zip'

# 1) motor: confere o pacote oficial do Electron
$want = (Select-String (Join-Path $vendor 'SHASUMS256.txt') -Pattern 'electron-v45.2.1-win32-x64.zip$').Line.Split(' ')[0]
if ((Get-FileHash $zipEl -Algorithm SHA256).Hash.ToLower() -ne $want) { throw 'O pacote do Electron não confere com o SHA-256 oficial' }
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Force $appOut | Out-Null
Expand-Archive $zipEl -DestinationPath $appOut -Force
Rename-Item (Join-Path $appOut 'electron.exe') 'NovaCut.exe'
Remove-Item (Join-Path $appOut 'resources\default_app.asar') -ErrorAction SilentlyContinue
Get-ChildItem (Join-Path $appOut 'locales') | Where-Object { $_.Name -notin 'pt-BR.pak', 'en-US.pak' } | Remove-Item

# 2) o NovaCut em si: casca (main/preload), a página e os módulos de exportação
$app = Join-Path $appOut 'resources\app'
New-Item -ItemType Directory -Force (Join-Path $app 'libs') | Out-Null
foreach ($f in 'package.json', 'main.js', 'preload.js', 'novacut.ico') { Copy-Item (Join-Path $el "app\$f") $app }
Copy-Item (Join-Path $src 'NovaCut.html') $app
Copy-Item (Join-Path $src 'libs\*.js') (Join-Path $app 'libs')

# 3) nome, ícone e versão do NovaCut.exe (é o que aparece no Gerenciador de Tarefas)
& (Join-Path $vendor 'rcedit-x64.exe') (Join-Path $appOut 'NovaCut.exe') --set-icon (Join-Path $src 'novacut.ico') `
  --set-version-string FileDescription 'NovaCut' --set-version-string ProductName 'NovaCut' --set-version-string CompanyName 'NovaCut' `
  --set-version-string InternalName 'NovaCut' --set-version-string OriginalFilename 'NovaCut.exe' --set-version-string LegalCopyright 'NovaCut' `
  --set-file-version "$Version.0" --set-product-version $Version
if ($LASTEXITCODE) { throw 'rcedit falhou' }

# 4) instalador (IExpress, já vem com o Windows): leva o programa compactado e os scripts de instalação
$pkg = Join-Path $stage 'src'; New-Item -ItemType Directory -Force $pkg | Out-Null
foreach ($f in 'install.cmd', 'install.ps1', 'uninstall.ps1') { Copy-Item (Join-Path $src $f) $pkg }
foreach ($f in 'install.ps1', 'uninstall.ps1') { $p = Join-Path $pkg $f; $txt = [IO.File]::ReadAllText($p) -replace "(?m)^\`$ver\s*=\s*'[^']*'", "`$ver   = '$Version'"; [IO.File]::WriteAllText($p, $txt, (New-Object Text.UTF8Encoding $true)) }
Copy-Item (Join-Path $pkg 'uninstall.ps1') $appOut   # o desinstalador fica junto do programa
Compress-Archive -Path (Join-Path $appOut '*') -DestinationPath (Join-Path $pkg 'app.zip') -CompressionLevel Optimal
$all = @('install.cmd', 'install.ps1', 'uninstall.ps1', 'app.zip')
$lines = @(
  '[Version]', 'Class=IEXPRESS', 'SEDVersion=3', '[Options]', 'PackagePurpose=InstallApp', 'ShowInstallProgramWindow=1', 'HideExtractAnimation=0',
  'UseLongFileName=1', 'InsideCompressed=0', 'CAB_FixedSize=0', 'CAB_ResvCodeSigning=0', 'RebootMode=N',
  'InstallPrompt=%InstallPrompt%', 'DisplayLicense=%DisplayLicense%', 'FinishMessage=%FinishMessage%', 'TargetName=%TargetName%',
  'FriendlyName=%FriendlyName%', 'AppLaunched=%AppLaunched%', 'PostInstallCmd=%PostInstallCmd%', 'AdminQuietInstCmd=%AdminQuietInstCmd%',
  'UserQuietInstCmd=%UserQuietInstCmd%', 'SourceFiles=SourceFiles', '[Strings]', 'InstallPrompt=', 'DisplayLicense=', 'FinishMessage=',
  "TargetName=$stage\NovaCut-Setup.exe", 'FriendlyName=Instalador NovaCut', 'AppLaunched=cmd /c install.cmd', 'PostInstallCmd=<None>',
  'AdminQuietInstCmd=', 'UserQuietInstCmd=')
for ($i = 0; $i -lt $all.Count; $i++) { $lines += "FILE$i=`"$($all[$i])`"" }
$lines += '[SourceFiles]', "SourceFiles0=$pkg\", '[SourceFiles0]'
for ($i = 0; $i -lt $all.Count; $i++) { $lines += "%FILE$i%=" }
[IO.File]::WriteAllText((Join-Path $root 'NovaCut.sed'), (($lines -join "`r`n") + "`r`n"), [Text.Encoding]::ASCII)
Copy-Item (Join-Path $root 'NovaCut.sed') "$stage\NovaCut.sed"
$p = Start-Process "$env:WINDIR\System32\iexpress.exe" -ArgumentList '/N', '/Q', "$stage\NovaCut.sed" -Wait -PassThru -WindowStyle Hidden
if (-not (Test-Path "$stage\NovaCut-Setup.exe")) { throw "IExpress falhou (código $($p.ExitCode))" }
Copy-Item "$stage\NovaCut-Setup.exe" $out -Force
Get-Item $out
