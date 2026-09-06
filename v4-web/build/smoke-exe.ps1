<#
  smoke-exe.ps1 -- P9 SEA exe smoke test (pure ASCII source to survive PS 5.1 default ANSI parsing)

  Usage:  pwsh -NoProfile -File build/smoke-exe.ps1 -ExePath dist/oikill-lan.exe [-CheckIndexHtml]

  Flow:   start exe --no-browser with redirected stdio
          parse banner until 127.0.0.1:<port> (35s cap)
          GET /api/hello (expect HTTP 200 + ok:true)
          GET /           (expect HTTP 200 + contains 'OI' + U+6740)
          GET /src/data/cards.js (expect HTTP 200 + content byte-equal to disk source)
          [optional] GET /index.html (expect HTTP 200)
          write 'q' to stdin -> wait exit (8s cap) -> expect ExitCode 0
          check temp extraction dir %TEMP%\oikill-static-<pid>\root file count
          check port released
  Exit:   0 = all checks passed; 1 = any failure
#>
param(
  [Parameter(Mandatory = $true)][string]$ExePath,
  [switch]$CheckIndexHtml
)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
$exe = (Resolve-Path -LiteralPath $ExePath).Path
$checks = New-Object System.Collections.ArrayList
function AddCheck([string]$name, [bool]$ok, [string]$detail) {
  [void]$checks.Add([pscustomobject]@{ Name = $name; Ok = $ok; Detail = $detail })
}

$p = New-Object System.Diagnostics.Process
$p.StartInfo.FileName = $exe
$p.StartInfo.Arguments = '--no-browser'
$p.StartInfo.WorkingDirectory = Split-Path $exe -Parent
$p.StartInfo.UseShellExecute = $false
$p.StartInfo.RedirectStandardInput = $true
$p.StartInfo.RedirectStandardOutput = $true
$p.StartInfo.RedirectStandardError = $true
$p.StartInfo.StandardOutputEncoding = [System.Text.Encoding]::UTF8
$p.StartInfo.StandardErrorEncoding = [System.Text.Encoding]::UTF8
[void]$p.Start()
$pidOfExe = $p.Id

$banner = New-Object System.Text.StringBuilder
$port = $null
$task = $null
$deadline = (Get-Date).AddSeconds(35)
while ((Get-Date) -lt $deadline) {
  if ($p.HasExited) { break }
  if ($null -eq $task) { $task = $p.StandardOutput.ReadLineAsync() }
  if ($task.Wait(200)) {
    if ($task.Status -eq [System.Threading.Tasks.TaskStatus]::RanToCompletion -and $null -ne $task.Result) {
      $line = $task.Result
      [void]$banner.AppendLine($line)
      if ($line -match '127\.0\.0\.1:(\d+)') { $port = [int]$Matches[1]; break }
    } else {
      break
    }
    $task = $null
  }
}

if (-not $port) {
  "SMOKE FAIL: no port parsed within 35s (exe may have failed to start)"
  "--- banner so far ---"
  $banner.ToString()
  try { $p.Kill() } catch {}
  try { $p.WaitForExit(3000) | Out-Null } catch {}
  try { "--- stderr ---"; $p.StandardError.ReadToEnd() } catch {}
  exit 1
}

$base = "http://127.0.0.1:$port"
$sha = [char]0x6740  # U+6740

# 1) /api/hello
try {
  $r = Invoke-WebRequest -Uri ($base + '/api/hello') -TimeoutSec 5 -UseBasicParsing
  $okJson = ($r.Content -match '"ok"\s*:\s*true')
  AddCheck '/api/hello' (($r.StatusCode -eq 200) -and $okJson) ("HTTP " + $r.StatusCode + " okJson=" + $okJson)
} catch { AddCheck '/api/hello' $false ("exception: " + $_.Exception.Message) }

# 2) /
try {
  $r = Invoke-WebRequest -Uri ($base + '/') -TimeoutSec 5 -UseBasicParsing
  $has = $r.Content.Contains('OI' + $sha)
  $disk = [System.IO.File]::ReadAllText((Join-Path $repoRoot 'index.html'), [System.Text.Encoding]::UTF8)
  $eq = ($r.Content -ceq $disk)
  AddCheck '/' (($r.StatusCode -eq 200) -and $has -and $eq) ("HTTP " + $r.StatusCode + " hasTitle=" + $has + " identicalToDisk=" + $eq + " bytes=" + $r.RawContentLength)
} catch { AddCheck '/' $false ("exception: " + $_.Exception.Message) }

