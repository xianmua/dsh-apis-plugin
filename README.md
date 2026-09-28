# dsh-apis-plugin

通用接口管理插件（DSH 插件）：把任意一套 HTTP 接口注册成 agent 可用的**文档查询 + 请求调用**双工具。

核心约定：**`api.cfg` 是接口的唯一权威范围**——范围外的请求一律拒绝。

## 版本兼容

需要 **DSH >=0.1.7-rc.2**（详情页徽章据此显示）。DSH 0.1.5 / 0.1.6 请用旧版 `dsh-apis-plugin@0.2.3`。

## 安装

```sh
dsh plugin --profile web add dsh-apis-plugin@0.3.1
```

## 配置

「API配置」指向一个**集合父目录**，插件递归扫描其下所有 `*.cfg`，**每个 cfg 是一个集合**（集合名取 cfg 的 `host` 字段）：

```
config/
├── site-a.example.com/
│   ├── api.cfg           # host=site-a.example.com
│   └── api_doc.md        # 该集合的接口文档
└── site-b.example.com/
    ├── api.cfg
    └── api_doc.md
```

### api.cfg（每个集合一份，必需）

```ini
# 集合标识（如域名），用于展示与「集合名/路径」消歧
host=site-a.example.com

# 集合用途说明（可选），展示在接口目录与手风琴中
title=xxx

# 该集合的接口服务前缀
baseUrl=http://your-host/api

# 接口白名单：逐行一个，支持 {param} 模板段
apis=
  /users/page
  /users/{id}
```

改 cfg 后点插件详情页的「扫描」（或重启）生效。

### api_doc.md（接口文档，建议提供）

与 `api.cfg` 放在一起，用 `---` 分节，每节描述一个接口，节内用反引号标注路径（如 `` `/users/page` ``）。agent 调用 `{prefix}_api_doc` 时按路径命中对应小节返回。

### 部署侧 cordis.patch.yml（可选）

```yaml
- insert:
    - id: dsh-apis-plugin
      name: dsh-apis-plugin
      config:
        domain: "用户中心"        # 领域名：拼进工具描述 prompt
        toolPrefix: api           # 工具名前缀：生成 api_api_doc / api_api_request
        apiDir: ""                # 集合父目录默认值（留空则在 UI 里填）
        endpoints: []             # 额外固定接口（不随扫描回写）
        baseUrl: ""               # 服务前缀兜底（api.cfg 优先）
```

## 使用

### Web UI（设置 → 接口管理）

| 操作 | 说明 |
|---|---|
| API配置 | 填集合父目录，失焦或回车自动保存 |
| 扫描 | 重扫目录；**目录留空点击则清空列表** |
| 集合手风琴 | 展示集合名、用途、接口数、baseUrl 与接口列表（只读，增删请在 cfg 中操作） |

### Agent 工具

| 工具 | 用途 |
|---|---|
| `api_api_doc` | 查接口文档：传 `path` 返回该接口的参数与响应说明；不传返回全部接口目录 |
| `api_api_request` | 调用接口：`path` 必须在白名单内，GET 用 `query`，POST 用 `body` |

- path 默认写接口路径（如 `/users/page`）；**跨集合同名接口用「集合名/路径」消歧**（如 `site-a.example.com/users/page`）
- 安全机制：`DELETE` 需二次确认（首次只返回确认提示，确认后带 `confirm=true` 再调）；写操作返回结果附带警告块

## 排查

dsh 控制台日志：

```
[dsh-apis-plugin] loaded; apiDir=/path/to/config, endpoints=N, collections=a.com,b.com
```

- `endpoints=0`：检查 apiDir 是否正确、其下是否有含 apis 的 `*.cfg`
- 列表与 cfg 不一致：点「扫描」或重启

## License

MIT
