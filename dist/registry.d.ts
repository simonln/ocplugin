import { type Plugin } from "@opencode/plugin";
import { type GatewayModel } from "./discovery.js";
import type { Options } from "./options.js";
export declare const STORAGE_KEY = "quarantined";
export declare const MODELS_DEV_STORAGE_KEY = "modelsdev";
/** The slice of the plugin context this module needs. */
export type RegistrySlice = {
    readonly integration: Pick<Plugin.Context["integration"], "connection">;
    readonly provider: Pick<Plugin.Context["provider"], "transform" | "reload">;
    readonly model: Pick<Plugin.Context["model"], "transform" | "reload">;
    readonly storage: Pick<Plugin.Context["storage"], "get" | "set">;
};
export type RegistryDeps = {
    readonly fetch: typeof fetch;
};
export type RefreshResult = {
    readonly status: "ok";
    readonly count: number;
} | {
    readonly status: "not-connected";
} | {
    readonly status: "failed";
    readonly error: Error;
};
export interface Registry {
    /** Registers both transforms. Call once during setup, before the first refresh. */
    install(): Promise<void>;
    refresh(): Promise<RefreshResult>;
    current(): readonly GatewayModel[];
    quarantined(): readonly string[];
    /** Returns true when the model was newly quarantined. */
    quarantine(modelID: string): Promise<boolean>;
}
export declare function createRegistry(ctx: RegistrySlice, options: Options, deps?: RegistryDeps): Registry;
//# sourceMappingURL=registry.d.ts.map