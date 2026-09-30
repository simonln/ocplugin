import { Integration, Provider, type Plugin } from "@opencode/plugin"
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

/**
 * `connection.active` returns the client's `ConnectionInfo`, not the schema's branded
 * `Connection.Info`. Derive it from the slice rather than importing the client package,
 * which is only a transitive dependency.
 */
type ActiveConnection = NonNullable<
  Awaited<ReturnType<RegistrySlice["integration"]["connection"]["active"]>>
>

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
): Promise<{ connection: ActiveConnection; key: string } | undefined> {
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
  const integrationID = Integration.ID.make(options.providerID)
  const prefix = `${options.providerID}/`

  // State captured by the transforms. Refreshing mutates it and then reloads, which
  // replays the callbacks below onto a fresh value.
  const state: {
    connection?: ActiveConnection
    apiKey?: string
    models: readonly GatewayModel[]
  } = { models: [] }

  const quarantine = new Quarantine()

  function providerInfo(connection: ActiveConnection, apiKey: string): Provider.Info {
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
      // An empty catalogue is a successful refresh that clears the list: publish no
      // provider rather than one with zero models.
      if (state.models.length === 0) return
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

    // A restored quarantine must take effect at setup, not at the next unrelated reload.
    await ctx.model.reload()
  }

  async function refresh(): Promise<RefreshResult> {
    let credential: { connection: ActiveConnection; key: string } | undefined
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
