/**
 * Gateway IDs carry an org prefix (`deepseek/deepseek-v4.1-flash`) that models.dev uses
 * as a provider key. Consulting the org first keeps two providers that both list a
 * `deepseek-v4-pro` from being confused for one another.
 */
export const ORG_PROVIDERS = {
    claude: "anthropic",
    anthropic: "anthropic",
    openai: "openai",
    gpt: "openai",
    google: "google",
    gemini: "google",
    xai: "xai",
    grok: "xai",
    deepseek: "deepseek",
    qwen: "alibaba",
    "zai-org": "zai",
    "z-ai": "zai",
    glm: "zai",
    moonshotai: "moonshotai",
    kimi: "moonshotai",
    minimaxai: "minimax",
    xiaomi: "xiaomi",
    mimo: "xiaomi",
    meta: "meta-llama",
    stepfun: "stepfun",
    tencent: "tencent",
    meituan: "meituan",
    sakana: "sakana",
    nvidia: "nvidia",
    inclusionai: "inclusionai",
    poolside: "poolside",
    thinkingmachines: "thinkingmachines",
    mistral: "mistral",
    openrouter: "openrouter",
};
/**
 * Lowercase and drop punctuation so `deepseek-v4.1-flash` and `DeepSeek-V4-1-Flash` are
 * one key. The `-latest` suffix models.dev appends to alias entries is dropped too.
 */
export function normalizeModelKey(id) {
    return id
        .toLowerCase()
        .replace(/-latest$/, "")
        .replace(/[^a-z0-9]+/g, "");
}
function plainRecord(value) {
    if (typeof value !== "object" || value === null || Array.isArray(value))
        return undefined;
    return value;
}
/** A positive finite number, floored. models.dev writes `0` for "unknown", which reads as absent. */
function positiveInt(value) {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
        return undefined;
    return Math.floor(value);
}
function stringArray(value) {
    if (!Array.isArray(value))
        return undefined;
    const out = value.filter((entry) => typeof entry === "string");
    return out.length > 0 ? out : undefined;
}
function readLimit(entry) {
    const limit = plainRecord(entry.limit);
    if (!limit)
        return {};
    const context = positiveInt(limit.context);
    const output = positiveInt(limit.output);
    return {
        ...(context === undefined ? {} : { context }),
        ...(output === undefined ? {} : { output }),
    };
}
/**
 * Reads a models.dev model entry, whose keys are the upstream spelling (`tool_call`,
 * nested `modalities`), into our own {@link ModelFacts} shape.
 */
function readEntry(entry) {
    const record = plainRecord(entry);
    if (!record)
        return undefined;
    const modalities = plainRecord(record.modalities);
    const input = modalities ? stringArray(modalities.input) : undefined;
    const output = modalities ? stringArray(modalities.output) : undefined;
    const facts = {
        ...readLimit(record),
        ...(input === undefined ? {} : { input }),
        ...(output === undefined ? {} : { outputModalities: output }),
        ...(typeof record.tool_call === "boolean" ? { tools: record.tool_call } : {}),
    };
    return Object.keys(facts).length > 0 ? facts : undefined;
}
/**
 * Reads a {@link ModelFacts} value as written to storage. Kept separate from
 * {@link readEntry} because the two use different key spellings, and sharing one reader
 * silently dropped every cached `tools` and `outputModalities` value.
 */
function readFacts(entry) {
    const record = plainRecord(entry);
    if (!record)
        return undefined;
    const context = positiveInt(record.context);
    const output = positiveInt(record.output);
    const input = stringArray(record.input);
    const outputModalities = stringArray(record.outputModalities);
    const facts = {
        ...(context === undefined ? {} : { context }),
        ...(output === undefined ? {} : { output }),
        ...(input === undefined ? {} : { input }),
        ...(outputModalities === undefined ? {} : { outputModalities }),
        ...(typeof record.tools === "boolean" ? { tools: record.tools } : {}),
    };
    return Object.keys(facts).length > 0 ? facts : undefined;
}
/**
 * Reduces the 5.3 MB payload to two lookup tables. Building these is what makes a later
 * lookup O(1) instead of a scan over 8340 entries per model.
 */
function indexPayload(payload) {
    const byProvider = new Map();
    const byKey = new Map();
    for (const [providerID, value] of Object.entries(plainRecord(payload) ?? {})) {
        const models = plainRecord(plainRecord(value)?.models);
        if (!models)
            continue;
        const table = new Map();
        for (const [modelID, entry] of Object.entries(models)) {
            const facts = readEntry(entry);
            if (!facts)
                continue;
            const key = normalizeModelKey(modelID);
            // First provider wins the fallback slot, so the index is stable across payloads.
            if (!byKey.has(key))
                byKey.set(key, facts);
            if (!table.has(key))
                table.set(key, facts);
        }
        byProvider.set(providerID, table);
    }
    return { byProvider, byKey };
}
function lookup(tables, gatewayID) {
    const separator = gatewayID.indexOf("/");
    const org = separator === -1 ? gatewayID.split("-")[0] ?? "" : gatewayID.slice(0, separator);
    const bare = separator === -1 ? gatewayID : gatewayID.slice(separator + 1);
    const provider = ORG_PROVIDERS[org.toLowerCase()];
    const scoped = provider ? tables.byProvider.get(provider)?.get(normalizeModelKey(bare)) : undefined;
    return scoped ?? tables.byKey.get(normalizeModelKey(bare));
}
/**
 * Reduces the payload to facts for exactly the models the gateway listed. Unmatched
 * models are simply absent, so callers fall back to their own defaults.
 */
export function enrichModels(models, payload) {
    const tables = indexPayload(payload);
    const index = new Map();
    for (const model of models) {
        const facts = lookup(tables, model.id);
        if (facts)
            index.set(model.id, facts);
    }
    return index;
}
const EMPTY_CACHE = { facts: new Map(), covered: new Set() };
/**
 * Rebuilds a cache from `ctx.storage`. Storage holds untrusted JSON that outlived a
 * previous process, so every field is re-validated and a bad entry is dropped whole
 * rather than partially trusted.
 */
export function parseFactsCache(value) {
    const record = plainRecord(value);
    const factsRecord = plainRecord(record?.facts);
    if (!factsRecord)
        return EMPTY_CACHE;
    const facts = new Map();
    for (const [modelID, entry] of Object.entries(factsRecord)) {
        const entryFacts = readFacts(entry);
        if (entryFacts)
            facts.set(modelID, entryFacts);
    }
    const covered = new Set();
    for (const modelID of Array.isArray(record?.covered) ? record.covered : []) {
        if (typeof modelID === "string")
            covered.add(modelID);
    }
    return { facts, covered };
}
/** Serializes a cache into the shape {@link parseFactsCache} reads back. */
export function serializeFactsCache(covered, facts) {
    return { covered: [...covered], facts: Object.fromEntries(facts) };
}
//# sourceMappingURL=modelsdev.js.map