/**
 * dsh-file-open-with 宿主半部独立验证：用最小假 ctx 挂载真实 lib/index.js，
 * 在本地端口上把每条路由跑一遍（含栅栏、路径解析、文本/二进制/体积边界）。
 * 只用一次真实 reveal（会弹资源管理器窗口）与一次真实 open-with（弹终端窗口）。
 */
import { createServer, request as httpRequest } from 'node:http'
import { mkdtemp, writeFile, mkdir, readFile, rm } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const SOURCE_DIR = 'C:\\Users\\Administrator\\.dsh\\plugins-src\\dsh-file-open-with'
const PORT = 45999
const BASE = `http://127.0.0.1:${PORT}`
const WINDOW_STATE = join(tmpdir(), 'dfow-window-state.json')
const SNAPSHOT_SCRIPT = join(SOURCE_DIR, '.verify', 'snapshot-windows.ps1')

const results = []
function check(name, ok, detail) {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : ` — ${detail}`}`)
}

/** 用 Shell.Application + Win32 读已打开的 Explorer 窗口（含可见性）；调独立脚本，避免内联 here-string 的坑。 */
function windowSnapshot() {
  return new Promise((resolve) => {
    const child = spawn('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SNAPSHOT_SCRIPT, '-State', WINDOW_STATE],
      { windowsHide: true, stdio: 'ignore' })
    child.on('close', async () => {
      const raw = await readFile(WINDOW_STATE, 'utf8').catch(() => '[]')
      try {
        const parsed = JSON.parse(raw)
        resolve(Array.isArray(parsed) ? parsed : [parsed])
      } catch {
        resolve([])
      }
    })
    child.on('error', () => resolve([]))
  })
}

function closeProbeWindows() {
  const script = "$s = New-Object -ComObject Shell.Application; foreach ($w in @($s.Windows())) { try { if ([string]$w.LocationURL -like '*dfow*') { $w.Quit() } } catch { } }"
  return new Promise((resolve) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, stdio: 'ignore' })
    child.on('close', () => setTimeout(resolve, 800))
    child.on('error', () => resolve())
  })
}

/** 轮询等待目标文件出现在某个 Explorer 窗口的选中项里（Explorer 启动有延迟，且可能复用窗口）。 */
async function waitForWindow(target, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let last = []
  while (Date.now() < deadline) {
    last = await windowSnapshot()
    const hit = last.find((entry) => entry.selected.toLowerCase() === target.toLowerCase())
    if (hit !== undefined) return { hit, last }
    await new Promise((resolve) => setTimeout(resolve, 1200))
  }
  return { hit: undefined, last }
}

const routes = []
const server = createServer((req, res) => {
  const path = String(req.url ?? '/').split('?')[0]
  for (const route of routes) {
    if (route.kind === 'prefix' && path.startsWith(route.path)) return route.handler(req, res)
    if (route.kind === 'exact' && path === route.path) return route.handler(req, res)
  }
  res.writeHead(404, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ ok: false, error: 'no-route' }))
})

const sessions = { get: (id) => (id === 'probe' ? { header: { cwd: SOURCE_DIR } } : undefined) }
const webServer = {
  register(route) {
    routes.push(route)
    return () => { const index = routes.indexOf(route); if (index >= 0) routes.splice(index, 1) }
  },
}
const effects = []
const ctx = {
  get: (name) => (name === 'webServer' ? webServer : name === 'sessions' ? sessions : undefined),
  sessions,
  effect: (fn) => { const disposer = fn(); if (typeof disposer === 'function') effects.push(disposer) },
  logger: { info: (message) => console.log(`[host:info] ${message}`), warn: (message) => console.log(`[host:warn] ${message}`) },
}

const module_ = await import(pathToFileURL(join(SOURCE_DIR, 'lib', 'index.js')).href)
module_.apply(ctx)

await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve))

const workDir = await mkdtemp(join(tmpdir(), 'dfow-'))
const textFile = join(workDir, 'sample.txt')
const bigFile = join(workDir, 'big.txt')
const binFile = join(workDir, 'binary.bin')
await writeFile(textFile, 'hello 插件\n', 'utf8')
await writeFile(bigFile, Buffer.alloc(1024 * 1024 + 16, 0x61))
await writeFile(binFile, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x41, 0x00]))

async function post(route, body) {
  const response = await fetch(BASE + route, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await response.json().catch(() => null)
  return { status: response.status, data }
}

function rawRequest({ path, method = 'GET', headers = {}, body = undefined }) {
  return new Promise((resolve) => {
    const finalHeaders = body === undefined ? headers : { ...headers, 'content-length': String(Buffer.byteLength(body)) }
    const req = httpRequest({ host: '127.0.0.1', port: PORT, path, method, headers: finalHeaders }, (res) => {
      let payload = ''
      res.on('data', (chunk) => { payload += chunk })
      res.on('end', () => resolve({ status: res.statusCode, body: payload }))
    })
    req.on('error', (error) => resolve({ status: 0, body: String(error.message) }))
    req.end(body)
  })
}

setTimeout(() => { console.log('WATCHDOG: 验证脚本超时'); process.exit(2) }, 45000)

// 1) /apps
const apps = await fetch(`${BASE}/plugins/file-open-with/apps`)
const appsBody = await apps.json()
check('GET /apps 200 + 三个应用', apps.status === 200 && appsBody.apps?.length === 3,
  JSON.stringify(appsBody))
check('三个应用都可用', appsBody.apps?.every((entry) => entry.available === true),
  appsBody.apps?.map((entry) => `${entry.id}=${entry.available}`).join(' '))
const appEntries = appsBody.apps ?? []
check('每个可用应用都带真实 exe 图标（data URL）',
  appEntries.every((entry) => typeof entry.icon === 'string' && entry.icon.startsWith('data:image/png;base64,')),
  appEntries.map((entry) => `${entry.id}:${typeof entry.icon === 'string' ? entry.icon.length + 'B' : 'none'}`).join(' '))

// 2) 栅栏
const evilHost = await rawRequest({ path: '/plugins/file-open-with/apps', headers: { host: 'evil.example.com' } })
check('非 loopback Host → 403', evilHost.status === 403, `status=${evilHost.status}`)
const crossSite = await rawRequest({ path: '/plugins/file-open-with/apps', headers: { host: `127.0.0.1:${PORT}`, 'sec-fetch-site': 'cross-site' } })
check('sec-fetch-site: cross-site → 403', crossSite.status === 403, `status=${crossSite.status}`)
const crossOrigin = await rawRequest({ path: '/plugins/file-open-with/apps', headers: { host: `127.0.0.1:${PORT}`, origin: 'https://evil.example.com' } })
check('异源 Origin → 403', crossOrigin.status === 403, `status=${crossOrigin.status}`)
const sameOrigin = await rawRequest({ path: '/plugins/file-open-with/apps', headers: { host: `127.0.0.1:${PORT}`, origin: `http://127.0.0.1:${PORT}` } })
check('同源 Origin → 200', sameOrigin.status === 200, `status=${sameOrigin.status}`)

