# OpenCode 自定义 Provider 插件（Command Code 网关）设计

日期：2026-09-30
状态：待评审

## 1. 目标

为 OpenCode V2 开发一个可发布的插件包，把当前手写在 `~/.config/opencode/opencode.jsonc`
里的 `cm` provider 改造成插件自动管理，解决两个具体问题：

1. **自动发现 + 定时刷新模型列表**。当前只手写了 4 个模型，而网关实际提供 86 个；
   每次网关上新模型都要手工编辑配置。
2. **API key 迁移出配置文件**。当前 key 以明文写在 `opencode.jsonc` 的
   `providers.cm.settings.apiKey` 里。

非目标（明确排除）：

- 不实现自定义 provider runtime（OpenCode 已内置成熟的 `openai-compatible` /
  `anthropic-compatible` 驱动，重写是功能倒退）。
- 不做网关协议适配（实测网关的 OpenAI / Anthropic 兼容层行为正常，无需 hook
  改写出入站流量）。
- 不做 `cost` / `capabilities` 探测（网关不提供这些数据，逐个探测 86 个模型成本过高）。

## 2. 实测事实（本次勘察结论，非假设）

所有事实均通过对 `https://api.commandcode.ai/provider/v1` 的实际请求验证。

### 2.1 `/models` 返回结构

`GET {baseURL}/models`，`Authorization: Bearer <key>` → HTTP 200：

```json
{
  "object": "list",
  "data": [
    {
      "id": "claude-sonnet-5-5",
      "object": "model",
      "created": 1790783108,
      "owned_by": "command-code",
      "name": "Claude Sonnet 5.5",
      "context_length": 1000000,
      "supported_endpoints": ["/messages"]
    }
  ]
}
```

共 **86** 条。

### 2.2 关键发现：`supported_endpoints` 决定了必须逐模型路由

| `supported_endpoints` | 数量 | 应使用的 runtime |
| --- | --- | --- |
| `/chat/completions` + `/responses` | 67 | `openai-compatible/responses` |
| 仅 `/chat/completions` | 9 | `openai-compatible` |
| 仅 `/messages` | 10 | `anthropic-compatible` |

10 个 `/messages`-only 模型全部是 Claude 系：`claude-sonnet-5-5`、
`claude-sonnet-5`、`claude-sonnet-4-6`、`claude-fable-5-1`、`claude-fable-5`、
`claude-opus-5-5`、`claude-opus-5`、`claude-opus-4-8`、`claude-opus-4-7`、
`claude-haiku-4-5-20251001`。

**这是本项目必须做成插件的核心理由**：静态配置无法按模型切换 runtime package。
`opencode.jsonc` 的 `providers.<id>.package` 是 provider 级的单一值。

### 2.3 路由规则已被网关自身验证

| 请求 | 结果 |
| --- | --- |
| `POST /responses` + `Qwen/Qwen3.7-Flash`（清单标支持 `/responses`） | HTTP 200，`"object":"response"` |
| `POST /responses` + `stealth/space-bunny-alpha`（清单标**不**支持 `/responses`） | HTTP 400 |

网关主动拒绝了不支持的端点，说明 `supported_endpoints` 字段可信，逐模型路由是必需而非可选。

### 2.4 认证方式

`/chat/completions`、`/responses`、`/messages` 三条路由均接受
`Authorization: Bearer <key>`；`/messages` 也接受 `x-api-key` + `anthropic-version`。
两种方式均返回 200（非 401），认证不受影响。

### 2.5 `context_length` 100% 覆盖

86/86 条都带 `context_length`，分布为：
`1050000`×7、`1048576`×12、`1000000`×40、`500000`×3、`400000`×4、
`262144`×6、`262000`×1、`256000`×6、`200000`×7。

当前手写配置里那三个精调的 limit 值全部可以由该字段自动得出，无需 overrides 表。

### 2.6 模型 ID 含斜杠与冒号，但安全

31 个 ID 含 `/`（如 `deepseek/deepseek-v4.1-flash`、`Qwen/Qwen3.8-27B`），
2 个含 `:`（如 `inclusionai/ling-3.0-flash-sante:free`）。

`Model.Ref.parse` 的实现用 `input.indexOf("/")` 切**第一个**斜杠：

```js
const providerEnd = input.indexOf("/")
const providerID = input.slice(0, providerEnd)
const id = input.slice(providerEnd + 1, variantStart === -1 ? undefined : variantStart)
```

