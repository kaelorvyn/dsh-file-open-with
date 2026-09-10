# dsh-file-open-with

给 DSH Web GUI 聊天里的**文件**加一个右键菜单——和 Codex 一样，右键蓝色文件链接就能对文件做操作。

## 菜单

| 菜单项 | 图标 | 行为 |
| --- | --- | --- |
| 打开文件 | 文件引用图标 | 在**右侧侧边栏**编辑器中打开（依赖 `dsh-better-sidebar`；未安装时回退系统默认程序） |
| 在资源管理器中打开 | 文件夹 | 打开资源管理器并选中该文件 |
| 打开方式 › | 外开箭头 | `Visual Studio` / `终端` / `IntelliJ IDEA`，**每项显示该应用自己的图标**；未安装的项置灰并标注「未找到」 |
| 另存为 | 下载 | 通过本地路由下载一份副本（浏览器/Electron 决定落盘位置） |
| 复制路径 | 链接 | 复制绝对路径到剪贴板 |
| 复制文件内容 | 复制 | 读取文本内容复制到剪贴板（上限 1 MB，二进制文件拒绝） |

图标来源：一级菜单用平台原语自带的 Fluent 图标（与 DSH 自身菜单同款；`primitives` 不可用时降级为无图标）；
「打开方式」的应用图标由宿主用 `System.Drawing` 从 exe 抽出 PNG、缓存为 data URL（抽不到则回退通用图标）。

## 网页链接菜单

右键正文里的 http(s) 链接（Markdown 链接、内联代码里的 URL）弹三项菜单：

| 菜单项 | 图标 | 行为 |
| --- | --- | --- |
| 打开网页 | 地球 | 在 **DSH 内置网页视图**里打开（`dsh-builtin-browser` 的 `ctx.browser`）；内置视图不可用或启动失败时自动改用外部浏览器 |
| 在外部浏览器中打开 | 外开箭头 | **Edge 优先**（Program Files / Program Files (x86) 下的 `msedge.exe`），系统里没有 Edge 就用默认浏览器（`rundll32 url.dll,FileProtocolHandler`） |
| 复制链接 | 链接 | 链接进剪贴板 |

只认 `http:` / `https:` 绝对 URL：`mailto:`、相对链接一律放行原生右键；宿主侧再校验一次协议，
`file:` / `javascript:` 直接 400 `bad-url`——不把任意字符串交给系统执行。

右键命中范围（其它区域一律保留原生右键菜单）：

| 来源 | 选择器 | 路径来源 |
| --- | --- | --- |
| 助手产物行的文件 chip | `[data-produced-files-row] button[title]` | `title` |
| 正文内联的蓝色文件引用 | `button[class*="fileMention"][title]` | `title` |
| `dsh-better-sidebar` 接管后的产物 chip | `button[class*="producedChip"][title]` | `title` |
| `dsh-files-native` 的附件 chip | `button.fr-chip[title]` | `title` |
| 思考/工具行里的文件链接（读取·写入·编辑） | `button[class*="fileLink"]` | 按钮文本（cwd 相对或绝对，无截断） |
| 正文里的网页链接 | `a[href^="http://"]`、`a[href^="https://"]` | `href`（弹三项链接菜单，见上） |

工具行按钮没有 `title`，但它的可见文本就是路径——官方只做「去掉 cwd 前缀」处理，
不截断、Windows 下也不缩成 `~`，所以相对路径按会话 cwd 还原；URL 文本不当作路径。

## 安装

```powershell
# 1) 依赖 + bundles 行（等价于 dsh plugin --profile desktop add <目录> 的效果）
#    package.json: dependencies 增加
#      "dsh-file-open-with": "file:C:/Users/Administrator/.dsh/plugins-src/dsh-file-open-with"
#    package.json: dsh.profile.bundles 增加 "dsh-file-open-with"
# 2) 让包在 profile 的 node_modules 里可解析（开发期用 junction，改源码即时生效）
New-Item -ItemType Junction `
  -Path "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-file-open-with" `
  -Target "$env:USERPROFILE\.dsh\plugins-src\dsh-file-open-with"
# 3) 重启一次 DSH Desktop（bundles 只在启动时读取）
```

