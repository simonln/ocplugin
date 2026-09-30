import { Model, type Provider } from "@opencode/plugin"
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

export function toModelInfo(
  raw: GatewayModel,
  providerID: Provider.ID,
  options: RangeOptions,
): Model.Info {
  const info: Mutable<Model.Info> = Model.Info.default(providerID, Model.ID.make(raw.id))
  info.name = raw.name ?? raw.id
  info.package = packageFor(raw.supported_endpoints)
  info.limit = {
    context:
      raw.context_length !== undefined && raw.context_length > 0
        ? raw.context_length
        : options.defaultContext,
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
