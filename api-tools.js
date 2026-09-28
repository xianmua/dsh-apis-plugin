// 可复用的「接口工具插件」工厂：把任意一套 HTTP 接口注册成 agent 的 {prefix}_api_doc / {prefix}_api_request 双工具
// 领域差异（settings 命名空间、工具名前缀、领域名、文档目录、baseUrl、默认接口列表）由调用方注入，
// 其中 domain / toolPrefix / apiDir 也可在部署侧 cordis.patch.yml 的 config 里覆盖
// DSH 0.1.7+：插件 Config 即设置表单，apiDir / scanToken / collections 声明为 volatile 字段；
// 服务端扫描结果经 ctx.settings.update 写回，客户端卡片经 configForms 表单读写
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import Schema from '@deepseek-ai/schemastery'

// 读取 cfg 文件（key=value 行，# 注释）：host 为集合标识；baseUrl 为服务前缀；
// apis 为接口列表，支持逗号分隔同行书写，或 apis= 下面逐行一个接口
function loadCfgFile(file) {
  const cfg = { apis: [] }
  if (!file) return cfg
  try {
    let current
    // 去掉 UTF-8 BOM（Windows 记事本默认会加），否则首个 key 解析失败
    for (const raw of readFileSync(file, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)) {
      const line = raw.trim()
      if (!line || line.startsWith('#')) continue
      const m = line.match(/^([\w-]+)\s*=\s*(.*)$/)
      if (m) {
        current = m[1]
        if (m[2]) cfg[current] = current === 'apis' ? m[2].split(',').map((s) => s.trim()).filter(Boolean) : m[2]
      } else if (current === 'apis') cfg.apis.push(line) // 无 = 的行归属上一个 key（apis 逐行列举）
    }
  } catch { /* 文件不可读时按空处理 */ }
  return cfg
}

// 扫描目录下的「接口集合」：递归遍历目录下所有 *.cfg（含根目录直放与任意深度子文件夹），
// 集合名取 cfg 的 host 字段（缺失时依次回退 baseUrl 的主机名、文件所在文件夹名）
function scanCollections(dir) {
  const out = []
  const hostFromUrl = (url) => {
    try {
      return new URL(url).hostname
    } catch {
      return ''
    }
  }
  const push = (file) => {
    const cfg = loadCfgFile(file)
    if (cfg.apis.length) out.push({ name: cfg.host || hostFromUrl(cfg.baseUrl) || basename(dirname(file)), title: cfg.title || '', file, dir: dirname(file), baseUrl: cfg.baseUrl || '', apis: cfg.apis })
  }
  // 递归下钻，限深 5 层防符号链接成环
  const walk = (d, depth) => {
    if (depth > 5) return
    let entries
    try {
      entries = readdirSync(d, { withFileTypes: true })
    } catch { /* 目录不可读时跳过 */ }
    for (const entry of entries ?? []) {
      const p = join(d, entry.name)
      if (entry.isDirectory()) walk(p, depth + 1)
      else if (entry.isFile() && entry.name.endsWith('.cfg')) push(p)
    }
  }
  if (dir) walk(dir, 0)
  return out
}

// 扫描集合并附带各自目录下的 api_doc.md 分节
function loadCollections(dir) {
  return scanCollections(dir).map((c) => ({ ...c, sections: splitDocSections(loadApiDoc(c.dir)) }))
}

// 读取目录下 api_doc.md 作为接口文档
function loadApiDoc(dir) {
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

// 判断实际请求路径是否命中配置的接口（支持 {param} 模板段）；
// 其余字符按字面量转义，避免 cfg 里误写正则特殊字符导致构造 RegExp 抛错
function matchEndpoint(path, configured) {
  const pattern = configured.split(/\{[^}]+\}/).map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/]+')
  try {
    return new RegExp('^' + pattern + '/?$').test(path)
  } catch {
    return false
  }
}

