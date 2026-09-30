import { describe, expect, it } from "vitest"
import { Quarantine, parseQuarantine } from "../src/quarantine.js"

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
  it("returns an empty list for anything that is not an array of non-empty strings", () => {
    expect(parseQuarantine(undefined)).toEqual([])
    expect(parseQuarantine(null)).toEqual([])
    expect(parseQuarantine("nope")).toEqual([])
    expect(parseQuarantine({})).toEqual([])
  })

  it("keeps only non-empty strings", () => {
    expect(parseQuarantine(["cm/a", "", 3, null, "cm/b"])).toEqual(["cm/a", "cm/b"])
  })
})