> **patchReload: live 的坑**：实测 DSH Desktop 2.0.5 上，profile 的 `patchReload: live`
> 对**新增 insert 行**不生效（改完 `cordis.patch.yml` 后插件路由仍 404，两次 touch 也无变化），
> 所以本机走 `dsh.profile.bundles` + 一次重启。**两条激活路径只能留一条**，否则重复注册。

## 验证

三套可复跑的脚本都在 `.verify/`（不随包发布）：

| 脚本 | 覆盖 |
| --- | --- |
| `host-test.mjs` | 假 ctx 挂载真实 `lib/index.js`：33 项，含 403 栅栏、盘符相对/相对路径解析、1 MB 与 NUL 二进制边界、`content-disposition`、**每个应用都带真实 exe 图标 data URL**、真实 reveal 与终端启动各一次、**带空格路径 reveal 真的选中且窗口可见未最小化（`Shell.Application` + Win32 判定）**、**网页动作的协议白名单与 Edge 优先（真开一个标签页）**、disposer 拆除 |
| `client-test.mjs` | 无头 Edge 加载真实 `lib/client.js`：47 项，含右键命中与放行、**工具行 fileLink 相对/绝对路径还原**、**链接菜单三项/图标/剪贴板/网页动作载荷/内置视图退回提示/mailto 与相对链接不接管**、**一级菜单六项都带图标、子菜单显示应用图标并回退**、中英文条目、子菜单置灰、剪贴板、下载、Escape、primitives 与自绘两种菜单 |
| `live-gui-test.mjs` | 隔离 `DSH_HOME`（`~/.dsh-verify`）真启动 profile（bundles 挂载 `dsh-builtin-browser`）→ 打开它自己的 Web GUI：26 项，含 boot 清单、宿主路由、真实平台 Menu 的条目/顺序/子菜单、**真实菜单 6 个平台图标 + 子菜单 3 个真实应用图标**、**工具行链接弹同一菜单、带空格路径真的被选中且窗口可见**、**链接菜单三项/图标/复制链接/「打开网页」真的走内置网页视图**、普通右键不接管 |
| `probe-reveal.mjs` / `probe-visibility.mjs` / `probe-live.mjs` | 定位工具：分别探测 `explorer.exe /select` 的 argv 形态、`windowsHide` 对窗口可见性的影响、运行中的宿主是否已加载新代码 |

```powershell
node .verify\host-test.mjs
node .verify\client-test.mjs
# live-gui-test 需要先起一个隔离宿主（端口以它打印的 URL 为准）：
$env:DSH_HOME="$env:USERPROFILE\.dsh-verify"
node "D:\DSH Desktop\resources\app.asar.unpacked\node_modules\@deepseek-ai\dsh\lib\bin.js" --profile verify --no-open
node .verify\live-gui-test.mjs
```

## 宿主路由

全部挂在前缀 `/plugins/file-open-with` 下，必须与本机 GUI 同源（Host 为 loopback、
Origin 同源、非 cross-site），否则一律 403——DSH 不为插件路由提供鉴权，这是插件
自己加的栅栏。

| 路由 | 入参 | 说明 |
| --- | --- | --- |
| `GET /apps` | `?refresh=1` | 返回 `{ok, apps:[{id, available, icon}]}`；`icon` 是 exe 真实图标的 PNG data URL（缓存于 `%TEMP%\dsh-file-open-with-icons`） |
| `POST /reveal` | `{path, sessionId?}` | `explorer.exe /select,<path>` |
| `POST /open-with` | `{appId, path, sessionId?}` | 用指定应用打开（argv 数组，无 shell） |
| `POST /text` | `{path, sessionId?}` | 文本内容，1 MB 上限、含 NUL 视为二进制 |
| `POST /webview` | `{url}` | 「打开网页」：`ctx.browser`（`dsh-builtin-browser`）开内置网页视图；不可用则退回外部浏览器，返回 `{browser:"builtin"\|"edge"\|"default"}` |
| `POST /open-external` | `{url}` | 「在外部浏览器中打开」：Edge 优先，其次系统默认浏览器 |
| `GET /download` | `?path=&sessionId=` | 附件流下载（「另存为」用） |

相对路径按 `sessionId` 对应会话的 cwd 解析；绝对路径原样使用；`C:foo` 这类盘符
相对路径一律拒绝。

## 已知限制

