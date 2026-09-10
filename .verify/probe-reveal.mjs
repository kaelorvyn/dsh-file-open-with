/**
 * 干净的 explorer /select 探测：每个变体用全新目录、先关掉测试窗口、用 UTF-8 JSON 读窗口状态，
 * 判定标准 = 出现新窗口且 FocusedItem 就是目标文件（Explorer 会复用已有窗口，必须隔离）。
 */
import { spawn } from 'node:child_process'
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'

const ROOT = 'C:\\Users\\Administrator\\AppData\\Local\\Temp\\dfow-reveal-probe'
const STATE = join(ROOT, 'windows.json')
const USER_FILE = 'C:\\Users\\Administrator\\Documents\\Codex\\obsidian-memory\\05-projects\\project-0029-threeui-kage-landing-page.md'
await rm(ROOT, { recursive: true, force: true })
await mkdir(ROOT, { recursive: true })

const PS = `
$ErrorActionPreference = 'Stop'
$shell = New-Object -ComObject Shell.Application
$rows = @()
foreach ($w in $shell.Windows()) {
  try {
    $item = $w.Document.FocusedItem
    $rows += [pscustomobject]@{ url = [string]$w.LocationURL; selected = if ($item) { [string]$item.Path } else { '' } }
  } catch { }
}
$json = ConvertTo-Json -InputObject @($rows) -Compress
[System.IO.File]::WriteAllText('${STATE.replace(/\\/g, '\\\\')}', $json, (New-Object System.Text.UTF8Encoding($false)))
`

function runPowerShell(script) {
  return new Promise((resolve) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, stdio: 'ignore' })
    child.on('close', () => resolve())
    child.on('error', () => resolve())
  })
}

async function snapshot() {
  await runPowerShell(PS)
  const raw = await readFile(STATE, 'utf8').catch(() => '[]')
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : [parsed]
  } catch {
    return []
  }
}

async function closeProbeWindows() {
  await runPowerShell(`$s = New-Object -ComObject Shell.Application; foreach ($w in @($s.Windows())) { try { if ([string]$w.LocationURL -like '*dfow-reveal-probe*') { $w.Quit() } } catch { } }`)
  await new Promise((resolve) => setTimeout(resolve, 600))
}

function launch(args, options = { detached: true, stdio: 'ignore', windowsHide: true }) {
  return new Promise((resolve) => {
    const child = spawn('explorer.exe', args, options)
    child.once('error', (error) => resolve(`error: ${error.message}`))
    child.once('spawn', () => { child.unref(); resolve('ok') })
  })
}

let counter = 0
async function trial(label, makeArgs, withSpaces) {
  counter += 1
  const dir = join(ROOT, `case${counter}${withSpaces ? ' with space' : ''}`)
  await mkdir(dir, { recursive: true })
  const file = join(dir, withSpaces ? 'my file.txt' : 'my-file.txt')
  await writeFile(file, 'x', 'utf8')
  await closeProbeWindows()
  const before = (await snapshot()).length
  const started = await launch(makeArgs(file))
  await new Promise((resolve) => setTimeout(resolve, 4000))
  const windows = await snapshot()
  const added = windows.slice(before)
  const selected = added.some((entry) => entry.selected.toLowerCase() === file.toLowerCase())
  const opened = added.length > 0
  console.log(`${selected ? 'PASS' : opened ? 'PART' : 'FAIL'}  ${label}  launch=${started}  新窗口=${added.length}  选中目标=${selected}`)
  if (opened && !selected) console.log(`      实际选中：${JSON.stringify(added.map((entry) => entry.selected))}`)
  return selected
}

const results = {}
results['A 单参数 /select,<无空格>'] = await trial('A 单参数 /select,<无空格>', (file) => [`/select,${file}`], false)
results['B 单参数 /select,<有空格>'] = await trial('B 单参数 /select,<有空格>', (file) => [`/select,${file}`], true)
results['C 两参数 /select, + <无空格>'] = await trial('C 两参数 /select, + <无空格>', (file) => ['/select,', file], false)
results['D 两参数 /select, + <有空格>'] = await trial('D 两参数 /select, + <有空格>', (file) => ['/select,', file], true)
results['E 真实长路径 单参数'] = await trial('E 真实长路径 单参数', () => ['/select,' + USER_FILE], false)
results['F 真实长路径 两参数'] = await trial('F 真实长路径 两参数', () => ['/select,', USER_FILE], false)

await closeProbeWindows()
console.log('\n汇总：')
for (const [name, ok] of Object.entries(results)) console.log(`  ${ok ? '✓' : '✗'} ${name}`)
