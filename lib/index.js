/**
 * dsh-file-open-with — 宿主半部。
 *
 * 为浏览器半部的文件右键菜单提供四条本机能力：在资源管理器中定位文件、
 * 用指定应用打开、另存为（下载流）、读取文本内容。全部动作挂在 loopback
 * 前缀路由后面，并由本模块自己做 Host / Origin 栅栏（DSH 不为插件路由
 * 提供鉴权，这是防 DNS-rebinding / 跨站的最低要求）。
 *
 * 设计约束：只 spawn 固定可执行文件，文件路径是唯一变量且始终作为 argv
 * 元素传递——没有 shell 字符串，也就没有注入面。
 */
import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readdir, readFile, mkdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve as resolvePath } from 'node:path'

/** 运行时插件 id（也是路由前缀的语义来源）。 */
export const name = 'file-open-with'

/** 只声明真正必需的宿主服务；任何可选协作者都用 ctx.get 读取。 */
export const inject = ['webServer', 'sessions']

const ROUTE_PREFIX = '/plugins/file-open-with'
const MAX_BODY_BYTES = 8 * 1024
const MAX_TEXT_BYTES = 1024 * 1024
const IS_WIN = process.platform === 'win32'
const PROGRAM_FILES = [
  process.env['ProgramFiles'] ?? 'C:\\Program Files',
  process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
]

//#region 通用工具

function json(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function headerOf(req, name) {
  const value = req.headers?.[name]
  return Array.isArray(value) ? value[0] : value
}

/** 规范化 host / hostname 比较用的裸主机名。 */
function bareHost(authority) {
  const host = String(authority ?? '').split(':')[0]
  return host.replace(/^\[/, '').replace(/\]$/, '')
}

function isLoopbackHost(authority) {
  const hostname = bareHost(authority)
  if (hostname === 'localhost' || hostname === '::1') return true
  const parts = hostname.split('.')
  if (parts.length !== 4 || parts[0] !== '127') return false
  return parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

/**
 * 与本机 GUI 同源的请求才处理：Host 必须 loopback，跨站来源直接拒绝。
 * 这是与 /api 网关栅栏等价的防线，不是身份认证。
 */
function isTrustedRequest(req) {
  const host = headerOf(req, 'host')
  if (!isLoopbackHost(host)) return false
  if (String(headerOf(req, 'sec-fetch-site') ?? '') === 'cross-site') return false
  const origin = headerOf(req, 'origin')
  if (origin === undefined || origin === '') return true
  try {
    return bareHost(new URL(origin).host) === bareHost(host)
  } catch {
    return false
  }
}

async function readJsonBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_BODY_BYTES) return { error: 'bad-body' }
    chunks.push(buffer)
  }
  if (size === 0) return { value: {} }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return { error: 'bad-body' }
    return { value: parsed }
  } catch {
    return { error: 'bad-body' }
  }
}

/**
 * 以 argv 数组启动固定可执行文件；成功以 spawn 事件为准，立刻不再持有句柄。
 *
 * `windowsHide` 必须显式给 false：Node 默认 true，它会设置子进程的启动显示状态为隐藏，
 * Explorer / Windows Terminal 这类「把窗口交给系统 shell 代建」的程序会照着建出**不可见**
 * 窗口（`IsWindowVisible=false`），用户看到的就是「点了菜单什么都没发生」。实测同一路径：
 * windowsHide:true → visible=false；false → visible=true 且未最小化。
 */
function launch(command, args) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: false })
    } catch (error) {
      resolve({ ok: false, message: String(error?.message ?? error) })
      return
    }
    child.once('error', (error) => { resolve({ ok: false, message: String(error?.message ?? error) }) })
    child.once('spawn', () => { child.unref(); resolve({ ok: true }) })
  })
}

//#endregion

//#region 路径解析

/** Windows 绝对路径：盘符根或 UNC 共享；盘符相对（C:foo）不算绝对。 */
function isAbsoluteWindows(value) {
  return /^[a-zA-Z]:[\\/]/.test(value) || /^\\\\/.test(value)
}

