$ErrorActionPreference = 'Continue'
function StrBytes($s) { return [System.Text.Encoding]::UTF8.GetBytes($s) }
function XorBytes($data, $key) {
  $out = New-Object byte[] $data.Length
  for ($i=0; $i -lt $data.Length; $i++) { $out[$i] = $data[$i] -bxor $key[$i % $key.Length] }
  return $out
}
function HttpJson($method,$path,$body,$cookies){
  $req=[System.Net.HttpWebRequest]::Create('http://127.0.0.1:8080'+$path)
  $req.Method=$method
  if($cookies){ $cc=New-Object System.Net.CookieContainer; $cc.Add([uri]$req.RequestUri, $cookies) }
  if($body -ne $null){ $req.ContentType='application/x-www-form-urlencoded'; $bs=StrBytes $body; $req.ContentLength=$bs.Length; $st=$req.GetRequestStream(); $st.Write($bs,0,$bs.Length); $st.Close() }
  try {
    $res=$req.GetResponse()
    $rd=New-Object System.IO.StreamReader($res.GetResponseStream(),[System.Text.Encoding]::UTF8)
    $json=$rd.ReadToEnd();$rd.Close()
    $ck = if($res.Cookies){ $res.Cookies } else { $null }
    return @{ json=$json; cookies=$ck; ok=$true }
  } catch {
    return @{ json=''; cookies=$null; ok=$false }
  }
}

$p = Start-Process -FilePath ".\OIKillServer.exe" -RedirectStandardOutput "srv2o.txt" -RedirectStandardError "srv2e.txt" -WindowStyle Hidden -PassThru
Start-Sleep -Seconds 3
Write-Output ("server PID: " + $p.Id)

# register clean users
foreach($u in @('zk1','zk2','zk3')){
  $r=HttpJson 'POST' '/api/register' "u=$u&p=pass123" $null
  Write-Output ("register $u => " + $r.json)
}

# login
$l1=HttpJson 'POST' '/api/login' 'u=zk1&p=pass123' $null
$l2=HttpJson 'POST' '/api/login' 'u=zk2&p=pass123' $null
Write-Output ("login zk1 => " + $l1.json)
$k1 = ($l1.json | ConvertFrom-Json).key
$k2 = ($l2.json | ConvertFrom-Json).key
$t1 = ($l1.json | ConvertFrom-Json).token
$t2 = ($l2.json | ConvertFrom-Json).token
Write-Output ("key1=$k1 key2=$k2")

# login failure check
$bad=HttpJson 'POST' '/api/login' 'u=zk1&p=wrongpass' $null
Write-Output ("login wrong pw => " + $bad.json)  # should be 用户名或密码错误

# WebSocket helper
function WSConnect($token){
  $tcp=New-Object System.Net.Sockets.TcpClient; $tcp.Connect('127.0.0.1',8080); $st=$tcp.GetStream()
  $key='dGhlIHNhbXBsZSBub25jZQ=='
  $req="GET /ws HTTP/1.1`r`nHost: 127.0.0.1`r`nUpgrade: websocket`r`nConnection: Upgrade`r`nCookie: session=$token`r`nSec-WebSocket-Key: $key`r`nSec-WebSocket-Version: 13`r`n`r`n"
  $hb=StrBytes $req; $st.Write($hb,0,$hb.Length); $st.Flush()
  Start-Sleep -Milliseconds 300
  $ms=New-Object System.IO.MemoryStream; $buf=New-Object byte[] 4096
  $st.ReadTimeout=1500
  do { try{$n=$st.Read($buf,0,4096); if($n -gt 0){$ms.Write($buf,0,$n)} }catch{break} } while($st.DataAvailable)
  $hs=[System.Text.Encoding]::ASCII.GetString($ms.ToArray())
  if(-not ($hs -like '*101*')){ throw 'ws handshake fail: '+$hs }
  return @{tcp=$tcp; st=$st}
}
function WSSend($conn,$asciiPayload){
  # asciiPayload = base64(xor(utf8bytes, key)) already computed; send masked text frame
  $st=$conn.st; $pl=StrBytes $asciiPayload; $len=$pl.Length
  $f=New-Object System.Collections.Generic.List[byte]; $f.Add(0x81)
  if($len -lt 126){$f.Add([byte]($len -bor 0x80))} elseif($len -le 65535){$f.Add(126 -bor 0x80);$f.Add([byte]($len -shr 8));$f.Add([byte]($len -band 0xFF))} else {$f.Add(127 -bor 0x80); for($i=7;$i -ge 0;$i--){$f.Add([byte](($len -shr ($i*8))-band 0xFF))}}
  $mask=@(0x6D,0x61,0x73,0x6B); foreach($m2 in $mask){$f.Add([byte]$m2)}
  for($i=0;$i -lt $len;$i++){$f.Add([byte]($pl[$i]-bxor[byte]($mask[$i%4])))}
  $st.Write($f.ToArray(),0,$f.Count); $st.Flush()
}
# server/client payload builder: enc(json) = base64(xor(utf8(json), utf8(key)))
function ClientEnc($jsonText,$key){ return [System.Convert]::ToBase64String((XorBytes (StrBytes $jsonText) (StrBytes $key))) }
function WSRead($conn,$key,$ms){
  $st=$conn.st; $st.ReadTimeout=$ms; $out=New-Object System.Collections.ArrayList
  while($st.DataAvailable){ Start-Sleep -Milliseconds 60
    $h=New-Object byte[] 2; try{$n=$st.Read($h,0,2)}catch{break}; if($n -lt 2){break}
    $len=$h[1] -band 0x7F
    if($len -eq 126){$bb=New-Object byte[] 2;$st.Read($bb,0,2);$len=($bb[0]-shl 8)-bor $bb[1]} elseif($len -eq 127){$bb=New-Object byte[] 8;$st.Read($bb,0,8);$len=0;for($i=0;$i -lt 8;$i++){$len=($len-shl 8)-bor $bb[$i]}}
    $pb=New-Object byte[] $len; $got=0; while($got -lt $len){$r=$st.Read($pb,$got,$len-$got);if($r-le 0){break};$got+=$r}
    $txt=[System.Text.Encoding]::UTF8.GetString((XorBytes $pb ([System.Text.Encoding]::UTF8.GetBytes($key))))
    [void]$out.Add($txt)
  }
  return $out
}

# connect two users (lobby)
$A=WSConnect $t1; $B=WSConnect $t2
Write-Output "WS connected zk1/zk2 (lobby)"
Start-Sleep -Milliseconds 300
# zk1 sends lobby chat (via client enc)
$chat1 = '{"type":"chat","scope":"lobby","text":"大厅大家好"}'
$payload1 = ClientEnc $chat1 $k1
Write-Output ("payload len="+$payload1.Length)
WSSend $A $payload1
Write-Output "zk1 sent lobby chat"
Start-Sleep -Milliseconds 500
$fA = WSRead $A $k1 1500
$fB = WSRead $B $k2 1500
Write-Output ('zk1 received frames: '+$fA.Count)
$fA | ForEach-Object { Write-Output ("  zk1: "+$_) }
Write-Output ('zk2 received frames: '+$fB.Count)
$fB | ForEach-Object { Write-Output ("  zk2: "+$_) }

$A.tcp.Close(); $B.tcp.Close()
Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
