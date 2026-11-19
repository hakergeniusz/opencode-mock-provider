# opencode-mock-provider

A native **OpenCode V2** plugin (port of
[`pi-mock-provider`](https://github.com/hakergeniusz/pi-mock-provider)) that
registers a zero-delay fake provider. It answers instantly, in-process — no
external sockets, no HTTP to the outside world, no sleep by default — so any
wall-clock time between your prompt and the reply is **pure framework
overhead**. Compare the same prompt on a real provider to see how much of the
delay is network or model.

## Models

| Model | Behavior |
| --- | --- |
| `mock/instant` | replies `Mock reply.` immediately |
| `mock/echo` | echoes your last user message (truncated to 200 chars) |

## Install / load

Place the plugin under `.opencode/plugins/`, or reference it from
`opencode.json(c)`:

```jsonc
{
  "plugins": ["opencode-mock-provider"]
}
```

No login step is required (see [Gaps](#gaps)). Then select `mock/instant` or
`mock/echo` as the session model.

## How it works

1. On `setup`, the plugin starts a tiny OpenAI-compatible HTTP endpoint bound
   to `127.0.0.1` on an ephemeral port. It streams the reply word-by-word as
   SSE chunks (`role` delta → content deltas → `finish_reason: "stop"` →
   `[DONE]`) with zero usage — the OpenCode equivalent of the pi original's
   `start / text_start / text_delta / text_end / done` event stream.
2. `ctx.provider.transform` registers the `mock` provider and its two models,
   pointing OpenCode's `openai-compatible` provider package at that local
   endpoint. Registration happens after the server is listening.
3. `ctx.event.subscribe` pairs `session.execution.started` with
   `session.execution.succeeded` and logs the measured **framework delay**
   for mock-provider sessions to stderr.
4. The pi reply logic (instant/echo/truncation, word splitting, abort-aware
   artificial delay, debug logging) lives unchanged in `src/mock.ts`.

## Mapping from the pi original

| pi extension | OpenCode V2 plugin |
| --- | --- |
| `pi.registerProvider("mock", …)` | `ctx.provider.transform` → `editor.add({ info, models })` |
| custom `streamSimple` event stream | local in-process OpenAI-compatible SSE endpoint backing the registered `openai-compatible` provider |
| `oauth.login` / `/login mock` | not needed — dummy `apiKey` is embedded in provider settings |
| `pi.on("agent_start")` / `pi.on("message_end")` | `ctx.event.subscribe` on `session.execution.started` / `session.execution.succeeded` |
| `ctx.ui.notify(..., "info")` | `console.error` (server plugins have no UI notify channel) |
| `PI_MOCK_DELAY_MS`, `PI_MOCK_DEBUG` | unchanged |

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `PI_MOCK_DELAY_MS` | `0` | artificial delay per streamed token, to simulate a slow provider |
| `PI_MOCK_DEBUG` | — | `1` enables trace logging to stderr |

## Gaps / limitations

- **No injectable `streamSimple`.** OpenCode V2's provider plugin API exposes
  provider *metadata* (`Provider.Info` with a `package` + settings), not a
  function hook for the model call. A custom pi-style streaming function
  cannot be registered through `ctx.provider.transform`. The rewrite preserves
  the intent — instant, in-process, zero-external-network replies — via a
  localhost endpoint instead. The endpoint is a real network hop, but only on
  loopback; the artificial delay is applied per token, matching the original.
- **No fake OAuth login.** OpenCode handles provider auth through
  integrations/credentials, and plugins cannot register a provider login
  method. Since the mock endpoint needs no auth, the plugin embeds a dummy
  `apiKey`, so no login step exists. The fake credential fields from the
  original are intentionally dropped.
- **Notification channel.** The original showed a TUI toast via
  `ctx.ui.notify`. Server plugins cannot emit UI notifications, so the
  framework delay is written to stderr. A `./tui` part could surface a toast,
  but this plugin is not TUI-focused and no TUI part was added.
- **Tool capability.** Mock models advertise text-only output with tools
  disabled, mirroring the pi models' `reasoning: false`, `input: ["text"]`
  configuration.

## Tests

`test/mock.test.ts` ports the pi original's reply/abort/config assertions
against `src/mock.ts`. `test/server.test.ts` adds end-to-end checks of the
local SSE endpoint. Neither needs pi dependencies or an OpenCode host. Other
original tests (provider registration, OAuth, UI notification) depended on the
pi `ExtensionAPI` fake and cannot be ported without pi packages; they are
omitted.

```sh
bun test/mock.test.ts
bun test/server.test.ts
```
