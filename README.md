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

建议把 `api.cfg` 和 `api_doc.md` 一起放在同一个目录下（如项目的 `config/` 目录），然后在插件配置页把「API配置」指向该目录：

```
config/
├── api.cfg      # 接口清单
└── api_doc.md   # 接口文档
```

### 1. api.cfg（接口清单，必需）

key=value 行格式，`#` 注释，UTF-8 编码：

```ini
# 接口服务前缀：域名 + nginx 前缀 + 网关路由段
baseUrl=http://your-host/prod-api

# 接口列表：apis= 下面逐行一个接口
apis=
  /users/page
  /users/{id}
  /outline/page
  /outline/detailByNos
```

- `baseUrl`：请求时拼接在接口路径前（改文件即生效，无需重启）
- `apis`：接口白名单，支持 `{param}` 模板段（如 `/users/{id}`），agent 请求时填实际值
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
| API 配置 | 填 api.cfg / api_doc.md 所在目录，**失焦或回车自动保存** |
| 扫描 | 重扫目录：接口列表严格等于当前 api.cfg 内容；**目录留空点击则清空列表** |
| 接口列表 | 只读展示，增删请在 api.cfg 中操作 |

### Agent 工具

插件向 agent 注册两个工具（`{prefix}` 默认 `api`）：

| 工具 | 用途 |
|---|---|
| `api_api_doc` | 查接口文档：传 `path` 返回该接口的参数与响应说明；不传返回通用说明和已配置接口目录 |
| `api_api_request` | 真正调用接口：`path` 必须在白名单内，GET 用 `query`，POST 用 `body` |

超出 api.cfg 范围的请求会被直接拒绝，并提示可用接口列表。

## 排查

dsh 控制台日志：

```
[dsh-apis-plugin] loaded; endpoints=N, doc sections=M
```

- `endpoints=0`：检查 API 目录路径是否正确、api.cfg 是否与目录同级
- 加载后列表与 api.cfg 不一致：确认已在配置页点过「扫描」
- 提示未配置 baseUrl：在 api.cfg 写入 `baseUrl=http://...`

## License

MIT
