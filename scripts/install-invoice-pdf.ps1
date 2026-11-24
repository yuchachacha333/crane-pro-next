# 一度だけ実行する。以後は、このパソコンにログインするたびに、窓なしで受付が自動で始まる。
# 管理者権限は要らない。入れる先: %LOCALAPPDATA%\CranePro
$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$target = Join-Path $env:LOCALAPPDATA 'CranePro'
New-Item -ItemType Directory -Path $target -Force | Out-Null

$helper = Join-Path $target 'invoice-pdf-helper.ps1'
Copy-Item -LiteralPath (Join-Path $here 'invoice-pdf-helper.ps1') -Destination $helper -Force
Unblock-File -LiteralPath $helper -ErrorAction SilentlyContinue

$excel = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\excel.exe' -ErrorAction SilentlyContinue
if (-not $excel) {
  Write-Host 'このパソコンには Excel が見つかりません。Excel を入れてから、もう一度実行してください。' -ForegroundColor Yellow
}

$startup = [Environment]::GetFolderPath('Startup')
$link = Join-Path $startup 'クレーンPRO 請求PDF受付.lnk'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($link)
$shortcut.TargetPath = (Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe')
$shortcut.Arguments = "-NoProfile -Sta -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$helper`""
$shortcut.WorkingDirectory = $target
$shortcut.WindowStyle = 7
$shortcut.Save()

# いま動いているものがあれば入れ替え、すぐ使えるようにする
Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" | Where-Object {
  $_.CommandLine -like '*invoice-pdf-helper.ps1*' -and $_.CommandLine -notlike '*-ExcelMode*'
} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Milliseconds 500
Start-Process -FilePath $shortcut.TargetPath -ArgumentList $shortcut.Arguments -WindowStyle Hidden

Start-Sleep -Seconds 2
$tcp = New-Object System.Net.Sockets.TcpClient
try {
  $tcp.Connect('127.0.0.1', 3100)
  Write-Host '設定しました。これで、このパソコンでは請求書をExcelの用紙どおりのPDFにできます。' -ForegroundColor Green
} catch {
  Write-Host '入れましたが、受付が始まりませんでした。Windowsの警告が出ていないか確認してください。' -ForegroundColor Yellow
} finally {
  $tcp.Dispose()
}
