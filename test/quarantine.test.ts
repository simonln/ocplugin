import { describe, expect, it } from "vitest"
import { isQuarantineStatus, Quarantine, parseQuarantine } from "../src/quarantine.js"

describe("isQuarantineStatus", () => {
  it("accepts only HTTP 403", () => {
    expect(isQuarantineStatus(403)).toBe(true)
    for (const status of [401, 400, 500, 0, 404]) expect(isQuarantineStatus(status)).toBe(false)
  })
})

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
  it("returns undefined for unrecognised persisted values", () => {
    expect(parseQuarantine(undefined)).toBeUndefined()
    expect(parseQuarantine(null)).toBeUndefined()
    expect(parseQuarantine("nope")).toBeUndefined()
    expect(parseQuarantine({})).toBeUndefined()
    expect(parseQuarantine(["cm/legacy"])).toBeUndefined()
  })

  it("parses a credential identity and keeps only non-empty string keys", () => {
    expect(parseQuarantine({ credential: "credential:1", keys: ["cm/a", "", 3, null, "cm/b"] }))
      .toEqual({ credential: "credential:1", keys: ["cm/a", "cm/b"] })
  })
})
