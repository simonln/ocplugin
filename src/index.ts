import { Plugin } from "@opencode/plugin"
import { registerIntegration } from "./integration.js"
import { resolveOptions } from "./options.js"
import { createRegistry } from "./registry.js"
import { isQuarantineStatus } from "./quarantine.js"

export default Plugin.define({
  id: "opencode-cm-provider",

  async setup(ctx) {
    const options = resolveOptions(ctx.options)

    await registerIntegration(ctx, options)

    const registry = createRegistry(ctx, options)
    await registry.install()
    await registry.refresh()

    // A fresh /connect stores a credential; refresh immediately so the catalogue
    // appears without restarting the server.
    const controller = new AbortController()
    void (async () => {
      try {
        for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
          const type = (event as { type?: unknown }).type
          if (typeof type !== "string" || !type.startsWith("credential.")) continue
          try {
            await registry.refresh()
          } catch (error) {
            console.error("[opencode-cm-provider] credential refresh failed", error)
          }
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error("[opencode-cm-provider] credential event stream failed", error)
        }
      }
    })()

    const timer = setInterval(() => {
      void registry
        .refresh()
        .then((result) => {
          if (result.status === "failed") {
            console.error("[opencode-cm-provider] model refresh failed", result.error)
          }
        })
        .catch((error) => {
          console.error("[opencode-cm-provider] model refresh rejected", error)
        })
    }, options.refreshInterval)

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
      clearInterval(timer)
    }
  },
})
