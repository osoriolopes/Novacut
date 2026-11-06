param([switch]$Silent, [switch]$RemoveData)
# Desinstalador do NovaCut. Os projetos e a biblioteca (pasta dados-app) só são apagados com confirmação clara;
# antes disso o desinstalador oferece uma cópia de segurança em Documentos. Sem janela (-Silent), os dados ficam.
Add-Type -AssemblyName System.Windows.Forms
$dir = Join-Path $env:LOCALAPPDATA 'Programs\NovaCut'
$title = 'Desinstalar NovaCut'
$data = @('dados-app', 'dados', 'perfil') | ForEach-Object { Join-Path $dir $_ } | Where-Object { Test-Path -LiteralPath $_ }
$wipe = [bool]$RemoveData

if (-not $Silent) {
  $r = [System.Windows.Forms.MessageBox]::Show("Remover o NovaCut deste PC?`n`nVídeos exportados e projetos salvos em arquivo (.ncproj, .json) não são afetados.", $title, 'YesNo', 'Question')
  if ($r -ne 'Yes') { exit 1 }
  if ($data) {
    $mb = [math]::Round((($data | ForEach-Object { Get-ChildItem -LiteralPath $_ -Recurse -File -Force -ErrorAction SilentlyContinue } | Measure-Object Length -Sum).Sum) / 1MB)
    $r = [System.Windows.Forms.MessageBox]::Show("O NovaCut guarda seus projetos e a biblioteca de mídias ($mb MB).`n`nSim: apagar tudo junto com o programa (oferece uma cópia de segurança antes).`nNão: manter os projetos neste PC (voltam ao reinstalar).", $title, 'YesNoCancel', 'Warning')
    if ($r -eq 'Cancel') { exit 1 }
    $wipe = $r -eq 'Yes'
    if ($wipe) {
      $b = [System.Windows.Forms.MessageBox]::Show("Fazer uma cópia de segurança dos projetos e da biblioteca em Documentos antes de apagar?", $title, 'YesNoCancel', 'Question')
      if ($b -eq 'Cancel') { exit 1 }
      if ($b -eq 'Yes') {
        $dest = Join-Path ([Environment]::GetFolderPath('MyDocuments')) ('NovaCut - cópia de segurança ' + (Get-Date -Format 'yyyy-MM-dd HHmm'))
        try {
          Get-Process -Name NovaCut -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($dir, [StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { try { $_.Kill() } catch {} }
          Start-Sleep -Milliseconds 1500
          New-Item -ItemType Directory -Force -Path $dest | Out-Null
          foreach ($d in $data) { Copy-Item -LiteralPath $d -Destination $dest -Recurse -Force -ErrorAction Stop }
          [IO.File]::WriteAllText((Join-Path $dest 'LEIA-ME.txt'), "Cópia dos projetos e da biblioteca do NovaCut.`r`nPara voltar: instale o NovaCut, feche-o e copie a pasta dados-app para $dir (substituindo).", (New-Object Text.UTF8Encoding $true))
        } catch {
          [System.Windows.Forms.MessageBox]::Show("Não foi possível fazer a cópia de segurança ($($_.Exception.Message)).`nNada foi apagado.", $title, 'OK', 'Error') | Out-Null
          exit 1
        }
      }
    }
  }
}

# fecha o app (todos os processos NovaCut.exe desta pasta; e restos das versões antigas)
Get-Process -Name NovaCut -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($dir, [StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { try { $_.Kill() } catch {} }
foreach ($marker in (Join-Path $dir 'perfil'), (Join-Path $dir 'dados')) {
  Get-CimInstance Win32_Process -Filter "Name='msedge.exe' OR Name='msedgewebview2.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine.Contains($marker) } | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch {} }
}
Start-Sleep -Milliseconds 1500

$startDir = Join-Path ([Environment]::GetFolderPath('Programs')) 'NovaCut'
foreach ($p in @((Join-Path ([Environment]::GetFolderPath('Desktop')) 'NovaCut.lnk'), $startDir, (Join-Path $env:LOCALAPPDATA 'Programs\NovaCut-anterior'), (Join-Path $env:LOCALAPPDATA 'Programs\NovaCut-novo'))) {
  if (Test-Path -LiteralPath $p) { Remove-Item -LiteralPath $p -Recurse -Force -ErrorAction SilentlyContinue }
}
Remove-Item -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\NovaCut' -Recurse -Force -ErrorAction SilentlyContinue
Remove-ItemProperty -Path 'HKCU:\Software\Microsoft\DirectX\UserGpuPreferences' -Name (Join-Path $dir 'NovaCut.exe') -ErrorAction SilentlyContinue
if (Test-Path -LiteralPath $dir) {
  if ($wipe) { Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue }
  else { Get-ChildItem -LiteralPath $dir -Force | Where-Object { @('dados-app', 'dados', 'perfil') -notcontains $_.Name } | ForEach-Object { Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction SilentlyContinue } }
}

if (-not $Silent) { [System.Windows.Forms.MessageBox]::Show($(if ($wipe) { 'NovaCut foi removido.' } else { "NovaCut foi removido.`nSeus projetos continuam em $dir\dados-app e voltam se você instalar o NovaCut de novo." }), $title, 'OK', 'Information') | Out-Null }
exit 0