// 3) 路径解析
check('盘符相对 C:foo → 400', (await post('/plugins/file-open-with/reveal', { path: 'C:foo' })).status === 400)
check('空 path → 400', (await post('/plugins/file-open-with/reveal', { path: '   ' })).status === 400)
check('无 sessionId 的相对路径 → 400', (await post('/plugins/file-open-with/reveal', { path: 'README.md' })).status === 400)
check('绝对但不存在 → 404', (await post('/plugins/file-open-with/reveal', { path: 'C:\\__definitely_missing__\\x.txt' })).status === 404)
const body = await rawRequest({
  path: '/plugins/file-open-with/reveal', method: 'POST',
  headers: { host: `127.0.0.1:${PORT}`, 'content-type': 'application/json' },
  body: 'not json at all',
})
check('非 JSON body → 400', body.status === 400, `status=${body.status}`)

// 4) 文本 / 体积 / 二进制
const text = await post('/plugins/file-open-with/text', { path: textFile })
check('POST /text 读文本', text.status === 200 && text.data.text === 'hello 插件\n', JSON.stringify(text.data))
check('POST /text 相对路径按会话 cwd 解析', (await post('/plugins/file-open-with/text', { path: 'README.md', sessionId: 'probe' })).status === 200)
check('POST /text 超 1 MB → 413', (await post('/plugins/file-open-with/text', { path: bigFile })).status === 413)
check('POST /text 二进制 → 415', (await post('/plugins/file-open-with/text', { path: binFile })).status === 415)

// 5) 下载
const download = await fetch(`${BASE}/plugins/file-open-with/download?path=${encodeURIComponent(textFile)}`)
const downloadText = await download.text()
check('GET /download 内容与 disposition', download.status === 200 && downloadText === 'hello 插件\n'
  && String(download.headers.get('content-disposition')).includes("filename*=UTF-8''sample.txt"),
  `${download.status} ${download.headers.get('content-disposition')}`)
check('GET /download 目录 → 400', (await fetch(`${BASE}/plugins/file-open-with/download?path=${encodeURIComponent(workDir)}`)).status === 400)

// 6) 未知路由 / 方法
check('未知路由 → 404', (await fetch(`${BASE}/plugins/file-open-with/nope`)).status === 404)
check('GET /reveal（方法不符）→ 404', (await fetch(`${BASE}/plugins/file-open-with/reveal`)).status === 404)

