/**
 * opencode-mock-provider — a zero-delay fake provider for OpenCode V2.
 *
 * Port of `pi-mock-provider`. It registers a `mock` provider with two models
 * (`mock/instant`, `mock/echo`) through `ctx.provider.transform`, and answers
 * in-process with no external network: a tiny OpenAI-compatible HTTP endpoint
 * bound to 127.0.0.1 backs the provider, so any wall-clock time between prompt
 * and reply is framework overhead rather than network/model latency.
 *
 * Models:
 *   mock/instant   replies "Mock reply." immediately
 *   mock/echo      echoes the last user message (truncated to 200 chars)
 *
 * Environment:
 *   PI_MOCK_DELAY_MS   optional artificial delay in ms per streamed token
 *   PI_MOCK_DEBUG=1    trace logging to stderr
 */

import { Model, Plugin, Provider } from "@opencode/plugin"
import { debugLog } from "./mock"
import { MOCK_MODELS, startMockServer } from "./server"

export default Plugin.define({
  id: "opencode-mock-provider",
  async setup(ctx) {
    const controller = new AbortController()

    // Start first: the provider's baseURL needs the ephemeral port.
    const server = await startMockServer(controller.signal)
    const address = server.address()
    const port = address && typeof address === "object" ? address.port : 0
    const baseURL = `http://127.0.0.1:${port}/v1`

    // Provider + model registration. In OpenCode V2 a provider is metadata
    // (Provider.Info: package + settings), not a function hook for the model
    // call; a pi-style `streamSimple` cannot be injected here. We point the
    // openai-compatible package at the in-process endpoint instead (README).
    await ctx.provider.transform((editor) => {
      editor.add({
        info: {
          ...Provider.Info.empty(Provider.ID.make("mock")),
          name: "Mock",
          activation: "enabled",
          package: "@opencode/ai/providers/openai-compatible",
          settings: { baseURL, apiKey: "mock-not-needed" },
          headers: {},
        },
        models: MOCK_MODELS.map((model) => ({
          ...Model.Info.default(Provider.ID.make("mock"), Model.ID.make(model.id)),
          name: model.name,
          cost: [{ input: 0, output: 0, cache: { read: 0, write: 0 } }],
          limit: { context: 1_000_000, input: 1_000_000, output: 4096 },
          capabilities: { tools: false, input: ["text"], output: ["text"], temperature: false },
        })),
      })
    })

    // Framework-delay reporting. pi's agent_start/message_end pair maps to
    // OpenCode's session execution events. The server plugin context has no UI
    // notify channel, so the measurement is logged to stderr.
    const startedAt = new Map<string, number>()
    const subscription = ctx.event.subscribe({
      types: ["session.execution.started", "session.execution.succeeded"],
      signal: controller.signal,
    })
    void (async () => {
      for await (const event of subscription) {
        const sessionID = (event as { data?: { sessionID?: string } }).data?.sessionID
        if (!sessionID) continue
        if (event.type === "session.execution.started") {
          startedAt.set(sessionID, Date.now())
          continue
        }
        const started = startedAt.get(sessionID)
        startedAt.delete(sessionID)
        if (started === undefined) continue
        try {
          const session = (await ctx.session.get({ sessionID })) as {
            model?: { providerID?: string }
          }
          if (session?.model?.providerID !== "mock") continue
        } catch {
          continue
        }
        console.error(`[opencode-mock] framework delay: ${Date.now() - started}ms`)
      }
    })()

    debugLog("loaded", { models: MOCK_MODELS.map((model) => model.id), baseURL })

    return () => {
      controller.abort()
      server.close()
    }
  },
})
