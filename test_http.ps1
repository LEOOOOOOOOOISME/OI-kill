$ErrorActionPreference = 'Stop'
$p = Start-Process -FilePath ".\OIKillServer.exe" -RedirectStandardOutput "srv_o.txt" -RedirectStandardError "srv_e.txt" -WindowStyle Hidden -PassThru
Start-Sleep -Seconds 3
Write-Output ("PID: " + $p.Id)

# Test /api/me while not logged in (should return clean Chinese JSON now)
function RawProbe($path, $method, $reqBody) {
  $tcp = New-Object System.Net.Sockets.TcpClient
  try { $tcp.Connect("127.0.0.1", 8080) } catch { Write-Output ("connect fail " + $path); return }
  $stream = $tcp.GetStream()
  $body = if ($reqBody) { [System.Text.Encoding]::UTF8.GetBytes($reqBody) } else { @() }
  $cl = if ($body.Length -gt 0) { "Content-Length: " + $body.Length + "`r`n" } else { "" }
  $head = $method + " " + $path + " HTTP/1.1`r`nHost: 127.0.0.1`r`n" + $cl + "Connection: close`r`n`r`n"
  $all = [System.Text.Encoding]::UTF8.GetBytes($head) + $body
  $stream.Write($all,0,$all.Length); $stream.Flush()
  Start-Sleep -Milliseconds 500
  $ms = New-Object System.IO.MemoryStream; $buf = New-Object byte[] 8192
  do { $n=$stream.Read($buf,0,8192); if($n -gt 0){$ms.Write($buf,0,$n)} } while($n -gt 0)
  $raw=$ms.ToArray(); $stream.Close(); $tcp.Close()
  $text=[System.Text.Encoding]::ASCII.GetString($raw)
  $bs=$text.IndexOf("`r`n`r`n")+4
  $hex=""; for($i=$bs;$i -lt $raw.Length -and $i -lt $bs+60;$i++){ $hex += ("{0:X2} " -f $raw[$i]) }
  $u=[System.Text.Encoding]::UTF8.GetString($raw,$bs,$raw.Length-$bs)
  Write-Output ("[$method "+$path+"] => " + $u + "   [hex: " + $hex.Trim() + "]")
}

Write-Output "--- /api/me (no session, should be Chinese error JSON) ---"
RawProbe "/api/me" "GET" $null
Write-Output "--- /api/lobby (no session, should be Chinese error JSON) ---"
RawProbe "/api/lobby" "GET" $null
Write-Output "--- /api/admin/rooms (no session) ---"
RawProbe "/api/admin/rooms" "GET" $null

Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
