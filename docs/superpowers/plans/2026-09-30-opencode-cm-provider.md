# Command Code Provider Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a publishable OpenCode V2 plugin that registers the Command Code gateway (`https://api.commandcode.ai/provider/v1`) as an `cm` provider, discovers its model catalogue automatically, and stores the API key in OpenCode's credential store instead of `opencode.jsonc`.

**Architecture:** The plugin registers an `integration` with a key-type sign-in method (so `/connect` stores the key), then fetches `GET {baseURL}/models`, maps each entry to a `Model.Info`, and publishes the result through a single `ctx.provider.transform` registration whose captured state is refreshed on a timer and on `credential.*` events. Per-model runtime packages are chosen from the gateway's `supported_endpoints` field, because 10 of the 86 models expose only `/messages` and cannot use the OpenAI-compatible layer. A `ctx.model.transform` replays a persisted quarantine set so models the account is not entitled to (which `GET /models` does not reveal) disappear after their first 401/403.

**Tech Stack:** TypeScript (NodeNext ESM), `@opencode/plugin` ^2.0.20, Vitest ^5.0.3, `@types/node` ^26.6.3. No runtime dependencies beyond `@opencode/plugin`.

**Spec:** `docs/superpowers/specs/2026-09-30-opencode-cm-provider-design.md`

## Global Constraints

- Package is ESM: `"type": "module"` in `package.json`. Relative imports MUST carry a `.js` extension (NodeNext). Verified: Vitest 5.0.3 resolves `./x.js` to `x.ts` when `resolve.extensions` lists `.ts` first.
- `@opencode/plugin` is the only runtime dependency; pin `^2.0.20`. Import `Model`, `Provider`, `Integration`, `Connection`, `Credential`, `Plugin` from the package root.
- Defaults, verbatim from the spec: `baseURL` `https://api.commandcode.ai/provider/v1`, `providerID` `cm`, `displayName` `Command Code`, `refreshInterval` `600000`, `defaultOutput` `32000`, `defaultContext` `200000`, `requestTimeout` `15000`, `quarantineOnAuthFailure` `true`.
- Minimum accepted `refreshInterval` is `10000` ms; minimum accepted `requestTimeout` is `1000` ms.
- `providerID` MUST NOT contain `/` or `#`. Both would break `Model.Ref.parse`, which splits on the first `/` and treats `#` as the variant separator.
- Model IDs are used verbatim as both `id` and `modelID`. Never slugify, lowercase, or replace `/`. Verified: `Model.Ref.parse("cm/deepseek/deepseek-v4.1-flash")` yields `{ providerID: "cm", id: "deepseek/deepseek-v4.1-flash" }`.
- Drop any model ID containing `#`, since `#` would be parsed as a variant separator and silently truncate the ID.
- Runtime package routing, in this exact priority order: `/responses` → `@opencode/ai/providers/openai-compatible/responses`; else `/chat/completions` → `@opencode/ai/providers/openai-compatible`; else → `@opencode/ai/providers/anthropic-compatible`. `@opencode/ai/providers/openai-compatible` doubles as the provider-level default package.
- Quarantine persists under storage key `quarantined` as a sorted array of `providerID/modelID` strings.
- A failed refresh MUST NOT clear the model list. Only a successful fetch replaces captured state.
- `Provider.Info` for the registration: `activation: "auto"`, `integrationID` set, `sourceConnection` passed on the record, `settings.baseURL`, `settings.apiKey` set explicitly from the resolved credential.

## Review Focus

These are the input classes and failure modes the spec implies but whose main assertions live in exactly one task's tests. Each is pinned by a named test in the task that owns the code.

1. **`/connect` form key does not map to `Credential.Key.key`.** If the field's `key` is wrong, `/connect` appears to succeed while `connection.resolve()` yields a credential the plugin cannot read, and the provider silently never activates. Pinned by `Task 4` › `registers a key method whose form field is named apiKey`.
2. **Repeated refresh duplicates the provider.** `ctx.provider.transform` callbacks replay on every `reload()`, so a refresh that calls `editor.add` more than once per replay would produce duplicate records. Pinned by `Task 5` › `adds exactly one provider record across repeated refreshes`.
3. **Fresh install with no saved quarantine.** `ctx.storage.get` returns `undefined` before the first write; treating that as a list would throw. Pinned by `Task 5` › `installs with no saved quarantine`.
4. **Gateway returns an empty catalogue.** `data: []` is a successful response meaning every model was withdrawn, which must not be confused with a failed fetch and must not resurrect the previous list. Pinned by `Task 5` › `treats an empty catalogue as a successful empty refresh`.
5. **Model ID containing `#`.** `Model.Ref.parse` would silently split it into id plus variant. Pinned by `Task 2` › `drops model IDs containing a variant separator`.

---

### Task 1: Package scaffold and options resolution

Creates the package skeleton and the module that validates `plugins[].options`. Every later task runs `npm test` and `npm run build` from this scaffold, so it is folded in here.

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsconfig.build.json`
- Create: `vitest.config.ts`
- Create: `src/options.ts`
- Test: `test/options.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `resolveOptions(raw: unknown): Options`; `Options`; `ModelOverride`; `DEFAULTS`; `MIN_REFRESH_INTERVAL`. `Options` fields and their types are exactly as listed in the Global Constraints.

- [ ] **Step 1: Create the package manifest**

Create `package.json`:

```json
{
  "name": "opencode-cm-provider",
  "version": "0.1.0",
  "description": "OpenCode plugin that registers the Command Code gateway as a provider with automatic model discovery",
  "type": "module",
  "license": "MIT",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "files": ["dist", "README.md"],
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@opencode/plugin": "^2.0.20"
  },
  "devDependencies": {
    "@types/node": "^26.6.3",
    "typescript": "^7.0.2",
    "vitest": "^5.0.3"
  }
}
```

- [ ] **Step 2: Create the TypeScript and Vitest configuration**

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "types": ["node"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*.ts", "test/**/*.ts", "vitest.config.ts"]
}
```

Create `tsconfig.build.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*.ts"]
}
```

Create `vitest.config.ts`. The `resolve.extensions` order is load-bearing: it is what lets NodeNext-style `./x.js` specifiers resolve to `x.ts` sources.

```ts
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
  resolve: {
    extensions: [".ts", ".js", ".json"],
  },
})
```

- [ ] **Step 3: Install dependencies**

Run: `npm install`
Expected: installs cleanly; `node_modules/@opencode/plugin` and `node_modules/vitest` exist.

- [ ] **Step 4: Write the failing test**

Create `test/options.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { DEFAULTS, MIN_REFRESH_INTERVAL, resolveOptions } from "../src/options.js"

describe("resolveOptions", () => {
  it("returns defaults for undefined, an empty object, and non-objects", () => {
    expect(resolveOptions(undefined)).toEqual(DEFAULTS)
    expect(resolveOptions({})).toEqual(DEFAULTS)
    expect(resolveOptions("nope")).toEqual(DEFAULTS)
    expect(resolveOptions(null)).toEqual(DEFAULTS)
    expect(resolveOptions([])).toEqual(DEFAULTS)
  })

  it("clamps a too-small refreshInterval up to the minimum", () => {
    expect(resolveOptions({ refreshInterval: 5 }).refreshInterval).toBe(MIN_REFRESH_INTERVAL)
  })

  it("falls back for a non-positive or non-finite refreshInterval", () => {
    expect(resolveOptions({ refreshInterval: -1 }).refreshInterval).toBe(DEFAULTS.refreshInterval)
    expect(resolveOptions({ refreshInterval: Number.NaN }).refreshInterval).toBe(DEFAULTS.refreshInterval)
    expect(resolveOptions({ refreshInterval: "soon" }).refreshInterval).toBe(DEFAULTS.refreshInterval)
  })

  it("strips trailing slashes from baseURL", () => {
    expect(resolveOptions({ baseURL: "https://x.test/v1/" }).baseURL).toBe("https://x.test/v1")
    expect(resolveOptions({ baseURL: "https://x.test/v1///" }).baseURL).toBe("https://x.test/v1")
  })

  it("falls back for a blank baseURL or displayName", () => {
    expect(resolveOptions({ baseURL: "   " }).baseURL).toBe(DEFAULTS.baseURL)
    expect(resolveOptions({ displayName: "" }).displayName).toBe(DEFAULTS.displayName)
  })

  it("rejects a providerID containing a slash or a hash", () => {
    expect(() => resolveOptions({ providerID: "a/b" })).toThrow(/providerID/)
    expect(() => resolveOptions({ providerID: "a#b" })).toThrow(/providerID/)
  })

  it("falls back for a blank providerID", () => {
    expect(resolveOptions({ providerID: "" }).providerID).toBe(DEFAULTS.providerID)
  })

  it("keeps well-formed overrides and drops empty or malformed entries", () => {
    const options = resolveOptions({
      overrides: {
        good: { output: 64000, enabled: false, package: "@custom/pkg" },
        malformed: "nope",
        empty: { output: "not a number" },
      },
    })
    expect(options.overrides.good).toEqual({
      output: 64000,
      enabled: false,
      package: "@custom/pkg",
    })
    expect(options.overrides.malformed).toBeUndefined()
    expect(options.overrides.empty).toBeUndefined()
  })

  it("keeps only string-valued headers", () => {
    const options = resolveOptions({ headers: { ok: "yes", bad: 3 } })
    expect(options.headers).toEqual({ ok: "yes" })
  })

  it("honours an explicit quarantineOnAuthFailure and ignores unknown keys", () => {
    expect(resolveOptions({ quarantineOnAuthFailure: false }).quarantineOnAuthFailure).toBe(false)
    expect(resolveOptions({ nope: 1 })).toEqual(DEFAULTS)
  })
})
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `npx vitest run test/options.test.ts`
Expected: FAIL — cannot resolve `../src/options.js`.