# 3) /src/data/cards.js -- must equal disk source byte-for-byte (proves in-memory extraction)
try {
  $r = Invoke-WebRequest -Uri ($base + '/src/data/cards.js') -TimeoutSec 5 -UseBasicParsing
  $disk = [System.IO.File]::ReadAllText((Join-Path $repoRoot 'src\data\cards.js'), [System.Text.Encoding]::UTF8)
  $eq = ($r.Content -ceq $disk)
  AddCheck '/src/data/cards.js' (($r.StatusCode -eq 200) -and $eq) ("HTTP " + $r.StatusCode + " identicalToDisk=" + $eq + " bytes=" + $r.RawContentLength)
} catch { AddCheck '/src/data/cards.js' $false ("exception: " + $_.Exception.Message) }

# 3b) /src/engine/core.js -- big file with template literals; equality proves esbuild string-escaping fidelity
try {
  $r = Invoke-WebRequest -Uri ($base + '/src/engine/core.js') -TimeoutSec 5 -UseBasicParsing
  $disk = [System.IO.File]::ReadAllText((Join-Path $repoRoot 'src\engine\core.js'), [System.Text.Encoding]::UTF8)
  $eq = ($r.Content -ceq $disk)
  AddCheck '/src/engine/core.js' (($r.StatusCode -eq 200) -and $eq) ("HTTP " + $r.StatusCode + " identicalToDisk=" + $eq + " bytes=" + $r.RawContentLength)
} catch { AddCheck '/src/engine/core.js' $false ("exception: " + $_.Exception.Message) }

# 4) /index.html (required for single)
if ($CheckIndexHtml) {
  try {
    $r = Invoke-WebRequest -Uri ($base + '/index.html') -TimeoutSec 5 -UseBasicParsing
    $has = $r.Content.Contains('OI' + $sha)
    AddCheck '/index.html' (($r.StatusCode -eq 200) -and $has) ("HTTP " + $r.StatusCode + " hasTitle=" + $has + " bytes=" + $r.RawContentLength)
  } catch { AddCheck '/index.html' $false ("exception: " + $_.Exception.Message) }
}

# 5) clean exit via 'q'
try { $p.StandardInput.WriteLine('q'); $p.StandardInput.Flush() } catch {}
$exited = $p.WaitForExit(8000)
if (-not $exited) { try { $p.Kill() } catch {}; try { $p.WaitForExit(3000) | Out-Null } catch {} }
$tail = ''; try { $tail = $p.StandardOutput.ReadToEnd() } catch {}
$err = ''; try { $err = $p.StandardError.ReadToEnd() } catch {}
[void]$banner.Append($tail)
AddCheck 'clean-exit' ($exited -and $p.ExitCode -eq 0) ("exited=" + $exited + " exitCode=" + $p.ExitCode)

# 6) temp extraction dir
$tmpRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('oikill-static-' + $pidOfExe + '\root')
if (Test-Path $tmpRoot) {
  $n = (Get-ChildItem $tmpRoot -Recurse -File).Count
  AddCheck 'extract-dir' ($n -ge 28) ("$tmpRoot files=" + $n)
} else {
  AddCheck 'extract-dir' $false ("missing: $tmpRoot")
}

# 7) port released
$still = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
AddCheck 'port-released' (-not $still) ("port " + $port + " stillListening=" + [bool]$still)

"=== SMOKE RESULT for $exe ==="
$allOk = $true
foreach ($c in $checks) {
  if (-not $c.Ok) { $allOk = $false }
  ("{0,-22} {1}  {2}" -f $c.Name, $(if ($c.Ok) { 'PASS' } else { 'FAIL' }), $c.Detail)
}
"--- banner ---"
$banner.ToString().TrimEnd()
if ($err) { "--- stderr ---"; $err }
if ($allOk) { "ALL PASS" ; exit 0 } else { "SOME FAILED"; exit 1 }