function cwdOf(ctx, sessionId) {
  if (typeof sessionId !== 'string' || sessionId === '') return undefined
  const cwd = ctx.sessions?.get?.(sessionId)?.header?.cwd
  return typeof cwd === 'string' && cwd !== '' ? cwd : undefined
}

/**
 * 把菜单传来的路径解析成绝对路径：绝对路径原样使用，相对路径按会话 cwd
 * 拼接；无法安全解析时返回错误码（不猜、不落到 process.cwd）。
 */
function resolveTarget(ctx, rawPath, sessionId) {
  if (typeof rawPath !== 'string') return { error: 'bad-path' }
  const raw = rawPath.trim()
  if (raw === '') return { error: 'bad-path' }
  const absolute = IS_WIN ? isAbsoluteWindows(raw) : isAbsolute(raw)
  if (absolute) return { path: resolvePath(raw) }
  if (IS_WIN && /^[a-zA-Z]:/.test(raw)) return { error: 'bad-path' }
  const cwd = cwdOf(ctx, sessionId)
  if (cwd === undefined) return { error: 'bad-path' }
  return { path: resolvePath(join(cwd, raw)) }
}

/** 解析 + 存在性校验：目录在 /reveal 下合法，在其它动作下由调用方再判类型。 */
async function resolveExisting(ctx, rawPath, sessionId) {
  const target = resolveTarget(ctx, rawPath, sessionId)
  if (target.error !== undefined) return target
  try {
    const info = await stat(target.path)
    return { path: target.path, stats: info }
  } catch {
    return { error: 'not-found' }
  }
}

//#endregion

//#region 应用解析（只认真正存在的可执行文件）

async function isUsableFile(path, minSize = 1) {
  try {
    const info = await stat(path)
    return info.isFile() && info.size >= minSize
  } catch {
    return false
  }
}

/** 无 shell 的命令捕获；失败一律返回空串（解析失败就走下一个候选）。 */
function runCapture(file, args) {
  return new Promise((resolve) => {
    execFile(file, args, { encoding: 'utf8', windowsHide: true, timeout: 5000 }, (error, stdout) => {
      resolve(error === null ? String(stdout) : '')
    })
  })
}

/** where.exe 的第一条真实文件（跳过 0 字节的 App Execution Alias）。 */
async function firstExistingFromWhere(alias) {
  const output = await runCapture('where.exe', [alias])
  for (const line of output.split(/\r?\n/)) {
    const candidate = line.trim()
    if (candidate !== '' && await isUsableFile(candidate)) return candidate
  }
  return undefined
}

async function dirEntries(root) {
  try {
    return await readdir(root, { withFileTypes: true })
  } catch {
    return []
  }
}

/** Visual Studio：Program Files\Microsoft Visual Studio\<版本>\<版本档>\Common7\IDE\devenv.exe（不在 PATH）。 */
async function resolveVisualStudio() {
  for (const root of PROGRAM_FILES) {
    const vsRoot = join(root, 'Microsoft Visual Studio')
    for (const version of await dirEntries(vsRoot)) {
      if (!version.isDirectory()) continue
      for (const edition of await dirEntries(join(vsRoot, version.name))) {
        if (!edition.isDirectory()) continue
        const exe = join(vsRoot, version.name, edition.name, 'Common7', 'IDE', 'devenv.exe')
        if (await isUsableFile(exe)) return exe
      }
    }
  }
  return undefined
}

