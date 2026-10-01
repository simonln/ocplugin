# opencode-cm-provider

An [OpenCode](https://opencode.ai) V2 plugin that registers the Command Code gateway
(`https://api.commandcode.ai/provider/v1`) as a provider, discovers its model catalogue
automatically, and keeps the API key in OpenCode's credential store instead of
`opencode.jsonc`.

## What it does

- Registers the provider (default ID `CommandCode`) and pulls the model list from `GET {baseURL}/models` on
  startup, every 10 minutes, and whenever a credential changes.
- Routes each model to the correct runtime from the gateway's `supported_endpoints`:
  `/responses` models use the OpenAI Responses runtime, chat-only models use the OpenAI
  chat runtime, and the Anthropic-native Claude models use the Anthropic runtime.
- Reads `context_length` per model, so context limits never need hand-tuning.
- Stores the API key via `/connect` in OpenCode's credential store.
- Hides models the account is not entitled to. The catalogue does not report
  entitlements, so a model that answers 403 is quarantined after its first failure
  and disappears from `/models`.
- Keeps the last good catalogue when the gateway is temporarily unreachable.

## Install

Add the plugin to your OpenCode configuration:

```jsonc title="opencode.jsonc"
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["file:///D:/code/repos/ocplugin"],
}
```

Then restart the service and connect:

```sh
opencode service restart
```

In the TUI, run `/connect`, choose **Command Code**, and paste your API key. The
catalogue appears in `/models` without a restart.

Remove any hand-written `providers.cm` block from `opencode.jsonc` first — this plugin
owns that provider ID.

## Options

Pass options through the object form of the `plugins` entry:

```jsonc title="opencode.jsonc"
{
  "plugins": [
    {
      "package": "file:///D:/code/repos/ocplugin",
      "options": {
        "refreshInterval": 600000,
      },
    },
  ],
}
```

| Option | Default | Purpose |
| --- | --- | --- |
| `baseURL` | `https://api.commandcode.ai/provider/v1` | Gateway endpoint. Trailing slashes are stripped. |
| `providerID` | `CommandCode` | Provider ID. Must not contain `/` or `#`. |
| `displayName` | `Command Code` | Name shown in `/connect` and `/models`. |
| `refreshInterval` | `600000` | Catalog refresh in milliseconds. Minimum `10000`. |
| `defaultOutput` | `32000` | Output token limit, since the gateway does not report one. |
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
      "package": "file:///D:/code/repos/ocplugin",
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

- The gateway does not report output token limits, so every model defaults to
  `defaultOutput` (32000). Raise it per model with `overrides`.
- The gateway does not report capabilities, so every model is advertised as accepting
  text and images with tool support. Sending an image to a text-only model fails with a
  400 from the gateway; correct it with `overrides`.
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