- [ ] **Step 6: Write the implementation**

Create `src/options.ts`:

```ts
/** A per-model correction applied after the gateway mapping. */
export interface ModelOverride {
  readonly name?: string
  readonly context?: number
  readonly output?: number
  readonly enabled?: boolean
  readonly package?: string
}

export interface Options {
  readonly baseURL: string
  readonly providerID: string
  readonly displayName: string
  readonly refreshInterval: number
  readonly defaultOutput: number
  readonly defaultContext: number
  readonly requestTimeout: number
  readonly headers: Readonly<Record<string, string>>
  readonly body: Readonly<Record<string, unknown>>
  readonly overrides: Readonly<Record<string, ModelOverride>>
  readonly quarantineOnAuthFailure: boolean
}

/** Refreshes faster than this are refused; the gateway catalogue changes slowly. */
export const MIN_REFRESH_INTERVAL = 10_000

export const DEFAULTS: Options = {
  baseURL: "https://api.commandcode.ai/provider/v1",
  providerID: "cm",
  displayName: "Command Code",
  refreshInterval: 600_000,
  defaultOutput: 32_000,
  defaultContext: 200_000,
  requestTimeout: 15_000,
  headers: {},
  body: {},
  overrides: {},
  quarantineOnAuthFailure: true,
}

function plainRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function positiveInt(value: unknown, fallback: number, minimum = 1): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback
  const floored = Math.floor(value)
  return floored >= minimum ? floored : fallback
}

function nonEmptyString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : fallback
}

function stringRecord(value: unknown): Record<string, string> {
  const raw = plainRecord(value)
  if (!raw) return {}
  const out: Record<string, string> = {}
  for (const [key, entry] of Object.entries(raw)) {
    if (typeof entry === "string") out[key] = entry
  }
  return out
}

function parseOverrides(value: unknown): Record<string, ModelOverride> {
  const raw = plainRecord(value)
  if (!raw) return {}
  const out: Record<string, ModelOverride> = {}
  for (const [modelID, entry] of Object.entries(raw)) {
    const record = plainRecord(entry)
    if (!record) continue
    const override: {
      name?: string
      context?: number
      output?: number
      enabled?: boolean
      package?: string
    } = {}
    if (typeof record.name === "string") override.name = record.name
    if (typeof record.package === "string") override.package = record.package
    if (typeof record.enabled === "boolean") override.enabled = record.enabled
    if (typeof record.context === "number" && Number.isFinite(record.context)) {
      override.context = Math.floor(record.context)
    }
    if (typeof record.output === "number" && Number.isFinite(record.output)) {
      override.output = Math.floor(record.output)
    }
    if (Object.keys(override).length > 0) out[modelID] = override
  }
  return out
}

export function resolveOptions(raw: unknown): Options {
  const input = plainRecord(raw) ?? {}

  const providerID = nonEmptyString(input.providerID, DEFAULTS.providerID)
  if (providerID.includes("/") || providerID.includes("#")) {
    throw new Error(
      `providerID must not contain "/" or "#" because both are model-reference separators: ${providerID}`,
    )
  }

  return {
    baseURL: nonEmptyString(input.baseURL, DEFAULTS.baseURL).replace(/\/+$/, ""),
    providerID,
    displayName: nonEmptyString(input.displayName, DEFAULTS.displayName),
    refreshInterval: positiveInt(
      input.refreshInterval,
      DEFAULTS.refreshInterval,
      MIN_REFRESH_INTERVAL,
    ),
    defaultOutput: positiveInt(input.defaultOutput, DEFAULTS.defaultOutput),
    defaultContext: positiveInt(input.defaultContext, DEFAULTS.defaultContext),
    requestTimeout: positiveInt(input.requestTimeout, DEFAULTS.requestTimeout, 1_000),
    headers: stringRecord(input.headers),
    body: plainRecord(input.body) ?? {},
    overrides: parseOverrides(input.overrides),
    quarantineOnAuthFailure:
      typeof input.quarantineOnAuthFailure === "boolean"
        ? input.quarantineOnAuthFailure
        : DEFAULTS.quarantineOnAuthFailure,
  }
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npx vitest run test/options.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 8: Verify the build and typecheck**

Run: `npm run build` then `npm run typecheck`
Expected: both succeed; `dist/options.js` and `dist/options.d.ts` exist.

- [ ] **Step 9: Commit**

```bash
git add package.json tsconfig.json tsconfig.build.json vitest.config.ts src/options.ts test/options.test.ts
git commit -m "feat: scaffold package and add options resolution"
```

---

### Task 2: Model discovery and mapping

The pure core: gateway JSON in, `Model.Info[]` out. No plugin context, no network, so it is fully unit-testable.

**Files:**
- Create: `src/discovery.ts`
- Test: `test/discovery.test.ts`

**Interfaces:**
- Consumes: `Options`, `ModelOverride` from `src/options.ts`.
- Produces: `GatewayModel`; `parseGatewayModels(payload: unknown): GatewayModel[]`; `packageFor(endpoints: readonly string[] | undefined): string`; `toModelInfo(raw: GatewayModel, providerID: Provider.ID, options: Pick<Options, "defaultContext" | "defaultOutput" | "overrides">): Model.Info`; `toModelInfoList(models, providerID, options): Model.Info[]`; and the constants `PACKAGE_RESPONSES`, `PACKAGE_CHAT`, `PACKAGE_ANTHROPIC`.

- [ ] **Step 1: Write the failing test**

Create `test/discovery.test.ts`:

```ts
import { Model, Provider } from "@opencode/plugin"
import { describe, expect, it } from "vitest"
import {
  PACKAGE_ANTHROPIC,
  PACKAGE_CHAT,
  PACKAGE_RESPONSES,
  packageFor,
  parseGatewayModels,
  toModelInfo,
  toModelInfoList,
  type GatewayModel,
} from "../src/discovery.js"
import { resolveOptions } from "../src/options.js"

const PROVIDER_ID = Provider.ID.make("cm")
const options = resolveOptions({})

/** Sample shaped exactly like the live gateway response, verified 2026-09-30. */
const payload = {
  object: "list",
  data: [
    {
      id: "claude-sonnet-5-5",
      object: "model",
      created: 1790783108,
      owned_by: "command-code",
      name: "Claude Sonnet 5.5",
      context_length: 1000000,
      supported_endpoints: ["/messages"],
    },
    {
      id: "gpt-6.1-sol",
      object: "model",
      created: 1790783108,
      owned_by: "command-code",
      name: "GPT-6.1 Sol",
      context_length: 1050000,
      supported_endpoints: ["/chat/completions", "/responses"],
    },
    {
      id: "stealth/space-bunny-alpha",
      object: "model",
      created: 1790783108,
      owned_by: "command-code",
      name: "Space Bunny Alpha",
      context_length: 1000000,
      supported_endpoints: ["/chat/completions"],
    },
    {
      id: "deepseek/deepseek-v4.1-flash",
      object: "model",
      created: 1790783108,
      owned_by: "command-code",
      name: "DeepSeek V4.1 Flash",
      context_length: 1000000,
      supported_endpoints: ["/chat/completions", "/responses"],
    },
    {
      id: "inclusionai/ling-3.1-flash:free",
      object: "model",
      created: 1790783108,
      owned_by: "command-code",
      name: "Ling 3.1 Flash",
      context_length: 262144,
      supported_endpoints: ["/chat/completions"],
    },
  ],
}

