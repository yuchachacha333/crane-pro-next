# このパソコンの中だけで動く。127.0.0.1 以外からは接続できない。
# Excel の「PDFで保存」で、記入済みの請求書を PDF にする。窓は出さず、ログオン時に自動で始まる。
param([switch]$ExcelMode)

$ErrorActionPreference = 'Stop'

function Stop-EmbeddingExcel() {
  Get-CimInstance Win32_Process -Filter "Name = 'EXCEL.EXE'" | Where-Object {
    $_.CommandLine -like '*-Embedding*'
  } | ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }
}

function Convert-WithExcel([string]$xlsxPath, [string]$pdfPath) {
  Stop-EmbeddingExcel
  Start-Sleep -Milliseconds 300
  $excel = $null
  $book = $null
  try {
    $excel = New-Object -ComObject Excel.Application
    $excel.Visible = $false
    $excel.DisplayAlerts = $false
    $excel.AskToUpdateLinks = $false
    $excel.ScreenUpdating = $false
    $book = $excel.Workbooks.Open($xlsxPath, 0, $true)
    # OpenAfterPublish は false。保存ダイアログや2つ目のPDFを出さない。
    $book.ExportAsFixedFormat(0, $pdfPath, 0, $false, $false, [Type]::Missing, [Type]::Missing, $false)
  } finally {
    if ($book) {
      try { $book.Close($false) | Out-Null } catch {}
      try { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($book) } catch {}
    }
    if ($excel) {
      try { $excel.Quit() | Out-Null } catch {}
      try { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) } catch {}
    }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
  }
}

if ($ExcelMode) {
  try {
    Convert-WithExcel $env:CRANE_XLSX $env:CRANE_PDF
    if (-not (Test-Path -LiteralPath $env:CRANE_PDF)) { exit 1 }
    exit 0
  } catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
  }
}

# 二重起動を避ける。すでに動いていれば何もしない。
$listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, 3100)
try {
  $listener.Start()
} catch {
  exit 0
}

