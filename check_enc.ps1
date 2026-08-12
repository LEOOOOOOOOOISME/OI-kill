

$files = @('html_content.h','network_server.cpp','main.cpp','room_manager.cpp','game_engine.cpp','auth.h','socket_util.h')
foreach ($f in $files) {
  $p = 'D:\projects\oi-kill\' + $f
  if (Test-Path $p) {
    $b = [System.IO.File]::ReadAllBytes($p)
    $txt = [System.Text.Encoding]::UTF8.GetString($b)
    $cjk = 0
    foreach ($ch in $txt.ToCharArray()) {
      $v = [int]$ch
      if ($v -ge 0x4E00 -and $v -le 0x9FFF) { $cjk++ }
    }
    Write-Output ($f + " : CJK chars = " + $cjk + " : total bytes = " + $b.Length)
  }
}
