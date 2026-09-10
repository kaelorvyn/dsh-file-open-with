# 关闭测试用资源管理器窗口：按 URL 关键字匹配，避免影响用户自己的窗口。
param([string]$Match = 'dfow')
$s = New-Object -ComObject Shell.Application
foreach ($w in @($s.Windows())) {
  try {
    if ([string]$w.LocationURL -like "*$Match*") { $w.Quit() }
  } catch { }
}
Start-Sleep -Milliseconds 600