因此 `cm/deepseek/deepseek-v4.1-flash` 正确解析为
`{ providerID: "cm", id: "deepseek/deepseek-v4.1-flash" }`。**原始 ID 可直接使用，
无需 slugify。** `#` 是 variant 分隔符，86 个 ID 中无一含 `#`。

### 2.7 部分模型无权访问，且清单不反映授权

实测 `gpt-6.1-sol` 和 `claude-opus-4-8` 都在 `/models` 清单里，但实际请求返回
**403**（非 401，换 UA 无变化，确认是按模型授权而非 WAF 拦截）。
`Qwen/Qwen3.7-Flash`、`stealth/space-bunny-alpha`、`claude-sonnet-5-5` 返回 200。

`/models` 响应里没有任何授权信息，无法预先过滤。逐个预探测 86 个模型成本不可接受。

### 2.8 网关缺失的字段

| 字段 | 情况 |
| --- | --- |
| `limit.output` | 不提供。`Model.Info.default` 给 32_000 |
| `capabilities` | 不提供。取 `Capabilities.default()`（tools:true, text+image） |
| `cost` | 不提供。保持 `[]` |
| `time.released` | `created` 字段 86 条**全部相同**（`1790783108`），是目录发布时间而非模型发布日期，不可用作排序 |

### 2.9 V2 插件 API 能力确认

在 `~/.config/opencode/node_modules/@opencode/schema@2.0.11` 中确认：

- `Provider.Info` 含 `integrationID?: Integration.ID` 字段，可指向插件注册的 integration
- `Provider.Info.empty(id)` → `{ id, name: id, activation: "auto", package: "" }`
- `Model.Info` 含 `package?: string`，**支持逐模型 runtime 覆盖**
- `Model.Info.default(providerID, id)` 提供完整默认值
- `Integration.Method` 支持 `type: "string"`（API key 输入框）
- 存在 `credential.updated` / `credential.switched` 事件，携带 `integrationID` 与 `credentialID`
- `@opencode/ai/providers/{openai-compatible,openai-compatible-responses,anthropic-compatible}`
  三个 runtime 在本机均可解析
- `ctx.session.hook("retry", cb, { providerID })` 的 `event.error.status` 可观测 401/403

## 3. 方案选择

**采用方案 A：纯插件层（`integration.transform` + `provider.transform`）。**

- 方案 B（自写 provider runtime 包）：否决。OpenCode 已内置成熟驱动，重写是功能倒退，
  工作量高一个数量级。
- 方案 C（provider 留在配置里，插件只管发现）：否决。未解决 key 迁移问题；`models.set`
  会整体替换清单，与配置里手写的 `models` 叠加语义混乱。可作降级路径，不作主方案。

## 4. 架构与数据流

```
opencode.jsonc
  plugins: [{ package: "file:///D:/code/repos/ocplugin" }]
  providers.cm  ← 整块删除（含明文 key）
        │
        ▼
   setup(ctx)
        │
        ├─ 1. integration.transform 注册 integration "cm"
        │     method: { id: "api-key", type: "string", label: "API Key" }
        │     → /connect 列表出现 "Command Code"
        │
        ├─ 2. event.subscribe() 监听 credential.updated / credential.switched
        │     → 触发 refresh()，/connect 完成后立即生效，无需重启
        │
        ├─ 3. connection.active("cm") → connection.resolve() → CredentialValue
        │     ├─ 已连接 → 继续
        │     └─ 未连接 → 注册 activation:"auto" 的空 provider，不出现在 /models
        │
        ├─ 4. GET {baseURL}/models   (Authorization: Bearer <credential>)
        │     → 86 条 { id, name, context_length, supported_endpoints }
        │
        └─ 5. provider.transform(editor => editor.add({ info, models, sourceConnection }))
              ├─ Provider.Info { id:"cm", integrationID:"cm", activation:"auto",
              │                  name:"Command Code",
              │                  package:"@opencode/ai/providers/openai-compatible",
              │                  settings:{ baseURL } }
              └─ Model.Info[86]，逐模型 package 按 §4.1 规则
        │
        ▼
   setInterval(refresh, refreshInterval)
        ├─ 成功 → 替换模型清单 → ctx.provider.reload()
        └─ 失败 → 保留上次成功结果 + console.error，绝不清空
```

### 4.1 路由规则

