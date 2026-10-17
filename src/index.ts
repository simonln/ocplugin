import { Plugin } from "@opencode/plugin"
import { registerIntegration } from "./integration.js"
import { resolveOptions } from "./options.js"
import { createRegistry } from "./registry.js"
import { isQuarantineStatus } from "./quarantine.js"
import { rewriteCommandCodeMessages } from "./anthropic.js"

export default Plugin.define({
  id: "opencode-cm-provider",

  async setup(ctx) {
    const options = resolveOptions(ctx.options)

    await registerIntegration(ctx, options)

    const registry = createRegistry(ctx, options)
    await registry.install()
    await registry.refresh()

    await ctx.session.hook(
      "http.request",
      async (event) => {
        if (event.model.providerID !== options.providerID) return
        const request = await rewriteCommandCodeMessages(event.request)
        if (request !== event.request) {
          ;(event as { request: Request }).request = request
        }
      },
      { providerID: options.providerID },
    )

    // Three refresh points, no polling: startup above, a fresh /connect storing a
    // credential, and the user switching models. The catalogue is served without
    // authentication and changes slowly, so a timer would only cost requests.
    const controller = new AbortController()
    void (async () => {
      try {
        for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
          const type = (event as { type?: unknown }).type
          if (typeof type !== "string") continue
          if (!type.startsWith("credential.") && type !== "session.model.selected") continue
          try {
            await registry.refresh()
          } catch (error) {
            console.error(`[opencode-cm-provider] refresh on ${type} failed`, error)
          }
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error("[opencode-cm-provider] event stream failed", error)
        }
      }
    })()

    if (options.quarantineOnAuthFailure) {
      await ctx.session.hook(
        "retry",
        async (event) => {
          const status = event.error.status ?? 0
          if (!isQuarantineStatus(status)) return
          if (event.model.providerID !== options.providerID) return
          if (await registry.quarantine(event.model.id)) {
            console.error(
              `[opencode-cm-provider] ${event.model.id} returned HTTP ${status}; hidden from /models`,
            )
          }
        },
        { providerID: options.providerID },
      )
    }

    return () => {
      controller.abort()
    }
  },
})