// 7) 未知应用
check('未知 appId → 400', (await post('/plugins/file-open-with/open-with', { appId: 'nope', path: textFile })).status === 400)

// 8) 真实动作（各一次）
const reveal = await post('/plugins/file-open-with/reveal', { path: textFile })
check('POST /reveal 真实执行', reveal.status === 200, JSON.stringify(reveal.data))
const launch = await post('/plugins/file-open-with/open-with', { appId: 'terminal', path: textFile })
check('POST /open-with terminal 真实执行', launch.status === 200, JSON.stringify(launch.data))

// 8b) 带空格路径的 reveal 必须真的选中**并且窗口可见**（回归：单参数 argv + windowsHide 都会静默失效）
const spaceDir = join(tmpdir(), 'dfow reveal space')
await rm(spaceDir, { recursive: true, force: true }).catch(() => {})
await mkdir(spaceDir, { recursive: true })
const spaceFile = join(spaceDir, 'my file.txt')
await writeFile(spaceFile, 'x', 'utf8')
await closeProbeWindows()
const spaced = await post('/plugins/file-open-with/reveal', { path: spaceFile })
let { hit, last } = await waitForWindow(spaceFile, 9000)
if (hit === undefined) {
  // Explorer 偶尔会漏掉一次 /select（尤其刚关过窗口），重试一次再判定
  await post('/plugins/file-open-with/reveal', { path: spaceFile })
  ;({ hit, last } = await waitForWindow(spaceFile, 12000))
}
check('带空格路径的 reveal 真的选中了文件',
  spaced.status === 200 && hit !== undefined,
  `${spaced.status} ${JSON.stringify(spaced.data)} → ${hit === undefined ? `窗口未出现；快照=${JSON.stringify(last.map((entry) => entry.selected))}` : JSON.stringify(hit)}`)
check('reveal 的窗口是可见且未最小化的（windowsHide 必须为 false）',
  hit !== undefined && hit.visible === true && hit.minimized === false,
  hit === undefined ? '没有对应窗口' : `visible=${hit.visible} minimized=${hit.minimized}`)
await closeProbeWindows()

// 8c) 网页动作：假 ctx 没有 browser 服务 → 「打开网页」必须退回外部浏览器；URL 协议白名单要拦住非 http(s)
const badScheme = await post('/plugins/file-open-with/webview', { url: 'file:///C:/Windows/win.ini' })
check('非 http(s) 链接被拒（file:）', badScheme.status === 400 && badScheme.data.error === 'bad-url', JSON.stringify(badScheme.data))
const badJs = await post('/plugins/file-open-with/open-external', { url: 'javascript:alert(1)' })
check('非 http(s) 链接被拒（javascript:）', badJs.status === 400 && badJs.data.error === 'bad-url', JSON.stringify(badJs.data))
const noUrl = await post('/plugins/file-open-with/open-external', {})
check('缺少 url 被拒', noUrl.status === 400 && noUrl.data.error === 'bad-url', JSON.stringify(noUrl.data))

// 会真的开一个 Edge 标签页：证明「Edge 优先」这条路真的通（走的是同一个 launch）
const external = await post('/plugins/file-open-with/open-external', { url: 'https://example.com/' })
check('POST /open-external 真的用 Edge 打开（Edge 优先）',
  external.status === 200 && external.data.browser === 'edge', JSON.stringify(external.data))
const webFallback = await post('/plugins/file-open-with/webview', { url: 'https://example.com/' })
check('没有内置浏览器时「打开网页」退回外部浏览器',
  webFallback.status === 200 && webFallback.data.browser === 'edge', JSON.stringify(webFallback.data))

// 9) 卸载清理
check('apply 注册了前缀路由', routes.length === 1 && routes[0].kind === 'prefix' && routes[0].path === '/plugins/file-open-with',
  JSON.stringify(routes.map((route) => `${route.kind}:${route.path}`)))
check('ctx.effect 拿到了 disposer', effects.length === 1, `effects=${effects.length}`)
for (const dispose of effects) dispose()
const afterDispose = await fetch(`${BASE}/plugins/file-open-with/apps`).catch(() => ({ status: 0 }))
check('disposer 拆除后路由消失', routes.length === 0 && afterDispose.status === 404, `routes=${routes.length} status=${afterDispose.status}`)

await closeProbeWindows()
await rm(workDir, { recursive: true, force: true }).catch(() => {})
server.close()

const failed = results.filter((entry) => !entry.ok)
console.log(`\n${results.length - failed.length}/${results.length} 项通过`)
process.exit(failed.length === 0 ? 0 : 1)
