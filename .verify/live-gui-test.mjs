/**
 * 真实宿主端到端验证：在隔离 DSH_HOME 里真启动一个 profile（bundles 挂载本插件），
 * 用无头浏览器打开它自己的 Web GUI，注入一个符合聊天 DOM 契约的文件 chip，
 * 用真实右键/悬停驱动**平台自带**的 primitives Menu，断言菜单与宿主路由。
 */
import { readFile, mkdir, writeFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { request as httpRequest } from 'node:http'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SOURCE_DIR = 'C:\\Users\\Administrator\\.dsh\\plugins-src\\dsh-file-open-with'
const SHOTS = join(SOURCE_DIR, '.verify', 'shots')
const HOST_LOG = join(process.env.TEMP ?? '.', 'dfow-verify-host.log')

const require_ = createRequire('C:/Users/Administrator/.dsh/profiles/desktop/')
const puppeteer = require_('puppeteer-core')

const results = []
function check(name, ok, detail) {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : ` — ${detail}`}`)
}

const log = await readFile(HOST_LOG, 'utf8').catch(() => '')
const url = /(http:\/\/127\.0\.0\.1:\d+\/\?token=\S+)/.exec(log)?.[1]
if (url === undefined) {
  console.log(`FAIL  未能从宿主日志解析出 GUI URL：${HOST_LOG}`)
  process.exit(1)
}
console.log(`verify host: ${url.replace(/token=.*/, 'token=***')}`)

const TARGET = join(tmpdir(), 'dfow live gui', '带空格 目标文件.txt')
const TOOL_TARGET = join(tmpdir(), 'dfow live gui', 'tool row 目标文件.md')
const TOOL_TARGET_TEXT = TOOL_TARGET
const WINDOW_STATE = join(tmpdir(), 'dfow-live-gui-windows.json')
await mkdir(join(tmpdir(), 'dfow live gui'), { recursive: true })
await mkdir(SHOTS, { recursive: true })
await writeFile(TARGET, 'dsh-file-open-with 验证文件\n', 'utf8')
await writeFile(TOOL_TARGET, '工具行右键验证文件\n', 'utf8')

/** Shell.Application + Win32 读取已打开的资源管理器窗口（含可见性）：调独立脚本，避免内联 here-string 的坑。 */
function runPowerShell(script, args) {
  return new Promise((resolve) => {
    const child = spawn('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, ...(args ?? [])],
      { windowsHide: true, stdio: 'ignore' })
    child.on('close', () => setTimeout(resolve, 400))
    child.on('error', () => resolve())
  })
}
const SNAPSHOT_SCRIPT = join(SOURCE_DIR, '.verify', 'snapshot-windows.ps1')
const CLOSE_SCRIPT = join(SOURCE_DIR, '.verify', 'close-windows.ps1')
async function windowEntries() {
  await runPowerShell(SNAPSHOT_SCRIPT, ['-State', WINDOW_STATE])
  const raw = await readFile(WINDOW_STATE, 'utf8').catch(() => '[]')
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : [parsed]
  } catch {
    return []
  }
}
async function selectedPaths() {
  return (await windowEntries()).map((entry) => entry.selected)
}
await runPowerShell(CLOSE_SCRIPT, ['-Match', 'dfow'])

const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true,
  args: ['--no-sandbox', '--disable-gpu'],
  defaultViewport: { width: 1280, height: 800 },
})
try {
  const page = await browser.newPage()
  // 真实宿主的源是 http://127.0.0.1:3099 —— 读剪贴板要显式授权
  await browser.defaultBrowserContext().overridePermissions(new URL(url).origin, ['clipboard-read', 'clipboard-write'])
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error.message)))
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 })
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 1500)))

  const html = await page.content()
  check('真实宿主 boot 清单包含本插件客户端模块', html.includes('dsh-file-open-with'))
  check('客户端半部已 apply（样式标记存在）',
    (await page.evaluate(() => document.querySelector('style[data-plugin-css="dsh-file-open-with"]') !== null)))
  check('客户端 bundle 未污染全局（无未捕获异常）', errors.length === 0, errors.join(' | '))

  const apps = await page.evaluate(async () => {
    const response = await fetch('/plugins/file-open-with/apps')
    return { status: response.status, body: await response.json() }
  })
  check('真实宿主挂载了插件前缀路由（GET /apps 200）', apps.status === 200, JSON.stringify(apps.body))
  check('真实宿主解析出三个应用且都可用',
    apps.body?.apps?.length === 3 && apps.body.apps.every((entry) => entry.available === true),
    apps.body?.apps?.map((entry) => `${entry.id}=${entry.available}`).join(' '))

  // 浏览器不允许页面伪造 Origin，所以栅栏用 Node 原生请求打真实宿主。
  const rawHost = async (headers) => new Promise((resolve) => {
    const target = new URL(url)
    const req = httpRequest({ host: '127.0.0.1', port: target.port, path: '/plugins/file-open-with/apps', method: 'GET', headers }, (res) => {
      res.resume()
      resolve(res.statusCode)
    })
    req.on('error', () => resolve(0))
    req.end()
  })
  const port = new URL(url).port
  check('真实宿主上异源 Origin 被拒（403）', (await rawHost({ host: `127.0.0.1:${port}`, origin: 'https://evil.example.com' })) === 403)
  check('真实宿主上 cross-site 被拒（403）', (await rawHost({ host: `127.0.0.1:${port}`, 'sec-fetch-site': 'cross-site' })) === 403)
  check('真实宿主上非 loopback Host 被拒（403）', (await rawHost({ host: 'evil.example.com' })) === 403)
  check('真实宿主上同源请求放行（200）', (await rawHost({ host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}` })) === 200)

  const anchor = await page.evaluate((targetPath, toolText) => {
    const host = document.createElement('div')
    host.id = 'dfow-probe'
    host.setAttribute('data-produced-files-row', '')
    host.style.cssText = 'position:fixed;left:60px;top:140px;z-index:99999;display:flex;gap:8px;padding:8px;background:var(--dsw-alias-bg-layer-2,#fff);border:1px solid #cbd5e1;border-radius:8px'
    host.textContent = '右键菜单验证：'
    const chip = document.createElement('button')
    chip.type = 'button'
    chip.className = 'gemp6G_file'
    chip.textContent = targetPath.slice(targetPath.lastIndexOf('\\') + 1)
    chip.setAttribute('title', targetPath)
    chip.style.cssText = 'border:1px solid #cbd5e1;border-radius:6px;padding:2px 8px;cursor:pointer'
    host.appendChild(chip)

    // 工具行（读取/编辑）文件链接：没有 title，路径就是按钮文本
    const toolRow = document.createElement('div')
    toolRow.id = 'dfow-tool-row'
    toolRow.setAttribute('data-tool', 'edit')
    toolRow.setAttribute('data-variant', 'edit')
    toolRow.setAttribute('data-state', 'ok')
    toolRow.style.cssText = 'position:fixed;left:60px;top:180px;z-index:99999;font-size:13px'
    toolRow.textContent = '编辑 · '
    const toolLink = document.createElement('button')
    toolLink.type = 'button'
    toolLink.className = 'WXmFEW_fileLink'
    toolLink.textContent = toolText
    toolLink.style.cssText = 'border:0;background:none;color:#2563eb;text-decoration:underline;cursor:pointer'
    toolRow.appendChild(toolLink)

    const plain = document.createElement('p')
    plain.id = 'dfow-plain'
    plain.textContent = '这是普通段落：右键应保留原生菜单'
    plain.style.cssText = 'position:fixed;left:60px;top:230px'

    // 正文里的网页链接（和官方 renderSafeLink 渲染出来的一样：a[href^=http]）
    const linkParagraph = document.createElement('p')
    linkParagraph.id = 'dfow-link-row'
    linkParagraph.style.cssText = 'position:fixed;left:60px;top:270px;z-index:99999'
    const link = document.createElement('a')
    link.id = 'dfow-link'
    link.href = 'http://127.0.0.1:3099/'
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
    link.textContent = 'http://127.0.0.1:3099/'
    linkParagraph.appendChild(link)

    document.body.append(host, toolRow, plain, linkParagraph)
    const rect = chip.getBoundingClientRect()
    const toolRect = toolLink.getBoundingClientRect()
    const linkRect = link.getBoundingClientRect()
    return {
      x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2),
      toolX: Math.round(toolRect.left + toolRect.width / 2), toolY: Math.round(toolRect.top + toolRect.height / 2),
      linkX: Math.round(linkRect.left + linkRect.width / 2), linkY: Math.round(linkRect.top + linkRect.height / 2),
    }
  }, TARGET, TOOL_TARGET_TEXT)

  await page.mouse.click(anchor.x, anchor.y, { button: 'right' })
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 250)))
  const menuLabels = await page.evaluate(() => Array.from(document.querySelectorAll('button[role="menuitem"]'))
    .map((item) => item.querySelector('span:not([class*="itemIcon"])')?.textContent ?? item.textContent))
  check('真实右键弹出平台 Menu，条目与顺序正确',
    JSON.stringify(menuLabels) === JSON.stringify(['打开文件', '在资源管理器中打开', '打开方式', '另存为', '复制路径', '复制文件内容']),
    JSON.stringify(menuLabels))
  check('菜单里有分隔线', (await page.evaluate(() => document.querySelectorAll('[role="separator"]').length)) >= 1)
  const menuIconCount = await page.evaluate(() => document.querySelectorAll('button[role="menuitem"] svg').length)
  check('真实菜单每一项都带平台图标（svg）', menuIconCount >= 6, `svg=${menuIconCount}`)
  await page.screenshot({ path: join(SHOTS, 'real-menu.png') })

  // 悬停打开方式 → 真实子菜单
  const submenuLabels = await page.evaluate(async () => {
    const item = Array.from(document.querySelectorAll('button[role="menuitem"]'))
      .find((entry) => entry.textContent === '打开方式')
    item.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    item.parentElement.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }))
    item.parentElement.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    item.dispatchEvent(new MouseEvent('focus', { bubbles: false }))
    await new Promise((resolve) => setTimeout(resolve, 300))
    return Array.from(document.querySelectorAll('[role="menu"] [role="menu"] button[role="menuitem"]'))
      .map((entry) => ({ label: entry.textContent, disabled: entry.disabled }))
  })
  check('「打开方式」子菜单是真实应用三项且未置灰',
    JSON.stringify(submenuLabels) === JSON.stringify([
      { label: 'Visual Studio', disabled: false }, { label: '终端', disabled: false }, { label: 'IntelliJ IDEA', disabled: false },
    ]), JSON.stringify(submenuLabels))
  const submenuAppIcons = await page.evaluate(() => Array.from(document.querySelectorAll('[role="menu"] [role="menu"] button[role="menuitem"] img'))
    .map((img) => img.getAttribute('src') ?? ''))
  check('真实子菜单显示各应用自己的图标（宿主从 exe 抽出）',
    submenuAppIcons.length === 3 && submenuAppIcons.every((src) => src.startsWith('data:image/png;base64,')),
    JSON.stringify(submenuAppIcons.map((src) => src.length)))
  await page.screenshot({ path: join(SHOTS, 'real-submenu.png') })

  // 真实点击「复制路径」→ 剪贴板 + 提示
  const copied = await page.evaluate(async () => {
    const item = Array.from(document.querySelectorAll('button[role="menuitem"]'))
      .find((entry) => entry.textContent === '复制路径')
    item.click()
    await new Promise((resolve) => setTimeout(resolve, 300))
    return document.querySelector('.dfow-notice')?.textContent ?? null
  })
  check('点击「复制路径」给出反馈提示', copied === '已复制路径', String(copied))
  await page.screenshot({ path: join(SHOTS, 'real-notice.png') })
  check('选择后菜单关闭', (await page.evaluate(() => document.querySelectorAll('button[role="menuitem"]').length)) === 0)

  // 工具行文件链接（无 title，路径来自按钮文本）也要能弹菜单
  await page.mouse.click(anchor.toolX, anchor.toolY, { button: 'right' })
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 250)))
  const toolMenu = await page.evaluate(() => Array.from(document.querySelectorAll('button[role="menuitem"]')).map((item) => item.textContent))
  check('工具行文件链接右键弹出同一菜单', toolMenu.length === 6 && toolMenu[0] === '打开文件', JSON.stringify(toolMenu))

  // 「在资源管理器中打开」在带空格路径上必须真的选中（回归）
  const revealClick = await page.evaluate(async () => {
    const item = Array.from(document.querySelectorAll('button[role="menuitem"]'))
      .find((entry) => entry.textContent === '在资源管理器中打开')
    if (item === undefined) return { clicked: false }
    item.click()
    await new Promise((resolve) => setTimeout(resolve, 400))
    return { clicked: true, notice: document.querySelector('.dfow-notice')?.textContent ?? null }
  })
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 3500)))
  const revealEntries = await windowEntries()
  const revealHit = revealEntries.find((entry) => entry.selected.toLowerCase() === TOOL_TARGET.toLowerCase())
  check('真实宿主上「在资源管理器中打开」选中带空格路径的文件',
    revealClick.clicked === true && revealHit !== undefined,
    `${JSON.stringify(revealClick)} → ${JSON.stringify(revealEntries.map((entry) => entry.selected))}`)
  check('真实宿主上该窗口可见且未最小化（windowsHide 必须为 false）',
    revealHit !== undefined && revealHit.visible === true && revealHit.minimized === false,
    revealHit === undefined ? '没有对应窗口' : `visible=${revealHit.visible} minimized=${revealHit.minimized}`)

  // 普通区域右键不接管
  const plainResult = await page.evaluate(() => {
    const target = document.getElementById('dfow-plain')
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    target.dispatchEvent(event)
    return event.defaultPrevented
  })
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 200)))
  check('普通段落右键不接管、不弹插件菜单',
    plainResult === false && (await page.evaluate(() => document.querySelectorAll('button[role="menuitem"]').length)) === 0)

  // Escape 关闭（真实 Menu 自带）
  await page.mouse.click(anchor.x, anchor.y, { button: 'right' })
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 250)))
  const beforeEscape = await page.evaluate(() => document.querySelectorAll('button[role="menuitem"]').length)
  await page.keyboard.press('Escape')
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 250)))
  const afterEscape = await page.evaluate(() => document.querySelectorAll('button[role="menuitem"]').length)
  check('Escape 关闭菜单', beforeEscape > 0 && afterEscape === 0, `${beforeEscape} → ${afterEscape}`)

  // ---------- 网页链接：真实宿主上右键 → 三项菜单 → 真的打开 ----------
  await page.mouse.click(anchor.linkX, anchor.linkY, { button: 'right' })
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 250)))
  const linkLabels = await page.evaluate(() => Array.from(document.querySelectorAll('button[role="menuitem"]'))
    .map((item) => item.querySelector('span:not([class*="itemIcon"])')?.textContent ?? item.textContent))
  check('真实宿主上链接右键弹出三项菜单',
    JSON.stringify(linkLabels) === JSON.stringify(['打开网页', '在外部浏览器中打开', '复制链接']), JSON.stringify(linkLabels))
  const linkIcons = await page.evaluate(() => document.querySelectorAll('button[role="menuitem"] svg').length)
  check('链接菜单三项都带平台图标（svg）', linkIcons === 3, `svg=${linkIcons}`)
  await page.screenshot({ path: join(SHOTS, 'real-link-menu.png') })

  const copyLink = await page.evaluate(async () => {
    const item = Array.from(document.querySelectorAll('button[role="menuitem"]')).find((entry) => entry.textContent === '复制链接')
    if (item === undefined) return { clicked: false }
    item.click()
    await new Promise((resolve) => setTimeout(resolve, 300))
    return { clicked: true, notice: document.querySelector('.dfow-notice')?.textContent ?? null, clipboard: await navigator.clipboard.readText() }
  })
  check('「复制链接」写入剪贴板并提示',
    copyLink.clipboard === 'http://127.0.0.1:3099/' && copyLink.notice === '已复制链接', JSON.stringify(copyLink))

  await page.mouse.click(anchor.linkX, anchor.linkY, { button: 'right' })
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 250)))
  const openWeb = await page.evaluate(async () => {
    const item = Array.from(document.querySelectorAll('button[role="menuitem"]')).find((entry) => entry.textContent === '打开网页')
    if (item === undefined) return { clicked: false }
    item.click()
    await new Promise((resolve) => setTimeout(resolve, 2500))
    return { clicked: true, notice: document.querySelector('.dfow-notice')?.textContent ?? null }
  })
  check('真实宿主上「打开网页」走内置网页视图（宿主装了 dsh-builtin-browser）',
    openWeb.notice === '已在网页中打开', JSON.stringify(openWeb))

  check('全程无页面异常', errors.length === 0, errors.join(' | '))
  await page.evaluate(() => {
    document.getElementById('dfow-probe')?.remove()
    document.getElementById('dfow-tool-row')?.remove()
    document.getElementById('dfow-plain')?.remove()
    document.getElementById('dfow-link-row')?.remove()
  })
} finally {
  await browser.close()
  await runPowerShell(CLOSE_SCRIPT, ['-Match', 'dfow'])
  await rm(join(tmpdir(), 'dfow live gui'), { recursive: true, force: true }).catch(() => {})
}

const failed = results.filter((entry) => !entry.ok)
console.log(`\n${results.length - failed.length}/${results.length} 项通过`)
process.exit(failed.length === 0 ? 0 : 1)