/** 从 cordis.patch.yml 提取插件 id（insert 列表第一项），作为命名空间唯一来源 */
export function readPatchId(dir) {
  const m = readFileSync(join(dir, 'cordis.patch.yml'), 'utf8').match(/^\s*-\s*id:\s*(\S+)\s*$/m)
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

/** 取 volatile 配置引用的当前快照；非引用原样返回 */
function val(v) {
  return v !== null && typeof v === 'object' && typeof v.get === 'function' ? v.get() : v
}

/**
 * 构造一个可被 cordis 直接加载的插件模块：{ Config, inject, apply }
 * @param {object} options
 * @param {string} options.ns               settings 命名空间，须与前端卡片的 NS 一致
 * @param {string} [options.toolPrefix]     工具名前缀默认值，生成 {prefix}_api_doc / {prefix}_api_request，可被 config 覆盖
 * @param {string} [options.domain]         领域名默认值，用于拼接工具描述 prompt，可被 config 覆盖
 * @param {string} [options.apiDir]         cfg 文件与 api_doc.md 所在目录默认值，可被 config 覆盖
 * @param {string} [options.defaultBaseUrl] 接口服务前缀默认值（域名 + nginx 前缀 + 网关路由段）
 * @param {string[]} [options.defaultEndpoints] yml 之外的额外默认接口
 */
export function defineApiPlugin(options) {
  const { ns, toolPrefix = 'api', domain = '', apiDir = '', defaultBaseUrl = '', defaultEndpoints = [] } = options

  // DSH 0.1.7 写回通道：扫描结果要写回 settings（进 profile patch）供客户端卡片展示，
  // 但 HMR 事务期间（loader/volatile-update 事件、live 重载触发的重应用都在事务内）禁止再开
  // 写事务（"HMR transactions cannot be nested"），且事务的 AsyncLocalStorage 会沿定时器等异步链
  // 传播、无法用 defer 逃逸。启动时的首次 apply 不在事务内，故写回定时器只在首次 apply 时创建，
  // 其回调永远不带事务上下文；apply / 事件回调只置 pending 标记与待写内容，由定时器落盘。
  let flushState = null // { ctx, config, serialized }
  let flushPending = false
  let flushStarted = false

  const Config = Schema.object({
    domain: Schema.string().default(domain), // 领域名：拼进工具描述 prompt
    toolPrefix: Schema.string().default(toolPrefix), // 工具名前缀：生成 {prefix}_api_doc / {prefix}_api_request
    apiDir: Schema.string().default(apiDir).volatile(), // cfg 与 api_doc.md 所在目录（留空则只用 endpoints）；客户端卡片可写
    endpoints: Schema.array(Schema.string()).default([]), // 部署侧固定接口（yml config 注入，不随扫描回写）
    baseUrl: Schema.string().default(defaultBaseUrl), // 接口服务前缀（路径本身已含服务前缀）
    scanToken: Schema.string().default('').volatile(), // 内部字段：客户端「扫描」按钮改写它触发配置变更重应用
    collections: Schema.string().default('').volatile(), // 内部字段：扫描到的集合 JSON [{name, baseUrl, apis}]，客户端只读展示
  })

  const inject = ['tools', 'settings']

  function apply(ctx, config) {
    const prefix = config.toolPrefix || toolPrefix
    const domainName = config.domain || domain
    // DSH 0.1.7：volatile 字段（apiDir/scanToken/collections）在 config 里是稳定 Volatile 引用，
    // 值更新不重跑 apply，而是原地写入引用并发出 loader/volatile-update 事件；
    // .get() 取当前快照，事件回调里重扫即可让「扫描」与目录修改实时生效
    // 部署侧固定接口（yml config.endpoints + 工厂默认）；cfg 扫描结果只落在 collections，二者运行时取并集
    const staticEndpoints = [...new Set([...defaultEndpoints, ...(config.endpoints ?? [])])]
    // 集合持久化为 JSON（客户端只读展示；文档分节不落盘）
    const plain = (cs) => JSON.stringify(cs.map(({ name, title, baseUrl, apis }) => ({ name, title, baseUrl, apis })))
    const mergedEndpoints = (cs) => [...new Set([...cs.flatMap((c) => c.apis), ...staticEndpoints])]

    // 按当前 apiDir 重扫 cfg；结果与配置不一致时经 settings.update 写回 profile patch（写回会触发
    // 一次 volatile 更新，下一轮扫描结果与配置一致即收敛，不会循环）。
    // 写回不在当前调用栈直接执行：loader/volatile-update 事件与 live 重载的重应用都在 HMR 事务内，
    // 事务内再开写事务会被拒绝，故只置 pending 标记，由首次 apply 创建的定时器（事务外）落盘
    function rescan() {
      const dir = val(config.apiDir) || apiDir
      const cs = loadCollections(dir)
      const serialized = plain(cs)
      if (serialized !== val(config.collections)) {
        flushState = { ctx, config, serialized }
        flushPending = true
      }
      return cs
    }

    // 写回定时器只在首次 apply 创建（boot 的 apply 不在 HMR 事务内，其回调永无事务上下文）
    if (!flushStarted) {
      flushStarted = true
      setInterval(() => {
        if (!flushPending) return
        flushPending = false
        const { ctx, config, serialized } = flushState
        if (serialized === val(config.collections)) return
        ctx.settings.update(ns, { collections: serialized }).catch((err) => {
          console.error(`[${ns}] settings sync error:`, err)
        })
      }, 50)
    }

    let collections = rescan()
    ctx.effect(() => ctx.on('loader/volatile-update', () => {
      try {
        collections = rescan()
      } catch (err) {
        console.error(`[${ns}] rescan error:`, err)
      }
    }), `${ns}: volatile rescan`)

    // 已配置接口目录（按集合分组展示，title 说明集合用途；部署侧静态接口不在任何集合时单独一组）
    function catalogText() {
      const groups = collections.map((c) =>
        `【${c.name}】${c.title ? `（${c.title}）` : ''}${c.baseUrl ? `（baseUrl: ${c.baseUrl}）` : ''}\n` + c.apis.map((e) => '  ' + e).join('\n'))
      const dyn = new Set(collections.flatMap((c) => c.apis))
      const extra = staticEndpoints.filter((e) => !dyn.has(e))
      if (extra.length) groups.push('【部署侧固定接口】\n' + extra.map((e) => '  ' + e).join('\n'))
      return groups.join('\n\n')
    }

    // 把规范化 path 解析到具体集合：① 支持「集合名/路径」前缀；② 无前缀全集合查找，
    // 命中多个返回 { ambiguous } 要求消歧；③ 集合外回退部署侧静态接口
    function resolveTarget(norm) {
      const bare = norm.replace(/^\//, '') // 剥掉前导 / 再找「集合名/路径」前缀
      const slash = bare.indexOf('/')
      if (slash > 0) {
        const c = collections.find((x) => x.name === bare.slice(0, slash))
        if (c) {
          const rest = bare.slice(slash)
          return c.apis.some((e) => matchEndpoint(rest, e)) ? { c, path: rest } : null
        }
      }
      const hits = collections.filter((c) => c.apis.some((e) => matchEndpoint(norm, e)))
      if (hits.length > 1) return { ambiguous: hits }
      if (hits.length === 1) return { c: hits[0], path: norm }
      if (staticEndpoints.some((e) => matchEndpoint(norm, e))) {
        return { c: { name: '_static', baseUrl: config.baseUrl || '', apis: staticEndpoints, sections: [] }, path: norm }
      }
      return null
    }

    // 集合的服务前缀：实时重读该集合的 cfg 文件（改文件即生效，无需重启），回退扫描快照
    const baseUrlOf = (c) => c.name === '_static' ? config.baseUrl || '' : loadCfgFile(c.file).baseUrl || c.baseUrl || ''
    const ambiguousMsg = (norm, hits) => `接口 ${norm} 在多个集合中命中（${hits.map((c) => c.name).join('、')}），请用「集合名/路径」精确指定，如：${hits[0].name}${norm}`
    const normPath = (p) => ('/' + p.trim().replace(/^\/+/, '')).split('?')[0]

    // 删除操作的待确认记录（key: "DELETE <完整地址>"）：只有先收到过确认提示，confirm=true 才会放行
    const pendingDeletes = new Set()

    // 工具 1：查接口文档，让模型了解每个接口的参数与响应（prompt 按领域名拼接）
    ctx.tools.register({
      name: `${prefix}_api_doc`,
      description: `查询${domainName}接口文档。接口按集合组织（集合名取各 cfg 文件的 host 字段，cfg 的 title 字段标注该集合用途），api_doc.md 与部署的服务一一对应，是这些接口的权威依据。传 path（如 /users/page，跨集合同名接口用「集合名/路径」如 site-a.com/users/page）返回该接口的详细参数与响应说明；不传 path 返回通用说明和全部集合的接口目录。发起请求前先用它确认参数，按文档直接调用即可，不要再去查阅后端源码或其他材料核实接口行为。`,
      parameters: {
        path: { type: 'string', description: '接口路径，如 /users/{id}；跨集合同名时用 集合名/路径' },
      },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute(args) {
        if (!args.path) return '【通用说明】接口按集合组织，path 可用「集合名/路径」精确指定。\n\n【已配置接口目录】\n' + catalogText()
        const norm = normPath(args.path)
        const r = resolveTarget(norm)
        if (!r) return `接口 ${norm} 不在已配置列表中，已拒绝查询。可用接口：\n` + catalogText()
        if (r.ambiguous) return ambiguousMsg(norm, r.ambiguous)
        const hit = (r.c.sections || []).filter((s) => s.includes('`' + r.path + '`'))
        return hit.length ? hit.join('\n\n---\n\n') : `文档中未找到 ${r.path}（集合 ${r.c.name}）。已配置接口目录：\n` + catalogText()
      },
    })

    // 工具 2：真正调用接口拿数据（prompt 按领域名拼接）
    ctx.tools.register({
      name: `${prefix}_api_request`,
      description: `调用${domainName}接口并返回 JSON 数据。path 必须是已配置集合中的接口（支持 /orders/{id} 这类模板路径，模板段填实际值；跨集合同名接口用「集合名/路径」如 site-a.com/users/detail）；GET 用 query 传参，POST 用 body 传 JSON。安全规则：① DELETE 属于危险操作，首次调用只返回确认提示不会执行，必须先向用户二次确认，用户明确同意后才能携带 confirm=true 再次调用；② 返回结果若以 ⚠️ 开头（写操作警告/危险操作确认），必须在回复中原样向用户展示警告块内容（含接口、方法、完整地址与参数），不得省略、转述或只报结果。请依据 ${prefix}_api_doc 返回的文档构造请求，文档即权威，无需从源码核实接口行为。`,
      parameters: {
        path: { type: 'string', required: true, description: '接口路径，如 /users/detail 或 /orders/123；跨集合同名时用 集合名/路径' },
        method: { type: 'string', description: 'HTTP 方法，默认 GET' },
        query: { type: 'json', description: 'query 参数对象，如 { "keyword": "abc" }' },
        body: { type: 'json', description: 'POST 请求体（JSON 对象）' },
        confirm: { type: 'boolean', description: '删除操作的二次确认标记：仅在与用户确认且收到过确认提示后才能传 true；未经确认提示不得传' },
      },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute(args) {
        const method = (args.method ?? 'GET').toUpperCase()
        const norm = normPath(args.path)
        const r = resolveTarget(norm)
        if (!r) return `接口 ${norm} 不在已配置列表中。可用接口：\n` + catalogText()
        if (r.ambiguous) return ambiguousMsg(norm, r.ambiguous)

        const base = baseUrlOf(r.c)
        if (!base) return `未配置接口服务前缀 baseUrl。请在集合 ${r.c.name} 的 cfg 文件写入 baseUrl=http://... ，或在部署配置中设置。`
        const url = new URL(base.replace(/\/+$/, '') + r.path)
        for (const [k, v] of Object.entries(args.query ?? {})) url.searchParams.set(k, String(v))

        // 删除操作：两段式确认。首次调用只返回确认提示并记录待确认项；
        // 即使模型首次就带 confirm=true，只要没有对应的待确认记录也一律拒绝执行
        if (method === 'DELETE') {
          const key = method + ' ' + url
          if (args.confirm === true && pendingDeletes.has(key)) pendingDeletes.delete(key)
          else {
            pendingDeletes.add(key)
            return `⚠️【危险操作确认】本次将执行删除接口：\n  ${method} ${url}\n该操作可能不可恢复。请先向用户二次确认；用户同意后，携带 confirm=true 重新调用本工具才会真正执行。`
          }
        }

        // 写操作：在结果前向用户明示将执行哪个接口
        const writeWarn = ['POST', 'PUT', 'PATCH'].includes(method)
          ? `⚠️【写操作警告】本次请求将执行接口：${method} ${url}（query: ${JSON.stringify(args.query ?? {})}；body: ${JSON.stringify(args.body ?? null)}）\n\n`
          : ''

        const response = await fetch(url, {
          method,
          headers: { Accept: 'application/json', ...(args.body != null ? { 'Content-Type': 'application/json' } : {}) },
          ...(method !== 'GET' && args.body != null ? { body: JSON.stringify(args.body) } : {}),
        })
        const text = await response.text()
        if (!response.ok) return writeWarn + `HTTP ${response.status} ${response.statusText}\n` + text.slice(0, 4000)
        return writeWarn + (text.length > 30000 ? text.slice(0, 30000) + '\n…（超长截断）' : text)
      },
    })

    console.log(`[${ns}] loaded; apiDir=${val(config.apiDir) || '(未配置)'}, endpoints=${mergedEndpoints(collections).length}, collections=${collections.map((c) => c.name).join(',') || '(无)'}`)
  }

  return { Config, inject, apply }
}
