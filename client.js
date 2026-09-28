// 浏览器半侧：在设置弹窗注册「接口管理」菜单项（DSH 0.1.7+ 的 settings.section 槽位）
// 接口的增删以 cfg 文件为唯一来源：这里只读展示集合手风琴，编辑请改 cfg 后点「扫描」重扫
// API 目录失焦或点「扫描」时经 configForms 表单写入，由宿主持久化到 profile 的 cordis.patch.yml
window.__ModuleLoader__.load({
	id: "dsh-apis-plugin",
	factory: (require) => {
		const { jsx, jsxs } = require("react/jsx-runtime");
		const react = require("react");

		/** 本设置页读写的 settings 命名空间，须与宿主侧 index.js 按 cordis.patch.yml 的 id 回写一致（亦即 Host 插件条目 id） */
		const NS = "dsh-apis-plugin";

		/** bind 后的配置表单与快照 store（apply 时赋值）：读快照、写字段都经由它 */
		let form;
		let store;

		// 精简样式（类名自持，不依赖原生卡片哈希类）
		const css = `
			.apis-section{display:grid;gap:12px;align-content:start;padding:4px 2px}
			.apis-headText{flex:1;display:flex;flex-direction:column;gap:4px;min-width:0}
			.apis-desc,.apis-count,.apis-empty{color:var(--dsw-alias-label-tertiary);font-size:13px}
			.apis-count{font-size:12px;flex:none;white-space:nowrap}
			.apis-chevron{flex:none;color:var(--dsw-alias-label-tertiary);transition:transform .16s}
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

		function ApisSection() {
			const state = react.useSyncExternalStore(store.subscribe, store.getSnapshot);
			const [dirDraft, setDirDraft] = react.useState(null); // 文档目录，null 表示未编辑
			const [loading, setLoading] = react.useState(false); // 扫描进行中
			const [loaded, setLoaded] = react.useState(false); // 扫描完成后短暂提示
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

			/** 扫描：目录有改动先落盘，再写 scanToken 触发配置变更重应用，服务端重扫 cfg 并把集合写回；目录为空则清空列表 */
			async function scan() {
				if (loading || !ready || !form) return;
				setLoading(true);
				try {
					if (dirDirty) await form.set("apiDir", shownDir.trim());
					await form.set("scanToken", String(Date.now()));
					setDirDraft(null);
					setLoaded(true);
					setTimeout(() => setLoaded(false), 2000);
				} catch {
					// 写入被拒（如 revision 冲突恢复失败）时静默结束，避免 unhandled rejection
				} finally {
					setLoading(false);
				}
			}

			// 设置页主体：API配置目录行 + 集合手风琴（无集合时回退平铺列表）
			return jsxs("div", { className: "apis-section", children: [
				jsxs("div", { className: "apis-row", children: [
					jsx("div", { className: "apis-label", children: "API配置" }),
					jsx("input", {
						value: shownDir, disabled: !ready || loading,
						onChange: (e) => setDirDraft(e.target.value),
						onBlur: () => {
							if (dirDirty && ready && form) form.set("apiDir", dirDraft).catch(() => {});
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
			] });
		}

		/** 需要的浏览器侧服务：configForms 由 ui-settings 提供，封装 Host settings 的读快照与写字段 */
		const inject = ["slots", "configForms"];

		/** 注册设置弹窗的「接口管理」菜单项：settings.section 列表槽位，菜单取 {id, order, label}，选中后渲染组件 */
		function apply(ctx) {
			form = ctx.configForms.get(NS);
			store = createStore(form.getSnapshot());
			ctx.effect(() => form.subscribe(() => store.set(form.getSnapshot())));
			ctx.effect(() => ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "dsh-apis-plugin",
				order: 30,
				label: "接口管理",
			}, ApisSection)));
		}

		return { apply, inject };
	}
});
