import { Model, Provider } from "@opencode/plugin"
import { describe, expect, it } from "vitest"
import {
  PACKAGE_ANTHROPIC,
  PACKAGE_CHAT,
  PACKAGE_RESPONSES,
  packageFor,
  parseGatewayModels,
  toModelInfo,
  toModelInfoList,
  type GatewayModel,
} from "../src/discovery.js"
import { resolveOptions } from "../src/options.js"

const PROVIDER_ID = Provider.ID.make("cm")
const options = resolveOptions({})

/** Sample shaped exactly like the live gateway response, verified 2026-09-30. */
const payload = {
  object: "list",
  data: [
    {
      id: "claude-sonnet-5-5",
      object: "model",
      created: 1790783108,
      owned_by: "command-code",
      name: "Claude Sonnet 5.5",
      context_length: 1000000,
      supported_endpoints: ["/messages"],
    },
    {
      id: "gpt-6.1-sol",
      object: "model",
      created: 1790783108,
      owned_by: "command-code",
      name: "GPT-6.1 Sol",
      context_length: 1050000,
      supported_endpoints: ["/chat/completions", "/responses"],
    },
    {
      id: "stealth/space-bunny-alpha",
      object: "model",
      created: 1790783108,
      owned_by: "command-code",
      name: "Space Bunny Alpha",
      context_length: 1000000,
      supported_endpoints: ["/chat/completions"],
    },
    {
      id: "deepseek/deepseek-v4.1-flash",
      object: "model",
      created: 1790783108,
      owned_by: "command-code",
      name: "DeepSeek V4.1 Flash",
      context_length: 1000000,
      supported_endpoints: ["/chat/completions", "/responses"],
    },
    {
      id: "inclusionai/ling-3.1-flash:free",
      object: "model",
      created: 1790783108,
      owned_by: "command-code",
      name: "Ling 3.1 Flash",
      context_length: 262144,
      supported_endpoints: ["/chat/completions"],
    },
  ],
}

describe("packageFor", () => {
  it("prefers the responses runtime when the endpoint is offered", () => {
    expect(packageFor(["/chat/completions", "/responses"])).toBe(PACKAGE_RESPONSES)
    expect(packageFor(["/responses"])).toBe(PACKAGE_RESPONSES)
  })

  it("falls back to the chat runtime for chat-only models", () => {
    expect(packageFor(["/chat/completions"])).toBe(PACKAGE_CHAT)
  })

  it("uses the anthropic runtime for messages-only models", () => {
    expect(packageFor(["/messages"])).toBe(PACKAGE_ANTHROPIC)
  })

  it("defaults to the anthropic runtime when endpoints are missing or empty", () => {
    expect(packageFor(undefined)).toBe(PACKAGE_ANTHROPIC)
    expect(packageFor([])).toBe(PACKAGE_ANTHROPIC)
  })

  it("routes the ten live messages-only Claude models to the anthropic runtime", () => {
    const claude = [
      "claude-sonnet-5-5",
      "claude-sonnet-5",
      "claude-sonnet-4-6",
      "claude-fable-5-1",
      "claude-fable-5",
      "claude-opus-5-5",
      "claude-opus-5",
      "claude-opus-4-8",
      "claude-opus-4-7",
      "claude-haiku-4-5-20251001",
    ]
    const discovered = parseGatewayModels({
      data: claude.map((id) => ({
        id,
        name: id,
        context_length: 1000000,
        supported_endpoints: ["/messages"],
      })),
    })
    expect(discovered).toHaveLength(claude.length)

    const mapped = toModelInfoList(discovered, PROVIDER_ID, options)
    expect(mapped.map((model) => model.id)).toEqual(claude)
    expect(mapped.map((model) => model.package)).toEqual(claude.map(() => PACKAGE_ANTHROPIC))
  })
})

describe("parseGatewayModels", () => {
  it("keeps every well-formed entry from a real response", () => {
    const models = parseGatewayModels(payload)
    expect(models).toHaveLength(5)
    expect(models.map((model) => model.id)).toContain("deepseek/deepseek-v4.1-flash")
  })

  it("returns an empty list for malformed payloads", () => {
    expect(parseGatewayModels(undefined)).toEqual([])
    expect(parseGatewayModels(null)).toEqual([])
    expect(parseGatewayModels("nope")).toEqual([])
    expect(parseGatewayModels({})).toEqual([])
    expect(parseGatewayModels({ data: "nope" })).toEqual([])
    expect(parseGatewayModels({ data: [] })).toEqual([])
  })

  it("drops entries without a usable id and non-object entries", () => {
    const models = parseGatewayModels({
      data: [{ id: "keep" }, { id: "" }, { name: "no id" }, null, "nope", 3],
    })
    expect(models.map((model) => model.id)).toEqual(["keep"])
  })

  it("drops model IDs containing a variant separator", () => {
    const models = parseGatewayModels({ data: [{ id: "evil#variant" }, { id: "fine" }] })
    expect(models.map((model) => model.id)).toEqual(["fine"])
  })

  it("drops non-string entries from supported_endpoints", () => {
    const models = parseGatewayModels({
      data: [{ id: "mixed", supported_endpoints: ["/messages", 7, null] }],
    })
    expect(models[0]?.supported_endpoints).toEqual(["/messages"])
  })

  it("omits absent optional fields rather than storing undefined", () => {
    const models = parseGatewayModels({ data: [{ id: "bare" }] })
    expect(models[0]).toEqual({ id: "bare" })
  })
})

