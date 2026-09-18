// 可复用的「接口工具插件」工厂：把任意一套 HTTP 接口注册成 agent 的 {prefix}_api_doc / {prefix}_api_request 双工具
// 领域差异（settings 命名空间、工具名前缀、领域名、文档目录、baseUrl、默认接口列表）由调用方注入，
// 其中 domain / toolPrefix / apiDir 也可在部署侧 cordis.patch.yml 的 config 里覆盖；
// 工具描述 prompt 在这里按领域名拼接，实现一处逻辑多处复用
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import Schema from '@deepseek-ai/schemastery'

// 读取目录下 api.cfg（key=value 行，# 注释）：baseUrl 为服务前缀；apis 为接口列表，
// 支持逗号分隔同行书写，或 apis= 下面逐行一个接口
function loadApiCfg(dir) {
  const empty = { apis: [] }
  if (!dir) return empty
  try {
    const cfg = { apis: [] }
    let current = null
    // 去掉 UTF-8 BOM（Windows 记事本默认会加），否则首个 key 解析失败
    const text = readFileSync(join(dir, 'api.cfg'), 'utf8').replace(/^\uFEFF/, '')
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim()
      if (!line || line.startsWith('#')) continue
      const m = line.match(/^([\w-]+)\s*=\s*(.*)$/)
      if (m) {
        current = m[1]
        if (m[2]) cfg[current] = current === 'apis' ? m[2].split(',').map((s) => s.trim()).filter(Boolean) : m[2]
        continue
      }
      // 无 = 的行归属上一个 key（apis 的逐行列举形式）
      if (current === 'apis') cfg.apis.push(line)
    }
    return cfg
  } catch {
    return empty
  }
}

// 读取目录下 api_doc.md 作为接口文档
function loadApiDoc(dir) {
  if (!dir) return ''
  try {
    return readFileSync(join(dir, 'api_doc.md'), 'utf8').replace(/^\uFEFF/, '')
  } catch {
    return ''
  }
}

// 把文档按 --- 分节，每节含一个接口的说明（兼容 CRLF 换行）
function splitDocSections(doc) {
  return doc.split(/\r?\n-{3,}\r?\n/).map((s) => s.trim()).filter(Boolean)
}

// 判断实际请求路径是否命中配置的接口（支持 {param} 模板段）
function matchEndpoint(path, configured) {
  const pattern = new RegExp('^' + configured.replace(/\{[^}]+\}/g, '[^/]+') + '/?$')
  return pattern.test(path)
}

/** 从 cordis.patch.yml 提取插件 id（insert 列表第一项），作为命名空间唯一来源 */
export function readPatchId(dir) {
  const yml = readFileSync(join(dir, 'cordis.patch.yml'), 'utf8')
  const m = yml.match(/^\s*-\s*id:\s*(\S+)\s*$/m)
  if (!m) throw new Error('cordis.patch.yml 中未找到 insert 的 id')
  return m[1]
}

