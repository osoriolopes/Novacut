param([switch]$Silent)
# Instalador do NovaCut 2 (por usuário, não precisa de administrador). O programa leva o próprio motor.
# Atualização segura: a versão nova é extraída numa pasta à parte e testada (abre escondida, com dados vazios) antes de
# substituir a atual. A versão anterior fica guardada em "NovaCut-anterior" até a nova abrir normalmente; se algo falhar
# no meio da troca, ela volta sozinha. Os projetos (pasta dados-app) nunca são mexidos.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$ver   = '2.2.0'   # o gerador do instalador grava aqui a versão do package.json
$dir   = Join-Path $env:LOCALAPPDATA 'Programs\NovaCut'
$new   = Join-Path $env:LOCALAPPDATA 'Programs\NovaCut-novo'
$bak   = Join-Path $env:LOCALAPPDATA 'Programs\NovaCut-anterior'
$title = 'Instalador NovaCut'
# itens da pasta do programa que são do usuário: ficam sempre onde estão
$keep  = @('dados-app', 'dados', 'perfil', 'config.txt', 'novacut.log')

function Say($msg, $buttons = 'OK', $icon = 'Information') {
  if ($Silent) { return 'OK' }
  return [System.Windows.Forms.MessageBox]::Show($msg, $title, $buttons, $icon).ToString()
}
function Log($m) { try { Add-Content -LiteralPath (Join-Path $env:TEMP 'novacut-instalador.log') -Value ((Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + ' ' + $m) -Encoding UTF8 } catch {} }

if ((Say "Instalar o NovaCut $ver em:`n$dir`n`nO NovaCut traz o próprio motor e não depende do Edge nem de outro navegador.`nSerão criados atalhos na Área de Trabalho e no Menu Iniciar.`n`nSeus projetos e mídias são mantidos." 'OKCancel') -ne 'OK') { exit 1 }

$swapped = $false
try {
  if (-not [Environment]::Is64BitOperatingSystem) { throw 'O NovaCut precisa do Windows 10 ou 11 de 64 bits.' }
  Log "instalando $ver"

  # 1) a versão nova numa pasta à parte, conferida antes de mexer na atual
  if (Test-Path -LiteralPath $new) { Remove-Item -LiteralPath $new -Recurse -Force }
  Expand-Archive -LiteralPath (Join-Path $PSScriptRoot 'app.zip') -DestinationPath $new -Force
  foreach ($f in 'NovaCut.exe', 'resources\app\NovaCut.html', 'resources\app\main.js', 'resources\app\preload.js', 'resources\app\package.json', 'resources\app\libs\mp4box.all.min.js') {
    if (-not (Test-Path -LiteralPath (Join-Path $new $f))) { throw "O pacote do instalador está incompleto (falta $f). Baixe o instalador de novo." }
  }
  $pv = (Get-Content -LiteralPath (Join-Path $new 'resources\app\package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
  if ($pv -ne $ver) { throw "O pacote diz versão $pv, esperado $ver." }

  # 2) teste: a versão nova abre escondida, com dados vazios próprios, e avisa que iniciou
  $chk = Join-Path $env:TEMP ("novacut-check-" + [guid]::NewGuid().ToString('N') + '.txt')
  $p = Start-Process -FilePath (Join-Path $new 'NovaCut.exe') -ArgumentList "--novacut-check=`"$chk`"" -PassThru -WindowStyle Hidden
  if (-not $p.WaitForExit(90000)) { try { $p.Kill() } catch {}; throw 'A versão nova não terminou o teste de abertura a tempo. Nada foi alterado.' }
  $res = if (Test-Path -LiteralPath $chk) { (Get-Content -LiteralPath $chk -Raw).Trim() } else { 'sem resposta' }
  Remove-Item -LiteralPath $chk -Force -ErrorAction SilentlyContinue
  Log "teste da versão nova: $res"
  if ($res -notlike "ok $ver*") { throw "A versão nova não passou no teste de abertura ($res). A versão instalada continua como estava." }

  # 3) fecha o NovaCut, se estiver aberto (qualquer versão)
  Get-Process -Name NovaCut -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($dir, [StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { try { $_.CloseMainWindow() | Out-Null } catch {} }
  Start-Sleep -Seconds 2
  Get-Process -Name NovaCut -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($dir, [StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { try { $_.Kill() } catch {} }
  foreach ($marker in (Join-Path $dir 'perfil'), (Join-Path $dir 'dados')) {
    Get-CimInstance Win32_Process -Filter "Name='msedge.exe' OR Name='msedgewebview2.exe'" -ErrorAction SilentlyContinue |
      Where-Object { $_.CommandLine -and $_.CommandLine.Contains($marker) } | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch {} }
  }
  Start-Sleep -Milliseconds 800

  # 4) troca: os arquivos do programa atual vão para NovaCut-anterior (os dados ficam), os novos entram no lugar
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  if (Test-Path -LiteralPath $bak) { Remove-Item -LiteralPath $bak -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $bak | Out-Null
  $swapped = $true
  Get-ChildItem -LiteralPath $dir -Force | Where-Object { $keep -notcontains $_.Name } | ForEach-Object { Move-Item -LiteralPath $_.FullName -Destination $bak -Force }
  Get-ChildItem -LiteralPath $new -Force | ForEach-Object { Move-Item -LiteralPath $_.FullName -Destination $dir -Force }
  Remove-Item -LiteralPath $new -Recurse -Force -ErrorAction SilentlyContinue
  if (-not (Test-Path -LiteralPath (Join-Path $dir 'NovaCut.exe'))) { throw 'Os arquivos novos não ficaram no lugar.' }
  $swapped = $false
  if (-not (Get-ChildItem -LiteralPath $bak -Force)) { Remove-Item -LiteralPath $bak -Force }   # era a primeira instalação

  $exe    = Join-Path $dir 'NovaCut.exe'
  $uninst = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$dir\uninstall.ps1`""

  $sh = New-Object -ComObject WScript.Shell
  $startDir = Join-Path ([Environment]::GetFolderPath('Programs')) 'NovaCut'
  New-Item -ItemType Directory -Force -Path $startDir | Out-Null
  foreach ($lnk in @((Join-Path ([Environment]::GetFolderPath('Desktop')) 'NovaCut.lnk'), (Join-Path $startDir 'NovaCut.lnk'))) {
    $s = $sh.CreateShortcut($lnk); $s.TargetPath = $exe; $s.Arguments = ''; $s.IconLocation = "$exe,0"
    $s.WorkingDirectory = $dir; $s.Description = 'NovaCut - editor de vídeo'; $s.Save()
  }
  $s = $sh.CreateShortcut((Join-Path $startDir 'Desinstalar NovaCut.lnk'))
  $s.TargetPath = 'powershell.exe'; $s.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$dir\uninstall.ps1`""
  $s.IconLocation = "$exe,0"; $s.Save()

  # Registro em "Aplicativos instalados"
  $reg = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\NovaCut'
  New-Item -Path $reg -Force | Out-Null
  $size = [int]((Get-ChildItem -LiteralPath $dir -File -Recurse | Where-Object { $_.FullName -notmatch '\\(dados|dados-app|perfil)\\' } | Measure-Object Length -Sum).Sum / 1KB)
  $vals = @{ DisplayName = 'NovaCut'; DisplayVersion = $ver; Publisher = 'NovaCut'; DisplayIcon = "$exe,0"; InstallLocation = $dir; UninstallString = $uninst; QuietUninstallString = "$uninst -Silent" }
  foreach ($k in $vals.Keys) { Set-ItemProperty -Path $reg -Name $k -Value $vals[$k] }
  foreach ($k in 'NoModify', 'NoRepair') { New-ItemProperty -Path $reg -Name $k -Value 1 -PropertyType DWord -Force | Out-Null }
  New-ItemProperty -Path $reg -Name 'EstimatedSize' -Value $size -PropertyType DWord -Force | Out-Null
  Log "instalado $ver"

  if ((Say "NovaCut $ver instalado.`n`nAbrir agora?" 'YesNo') -eq 'Yes') { Start-Process -FilePath $exe -WorkingDirectory $dir }
  exit 0
} catch {
  $msg = $_.Exception.Message
  # a troca parou no meio: a versão anterior volta para o lugar
  if ($swapped -and (Test-Path -LiteralPath $bak)) {
    try {
      Get-ChildItem -LiteralPath $dir -Force | Where-Object { $keep -notcontains $_.Name } | ForEach-Object { Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction SilentlyContinue }
      Get-ChildItem -LiteralPath $bak -Force | ForEach-Object { Move-Item -LiteralPath $_.FullName -Destination $dir -Force }
      Remove-Item -LiteralPath $bak -Recurse -Force -ErrorAction SilentlyContinue
      $msg += "`n`nA versão anterior foi restaurada."
    } catch { $msg += "`n`nA versão anterior está guardada em $bak." }
  }
  if (Test-Path -LiteralPath $new) { Remove-Item -LiteralPath $new -Recurse -Force -ErrorAction SilentlyContinue }
  Log "falhou: $msg"
  Say ("A instalação falhou:`n" + $msg) 'OK' 'Error' | Out-Null
  exit 1
}
