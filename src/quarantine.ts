/**
 * Models the account is not entitled to. `GET /models` does not report entitlements,
 * so a model is only discovered to be unusable by making a request that fails with
 * 403. Keys are `providerID/modelID`.
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

  replace(keys: readonly string[]): void {
    this.#keys.clear()
    for (const key of keys) this.#keys.add(key)
  }

  list(): string[] {
    return [...this.#keys].sort()
  }
}

export interface StoredQuarantine {
  readonly credential: string
  readonly keys: readonly string[]
}

export function parseQuarantine(value: unknown): StoredQuarantine | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (typeof record.credential !== "string" || !Array.isArray(record.keys)) return undefined
  return {
    credential: record.credential,
    keys: record.keys.filter(
      (entry): entry is string => typeof entry === "string" && entry !== "",
    ),
  }
}

export function isQuarantineStatus(status: number): boolean {
  return status === 403
}
