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
    expect(Quarantine.keyOf("CommandCode", "deepseek/deepseek-v4.1-flash")).toBe(
      "CommandCode/deepseek/deepseek-v4.1-flash",
    )
  })
})

describe("Quarantine", () => {
  it("starts empty", () => {
    expect(new Quarantine().list()).toEqual([])
    expect(new Quarantine().has("CommandCode/anything")).toBe(false)
  })

  it("reports true only the first time a key is added", () => {
    const quarantine = new Quarantine()
    expect(quarantine.add("CommandCode/a")).toBe(true)
    expect(quarantine.add("CommandCode/a")).toBe(false)
    expect(quarantine.add("CommandCode/b")).toBe(true)
  })

  it("has() reflects added keys", () => {
    const quarantine = new Quarantine()
    quarantine.add("CommandCode/a")
    expect(quarantine.has("CommandCode/a")).toBe(true)
    expect(quarantine.has("CommandCode/z")).toBe(false)
  })

  it("lists keys in a stable sorted order", () => {
    const quarantine = new Quarantine(["CommandCode/c", "CommandCode/a"])
    quarantine.add("CommandCode/b")
    expect(quarantine.list()).toEqual(["CommandCode/a", "CommandCode/b", "CommandCode/c"])
  })

  it("seeds from an initial list and stays independent of it", () => {
    const initial = ["CommandCode/a"]
    const quarantine = new Quarantine(initial)
    quarantine.add("CommandCode/b")
    expect(initial).toEqual(["CommandCode/a"])
    expect(quarantine.list()).toEqual(["CommandCode/a", "CommandCode/b"])
  })

  it("round-trips through its own list output", () => {
    const first = new Quarantine()
    first.add("CommandCode/a")
    first.add("CommandCode/b")
    expect(new Quarantine(first.list()).list()).toEqual(first.list())
  })
})

describe("parseQuarantine", () => {
  it("returns undefined for unrecognised persisted values", () => {
    expect(parseQuarantine(undefined)).toBeUndefined()
    expect(parseQuarantine(null)).toBeUndefined()
    expect(parseQuarantine("nope")).toBeUndefined()
    expect(parseQuarantine({})).toBeUndefined()
    expect(parseQuarantine(["CommandCode/legacy"])).toBeUndefined()
  })

  it("parses a credential identity and keeps only non-empty string keys", () => {
    expect(parseQuarantine({ credential: "credential:1", keys: ["CommandCode/a", "", 3, null, "CommandCode/b"] }))
      .toEqual({ credential: "credential:1", keys: ["CommandCode/a", "CommandCode/b"] })
  })
})
