import { Integration, type Plugin } from "@opencode/plugin";
import type { Options } from "./options.js";
/** The slice of the plugin context this module needs. */
export type IntegrationSlice = {
    readonly integration: Plugin.Context["integration"];
};
/**
 * Registers the sign-in method that lets `/connect` store the gateway API key in
 * OpenCode's credential store, so it never has to live in `opencode.jsonc`.
 */
export declare function registerIntegration(ctx: IntegrationSlice, options: Options): Promise<Integration.ID>;
//# sourceMappingURL=integration.d.ts.map