```ts
export function packageFor(endpoints: readonly string[] = []): string {
  if (endpoints.includes("/responses")) return "@opencode/ai/providers/openai-compatible/responses"
  if (endpoints.includes("/chat/completions")) return "@opencode/ai/providers/openai-compatible"
  return "@opencode/ai/providers/anthropic-compatible"
}
```

映射结果：67 → responses，9 → chat，10 → anthropic。合计 86。

`responses` 优先是需求方明确选择。若某模型在网关上的 `/responses` 行为异常，
可通过 options 的 `overrides.<id>.package` 回退到 chat。

### 4.2 三层不变量

1. **`sourceConnection` 必需**。仅设 `integrationID` 不够。文档语义：设置了
   `sourceConnection` 的 provider，在选中其他凭据期间会被排除，直到插件 publish
   新的清单。这正是期望行为——切换账号后旧账号的模型清单不会残留。
2. **刷新失败不清空**。网关临时 502 时 86 个模型必须仍可在 `/models` 中选到。
   实现上 `refresh()` 只在成功时替换内存状态。
3. **未连接时 `activation: "auto"`**，provider 不出现在 `/models`，避免 86 个
   不可用模型污染列表。

## 5. 数据映射

`src/discovery.ts` 中的纯函数，86 个模型全部经过它：

```ts
export function toModelInfo(raw: GatewayModel, providerID: Provider.ID): Model.Info {
  const info = {
    ...Model.Info.default(providerID, Model.ID.make(raw.id)),
  }
  info.name = raw.name || raw.id
  info.limit = {
    context: raw.context_length ?? options.defaultContext,
    output: options.defaultOutput,
  }
  info.package = packageFor(raw.supported_endpoints)
  return applyOverrides(info, raw.id, options.overrides)
}
```

| `Model.Info` 字段 | 来源 | 说明 |
| --- | --- | --- |
| `id` / `modelID` | `data[].id` 原样 | 含 `/`、`:` 安全（§2.6） |
| `providerID` | 插件常量 | |
| `name` | `data[].name` fallback `id` | 网关提供友好名 |
| `limit.context` | `data[].context_length` fallback `defaultContext` | 100% 覆盖 |
| `limit.output` | `options.defaultOutput`（默认 32_000） | 网关不提供 |
| `package` | `packageFor(supported_endpoints)` | 核心逻辑 |
| `capabilities` | `Model.Info.default` 内建默认 | tools:true, text+image |
| `cost` | `[]` | 网关不提供价格 |
| `time.released` | 保持默认 `0` | `created` 是伪造的统一值（§2.8） |
| `status` | 默认 `"active"` | |
| `enabled` | 默认 `true`，被隔离集合覆盖 | §6 |

`overrides.<modelID>` 支持 `name` / `context` / `output` / `enabled` / `package`，
在默认映射之后应用。

## 6. 403/401 自动隔离

`/models` 列出的模型不代表有权限（§2.7），且无法预探测。采用惰性隔离：

```ts
await ctx.session.hook("retry", (event) => {
  const status = event.error.status ?? 0
  if (status !== 401 && status !== 403) return
  if (!quarantine.add(`${event.model.providerID}/${event.model.id}`)) return
  void ctx.storage.set(STORAGE_KEY, quarantine.list())
  void ctx.model.reload()
}, { providerID: options.providerID })
```

- 隔离集合持久化在 `ctx.storage`（键 `quarantined`）
- `ctx.model.transform` 在每次 `provider.reload()` 后重放该集合，将命中模型置
  `enabled = false`，因此刷新不会让被隔离的模型复活
- 通过 `options.quarantineOnAuthFailure: false` 可整体关闭
- 用户在 `/models` 中不再看到被隔离的模型

## 7. Options

全部可选，零配置即可用于本网关。

```ts
interface Options {
  baseURL?: string                   // 默认 "https://api.commandcode.ai/provider/v1"
  providerID?: string                // 默认 "cm"
  displayName?: string               // 默认 "Command Code"
  refreshInterval?: number           // ms，默认 600_000（10 分钟）
  defaultOutput?: number             // 默认 32_000
  defaultContext?: number            // 默认 200_000，仅 context_length 缺失时使用
  requestTimeout?: number            // ms，默认 15_000
  headers?: Record<string, string>   // 附加到 provider 的请求头
  body?: Record<string, unknown>     // 合并进 provider 的请求体
  overrides?: Record<string, {
    name?: string
    context?: number
    output?: number
    enabled?: boolean
    package?: string
  }>
  quarantineOnAuthFailure?: boolean  // 默认 true
}
```

