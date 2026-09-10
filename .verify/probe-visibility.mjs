/**
 * 判定 reveal 窗口的**可见性**：同一路径下对比 windowsHide 开关，
 * 同时读「是否最小化 / WS_VISIBLE / 选中项」。
 */
import { spawn } from 'node:child_process'
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const DIR = join(tmpdir(), 'dfow visible probe')
const FILE = join(DIR, 'target file.txt')
const STATE = join(tmpdir(), 'dfow-visible-state.json')
await mkdir(DIR, { recursive: true })
await writeFile(FILE, 'x', 'utf8')

const PS = `
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class PW {
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowPlacement(IntPtr h, ref PLACEMENT p);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct PLACEMENT { public int length, flags, showCmd; public POINT min, max; public RECT normal; }
}
'@
$s = New-Object -ComObject Shell.Application
$rows = @()
foreach ($w in $s.Windows()) {
  try {
    $h = [IntPtr]$w.HWND
    $p = New-Object PW+PLACEMENT
    $p.length = [System.Runtime.InteropServices.Marshal]::SizeOf($p)
    $null = [PW]::GetWindowPlacement($h, [ref]$p)
    $item = $w.Document.FocusedItem
    $rows += [pscustomobject]@{
      url = [string]$w.LocationURL
      selected = if ($item) { [string]$item.Path } else { '' }
      visible = [PW]::IsWindowVisible($h)
      minimized = [PW]::IsIconic($h)
      showCmd = $p.showCmd
    }
  } catch { }
}
[System.IO.File]::WriteAllText('__STATE__', (ConvertTo-Json -InputObject @($rows) -Compress), (New-Object System.Text.UTF8Encoding($false)))
`.replace('__STATE__', STATE.replace(/\\/g, '\\\\'))

function runPs() {
  return new Promise((resolve) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PS], { windowsHide: true, stdio: 'ignore' })
    child.on('close', resolve)
    child.on('error', resolve)
  })
}

const CLOSE = "$s = New-Object -ComObject Shell.Application; foreach ($w in @($s.Windows())) { try { if ([string]$w.LocationURL -like '*dfow*visible*probe*') { $w.Quit() } } catch { } }"
function closeWindows() {
  return new Promise((resolve) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', CLOSE], { windowsHide: true, stdio: 'ignore' })
    child.on('close', () => setTimeout(resolve, 800))
    child.on('error', resolve)
  })
}

async function snapshot() {
  await runPs()
  const raw = await readFile(STATE, 'utf8').catch(() => '[]')
  try {
    const parsed = JSON.parse(raw)
    return (Array.isArray(parsed) ? parsed : [parsed]).filter((entry) => String(entry.url).includes('dfow'))
  } catch {
    return []
  }
}

async function trial(label, options) {
  await closeWindows()
  await new Promise((resolve) => {
    const child = spawn('explorer.exe', ['/select,', FILE], options)
    child.once('error', () => resolve())
    child.once('spawn', () => { child.unref(); resolve() })
  })
  await new Promise((resolve) => setTimeout(resolve, 3000))
  const windows = await snapshot()
  const hit = windows.find((entry) => entry.selected.toLowerCase() === FILE.toLowerCase())
  console.log(`${hit?.visible && !hit?.minimized ? 'PASS' : 'FAIL'}  ${label} — ${hit === undefined
    ? '（没有对应窗口）'
    : `visible=${hit.visible} minimized=${hit.minimized} showCmd=${hit.showCmd}`}`)
}

await trial('windowsHide: true（当前实现）', { detached: true, stdio: 'ignore', windowsHide: true })
await trial('windowsHide: false', { detached: true, stdio: 'ignore', windowsHide: false })
await trial('windowsHide: false + 不 detached', { stdio: 'ignore', windowsHide: false })

await closeWindows()
await rm(DIR, { recursive: true, force: true }).catch(() => {})
