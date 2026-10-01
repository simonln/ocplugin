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
  providerID: "CommandCode",
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

function positiveInt(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback
  const floored = Math.floor(value)
  return floored >= 1 ? floored : fallback
}

/**
 * A positive value below the floor clamps up to it, because the floor exists to
 * protect the gateway rather than to reject a user who asked for something faster.
 * A non-positive or non-finite value is nonsense and takes the default.
 */
function clampedInterval(value: unknown, fallback: number, floor: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback
  if (value <= 0) return fallback
  const floored = Math.floor(value)
  return Math.max(floored, floor)
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

  const strippedBaseURL = nonEmptyString(input.baseURL, DEFAULTS.baseURL).replace(/\/+$/, "")

  return {
    baseURL: strippedBaseURL || DEFAULTS.baseURL,
    providerID,
    displayName: nonEmptyString(input.displayName, DEFAULTS.displayName),
    refreshInterval: clampedInterval(
      input.refreshInterval,
      DEFAULTS.refreshInterval,
      MIN_REFRESH_INTERVAL,
    ),
    defaultOutput: positiveInt(input.defaultOutput, DEFAULTS.defaultOutput),
    defaultContext: positiveInt(input.defaultContext, DEFAULTS.defaultContext),
    requestTimeout: clampedInterval(input.requestTimeout, DEFAULTS.requestTimeout, 1_000),
    headers: stringRecord(input.headers),
    body: plainRecord(input.body) ?? {},
    overrides: parseOverrides(input.overrides),
    quarantineOnAuthFailure:
      typeof input.quarantineOnAuthFailure === "boolean"
        ? input.quarantineOnAuthFailure
        : DEFAULTS.quarantineOnAuthFailure,
  }
}
