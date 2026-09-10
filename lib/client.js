/**
 * dsh-file-open-with — 浏览器半部。
 *
 * 在聊天里给「文件」加右键菜单：产物 chip、正文内联路径 chip、其它插件渲染的
 * 文件 chip（都带 title=<路径>）右键即弹出菜单——打开文件（右侧侧边栏）、
 * 在资源管理器中打开、打开方式（Visual Studio / 终端 / IntelliJ IDEA）、
 * 另存为、复制路径、复制文件内容。
 *
 * 手写 bundle，格式与官方客户端插件一致（window.__ModuleLoader__.load），
 * 只 require 平台种子模块（react，以及可选的 ui-primitives 菜单）。
 *
 * 三个约束保证了不打扰既有行为：
 *   1. 只有命中白名单选择器（元素自带 title 路径）才 preventDefault，其余右键
 *      一律放行原生菜单；
 *   2. 只监听 document 的 contextmenu 捕获阶段——DSH 核心与本机其它插件都没有
 *      contextmenu 处理器，不存在竞争；
 *   3. 可选的协作者（betterSidebar / remote.session）一律用 ctx.get 读取，
 *      不写进 inject，插件不会因为缺少它们而无法激活。
 */

window.__ModuleLoader__.load({
	id: "dsh-file-open-with",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let primitives = null;
		try {
			primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		} catch (error) {
			primitives = null;
		}

		const ROUTE_PREFIX = "/plugins/file-open-with";
		const MENU_WIDTH = 232;
		const MENU_ROW_HEIGHT = 30;
		const VIEWPORT_MARGIN = 12;

		/**
		 * 带 `title=<路径>` 的文件 chip：产物行、正文内联引用、better-sidebar 接管后的
		 * 产物 chip、files-native 附件 chip。
		 */
		const SELECTORS = [
			"[data-produced-files-row] button[title]",
			'button[class*="fileMention"][title]',
			'button[class*="producedChip"][title]',
			"button.fr-chip[title]",
		];

		/**
		 * 工具行（读取/写入/编辑）的文件链接按钮没有 title，但它的可见文本就是文件路径：
		 * 官方只对它做「去掉 cwd 前缀」处理，不截断、Windows 下也不会缩成 `~`，
		 * 所以相对路径按会话 cwd 还原即可（`deriveSummary` 与 `deriveFilePath` 同源同键）。
		 */
		const TEXT_SELECTORS = ['button[class*="fileLink"]'];

		/**
		 * 网页链接：聊天里的 Markdown 链接就是普通 `<a href="http(s)://…" target="_blank">`
		 * （官方 `renderSafeLink` 只给 http/https 加 safe 属性），所以按协议前缀认。
		 */
		const WEB_SELECTORS = ['a[href^="http://"]', 'a[href^="https://"]'];

		const DICTIONARY = {
			zh: {
				open: "打开文件",
				reveal: "在资源管理器中打开",
				openWith: "打开方式",
				saveAs: "另存为",
				copyPath: "复制路径",
				copyContent: "复制文件内容",
				openWeb: "打开网页",
				openExternal: "在外部浏览器中打开",
				copyUrl: "复制链接",
				missing: "未找到",
				appLabels: { visualstudio: "Visual Studio", terminal: "终端", idea: "IntelliJ IDEA" },
				notices: {
					path: "无法解析文件路径",
					openFailed: "打开失败",
					sidebar: "右侧边栏不可用，已改用系统默认程序",
					revealed: "已在资源管理器中定位",
					launched: "已用所选应用打开",
					saved: "已开始保存",
					copiedPath: "已复制路径",
					copiedContent: "已复制文件内容",
					copiedUrl: "已复制链接",
					openedWeb: "已在网页中打开",
					openedExternal: "已用外部浏览器打开",
					copyFailed: "复制失败，请手动复制",
					forbidden: "请求被拒绝（仅允许本机访问）",
					badPath: "路径无效",
					badUrl: "链接无效",
					notFound: "文件不存在",
					notFile: "目标不是文件",
					appMissing: "未找到该应用",
					appBad: "未知的应用",
					tooLarge: "文件过大（上限 1 MB）",
					notText: "不是文本文件",
					spawnFailed: "启动应用失败",
					unsupported: "当前平台不支持该动作",
					internal: "宿主处理失败",
				},
			},
			en: {
				open: "Open file",
				reveal: "Reveal in File Explorer",
				openWith: "Open with",
				saveAs: "Save as",
				copyPath: "Copy path",
				copyContent: "Copy file content",
				openWeb: "Open page",
				openExternal: "Open in external browser",
				copyUrl: "Copy link",
				missing: "not found",
				appLabels: { visualstudio: "Visual Studio", terminal: "Terminal", idea: "IntelliJ IDEA" },
				notices: {
					path: "Cannot resolve the file path",
					openFailed: "Open failed",
					sidebar: "Right sidebar unavailable — using the system default app",
					revealed: "Revealed in File Explorer",
					launched: "Opened with the selected app",
					saved: "Saving…",
					copiedPath: "Path copied",
					copiedContent: "File content copied",
					copiedUrl: "Link copied",
					openedWeb: "Opened in the page",
					openedExternal: "Opened in the external browser",
					copyFailed: "Copy failed — copy manually",
					forbidden: "Request denied (loopback only)",
					badPath: "Invalid path",
					badUrl: "Invalid link",
					notFound: "File not found",
					notFile: "Target is not a file",
					appMissing: "Application not found",
					appBad: "Unknown application",
					tooLarge: "File too large (1 MB limit)",
					notText: "Not a text file",
					spawnFailed: "Failed to launch the application",
					unsupported: "Not supported on this platform",
					internal: "Host request failed",
				},
			},
		};

		const ERROR_NOTICE_KEYS = {
			forbidden: "forbidden",
			"bad-path": "badPath",
			"bad-url": "badUrl",
			"bad-body": "badPath",
			"bad-app": "appBad",
			"not-found": "notFound",
			"not-file": "notFile",
			"app-unavailable": "appMissing",
			"too-large": "tooLarge",
			"not-text": "notText",
			"spawn-failed": "spawnFailed",
			unsupported: "unsupported",
			internal: "internal",
		};

		const CSS = [
			".dfow-nav{position:fixed;z-index:30;box-sizing:border-box;padding:4px;min-width:" + MENU_WIDTH + "px",
			"border:1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.12));border-radius:10px",
			"background:var(--dsw-alias-bg-layer-2, #fff);box-shadow:0 8px 28px rgba(0,0,0,.18)",
			"color:var(--dsw-alias-label-primary, #111);font-size:13px;line-height:20px;pointer-events:auto}",
			".dfow-row{position:relative}",
			".dfow-item{display:flex;align-items:center;gap:8px;width:100%;box-sizing:border-box;padding:5px 10px",
			"border:none;border-radius:7px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}",
			".dfow-item:disabled{color:var(--dsw-alias-label-tertiary, #999);cursor:default}",
			".dfow-item:not(:disabled):hover,.dfow-item:focus-visible{background:var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.06));outline:none}",
			".dfow-text{flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
			".dfow-icon{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;color:currentColor}",
			".dfow-appicon{flex:0 0 auto;width:16px;height:16px;border-radius:3px;display:block}",
			".dfow-hint{flex:0 0 auto;color:var(--dsw-alias-label-tertiary, #999);font-size:12px}",
			".dfow-arrow{flex:0 0 auto;color:var(--dsw-alias-label-tertiary, #999)}",
			".dfow-sep{height:1px;margin:4px 6px;background:var(--dsw-alias-border-l1, rgba(0,0,0,.08))}",
			".dfow-sub{display:none;position:absolute;left:100%;top:-5px;margin-left:4px;min-width:180px;padding:4px;",
			"border:1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.12));border-radius:10px",
			"background:var(--dsw-alias-bg-layer-2, #fff);box-shadow:0 8px 28px rgba(0,0,0,.18)}",
			".dfow-row:hover>.dfow-sub,.dfow-row:focus-within>.dfow-sub{display:block}",
			".dfow-notice{position:fixed;left:50%;bottom:36px;transform:translateX(-50%);z-index:31;pointer-events:none;",
			"padding:7px 14px;border-radius:999px;background:var(--dsw-alias-bg-layer-3, rgba(24,24,24,.88))",
			"color:var(--dsw-alias-label-primary-inverse, #fff);font-size:13px;line-height:20px}",
		].join("");

		function ensureStyles() {
			if (typeof document === "undefined") return;
			if (document.querySelector('style[data-plugin-css="dsh-file-open-with"]') !== null) return;
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-file-open-with";
			tag.dataset.pluginCss = "dsh-file-open-with";
			tag.textContent = CSS;
			document.head.appendChild(tag);
		}

		//#region 纯工具

		function dictionaryFor(ctx) {
			let active = "";
			try {
				active = String(ctx.get("locale")?.getSnapshot?.().active ?? "");
			} catch (error) {
				active = "";
			}
			return active.toLowerCase().startsWith("en") ? DICTIONARY.en : DICTIONARY.zh;
		}

		function isAbsolutePath(value) {
			return /^[a-zA-Z]:[\\/]/.test(value) || /^\\\\/.test(value) || value.startsWith("/");
		}

		function joinPath(base, relative) {
			const separator = base.includes("\\") ? "\\" : "/";
			const tail = relative.replace(/^[\\/]+/, "").replace(/[\\/]/g, separator);
			return base.replace(/[\\/]+$/, "") + separator + tail;
		}

		function baseName(value) {
			const index = Math.max(value.lastIndexOf("/"), value.lastIndexOf("\\"));
			return index === -1 ? value : value.slice(index + 1);
		}

		function sessionsSnapshotOf(ctx) {
			try {
				return ctx.get("sessions")?.list?.getSnapshot?.();
			} catch (error) {
				return undefined;
			}
		}

		function currentSessionIdOf(ctx) {
			const snapshot = sessionsSnapshotOf(ctx);
			const current = snapshot?.current;
			return typeof current === "string" && current !== "" ? current : undefined;
		}

		function currentCwdOf(ctx) {
			const snapshot = sessionsSnapshotOf(ctx);
			const current = currentSessionIdOf(ctx);
			if (current === undefined) return undefined;
			const cwd = snapshot?.byId?.[current]?.cwd;
			return typeof cwd === "string" && cwd !== "" ? cwd : undefined;
		}

		/** 命中白名单选择器才返回路径；否则返回 null（调用方放行原生右键）。 */
		function filePathFrom(target) {
			if (target === null || typeof target.closest !== "function") return null;
			for (const selector of SELECTORS) {
				const element = closestOrNull(target, selector);
				if (element === null) continue;
				const title = element.getAttribute("title");
				if (typeof title === "string" && title.trim() !== "") return title.trim();
			}
			for (const selector of TEXT_SELECTORS) {
				const element = closestOrNull(target, selector);
				if (element === null) continue;
				const text = String(element.textContent ?? "").trim();
				// URL 或空/超长文本不当路径用；其余交给宿主按 cwd 还原。
				if (text === "" || text.length > 512 || /\n/.test(text) || /^[a-z][a-z0-9+.-]*:\/\//i.test(text)) continue;
				return text;
			}
			return null;
		}

		/** 命中 http(s) 链接才返回绝对 URL；否则返回 null（调用方放行原生右键）。 */
		function webUrlFrom(target) {
			if (target === null || typeof target.closest !== "function") return null;
			for (const selector of WEB_SELECTORS) {
				const element = closestOrNull(target, selector);
				if (element === null) continue;
				const href = element.getAttribute("href");
				if (typeof href !== "string" || href.trim() === "") continue;
				try {
					const url = new URL(href.trim(), window.location.href);
					if (url.protocol === "http:" || url.protocol === "https:") return url.href;
				} catch (error) {
					/* 解析不了就当没命中。 */
				}
			}
			return null;
		}

		function closestOrNull(target, selector) {
			try {
				return target.closest(selector);
			} catch (error) {
				return null;
			}
		}

		function clampToViewport(x, y, rows) {
			const width = window.innerWidth;
			const height = window.innerHeight;
			const menuHeight = rows * MENU_ROW_HEIGHT + 16;
			return {
				x: Math.min(Math.max(x, VIEWPORT_MARGIN), Math.max(VIEWPORT_MARGIN, width - MENU_WIDTH - VIEWPORT_MARGIN)),
				y: Math.min(Math.max(y, VIEWPORT_MARGIN), Math.max(VIEWPORT_MARGIN, height - menuHeight - VIEWPORT_MARGIN)),
			};
		}

		//#endregion

		/**
		 * 菜单项图标：直接用平台原语导出的 Fluent 图标，和 DSH 自己的菜单同款；
		 * 原语不可用时返回 null（自绘菜单降级为无图标，不影响功能）。
		 * 映射理由：打开文件=文件引用图标、资源管理器=文件夹、打开方式=外开箭头、
		 * 另存为=下载、复制路径=链接、复制内容=复制。
		 */
		const VERB_ICONS = {
			open: "IconBrowseOutline16",
			reveal: "IconFolderOpenOutline16",
			openwith: "IconRightUpOutline16",
			saveas: "IconDownloadOutline16",
			copypath: "IconLinkOutline16",
			copycontent: "IconCopyOutline16",
			openweb: "IconGlobeOutline14",
			openexternal: "IconRightUpOutline16",
			copyurl: "IconLinkOutline16",
		};

		function verbIcon(id) {
			const name = VERB_ICONS[id];
			const component = primitives === null ? undefined : primitives[name];
			if (typeof component !== "function") return null;
			return react.createElement(component, { size: 16 });
		}

		/** 应用图标是宿主从 exe 抽出来的 PNG data URL；没有就退回通用外开图标。 */
		function appIconNode(dataUrl) {
			if (typeof dataUrl === "string" && dataUrl.startsWith("data:image/")) {
				return react.createElement("img", { className: "dfow-appicon", src: dataUrl, width: 16, height: 16, alt: "", "aria-hidden": true });
			}
			return verbIcon("openwith");
		}

		function createOverlay(ctx) {
			const t = dictionaryFor(ctx);

			/** 链接菜单只有三项；文件菜单带「打开方式」子菜单。 */
			function buildItems(apps, kind) {
				if (kind === "url") {
					return [
						{ id: "openweb", label: t.openWeb, icon: verbIcon("openweb") },
						{ id: "openexternal", label: t.openExternal, icon: verbIcon("openexternal") },
						{ id: "copyurl", label: t.copyUrl, icon: verbIcon("copyurl") },
					];
				}
				const appEntries = (apps ?? []).map((entry) => ({
					id: "app:" + entry.id,
					label: t.appLabels[entry.id] ?? entry.id,
					disabled: entry.available !== true,
					hint: entry.available === true ? "" : t.missing,
					icon: appIconNode(entry.icon),
				}));
				return [
					{ id: "open", label: t.open, icon: verbIcon("open") },
					{ id: "reveal", label: t.reveal, icon: verbIcon("reveal") },
					{ id: "openwith", label: t.openWith, icon: verbIcon("openwith"), submenu: appEntries },
					{ type: "separator", id: "sep-1" },
					{ id: "saveas", label: t.saveAs, icon: verbIcon("saveas") },
					{ id: "copypath", label: t.copyPath, icon: verbIcon("copypath") },
					{ id: "copycontent", label: t.copyContent, icon: verbIcon("copycontent") },
				];
			}

			return function FileOpenWithOverlay() {
				const menuState = react.useState(null);
				const menu = menuState[0];
				const setMenu = menuState[1];
				const appsState = react.useState(null);
				const apps = appsState[0];
				const setApps = appsState[1];
				const noticeState = react.useState(null);
				const notice = noticeState[0];
				const setNotice = noticeState[1];
				const timerRef = react.useRef(null);

				const showNotice = react.useCallback((text) => {
					setNotice(text);
					if (timerRef.current !== null) window.clearTimeout(timerRef.current);
					timerRef.current = window.setTimeout(() => {
						timerRef.current = null;
						setNotice(null);
					}, 2600);
				}, []);

				react.useEffect(() => () => {
					if (timerRef.current !== null) window.clearTimeout(timerRef.current);
				}, []);

				const loadApps = react.useCallback(async () => {
					try {
						const response = await fetch(ROUTE_PREFIX + "/apps");
						const data = await response.json();
						if (data?.ok === true) setApps(data.apps ?? []);
					} catch (error) {
						setApps([]);
					}
				}, []);

				const absolutize = react.useCallback((rawPath) => {
					if (isAbsolutePath(rawPath)) return rawPath;
					const cwd = currentCwdOf(ctx);
					if (cwd === undefined) return null;
					return joinPath(cwd, rawPath);
				}, []);

				const postJson = react.useCallback(async (route, body) => {
					try {
						const response = await fetch(ROUTE_PREFIX + route, {
							method: "POST",
							headers: { "content-type": "application/json" },
							body: JSON.stringify({ ...body, sessionId: currentSessionIdOf(ctx) }),
						});
						const data = await response.json().catch(() => null);
						if (response.ok && data?.ok === true) return data;
						showNotice(t.notices[ERROR_NOTICE_KEYS[data?.error] ?? "internal"]);
						return null;
					} catch (error) {
						showNotice(t.notices.internal);
						return null;
					}
				}, [showNotice]);

				const copyText = react.useCallback(async (text, okMessage) => {
					try {
						await navigator.clipboard.writeText(text);
						showNotice(okMessage);
						return;
					} catch (error) {
						/* 回退到 execCommand。 */
					}
					try {
						const area = document.createElement("textarea");
						area.value = text;
						area.setAttribute("readonly", "readonly");
						area.style.position = "fixed";
						area.style.top = "-1000px";
						area.style.opacity = "0";
						document.body.appendChild(area);
						area.select();
						const copied = document.execCommand("copy");
						document.body.removeChild(area);
						showNotice(copied ? okMessage : t.notices.copyFailed);
					} catch (error) {
						showNotice(t.notices.copyFailed);
					}
				}, [showNotice]);

				const openInSidebar = react.useCallback((absolute) => {
					const sessionId = currentSessionIdOf(ctx);
					let sidebar = null;
					try {
						sidebar = ctx.get("betterSidebar") ?? null;
					} catch (error) {
						sidebar = null;
					}
					const features = Array.isArray(sidebar?.features) ? sidebar.features : [];
					if (sidebar !== null && typeof sidebar.openFile === "function" && features.includes("openFile") && sessionId !== undefined) {
						sidebar.openFile({ sessionId }, absolute, baseName(absolute));
						return;
					}
					if (sidebar !== null && typeof sidebar.openTab === "function") {
						sidebar.openTab({ type: "editor", title: baseName(absolute), path: absolute, id: "editor:" + absolute });
						return;
					}
					const remote = ctx.get("remote.session");
					if (remote !== null && remote !== undefined && typeof remote.openWorkspacePath === "function") {
						showNotice(t.notices.sidebar);
						void remote.openWorkspacePath({ path: absolute });
						return;
					}
					showNotice(t.notices.sidebar);
				}, [showNotice]);

				const run = react.useCallback(async (id, rawValue, kind) => {
					if (kind === "url") {
						if (id === "copyurl") {
							await copyText(rawValue, t.notices.copiedUrl);
							return;
						}
						if (id === "openweb") {
							// 宿主优先用内置网页视图；内置浏览器不可用时它会自己退回外部浏览器，
							// 返回值告诉客户端该提示哪一句。
							const data = await postJson("/webview", { url: rawValue });
							if (data !== null) showNotice(data.browser === "builtin" ? t.notices.openedWeb : t.notices.openedExternal);
							return;
						}
						if (id === "openexternal") {
							if (await postJson("/open-external", { url: rawValue }) !== null) showNotice(t.notices.openedExternal);
						}
						return;
					}
					const absolute = absolutize(rawValue);
					if (absolute === null) {
						showNotice(t.notices.path);
						return;
					}
					if (id === "open") {
						openInSidebar(absolute);
						return;
					}
					if (id === "reveal") {
						if (await postJson("/reveal", { path: absolute }) !== null) showNotice(t.notices.revealed);
						return;
					}
					if (id.startsWith("app:")) {
						const appId = id.slice(4);
						if (await postJson("/open-with", { appId, path: absolute }) !== null) showNotice(t.notices.launched);
						return;
					}
					if (id === "saveas") {
						const link = document.createElement("a");
						const sessionId = currentSessionIdOf(ctx);
						link.href = ROUTE_PREFIX + "/download?path=" + encodeURIComponent(absolute)
							+ (sessionId === undefined ? "" : "&sessionId=" + encodeURIComponent(sessionId));
						link.download = baseName(absolute);
						link.style.display = "none";
						document.body.appendChild(link);
						link.click();
						document.body.removeChild(link);
						showNotice(t.notices.saved);
						return;
					}
					if (id === "copypath") {
						await copyText(absolute, t.notices.copiedPath);
						return;
					}
					if (id === "copycontent") {
						const data = await postJson("/text", { path: absolute });
						if (data !== null) await copyText(String(data.text ?? ""), t.notices.copiedContent);
					}
				}, [absolutize, copyText, openInSidebar, postJson, showNotice]);

				react.useEffect(() => {
					const onContextMenu = (event) => {
						const url = webUrlFrom(event.target);
						if (url !== null) {
							event.preventDefault();
							event.stopPropagation();
							setMenu({ kind: "url", value: url, x: event.clientX, y: event.clientY });
							return;
						}
						const path = filePathFrom(event.target);
						if (path === null) return;
						event.preventDefault();
						event.stopPropagation();
						setMenu({ kind: "file", value: path, x: event.clientX, y: event.clientY });
					};
					document.addEventListener("contextmenu", onContextMenu, true);
					return () => { document.removeEventListener("contextmenu", onContextMenu, true); };
				}, []);

				const usesPrimitives = primitives !== null && typeof primitives.Menu === "function";

				react.useEffect(() => {
					if (menu === null) return;
					// 只有文件菜单需要应用列表；链接菜单三项都不依赖它，别白跑一次请求。
					if (menu.kind === "file" && apps === null) void loadApps();
					/**
					 * primitives 的 Menu 自己监听 pointerdown / Escape 关闭菜单，这里再挂一层会在
					 * 点击菜单项时抢先关掉菜单、让这一击落空；只有自绘菜单需要兜底。
					 */
					if (usesPrimitives) return;
					const onPointerDown = (event) => {
						const element = event.target;
						if (element !== null && typeof element.closest === "function" && element.closest(".dfow-nav") !== null) return;
						setMenu(null);
					};
					const onKeyDown = (event) => {
						if (event.key === "Escape") setMenu(null);
					};
					document.addEventListener("pointerdown", onPointerDown, true);
					document.addEventListener("keydown", onKeyDown, true);
					return () => {
						document.removeEventListener("pointerdown", onPointerDown, true);
						document.removeEventListener("keydown", onKeyDown, true);
					};
				}, [menu, apps, loadApps, usesPrimitives]);

				if (menu === null) {
					return notice === null ? null : react.createElement("div", { className: "dfow-notice" }, notice);
				}

				const items = buildItems(apps, menu.kind);
				const anchor = react.createElement("span", {
					key: "anchor",
					style: { position: "fixed", left: menu.x, top: menu.y, width: 1, height: 1, pointerEvents: "none" },
				});
				const placeholder = react.createElement("span", { key: "anchor", style: { display: "none" } });

				const menuElement = usesPrimitives
					? react.createElement(primitives.Menu, {
						key: "menu",
						open: true,
						compact: true,
						portal: true,
						anchor: placeholder,
						items: items.map((entry) => entry.type === "separator"
							? entry
							: {
								id: entry.id,
								label: entry.hint === undefined || entry.hint === ""
									? entry.label
									: entry.label + "（" + entry.hint + "）",
								icon: entry.icon === null || entry.icon === undefined ? undefined : entry.icon,
								disabled: entry.disabled === true,
								submenu: entry.submenu === undefined ? undefined : entry.submenu.map((sub) => ({
									id: sub.id,
									label: sub.hint === undefined || sub.hint === "" ? sub.label : sub.label + "（" + sub.hint + "）",
									icon: sub.icon === null || sub.icon === undefined ? undefined : sub.icon,
									disabled: sub.disabled === true,
								})),
							}),
						getAnchorRect: () => ({ left: menu.x, top: menu.y, right: menu.x + 1, bottom: menu.y + 1, width: 1, height: 1 }),
						onSelect: (id) => { setMenu(null); void run(id, menu.value, menu.kind); },
						onClose: () => { setMenu(null); },
					})
					: react.createElement(FallbackMenu, {
						key: "menu",
						items,
						x: menu.x,
						y: menu.y,
						onSelect: (id) => { setMenu(null); void run(id, menu.value, menu.kind); },
					});

				return react.createElement(react.Fragment, null, anchor, menuElement,
					notice === null ? null : react.createElement("div", { className: "dfow-notice", key: "notice" }, notice));
			};
		}

		/** primitives 不可用时的自绘菜单：同样的条目、同样的两级结构、同样视口钳制。 */
		function FallbackMenu(props) {
			const place = clampToViewport(props.x, props.y, props.items.length);
			const rows = props.items.map((entry, index) => {
				if (entry.type === "separator") return react.createElement("div", { className: "dfow-sep", key: entry.id ?? index });
				const label = react.createElement(react.Fragment, null,
					entry.icon === null || entry.icon === undefined ? null : react.createElement("span", { className: "dfow-icon" }, entry.icon),
					react.createElement("span", { className: "dfow-text" }, entry.label),
					entry.hint !== undefined && entry.hint !== "" ? react.createElement("span", { className: "dfow-hint" }, entry.hint) : null,
					entry.submenu !== undefined ? react.createElement("span", { className: "dfow-arrow" }, "›") : null);
				const button = react.createElement("button", {
					type: "button",
					className: "dfow-item",
					disabled: entry.disabled === true,
					onClick: () => {
						if (entry.submenu !== undefined || entry.disabled === true) return;
						props.onSelect(entry.id);
					},
				}, label);
				const submenu = entry.submenu === undefined ? null : react.createElement("div", { className: "dfow-sub" },
					entry.submenu.map((sub) => react.createElement("button", {
						type: "button",
						className: "dfow-item",
						key: sub.id,
						disabled: sub.disabled === true,
						onClick: () => { if (sub.disabled !== true) props.onSelect(sub.id); },
					}, sub.icon === null || sub.icon === undefined ? null : react.createElement("span", { className: "dfow-icon" }, sub.icon),
					react.createElement("span", { className: "dfow-text" }, sub.label),
					sub.hint !== undefined && sub.hint !== "" ? react.createElement("span", { className: "dfow-hint" }, sub.hint) : null)));
				return react.createElement("div", { className: "dfow-row", key: entry.id ?? index }, button, submenu);
			});
			return react.createElement("div", {
				className: "dfow-nav",
				style: { left: place.x + "px", top: place.y + "px", width: MENU_WIDTH + "px" },
				role: "menu",
			}, rows);
		}

		const inject = ["slots", "sessions"];

		function apply(ctx) {
			ensureStyles();
			const Overlay = createOverlay(ctx);
			const safeInject = (slot, register) => {
				try {
					ctx.slots.inject(slot, () => {
						try {
							return register();
						} catch (error) {
							ctx.logger?.warn?.(`[file-open-with] skip ${slot} registration: ${String(error?.message ?? error)}`);
							return () => {};
						}
					});
				} catch (error) {
					ctx.logger?.warn?.(`[file-open-with] skip ${slot} inject: ${String(error?.message ?? error)}`);
				}
			};
			safeInject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "file-open-with",
				order: 10,
			}, Overlay));
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
