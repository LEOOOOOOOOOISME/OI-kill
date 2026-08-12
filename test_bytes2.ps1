$ErrorActionPreference = 'Stop'

function Probe($path, $reqBody) {
  $tcp = New-Object System.Net.Sockets.TcpClient
  $tcp.Connect("127.0.0.1", 8080)
  $stream = $tcp.GetStream()
  $reqBytes = [System.Text.Encoding]::UTF8.GetBytes($reqBody)
  $req = "POST " + $path + " HTTP/1.1`r`nHost: 127.0.0.1`r`nContent-Type: application/x-www-form-urlencoded`r`nContent-Length: " + $reqBytes.Length + "`r`nConnection: close`r`n`r`n"
  $all = [System.Text.Encoding]::UTF8.GetBytes($req) + $reqBytes
  $stream.Write($all, 0, $all.Length)
  $stream.Flush()
  Start-Sleep -Milliseconds 600
  $ms = New-Object System.IO.MemoryStream
  $buf = New-Object byte[] 4096
  do { $n = $stream.Read($buf, 0, 4096); if ($n -gt 0) { $ms.Write($buf, 0, $n) } } while ($n -gt 0)
  $raw = $ms.ToArray()
  $stream.Close(); $tcp.Close()
  $text = [System.Text.Encoding]::ASCII.GetString($raw)
  $hdrIdx = $text.IndexOf("`r`n`r`n")
  $bs = $hdrIdx + 4
  $hex = ""
  for($i=$bs; $i -lt $raw.Length; $i++){ $hex += ("{0:X2} " -f $raw[$i]) }
  Write-Output ("  hex: " + $hex)
  $u = [System.Text.Encoding]::UTF8.GetString($raw, $bs, $raw.Length - $bs)
  Write-Output ("  utf8: " + $u)
}

$p = Start-Process -FilePath ".\OIKillServer.exe" -RedirectStandardOutput "srv_out6.txt" -RedirectStandardError "srv_err6.txt" -WindowStyle Hidden -PassThru
Start-Sleep -Seconds 3
Write-Output "Test duplicate register (Chinese 'already exists' msg):"
Probe "/api/register" "u=testuser&p=test1234"
Write-Output "Test invalid username with space (Chinese 'illegal chars' msg):"
Probe "/api/register" "u=badname%20x&p=test1234"
Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