describe("toModelInfo", () => {
  const models = parseGatewayModels(payload)
  const byId = new Map(models.map((model) => [model.id, model]))
  const info = (id: string) => {
    const raw = byId.get(id)
    if (!raw) throw new Error(`missing fixture ${id}`)
    return toModelInfo(raw, PROVIDER_ID, options)
  }

  it("uses the gateway context length and the configured output limit", () => {
    expect(info("claude-sonnet-5-5").limit).toEqual({ context: 1000000, output: 32000 })
  })

  it("uses the gateway name", () => {
    expect(info("gpt-6.1-sol").name).toBe("GPT-6.1 Sol")
  })

  it("applies the endpoint-derived runtime package", () => {
    expect(info("claude-sonnet-5-5").package).toBe(PACKAGE_ANTHROPIC)
    expect(info("gpt-6.1-sol").package).toBe(PACKAGE_RESPONSES)
    expect(info("stealth/space-bunny-alpha").package).toBe(PACKAGE_CHAT)
  })

  it("keeps the gateway's optimistic default capabilities", () => {
    expect(info("gpt-6.1-sol").capabilities).toEqual({
      tools: true,
      input: ["text", "image"],
      output: ["text"],
    })
  })

  it("leaves cost empty and the release time unset because the gateway supplies neither", () => {
    const model = info("gpt-6.1-sol")
    expect(model.cost).toEqual([])
    expect(model.time.released).toBe(0)
    expect(model.status).toBe("active")
    expect(model.enabled).toBe(true)
  })

  it("keeps slash- and colon-bearing model IDs parseable as provider/model refs", () => {
    for (const id of [
      "deepseek/deepseek-v4.1-flash",
      "inclusionai/ling-3.1-flash:free",
      "claude-sonnet-5-5",
    ]) {
      const model = info(id)
      expect(model.id).toBe(id)
      expect(model.modelID).toBe(id)
      const ref = Model.Ref.parse(`${PROVIDER_ID as string}/${model.id}`)
      expect(ref.providerID).toBe(PROVIDER_ID)
      expect(ref.id).toBe(id)
    }
  })

  it("falls back to the configured defaults when the gateway omits metadata", () => {
    const model = toModelInfo({ id: "bare" }, PROVIDER_ID, options)
    expect(model.name).toBe("bare")
    expect(model.limit).toEqual({ context: 200000, output: 32000 })
    expect(model.package).toBe(PACKAGE_ANTHROPIC)
  })

  it("falls back to the configured context for a non-positive gateway context length", () => {
    expect(toModelInfo({ id: "bad", context_length: -1 }, PROVIDER_ID, options).limit.context)
      .toBe(options.defaultContext)
  })

  it("applies each override field on top of the gateway mapping", () => {
    const configured = resolveOptions({
      defaultContext: 1000,
      defaultOutput: 2000,
      overrides: {
        "gpt-6.1-sol": {
          name: "Renamed",
          context: 777,
          output: 888,
          enabled: false,
          package: "@custom/pkg",
        },
      },
    })
    const raw = byId.get("gpt-6.1-sol") as GatewayModel
    const model = toModelInfo(raw, PROVIDER_ID, configured)
    expect(model.name).toBe("Renamed")
    expect(model.limit).toEqual({ context: 777, output: 888 })
    expect(model.enabled).toBe(false)
    expect(model.package).toBe("@custom/pkg")
  })
})

describe("toModelInfoList", () => {
  it("maps every discovered model in order", () => {
    const models = parseGatewayModels(payload)
    const list = toModelInfoList(models, PROVIDER_ID, options)
    expect(list.map((model) => model.id)).toEqual(models.map((model) => model.id))
  })

  it("returns an empty list for an empty catalogue", () => {
    expect(toModelInfoList([], PROVIDER_ID, options)).toEqual([])
  })
})
