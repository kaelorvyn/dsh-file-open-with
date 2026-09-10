/**
 * 针对**正在运行的** DSH 宿主（43120）验证 reveal 修复是否已生效：
 * 带空格路径 → 是否真的弹出资源管理器并选中（Shell.Application 判定）。
 * 同时检查客户端 bundle 是否随页面刷新更新（含 fileLink 文本选择器）。
 */
import { spawn } from 'node:child_process'
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const HOST = 'http://127.0.0.1:43120'
const ARG_PATH = process.argv[2]
const DIR = join(tmpdir(), 'dfow live probe with space')
const FILE = ARG_PATH ?? join(DIR, 'live probe file.txt')
const STATE = join(tmpdir(), 'dfow-live-windows.json')

await mkdir(DIR, { recursive: true })
if (ARG_PATH === undefined) await writeFile(FILE, 'x', 'utf8')
console.log(`探测目标：${FILE}`)

function runPs(script) {
  return new Promise((resolve) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, stdio: 'ignore' })
    child.on('close', () => setTimeout(resolve, 500))
    child.on('error', () => resolve())
  })
}

const snapshotScript = `$s = New-Object -ComObject Shell.Application; $rows = @(); foreach ($w in $s.Windows()) { try { $i = $w.Document.FocusedItem; $rows += [pscustomobject]@{ selected = if ($i) { [string]$i.Path } else { '' } } } catch { } }; [System.IO.File]::WriteAllText('${STATE.replace(/\\/g, '\\\\')}', (ConvertTo-Json -InputObject @($rows) -Compress), (New-Object System.Text.UTF8Encoding($false)))`
const closeScript = "$s = New-Object -ComObject Shell.Application; foreach ($w in @($s.Windows())) { try { if ([string]$w.LocationURL -like '*dfow*live*probe*') { $w.Quit() } } catch { } }"

async function snapshot() {
  await runPs(snapshotScript)
  const raw = await readFile(STATE, 'utf8').catch(() => '[]')
  try {
    const parsed = JSON.parse(raw)
    return (Array.isArray(parsed) ? parsed : [parsed]).map((entry) => entry.selected)
  } catch {
    return []
  }
}

await runPs(closeScript)
const response = await fetch(`${HOST}/plugins/file-open-with/reveal`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ path: FILE }),
})
const body = await response.json().catch(() => null)
await new Promise((resolve) => setTimeout(resolve, 3500))
const selected = await snapshot()
const hit = selected.some((entry) => entry.toLowerCase() === FILE.toLowerCase())
console.log(`live reveal: status=${response.status} body=${JSON.stringify(body)}`)
console.log(`${hit ? 'PASS' : 'FAIL'}  运行中的宿主已生效（资源管理器选中带空格文件）`)
if (!hit) console.log(`      当前窗口选中项：${JSON.stringify(selected)}`)

const client = await (await fetch(`${HOST}/modules/dsh-file-open-with`).catch(() => ({ ok: false, status: 0, text: async () => '' }))).text?.().catch?.(() => '') ?? ''
const hasTextSelector = client.includes('fileLink')
console.log(`客户端 bundle（/modules/dsh-file-open-with）：长度=${client.length} 含 fileLink 选择器=${hasTextSelector}`)

await runPs(closeScript)
await rm(DIR, { recursive: true, force: true }).catch(() => {})