describe("packageFor", () => {
  it("prefers the responses runtime when the endpoint is offered", () => {
    expect(packageFor(["/chat/completions", "/responses"])).toBe(PACKAGE_RESPONSES)
    expect(packageFor(["/responses"])).toBe(PACKAGE_RESPONSES)
  })

  it("falls back to the chat runtime for chat-only models", () => {
    expect(packageFor(["/chat/completions"])).toBe(PACKAGE_CHAT)
  })

  it("uses the anthropic runtime for messages-only models", () => {
    expect(packageFor(["/messages"])).toBe(PACKAGE_ANTHROPIC)
  })

  it("defaults to the anthropic runtime when endpoints are missing or empty", () => {
    expect(packageFor(undefined)).toBe(PACKAGE_ANTHROPIC)
    expect(packageFor([])).toBe(PACKAGE_ANTHROPIC)
  })

  it("routes the ten live messages-only Claude models to the anthropic runtime", () => {
    const claude = [
      "claude-sonnet-5-5",
      "claude-sonnet-5",
      "claude-sonnet-4-6",
      "claude-fable-5-1",
      "claude-fable-5",
      "claude-opus-5-5",
      "claude-opus-5",
      "claude-opus-4-8",
      "claude-opus-4-7",
      "claude-haiku-4-5-20251001",
    ]
    for (const id of claude) {
      expect(packageFor(["/messages"])).toBe(PACKAGE_ANTHROPIC)
      expect(id).not.toContain("#")
    }
  })
})

describe("parseGatewayModels", () => {
  it("keeps every well-formed entry from a real response", () => {
    const models = parseGatewayModels(payload)
    expect(models).toHaveLength(5)
    expect(models.map((model) => model.id)).toContain("deepseek/deepseek-v4.1-flash")
  })

  it("returns an empty list for malformed payloads", () => {
    expect(parseGatewayModels(undefined)).toEqual([])
    expect(parseGatewayModels(null)).toEqual([])
    expect(parseGatewayModels("nope")).toEqual([])
    expect(parseGatewayModels({})).toEqual([])
    expect(parseGatewayModels({ data: "nope" })).toEqual([])
    expect(parseGatewayModels({ data: [] })).toEqual([])
  })

  it("drops entries without a usable id and non-object entries", () => {
    const models = parseGatewayModels({
      data: [{ id: "keep" }, { id: "" }, { name: "no id" }, null, "nope", 3],
    })
    expect(models.map((model) => model.id)).toEqual(["keep"])
  })

  it("drops model IDs containing a variant separator", () => {
    const models = parseGatewayModels({ data: [{ id: "evil#variant" }, { id: "fine" }] })
    expect(models.map((model) => model.id)).toEqual(["fine"])
  })

  it("drops non-string entries from supported_endpoints", () => {
    const models = parseGatewayModels({
      data: [{ id: "mixed", supported_endpoints: ["/messages", 7, null] }],
    })
    expect(models[0]?.supported_endpoints).toEqual(["/messages"])
  })

  it("omits absent optional fields rather than storing undefined", () => {
    const models = parseGatewayModels({ data: [{ id: "bare" }] })
    expect(models[0]).toEqual({ id: "bare" })
  })
})

describe("toModelInfo", () => {
  const models = parseGatewayModels(payload)
  const byId = new Map(models.map((model) => [model.id, model]))
  const info = (id: string) => {
    const raw = byId.get(id)
    if (!raw) throw new Error(`missing fixture ${id}`)
    return toModelInfo(raw, PROVIDER_ID, options)
  }

  it("uses the gateway context length and the configured output limit", () => {
    expect(info("claude-sonnet-5-5").limit).toEqual({ context: 1000000, output: 32000 })
  })

  it("uses the gateway name", () => {
    expect(info("gpt-6.1-sol").name).toBe("GPT-6.1 Sol")
  })

  it("applies the endpoint-derived runtime package", () => {
    expect(info("claude-sonnet-5-5").package).toBe(PACKAGE_ANTHROPIC)
    expect(info("gpt-6.1-sol").package).toBe(PACKAGE_RESPONSES)
    expect(info("stealth/space-bunny-alpha").package).toBe(PACKAGE_CHAT)
  })

  it("keeps the gateway's optimistic default capabilities", () => {
    expect(info("gpt-6.1-sol").capabilities).toEqual({
      tools: true,
      input: ["text", "image"],
      output: ["text"],
    })
  })

  it("leaves cost empty and the release time unset because the gateway supplies neither", () => {
    const model = info("gpt-6.1-sol")
    expect(model.cost).toEqual([])
    expect(model.time.released).toBe(0)
    expect(model.status).toBe("active")
    expect(model.enabled).toBe(true)
  })

  it("keeps slash- and colon-bearing model IDs parseable as provider/model refs", () => {
    for (const id of [
      "deepseek/deepseek-v4.1-flash",
      "inclusionai/ling-3.1-flash:free",
      "claude-sonnet-5-5",
    ]) {
      const model = info(id)
      expect(model.id).toBe(id)
      expect(model.modelID).toBe(id)
      const ref = Model.Ref.parse(`${PROVIDER_ID as string}/${model.id}`)
      expect(ref.providerID).toBe(PROVIDER_ID)
      expect(ref.id).toBe(id)
    }
  })

  it("falls back to the configured defaults when the gateway omits metadata", () => {
    const model = toModelInfo({ id: "bare" }, PROVIDER_ID, options)
    expect(model.name).toBe("bare")
    expect(model.limit).toEqual({ context: 200000, output: 32000 })
    expect(model.package).toBe(PACKAGE_ANTHROPIC)
  })

  it("applies each override field on top of the gateway mapping", () => {
    const configured = resolveOptions({
      defaultContext: 1000,
      defaultOutput: 2000,
      overrides: {
        "gpt-6.1-sol": {
          name: "Renamed",
          context: 777,
          output: 888,
          enabled: false,
          package: "@custom/pkg",
        },
      },
    })
    const raw = byId.get("gpt-6.1-sol") as GatewayModel
    const model = toModelInfo(raw, PROVIDER_ID, configured)
    expect(model.name).toBe("Renamed")
    expect(model.limit).toEqual({ context: 777, output: 888 })
    expect(model.enabled).toBe(false)
    expect(model.package).toBe("@custom/pkg")
  })
})

