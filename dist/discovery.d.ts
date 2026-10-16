import { Model, type Provider } from "@opencode/plugin";
import type { ModelFacts } from "./modelsdev.js";
import type { Options } from "./options.js";
export declare const PACKAGE_RESPONSES = "@opencode/ai/providers/openai-compatible/responses";
export declare const PACKAGE_CHAT = "@opencode/ai/providers/openai-compatible";
export declare const PACKAGE_ANTHROPIC = "@opencode/ai/providers/anthropic-compatible";
/** One entry of `GET {baseURL}/models` -> `data[]`, reduced to the fields we use. */
export interface GatewayModel {
    readonly id: string;
    readonly name?: string;
    readonly context_length?: number;
    readonly supported_endpoints?: readonly string[];
}
type RangeOptions = Pick<Options, "defaultContext" | "defaultOutput" | "overrides">;
/**
 * The Anthropic-native models on this gateway reject the OpenAI-compatible layer,
 * so the runtime package follows the endpoints the gateway advertises.
 */
export declare function packageFor(endpoints: readonly string[] | undefined): string;
export declare function parseGatewayModels(payload: unknown): GatewayModel[];
/** The models.dev facts for one gateway model, or absent when it is not listed there. */
export type FactsLookup = ReadonlyMap<string, ModelFacts>;
export declare function toModelInfo(raw: GatewayModel, providerID: Provider.ID, options: RangeOptions, facts?: ModelFacts): Model.Info;
export declare function toModelInfoList(models: readonly GatewayModel[], providerID: Provider.ID, options: RangeOptions, facts?: FactsLookup): Model.Info[];
export {};
//# sourceMappingURL=discovery.d.ts.map