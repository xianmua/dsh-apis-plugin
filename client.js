// 浏览器半侧：在「插件配置」标签页为 dsh-apis-plugin 命名空间注册一张展示卡片
// 接口的增删以 cfg 文件为唯一来源：这里只读展示集合手风琴，编辑请改 cfg 后点「扫描」重扫
// API 目录失焦或点「扫描」时自动保存，无页脚按钮
window.__ModuleLoader__.load({
	id: "dsh-apis-plugin",
	factory: (require) => {
		const { jsx, jsxs } = require("react/jsx-runtime");
		const react = require("react");

		/** 本卡片编辑的 settings 命名空间，由宿主侧 index.js 按 cordis.patch.yml 的 id 自动回写 */
		const NS = "dsh-apis-plugin";

		/** bind 后的命名空间 scope，写入经由它进行（apply 时赋值） */
		let scope;

		// 精简样式（类名自持，不依赖原生卡片哈希类）
		const css = `
			.apis-card{list-style:none;border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-3);border-radius:16px;transition:border-color .16s}
			.apis-card:hover{border-color:var(--dsw-alias-label-dimmed)}
			.apis-header{width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;display:flex;align-items:center;gap:12px;padding:14px 16px}
			.apis-headText{flex:1;display:flex;flex-direction:column;gap:4px;min-width:0}
			.apis-title{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}
			.apis-desc,.apis-count,.apis-empty{color:var(--dsw-alias-label-tertiary);font-size:13px}
			.apis-count{font-size:12px;flex:none;white-space:nowrap}
			.apis-chevron{flex:none;color:var(--dsw-alias-label-tertiary);transition:transform .16s}
			.apis-body{border-top:.5px solid var(--dsw-alias-border-l2);margin:0 16px;padding:12px 0 8px;display:grid;gap:10px}
			.apis-row,.apis-item{display:flex;align-items:center;gap:8px;min-width:0}
			.apis-label{flex:none;font-size:13px;color:var(--dsw-alias-label-primary);white-space:nowrap}
			.apis-input{flex:1;min-width:0;box-sizing:border-box;font:inherit;color:var(--dsw-alias-label-primary);background:transparent;border:.5px solid var(--dsw-alias-border-l4);border-radius:8px;padding:6px 10px}
			.apis-btn{font:inherit;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-secondary);background:0 0}
			.apis-btn:hover:not(:disabled){color:var(--dsw-alias-label-primary)}
			.apis-btn:disabled{opacity:.4;cursor:default}
			.apis-text{flex:1;min-width:0;font-family:ui-monospace,Consolas,monospace;font-size:13px;color:var(--dsw-alias-label-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border:.5px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 10px}
			.apis-group{border:.5px solid var(--dsw-alias-border-l2);border-radius:10px;overflow:hidden}
			.apis-groupHead{width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;display:flex;align-items:center;gap:8px;padding:8px 10px}
			.apis-groupHead:hover{background:var(--dsw-alias-bg-layer-2)}
			.apis-groupName{flex:1;min-width:0;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
			.apis-groupBody{border-top:.5px solid var(--dsw-alias-border-l2);padding:8px 10px;display:grid;gap:8px}
		`;
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=dsh-apis-plugin]") === null) {
			const tag = document.createElement("style");
			tag.dataset.pluginCss = "dsh-apis-plugin";
			tag.textContent = css;
			document.head.appendChild(tag);
		}

		/** 与 slots 的 observableHook 约定兼容的极简 snapshot store（getSnapshot/subscribe） */
		function createStore(initial) {
			let state = initial;
			const listeners = new Set();
			return {
				getSnapshot: () => state,
				subscribe(listener) {
					listeners.add(listener);
					return () => listeners.delete(listener);
				},
				set(next) {
					state = next;
					listeners.forEach((l) => l());
				},
			};
		}

		/** 下拉箭头（14px 线性 chevron） */
		function Chevron({ open }) {
			return jsx("svg", {
				width: 14, height: 14, viewBox: "0 0 14 14", fill: "none", "aria-hidden": true,
				className: "apis-chevron",
				style: { transform: open ? "rotate(180deg)" : "none" },
				children: jsx("path", {
					d: "M3.5 5.25 7 8.75l3.5-3.5",
					stroke: "currentColor", strokeWidth: 1.2, strokeLinecap: "round", strokeLinejoin: "round",
				}),
			});
		}

		function ApisCard(props) {
			const state = props.useApisCard((s) => s);
			const [dirDraft, setDirDraft] = react.useState(null); // 文档目录，null 表示未编辑
			const [loading, setLoading] = react.useState(false); // 扫描进行中
			const [loaded, setLoaded] = react.useState(false); // 扫描完成后短暂提示
			const [open, setOpen] = react.useState(false); // 卡片折叠态
			const [openGroups, setOpenGroups] = react.useState({}); // 集合手风琴展开态（key: 集合名）
			const ready = state.status === "ready" && state.writable;

			/** 扫描得到的接口集合（服务端回写 JSON）：[{ name, baseUrl, apis }] */
			const groups = (() => {
				try {
					const v = JSON.parse(state.value?.collections ?? "[]");
					return Array.isArray(v) ? v : [];
				} catch {
					return [];
				}
			})();
			/** 兜底平铺列表：集合为空时展示（如仅部署侧固定接口） */
			const list = (state.value?.endpoints ?? []).map(String);
			const savedDir = state.value?.apiDir ?? "";
			const shownDir = dirDraft ?? savedDir;
			const dirDirty = dirDraft !== null && dirDraft !== savedDir;

			/** 只读单行：接口N 标签 + 路径文本 */
			const row = (v, i) => jsxs("div", { className: "apis-item", children: [
				jsx("div", { className: "apis-label", children: `接口${i + 1}` }),
				jsx("span", { className: "apis-text", title: v, children: v }),
			] });

			/** 集合手风琴：头行为 集合名 + 接口数 + 箭头，展开体含 baseUrl 与接口列表（只读） */
			const group = (g) => {
				const isOpen = !!openGroups[g.name];
				const apis = (g.apis ?? []).map(String);
				return jsxs("div", { className: "apis-group", children: [
					jsxs("button", {
						type: "button", className: "apis-groupHead", "aria-expanded": isOpen,
						onClick: () => setOpenGroups((m) => ({ ...m, [g.name]: !m[g.name] })),
						children: [
							jsx(Chevron, { open: isOpen }),
							jsxs("div", { className: "apis-headText", children: [
								jsx("span", { className: "apis-groupName", title: g.name, children: g.name }),
								g.title && jsx("span", { className: "apis-desc", children: g.title }),
							] }),
							jsx("span", { className: "apis-count", children: `${apis.length} 个接口` }),
						],
					}),
					isOpen && jsxs("div", { className: "apis-groupBody", children: [
						g.baseUrl && jsxs("div", { className: "apis-item", children: [
							jsx("div", { className: "apis-label", children: "baseUrl" }),
							jsx("span", { className: "apis-text", title: g.baseUrl, children: g.baseUrl }),
						] }),
						apis.length ? apis.map(row) : jsx("span", { className: "apis-empty", children: "该集合暂无接口" }),
					] }),
				] });
			};

			/** 扫描：目录有改动先落盘，再翻转 scanToken 让服务端重扫 cfg 并回写集合；目录为空则清空列表 */
			async function scan() {
				if (loading || !ready) return;
				setLoading(true);
				try {
					if (dirDirty) await scope.set("apiDir", shownDir.trim());
					await scope.set("scanToken", String(Date.now()));
					setDirDraft(null);
					setLoaded(true);
					setTimeout(() => setLoaded(false), 2000);
				} finally {
					setLoading(false);
				}
			}

			return jsxs("li", { className: "apis-card", children: [
				// 折叠头：标题 + 描述 + 箭头，点击切换展开
				jsxs("button", {
					type: "button", className: "apis-header", "aria-expanded": open,
					onClick: () => setOpen((v) => !v),
					children: [
						jsxs("div", { className: "apis-headText", children: [
							jsx("span", { className: "apis-title", children: "通用接口管理插件" }),
							jsx("span", { className: "apis-desc", children: "接口集合（来源：cfg 的 host 字段）" }),
						] }),
						jsx(Chevron, { open }),
					],
				}),
				// 展开体：API配置目录行 + 集合手风琴（无集合时回退平铺列表）
				open && jsxs("div", { className: "apis-body", children: [
					jsxs("div", { className: "apis-row", children: [
						jsx("div", { className: "apis-label", children: "API配置" }),
						jsx("input", {
							value: shownDir, disabled: !ready || loading,
							onChange: (e) => setDirDraft(e.target.value),
							onBlur: () => {
								if (dirDirty && ready) scope.set("apiDir", dirDraft);
								setDirDraft(null);
							},
							onKeyDown: (e) => e.key === "Enter" && e.currentTarget.blur(),
							placeholder: "集合父目录（扫描各子文件夹下的 *.cfg，以其中 host 为集合名），留空扫描即清空列表",
							className: "apis-input",
						}),
						jsx("button", {
							type: "button", disabled: !ready || loading, onClick: scan,
							className: "apis-btn", children: loading ? "扫描中…" : "扫描",
						}),
						loaded && jsx("span", { className: "apis-count", children: "已扫描" }),
					] }),
					!state.writable && jsx("span", { className: "apis-desc", children: "只读" }),
					groups.length
						? groups.map(group)
						: list.length
							? list.map(row)
							: jsx("span", { className: "apis-empty", children: "暂无接口：请在 API 目录下的各集合 cfg 文件中配置 host、baseUrl 与 apis，然后点击「扫描」" }),
				] }),
			] });
		}

		/** 需要的浏览器侧服务 */
		const inject = ["slots", "settingsScope"];

		/**
		 * 以命名空间为 key 注册到 settings.plugin.item 槽位：
		 * 「插件配置」标签页会为每个被服务且被认领的命名空间渲染一张卡片
		 */
		function apply(ctx) {
			scope = ctx.settingsScope.bind({ namespace: NS });
			const store = createStore(scope.getSnapshot());
			ctx.effect(() => scope.subscribe(() => store.set(scope.getSnapshot())));
			ctx.effect(() => ctx.slots.inject("settings.plugin.item", () => ctx.slots.register({
				name: "settings.plugin.item",
				key: NS,
				inject: () => ({ hooks: { apisCard: store } }),
			}, ApisCard)));
		}

		return { apply, inject };
	}
});
