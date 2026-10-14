import type { GatewayModel } from "./discovery.js"

/**
 * The subset of a models.dev entry this plugin uses. Everything else in the 5.3 MB
 * payload is dropped during {@link enrichModels} so only these fields reach storage.
 */
export interface ModelFacts {
  readonly context?: number
  readonly output?: number
  readonly input?: readonly string[]
  readonly outputModalities?: readonly string[]
  readonly tools?: boolean
}

/** Keyed by gateway model ID, so a cached index maps straight onto a catalogue. */
export type FactsIndex = ReadonlyMap<string, ModelFacts>

/**
 * Gateway IDs carry an org prefix (`deepseek/deepseek-v4.1-flash`) that models.dev uses
 * as a provider key. Consulting the org first keeps two providers that both list a
 * `deepseek-v4-pro` from being confused for one another.
 */
export const ORG_PROVIDERS: Readonly<Record<string, string>> = {
  claude: "anthropic",
  anthropic: "anthropic",
  openai: "openai",
  gpt: "openai",
  google: "google",
  gemini: "google",
  xai: "xai",
  grok: "xai",
  deepseek: "deepseek",
  qwen: "alibaba",
  "zai-org": "zai",
  "z-ai": "zai",
  glm: "zai",
  moonshotai: "moonshotai",
  kimi: "moonshotai",
  minimaxai: "minimax",
  xiaomi: "xiaomi",
  mimo: "xiaomi",
  meta: "meta-llama",
  stepfun: "stepfun",
  tencent: "tencent",
  meituan: "meituan",
  sakana: "sakana",
  nvidia: "nvidia",
  inclusionai: "inclusionai",
  poolside: "poolside",
  thinkingmachines: "thinkingmachines",
  mistral: "mistral",
  openrouter: "openrouter",
}

/**
 * Lowercase and drop punctuation so `deepseek-v4.1-flash` and `DeepSeek-V4-1-Flash` are
 * one key. The `-latest` suffix models.dev appends to alias entries is dropped too.
 */
export function normalizeModelKey(id: string): string {
  return id
    .toLowerCase()
    .replace(/-latest$/, "")
    .replace(/[^a-z0-9]+/g, "")
}

function plainRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

/** A positive finite number, floored. models.dev writes `0` for "unknown", which reads as absent. */
function positiveInt(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined
  return Math.floor(value)
}

function stringArray(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const out = value.filter((entry): entry is string => typeof entry === "string")
  return out.length > 0 ? out : undefined
}

function readLimit(entry: Record<string, unknown>): Pick<ModelFacts, "context" | "output"> {
  const limit = plainRecord(entry.limit)
  if (!limit) return {}
  const context = positiveInt(limit.context)
  const output = positiveInt(limit.output)
  return {
    ...(context === undefined ? {} : { context }),
    ...(output === undefined ? {} : { output }),
  }
}

/**
 * Reads a models.dev model entry, whose keys are the upstream spelling (`tool_call`,
 * nested `modalities`), into our own {@link ModelFacts} shape.
 */
function readEntry(entry: unknown): ModelFacts | undefined {
  const record = plainRecord(entry)
  if (!record) return undefined
  const modalities = plainRecord(record.modalities)
  const input = modalities ? stringArray(modalities.input) : undefined
  const output = modalities ? stringArray(modalities.output) : undefined
  const facts: ModelFacts = {
    ...readLimit(record),
    ...(input === undefined ? {} : { input }),
    ...(output === undefined ? {} : { outputModalities: output }),
    ...(typeof record.tool_call === "boolean" ? { tools: record.tool_call } : {}),
  }
  return Object.keys(facts).length > 0 ? facts : undefined
}

/**
 * Reads a {@link ModelFacts} value as written to storage. Kept separate from
 * {@link readEntry} because the two use different key spellings, and sharing one reader
 * silently dropped every cached `tools` and `outputModalities` value.
 */
