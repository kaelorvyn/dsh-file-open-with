param([string]$State = "$env:TEMP\dfow-window-state.json")
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class HTW {
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
}
'@
$s = New-Object -ComObject Shell.Application
$rows = @()
foreach ($w in $s.Windows()) {
  try {
    $h = [IntPtr]$w.HWND
    $i = $w.Document.FocusedItem
    $rows += [pscustomobject]@{
      url = [string]$w.LocationURL
      selected = if ($i) { [string]$i.Path } else { '' }
      visible = [HTW]::IsWindowVisible($h)
      minimized = [HTW]::IsIconic($h)
    }
  } catch { }
}
[System.IO.File]::WriteAllText($State, (ConvertTo-Json -InputObject @($rows) -Compress), (New-Object System.Text.UTF8Encoding($false)))
Write-Output "wrote $($rows.Count) rows"