配置侧只需：

```jsonc
{
  "plugins": ["file:///D:/code/repos/ocplugin"]
}
```

## 8. 文件结构

```
D:\code\repos\ocplugin\
  package.json          name: opencode-cm-provider, type: module, exports "." → ./dist/index.js
  tsconfig.json
  vitest.config.ts
  README.md
  src\
    index.ts             Plugin.define + setup 编排
    options.ts           Options 解析与默认值
    discovery.ts         GatewayModel → Model.Info[]，纯函数
    integration.ts       integration transform（/connect）
    registry.ts          provider transform + refresh 状态机
    quarantine.ts        401/403 隔离集合
  test\
    discovery.test.ts
    options.test.ts
    quarantine.test.ts
```

职责边界：

- `discovery.ts` **不接触 `ctx`，不做网络**。输入 JSON 对象，输出 `Model.Info[]`。
  这是可测性的核心。
- `registry.ts` 持有刷新状态机（last-good 清单），是唯一调用
  `ctx.provider.transform` / `ctx.provider.reload` 的模块。
- `integration.ts` 与 `quarantine.ts` 各自只负责一个域。

## 9. 测试策略

单元测试（vitest），不做需要真实服务器的集成测试。

- `discovery.test.ts`
  - 三种 `supported_endpoints` 组合 → 三个正确的 package（含 responses 优先）
  - 含 `/` 与 `:` 的 ID 原样保留在 `id` 与 `modelID`
  - `context_length` 缺失 → 回退 `defaultContext`
  - `name` 缺失 → 回退 `id`
  - `overrides` 覆盖 `name`/`context`/`output`/`enabled`/`package`
  - fixture 取本次真实探测到的响应样本（压缩为代表性集合）
- `options.test.ts`
  - 空对象 → 全部默认值
  - 非法 `refreshInterval` / `defaultOutput` 拒绝或回退
  - 未知选项键的处理
- `quarantine.test.ts`
  - 401/403 → 加入集合
  - 400/500/网络错误 → 不加入
  - 重复触发只落盘一次
  - 序列化往返

手动验证清单（需真实服务）：

1. 删掉 `providers.cm` 后 `/models` 不应出现 cm 的任何模型
2. `/connect` 完成后不重启，`/models` 应出现 86 个
3. `cm/claude-sonnet-5-5` 可正常对话（验证 anthropic 路径）
4. `cm/Qwen/Qwen3.7-Flash` 可正常对话（验证 responses 路径）
5. 主动请求 `cm/gpt-6.1-sol` 返回 403 后，该模型从 `/models` 消失

## 10. 迁移步骤

1. 在 `D:\code\repos\ocplugin` 执行 `npm install && npm run build`
2. 编辑 `~/.config/opencode/opencode.jsonc`：
   - **删除整个 `providers.cm` 块**（第 8–43 行）
   - `plugins` 数组增加 `"file:///D:/code/repos/ocplugin"`
3. `opencode service restart`
4. TUI 内 `/connect` → 选择 **Command Code** → 粘贴 API key
5. `/models` 应出现 86 个模型
6. **轮换该 API key**。它以明文存在于 `opencode.jsonc` 中，且本次勘察期间被用于
   shell 命令，应视为已泄露

## 11. 已知限制

- `limit.output` 统一取 32_000。网关不提供该值；对输出上限更高的模型会保守限制。
  可用 `overrides` 修正。
- `capabilities.input` 默认含 `image`。86 个模型里存在纯文本模型
  （`Qwen/Qwen3.8-27B`、`gpt-5.4-mini`、`zai-org/GLM-5.1` 等），给它们传图会返回 400
  错误。选择乐观默认（保持视觉能力可见）而非保守默认（静默丢失视觉能力），
  错误可见且可用 `overrides` 修正。
- `cost` 为空，因此 `/models` 不显示价格信息。
- `time.released` 为 0，模型无法按发布时间排序。
- 隔离机制依赖实际请求失败，因此一个无权模型的首次调用必然失败一次。
- 仅支持 `key` 类型凭据，不支持 OAuth。

## 12. 参考

- V2 插件文档：<https://opencode.ai/v2/docs/build/plugins>
- V2 Provider 配置：<https://opencode.ai/v2/docs/providers>
- 本机 schema 包：`~/.config/opencode/node_modules/@opencode/schema@2.0.11`
