$b64='SBAQQUMHQAxEUAkFTRoZRBdXDRNTFw9AXwtbAxpASRBHVxxMEVhA08KUhOq83ZHBgZrUhpOIFx8='

$raw=[System.Convert]::FromBase64String($b64)
$kb=[System.Text.Encoding]::UTF8.GetBytes('32d83bb6f3ad985fd4bc655b3d9acbe2')
$res=New-Object byte[] $raw.Length
for($i=0;$i -lt $raw.Length;$i++){ $res[$i] = $raw[$i] -bxor $kb[$i % $kb.Length] }
$txt=[System.Text.Encoding]::UTF8.GetString($res)
Write-Output ("decrypted = " + $txt)