/** Windows Terminal：注册表 App Paths → where.exe → WindowsApps 实体目录。 */
async function resolveTerminal() {
  const query = await runCapture('reg.exe', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\wt.exe', '/ve'])
  const registered = /REG_SZ\s+(.+)$/m.exec(query)?.[1]?.trim().replace(/^"|"$/g, '')
  if (registered !== undefined && await isUsableFile(registered)) return registered
  const fromWhere = await firstExistingFromWhere('wt')
  if (fromWhere !== undefined) return fromWhere
  const windowsApps = 'C:\\Program Files\\WindowsApps'
  for (const entry of await dirEntries(windowsApps)) {
    if (!/^Microsoft\.WindowsTerminal_/i.test(entry.name)) continue
    const exe = join(windowsApps, entry.name, 'wt.exe')
    if (await isUsableFile(exe)) return exe
  }
  return undefined
}

/** IntelliJ IDEA：PATH → Program Files\JetBrains\IntelliJ IDEA*\bin\idea64.exe。 */
async function resolveIdea() {
  const fromWhere = await firstExistingFromWhere('idea64')
  if (fromWhere !== undefined) return fromWhere
  for (const root of PROGRAM_FILES) {
    const jetbrains = join(root, 'JetBrains')
    for (const entry of await dirEntries(jetbrains)) {
      if (!entry.isDirectory() || !/^IntelliJ IDEA/i.test(entry.name)) continue
      const exe = join(jetbrains, entry.name, 'bin', 'idea64.exe')
      if (await isUsableFile(exe)) return exe
    }
  }
  return undefined
}

/** Microsoft Edge：用户指定的外部浏览器，装在 Program Files / Program Files (x86)。 */
async function resolveEdge() {
  for (const root of PROGRAM_FILES) {
    const exe = join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
    if (await isUsableFile(exe)) return exe
  }
  return undefined
}

/** 「打开方式」目标表：id 与浏览器半部的标签对应，参数只由文件路径派生。 */
const APP_SPECS = [
  { id: 'visualstudio', resolve: resolveVisualStudio, args: (path) => [path] },
  { id: 'terminal', resolve: resolveTerminal, args: (path) => ['-d', dirname(path)] },
  { id: 'idea', resolve: resolveIdea, args: (path) => [path] },
]

let appCache

/**
 * 抽出 exe 的真实图标并缓存成 data URL——「打开方式」子菜单要显示各应用自己的图标。
 * 用 System.Drawing 抽一次后落盘缓存（键含 exe 路径，换版本自动失效），
 * 之后每次启动只读 PNG，不再起 PowerShell。抽不到就返回 undefined（菜单退回通用图标）。
 */
async function appIcon(exe, id) {
  if (exe === undefined) return undefined
  const cacheFile = join(tmpdir(), 'dsh-file-open-with-icons', `${id}-${createHash('sha1').update(exe).digest('hex').slice(0, 16)}.png`)
  try {
    return `data:image/png;base64,${(await readFile(cacheFile)).toString('base64')}`
  } catch (error) {
    // 缓存不存在，继续抽
  }
  const script = [
    'Add-Type -AssemblyName System.Drawing',
    `$icon = [System.Drawing.Icon]::ExtractAssociatedIcon(${psQuote(exe)})`,
    'if ($icon -eq $null) { exit 2 }',
    '$bitmap = $icon.ToBitmap()',
    `$bitmap.Save(${psQuote(cacheFile)}, [System.Drawing.Imaging.ImageFormat]::Png)`,
    '$bitmap.Dispose(); $icon.Dispose()',
  ].join('; ')
  await mkdir(dirname(cacheFile), { recursive: true })
  await new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, timeout: 20000 }, () => resolve())
  })
  try {
    return `data:image/png;base64,${(await readFile(cacheFile)).toString('base64')}`
  } catch (error) {
    return undefined
  }
}

/** PowerShell 单引号字符串（内部单引号翻倍）。 */
function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

/** 应用可用性快照（含真实图标）；refresh 为真时重新探测（改了安装状态不必重启宿主）。 */
async function appsSnapshot(refresh) {
  if (appCache === undefined || refresh) {
    appCache = (async () => {
      const entries = []
      for (const spec of APP_SPECS) {
        const executable = await spec.resolve()
        const available = executable !== undefined
        entries.push({ id: spec.id, available, executable, icon: available ? await appIcon(executable, spec.id) : undefined })
      }
      return entries
    })()
  }
  return appCache
}

//#endregion

//#region 路由

const CONTENT_TYPES = {
  md: 'text/markdown; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  json: 'application/json; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  html: 'text/html; charset=utf-8',
  xml: 'application/xml',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  pdf: 'application/pdf',
}

/** 文本判定的第一刀：前 8 KB 出现 NUL 就按二进制拒绝。 */
function looksBinary(buffer) {
  const window = buffer.subarray(0, 8000)
  return window.includes(0)
}

