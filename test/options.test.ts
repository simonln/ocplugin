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
    expect(resolveOptions({ refreshInterval: 0.5 }).refreshInterval).toBe(MIN_REFRESH_INTERVAL)
    expect(resolveOptions({ refreshInterval: 0 }).refreshInterval).toBe(DEFAULTS.refreshInterval)
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
    expect(resolveOptions({ baseURL: "/" }).baseURL).toBe(DEFAULTS.baseURL)
    expect(resolveOptions({ baseURL: "///" }).baseURL).toBe(DEFAULTS.baseURL)
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