- **仅 Windows**：`/reveal`、`/open-with`、`/webview`、`/open-external` 在非 Windows 宿主返回 409，菜单项仍会显示。
- **另存为**不是原生保存对话框：DSH 没有向插件暴露系统的保存面板，这里走下载流。
- 侧边栏文件树的右键菜单属于 `dsh-better-sidebar`，本插件不介入。
- 工具行文件链接靠按钮文本取路径；若官方将来改为截断显示，需要改成从折叠行体里的参数 JSON 取。
- **「打开网页」依赖 `dsh-builtin-browser` 能起 Electron**：该插件只在 profile 的
  `node_modules/electron/dist/` 或 `$DSH_HOME/profiles/node_modules` 找二进制（不看 `$DSH_HOME/electron`）。
  本机把 `~/.dsh/electron`（裸 Electron 发行版）junction 到
  `~/.dsh/profiles/desktop/node_modules/electron/dist` 即可；找不到就自动退回外部浏览器，功能不丢。

## 结构

```
cordis.patch.yml   宿主行（insert file-open-with）
lib/index.js       宿主半部：路由 + 栅栏 + 应用/图标解析 + argv spawn
lib/client.js      浏览器半部：contextmenu 捕获 + 菜单 + 动作分发
.verify/           可复跑的四层验证脚本与其产物（不随包发布）
```

## 实现要点（为什么这么写）

- **右键识别**：带 `title` 的 chip 读 `title`，工具行文件链接读按钮文本（`deriveSummary`
  与 `deriveFilePath` 同源同键，官方只做 cwd 相对化）；捕获阶段拦截，`preventDefault`
  只在命中时调用。全平台没有第二个 `contextmenu` 处理器，不存在竞争。
- **菜单用平台原语**：`@deepseek-ai/dsh-client-ui-primitives` 的 `Menu`（portal + `getAnchorRect`
  钉在指针位置、自带「点外部/Escape 关闭」）；原语不可用时退到同款自绘菜单，功能不减。
  自绘菜单才需要自己挂外部关闭监听——给平台 Menu 再挂一层会抢在菜单项点击之前关掉菜单。
- **`explorer.exe` 必须收两个参数**：`['/select,', path]`。写成单个 `/select,<path>` 时
  Node 会把整串加引号，Explorer 解析不到开关——路径带空格（如 `D:\DSH Desktop\…`）
  就完全没反应；拆开后带空格也能正确选中（用 `Shell.Application` 判定窗口选中项的实测结论）。
- **`windowsHide` 必须显式给 `false`**：Node 默认 `true`，它会设置子进程的启动显示状态为隐藏，
  Explorer / Windows Terminal 这类「窗口交给系统 shell 代建」的程序会照着建出**不可见**窗口
  （`IsWindowVisible=false`），用户看到的就是「点了菜单什么都没发生」。实测同一路径：
  `windowsHide:true` → `visible=false`；`false` → `visible=true` 且未最小化。**只验证「窗口存在、
  选中项正确」是不够的，必须同时验可见性。**
- **可选协作者不进 `inject`**：`betterSidebar` / `remote.session` 都用 `ctx.get` 读取，
  Cordis 的 `inject` 是硬依赖，写进去会让缺插件的环境直接不激活。
- **图标走平台自己的图标集**：`@deepseek-ai/dsh-client-ui-primitives` 已导出整套 Fluent 图标
  （`IconFolderOpenOutline16` / `IconCopyOutline16` / `IconLinkOutline16` / `IconDownloadOutline16` /
  `IconRightUpOutline16` / `IconBrowseOutline16`），直接用它们才和 DSH 自己的菜单一致，不必自带 SVG。
- **应用图标从 exe 抽**：`System.Drawing.Icon::ExtractAssociatedIcon` 抽一次落盘缓存（键含 exe 路径，
  换版本自动失效）。注意 `Bitmap.Save` 到不存在的目录会抛 GDI+ 通用错误，**先建目录**。
- **宿主只 spawn 固定可执行文件**，文件路径是唯一变量且始终是一个 argv 元素，没有 shell 字符串。
- **URL 只走 `http:` / `https:`**：客户端按协议前缀认链接，宿主再 `new URL()` 校验一次协议后
  才交给浏览器或系统；`file:` / `javascript:` 这类能落到系统执行的 scheme 直接拒绝。

