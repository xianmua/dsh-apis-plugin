# dsh-apis-plugin

通用接口管理插件（DeepSeek Harness / Cordis 双面插件）：把任意一套 HTTP 接口注册成 agent 可用的**文档查询 + 请求调用**双工具。

核心约定：**`api.cfg` 是接口的唯一权威范围**——agent 只能请求 api.cfg 中列出的接口，范围外一律拒绝。

## 安装

```sh
dsh plugin --profile web add dsh-apis-plugin
```

安装后重启 `dsh web` 生效。指定版本：

```sh
dsh plugin --profile web add dsh-apis-plugin@0.1.6
```

## 配置

「API配置」指向一个**集合父目录**，扫描其下（含各子文件夹）的所有 `*.cfg` 文件，**每个 cfg 是一个集合，集合名取 cfg 里的 `host` 字段**（缺失时回退所在文件夹名），各集合的接口、baseUrl、文档相互独立：

```
config/
├── site-a.example.com/   # 子文件夹 1
│   ├── api.cfg           # 集合 1：host=site-a.example.com
│   └── api_doc.md        # 该集合的接口文档
└── site-b.example.com/
    ├── api.cfg           # 集合 2：host=site-b.example.com
    └── api_doc.md
```

> cfg 文件名任意（`api.cfg`、`config.cfg`、`<host>.cfg` 均可），扫描**递归**收集目录下所有 `*.cfg`（含任意深度子文件夹，限 5 层），集合身份只看里面的 `host` 字段；同一个子文件夹放多个 cfg 即为多个集合。**新增/修改 cfg 后需点「扫描」或重启生效。**

### 1. xxx.cfg（每个集合一份，必需）

key=value 行格式，`#` 注释，UTF-8 编码：

```ini
# 集合标识（如网站域名），用于展示与「集合名/路径」消歧
host=site-a.example.com

# 集合用途说明（可选），会展示在接口目录与手风琴中，方便 AI 理解查询范围
title=xxx

# 该集合的接口服务前缀：域名 + nginx 前缀 + 网关路由段
baseUrl=http://your-host/api

# 接口列表：apis= 下面逐行一个接口
apis=
  /users/page
  /users/{id}
```

- `host`：集合名，缺失时依次回退 baseUrl 的主机名、文件所在文件夹名
- `title`：集合用途说明（可选），AI 查目录与 UI 手风琴均会展示
- `baseUrl`：请求时拼接在该集合的接口路径前（改文件即生效，无需重启）
- `apis`：该集合的接口白名单，支持 `{param}` 模板段（如 `/users/{id}`），agent 请求时填实际值
- **增删接口只改这个文件**，改完点插件配置页的「扫描」（或重启）生效

### 2. api_doc.md（接口文档，建议提供）

与 `api.cfg` 放在一起。用 `---` 分节，每节描述一个接口，节内用反引号标注接口路径：

```markdown
## 通用说明

所有接口返回 JSON，需携带 token。

## 分页查询用户

- 路径：`/users/page`（GET）
- 参数：keyword（可选）、page、pageSize

## 用户详情

- 路径：`/users/{id}`（GET）
```

agent 调用 `{prefix}_api_doc` 时按路径命中对应小节返回。

💡 建议：在「通用说明」里注明 *“本文档与线上服务一一对应，以此为准”*，并写清字段语义（如 `status=0 编辑中，1 待审核`）——工具描述已声明文档为权威依据，写清楚后 agent 会直接按文档调用，不会再去翻后端源码核实。

### 3. 部署侧 cordis.patch.yml（可选覆盖）

```yaml
- insert:
    - id: dsh-apis-plugin
      name: dsh-apis-plugin
      config:
        domain: "用户中心"        # 领域名：拼进工具描述 prompt
        toolPrefix: api           # 工具名前缀：生成 api_api_doc / api_api_request
        apiDir: ""                # api.cfg / api_doc.md 默认目录（留空则在 UI 里填）
        endpoints: []             # yml 侧额外固定接口
        baseUrl: ""               # 服务前缀兜底（api.cfg 优先）
```

## 使用

### Web UI（设置 → 插件 → 插件配置）

| 操作 | 说明 |
|---|---|
| API 配置 | 填集合父目录（扫描其下所有 `*.cfg`，以 host 为集合名），**失焦或回车自动保存** |
| 扫描 | 重扫目录：接口列表严格等于当前各集合 cfg 内容；**目录留空点击则清空列表** |
| 集合手风琴 | 每个集合一个可折叠分组，展示集合名、接口数、baseUrl 与接口列表（只读，增删请在 cfg 中操作） |

### Agent 工具

插件向 agent 注册两个工具（`{prefix}` 默认 `api`）：

| 工具 | 用途 |
|---|---|
| `api_api_doc` | 查接口文档：传 `path` 返回该接口的参数与响应说明；不传返回通用说明和各集合的接口目录 |
| `api_api_request` | 真正调用接口：`path` 必须在白名单内，GET 用 `query`，POST 用 `body` |

多集合规则：

- path 默认写接口路径（如 `/users/page`），在全部集合中查找；**跨集合同名接口需用「集合名/路径」消歧**（如 `site-a.example.com/users/page`）
- 每个集合使用自己 api.cfg 里的 baseUrl 发请求，互不混淆
- 接口文档也按集合独立查找（各集合自己的 api_doc.md）

超出 api.cfg 范围的请求（无论查文档还是发请求）会被直接拒绝，并提示可用接口列表。

安全机制：

- **删除接口二次确认**：调用 `DELETE` 时首次只返回确认提示，不会执行；需携带 `confirm=true` 再次调用才会真正执行
- **写操作警告**：`POST` / `PUT` / `PATCH` 的返回结果前会附带警告块，明示将执行的接口、完整地址与参数

## 排查

dsh 控制台日志：

```
[dsh-apis-plugin] loaded; endpoints=N, collections=a.com,b.com
```

- `endpoints=0`：检查 API 目录路径是否正确、各子文件夹下是否有 `*.cfg`（且含 apis）
- 加载后列表与 cfg 不一致：确认已在配置页点过「扫描」
- 提示未配置 baseUrl：在对应集合的 cfg 文件写入 `baseUrl=http://...`

## License

MIT
