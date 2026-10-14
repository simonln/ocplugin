// Live end-to-end check of the enrichment path. Not part of the test suite.
// Run with: node scripts/verify-live.mjs
import { enrichModels } from "../dist/modelsdev.js"
import { parseGatewayModels, toModelInfoList } from "../dist/discovery.js"
import { resolveOptions } from "../dist/options.js"

const GATEWAY = "https://api.commandcode.ai/provider/v1/models"
const MODELS_DEV = "https://models.dev/api.json"

const timed = async (label, fn) => {
  const start = Date.now()
  const value = await fn()
  return { value, ms: Date.now() - start }
}

const gateway = await timed("gateway", async () =>
  (await fetch(GATEWAY, { headers: { accept: "application/json" } })).json(),
)
const modelsDev = await timed("modelsDev", async () => (await fetch(MODELS_DEV)).json())

const models = parseGatewayModels(gateway.value)
const enriched = await timed("enrich", async () => enrichModels(models, modelsDev.value))

const options = resolveOptions({})
const list = toModelInfoList(models, "CommandCode", options, enriched.value)
const byID = new Map(list.map((m) => [m.id, m]))

console.log("timing (ms)", { gateway: gateway.ms, modelsDev: modelsDev.ms, enrich: enriched.ms })
console.log("catalogue", {
  total: models.length,
  matched: enriched.value.size,
  pct: Math.round((enriched.value.size / models.length) * 100),
})

const stored = JSON.stringify(Object.fromEntries(enriched.value))
console.log("cache bytes", stored.length)

console.log("still on defaultOutput", list.filter((m) => m.limit.output === 32000).map((m) => m.id))
console.log(
  "text-only models",
  list.filter((m) => !m.capabilities.input.includes("image")).map((m) => m.id),
)
console.log(
  "tools disabled",
  list.filter((m) => !m.capabilities.tools).map((m) => m.id),
)

// The precedence rule: gateway context must always survive.
const conflicts = list.filter((m) => {
  const facts = enriched.value.get(m.id)
  return facts?.context !== undefined && facts.context !== m.limit.context
})
console.log("context precedence conflicts", conflicts.map((m) => [m.id, m.limit.context]))

for (const id of [
  "claude-sonnet-5-5",
  "gpt-5.4",
  "google/gemini-3.5-flash",
  "zai-org/GLM-5.1",
  "stealth/space-bunny-alpha",
]) {
  const m = byID.get(id)
  console.log(
    id,
    m && {
      context: m.limit.context,
      output: m.limit.output,
      input: m.capabilities.input,
      tools: m.capabilities.tools,
      package: m.package,
    },
  )
}