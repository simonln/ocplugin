import type { GatewayModel } from "./discovery.js";
/**
 * The subset of a models.dev entry this plugin uses. Everything else in the 5.3 MB
 * payload is dropped during {@link enrichModels} so only these fields reach storage.
 */
export interface ModelFacts {
    readonly context?: number;
    readonly output?: number;
    readonly input?: readonly string[];
    readonly outputModalities?: readonly string[];
    readonly tools?: boolean;
    readonly reasoning?: boolean;
    readonly reasoningOptions?: readonly ReasoningOption[];
}
export type ReasoningOption = {
    readonly type: "effort";
    readonly values?: readonly string[];
} | {
    readonly type: "toggle";
} | {
    readonly type: "budget_tokens";
    readonly min?: number;
    readonly max?: number;
};
/** Keyed by gateway model ID, so a cached index maps straight onto a catalogue. */
export type FactsIndex = ReadonlyMap<string, ModelFacts>;
/**
 * Gateway IDs carry an org prefix (`deepseek/deepseek-v4.1-flash`) that models.dev uses
 * as a provider key. Consulting the org first keeps two providers that both list a
 * `deepseek-v4-pro` from being confused for one another.
 */
export declare const ORG_PROVIDERS: Readonly<Record<string, string>>;
/**
 * Lowercase and drop punctuation so `deepseek-v4.1-flash` and `DeepSeek-V4-1-Flash` are
 * one key. The `-latest` suffix models.dev appends to alias entries is dropped too.
 */
export declare function normalizeModelKey(id: string): string;
/**
 * Reduces the payload to facts for exactly the models the gateway listed. Unmatched
 * models are simply absent, so callers fall back to their own defaults.
 */
export declare function enrichModels(models: readonly GatewayModel[], payload: unknown): FactsIndex;
/** What a stored cache holds: facts plus the catalogue they were derived from. */
export interface FactsCache {
    readonly version: 2;
    readonly facts: FactsIndex;
    /** Gateway model IDs present in the catalogue that produced `facts`. */
    readonly covered: ReadonlySet<string>;
}
/**
 * Rebuilds a cache from `ctx.storage`. Storage holds untrusted JSON that outlived a
 * previous process, so every field is re-validated and a bad entry is dropped whole
 * rather than partially trusted.
 */
export declare function parseFactsCache(value: unknown): FactsCache;
/** Serializes a cache into the shape {@link parseFactsCache} reads back. */
export declare function serializeFactsCache(covered: readonly string[], facts: FactsIndex): {
    version: 2;
    covered: string[];
    facts: Record<string, ModelFacts>;
};
//# sourceMappingURL=modelsdev.d.ts.map