async function handleDownload(ctx, url, res) {
  const target = await resolveExisting(ctx, url.searchParams.get('path'), url.searchParams.get('sessionId'))
  if (target.error !== undefined) return json(res, target.error === 'not-found' ? 404 : 400, { ok: false, error: target.error })
  if (!target.stats.isFile()) return json(res, 400, { ok: false, error: 'not-file' })
  const fileName = basename(target.path)
  const extension = fileName.includes('.') ? fileName.split('.').pop().toLowerCase() : ''
  res.writeHead(200, {
    'content-type': CONTENT_TYPES[extension] ?? 'application/octet-stream',
    'content-length': String(target.stats.size),
    'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
  })
  const stream = createReadStream(target.path)
  stream.on('error', () => { res.destroy() })
  stream.pipe(res)
  return undefined
}

//#region 网页动作

/** 只接受 http/https 绝对 URL：`file:` / `javascript:` 这类会交给系统执行的一律拒绝。 */
function parseHttpUrl(value) {
  if (typeof value !== 'string' || value.length > 4096) return undefined
  try {
    const url = new URL(value.trim())
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined
  } catch {
    return undefined
  }
}

/** 外部浏览器：Edge 优先，系统里没装就交给默认浏览器（rundll32 调协议处理程序）。 */
async function openExternal(url) {
  const edge = await resolveEdge()
  const result = edge === undefined
    ? await launch('rundll32.exe', ['url.dll,FileProtocolHandler', url])
    : await launch(edge, [url])
  return result.ok ? { ok: true, browser: edge === undefined ? 'default' : 'edge' } : result
}

let browserSession

/**
 * 内置网页视图：`dsh-builtin-browser` 提供的 `ctx.browser`。它是可选协作者（用 ctx.get 读，
 * 没装就让调用方退回外部浏览器）。会话首次开一个并复用；用户关掉窗口后会话失效，
 * 这里重开一次再试。
 */
async function openInBrowser(ctx, url) {
  let browser
  try {
    browser = ctx.get('browser')
  } catch {
    return undefined
  }
  if (browser === null || browser === undefined || typeof browser.openUrl !== 'function') return undefined
  if (browserSession === undefined) browserSession = await browser.open('file-open-with')
  try {
    await browser.openUrl(browserSession, { url, newTab: true })
  } catch {
    browserSession = await browser.open('file-open-with')
    await browser.openUrl(browserSession, { url, newTab: true })
  }
  return 'builtin'
}

async function handleWeb(ctx, route, payload, res) {
  const url = parseHttpUrl(payload.url)
  if (url === undefined) return json(res, 400, { ok: false, error: 'bad-url' })
  if (!IS_WIN) return json(res, 409, { ok: false, error: 'unsupported' })
  if (route === '/open-external') {
    const result = await openExternal(url)
    return result.ok
      ? json(res, 200, { ok: true, browser: result.browser, url })
      : json(res, 500, { ok: false, error: 'spawn-failed', message: result.message })
  }
  // 「打开网页」：优先内置网页视图；不可用或启动失败就退回外部浏览器，
  // 客户端按返回的 browser 字段决定提示哪一句。
  let opened
  try {
    opened = await openInBrowser(ctx, url)
  } catch {
    opened = undefined
  }
  if (opened === 'builtin') return json(res, 200, { ok: true, browser: 'builtin', url })
  const fallback = await openExternal(url)
  return fallback.ok
    ? json(res, 200, { ok: true, browser: fallback.browser, url })
    : json(res, 500, { ok: false, error: 'spawn-failed', message: fallback.message })
}

//#endregion

