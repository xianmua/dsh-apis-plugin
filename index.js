// 通用接口管理插件：把任意一套 HTTP 接口注册成 agent 可用的文档查询与请求双工具
// 领域差异（工具前缀、领域名、文档目录、baseUrl、默认接口列表）全部由部署侧 cordis.patch.yml 的 config 注入；
// 通用逻辑（工具注册、prompt 拼接、接口匹配、settings 注册）在同目录 api-tools.js 的 defineApiPlugin
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { defineApiPlugin, readPatchId, syncClientNs } from './api-tools.js'

const here = dirname(fileURLToPath(import.meta.url))

// 命名空间以 cordis.patch.yml 的 id 为准，加载时自动同步到 client.js
const ns = readPatchId(here)
syncClientNs(here, ns)

const plugin = defineApiPlugin({ ns })

export const Config = plugin.Config
export const inject = plugin.inject
export const apply = plugin.apply
