export const MODELS_DEV_URL = "https://models.dev/api.json";
export const DEFAULTS = {
    baseURL: "https://api.commandcode.ai/provider/v1",
    providerID: "CommandCode",
    displayName: "CC",
    modelsDevURL: MODELS_DEV_URL,
    defaultOutput: 32_000,
    defaultContext: 200_000,
    requestTimeout: 15_000,
    headers: {},
    body: {},
    overrides: {},
    quarantineOnAuthFailure: true,
};
function plainRecord(value) {
    if (typeof value !== "object" || value === null || Array.isArray(value))
        return undefined;
    return value;
}
function positiveInt(value, fallback) {
    if (typeof value !== "number" || !Number.isFinite(value))
        return fallback;
    const floored = Math.floor(value);
    return floored >= 1 ? floored : fallback;
}
/**
 * A positive value below the floor clamps up to it, because the floor exists to
 * protect the gateway rather than to reject a user who asked for something faster.
 * A non-positive or non-finite value is nonsense and takes the default.
 */
function clampedInterval(value, fallback, floor) {
    if (typeof value !== "number" || !Number.isFinite(value))
        return fallback;
    if (value <= 0)
        return fallback;
    const floored = Math.floor(value);
    return Math.max(floored, floor);
}
function nonEmptyString(value, fallback) {
    return typeof value === "string" && value.trim() !== "" ? value.trim() : fallback;
}
function stringRecord(value) {
    const raw = plainRecord(value);
    if (!raw)
        return {};
    const out = {};
    for (const [key, entry] of Object.entries(raw)) {
        if (typeof entry === "string")
            out[key] = entry;
    }
    return out;
}
function parseOverrides(value) {
    const raw = plainRecord(value);
    if (!raw)
        return {};
    const out = {};
    for (const [modelID, entry] of Object.entries(raw)) {
        const record = plainRecord(entry);
        if (!record)
            continue;
        const override = {};
        if (typeof record.name === "string")
            override.name = record.name;
        if (typeof record.package === "string")
            override.package = record.package;
        if (typeof record.enabled === "boolean")
            override.enabled = record.enabled;
        if (typeof record.context === "number" && Number.isFinite(record.context)) {
            override.context = Math.floor(record.context);
        }
        if (typeof record.output === "number" && Number.isFinite(record.output)) {
            override.output = Math.floor(record.output);
        }
        if (Object.keys(override).length > 0)
            out[modelID] = override;
    }
    return out;
}
export function resolveOptions(raw) {
    const input = plainRecord(raw) ?? {};
    const providerID = nonEmptyString(input.providerID, DEFAULTS.providerID);
    if (providerID.includes("/") || providerID.includes("#")) {
        throw new Error(`providerID must not contain "/" or "#" because both are model-reference separators: ${providerID}`);
    }
    const strippedBaseURL = nonEmptyString(input.baseURL, DEFAULTS.baseURL).replace(/\/+$/, "");
    return {
        baseURL: strippedBaseURL || DEFAULTS.baseURL,
        providerID,
        displayName: nonEmptyString(input.displayName, DEFAULTS.displayName),
        // An explicit empty string disables enrichment; an absent key uses the default.
        modelsDevURL: input.modelsDevURL === "" ? "" : nonEmptyString(input.modelsDevURL, DEFAULTS.modelsDevURL),
        defaultOutput: positiveInt(input.defaultOutput, DEFAULTS.defaultOutput),
        defaultContext: positiveInt(input.defaultContext, DEFAULTS.defaultContext),
        requestTimeout: clampedInterval(input.requestTimeout, DEFAULTS.requestTimeout, 1_000),
        headers: stringRecord(input.headers),
        body: plainRecord(input.body) ?? {},
        overrides: parseOverrides(input.overrides),
        quarantineOnAuthFailure: typeof input.quarantineOnAuthFailure === "boolean"
            ? input.quarantineOnAuthFailure
            : DEFAULTS.quarantineOnAuthFailure,
    };
}
//# sourceMappingURL=options.js.map