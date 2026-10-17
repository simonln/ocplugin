import { Model, type Provider } from "@opencode/plugin"
import type { ModelFacts } from "./modelsdev.js"
import type { ModelOverride, Options } from "./options.js"

/**
 * The SDK models `Model.Info` fields as readonly, but registration-time edits are the
 * intended usage, so a shallow mutable view is all that is needed. A recursive variant
 * (like the SDK's `DeepMutable`) would corrupt its branded string fields.
 */
type Mutable<T> = { -readonly [K in keyof T]: T[K] }

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

type ModelVariant = Model.Info["variants"][number]

// @opencode/ai reads this newer compatibility flag at runtime, while the
// installed SDK type may not expose it yet. CC's Anthropic-compatible endpoint
// accepts top-level thinking settings but rejects mid-conversation system turns.
type CompatibilityWithEffortUpdates = NonNullable<Model.Info["compatibility"]> & {
  supportsEffortUpdates?: boolean
}

function variant(id: string, settings: Record<string, unknown>): ModelVariant {
  return { id: id as ModelVariant["id"], settings }
}

function reasoningVariants(raw: GatewayModel, facts: ModelFacts | undefined): readonly ModelVariant[] {
  if (facts?.reasoning !== true) return []

  const options = facts.reasoningOptions ?? []
  const messages = raw.supported_endpoints?.includes("/messages") === true
  const variants: ModelVariant[] = []
  for (const option of options) {
    if (option.type === "toggle") {
      variants.push(
        messages
          ? variant("none", { thinking: { type: "disabled" } })
          : variant("none", { reasoningEffort: "none" }),
        messages
          ? variant("thinking", { thinking: { type: "adaptive" } })
          : variant("thinking", { reasoningEffort: "high" }),
      )
      continue
    }
    if (option.type === "effort") {
      const values = option.values ?? ["low", "medium", "high"]
      for (const value of values) {
        variants.push(
          variant(
            value,
            messages
              ? { thinking: { type: "adaptive", effort: value } }
              : { reasoningEffort: value },
          ),
        )
      }
      continue
    }
    if (!messages) continue
    const maximum = Math.max(1, Math.min(option.max ?? 16_000, 32_000))
    const minimum = Math.max(1, Math.min(option.min ?? 1_024, maximum))
    variants.push(
      variant(
        "high",
        messages
          ? { thinking: { type: "enabled", budgetTokens: Math.max(minimum, Math.floor(maximum / 2)) } }
          : {},
      ),
      variant(
        "max",
        messages
          ? { thinking: { type: "enabled", budgetTokens: maximum } }
          : {},
      ),
    )
  }

  return variants.filter((entry, index) => variants.findIndex((other) => other.id === entry.id) === index)
}

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
      ...(typeof record.context_length === "number" &&
      Number.isFinite(record.context_length) &&
      record.context_length > 0
          ? { context_length: Math.floor(record.context_length) }
          : {}),
      ...(endpoints ? { supported_endpoints: endpoints } : {}),
    })
  }
  return models
}

function applyOverride(info: Mutable<Model.Info>, override: ModelOverride | undefined): void {
  if (!override) return
  if (override.name !== undefined) info.name = override.name
  if (override.package !== undefined) info.package = override.package
  if (override.enabled !== undefined) info.enabled = override.enabled
  if (override.context !== undefined) info.limit = { ...info.limit, context: override.context }
  if (override.output !== undefined) info.limit = { ...info.limit, output: override.output }
}

/** The models.dev facts for one gateway model, or absent when it is not listed there. */
export type FactsLookup = ReadonlyMap<string, ModelFacts>

export function toModelInfo(
  raw: GatewayModel,
  providerID: Provider.ID,
  options: RangeOptions,
  facts?: ModelFacts,
): Model.Info {
  const info: Mutable<Model.Info> = Model.Info.default(providerID, Model.ID.make(raw.id))
  info.name = raw.name ?? raw.id
  info.package = packageFor(raw.supported_endpoints)

  // The gateway serves the context this model actually accepts, so it outranks models.dev,
  // which advertises the vendor's own ceiling. models.dev only fills a gap the gateway left.
  const context =
    raw.context_length !== undefined && raw.context_length > 0
      ? raw.context_length
      : (facts?.context ?? options.defaultContext)

  info.limit = { context, output: facts?.output ?? options.defaultOutput }

  info.variants = [...reasoningVariants(raw, facts)]

  if (raw.supported_endpoints?.includes("/messages") === true) {
    const compatibility = (info.compatibility ?? {}) as CompatibilityWithEffortUpdates
    info.compatibility = {
      ...compatibility,
      supportsEffortUpdates: false,
    } as Model.Info["compatibility"]
  }

  // The gateway reports no capabilities, so models.dev is the only real source. Falling
  // back to the optimistic default keeps an unlisted model usable at the cost of a 400.
  info.capabilities = {
    tools: facts?.tools ?? info.capabilities.tools,
    input: facts?.input ? [...facts.input] : info.capabilities.input,
    output: facts?.outputModalities ? [...facts.outputModalities] : info.capabilities.output,
  }

  applyOverride(info, options.overrides[raw.id])
  return info
}

export function toModelInfoList(
  models: readonly GatewayModel[],
  providerID: Provider.ID,
  options: RangeOptions,
  facts?: FactsLookup,
): Model.Info[] {
  return models.map((model) => toModelInfo(model, providerID, options, facts?.get(model.id)))
}
