# opencode-mock-provider

A native **OpenCode V2** plugin that registers a zero-delay fake provider. It
answers instantly, in-process — no external network calls and no sleep by
default — so any wall-clock time between your prompt and the reply is **pure
framework overhead**. Compare the same prompt on a real provider to see how
much of the delay is network or model.

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

No login step is required. Then select `mock/instant` or `mock/echo` as the
session model.

## How it works

1. On `setup`, the plugin starts a tiny OpenAI-compatible HTTP endpoint bound
   to `127.0.0.1` on an ephemeral port. It streams the reply word-by-word as
   SSE chunks (`role` delta → content deltas → `finish_reason: "stop"` →
   `[DONE]`) with zero usage.
2. `ctx.provider.transform` registers the `mock` provider and its two models,
   pointing OpenCode's `openai-compatible` provider package at that local
   endpoint. Registration happens after the server is listening.
3. `ctx.event.subscribe` pairs `session.execution.started` with
   `session.execution.succeeded` and logs the measured **framework delay** for
   mock-provider sessions to stderr.
4. The reply logic (instant/echo/truncation, word splitting, abort-aware
   artificial delay, debug logging) lives in `src/mock.ts`, independent of the
   OpenCode plugin API.

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `OPENCODE_MOCK_DELAY_MS` | `0` | artificial delay per streamed token, to simulate a slow provider |
| `OPENCODE_MOCK_DEBUG` | — | `1` enables trace logging to stderr |

## Gaps / limitations

- **No pluggable model-call hook.** OpenCode V2's provider plugin API exposes
  provider *metadata* (`Provider.Info` with a `package` + settings), not a
  hook for the model call itself. The plugin preserves the intent — instant,
  in-process, zero-external-network replies — via a localhost endpoint
  instead. The endpoint is a real network hop, but only on loopback; the
  artificial delay is applied per token.
- **No fake login.** OpenCode handles provider auth through
  integrations/credentials, and plugins cannot register a provider login
  method. Since the mock endpoint needs no auth, the plugin embeds a dummy
  `apiKey`, so no login step exists.
- **Notification channel.** Server plugins cannot emit UI notifications, so the
  framework delay is written to stderr.
- **Tool capability.** Mock models advertise text-only output with tools
  disabled.

## Tests

`test/mock.test.ts` covers the reply/abort/config logic in `src/mock.ts`.
`test/server.test.ts` adds end-to-end checks of the local SSE endpoint.
Neither requires an OpenCode host.

```sh
bun test/mock.test.ts
bun test/server.test.ts
```
