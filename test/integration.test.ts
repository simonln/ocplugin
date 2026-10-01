import { describe, expect, it } from "vitest"
import { registerIntegration, type IntegrationSlice } from "../src/integration.js"
import { resolveOptions } from "../src/options.js"

interface Recorded {
  readonly names: Array<{ id: string; name: string }>
  readonly methods: Array<{ integrationID: string; method: Record<string, unknown> }>
}

function fakeContext(recorded: Recorded): IntegrationSlice {
  const editor = {
    update(id: string, update: (integration: { name: string }) => void) {
      const integration = { name: "" }
      update(integration)
      recorded.names.push({ id, name: integration.name })
    },
    method: {
      update(input: { integrationID: string; method: Record<string, unknown> }) {
        recorded.methods.push(input)
      },
    },
  }
  return {
    integration: {
      transform: async (callback: (input: unknown) => void) => {
        callback(editor)
        return { dispose: async () => {} }
      },
    },
  } as unknown as IntegrationSlice
}

describe("registerIntegration", () => {
  it("registers the display name against the providerID", async () => {
    const recorded: Recorded = { names: [], methods: [] }
    const id = await registerIntegration(fakeContext(recorded), resolveOptions({}))

    expect(id).toBe("CommandCode")
    expect(recorded.names).toEqual([{ id: "CommandCode", name: "Command Code" }])
  })

  it("registers a key method whose form field is named apiKey", async () => {
    const recorded: Recorded = { names: [], methods: [] }
    await registerIntegration(fakeContext(recorded), resolveOptions({}))

    expect(recorded.methods).toHaveLength(1)
    const registration = recorded.methods[0]
    expect(registration?.integrationID).toBe("CommandCode")

    const method = registration?.method as {
      type: string
      label?: string
      form?: Array<Record<string, unknown>>
    }
    expect(method.type).toBe("key")
    expect(method.label).toBe("API Key")
    expect(method.form).toHaveLength(1)
    expect(method.form?.[0]).toMatchObject({
      type: "string",
      key: "apiKey",
      required: true,
      hidden: true,
    })
  })

  it("honours a custom providerID and displayName", async () => {
    const recorded: Recorded = { names: [], methods: [] }
    const options = resolveOptions({ providerID: "acme", displayName: "Acme Gateway" })
    const id = await registerIntegration(fakeContext(recorded), options)

    expect(id).toBe("acme")
    expect(recorded.names).toEqual([{ id: "acme", name: "Acme Gateway" }])
    expect(recorded.methods[0]?.integrationID).toBe("acme")
  })
})
