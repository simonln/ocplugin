/** A per-model correction applied after the gateway mapping. */
export interface ModelOverride {
    readonly name?: string;
    readonly context?: number;
    readonly output?: number;
    readonly enabled?: boolean;
    readonly package?: string;
}
export interface Options {
    readonly baseURL: string;
    readonly providerID: string;
    readonly displayName: string;
    readonly modelsDevURL: string;
    readonly defaultOutput: number;
    readonly defaultContext: number;
    readonly requestTimeout: number;
    readonly headers: Readonly<Record<string, string>>;
    readonly body: Readonly<Record<string, unknown>>;
    readonly overrides: Readonly<Record<string, ModelOverride>>;
    readonly quarantineOnAuthFailure: boolean;
}
export declare const MODELS_DEV_URL = "https://models.dev/api.json";
export declare const DEFAULTS: Options;
export declare function resolveOptions(raw: unknown): Options;
//# sourceMappingURL=options.d.ts.map