# Excel が固まっても受付ごと止まらないよう、変換は別の窓なしプロセスで行い、45秒で打ち切る。
function Invoke-ExcelConvert([string]$xlsxPath, [string]$pdfPath) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = (Get-Process -Id $PID).Path
  $psi.Arguments = "-NoProfile -Sta -ExecutionPolicy Bypass -File `"$PSCommandPath`" -ExcelMode"
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.EnvironmentVariables['CRANE_XLSX'] = $xlsxPath
  $psi.EnvironmentVariables['CRANE_PDF'] = $pdfPath
  $child = [System.Diagnostics.Process]::Start($psi)
  if (-not $child.WaitForExit(45000)) {
    Stop-EmbeddingExcel
    try { $child.Kill() } catch {}
    throw 'Excelが応答しないため中断しました。もう一度押してください。'
  }
  if ($child.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $pdfPath)) {
    throw 'このパソコンの Excel でPDFにできませんでした。'
  }
}

function Read-HttpRequest($stream) {
  $data = New-Object System.Collections.Generic.List[byte]
  $buf = New-Object byte[] 65536
  $headerEnd = -1
  while ($headerEnd -lt 0) {
    $n = $stream.Read($buf, 0, $buf.Length)
    if ($n -le 0) { return $null }
    for ($i = 0; $i -lt $n; $i++) { $data.Add($buf[$i]) }
    for ($i = 0; $i -le $data.Count - 4; $i++) {
      if ($data[$i] -eq 13 -and $data[$i + 1] -eq 10 -and $data[$i + 2] -eq 13 -and $data[$i + 3] -eq 10) {
        $headerEnd = $i
        break
      }
    }
  }
  $headerBytes = $data.GetRange(0, $headerEnd).ToArray()
  $header = [System.Text.Encoding]::ASCII.GetString($headerBytes)
  $length = 0
  foreach ($line in ($header -split "`r`n")) {
    if ($line -match '^Content-Length:\s*(\d+)') { $length = [int]$Matches[1] }
  }
  $body = New-Object System.Collections.Generic.List[byte]
  if ($data.Count -gt $headerEnd + 4) {
    $body.AddRange($data.GetRange($headerEnd + 4, $data.Count - ($headerEnd + 4)))
  }
  while ($body.Count -lt $length) {
    $n = $stream.Read($buf, 0, $buf.Length)
    if ($n -le 0) { break }
    $take = [Math]::Min($n, $length - $body.Count)
    for ($i = 0; $i -lt $take; $i++) { $body.Add($buf[$i]) }
  }
  $method = ($header -split ' ')[0]
  $path = (($header -split ' ')[1] -split '\?')[0]
  return @{ Method = $method; Path = $path; Body = $body.ToArray() }
}

function Write-Http($stream, [int]$status, [string]$statusText, [byte[]]$body, [string]$type) {
  $head = "HTTP/1.1 $status $statusText`r`n" +
    "Content-Type: $type`r`n" +
    "Content-Length: $($body.Length)`r`n" +
    "Access-Control-Allow-Origin: *`r`n" +
    "Access-Control-Allow-Private-Network: true`r`n" +
    "Connection: close`r`n`r`n"
  $headBytes = [System.Text.Encoding]::ASCII.GetBytes($head)
  $stream.Write($headBytes, 0, $headBytes.Length)
  if ($body.Length -gt 0) { $stream.Write($body, 0, $body.Length) }
  $stream.Flush()
}

while ($true) {
  $client = $listener.AcceptTcpClient()
  $stream = $client.GetStream()
  $stream.ReadTimeout = 60000
  try {
    $request = Read-HttpRequest $stream
    if (-not $request) { continue }
    if ($request.Method -eq 'OPTIONS') {
      $head = "HTTP/1.1 204 No Content`r`n" +
        "Access-Control-Allow-Origin: *`r`n" +
        "Access-Control-Allow-Methods: GET, POST, OPTIONS`r`n" +
        "Access-Control-Allow-Headers: Content-Type`r`n" +
        "Access-Control-Allow-Private-Network: true`r`n" +
        "Content-Length: 0`r`nConnection: close`r`n`r`n"
      $bytes = [System.Text.Encoding]::ASCII.GetBytes($head)
      $stream.Write($bytes, 0, $bytes.Length)
      continue
    }
    if ($request.Method -eq 'GET' -and $request.Path -eq '/ping') {
      Write-Http $stream 200 'OK' ([System.Text.Encoding]::ASCII.GetBytes('ok')) 'text/plain'
      continue
    }
    if ($request.Method -ne 'POST' -or $request.Path -ne '/convert') {
      $msg = [System.Text.Encoding]::UTF8.GetBytes('変換口ではありません')
      Write-Http $stream 404 'Not Found' $msg 'text/plain; charset=utf-8'
      continue
    }
    $dir = Join-Path $env:TEMP ("invoice-pdf-" + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $dir | Out-Null
    $xlsxPath = Join-Path $dir 'invoice.xlsx'
    $pdfPath = Join-Path $dir 'invoice.pdf'
    try {
      [System.IO.File]::WriteAllBytes($xlsxPath, $request.Body)
      if ((Get-Item -LiteralPath $xlsxPath).Length -lt 100) {
        $msg = [System.Text.Encoding]::UTF8.GetBytes('Excelデータが空です')
        Write-Http $stream 400 'Bad Request' $msg 'text/plain; charset=utf-8'
        continue
      }
      Invoke-ExcelConvert $xlsxPath $pdfPath
      $pdf = [System.IO.File]::ReadAllBytes($pdfPath)
      Write-Http $stream 200 'OK' $pdf 'application/pdf'
    } catch {
      $msg = [System.Text.Encoding]::UTF8.GetBytes($_.Exception.Message)
      Write-Http $stream 500 'Error' $msg 'text/plain; charset=utf-8'
    } finally {
      Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue
    }
  } catch {
  } finally {
    $client.Close()
  }
}