/** 把 client.js 的 NS 字面量回写为 yml id（浏览器侧无法读 yml，只能靠此处同步） */
export function syncClientNs(dir, ns) {
  const file = join(dir, 'client.js')
  const code = readFileSync(file, 'utf8')
  const updated = code.replace(/^(\s*const NS = ")[^"]*(";\s*$)/m, `$1${ns}$2`)
  if (updated !== code) writeFileSync(file, updated)
}

/**
 * 构造一个可被 cordis 直接加载的插件模块：{ Config, inject, apply }
 * @param {object} options
 * @param {string} options.ns               settings 命名空间，须与前端卡片的 NS 一致
 * @param {string} [options.toolPrefix]     工具名前缀默认值，生成 {prefix}_api_doc / {prefix}_api_request，可被 config 覆盖
 * @param {string} [options.domain]         领域名默认值，用于拼接工具描述 prompt，可被 config 覆盖
 * @param {string} [options.apiDir]         api.cfg 与 api_doc.md 所在目录默认值，可被 config 覆盖
 * @param {string} [options.defaultBaseUrl] 接口服务前缀默认值（域名 + nginx 前缀 + 网关路由段）
 * @param {string[]} [options.defaultEndpoints] yml 之外的额外默认接口
 */
export function defineApiPlugin(options) {
  const { ns, toolPrefix = 'api', domain = '', apiDir = '', defaultBaseUrl = '', defaultEndpoints = [] } = options

  const Config = Schema.object({
    // 领域名：用于拼接工具描述 prompt
    domain: Schema.string().default(domain),
    // 工具名前缀：生成 {prefix}_api_doc / {prefix}_api_request
    toolPrefix: Schema.string().default(toolPrefix),
    // api.cfg 与 api_doc.md 所在目录（留空则只用 endpoints）
    apiDir: Schema.string().default(apiDir),
    endpoints: Schema.array(Schema.string()).default([]),
    // 接口服务前缀：域名 + nginx 前缀 + 网关路由段
    // （接口路径本身已含服务前缀，最终形如 /prod-api/xxx/users/detail）
    baseUrl: Schema.string().default(defaultBaseUrl),
    // 内部字段：客户端「加载API」按钮改写它触发服务端重扫目录
    scanToken: Schema.string().default(''),
  })

  // 依赖部署挂载的设置服务与工具服务
  const inject = ['settings', 'tools']

  function apply(ctx, config) {
    // config 覆盖优先，回退工厂默认值（兼容旧用户层保存值缺字段的情况）
    const prefix = config.toolPrefix || toolPrefix
    const domainName = config.domain || domain
    // 部署侧静态接口（yml config.endpoints + 工厂默认），与 api.cfg 动态读取分离，
    // 避免「加载API」重扫时把启动时的旧 api.cfg 列表拼回去（导致删掉的接口仍可请求）
    const ymlApiDir = config.apiDir || apiDir
    const staticEndpoints = [...new Set([...defaultEndpoints, ...(config.endpoints ?? [])])]
    // 启动时以当前目录 api.cfg 为权威范围，∪ 静态接口作为 base
    const bootEndpoints = [...new Set([...loadApiCfg(ymlApiDir).apis, ...staticEndpoints])]

    // 以组合配置为 base 层注册 settings 命名空间，卸载插件时注册随 fiber 一并清理
    const scope = ctx.settings.register(ns, Config, { base: { ...config, endpoints: bootEndpoints } })

    // 当前生效目录：用户层保存值优先（重启后仍生效），回退部署侧配置
    let docDir = scope.get()?.apiDir || ymlApiDir

    // 文档按当前生效目录读取；用户层改写 apiDir 后随 watch 刷新
    let docSections = splitDocSections(loadApiDoc(docDir))

    // 每次已提交变更后收到通知；「加载API」以 scanToken 变化标记，触发目录重扫
    let lastScanToken = scope.get()?.scanToken ?? ''
    ctx.effect(
      () => {
        console.log(`[${ns}] watch registering`)
        return scope.watch((next) => {
          try {
            console.log(`[${ns}] watch fired; apiDir=${next.apiDir}, scanToken=${next.scanToken}`)
            const dir = next.apiDir || apiDir
        // 目录变化或显式重扫时重读文档
        if (dir !== docDir || next.scanToken !== lastScanToken) {
          docDir = dir
          docSections = splitDocSections(loadApiDoc(dir))
        }
        if (next.scanToken !== lastScanToken) {
          lastScanToken = next.scanToken
          // 以最新 api.cfg 为权威范围 ∪ 静态接口，整体接管用户层 endpoints（去重；值未变时不提交，避免循环）
          // 用最新读取结果而非启动时的快照，这样从 api.cfg 删掉的接口重扫后即失效
          const merged = [...new Set([...loadApiCfg(dir).apis, ...staticEndpoints])]
          const cur = Array.isArray(next.endpoints) ? next.endpoints : []
          if (merged.join('\n') !== cur.join('\n')) scope.update({ endpoints: merged })
        }
        console.log(`${ns}: settings updated`)
          } catch (err) {
            console.error(`[${ns}] watch handler error:`, err)
          }
        })
      },
      `${ns}: settings watch`,
  )

    // ---------- agent 工具 ----------

    // 当前生效的接口列表（用户层保存值优先，回退默认值）
    function currentEndpoints() {
      try {
        const value = scope.get()
        if (Array.isArray(value?.endpoints) && value.endpoints.length) return value.endpoints
      } catch { /* scope.get 不可用时回退 */ }
      return bootEndpoints
    }

    // 工具 1：查接口文档，让模型了解每个接口的参数与响应（prompt 按领域名拼接）
    ctx.tools.register({
      name: `${prefix}_api_doc`,
      description: `查询${domainName}接口文档。api_doc.md 与部署的服务一一对应，是这些接口的权威依据。传 path（如 /users/page）返回该接口的详细参数与响应说明；不传 path 返回通用说明和全部已配置接口目录。发起请求前先用它确认参数，按文档直接调用即可，不要再去查阅后端源码或其他材料核实接口行为。`,
      parameters: {
        path: { type: 'string', description: '接口路径，如 /users/{id}' },
      },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute(args) {
        const list = currentEndpoints()
        if (!args.path) {
          return '【通用说明】\n' + (docSections[0] ?? '') + '\n\n【已配置接口目录】\n' + list.join('\n')
        }
        const norm = ('/' + args.path.trim().replace(/^\/+/, '')).split('?')[0]
        const hit = docSections.filter((s) => s.includes('`' + norm + '`'))
        if (hit.length) return hit.join('\n\n---\n\n')
        return `文档中未找到 ${norm}。已配置接口目录：\n` + list.join('\n')
      },
    })

    // 工具 2：真正调用接口拿数据（prompt 按领域名拼接）
    ctx.tools.register({
      name: `${prefix}_api_request`,
      description: `调用${domainName}接口并返回 JSON 数据。path 必须是已配置的接口（支持 /orders/{id} 这类模板路径，模板段填实际值）；GET 用 query 传参，POST 用 body 传 JSON。请依据 ${prefix}_api_doc 返回的文档构造请求，文档即权威，无需从源码核实接口行为。`,
      parameters: {
        path: { type: 'string', required: true, description: '接口路径，如 /users/detail 或 /orders/123' },
        method: { type: 'string', description: 'HTTP 方法，默认 GET' },
        query: { type: 'json', description: 'query 参数对象，如 { "keyword": "abc" }' },
        body: { type: 'json', description: 'POST 请求体（JSON 对象）' },
      },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute(args) {
        const list = currentEndpoints()
        const method = (args.method ?? 'GET').toUpperCase()
        const norm = ('/' + args.path.trim().replace(/^\/+/, '')).split('?')[0]

        const matched = list.find((e) => matchEndpoint(norm, e))
        if (!matched) {
          return `接口 ${norm} 不在已配置列表中。可用接口：\n` + list.join('\n')
        }

        // 服务前缀：api.cfg 优先（改文件即生效，无需重启），回退部署配置
        const base = loadApiCfg(docDir).baseUrl || scope.get()?.baseUrl || ''
        if (!base) {
          return `未配置接口服务前缀 baseUrl。请在文档目录 ${docDir || '(未配置)'} 下新建 api.cfg 写入 baseUrl=http://... ，或在部署配置中设置。`
        }
        const url = new URL(base.replace(/\/+$/, '') + matched)
        for (const [k, v] of Object.entries(args.query ?? {})) {
          url.searchParams.set(k, String(v))
        }

        const response = await fetch(url, {
          method,
          headers: { Accept: 'application/json', ...(args.body != null ? { 'Content-Type': 'application/json' } : {}) },
          ...(method !== 'GET' && args.body != null ? { body: JSON.stringify(args.body) } : {}),
        })
        const text = await response.text()

        if (!response.ok) {
          return `HTTP ${response.status} ${response.statusText}\n` + text.slice(0, 4000)
        }
        // 非文件流接口直接返回 JSON 文本，超长截断
        return text.length > 30000 ? text.slice(0, 30000) + '\n…（超长截断）' : text
      },
    })

    console.log(`[${ns}] loaded; endpoints=${bootEndpoints.length}, doc sections=${docSections.length}`)
  }

  return { Config, inject, apply }
}
