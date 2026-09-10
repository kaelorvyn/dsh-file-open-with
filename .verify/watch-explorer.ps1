# 监听资源管理器窗口：把新出现的窗口（目录 + 选中项）连同时间写进日志，用于判定“点了菜单但没反应”。
$log = Join-Path $env:TEMP 'dfow-explorer-watch.log'
$deadline = (Get-Date).AddMinutes(10)
$seen = @{}
"[$(Get-Date -Format 'HH:mm:ss')] watcher start" | Out-File $log -Encoding utf8
while ((Get-Date) -lt $deadline) {
  try {
    $shell = New-Object -ComObject Shell.Application
    foreach ($window in @($shell.Windows())) {
      try {
        $selected = ''
        $item = $window.Document.FocusedItem
        if ($item) { $selected = [string]$item.Path }
        $key = "$($window.HWND)|$($window.LocationURL)|$selected"
        if (-not $seen.ContainsKey($key)) {
          $seen[$key] = $true
          "[$(Get-Date -Format 'HH:mm:ss')] NEW hwnd=$($window.HWND) url=$($window.LocationURL) selected=$selected" | Out-File $log -Append -Encoding utf8
        }
      } catch { }
    }
  } catch { }
  Start-Sleep -Milliseconds 700
}
"[$(Get-Date -Format 'HH:mm:ss')] watcher end" | Out-File $log -Append -Encoding utf8
