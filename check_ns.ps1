$p = 'D:\projects\oi-kill\network_server.cpp'

$b = [System.IO.File]::ReadAllBytes($p)
$txt = [System.Text.Encoding]::UTF8.GetString($b)
Write-Output ("file bytes: " + $b.Length)
# Count literal '?' 
$qm = ($txt.ToCharArray() | Where-Object { $_ -eq '?' }).Count
Write-Output ("literal '?' count: " + $qm)
# Count CJK
$cjk = 0
foreach ($ch in $txt.ToCharArray()) { $v=[int]$ch; if ($v -ge 0x4E00 -and $v -le 0x9FFF) { $cjk++ } }
Write-Output ("CJK chars: " + $cjk)
# Does it contain clean ??
Write-Output ("contains 'msg\":\"': " + $txt.Contains('"msg\":\"'))
Write-Output ("contains 'msg\\\":\\\"': " + $txt.Contains('msg\\"'))
# Search for the byte sequence of clean 未登录 (E6 9C AA E7 99 BB E5 BD 95)
$utf8weili = [System.Text.Encoding]::UTF8.GetBytes('未登录')
Write-Output ("utf8 bytes of 未登录: " + (($utf8weili | ForEach-Object { "{0:X2}" -f $_ }) -join ' '))
# find occurrences of E6 9C AA byte run
$cnt = 0
for ($i=0; $i -lt $b.Length-2; $i++){
  if ($b[$i] -eq 0xE6 -and $b[$i+1] -eq 0x9C -and $b[$i+2] -eq 0xAA){ $cnt++ }
}
Write-Output ("occurrences of UTF-8 '未' (E6 9C AA): " + $cnt)
# Find '?' bytes are 0x3F; count 0x3F in file
$qmByte = 0
foreach ($by in $b) { if ($by -eq 0x3F){$qmByte++} }
Write-Output ("byte 0x3F count: " + $qmByte)
