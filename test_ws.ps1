$ErrorActionPreference = 'Stop'

function XorBytes($data, $key) {
  if ($key.Length -eq 0) { return $data }
  $out = New-Object byte[] $data.Length
  for ($i=0; $i -lt $data.Length; $i++) {
    $kb = $key[$i % $key.Length]
    $out[$i] = $data[$i] -bxor $kb
  }
  return $out
}
function StrBytes($s) { return [System.Text.Encoding]::UTF8.GetBytes($s) }
function B64($b) { return [System.Convert]::ToBase64String($b) }

# ---- login and get key ----
function Login($u,$pw) {
  $body = 'u='+$u+'&p='+$pw
  # simple HTTP POST via HttpWebRequest
  $req = [System.Net.HttpWebRequest]::Create('http://127.0.0.1:8080/api/login')
  $req.Method='POST'; $req.ContentType='application/x-www-form-urlencoded'
  $req.CookieContainer = New-Object System.Net.CookieContainer
  $bs = StrBytes $body; $req.ContentLength=$bs.Length
  $st = $req.GetRequestStream(); $st.Write($bs,0,$bs.Length); $st.Close()
  $res = $req.GetResponse()
  $rd = New-Object System.IO.StreamReader($res.GetResponseStream(),[System.Text.Encoding]::UTF8)
  $json = $rd.ReadToEnd(); $rd.Close()
  $j = $json | ConvertFrom-Json
  $sess = $res.Cookies['session']
  return @{ username=$u; token=$sess.Value; key=$j.key; cc=$req.CookieContainer; json=$json }
}

# ---- WebSocket client helper ----
function WSConnect($token,$cookie) {
  $tcp = New-Object System.Net.Sockets.TcpClient
  $tcp.Connect('127.0.0.1',8080)
  $st = $tcp.GetStream()
  $sec = 'dGhlIHNhbXBsZSBub25jZQ=='
  $req = "GET /ws HTTP/1.1`r`nHost: 127.0.0.1`r`nUpgrade: websocket`r`nConnection: Upgrade`r`nCookie: session=$token`r`nSec-WebSocket-Key: $sec`r`nSec-WebSocket-Version: 13`r`n`r`n"
  $hb = StrBytes $req; $st.Write($hb,0,$hb.Length); $st.Flush()
  Start-Sleep -Milliseconds 300
  # read handshake response
  $ms=New-Object System.IO.MemoryStream; $buf=New-Object byte[] 4096
  $st.ReadTimeout=2000
  do { $n=$st.Read($buf,0,4096); if($n -gt 0){$ms.Write($buf,0,$n)} } while($st.DataAvailable)
  $handshake = [System.Text.Encoding]::ASCII.GetString($ms.ToArray())
  if (-not ($handshake -like '*101*')) { throw 'handshake failed: '+$handshake }
  return @{tcp=$tcp; st=$st; ms=$ms}
}
# send a masked text frame
function WSSend($conn,$payloadBytes,$key){
  $st = $conn.st
  $payload = XorBytes $payloadBytes $key
  $len = $payload.Length
  $frame = New-Object System.Collections.Generic.List[byte]
  $frame.Add(0x81)
  if ($len -lt 126) { $frame.Add([byte]($len -bor 0x80)) }
  elseif ($len -le 65535) { $frame.Add(126 -bor 0x80); $frame.Add([byte]($len -shr 8)); $frame.Add([byte]($len -band 0xFF)) }
  else { $frame.Add(127 -bor 0x80); for($i=7;$i -ge 0;$i--){$frame.Add([byte](($len -shr ($i*8)) -band 0xFF))} }
  $mask = @('m','a','s','k')
  foreach($m in $mask){ $frame.Add([byte]$m) }
  for($i=0;$i -lt $len;$i++){ $frame.Add([byte]($payload[$i] -bxor [byte]($mask[$i%4]))) }
  $st.Write($frame.ToArray(),0,$frame.Count); $st.Flush()
}
# read frames
function WSReadFrames($conn,$key,$timeoutMs){
  $st=$conn.st; $st.ReadTimeout=$timeoutMs
  $frames = New-Object System.Collections.ArrayList
  while($st.DataAvailable){
    Start-Sleep -Milliseconds 60
    $h=New-Object byte[] 2
    try { $n=$st.Read($h,0,2) } catch { break }
    if($n -lt 2){ break }
    $opcode=$h[0] -band 0x0F; $len=$h[1] -band 0x7F
    if($len -eq 126){ $b=New-Object byte[] 2; $st.Read($b,0,2); $len=($b[0]-shl 8)-bor $b[1] }
    elseif($len -eq 127){ $b=New-Object byte[] 8; $st.Read($b,0,8); $len=0; for($i=0;$i -lt 8;$i++){ $len=($len -shl 8)-bor $b[$i] } }
    $pb=New-Object byte[] $len; $got=0
    while($got -lt $len){ $r=$st.Read($pb,$got,$len-$got); if($r -le 0){break}; $got+=$r }
    $plain = XorBytes $pb ([System.Text.Encoding]::UTF8.GetBytes($key))
    [void]$frames.Add(($plain | ForEach-Object { if($_ -lt 0){$_+256}else{$_} }))
    $txt = [System.Text.Encoding]::UTF8.GetString($plain)
    Write-Output ("FRAME: " + $txt)
  }
  return $frames
}

$p = Start-Process -FilePath ".\OIKillServer.exe" -RedirectStandardOutput "srv_wso.txt" -RedirectStandardError "srv_wse.txt" -WindowStyle Hidden -PassThru
Start-Sleep -Seconds 3
Write-Output ("server PID: " + $p.Id)

# login two users
$a = Login 'alice' 'test1234'
$b = Login 'bob' 'test1234'
Write-Output ("alice login json: " + $a.json)
Write-Output ("bob login json: " + $b.json)
Write-Output ("alice key: " + $a.key)

# connect WS for both (lobby state)
$A = WSConnect $a.token $a.cc
$B = WSConnect $b.token $b.cc
Write-Output "WS connected for alice & bob (lobby)"

Start-Sleep -Milliseconds 300
# alice sends a lobby chat
$chatJson = '{"type":"chat","scope":"lobby","text":"Hello from alice"}'
WSSend $A (StrBytes $chatJson) ([System.Text.Encoding]::UTF8.GetBytes($a.key))
Write-Output "alice sent lobby chat"
Start-Sleep -Milliseconds 500
# read what bob receives
Write-Output "--- frames bob receives ---"
$fB = WSReadFrames $B $b.key 1500
Write-Output "bob frame count: " + $fB.Count

$A.tcp.Close(); $B.tcp.Close()
Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
