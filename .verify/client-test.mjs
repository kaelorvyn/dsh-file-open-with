/**
 * dsh-file-open-with 浏览器半部验证：本地起一个台架页面，复刻聊天里文件 chip 的
 * DOM 契约，真加载 lib/client.js（走真实 __ModuleLoader__.load 与 apply），
 * 用 msedge 无头浏览器断言：右键命中/放行、菜单条目、子菜单、动作载荷、
 * 剪贴板、打开方式请求、两种菜单实现（primitives / 自绘）。
 */
import { createServer } from 'node:http'
import { readFile, mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const SOURCE_DIR = 'C:\\Users\\Administrator\\.dsh\\plugins-src\\dsh-file-open-with'
const APP_MODULES = 'D:\\DSH Desktop\\resources\\app.asar.unpacked\\node_modules'
const PORT = 45998
const ORIGIN = `http://127.0.0.1:${PORT}`
const SHOTS = join(SOURCE_DIR, '.verify', 'shots')

const require_ = createRequire('C:/Users/Administrator/.dsh/profiles/desktop/')
const puppeteer = require_('puppeteer-core')

const results = []
function check(name, ok, detail) {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : ` — ${detail}`}`)
}

const seen = { apps: 0, reveal: [], openWith: [], text: [], download: [] }
/** 台架把「哪个应用不可用」做成页级状态，便于同时验证「置灰」和「宿主 409」两条路径。 */
let currentMissing = 'idea'

const HARNESS_HTML = (variant) => `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><title>dsh-file-open-with harness</title>
<style>
 body{font:14px/1.7 system-ui,"Segoe UI";margin:24px;background:#fff;color:#111}
 .chip{border:1px solid #cbd5e1;border-radius:6px;padding:2px 8px;background:#eff6ff;color:#1d4ed8;cursor:pointer}
 .row{display:flex;gap:8px;margin-bottom:10px}
 .stub-menu{border:1px solid #94a3b8;border-radius:8px;padding:6px}
 .stub-item{display:flex;gap:6px;align-items:center}
 .stub-sep{height:1px;background:#cbd5e1;margin:4px 0}
 .stub-sub{display:flex;gap:6px}
</style></head>
<body>
<div data-produced-files-row class="row">
  <button class="gemp6G_file chip" title="D:\\proj\\src\\index.html">index.html</button>
  <button class="nArs4W_producedChip chip" title="D:\\proj\\docs\\guide.md">guide.md</button>
</div>
<div class="row"><button class="fr-chip chip" title=".dsh-uploads/notes.txt">notes.txt</button></div>
<div data-tool="edit" data-variant="edit" data-state="ok" class="row"><span>编辑 · </span><button class="WXmFEW_fileLink chip" type="button">src\\notes.md</button></div>
<div data-tool="read" data-variant="read" data-state="ok" class="row"><span>读取 · </span><button class="WXmFEW_fileLink chip" type="button">C:\\outside\\report.md</button></div>
<div data-tool="read" data-variant="read" data-state="ok" class="row"><span>读取 · </span><button class="WXmFEW_fileLink chip" type="button">https://example.com/page.md</button></div>
<p>正文段落，<code><button class="_fileMention_177e0_288 chip" title="D:\\proj\\README.md">README.md</button></code> 是内联文件引用。</p>
<p id="plain">这是一个普通段落，右键应当保留原生菜单。</p>
<button id="plainButton" title="D:\\proj\\not-a-chip.txt">白名单之外的普通按钮</button>
<div id="root"></div>
<script src="/vendor/react.js"></script>
<script src="/vendor/react-dom.js"></script>
<script>
window.__MOUNT_LOG__ = [];
window.__REQUESTS__ = [];
window.__ANCHOR_CLICKS__ = [];
window.__VARIANT__ = ${JSON.stringify(variant)};
window.__LOCALE__ = new URLSearchParams(location.search).get('locale') || 'zh';
(function () {
  var original = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    window.__ANCHOR_CLICKS__.push({ href: this.href, download: this.download });
    return original.apply(this, arguments);
  };
})();
window.__PRIMITIVES__ = (function () {
  var stubIcon = function (name) {
    return function () { return React.createElement('svg', { className: 'stub-icon', 'data-icon': name, width: 16, height: 16 }) };
  };
  return {
  IconBrowseOutline16: stubIcon('browse'),
  IconFolderOpenOutline16: stubIcon('folder'),
  IconRightUpOutline16: stubIcon('rightup'),
  IconDownloadOutline16: stubIcon('download'),
  IconLinkOutline16: stubIcon('link'),
  IconCopyOutline16: stubIcon('copy'),
  Menu: function Menu(props) {
    window.__LAST_MENU_PROPS__ = props;
    window.__LAST_MENU_ITEMS__ = props.items;
    if (props.open !== true) return null;
    var rows = (props.items || []).map(function (entry, index) {
      if (entry.type === 'separator') return React.createElement('div', { className: 'stub-sep', key: 'sep' + index });
      var sub = entry.submenu === undefined ? null : React.createElement('div', { className: 'stub-sub' },
        entry.submenu.map(function (child) {
          return React.createElement('button', {
            className: 'stub-subitem', 'data-item-id': child.id, key: child.id,
            disabled: child.disabled === true,
            onClick: function () { if (child.disabled !== true) props.onSelect(child.id); },
          }, child.icon === undefined ? null : child.icon, child.label);
        }));
      return React.createElement('div', { className: 'stub-item', 'data-item-id': entry.id, 'data-disabled': entry.disabled === true ? '1' : '0', key: entry.id },
        React.createElement('button', {
          className: 'stub-btn', disabled: entry.disabled === true,
          onClick: function () { if (entry.disabled !== true) props.onSelect(entry.id); },
        }, entry.icon === undefined ? null : entry.icon, entry.label), sub);
    });
    var rect = props.getAnchorRect === undefined ? null : props.getAnchorRect();
    return React.createElement('div', { className: 'stub-menu', 'data-rect': JSON.stringify(rect), 'data-portal': String(props.portal), 'data-open': String(props.open) }, rows);
  },
  };
})();
window.__ModuleLoader__ = {
  load: function (definition) {
    var require = function (name) {
      if (name === 'react') return window.React;
      if (name === '@deepseek-ai/dsh-client-ui-primitives') {
        if (window.__VARIANT__ !== 'primitives') throw new Error('primitives unavailable in this harness');
        return window.__PRIMITIVES__;
      }
      throw new Error('unknown module ' + name);
    };
    window.__PLUGIN__ = definition.factory(require);
  },
};
</script>
<script src="/client.js"></script>
<script>
(function () {
  var captured = { options: null, component: null };
  var sessions = { list: { getSnapshot: function () { return { current: 's1', byId: { s1: { cwd: 'D:\\\\proj' } } }; } } };
  var ctx = {
    logger: { info: function () {}, warn: function (message) { window.__MOUNT_LOG__.push(['warn', String(message)]); } },
    get: function (name) {
      if (name === 'sessions') return sessions;
      if (name === 'locale') return { getSnapshot: function () { return { active: window.__LOCALE__ || 'zh' }; } };
      if (name === 'betterSidebar') return window.__SIDEBAR__;
      return undefined;
    },
    slots: {
      inject: function (slot, callback) { window.__MOUNT_LOG__.push(['inject', slot]); return callback(); },
      register: function (options, component) {
        window.__MOUNT_LOG__.push(['register', options.name, options.id, options.order]);
        captured.options = options;
        captured.component = component;
        return function () { window.__MOUNT_LOG__.push(['dispose', options.id]); };
      },
    },
  };
  window.__SIDEBAR__ = {
    features: ['openFile'],
    openFile: function (scope, path, title) { window.__OPEN_FILE__ = { scope: scope, path: path, title: title }; },
    openTab: function (seed) { window.__OPEN_TAB__ = seed; },
  };
  window.__MOUNT_LOG__.push(['plugin-exports', Object.keys(window.__PLUGIN__).sort().join(','), (window.__PLUGIN__.inject || []).join(',')]);
  window.__PLUGIN__.apply(ctx);
  ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(captured.component, null));
})();
</script>
</body></html>`

const server = createServer(async (req, res) => {
  const url = new URL(String(req.url ?? '/'), ORIGIN)
  const route = url.pathname
  const send = (code, type, payload) => { res.writeHead(code, { 'content-type': type }); res.end(payload) }
  try {
    if (route === '/') {
      const variant = url.searchParams.get('menu') === 'primitives' ? 'primitives' : 'fallback'
      currentMissing = url.searchParams.get('missing') ?? 'idea'
      return send(200, 'text/html; charset=utf-8', HARNESS_HTML(variant))
    }
    if (route === '/client.js') return send(200, 'text/javascript; charset=utf-8', await readFile(join(SOURCE_DIR, 'lib', 'client.js'), 'utf8'))
    if (route === '/vendor/react.js') return send(200, 'text/javascript; charset=utf-8', await readFile(join(APP_MODULES, 'react', 'umd', 'react.development.js'), 'utf8'))
    if (route === '/vendor/react-dom.js') return send(200, 'text/javascript; charset=utf-8', await readFile(join(APP_MODULES, 'react-dom', 'umd', 'react-dom.development.js'), 'utf8'))
    if (route === '/plugins/file-open-with/apps') {
      seen.apps += 1
      return send(200, 'application/json', JSON.stringify({ ok: true, apps: [
        { id: 'visualstudio', available: true, icon: 'data:image/png;base64,iVBORw0KGgo=' },
        { id: 'terminal', available: true, icon: 'data:image/png;base64,iVBORw0KGgo=' },
        { id: 'idea', available: currentMissing !== 'idea' },
      ] }))
    }
    if (route === '/plugins/file-open-with/download') {
      seen.download.push(url.search)
      return send(200, 'text/plain; charset=utf-8', 'SAVED')
    }
    if (route.startsWith('/plugins/file-open-with/') && req.method === 'POST') {
      let body = ''
      for await (const chunk of req) body += chunk
      const parsed = JSON.parse(body === '' ? '{}' : body)
      const name = route.slice('/plugins/file-open-with/'.length)
      if (name === 'reveal') seen.reveal.push(parsed)
      else if (name === 'open-with') seen.openWith.push(parsed)
      else if (name === 'text') seen.text.push(parsed)
      if (name === 'text') return send(200, 'application/json', JSON.stringify({ ok: true, text: '文件内容示例' }))
      if (name === 'open-with' && parsed.appId === 'idea') return send(409, 'application/json', JSON.stringify({ ok: false, error: 'app-unavailable' }))
      return send(200, 'application/json', JSON.stringify({ ok: true, path: parsed.path }))
    }
    return send(404, 'text/plain; charset=utf-8', 'not found')
  } catch (error) {
    return send(500, 'text/plain; charset=utf-8', String(error?.message ?? error))
  }
})

const DEVICE = { width: 1100, height: 700 }
const click = (page, x = 200, y = 120) => page.evaluate(({ x, y }) => {
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y })
  const target = document.elementFromPoint(x, y)
  if (target === null) return { prevented: null, path: null, reason: 'no element at point' }
  target.dispatchEvent(event)
  return { prevented: event.defaultPrevented, path: target.getAttribute('title'), tag: target.tagName }
}, { x, y })

const contextMenuOn = (page, selector) => page.evaluate((sel) => {
  const element = document.querySelector(sel)
  if (element === null) return { prevented: null, missing: sel }
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 140, clientY: 160 })
  element.dispatchEvent(event)
  return { prevented: event.defaultPrevented }
}, selector)

const waitTick = (page) => page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 60)))
const menuText = (page) => page.evaluate(() => {
  const nav = document.querySelector('.dfow-nav')
  if (nav === null) return null
  return Array.from(nav.children).map((row) => row.querySelector('.dfow-item .dfow-text')?.textContent
    ?? (row.classList.contains('dfow-sep') ? '---' : '???'))
})
const menuSnapshot = (page) => page.evaluate(() => {
  const nav = document.querySelector('.dfow-nav')
  if (nav === null) return null
  return {
    items: Array.from(nav.querySelectorAll(':scope > .dfow-row')).map((row) => ({
      label: row.querySelector('.dfow-item .dfow-text')?.textContent,
      hint: row.querySelector('.dfow-hint')?.textContent ?? null,
      disabled: row.querySelector('.dfow-item')?.disabled === true,
    })),
    submenu: Array.from(nav.querySelectorAll('.dfow-sub .dfow-item')).map((item) => ({
      label: item.querySelector('.dfow-text')?.textContent,
      hint: item.querySelector('.dfow-hint')?.textContent ?? null,
      disabled: item.disabled,
    })),
  }
})
const clickStub = (page, id) => page.evaluate((itemId) => {
  const button = document.querySelector(`.stub-btn[data-item-id="${itemId}"], [data-item-id="${itemId}"] .stub-btn, [data-item-id="${itemId}"]`)
  if (button === null) return false
  button.click()
  return true
}, id)
const closeMenu = (page) => page.evaluate(() => { document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })) })

await mkdir(SHOTS, { recursive: true })
await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve))

const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true,
  args: ['--no-sandbox', '--disable-gpu'],
  defaultViewport: DEVICE,
})
try {
  await browser.defaultBrowserContext().overridePermissions(ORIGIN, ['clipboard-read', 'clipboard-write'])

  // ---------- 变体 1：primitives 菜单不可用 → 自绘菜单 ----------
  const page = await browser.newPage()
  const consoleErrors = []
  page.on('pageerror', (error) => consoleErrors.push(String(error.message)))
  await page.goto(`${ORIGIN}/?menu=fallback`, { waitUntil: 'load' })
  await waitTick(page)

  const mountLog = await page.evaluate(() => window.__MOUNT_LOG__)
  check('插件导出 apply + inject(slots,sessions)',
    mountLog.some((entry) => entry[0] === 'plugin-exports' && entry[1] === 'apply,inject' && entry[2] === 'slots,sessions'),
    JSON.stringify(mountLog[0]))
  check('注册到 shell.overlay（list 槽，id 与 order 正确）',
    mountLog.some((entry) => entry[0] === 'inject' && entry[1] === 'shell.overlay')
    && mountLog.some((entry) => entry[0] === 'register' && entry[1] === 'shell.overlay' && entry[2] === 'file-open-with' && entry[3] === 10),
    JSON.stringify(mountLog.slice(1)))

  const produced = await contextMenuOn(page, '[data-produced-files-row] button')
  await waitTick(page)
  check('产物 chip 右键被接管（preventDefault）', produced.prevented === true, JSON.stringify(produced))
  check('菜单条目与顺序（zh）',
    JSON.stringify(await menuText(page)) === JSON.stringify(['打开文件', '在资源管理器中打开', '打开方式', '---', '另存为', '复制路径', '复制文件内容']),
    JSON.stringify(await menuText(page)))
  const snapshot = await menuSnapshot(page)
  check('子菜单三项、未安装项置灰并标注',
    JSON.stringify(snapshot.submenu) === JSON.stringify([
      { label: 'Visual Studio', hint: null, disabled: false },
      { label: '终端', hint: null, disabled: false },
      { label: 'IntelliJ IDEA', hint: '未找到', disabled: true },
    ]), JSON.stringify(snapshot.submenu))
  check('/apps 只在首次打开时请求一次', seen.apps === 1, `apps=${seen.apps}`)
  check('「打开方式」带子菜单指示箭头', (await page.evaluate(() => document.querySelectorAll('.dfow-nav .dfow-arrow').length)) === 1)
  await page.screenshot({ path: join(SHOTS, 'menu-zh.png') })

  // 打开文件 → betterSidebar.openFile
  await page.evaluate(() => { document.querySelector('.dfow-item').click() })
  await waitTick(page)
  const openFile = await page.evaluate(() => window.__OPEN_FILE__)
  check('「打开文件」用绝对路径调 betterSidebar.openFile',
    JSON.stringify(openFile) === JSON.stringify({ scope: { sessionId: 's1' }, path: 'D:\\proj\\src\\index.html', title: 'index.html' }),
    JSON.stringify(openFile))
  check('选择后菜单关闭', (await menuText(page)) === null)

  // 相对路径 chip → 复制路径使用会话 cwd 解析
  await contextMenuOn(page, 'button.fr-chip')
  await waitTick(page)
  await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.dfow-nav .dfow-item'))
    rows.find((row) => row.textContent.includes('复制路径')).click()
  })
  await waitTick(page)
  const clipboard = await page.evaluate(() => navigator.clipboard.readText())
  check('「复制路径」把相对路径按 cwd 解析后写入剪贴板',
    clipboard === 'D:\\proj\\.dsh-uploads\\notes.txt', clipboard)
  const notice = await page.evaluate(() => document.querySelector('.dfow-notice')?.textContent ?? null)
  check('复制后给出中文提示', notice === '已复制路径', String(notice))

  // 在资源管理器中打开
  await contextMenuOn(page, '[data-produced-files-row] button')
  await waitTick(page)
  await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.dfow-nav .dfow-item'))
    rows.find((row) => row.textContent.includes('在资源管理器中打开')).click()
  })
  await waitTick(page)
  check('「在资源管理器中打开」POST /reveal 载荷正确',
    JSON.stringify(seen.reveal) === JSON.stringify([{ path: 'D:\\proj\\src\\index.html', sessionId: 's1' }]),
    JSON.stringify(seen.reveal))

  // 打开方式 → Visual Studio
  await contextMenuOn(page, '[data-produced-files-row] button')
  await waitTick(page)
  await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('.dfow-sub .dfow-item'))
    items.find((item) => item.textContent.includes('Visual Studio')).click()
  })
  await waitTick(page)
  check('「打开方式 → Visual Studio」POST /open-with 载荷正确',
    JSON.stringify(seen.openWith) === JSON.stringify([{ appId: 'visualstudio', path: 'D:\\proj\\src\\index.html', sessionId: 's1' }]),
    JSON.stringify(seen.openWith))

  // 复制文件内容（/text + 剪贴板）
  await contextMenuOn(page, 'button[class*="fileMention"]')
  await waitTick(page)
  await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.dfow-nav .dfow-item'))
    rows.find((row) => row.textContent.includes('复制文件内容')).click()
  })
  await waitTick(page)
  check('「复制文件内容」请求 /text 并写入剪贴板',
    seen.text.length === 1 && seen.text[0].path === 'D:\\proj\\README.md'
    && (await page.evaluate(() => navigator.clipboard.readText())) === '文件内容示例',
    JSON.stringify(seen.text))

  // 工具行（读取/编辑）文件链接：路径来自按钮文本，相对路径按 cwd 还原
  const toolRelative = await contextMenuOn(page, '[data-tool="edit"] button[class*="fileLink"]')
  await waitTick(page)
  check('工具行相对路径链接右键被接管', toolRelative.prevented === true && (await menuText(page)) !== null, JSON.stringify(toolRelative))
  await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.dfow-nav .dfow-item'))
    rows.find((row) => row.textContent.includes('复制路径')).click()
  })
  await waitTick(page)
  check('工具行相对路径按会话 cwd 还原',
    (await page.evaluate(() => navigator.clipboard.readText())) === 'D:\\proj\\src\\notes.md',
    await page.evaluate(() => navigator.clipboard.readText()))

  const toolAbsolute = await contextMenuOn(page, '[data-tool="read"] button[class*="fileLink"]')
  await waitTick(page)
  await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.dfow-nav .dfow-item'))
    rows.find((row) => row.textContent.includes('复制路径')).click()
  })
  await waitTick(page)
  check('工具行绝对路径原样使用',
    toolAbsolute.prevented === true && (await page.evaluate(() => navigator.clipboard.readText())) === 'C:\\outside\\report.md',
    await page.evaluate(() => navigator.clipboard.readText()))

  // 白名单之外一律放行原生菜单
  await closeMenu(page)
  await waitTick(page)
  const plainParagraph = await contextMenuOn(page, '#plain')
  await waitTick(page)
  check('普通段落右键不接管、不弹菜单', plainParagraph.prevented === false && (await menuText(page)) === null, JSON.stringify(plainParagraph))
  const plainButton = await contextMenuOn(page, '#plainButton')
  await waitTick(page)
  check('带 title 但不在白名单的按钮不接管', plainButton.prevented === false && (await menuText(page)) === null, JSON.stringify(plainButton))
  const urlResult = await page.evaluate(() => {
    const button = Array.from(document.querySelectorAll('button[class*="fileLink"]')).find((item) => item.textContent.startsWith('https://'))
    if (button === undefined) return { missing: true }
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    button.dispatchEvent(event)
    return { prevented: event.defaultPrevented }
  })
  await waitTick(page)
  check('工具行 URL 文本不被当作路径（放行原生右键）',
    urlResult.prevented === false && (await menuText(page)) === null, JSON.stringify(urlResult))

  // Escape 关闭
  await contextMenuOn(page, '[data-produced-files-row] button')
  await waitTick(page)
  await page.keyboard.press('Escape')
  await waitTick(page)
  check('Escape 关闭菜单', (await menuText(page)) === null)

  // 英文语言包
  await page.goto(`${ORIGIN}/?menu=fallback&locale=en-US`, { waitUntil: 'load' })
  await waitTick(page)
  await contextMenuOn(page, '[data-produced-files-row] button')
  await waitTick(page)
  const englishText = await menuText(page)
  check('英文环境下菜单本地化',
    JSON.stringify(englishText) === JSON.stringify(['Open file', 'Reveal in File Explorer', 'Open with', '---', 'Save as', 'Copy path', 'Copy file content']),
    JSON.stringify(englishText))
  check('自绘菜单变体无页面异常', consoleErrors.length === 0, consoleErrors.join(' | '))

  // ---------- 变体 2：primitives Menu 可用 ----------
  const page2 = await browser.newPage()
  const errors2 = []
  page2.on('pageerror', (error) => errors2.push(String(error.message)))
  try {
    const cdp = await page2.createCDPSession()
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: SHOTS, eventsEnabled: true })
  } catch (error) {
    console.log(`[warn] 下载行为设置失败（不影响断言）：${String(error?.message ?? error)}`)
  }
  await page2.goto(`${ORIGIN}/?menu=primitives`, { waitUntil: 'load' })
  await waitTick(page2)
  const hit = await contextMenuOn(page2, '[data-produced-files-row] button')
  await waitTick(page2)
  check('primitives 变体：右键同样被接管', hit.prevented === true)
  // 注意：item.icon 是 React 元素，不能在 evaluate 里整体返回——只取可序列化字段。
  const props = await page2.evaluate(() => ({
    open: window.__LAST_MENU_PROPS__.open,
    portal: window.__LAST_MENU_PROPS__.portal,
    compact: window.__LAST_MENU_PROPS__.compact,
    shape: window.__LAST_MENU_ITEMS__.map((entry) => (entry.type === 'separator' ? 'sep' : entry.id)).join(','),
    everyVerbHasIcon: window.__LAST_MENU_ITEMS__.filter((entry) => entry.type !== 'separator').every((entry) => entry.icon !== undefined && entry.icon !== null),
    submenu: window.__LAST_MENU_ITEMS__.find((entry) => entry.id === 'openwith').submenu.map((entry) => ({ id: entry.id, label: entry.label, disabled: entry.disabled })),
  }))
  check('传给 primitives Menu 的条目结构正确',
    props.open === true && props.portal === true && props.compact === true
    && props.shape === 'open,reveal,openwith,sep,saveas,copypath,copycontent',
    JSON.stringify(props))
  const submenuItems = props.submenu
  check('子菜单 id / 禁用 / 文案（未找到后缀）',
    JSON.stringify(submenuItems) === JSON.stringify([
      { id: 'app:visualstudio', label: 'Visual Studio', disabled: false },
      { id: 'app:terminal', label: '终端', disabled: false },
      { id: 'app:idea', label: 'IntelliJ IDEA（未找到）', disabled: true },
    ]), JSON.stringify(submenuItems))
  const verbIcons = await page2.evaluate(() => Array.from(document.querySelectorAll('.stub-btn .stub-icon')).map((el) => el.getAttribute('data-icon')))
  check('一级菜单每项都带平台 Fluent 图标（菜单条目里也有 icon）',
    JSON.stringify(verbIcons) === JSON.stringify(['browse', 'folder', 'rightup', 'download', 'link', 'copy']) && props.everyVerbHasIcon === true,
    JSON.stringify(verbIcons))
  const appIconSrcs = await page2.evaluate(() => Array.from(document.querySelectorAll('.stub-subitem img.dfow-appicon')).map((img) => img.getAttribute('src')))
  const appFallbackIcons = await page2.evaluate(() => Array.from(document.querySelectorAll('.stub-subitem .stub-icon')).map((el) => el.getAttribute('data-icon')))
  check('「打开方式」子菜单显示应用真实图标，缺图回退通用图标',
    appIconSrcs.length === 2 && appIconSrcs.every((src) => src.startsWith('data:image/png;base64,'))
    && JSON.stringify(appFallbackIcons) === JSON.stringify(['rightup']),
    `imgs=${JSON.stringify(appIconSrcs.length)} fallback=${JSON.stringify(appFallbackIcons)}`)
  const rect = await page2.evaluate(() => window.__LAST_MENU_PROPS__.getAnchorRect())
  check('锚点矩形指向右键位置', rect.right === 141 && rect.bottom === 161, JSON.stringify(rect))
  await page2.screenshot({ path: join(SHOTS, 'menu-primitives.png') })

  // 另存为 → 下载路由（真实鼠标点击，保留用户手势）
  const saveAsBox = await (await page2.$('[data-item-id="saveas"] .stub-btn')).boundingBox()
  await page2.mouse.click(saveAsBox.x + saveAsBox.width / 2, saveAsBox.y + saveAsBox.height / 2)
  const deadline = Date.now() + 4000
  while (seen.download.length === 0 && Date.now() < deadline) await waitTick(page2)
  const anchorClicks = await page2.evaluate(() => window.__ANCHOR_CLICKS__ ?? [])
  check('「另存为」触发下载路由（带绝对路径与 sessionId）',
    seen.download.length === 1 && seen.download[0].includes('path=D%3A%5Cproj%5Csrc%5Cindex.html') && seen.download[0].includes('sessionId=s1'),
    JSON.stringify(seen.download))
  check('「另存为」锚点契约正确（download 属性 + 绝对 URL）',
    anchorClicks.length === 1 && anchorClicks[0].download === 'index.html' && anchorClicks[0].href.startsWith(`${ORIGIN}/plugins/file-open-with/download?`),
    JSON.stringify(anchorClicks))
  check('primitives 变体无页面异常', errors2.length === 0, errors2.join(' | '))

  // 宿主返回 409 时的错误提示（idea 可用但宿主仍拒绝）
  await page2.goto(`${ORIGIN}/?menu=primitives&missing=none`, { waitUntil: 'load' })
  await waitTick(page2)
  await contextMenuOn(page2, '[data-produced-files-row] button')
  await waitTick(page2)
  await clickStub(page2, 'app:idea')
  await waitTick(page2)
  const failureNotice = await page2.evaluate(() => document.querySelector('.dfow-notice')?.textContent ?? null)
  check('宿主 409 时提示「未找到该应用」', failureNotice === '未找到该应用', String(failureNotice))
} finally {
  await browser.close()
  server.close()
}

const failed = results.filter((entry) => !entry.ok)
console.log(`\n${results.length - failed.length}/${results.length} 项通过`)
process.exit(failed.length === 0 ? 0 : 1)
