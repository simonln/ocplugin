import { describe, expect, it } from "vitest"
import {
  ORG_PROVIDERS,
  enrichModels,
  normalizeModelKey,
  parseFactsCache,
  serializeFactsCache,
} from "../src/modelsdev.js"

/**
 * Trimmed from the live models.dev `api.json`, verified 2026-09-30. Shapes are exact;
 * only unrelated providers and models were dropped.
 */
const payload = {
  anthropic: {
    id: "anthropic",
    models: {
      "claude-sonnet-5-5": {
        id: "claude-sonnet-5-5",
        name: "Claude Sonnet 5.5",
        tool_call: true,
        reasoning: true,
        reasoning_options: { type: "effort", values: ["low", "high", null] },
        release_date: "2026-01-15",
        modalities: { input: ["text", "image", "pdf"], output: ["text"] },
        limit: { context: 1000000, output: 128000 },
      },
      // Present under two providers; the gateway's org prefix must disambiguate.
      "deepseek-v4-pro": { id: "deepseek-v4-pro", limit: { context: 500000, output: 32000 } },
    },
  },
  deepseek: {
    id: "deepseek",
    models: {
      "deepseek-v4-pro": {
        id: "deepseek-v4-pro",
        tool_call: false,
        modalities: { input: ["text"], output: ["text"] },
        limit: { context: 128000, output: 16000 },
      },
      "deepseek-v4.1-flash": {
        id: "deepseek-v4.1-flash",
        tool_call: true,
        modalities: { input: ["text", "image"], output: ["text"] },
        limit: { context: 1048576, output: 64000 },
      },
    },
  },
  // Reached only through the any-provider fallback.
  azure: {
    id: "azure",
    models: {
      "gpt-6.1-sol": {
        id: "gpt-6.1-sol",
        tool_call: true,
        modalities: { input: ["text", "image"], output: ["text"] },
        limit: { context: 400000, output: 100000 },
      },
    },
  },
}

const gateway = (...ids: string[]) => ids.map((id) => ({ id }))

describe("normalizeModelKey", () => {
  it("lowercases and strips punctuation so dotted and dashed IDs collide", () => {
    expect(normalizeModelKey("deepseek-v4.1-flash")).toBe(normalizeModelKey("DeepSeek-V4-1-Flash"))
  })

  it("drops a trailing -latest alias suffix", () => {
    expect(normalizeModelKey("gpt-5.4-latest")).toBe(normalizeModelKey("gpt-5.4"))
  })
})

describe("enrichModels", () => {
  it("matches through the gateway org prefix and reads limits and capabilities", () => {
    const facts = enrichModels(gateway("claude-sonnet-5-5"), payload).get("claude-sonnet-5-5")

    expect(facts).toEqual({
      context: 1000000,
      output: 128000,
      input: ["text", "image", "pdf"],
      outputModalities: ["text"],
      tools: true,
      reasoning: true,
      reasoningOptions: [{ type: "effort", values: ["low", "high"] }],
    })
  })

  it("normalizes the dotted gateway ID before matching", () => {
    const facts = enrichModels(gateway("deepseek/deepseek-v4.1-flash"), payload).get(
      "deepseek/deepseek-v4.1-flash",
    )
    expect(facts?.output).toBe(64000)
  })

  it("prefers the provider named by the gateway org prefix over another provider's namesake", () => {
    const index = enrichModels(gateway("deepseek/deepseek-v4-pro"), payload)
    expect(index.get("deepseek/deepseek-v4-pro")).toEqual({
      context: 128000,
      output: 16000,
      input: ["text"],
      outputModalities: ["text"],
      tools: false,
    })
  })

  it("falls back to any provider when the org prefix names none", () => {
    expect(enrichModels(gateway("gpt-6.1-sol"), payload).get("gpt-6.1-sol")?.output).toBe(100000)
  })

  it("returns no entry for a model models.dev does not list", () => {
    const index = enrichModels(
      gateway("stealth/space-bunny-alpha", "tencent/hy3-paid", "inclusionai/ling-3.1-flash:free"),
      payload,
    )
    expect(index.size).toBe(0)
  })

  it("returns an empty index for a malformed payload", () => {
    expect(enrichModels(gateway("claude-sonnet-5-5"), null).size).toBe(0)
    expect(enrichModels(gateway("claude-sonnet-5-5"), "nope").size).toBe(0)
    expect(enrichModels(gateway("claude-sonnet-5-5"), {}).size).toBe(0)
  })

  it("treats a zero limit as absent because models.dev uses it for unknown", () => {
    const zeroed = {
      openai: {
        id: "openai",
        models: { "chatgpt-image-latest": { id: "chatgpt-image-latest", limit: { context: 0, output: 0 } } },
      },
    }
    const facts = enrichModels(gateway("chatgpt-image-latest"), zeroed).get("chatgpt-image-latest")
    expect(facts?.context).toBeUndefined()
    expect(facts?.output).toBeUndefined()
  })

  it("omits absent fields rather than storing undefined", () => {
    const sparse = { acme: { id: "acme", models: { widget: { id: "widget", limit: { context: 4096 } } } } }
    expect(enrichModels(gateway("widget"), sparse).get("widget")).toEqual({ context: 4096 })
  })

  it("keeps a false tools flag instead of dropping it", () => {
    const noTools = {
      acme: {
        id: "acme",
        models: { widget: { id: "widget", tool_call: false, modalities: { input: ["text"] } } },
      },
    }
    expect(enrichModels(gateway("widget"), noTools).get("widget")?.tools).toBe(false)
  })

  it("keeps reasoning metadata and removes null effort aliases", () => {
    const facts = enrichModels(gateway("claude-sonnet-5-5"), payload).get("claude-sonnet-5-5")
    expect(facts?.reasoning).toBe(true)
    expect(facts?.reasoningOptions).toEqual([{ type: "effort", values: ["low", "high"] }])
  })
})

