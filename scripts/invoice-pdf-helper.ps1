# ボタンを押したパソコンの中だけで動く。127.0.0.1 以外からは接続できない。
# Excel の「PDFで保存」で、記入済みの請求書を PDF にする。
param([switch]$MailMode, [switch]$ExcelMode)

$ErrorActionPreference = 'Stop'

if ($MailMode) {
  $utf8 = New-Object System.Text.UTF8Encoding $false
  $outlook = New-Object -ComObject Outlook.Application
  $mail = $outlook.CreateItem(0)
  $mail.BodyFormat = 1
  $mail.Subject = [IO.File]::ReadAllText($env:CRANE_MAIL_SUBJECT, $utf8)
  $mail.Body = [IO.File]::ReadAllText($env:CRANE_MAIL_BODY, $utf8)
  $to = ([string]$env:CRANE_MAIL_TO -replace '[\r\n\s]', '').Trim()
  if ($to -match '^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$') { $mail.To = $to }
  [void]$mail.Attachments.Add($env:CRANE_MAIL_PDF)
  $mail.Display()
  exit 0
}

if (-not ('Win32ExcelPid' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class Win32ExcelPid {
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
'@
}

function Stop-EmbeddingExcel() {
  Get-CimInstance Win32_Process -Filter "Name = 'EXCEL.EXE'" | Where-Object {
    $_.CommandLine -like '*-Embedding*'
  } | ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }
}

function Convert-WithExcel([string]$xlsxPath, [string]$pdfPath) {
  Stop-EmbeddingExcel
  Start-Sleep -Milliseconds 400
  $excel = $null
  $book = $null
  $excelPid = 0
  try {
    $excel = New-Object -ComObject Excel.Application
    $excel.Visible = $false
    $excel.DisplayAlerts = $false
    $excel.AskToUpdateLinks = $false
    $excel.ScreenUpdating = $false
    try {
      $procId = [uint32]0
      [void][Win32ExcelPid]::GetWindowThreadProcessId([IntPtr]$excel.Hwnd, [ref]$procId)
      $excelPid = [int]$procId
    } catch {}
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
    if ($excelPid -gt 0) {
      Stop-Process -Id $excelPid -Force -ErrorAction SilentlyContinue
    }
  }
}

function Invoke-ExcelConvert([string]$xlsxPath, [string]$pdfPath) {
  $started = Get-Date
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = (Get-Process -Id $PID).Path
  $psi.Arguments = "-NoProfile -Sta -ExecutionPolicy Bypass -File `"$PSCommandPath`" -ExcelMode"
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.EnvironmentVariables['CRANE_XLSX'] = $xlsxPath
  $psi.EnvironmentVariables['CRANE_PDF'] = $pdfPath
  $child = [System.Diagnostics.Process]::Start($psi)
  if (-not $child.WaitForExit(45000)) {
    Get-CimInstance Win32_Process -Filter "Name = 'EXCEL.EXE'" | Where-Object {
      $_.CommandLine -like '*-Embedding*' -and $_.CreationDate -ge $started.AddSeconds(-5)
    } | ForEach-Object {
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
    try { $child.Kill() } catch {}
    throw 'Excelが応答しないため中断しました。もう一度押してください。'
  }
  if ($child.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $pdfPath)) {
    throw 'このパソコンの Excel でPDFにできませんでした。'
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

$listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, 3100)
$listener.Start()
Write-Host '請求PDFの受付を開始しました。この窓は閉じないでください。'
Write-Host '待受: http://127.0.0.1:3100/'

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

function Get-Base64Wrapped([byte[]]$bytes) {
  $b64 = [Convert]::ToBase64String($bytes)
  $sb = New-Object System.Text.StringBuilder
  for ($i = 0; $i -lt $b64.Length; $i += 76) {
    if ($i -gt 0) { [void]$sb.Append("`r`n") }
    $len = [Math]::Min(76, $b64.Length - $i)
    [void]$sb.Append($b64.Substring($i, $len))
  }
  return $sb.ToString()
}

function ConvertTo-EncodedWord([string]$text) {
  $b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($text))
  $parts = @()
  for ($i = 0; $i -lt $b64.Length; $i += 60) {
    $len = [Math]::Min(60, $b64.Length - $i)
    $parts += "=?UTF-8?B?$($b64.Substring($i, $len))?="
  }
  return ($parts -join ' ')
}

function Find-ClassicOutlook {
  $candidates = @(
    (Join-Path $env:ProgramFiles 'Microsoft Office\root\Office16\OUTLOOK.EXE'),
    (Join-Path ${env:ProgramFiles(x86)} 'Microsoft Office\root\Office16\OUTLOOK.EXE')
  )
  foreach ($path in $candidates) {
    if ($path -and (Test-Path -LiteralPath $path)) { return $path }
  }
  foreach ($key in @(
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\OUTLOOK.EXE',
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths\OUTLOOK.EXE'
  )) {
    try {
      $path = (Get-ItemProperty -LiteralPath $key -ErrorAction Stop).'(default)'
      if ($path -and (Test-Path -LiteralPath $path)) { return $path }
    } catch {}
  }
  return $null
}

function Test-OutlookCom {
  try { return $null -ne [Type]::GetTypeFromProgID('Outlook.Application', $false) } catch { return $false }
}

function Set-MailRecipient($mail, [string]$address) {
  $text = ($address -replace '[\r\n\s]', '').Trim()
  if ($text -match '^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$') { $mail.To = $text }
}

function Open-ClassicOutlookCom([string]$pdfPath, [string]$subject, [string]$bodyText, [string]$to) {
  $outlook = New-Object -ComObject Outlook.Application
  $mail = $outlook.CreateItem(0)
  $mail.BodyFormat = 1
  $mail.Subject = $subject
  $mail.Body = $bodyText
  Set-MailRecipient $mail $to
  [void]$mail.Attachments.Add($pdfPath)
  $mail.Display()
}

function Invoke-ClassicOutlook32([string]$pdfPath, [string]$subject, [string]$bodyText, [string]$to) {
  $ps32 = Join-Path $env:WINDIR 'SysWOW64\WindowsPowerShell\v1.0\powershell.exe'
  if (-not (Test-Path -LiteralPath $ps32)) { return $false }
  $dir = Join-Path $env:TEMP 'crane-invoice-mail'
  New-Item -ItemType Directory -Path $dir -Force | Out-Null
  $id = [guid]::NewGuid().ToString('N')
  $utf8 = New-Object System.Text.UTF8Encoding $false
  $pdfCopy = Join-Path $dir ($id + '.pdf')
  $subjectFile = Join-Path $dir ($id + '.subject.txt')
  $bodyFile = Join-Path $dir ($id + '.body.txt')
  Copy-Item -LiteralPath $pdfPath -Destination $pdfCopy -Force
  [IO.File]::WriteAllText($subjectFile, $subject, $utf8)
  [IO.File]::WriteAllText($bodyFile, $bodyText, $utf8)
  $env:CRANE_MAIL_PDF = $pdfCopy
  $env:CRANE_MAIL_SUBJECT = $subjectFile
  $env:CRANE_MAIL_BODY = $bodyFile
  $env:CRANE_MAIL_TO = $to
  $proc = Start-Process -FilePath $ps32 -ArgumentList @(
    '-NoProfile', '-Sta', '-ExecutionPolicy', 'Bypass', '-File', $PSCommandPath, '-MailMode'
  ) -Wait -PassThru -WindowStyle Hidden
  Remove-Item Env:CRANE_MAIL_PDF, Env:CRANE_MAIL_SUBJECT, Env:CRANE_MAIL_BODY, Env:CRANE_MAIL_TO -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $pdfCopy, $subjectFile, $bodyFile -Force -ErrorAction SilentlyContinue
  return ($proc.ExitCode -eq 0)
}

function Open-EmlDraft([string]$pdfPath, [string]$subject, [string]$bodyText, [string]$classicExe, [string]$to) {
  $fileName = [IO.Path]::GetFileName($pdfPath)
  if (-not $fileName) { $fileName = 'invoice.pdf' }
  $boundary = '----=_Invoice_' + [guid]::NewGuid().ToString('N')
  $encodedName = ConvertTo-EncodedWord $fileName
  $lines = @(
    'X-Unsent: 1',
    'MIME-Version: 1.0',
    $(if (($to -replace '[\r\n\s]', '').Trim() -match '^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$') { 'To: ' + $Matches[0] } else { 'To:' }),
    ('Subject: ' + (ConvertTo-EncodedWord $subject)),
    ('Content-Type: multipart/mixed; boundary="' + $boundary + '"'),
    '',
    ('--' + $boundary),
    'Content-Type: text/plain; charset="utf-8"',
    'Content-Transfer-Encoding: base64',
    '',
    (Get-Base64Wrapped ([Text.Encoding]::UTF8.GetBytes($bodyText))),
    ('--' + $boundary),
    'Content-Type: application/pdf',
    'Content-Transfer-Encoding: base64',
    ('Content-Disposition: attachment; filename="' + $encodedName + '"'),
    '',
    (Get-Base64Wrapped ([IO.File]::ReadAllBytes($pdfPath))),
    ('--' + $boundary + '--'),
    ''
  )
  $dir = Join-Path $env:TEMP 'crane-invoice-mail'
  New-Item -ItemType Directory -Path $dir -Force | Out-Null
  $emlPath = Join-Path $dir ('draft-' + [guid]::NewGuid().ToString('N') + '.eml')
  $utf8 = New-Object System.Text.UTF8Encoding $false
  [IO.File]::WriteAllText($emlPath, ($lines -join "`n"), $utf8)
  $olk = Join-Path $env:LOCALAPPDATA 'Microsoft\WindowsApps\olk.exe'
  if ($classicExe) {
    Start-Process -FilePath $classicExe -ArgumentList @($emlPath)
  } elseif (Test-Path -LiteralPath $olk) {
    Start-Process -FilePath $olk -ArgumentList @($emlPath)
  } else {
    Start-Process -FilePath $emlPath
  }
}

function Open-OutlookDraft([string]$pdfPath, [string]$subject, [string]$bodyText, [string]$to) {
  $classic = Find-ClassicOutlook
  if (Test-OutlookCom) {
    try {
      Open-ClassicOutlookCom $pdfPath $subject $bodyText $to
      return
    } catch {}
  } elseif ($classic -and $classic -like '*\Program Files (x86)\*') {
    if (Invoke-ClassicOutlook32 $pdfPath $subject $bodyText $to) { return }
  }
  Open-EmlDraft $pdfPath $subject $bodyText $classic $to
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
        "Access-Control-Allow-Methods: POST, OPTIONS`r`n" +
        "Access-Control-Allow-Headers: Content-Type`r`n" +
        "Access-Control-Allow-Private-Network: true`r`n" +
        "Content-Length: 0`r`nConnection: close`r`n`r`n"
      $bytes = [System.Text.Encoding]::ASCII.GetBytes($head)
      $stream.Write($bytes, 0, $bytes.Length)
      continue
    }
    if ($request.Method -ne 'POST' -or ($request.Path -ne '/convert' -and $request.Path -ne '/mail')) {
      $msg = [System.Text.Encoding]::UTF8.GetBytes('変換口ではありません')
      Write-Http $stream 404 'Not Found' $msg 'text/plain; charset=utf-8'
      continue
    }
    $dir = Join-Path $env:TEMP ("invoice-pdf-" + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $dir | Out-Null
    $xlsxPath = Join-Path $dir 'invoice.xlsx'
    $pdfPath = Join-Path $dir 'invoice.pdf'
    $mailSubject = ''
    $mailBody = ''
    $mailTo = ''
    try {
      if ($request.Path -eq '/mail') {
        $payload = [Text.Encoding]::UTF8.GetString($request.Body) | ConvertFrom-Json
        $rawName = [string]$payload.fileName
        $safeName = [IO.Path]::GetFileName($rawName)
        if ($safeName -and $safeName.ToLower().EndsWith('.pdf')) { $pdfPath = Join-Path $dir $safeName }
        $xlsxBytes = [Convert]::FromBase64String([string]$payload.xlsx)
        [System.IO.File]::WriteAllBytes($xlsxPath, $xlsxBytes)
        $mailSubject = [string]$payload.subject
        $mailBody = [string]$payload.body
        $mailTo = [string]$payload.to
      } else {
        [System.IO.File]::WriteAllBytes($xlsxPath, $request.Body)
      }
      if ((Get-Item -LiteralPath $xlsxPath).Length -lt 100) {
        $msg = [System.Text.Encoding]::UTF8.GetBytes('Excelデータが空です')
        Write-Http $stream 400 'Bad Request' $msg 'text/plain; charset=utf-8'
        continue
      }
      Invoke-ExcelConvert $xlsxPath $pdfPath
      if (-not (Test-Path -LiteralPath $pdfPath)) {
        $msg = [System.Text.Encoding]::UTF8.GetBytes('Excelは起動しましたが、PDFができませんでした')
        Write-Http $stream 500 'Error' $msg 'text/plain; charset=utf-8'
        continue
      }
      if ($request.Path -eq '/mail') {
        Open-OutlookDraft $pdfPath $mailSubject $mailBody $mailTo
        $done = [System.Text.Encoding]::UTF8.GetBytes('{"ok":true}')
        Write-Http $stream 200 'OK' $done 'application/json; charset=utf-8'
        Write-Host ("Outlookに開きました " + (Get-Date -Format 'HH:mm:ss'))
      } else {
        $pdf = [System.IO.File]::ReadAllBytes($pdfPath)
        Write-Http $stream 200 'OK' $pdf 'application/pdf'
        Write-Host ("PDFにしました " + (Get-Date -Format 'HH:mm:ss'))
      }
    } catch {
      $lead = $(if ($request.Path -eq '/mail') { 'Outlookでメールを開けませんでした。' } else { 'このパソコンの Excel でPDFにできませんでした。' })
      $msg = [System.Text.Encoding]::UTF8.GetBytes($lead + $_.Exception.Message)
      Write-Http $stream 500 'Error' $msg 'text/plain; charset=utf-8'
    } finally {
      Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue
    }
  } catch {
    Write-Host $_.Exception.Message
  } finally {
    $client.Close()
  }
}
