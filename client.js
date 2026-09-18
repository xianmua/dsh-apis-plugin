// 浏览器半侧：在「插件配置」标签页为 dsh-apis-plugin 命名空间注册一张可编辑卡片
// 样式与 DOM 结构对齐原生 PluginCard（li 卡片 + SVG 箭头 + 放弃/保存 footer）
window.__ModuleLoader__.load({
	id: "dsh-apis-plugin",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		let react_jsx_runtime = require("react/jsx-runtime");
		let react = require("react");

		/** 本卡片编辑的 settings 命名空间，由宿主侧 index.js 按 cordis.patch.yml 的 id 自动回写 */
		const NS = "dsh-apis-plugin";

		/** bind 后的命名空间 scope，写入经由它进行（apply 时赋值） */
		let scope;

		// 复刻原生 PluginCard.module.css 的样式（类名自持，不依赖其哈希类）
		const css = `
			.apis-card{border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-3);border-radius:16px;list-style:none;transition:border-color .16s,background .16s}
			.apis-card:hover{border-color:var(--dsw-alias-label-dimmed)}
			.apis-card[data-open=true]{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}
			.apis-header{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}
			.apis-headText{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}
			.apis-name{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}
			.apis-description{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}
			.apis-chevron{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .16s}
			.apis-body{border-top:.5px solid var(--dsw-alias-border-l2);margin:0 16px;padding:12px 0 8px;display:grid;gap:10px}
			.apis-footer{border-top:.5px solid var(--dsw-alias-border-l2);justify-content:flex-end;align-items:center;gap:8px;padding:12px 0 4px;display:flex}
			.apis-saved{color:var(--dsw-alias-label-tertiary);margin-right:auto;font-size:12px}
			.apis-btn{appearance:none;font:inherit;cursor:pointer;border:1px solid transparent;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5}
			.apis-btn:disabled{opacity:.4;cursor:default}
			.apis-discard{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:0 0}
			.apis-discard:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}
			.apis-save{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}
			.apis-row{display:flex;align-items:center;gap:8px}
			.apis-rowLabel{width:44px;flex-shrink:0;font-size:13px;color:var(--dsw-alias-label-primary)}
			.apis-rowLabelWide{width:auto;white-space:nowrap}
			.apis-hr{width:100%;height:0;border:0;border-top:.5px solid var(--dsw-alias-border-l2);margin:0}
			.apis-input{box-sizing:border-box;flex:1;min-width:0;font:inherit;color:var(--dsw-alias-label-primary);background:transparent;border:.5px solid var(--dsw-alias-border-l4);border-radius:8px;padding:6px 10px}
			.apis-remove{appearance:none;font:inherit;font-size:13px;cursor:pointer;background:none;border:none;border-radius:8px;padding:5px 10px;color:var(--dsw-alias-label-tertiary)}
			.apis-remove:hover:not(:disabled){color:var(--dsw-alias-label-primary)}
			.apis-add{appearance:none;font:inherit;font-size:13px;cursor:pointer;background:none;border:none;border-radius:8px;padding:2px 0;color:var(--dsw-alias-label-secondary);margin-right:auto}
			.apis-add:hover:not(:disabled){color:var(--dsw-alias-label-primary)}
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

		/** 原生卡片同款的下拉箭头（14px 线性 chevron） */
		function Chevron({ open }) {
			return react_jsx_runtime.jsx("svg", {
				width: 14, height: 14, viewBox: "0 0 14 14", fill: "none", "aria-hidden": true,
				className: "apis-chevron",
				style: { transform: open ? "rotate(180deg)" : "none" },
				children: react_jsx_runtime.jsx("path", {
					d: "M3.5 5.25 7 8.75l3.5-3.5",
					stroke: "currentColor", strokeWidth: 1.2, strokeLinecap: "round", strokeLinejoin: "round",
				}),
			});
		}

		function ApisCard(props) {
			const state = props.useApisCard((s) => s);
			const [draft, setDraft] = react.useState(null); // string[]，null 表示未编辑
			const [dirDraft, setDirDraft] = react.useState(null); // 文档目录，null 表示未编辑
			const [saving, setSaving] = react.useState(false);
			const [loading, setLoading] = react.useState(false); // 加载API 扫描中
			const [saved, setSaved] = react.useState(false); // 保存成功后短暂提示
			const [loaded, setLoaded] = react.useState(false); // 加载API 完成后短暂提示
			const [open, setOpen] = react.useState(false); // 折叠态只显示标题行
			const ready = state.status === "ready" && state.writable;

			/** 当前展示的接口列表：编辑中取 draft，否则取已保存值 */
			const list = draft ?? (state.value?.endpoints ?? []).map(String);
			const dirty = draft !== null;
			/** 当前展示的文档目录：编辑中取 dirDraft，否则取已保存值 */
			const savedDir = state.value?.apiDir ?? "";
			const shownDir = dirDraft ?? savedDir;
			const dirDirty = dirDraft !== null && dirDraft !== savedDir;

			async function save() {
				if (saving || !ready || (!dirty && !dirDirty)) return;
				setSaving(true);
				if (dirDirty) await scope.set("apiDir", dirDraft); // 只存配置，扫描交给「加载API」
				if (dirty) await scope.set("endpoints", draft);
				setSaving(false);
				setDraft(null);
				setDirDraft(null);
				setSaved(true); // 显示「已保存」提示，2 秒后消失
				setTimeout(() => setSaved(false), 2000);
			}

			/** 加载API：把目录写入配置并翻转 scanToken，服务端 watch 重扫 apis.txt 后回写接口列表 */
			async function loadApis() {
				if (loading || !ready || !shownDir.trim()) return;
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

			// 单行：接口N 标签 + 输入框 + 删除按钮
			const row = (v, i) => react_jsx_runtime.jsxs("div", {
				className: "apis-row",
				children: [
					react_jsx_runtime.jsx("div", { className: "apis-rowLabel", children: `接口${i + 1}` }),
					react_jsx_runtime.jsx("input", {
						value: v, disabled: !ready || saving,
						onChange: (e) => setDraft(list.map((x, j) => (j === i ? e.target.value : x))),
						className: "apis-input",
					}),
					react_jsx_runtime.jsx("button", {
						type: "button", disabled: !ready || saving, "aria-label": `删除接口${i + 1}`,
						onClick: () => setDraft(list.filter((_, j) => j !== i)),
						className: "apis-remove", children: "✕",
					}),
				],
			});

			return react_jsx_runtime.jsxs("li", {
				className: "apis-card",
				"data-open": open,
				children: [
					// 折叠头：标题 + 描述 + 箭头，点击切换展开
					react_jsx_runtime.jsxs("button", {
						type: "button",
						className: "apis-header",
						"aria-expanded": open,
						onClick: () => setOpen((v) => !v),
						children: [
							react_jsx_runtime.jsxs("div", { className: "apis-headText", children: [
								react_jsx_runtime.jsx("span", { className: "apis-name", children: "通用接口管理插件" }),
								react_jsx_runtime.jsx("span", { className: "apis-description", children: "接口列表配置" }),
							] }),
							react_jsx_runtime.jsx(Chevron, { open }),
						],
					}),
					// 展开体：API配置目录行 + 分隔线 + 接口行列表 + 底部操作条
					open && react_jsx_runtime.jsxs("div", { className: "apis-body", children: [
						// API配置：文档目录（apis.txt / api_doc.md 所在目录）+ 加载API 重扫按钮
						react_jsx_runtime.jsxs("div", { className: "apis-row", children: [
							react_jsx_runtime.jsx("div", { className: "apis-rowLabel apis-rowLabelWide", children: "API配置" }),
							react_jsx_runtime.jsx("input", {
								value: shownDir, disabled: !ready || saving || loading,
								onChange: (e) => setDirDraft(e.target.value),
								placeholder: "api.cfg / api_doc.md 所在目录",
								className: "apis-input",
							}),
							react_jsx_runtime.jsx("button", {
								type: "button", disabled: !ready || saving || loading || !shownDir.trim(),
								onClick: loadApis,
								className: "apis-btn apis-discard", children: loading ? "扫描中…" : "加载API",
							}),
							loaded && react_jsx_runtime.jsx("span", { className: "apis-saved", children: "已加载" }),
						] }),
						react_jsx_runtime.jsx("hr", { className: "apis-hr" }),
						!state.writable && react_jsx_runtime.jsx("span", { className: "apis-description", children: "只读" }),
						list.map(row),
						react_jsx_runtime.jsx("button", {
							type: "button", disabled: !ready || saving,
							onClick: () => setDraft([...list, ""]),
							className: "apis-add", children: "＋ 添加接口",
						}),
						react_jsx_runtime.jsxs("div", { className: "apis-footer", children: [
							// 保存成功后的短暂提示（占按钮行左侧）
							react_jsx_runtime.jsx("span", { className: "apis-saved", children: saved ? "已保存" : "" }),
							react_jsx_runtime.jsx("button", {
								type: "button", disabled: (!dirty && !dirDirty) || saving,
								onClick: () => { setDraft(null); setDirDraft(null); },
							className: "apis-btn apis-discard", children: "放弃修改",
							}),
							react_jsx_runtime.jsx("button", {
								type: "button", disabled: !ready || (!dirty && !dirDirty) || saving,
								onClick: save, children: saving ? "保存中…" : "保存",
								className: "apis-btn apis-save",
							}),
						] }),
					] }),
				],
			});
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

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
