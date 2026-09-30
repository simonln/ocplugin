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
    deps: { fetch: config.fetch ?? globalThis.fetch },
    added,
    edits,
    storage,
    reloads,
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
    const registry = createRegistry(h.ctx, resolveOptions({}), h.deps)

    await expect(registry.install()).resolves.toBeUndefined()
    await h.ctx.model.reload()

    expect(h.edits).toEqual([])
  })

  it("reports not-connected and publishes no provider when there is no credential", async () => {
    const h = harness({})
    const registry = createRegistry(h.ctx, resolveOptions({}), h.deps)
    await registry.install()

    await expect(registry.refresh()).resolves.toEqual({ status: "not-connected" })
    expect(h.added).toEqual([])
  })

  it("reports not-connected when the active connection is not a key credential", async () => {
    const h = harness({
      connection: CONNECTION,
      credential: { type: "oauth", methodID: "m", refresh: "r", access: "a", expires: 0 } as unknown as Credential.Value,
    })
    const registry = createRegistry(h.ctx, resolveOptions({}), h.deps)
    await registry.install()

    await expect(registry.refresh()).resolves.toEqual({ status: "not-connected" })
  })

  it("fetches the catalogue, maps it, and binds the source connection", async () => {
    const h = harness({
      connection: CONNECTION,
      credential: CREDENTIAL,
      fetch: (async () => jsonResponse(catalogue)) as unknown as typeof fetch,
    })
    const registry = createRegistry(h.ctx, resolveOptions({}), h.deps)
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
      h.deps,
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
    const registry = createRegistry(h.ctx, resolveOptions({}), h.deps)
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
    const registry = createRegistry(h.ctx, resolveOptions({}), h.deps)
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
    const registry = createRegistry(h.ctx, resolveOptions({}), h.deps)
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
    const registry = createRegistry(h.ctx, resolveOptions({}), h.deps)
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

    const registry = createRegistry(h.ctx, resolveOptions({}), h.deps)
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
    const registry = createRegistry(h.ctx, resolveOptions({}), h.deps)
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

    const registry = createRegistry(h.ctx, resolveOptions({}), h.deps)
    await registry.install()

    await expect(registry.quarantine("gpt-6.1-sol")).resolves.toBe(true)
    await expect(registry.quarantine("gpt-6.1-sol")).resolves.toBe(false)
    expect(writes).toBe(1)
  })

  it("restores a saved quarantine on install", async () => {
    const h = harness({ connection: CONNECTION, credential: CREDENTIAL })
    h.storage.set(STORAGE_KEY, ["cm/claude-opus-4-8"])
    const registry = createRegistry(h.ctx, resolveOptions({}), h.deps)
    await registry.install()

    expect(registry.quarantined()).toEqual(["cm/claude-opus-4-8"])
    expect(h.edits).toEqual([{ providerID: "cm", modelID: "claude-opus-4-8", enabled: false }])
  })

  it("ignores a malformed saved quarantine", async () => {
    const h = harness({ connection: CONNECTION, credential: CREDENTIAL })
    h.storage.set(STORAGE_KEY, "not an array")
    const registry = createRegistry(h.ctx, resolveOptions({}), h.deps)
    await registry.install()

    expect(registry.quarantined()).toEqual([])
    expect(h.edits).toEqual([])
  })
})