function readFacts(entry: unknown): ModelFacts | undefined {
  const record = plainRecord(entry)
  if (!record) return undefined
  const context = positiveInt(record.context)
  const output = positiveInt(record.output)
  const input = stringArray(record.input)
  const outputModalities = stringArray(record.outputModalities)
  const facts: ModelFacts = {
    ...(context === undefined ? {} : { context }),
    ...(output === undefined ? {} : { output }),
    ...(input === undefined ? {} : { input }),
    ...(outputModalities === undefined ? {} : { outputModalities }),
    ...(typeof record.tools === "boolean" ? { tools: record.tools } : {}),
  }
  return Object.keys(facts).length > 0 ? facts : undefined
}

type ProviderTables = {
  /** provider ID -> normalized model ID -> facts */
  readonly byProvider: ReadonlyMap<string, ReadonlyMap<string, ModelFacts>>
  /** normalized model ID -> first provider that listed it, for the fallback path */
  readonly byKey: ReadonlyMap<string, ModelFacts>
}

/**
 * Reduces the 5.3 MB payload to two lookup tables. Building these is what makes a later
 * lookup O(1) instead of a scan over 8340 entries per model.
 */
function indexPayload(payload: unknown): ProviderTables {
  const byProvider = new Map<string, Map<string, ModelFacts>>()
  const byKey = new Map<string, ModelFacts>()

  for (const [providerID, value] of Object.entries(plainRecord(payload) ?? {})) {
    const models = plainRecord(plainRecord(value)?.models)
    if (!models) continue

    const table = new Map<string, ModelFacts>()
    for (const [modelID, entry] of Object.entries(models)) {
      const facts = readEntry(entry)
      if (!facts) continue
      const key = normalizeModelKey(modelID)
      // First provider wins the fallback slot, so the index is stable across payloads.
      if (!byKey.has(key)) byKey.set(key, facts)
      if (!table.has(key)) table.set(key, facts)
    }
    byProvider.set(providerID, table)
  }

  return { byProvider, byKey }
}

function lookup(tables: ProviderTables, gatewayID: string): ModelFacts | undefined {
  const separator = gatewayID.indexOf("/")
  const org = separator === -1 ? gatewayID.split("-")[0] ?? "" : gatewayID.slice(0, separator)
  const bare = separator === -1 ? gatewayID : gatewayID.slice(separator + 1)

  const provider = ORG_PROVIDERS[org.toLowerCase()]
  const scoped = provider ? tables.byProvider.get(provider)?.get(normalizeModelKey(bare)) : undefined
  return scoped ?? tables.byKey.get(normalizeModelKey(bare))
}

/**
 * Reduces the payload to facts for exactly the models the gateway listed. Unmatched
 * models are simply absent, so callers fall back to their own defaults.
 */
export function enrichModels(models: readonly GatewayModel[], payload: unknown): FactsIndex {
  const tables = indexPayload(payload)
  const index = new Map<string, ModelFacts>()
  for (const model of models) {
    const facts = lookup(tables, model.id)
    if (facts) index.set(model.id, facts)
  }
  return index
}

/** What a stored cache holds: facts plus the catalogue they were derived from. */
export interface FactsCache {
  readonly facts: FactsIndex
  /** Gateway model IDs present in the catalogue that produced `facts`. */
  readonly covered: ReadonlySet<string>
}

const EMPTY_CACHE: FactsCache = { facts: new Map(), covered: new Set() }

/**
 * Rebuilds a cache from `ctx.storage`. Storage holds untrusted JSON that outlived a
 * previous process, so every field is re-validated and a bad entry is dropped whole
 * rather than partially trusted.
 */
export function parseFactsCache(value: unknown): FactsCache {
  const record = plainRecord(value)
  const factsRecord = plainRecord(record?.facts)
  if (!factsRecord) return EMPTY_CACHE

  const facts = new Map<string, ModelFacts>()
  for (const [modelID, entry] of Object.entries(factsRecord)) {
    const entryFacts = readFacts(entry)
    if (entryFacts) facts.set(modelID, entryFacts)
  }

  const covered = new Set<string>()
  for (const modelID of Array.isArray(record?.covered) ? record.covered : []) {
    if (typeof modelID === "string") covered.add(modelID)
  }

  return { facts, covered }
}

/** Serializes a cache into the shape {@link parseFactsCache} reads back. */
export function serializeFactsCache(
  covered: readonly string[],
  facts: FactsIndex,
): { covered: string[]; facts: Record<string, ModelFacts> } {
  return { covered: [...covered], facts: Object.fromEntries(facts) }
}