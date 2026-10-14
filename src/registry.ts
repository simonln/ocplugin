import { Integration, Provider, type Plugin } from "@opencode/plugin"
import type { Schema } from "effect"
import {
  PACKAGE_CHAT,
  parseGatewayModels,
  toModelInfoList,
  type FactsLookup,
  type GatewayModel,
} from "./discovery.js"
import {
  enrichModels,
  parseFactsCache,
  serializeFactsCache,
  type FactsIndex,
} from "./modelsdev.js"
import type { Options } from "./options.js"
import { Quarantine, parseQuarantine } from "./quarantine.js"

export const STORAGE_KEY = "quarantined"
export const MODELS_DEV_STORAGE_KEY = "modelsdev"

/** A 5.3 MB download needs more headroom than a catalogue request. */
const MODELS_DEV_TIMEOUT = 60_000

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
    facts: FactsIndex
  } = { models: [], facts: new Map() }

  const quarantine = new Quarantine()
  let storedQuarantine: ReturnType<typeof parseQuarantine>
  let quarantineCredential: string | undefined
  let refreshChain: Promise<void> = Promise.resolve()

  function credentialIdentity(connection: ActiveConnection): string {
    switch (connection.type) {
      case "credential":
        return `credential:${connection.id}`
      case "env":
        return `env:${connection.name}`
    }
  }

  function adoptQuarantine(connection: ActiveConnection): void {
    if (!options.quarantineOnAuthFailure) return
    const identity = credentialIdentity(connection)
    if (identity === quarantineCredential) return
    quarantineCredential = identity
    quarantine.replace(storedQuarantine?.credential === identity ? storedQuarantine.keys : [])
  }

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

  async function fetchCatalogue(): Promise<unknown> {
    const response = await deps.fetch(`${options.baseURL}/models`, {
      headers: {
        accept: "application/json",
        ...options.headers,
      },
      signal: AbortSignal.timeout(options.requestTimeout),
    })
    if (!response.ok) {
      throw new Error(`GET ${options.baseURL}/models failed with HTTP ${response.status}`)
    }
    const payload: unknown = await response.json()
    if (
      typeof payload !== "object" ||
      payload === null ||
      Array.isArray(payload) ||
      !Array.isArray((payload as { data?: unknown }).data)
    ) {
      throw new Error(`GET ${options.baseURL}/models returned a malformed catalogue`)
    }
    return payload
  }

  async function install(): Promise<void> {
    if (options.quarantineOnAuthFailure) {
      storedQuarantine = parseQuarantine(await ctx.storage.get(STORAGE_KEY))
      try {
        const credential = await readCredential(ctx, options.providerID)
        if (credential) adoptQuarantine(credential.connection)
      } catch {
        // Initial refresh reports credential-resolution failures without making setup fail.
      }
    }

    await ctx.provider.transform((editor) => {
      const { connection, apiKey } = state
      if (!connection || apiKey === undefined) return
      // An empty catalogue is a successful refresh that clears the list: publish no
      // provider rather than one with zero models.
      if (state.models.length === 0) return
      editor.add({
        info: providerInfo(connection, apiKey),
        models: toModelInfoList(state.models, providerID, options, state.facts),
        sourceConnection: connection,
      })
    })

    await ctx.model.transform((editor) => {
      if (!options.quarantineOnAuthFailure) return
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

  async function downloadFacts(models: readonly GatewayModel[]): Promise<FactsIndex> {
    const response = await deps.fetch(options.modelsDevURL, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(MODELS_DEV_TIMEOUT),
    })
    if (!response.ok) {
      throw new Error(`GET ${options.modelsDevURL} failed with HTTP ${response.status}`)
    }
    return enrichModels(models, (await response.json()) as unknown)
  }

  /**
   * Returns facts for `models`, downloading models.dev only when the cache was not built
   * from a catalogue already containing all of them. Enrichment is best-effort: a failure
   * yields an empty index so the catalogue still publishes on the configured defaults.
   */
  async function resolveFacts(models: readonly GatewayModel[]): Promise<FactsIndex> {
    if (options.modelsDevURL === "") return new Map()

    const cache = parseFactsCache(await loadFactsCache())
    // Coverage is recorded per catalogue rather than inferred from the facts present,
    // because a model models.dev does not list gets no entry yet must not force a
    // re-download on every refresh.
    const ids = models.map((model) => model.id)
    if (ids.every((id) => cache.covered.has(id))) return cache.facts

    try {
      const fetched = await downloadFacts(models)
      await saveFactsCache(ids, fetched)
      return fetched
    } catch (error) {
      console.error(
        "[opencode-cm-provider] models.dev enrichment failed, using defaults",
        toError(error),
      )
      return cache.facts
    }
  }

  async function loadFactsCache(): Promise<unknown> {
    try {
      return await ctx.storage.get(MODELS_DEV_STORAGE_KEY)
    } catch {
      // Storage is best-effort; a read failure just means a re-download.
      return undefined
    }
  }

  async function saveFactsCache(covered: readonly string[], facts: FactsIndex): Promise<void> {
    try {
      // `ModelFacts` is readonly and holds readonly arrays, neither of which satisfies the
      // storage schema's mutable `Json` shape, so the value is widened on the way out.
      await ctx.storage.set(
        MODELS_DEV_STORAGE_KEY,
        serializeFactsCache(covered, facts) as unknown as Schema.Json,
      )
    } catch (error) {
      console.error("[opencode-cm-provider] could not cache models.dev facts", toError(error))
    }
  }

  async function runRefresh(): Promise<RefreshResult> {
    const previous = { ...state }
    try {
      const credential = await readCredential(ctx, options.providerID)

      if (!credential) {
        state.connection = undefined
        state.apiKey = undefined
        state.models = []
        state.facts = new Map()
        quarantineCredential = undefined
        quarantine.replace([])
        await ctx.provider.reload()
        return { status: "not-connected" }
      }

      adoptQuarantine(credential.connection)
      const models = parseGatewayModels(await fetchCatalogue())
      const facts = await resolveFacts(models)
      state.connection = credential.connection
      state.apiKey = credential.key
      state.models = models
      state.facts = facts
      await ctx.provider.reload()
      return { status: "ok", count: models.length }
    } catch (error) {
      state.connection = previous.connection
      state.apiKey = previous.apiKey
      state.models = previous.models
      state.facts = previous.facts
      return { status: "failed", error: toError(error) }
    }
  }

  function refresh(): Promise<RefreshResult> {
    const result = refreshChain.then(runRefresh, runRefresh)
    refreshChain = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  async function quarantineModel(modelID: string): Promise<boolean> {
    if (!options.quarantineOnAuthFailure || !quarantineCredential) return false
    if (!quarantine.add(Quarantine.keyOf(options.providerID, modelID))) return false
    storedQuarantine = { credential: quarantineCredential, keys: quarantine.list() }
    await ctx.storage.set(STORAGE_KEY, {
      credential: storedQuarantine.credential,
      keys: [...storedQuarantine.keys],
    })
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