describe("ORG_PROVIDERS", () => {
  it("maps every observed gateway org prefix to a models.dev provider", () => {
    for (const org of [
      "deepseek",
      "zai-org",
      "z-ai",
      "moonshotai",
      "MiniMaxAI",
      "Qwen",
      "google",
      "xai",
      "stepfun",
      "meta",
    ]) {
      expect(ORG_PROVIDERS[org.toLowerCase()]).toBeDefined()
    }
  })
})

describe("parseFactsCache", () => {
  it("round-trips a cache written by enrichModels", () => {
    const models = gateway("claude-sonnet-5-5")
    const stored = JSON.parse(
      JSON.stringify(serializeFactsCache(models.map((m) => m.id), enrichModels(models, payload))),
    )
    const restored = parseFactsCache(stored)

    expect(restored.facts.get("claude-sonnet-5-5")).toEqual({
      context: 1000000,
      output: 128000,
      input: ["text", "image", "pdf"],
      outputModalities: ["text"],
      tools: true,
      reasoning: true,
      reasoningOptions: [{ type: "effort", values: ["low", "high"] }],
    })
    expect([...restored.covered]).toEqual(["claude-sonnet-5-5"])
  })

  it("records a model with no facts as covered so it does not force a re-download", () => {
    const models = gateway("claude-sonnet-5-5", "stealth/space-bunny-alpha")
    const restored = parseFactsCache(
      JSON.parse(JSON.stringify(serializeFactsCache(models.map((m) => m.id), enrichModels(models, payload)))),
    )

    expect(restored.covered.has("stealth/space-bunny-alpha")).toBe(true)
    expect(restored.facts.has("stealth/space-bunny-alpha")).toBe(false)
  })

  it("drops entries whose stored shape is wrong and keeps the rest", () => {
    const restored = parseFactsCache({
      version: 2,
      covered: ["a"],
      facts: {
        good: { context: 1000, output: 20, tools: false },
        notAnObject: 7,
        badContext: { context: -1 },
        badModalities: { input: "text" },
        badOutputModalities: { outputModalities: [3] },
      },
    })

    expect(restored.facts.get("good")).toEqual({ context: 1000, output: 20, tools: false })
    expect(restored.facts.has("notAnObject")).toBe(false)
    expect(restored.facts.has("badContext")).toBe(false)
    expect(restored.facts.has("badModalities")).toBe(false)
    expect(restored.facts.has("badOutputModalities")).toBe(false)
    expect([...restored.covered]).toEqual(["a"])
  })

  it("returns an empty cache for anything that is not a plain object", () => {
    for (const value of [undefined, null, "nope", [], 7]) {
      const restored = parseFactsCache(value)
      expect(restored.facts.size).toBe(0)
      expect(restored.covered.size).toBe(0)
    }
  })

  it("treats a cache with no facts record as empty", () => {
    expect(parseFactsCache({ version: 2, covered: ["a"] }).facts.size).toBe(0)
  })

  it("ignores a malformed covered list", () => {
    const restored = parseFactsCache({ version: 2, covered: ["a", 7, null], facts: {} })
    expect([...restored.covered]).toEqual(["a"])
  })

  it("floors fractional limits so they survive the schema's integer field", () => {
    expect(parseFactsCache({ version: 2, covered: ["m"], facts: { m: { context: 1000.9, output: 20.5 } } }).facts.get("m"))
      .toEqual({ context: 1000, output: 20 })
  })
})
