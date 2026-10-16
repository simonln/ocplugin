import { Integration } from "@opencode/plugin";
/**
 * Registers the sign-in method that lets `/connect` store the gateway API key in
 * OpenCode's credential store, so it never has to live in `opencode.jsonc`.
 */
export async function registerIntegration(ctx, options) {
    const integrationID = Integration.ID.make(options.providerID);
    await ctx.integration.transform((editor) => {
        editor.update(integrationID, (integration) => {
            integration.name = options.displayName;
        });
        editor.method.update({
            integrationID,
            method: {
                type: "key",
                label: "API Key",
                form: [
                    {
                        type: "string",
                        key: "apiKey",
                        title: "API Key",
                        description: `API key issued by ${options.displayName}`,
                        required: true,
                        hidden: true,
                    },
                ],
            },
        });
    });
    return integrationID;
}
//# sourceMappingURL=integration.js.map