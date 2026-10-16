# opencode-cm-provider

An [OpenCode](https://opencode.ai) V2 plugin that registers the Command Code gateway
(`https://api.commandcode.ai/provider/v1`) as a provider, discovers its model catalogue
automatically, and keeps the API key in OpenCode's credential store instead of
`opencode.jsonc`.

## What it does

- Registers the provider (default ID `CommandCode`) and pulls the model list from `GET {baseURL}/models` on
  startup, when a credential changes, and when you switch models. No polling.
- Fetches that list without credentials — the gateway serves it anonymously. The API key is
  still resolved, because the provider needs it to serve real requests.
- Routes each model to the correct runtime from the gateway's `supported_endpoints`:
  `/responses` models use the OpenAI Responses runtime, chat-only models use the OpenAI
  chat runtime, and the Anthropic-native Claude models use the Anthropic runtime.
- Reads `context_length` per model from the gateway, so context limits never need hand-tuning.
- Fills in output limits and capabilities (image support, tool support) from
  [models.dev](https://models.dev), which the gateway does not report. Matched models stop
  defaulting to 32000 output tokens and stop claiming image support they do not have.
- Stores the API key via `/connect` in OpenCode's credential store.
- Hides models the account is not entitled to. The catalogue does not report
  entitlements, so a model that answers 403 is quarantined after its first failure
  and disappears from `/models`.
- Keeps the last good catalogue when the gateway is temporarily unreachable.
- Refreshes when you switch models, so a model added to the gateway shows up without
  restarting the service. Note that this happens *after* a selection, so the `/models`
  list itself still shows the catalogue as of the last refresh.

## Install

### From GitHub

Add the repository to your OpenCode configuration. OpenCode installs GitHub
plugins through its npm-compatible package loader:

```jsonc title="opencode.jsonc"
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["github:simonln/ocplugin#main"],
}
```

To pin a specific release commit instead of following `main`, replace `main`
with the commit SHA. The repository includes its compiled `dist/` output, so no
local build step is required.

Then restart the service and connect:

```sh
opencode service restart
```

In the TUI, run `/connect`, choose **CC**, and paste your API key. The
catalogue appears in `/models` without a restart.

### From a local checkout

For local development, add the plugin directory to your OpenCode configuration:

```jsonc title="opencode.jsonc"
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["file:///D:/code/repos/ocplugin"],
}
```

Remove any hand-written `providers.cm` block from `opencode.jsonc` first — this plugin
owns that provider ID.

## Options

Pass options through the object form of the `plugins` entry:

```jsonc title="opencode.jsonc"
{
  "plugins": [
    {
      "package": "github:simonln/ocplugin#main",
      "options": {
        "defaultOutput": 32000,
      },
    },
  ],
}
```

| Option | Default | Purpose |
| --- | --- | --- |
| `baseURL` | `https://api.commandcode.ai/provider/v1` | Gateway endpoint. Trailing slashes are stripped. |
| `providerID` | `CommandCode` | Provider ID. Must not contain `/` or `#`. |
| `displayName` | `CC` | Name shown in `/connect` and `/models`. |
| `modelsDevURL` | `https://models.dev/api.json` | Source for output limits and capabilities. Set to `""` to disable. |
| `defaultOutput` | `32000` | Output token limit when neither the gateway nor models.dev reports one. |
| `defaultContext` | `200000` | Context limit fallback when the gateway omits `context_length`. |
| `requestTimeout` | `15000` | `GET /models` timeout in milliseconds. Minimum `1000`. |
| `headers` | `{}` | Extra provider request headers. |
| `body` | `{}` | Extra provider request body fields. |
| `overrides` | `{}` | Per-model corrections, keyed by model ID. |
| `quarantineOnAuthFailure` | `true` | Hide models that answer 403. |

### Per-model overrides

```jsonc
{
  "plugins": [
    {
      "package": "github:simonln/ocplugin#main",
      "options": {
        "overrides": {
          "gpt-5.4-mini": { "output": 64000 },
          "zai-org/GLM-5.1": { "package": "@opencode/ai/providers/openai-compatible" },
          "claude-opus-4-8": { "enabled": false }
        }
      }
    }
  ]
}
```

Each override accepts `name`, `context`, `output`, `enabled`, and `package`.

## Known limitations

- models.dev lists 79 of the gateway's 86 models. The 8 it does not list fall back to
  `defaultOutput` and to the optimistic default capabilities, so one of them may reject an
  image with a 400. As of 2026-10-01 they are `deepseek/deepseek-v4-flash-fast`,
  `tencent/hy3-paid`, `thinkingmachines/inkling-small`, `stealth/space-bunny-alpha`,
  `stealth/pixel-canary`, `poolside/laguna-s-2.1-free`, and the two
  `inclusionai/ling-*:free` entries. Correct any of them with `overrides`.
- models.dev is downloaded once (5.3 MB) and reduced to just the fields the gateway's
  catalogue needs, then cached. It is downloaded again only when the gateway adds a model
  the cache does not cover. If models.dev is unreachable, enrichment is skipped and every
  model falls back to the defaults.
- The gateway's context length always wins over models.dev's, since it reflects what the
  gateway will actually accept. models.dev only supplies a context when the gateway omits one.
- The gateway reports no pricing, so costs are not shown.
- The catalogue's `created` timestamp is identical for every model, so it is not used as
  a release date and models cannot be sorted by date.
- Only API-key sign-in is supported.

## Development

```sh
npm install
npm test
npm run build
```