async function handlePost(ctx, route, payload, res) {
  if (route === '/webview' || route === '/open-external') return handleWeb(ctx, route, payload, res)

  const target = await resolveExisting(ctx, payload.path, payload.sessionId)
  if (target.error !== undefined) {
    return json(res, target.error === 'not-found' ? 404 : 400, { ok: false, error: target.error })
  }

  if (route === '/reveal') {
    if (!IS_WIN) return json(res, 409, { ok: false, error: 'unsupported' })
    // `/select,` 与路径必须是两个 argv：Node 只给含空格的参数加引号，写成单个
    // `/select,<path>` 时整串会被引号包住，Explorer 解析不到开关——路径带空格
    // （例如 D:\DSH Desktop\…）就完全没反应。拆开后带空格也能正确选中（实测）。
    const result = await launch('explorer.exe', ['/select,', target.path])
    return result.ok
      ? json(res, 200, { ok: true, path: target.path })
      : json(res, 500, { ok: false, error: 'spawn-failed', message: result.message })
  }

  if (route === '/open-with') {
    if (!IS_WIN) return json(res, 409, { ok: false, error: 'unsupported' })
    const spec = APP_SPECS.find((entry) => entry.id === payload.appId)
    if (spec === undefined) return json(res, 400, { ok: false, error: 'bad-app' })
    const apps = await appsSnapshot(false)
    const resolved = apps.find((entry) => entry.id === spec.id)
    if (resolved === undefined || resolved.available !== true) return json(res, 409, { ok: false, error: 'app-unavailable' })
    const result = await launch(resolved.executable, spec.args(target.path))
    return result.ok
      ? json(res, 200, { ok: true, path: target.path, app: spec.id })
      : json(res, 500, { ok: false, error: 'spawn-failed', message: result.message })
  }

  if (route === '/text') {
    if (!target.stats.isFile()) return json(res, 400, { ok: false, error: 'not-file' })
    if (target.stats.size > MAX_TEXT_BYTES) return json(res, 413, { ok: false, error: 'too-large' })
    const buffer = await readFile(target.path)
    if (looksBinary(buffer)) return json(res, 415, { ok: false, error: 'not-text' })
    return json(res, 200, { ok: true, path: target.path, text: buffer.toString('utf8') })
  }

  return json(res, 404, { ok: false, error: 'not-found' })
}

async function handle(ctx, req, res) {
  if (!isTrustedRequest(req)) return json(res, 403, { ok: false, error: 'forbidden' })
  const url = new URL(String(req.url ?? '/'), 'http://dsh.internal')
  const route = (url.pathname.slice(ROUTE_PREFIX.length).replace(/\/+$/, '')) || '/'
  const method = String(req.method ?? 'GET').toUpperCase()

  if (method === 'GET' && route === '/apps') {
    const apps = await appsSnapshot(url.searchParams.get('refresh') === '1')
    return json(res, 200, { ok: true, apps: apps.map(({ id, available, icon }) => ({ id, available, icon })) })
  }
  if (method === 'GET' && route === '/download') return handleDownload(ctx, url, res)
  if (method === 'POST') {
    const body = await readJsonBody(req)
    if (body.error !== undefined) return json(res, 400, { ok: false, error: body.error })
    return handlePost(ctx, route, body.value, res)
  }
  return json(res, 404, { ok: false, error: 'not-found' })
}

//#endregion

/** 挂载前缀路由；webServer 尚未就绪时按 400ms 轮询重试（与 dsh-files-native 同法）。 */
function registerRoutes(ctx) {
  const webServer = ctx.get('webServer')
  if (webServer === undefined || typeof webServer.register !== 'function') return undefined
  return webServer.register({
    kind: 'prefix',
    path: ROUTE_PREFIX,
    handler: (req, res) => {
      void handle(ctx, req, res).catch((error) => {
        ctx.logger?.warn?.(`[file-open-with] request failed: ${String(error?.message ?? error)}`)
        if (!res.headersSent) json(res, 500, { ok: false, error: 'internal' })
        else res.destroy()
      })
    },
  })
}

export function apply(ctx) {
  const direct = registerRoutes(ctx)
  if (direct !== undefined) {
    ctx.effect(() => direct, 'file-open-with: routes')
  } else {
    let dispose
    const timer = setInterval(() => {
      const registered = registerRoutes(ctx)
      if (registered === undefined) return
      clearInterval(timer)
      dispose = registered
      ctx.logger?.info?.('[file-open-with] routes registered (deferred)')
    }, 400)
    ctx.effect(() => () => { clearInterval(timer); dispose?.() }, 'file-open-with: routes deferred')
  }
  void appsSnapshot(false).then((apps) => {
    const summary = apps.map((entry) => `${entry.id}=${entry.available ? 'ok' : 'missing'}`).join(' ')
    ctx.logger?.info?.(`[file-open-with] host loaded (${summary})`)
  })
}