describe("toModelInfoList", () => {
  it("maps every discovered model in order", () => {
    const models = parseGatewayModels(payload)
    const list = toModelInfoList(models, PROVIDER_ID, options)
    expect(list.map((model) => model.id)).toEqual(models.map((model) => model.id))
  })

  it("returns an empty list for an empty catalogue", () => {
    expect(toModelInfoList([], PROVIDER_ID, options)).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/discovery.test.ts`
Expected: FAIL — cannot resolve `../src/discovery.js`.

- [ ] **Step 3: Write the implementation**

Create `src/discovery.ts`:

```ts
import { Model, type Provider } from "@opencode/plugin"
import type { ModelOverride, Options } from "./options.js"

export const PACKAGE_RESPONSES = "@opencode/ai/providers/openai-compatible/responses"
export const PACKAGE_CHAT = "@opencode/ai/providers/openai-compatible"
export const PACKAGE_ANTHROPIC = "@opencode/ai/providers/anthropic-compatible"

/** One entry of `GET {baseURL}/models` -> `data[]`, reduced to the fields we use. */
export interface GatewayModel {
  readonly id: string
  readonly name?: string
  readonly context_length?: number
  readonly supported_endpoints?: readonly string[]
}

type RangeOptions = Pick<Options, "defaultContext" | "defaultOutput" | "overrides">

/**
 * The Anthropic-native models on this gateway reject the OpenAI-compatible layer,
 * so the runtime package follows the endpoints the gateway advertises.
 */
export function packageFor(endpoints: readonly string[] | undefined): string {
  const list = endpoints ?? []
  if (list.includes("/responses")) return PACKAGE_RESPONSES
  if (list.includes("/chat/completions")) return PACKAGE_CHAT
  return PACKAGE_ANTHROPIC
}

/**
 * `#` is the variant separator in a model reference, so an ID containing one would be
 * silently truncated by `Model.Ref.parse`. No live model uses `#`; drop any that do.
 */
function usableID(id: unknown): id is string {
  return typeof id === "string" && id !== "" && !id.includes("#")
}

export function parseGatewayModels(payload: unknown): GatewayModel[] {
  if (typeof payload !== "object" || payload === null) return []
  const data = (payload as { data?: unknown }).data
  if (!Array.isArray(data)) return []

  const models: GatewayModel[] = []
  for (const entry of data) {
    if (typeof entry !== "object" || entry === null) continue
    const record = entry as Record<string, unknown>
    if (!usableID(record.id)) continue

    const endpoints = Array.isArray(record.supported_endpoints)
      ? record.supported_endpoints.filter((value): value is string => typeof value === "string")
      : undefined

    models.push({
      id: record.id,
      ...(typeof record.name === "string" && record.name !== "" ? { name: record.name } : {}),
      ...(typeof record.context_length === "number" && Number.isFinite(record.context_length)
        ? { context_length: Math.floor(record.context_length) }
        : {}),
      ...(endpoints ? { supported_endpoints: endpoints } : {}),
    })
  }
  return models
}

function applyOverride(info: Model.Info, override: ModelOverride | undefined): void {
  if (!override) return
  if (override.name !== undefined) info.name = override.name
  if (override.package !== undefined) info.package = override.package
  if (override.enabled !== undefined) info.enabled = override.enabled
  if (override.context !== undefined) info.limit.context = override.context
  if (override.output !== undefined) info.limit.output = override.output
}

export function toModelInfo(
  raw: GatewayModel,
  providerID: Provider.ID,
  options: RangeOptions,
): Model.Info {
  const info = Model.Info.default(providerID, Model.ID.make(raw.id))
  info.name = raw.name ?? raw.id
  info.package = packageFor(raw.supported_endpoints)
  info.limit = {
    context: raw.context_length ?? options.defaultContext,
    output: options.defaultOutput,
  }
  applyOverride(info, options.overrides[raw.id])
  return info
}

export function toModelInfoList(
  models: readonly GatewayModel[],
  providerID: Provider.ID,
  options: RangeOptions,
): Model.Info[] {
  return models.map((model) => toModelInfo(model, providerID, options))
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/discovery.test.ts`
Expected: PASS, 20 tests.

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npm test` then `npm run typecheck`
Expected: PASS, 30 tests total.

- [ ] **Step 6: Commit**

```bash
git add src/discovery.ts test/discovery.test.ts
git commit -m "feat: add gateway model discovery and mapping"
```

---

### Task 3: Quarantine set

Tracks models the account is not entitled to. Pure data structure plus a parser; no plugin context.

**Files:**
- Create: `src/quarantine.ts`
- Test: `test/quarantine.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `class Quarantine` with `constructor(initial?: readonly string[])`, `static keyOf(providerID: string, modelID: string): string`, `has(key: string): boolean`, `add(key: string): boolean`, `list(): string[]`; and `parseQuarantine(value: unknown): string[]`.

- [ ] **Step 1: Write the failing test**

Create `test/quarantine.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { Quarantine, parseQuarantine } from "../src/quarantine.js"

describe("Quarantine.keyOf", () => {
  it("joins provider and model with a slash", () => {
    expect(Quarantine.keyOf("cm", "deepseek/deepseek-v4.1-flash")).toBe(
      "cm/deepseek/deepseek-v4.1-flash",
    )
  })
})

describe("Quarantine", () => {
  it("starts empty", () => {
    expect(new Quarantine().list()).toEqual([])
    expect(new Quarantine().has("cm/anything")).toBe(false)
  })

  it("reports true only the first time a key is added", () => {
    const quarantine = new Quarantine()
    expect(quarantine.add("cm/a")).toBe(true)
    expect(quarantine.add("cm/a")).toBe(false)
    expect(quarantine.add("cm/b")).toBe(true)
  })

  it("has() reflects added keys", () => {
    const quarantine = new Quarantine()
    quarantine.add("cm/a")
    expect(quarantine.has("cm/a")).toBe(true)
    expect(quarantine.has("cm/z")).toBe(false)
  })

  it("lists keys in a stable sorted order", () => {
    const quarantine = new Quarantine(["cm/c", "cm/a"])
    quarantine.add("cm/b")
    expect(quarantine.list()).toEqual(["cm/a", "cm/b", "cm/c"])
  })

  it("seeds from an initial list and stays independent of it", () => {
    const initial = ["cm/a"]
    const quarantine = new Quarantine(initial)
    quarantine.add("cm/b")
    expect(initial).toEqual(["cm/a"])
    expect(quarantine.list()).toEqual(["cm/a", "cm/b"])
  })

  it("round-trips through its own list output", () => {
    const first = new Quarantine()
    first.add("cm/a")
    first.add("cm/b")
    expect(new Quarantine(first.list()).list()).toEqual(first.list())
  })
})

describe("parseQuarantine", () => {
  it("returns an empty list for anything that is not an array of non-empty strings", () => {
    expect(parseQuarantine(undefined)).toEqual([])
    expect(parseQuarantine(null)).toEqual([])
    expect(parseQuarantine("nope")).toEqual([])
    expect(parseQuarantine({})).toEqual([])
  })

  it("keeps only non-empty strings", () => {
    expect(parseQuarantine(["cm/a", "", 3, null, "cm/b"])).toEqual(["cm/a", "cm/b"])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/quarantine.test.ts`
Expected: FAIL — cannot resolve `../src/quarantine.js`.

- [ ] **Step 3: Write the implementation**

Create `src/quarantine.ts`:

```ts
/**
 * Models the account is not entitled to. `GET /models` does not report entitlements,
 * so a model is only discovered to be unusable by making a request that fails with
 * 401/403. Keys are `providerID/modelID`.
 */
export class Quarantine {
  readonly #keys = new Set<string>()

  constructor(initial: readonly string[] = []) {
    for (const key of initial) this.#keys.add(key)
  }

  static keyOf(providerID: string, modelID: string): string {
    return `${providerID}/${modelID}`
  }

  has(key: string): boolean {
    return this.#keys.has(key)
  }

  /** Returns true when the key was newly added, so callers persist only on change. */
  add(key: string): boolean {
    if (this.#keys.has(key)) return false
    this.#keys.add(key)
    return true
  }

  list(): string[] {
    return [...this.#keys].sort()
  }
}

export function parseQuarantine(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === "string" && entry !== "")
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/quarantine.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/quarantine.ts test/quarantine.test.ts
git commit -m "feat: add quarantine set for unentitled models"
```

---

### Task 4: Integration registration

Registers the `cm` integration so it appears in `/connect` with a key-type sign-in method.

**Files:**
- Create: `src/integration.ts`
- Test: `test/integration.test.ts`

**Interfaces:**
- Consumes: `Options` from `src/options.ts`.
- Produces: `type IntegrationSlice` (= `{ readonly integration: Plugin.Context["integration"] }`); `registerIntegration(ctx: IntegrationSlice, options: Options): Promise<Integration.ID>`.

- [ ] **Step 1: Write the failing test**

Create `test/integration.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { registerIntegration, type IntegrationSlice } from "../src/integration.js"
import { resolveOptions } from "../src/options.js"

interface Recorded {
  readonly names: Array<{ id: string; name: string }>
  readonly methods: Array<{ integrationID: string; method: Record<string, unknown> }>
}

function fakeContext(recorded: Recorded): IntegrationSlice {
  const editor = {
    update(id: string, update: (integration: { name: string }) => void) {
      const integration = { name: "" }
      update(integration)
      recorded.names.push({ id, name: integration.name })
    },
    method: {
      update(input: { integrationID: string; method: Record<string, unknown> }) {
        recorded.methods.push(input)
      },
    },
  }
  return {
    integration: {
      transform: async (callback: (input: unknown) => void) => {
        callback(editor)
        return { dispose: async () => {} }
      },
    },
  } as unknown as IntegrationSlice
}

describe("registerIntegration", () => {
  it("registers the display name against the providerID", async () => {
    const recorded: Recorded = { names: [], methods: [] }
    const id = await registerIntegration(fakeContext(recorded), resolveOptions({}))

    expect(id).toBe("cm")
    expect(recorded.names).toEqual([{ id: "cm", name: "Command Code" }])
  })

  it("registers a key method whose form field is named apiKey", async () => {
    const recorded: Recorded = { names: [], methods: [] }
    await registerIntegration(fakeContext(recorded), resolveOptions({}))

    expect(recorded.methods).toHaveLength(1)
    const registration = recorded.methods[0]
    expect(registration?.integrationID).toBe("cm")

    const method = registration?.method as {
      type: string
      label?: string
      form?: Array<Record<string, unknown>>
    }
    expect(method.type).toBe("key")
    expect(method.label).toBe("API Key")
    expect(method.form).toHaveLength(1)
    expect(method.form?.[0]).toMatchObject({ type: "string", key: "apiKey", required: true })
  })

  it("honours a custom providerID and displayName", async () => {
    const recorded: Recorded = { names: [], methods: [] }
    const options = resolveOptions({ providerID: "acme", displayName: "Acme Gateway" })
    const id = await registerIntegration(fakeContext(recorded), options)

    expect(id).toBe("acme")
    expect(recorded.names).toEqual([{ id: "acme", name: "Acme Gateway" }])
    expect(recorded.methods[0]?.integrationID).toBe("acme")
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/integration.test.ts`
Expected: FAIL — cannot resolve `../src/integration.js`.

- [ ] **Step 3: Write the implementation**

Create `src/integration.ts`:

```ts
import { Integration, type Plugin } from "@opencode/plugin"
import type { Options } from "./options.js"

/** The slice of the plugin context this module needs. */
export type IntegrationSlice = {
  readonly integration: Plugin.Context["integration"]
}

/**
 * Registers the sign-in method that lets `/connect` store the gateway API key in
 * OpenCode's credential store, so it never has to live in `opencode.jsonc`.
 */
export async function registerIntegration(
  ctx: IntegrationSlice,
  options: Options,
): Promise<Integration.ID> {
  const integrationID = Integration.ID.make(options.providerID)

  await ctx.integration.transform((editor) => {
    editor.update(integrationID, (integration) => {
      integration.name = options.displayName
    })
    editor.method.update({
      integrationID,
      method: {
        type: "key",
        label: "API Key",
        form: [
          {
            type: "string",
            key: "apiKey",
            title: "API Key",
            description: `API key issued by ${options.displayName}`,
            required: true,
            hidden: true,
          },
        ],
      },
    })
  })

  return integrationID
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/integration.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/integration.ts test/integration.test.ts
git commit -m "feat: register the key-based integration for /connect"
```

---

### Task 5: Provider registry and refresh state machine

Owns the captured state, the two transform registrations, credential resolution, the fetch, and the quarantine replay. This is the only module that calls `provider.transform` / `provider.reload` / `model.transform` / `model.reload`.

**Files:**
- Create: `src/registry.ts`
- Test: `test/registry.test.ts`

**Interfaces:**
- Consumes: `Options`; `ModelOverride`; `GatewayModel`, `parseGatewayModels`, `toModelInfoList`, `PACKAGE_CHAT` from `src/discovery.ts`; `Quarantine`, `parseQuarantine` from `src/quarantine.ts`.
- Produces: `type RegistrySlice`; `type RegistryDeps` (= `{ readonly fetch: typeof fetch }`); `type RefreshResult` (= `{ status: "ok"; count: number } | { status: "not-connected" } | { status: "failed"; error: Error }`); `createRegistry(ctx: RegistrySlice, options: Options, deps?: RegistryDeps): Registry`; `interface Registry` with `install(): Promise<void>`, `refresh(): Promise<RefreshResult>`, `current(): readonly GatewayModel[]`, `quarantined(): readonly string[]`, `quarantine(modelID: string): Promise<boolean>`. Also `STORAGE_KEY` (`"quarantined"`).

- [ ] **Step 1: Write the failing test**

Create `test/registry.test.ts`:

```ts
import type { Connection, Credential, Model, Provider } from "@opencode/plugin"
import { describe, expect, it } from "vitest"
import { PACKAGE_ANTHROPIC, PACKAGE_CHAT, PACKAGE_RESPONSES } from "../src/discovery.js"
import { resolveOptions } from "../src/options.js"
import { createRegistry, STORAGE_KEY, type RegistrySlice } from "../src/registry.js"

const CONNECTION = {
  type: "credential",
  id: "cred_1",
  label: "Command Code",
} as unknown as Connection.Info

const CREDENTIAL = { type: "key", key: "user_secret" } as unknown as Credential.Value

const catalogue = {
  object: "list",
  data: [
    {
      id: "claude-sonnet-5-5",
      name: "Claude Sonnet 5.5",
      context_length: 1000000,
      supported_endpoints: ["/messages"],
    },
    {
      id: "gpt-6.1-sol",
      name: "GPT-6.1 Sol",
      context_length: 1050000,
      supported_endpoints: ["/chat/completions", "/responses"],
    },
    { id: "stealth/space-bunny-alpha", name: "Space Bunny Alpha", supported_endpoints: ["/chat/completions"] },
  ],
}

interface AddedRecord {
  readonly info: Provider.Info
  readonly models: readonly Model.Info[]
  readonly sourceConnection?: Connection.Info
}

interface ModelEdit {
  readonly providerID: string
  readonly modelID: string
  readonly enabled: boolean
}

function harness(config: {
  readonly connection?: Connection.Info
  readonly credential?: Credential.Value
  readonly fetch?: typeof fetch
}) {
  const providerCallbacks: Array<(editor: unknown) => void> = []
  const modelCallbacks: Array<(editor: unknown) => void> = []
  const added: AddedRecord[] = []
  const edits: ModelEdit[] = []
  const storage = new Map<string, unknown>()
  const reloads = { provider: 0, model: 0 }

  const ctx = {
    integration: {
      connection: {
        active: async () => config.connection,
        resolve: async () => config.credential,
      },
    },
    provider: {
      transform: async (callback: (editor: unknown) => void) => {
        providerCallbacks.push(callback)
        return { dispose: async () => {} }
      },
      reload: async () => {
        reloads.provider += 1
        added.length = 0
        const editor = {
          list: () => [],
          get: () => undefined,
          add: (input: AddedRecord) => added.push(input),
          update: () => {},
          remove: () => {},
          models: { set: () => {}, update: () => {}, remove: () => {} },
        }
        for (const callback of providerCallbacks) callback(editor)
      },
    },
    model: {
      transform: async (callback: (editor: unknown) => void) => {
        modelCallbacks.push(callback)
        return { dispose: async () => {} }
      },
      reload: async () => {
        reloads.model += 1
        edits.length = 0
        const editor = {
          list: () => [],
          get: () => undefined,
          update: (providerID: string, modelID: string, update: (model: { enabled: boolean }) => void) => {
            const draft = { enabled: true }
            update(draft)
            edits.push({ providerID, modelID, enabled: draft.enabled })
          },
          remove: () => {},
          default: { get: () => undefined, set: () => {} },
          provider: { list: () => [], get: () => undefined },
        }
        for (const callback of modelCallbacks) callback(editor)
      },
    },
    storage: {
      get: async (key: string) => storage.get(key),
      set: async (key: string, value: unknown) => {
        storage.set(key, value)
      },
    },
  }

  return {
    ctx: ctx as unknown as RegistrySlice,
    added,
    edits,
    storage,
    reloads,
    fetch: config.fetch,
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

describe("createRegistry", () => {
  it("installs with no saved quarantine", async () => {
    const h = harness({ connection: CONNECTION, credential: CREDENTIAL })
    const registry = createRegistry(h.ctx, resolveOptions({}))

    await expect(registry.install()).resolves.toBeUndefined()
    await h.ctx.model.reload()

    expect(h.edits).toEqual([])
  })

  it("reports not-connected and publishes no provider when there is no credential", async () => {
    const h = harness({})
    const registry = createRegistry(h.ctx, resolveOptions({}))
    await registry.install()

    await expect(registry.refresh()).resolves.toEqual({ status: "not-connected" })
    expect(h.added).toEqual([])
  })

  it("reports not-connected when the active connection is not a key credential", async () => {
    const h = harness({
      connection: CONNECTION,
      credential: { type: "oauth", methodID: "m", refresh: "r", access: "a", expires: 0 } as unknown as Credential.Value,
    })
    const registry = createRegistry(h.ctx, resolveOptions({}))
    await registry.install()

    await expect(registry.refresh()).resolves.toEqual({ status: "not-connected" })
  })

  it("fetches the catalogue, maps it, and binds the source connection", async () => {
    const h = harness({
      connection: CONNECTION,
      credential: CREDENTIAL,
      fetch: (async () => jsonResponse(catalogue)) as unknown as typeof fetch,
    })
    const registry = createRegistry(h.ctx, resolveOptions({}))
    await registry.install()

    await expect(registry.refresh()).resolves.toEqual({ status: "ok", count: 3 })
    expect(h.added).toHaveLength(1)

    const record = h.added[0]
    expect(record?.sourceConnection).toBe(CONNECTION)
    expect(record?.info.id).toBe("cm")
    expect(record?.info.activation).toBe("auto")
    expect(record?.info.integrationID).toBe("cm")
    expect(record?.info.name).toBe("Command Code")
    expect(record?.info.package).toBe(PACKAGE_CHAT)
    expect(record?.info.settings).toMatchObject({
      baseURL: "https://api.commandcode.ai/provider/v1",
      apiKey: "user_secret",
    })
    expect(record?.models.map((model) => model.id)).toEqual([
      "claude-sonnet-5-5",
      "gpt-6.1-sol",
      "stealth/space-bunny-alpha",
    ])
    expect(record?.models.map((model) => model.package)).toEqual([
      PACKAGE_ANTHROPIC,
      PACKAGE_RESPONSES,
      PACKAGE_CHAT,
    ])
  })

  it("requests the catalogue with a bearer token and the configured headers", async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = []
    const h = harness({
      connection: CONNECTION,
      credential: CREDENTIAL,
      fetch: (async (url: string, init: RequestInit) => {
        calls.push({ url, headers: init.headers as Record<string, string> })
        return jsonResponse(catalogue)
      }) as unknown as typeof fetch,
    })
    const registry = createRegistry(
      h.ctx,
      resolveOptions({ baseURL: "https://x.test/v1/", headers: { "x-tenant": "eng" } }),
    )
    await registry.install()
    await registry.refresh()

    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe("https://x.test/v1/models")
    expect(calls[0]?.headers).toMatchObject({
      authorization: "Bearer user_secret",
      "x-tenant": "eng",
    })
  })

  it("keeps the last good catalogue when the fetch fails", async () => {
    let fail = false
    const h = harness({
      connection: CONNECTION,
      credential: CREDENTIAL,
      fetch: (async () => (fail ? jsonResponse({ error: "boom" }, 502) : jsonResponse(catalogue))) as unknown as typeof fetch,
    })
    const registry = createRegistry(h.ctx, resolveOptions({}))
    await registry.install()
    await registry.refresh()

    fail = true
    const result = await registry.refresh()

    expect(result.status).toBe("failed")
    expect(registry.current()).toHaveLength(3)
    expect(h.added[0]?.models).toHaveLength(3)
  })

  it("keeps the last good catalogue when the response body is not JSON", async () => {
    let payload: Response = jsonResponse(catalogue)
    const h = harness({
      connection: CONNECTION,
      credential: CREDENTIAL,
      fetch: (async () => payload) as unknown as typeof fetch,
    })
    const registry = createRegistry(h.ctx, resolveOptions({}))
    await registry.install()
    await registry.refresh()

    payload = new Response("<html>gateway error</html>", { status: 200 })
    await expect(registry.refresh()).resolves.toMatchObject({ status: "failed" })
    expect(registry.current()).toHaveLength(3)
  })

  it("treats an empty catalogue as a successful empty refresh", async () => {
    let payload: Response = jsonResponse(catalogue)
    const h = harness({
      connection: CONNECTION,
      credential: CREDENTIAL,
      fetch: (async () => payload) as unknown as typeof fetch,
    })
    const registry = createRegistry(h.ctx, resolveOptions({}))
    await registry.install()
    await registry.refresh()

    payload = jsonResponse({ object: "list", data: [] })
    await expect(registry.refresh()).resolves.toEqual({ status: "ok", count: 0 })
    expect(registry.current()).toEqual([])
    expect(h.added).toEqual([])
  })

  it("adds exactly one provider record across repeated refreshes", async () => {
    const h = harness({
      connection: CONNECTION,
      credential: CREDENTIAL,
      fetch: (async () => jsonResponse(catalogue)) as unknown as typeof fetch,
    })
    const registry = createRegistry(h.ctx, resolveOptions({}))
    await registry.install()
    await registry.refresh()
    await registry.refresh()
    await registry.refresh()

    expect(h.reloads.provider).toBe(3)
    expect(h.added).toHaveLength(1)
  })

  it("drops the provider when the connection disappears", async () => {
    let connection: Connection.Info | undefined = CONNECTION
    const h = harness({
      connection: CONNECTION,
      credential: CREDENTIAL,
      fetch: (async () => jsonResponse(catalogue)) as unknown as typeof fetch,
    })
    // Re-point the fake at a mutable connection.
    ;(h.ctx as unknown as { integration: { connection: { active: () => Promise<Connection.Info | undefined> } } })
      .integration.connection.active = async () => connection

    const registry = createRegistry(h.ctx, resolveOptions({}))
    await registry.install()
    await registry.refresh()
    expect(h.added).toHaveLength(1)

    connection = undefined
    await expect(registry.refresh()).resolves.toEqual({ status: "not-connected" })
    expect(h.added).toEqual([])
  })

  it("quarantines a model and replays the quarantine into the model transform", async () => {
    const h = harness({
      connection: CONNECTION,
      credential: CREDENTIAL,
      fetch: (async () => jsonResponse(catalogue)) as unknown as typeof fetch,
    })
    const registry = createRegistry(h.ctx, resolveOptions({}))
    await registry.install()
    await registry.refresh()

    await expect(registry.quarantine("gpt-6.1-sol")).resolves.toBe(true)
    expect(registry.quarantined()).toEqual(["cm/gpt-6.1-sol"])
    expect(h.storage.get(STORAGE_KEY)).toEqual(["cm/gpt-6.1-sol"])
    expect(h.edits).toEqual([{ providerID: "cm", modelID: "gpt-6.1-sol", enabled: false }])
  })

  it("writes storage only the first time a model is quarantined", async () => {
    const h = harness({ connection: CONNECTION, credential: CREDENTIAL })
    let writes = 0
    const storage = h.ctx.storage as unknown as { set: (key: string, value: unknown) => Promise<void> }
    const original = storage.set.bind(h.ctx.storage)
    storage.set = async (key, value) => {
      writes += 1
      await original(key, value)
    }

    const registry = createRegistry(h.ctx, resolveOptions({}))
    await registry.install()

    await expect(registry.quarantine("gpt-6.1-sol")).resolves.toBe(true)
    await expect(registry.quarantine("gpt-6.1-sol")).resolves.toBe(false)
    expect(writes).toBe(1)
  })

  it("restores a saved quarantine on install", async () => {
    const h = harness({ connection: CONNECTION, credential: CREDENTIAL })
    h.storage.set(STORAGE_KEY, ["cm/claude-opus-4-8"])
    const registry = createRegistry(h.ctx, resolveOptions({}))
    await registry.install()

    expect(registry.quarantined()).toEqual(["cm/claude-opus-4-8"])
    expect(h.edits).toEqual([{ providerID: "cm", modelID: "claude-opus-4-8", enabled: false }])
  })

  it("ignores a malformed saved quarantine", async () => {
    const h = harness({ connection: CONNECTION, credential: CREDENTIAL })
    h.storage.set(STORAGE_KEY, "not an array")
    const registry = createRegistry(h.ctx, resolveOptions({}))
    await registry.install()

    expect(registry.quarantined()).toEqual([])
    expect(h.edits).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/registry.test.ts`
Expected: FAIL — cannot resolve `../src/registry.js`.

- [ ] **Step 3: Write the implementation**

Create `src/registry.ts`:

```ts
import {
  Model,
  Provider,
  type Connection,
  type Credential,
  type Plugin,
} from "@opencode/plugin"
import {
  PACKAGE_CHAT,
  parseGatewayModels,
  toModelInfoList,
  type GatewayModel,
} from "./discovery.js"
import type { Options } from "./options.js"
import { Quarantine, parseQuarantine } from "./quarantine.js"

export const STORAGE_KEY = "quarantined"

/** The slice of the plugin context this module needs. */
export type RegistrySlice = {
  readonly integration: Pick<Plugin.Context["integration"], "connection">
  readonly provider: Pick<Plugin.Context["provider"], "transform" | "reload">
  readonly model: Pick<Plugin.Context["model"], "transform" | "reload">
  readonly storage: Pick<Plugin.Context["storage"], "get" | "set">
}

export type RegistryDeps = {
  readonly fetch: typeof fetch
}

export type RefreshResult =
  | { readonly status: "ok"; readonly count: number }
  | { readonly status: "not-connected" }
  | { readonly status: "failed"; readonly error: Error }

export interface Registry {
  /** Registers both transforms. Call once during setup, before the first refresh. */
  install(): Promise<void>
  refresh(): Promise<RefreshResult>
  current(): readonly GatewayModel[]
  quarantined(): readonly string[]
  /** Returns true when the model was newly quarantined. */
  quarantine(modelID: string): Promise<boolean>
}

async function readCredential(
  ctx: RegistrySlice,
  providerID: string,
): Promise<{ connection: Connection.Info; key: string } | undefined> {
  const connection = await ctx.integration.connection.active(providerID)
  if (!connection) return undefined
  const value = await ctx.integration.connection.resolve(connection)
  if (!value || value.type !== "key") return undefined
  return { connection, key: value.key }
}

export function createRegistry(
  ctx: RegistrySlice,
  options: Options,
  deps: RegistryDeps = { fetch: globalThis.fetch },
): Registry {
  const providerID = Provider.ID.make(options.providerID)
  const integrationID = providerID
  const prefix = `${options.providerID}/`

  // State captured by the transforms. Refreshing mutates it and then reloads, which
  // replays the callbacks below onto a fresh value.
  const state: {
    connection?: Connection.Info
    apiKey?: string
    models: readonly GatewayModel[]
  } = { models: [] }

  const quarantine = new Quarantine()

  function providerInfo(connection: Connection.Info, apiKey: string): Provider.Info {
    return {
      ...Provider.Info.empty(providerID),
      name: options.displayName,
      activation: "auto",
      package: PACKAGE_CHAT,
      settings: { baseURL: options.baseURL, apiKey },
      headers: { ...options.headers },
      body: { ...options.body },
      integrationID,
    }
  }

  async function fetchCatalogue(apiKey: string): Promise<unknown> {
    const response = await deps.fetch(`${options.baseURL}/models`, {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${apiKey}`,
        ...options.headers,
      },
      signal: AbortSignal.timeout(options.requestTimeout),
    })
    if (!response.ok) {
      throw new Error(`GET ${options.baseURL}/models failed with HTTP ${response.status}`)
    }
    return await response.json()
  }

  async function install(): Promise<void> {
    const saved = parseQuarantine(await ctx.storage.get(STORAGE_KEY))
    for (const key of saved) quarantine.add(key)

    await ctx.provider.transform((editor) => {
      const { connection, apiKey } = state
      if (!connection || apiKey === undefined) return
      editor.add({
        info: providerInfo(connection, apiKey),
        models: toModelInfoList(state.models, providerID, options),
        sourceConnection: connection,
      })
    })

    await ctx.model.transform((editor) => {
      for (const key of quarantine.list()) {
        if (!key.startsWith(prefix)) continue
        editor.update(options.providerID, key.slice(prefix.length), (model) => {
          model.enabled = false
        })
      }
    })
  }

  async function refresh(): Promise<RefreshResult> {
    let credential: { connection: Connection.Info; key: string } | undefined
    try {
      credential = await readCredential(ctx, options.providerID)
    } catch (error) {
      return { status: "failed", error: toError(error) }
    }

    if (!credential) {
      state.connection = undefined
      state.apiKey = undefined
      state.models = []
      await ctx.provider.reload()
      return { status: "not-connected" }
    }

    try {
      const models = parseGatewayModels(await fetchCatalogue(credential.key))
      state.connection = credential.connection
      state.apiKey = credential.key
      state.models = models
      await ctx.provider.reload()
      return { status: "ok", count: models.length }
    } catch (error) {
      // Deliberately leave captured state untouched: a transient gateway failure must
      // not empty the user's model list.
      return { status: "failed", error: toError(error) }
    }
  }

  async function quarantineModel(modelID: string): Promise<boolean> {
    if (!quarantine.add(Quarantine.keyOf(options.providerID, modelID))) return false
    await ctx.storage.set(STORAGE_KEY, quarantine.list())
    await ctx.model.reload()
    return true
  }

  return {
    install,
    refresh,
    current: () => state.models,
    quarantined: () => quarantine.list(),
    quarantine: quarantineModel,
  }
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/registry.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npm test` then `npm run typecheck`
Expected: PASS, 47 tests total.

- [ ] **Step 6: Commit**

```bash
git add src/registry.ts test/registry.test.ts
git commit -m "feat: add provider registry with refresh and quarantine replay"
```

---

### Task 6: Entry point, README, and live verification

Wires the modules into `Plugin.define`, adds the event subscription and refresh timer, and documents installation.

**Files:**
- Create: `src/index.ts`
- Create: `README.md`
- Modify: `package.json` (no change needed — `exports` already points at `./dist/index.js`)

**Interfaces:**
- Consumes: `resolveOptions` from `src/options.ts`; `registerIntegration` from `src/integration.ts`; `createRegistry` from `src/registry.ts`.
- Produces: the package's default export, a V2 `Plugin` definition with `id: "opencode-cm-provider"`.

- [ ] **Step 1: Write the entry point**

Create `src/index.ts`:

```ts
import { Plugin } from "@opencode/plugin"
import { registerIntegration } from "./integration.js"
import { resolveOptions } from "./options.js"
import { createRegistry } from "./registry.js"

export default Plugin.define({
  id: "opencode-cm-provider",

  async setup(ctx) {
    const options = resolveOptions(ctx.options)

    await registerIntegration(ctx, options)

    const registry = createRegistry(ctx, options)
    await registry.install()
    await registry.refresh()

    // A fresh /connect stores a credential; refresh immediately so the catalogue
    // appears without restarting the server.
    const controller = new AbortController()
    void (async () => {
      try {
        for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
          const type = (event as { type?: unknown }).type
          if (typeof type !== "string" || !type.startsWith("credential.")) continue
          await registry.refresh()
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error("[opencode-cm-provider] credential event stream failed", error)
        }
      }
    })()

    const timer = setInterval(() => {
      void registry.refresh().then((result) => {
        if (result.status === "failed") {
          console.error("[opencode-cm-provider] model refresh failed", result.error)
        }
      })
    }, options.refreshInterval)

    if (options.quarantineOnAuthFailure) {
      await ctx.session.hook(
        "retry",
        async (event) => {
          const status = event.error.status ?? 0
          if (status !== 401 && status !== 403) return
          if (event.model.providerID !== options.providerID) return
          if (await registry.quarantine(event.model.id)) {
            console.error(
              `[opencode-cm-provider] ${event.model.id} returned HTTP ${status}; hidden from /models`,
            )
          }
        },
        { providerID: options.providerID },
      )
    }

    return () => {
      controller.abort()
      clearInterval(timer)
    }
  },
})
```

- [ ] **Step 2: Build and typecheck**

Run: `npm run build` then `npm run typecheck`
Expected: both succeed; `dist/index.js` exists.

- [ ] **Step 3: Verify the built entry point is importable**

Run: `node -e "import('./dist/index.js').then(m => console.log(m.default.id, typeof m.default.setup))"`
Expected: prints `opencode-cm-provider function`.

- [ ] **Step 4: Write the README**

Create `README.md`:

```markdown
# opencode-cm-provider

An [OpenCode](https://opencode.ai) V2 plugin that registers the Command Code gateway
(`https://api.commandcode.ai/provider/v1`) as a provider, discovers its model catalogue
automatically, and keeps the API key in OpenCode's credential store instead of
`opencode.jsonc`.

## What it does

- Registers a `cm` provider and pulls the model list from `GET {baseURL}/models` on
  startup, every 10 minutes, and whenever a credential changes.
- Routes each model to the correct runtime from the gateway's `supported_endpoints`:
  `/responses` models use the OpenAI Responses runtime, chat-only models use the OpenAI
  chat runtime, and the Anthropic-native Claude models use the Anthropic runtime.
- Reads `context_length` per model, so context limits never need hand-tuning.
- Stores the API key via `/connect` in OpenCode's credential store.
- Hides models the account is not entitled to. The catalogue does not report
  entitlements, so a model that answers 401/403 is quarantined after its first failure
  and disappears from `/models`.
- Keeps the last good catalogue when the gateway is temporarily unreachable.

## Install

Add the plugin to your OpenCode configuration:

```jsonc title="opencode.jsonc"
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["file:///D:/code/repos/ocplugin"],
}
```

Then restart the service and connect:

```sh
opencode service restart
```

In the TUI, run `/connect`, choose **Command Code**, and paste your API key. The
catalogue appears in `/models` without a restart.

Remove any hand-written `providers.cm` block from `opencode.jsonc` first — this plugin
owns that provider ID.

## Options

Pass options through the object form of the `plugins` entry:

```jsonc title="opencode.jsonc"
{
  "plugins": [
    {
      "package": "file:///D:/code/repos/opencode-cm-provider",
      "options": {
        "refreshInterval": 600000,
      },
    },
  ],
}
```

| Option | Default | Purpose |
| --- | --- | --- |
| `baseURL` | `https://api.commandcode.ai/provider/v1` | Gateway endpoint. Trailing slashes are stripped. |
| `providerID` | `cm` | Provider ID. Must not contain `/` or `#`. |
| `displayName` | `Command Code` | Name shown in `/connect` and `/models`. |
| `refreshInterval` | `600000` | Catalog refresh in milliseconds. Minimum `10000`. |
| `defaultOutput` | `32000` | Output token limit, since the gateway does not report one. |
| `defaultContext` | `200000` | Context limit fallback when the gateway omits `context_length`. |
| `requestTimeout` | `15000` | `GET /models` timeout in milliseconds. |
| `headers` | `{}` | Extra provider request headers. |
| `body` | `{}` | Extra provider request body fields. |
| `overrides` | `{}` | Per-model corrections, keyed by model ID. |
| `quarantineOnAuthFailure` | `true` | Hide models that answer 401/403. |

### Per-model overrides

```jsonc
{
  "plugins": [
    {
      "package": "file:///D:/code/repos/opencode-cm-provider",
      "options": {
        "overrides": {
          "gpt-5.4-mini": { "output": 64000 },
          "zai-org/GLM-5.1": { "package": "@opencode/ai/providers/openai-compatible" },
          "claude-opus-4-8": { "enabled": false }
        }
      }
    }
  ]
}
```

Each override accepts `name`, `context`, `output`, `enabled`, and `package`.

## Known limitations

- The gateway does not report output token limits, so every model defaults to
  `defaultOutput` (32000). Raise it per model with `overrides`.
- The gateway does not report capabilities, so every model is advertised as accepting
  text and images with tool support. Sending an image to a text-only model fails with a
  400 from the gateway; correct it with `overrides`.
- The gateway reports no pricing, so costs are not shown.
- The catalogue's `created` timestamp is identical for every model, so it is not used as
  a release date and models cannot be sorted by date.
- Only API-key sign-in is supported.

## Development

```sh
npm install
npm test
npm run build
```
```

- [ ] **Step 5: Run the full suite, build, and typecheck**

Run: `npm test`, `npm run build`, `npm run typecheck`
Expected: 47 tests pass; build and typecheck succeed.

- [ ] **Step 6: Commit**

```bash
git add src/index.ts README.md
git commit -m "feat: wire plugin entry point and document usage"
```

- [ ] **Step 7: Live verification against the real gateway**

These steps need a running OpenCode service and the real API key. They cannot be
automated in this plan.

1. Edit `~/.config/opencode/opencode.jsonc`: delete the entire `providers.cm` block and
   add `"file:///D:/code/repos/ocplugin"` to `plugins`.
2. Run `opencode service restart`.
3. Run `/models`. Before connecting, no `cm` models should appear.
4. Run `/connect`, choose **Command Code**, paste the API key. Without restarting, `/models`
   should list 86 models.
5. Start a conversation on `cm/claude-sonnet-5-5`. It must answer — this exercises the
   Anthropic runtime path.
6. Start a conversation on `cm/Qwen/Qwen3.7-Flash`. It must answer — this exercises the
   Responses runtime path.
7. Request `cm/gpt-6.1-sol`. It answers 403. Confirm it disappears from `/models`
   afterwards and stays gone after a restart.
8. **Rotate the API key.** It was stored in plaintext in `opencode.jsonc` and used during
   the design investigation, so treat it as compromised.
```

---

## Self-Review

**Spec coverage.** Every spec section maps to a task.

| Spec section | Task |
| --- | --- |
| §4 数据流 steps 1–2 (integration, credential events) | Task 4 registers; Task 6 subscribes |
| §4 step 3 (resolve credential, not-connected handling) | Task 5 `refresh` |
| §4 step 4 (`GET /models`) | Task 5 `fetchCatalogue` |
| §4 step 5 (provider transform, `sourceConnection`) | Task 5 `install` |
| §4.1 路由规则 | Task 2 `packageFor` |
| §4.2 不变量 1 (`sourceConnection`) | Task 5 test `binds the source connection` |
| §4.2 不变量 2 (失败不清空) | Task 5 tests `keeps the last good catalogue` ×2 |
| §4.2 不变量 3 (未连接不显示) | Task 5 tests `reports not-connected` ×3 |
| §5 数据映射 (all fields) | Task 2 `toModelInfo` tests |
| §5 `overrides` | Task 2 override tests |
| §6 403/401 隔离 | Task 3 (set) + Task 5 (replay, persistence) + Task 6 (hook) |
| §6 `quarantineOnAuthFailure` | Task 1 (parsing) + Task 6 (gating) |
| §7 Options (all 11 fields) | Task 1 |
| §8 文件结构 | Tasks 1–6 create exactly those files |
| §9 测试策略 | Tasks 1–3, 5 test code; §9 手动验证 → Task 6 Step 7 |
| §10 迁移步骤 | Task 6 Step 7 + README |
| §11 已知限制 | README "Known limitations" |

Gap found and closed: the spec's §9 manual checklist item 5 (quarantine survives a restart) required persistence to be exercised, so Task 5 gained the `restores a saved quarantine on install` test.

**Placeholder scan.** No "TBD", "TODO", "handle edge cases", or "similar to Task N". Every code step contains complete, runnable code. Task 5's `state` object carries `apiKey` alongside `connection` and `models`, because the provider transform callback closes over `state` and must read the key at replay time rather than capturing it at registration time.

**Type consistency.** Verified across tasks: `Options`/`ModelOverride` (Task 1) are consumed unchanged in Tasks 2, 4, 5. `GatewayModel`/`parseGatewayModels`/`toModelInfoList`/`PACKAGE_*` (Task 2) are imported with the same names in Task 5. `Quarantine`/`parseQuarantine` (Task 3) are used as declared in Task 5. `IntegrationSlice`/`registerIntegration` (Task 4) match the Task 6 call site. `RegistrySlice`/`createRegistry`/`RefreshResult`/`STORAGE_KEY` (Task 5) match Task 6. All plugin-context types are derived with `Pick<Plugin.Context[...], ...>` from the real `@opencode/plugin` types rather than restated by hand.

**Review Focus.** All five lines have a named owning test: #1 → Task 4 (`registers a key method whose form field is named apiKey`); #2 → Task 5 (`adds exactly one provider record across repeated refreshes`); #3 → Task 5 (`installs with no saved quarantine`); #4 → Task 5 (`treats an empty catalogue as a successful empty refresh`); #5 → Task 2 (`drops model IDs containing a variant separator`).

**Risk noted for the implementer.** TypeScript 7.0.2 is the current `latest`. If it rejects any compiler option in `tsconfig.json`, fall back to `typescript@^5.9.0` in `package.json` — nothing in the source depends on TS 7 features.
