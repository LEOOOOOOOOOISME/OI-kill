$p = 'D:\projects\oi-kill\network_server.cpp'

$b = [System.IO.File]::ReadAllBytes($p)
Write-Output ('file bytes: ' + $b.Length)
# count byte 0x3F ('?')
$qmByte = 0
foreach ($by in $b) { if ($by -eq 0x3F) { $qmByte++ } }
Write-Output ('byte 0x3F count: ' + $qmByte)
# count utf8 "wei" run E6 9C AA
$cnt = 0
for ($i=0; $i -lt $b.Length-2; $i++){
  if ($b[$i] -eq 0xE6 -and $b[$i+1] -eq 0x9C -and $b[$i+2] -eq 0xAA){ $cnt++ }
}
Write-Output ('utf8 C4 9C AA (wei) count: ' + $cnt)
# count GBK "wei" two-byte: 未 in GBK is BE B4? Verify: count 0xBE 0xB4
$gcnt=0
for($i=0;$i -lt $b.Length-1;$i++){ if($b[$i] -eq 0xBE -and $b[$i+1] -eq 0xB4){$gcnt++} }
Write-Output ('gbk wait BE B4 count: ' + $gcnt)
