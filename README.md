# dsh-apis-plugin

通用接口管理插件（DeepSeek Harness / Cordis 双面插件）：把任意一套 HTTP 接口注册成 agent 可用的**文档查询 + 请求调用**双工具。

核心约定：**`api.cfg` 是接口的唯一权威范围**——agent 只能请求 api.cfg 中列出的接口，范围外一律拒绝。

## 安装

```sh
dsh plugin --profile web add dsh-apis-plugin
```

安装后重启 `dsh web` 生效。指定版本：

```sh
dsh plugin --profile web add dsh-apis-plugin@0.1.5
```

## 配置

### 1. api.cfg（接口清单，必需）

在插件配置页指定的 API 目录下创建 `api.cfg`（key=value 行，`#` 注释，UTF-8 编码）：

```ini
# 接口服务前缀：域名 + nginx 前缀 + 网关路由段
baseUrl=http://your-host/prod-api

# 接口列表：逗号分隔同行书写
apis=/users/page,/users/{id}

# 或逐行列举
apis=
  /outline/page
  /outline/detailByNos
  /basicTargetChar/item/listByTargetCharId
```

- `baseUrl`：请求时拼接在接口路径前（改文件即生效，无需重启）
- `apis`：接口白名单，支持 `{param}` 模板段（如 `/users/{id}`），agent 请求时填实际值
- **增删接口只改这个文件**，改完点插件配置页的「加载API」（或重启）生效

### 2. api_doc.md（接口文档，建议提供）

与 `api.cfg` 同目录。用 `---` 分节，每节描述一个接口，节内用反引号标注接口路径：

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
| 加载API | 重扫目录：接口列表严格等于当前 api.cfg 内容 |
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
- 加载后列表与 api.cfg 不一致：确认已在配置页点过「加载API」
- 提示未配置 baseUrl：在 api.cfg 写入 `baseUrl=http://...`

## License

MIT
