/**
 * Local in-process OpenAI-compatible endpoint backing the mock provider.
 * Depends only on Node built-ins and `./mock` (no OpenCode SDK), so the wire
 * behavior can be tested without an OpenCode host.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { artificialDelayMs, debugLog, mockReplyFor, openAIUsage, sleep, splitWords } from "./mock"

export const MOCK_MODELS = [
  { id: "instant", name: "Mock Instant (0ms)" },
  { id: "echo", name: "Mock Echo (0ms, echoes prompt)" },
]

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer))
  }
  return Buffer.concat(chunks).toString("utf8")
}

function modelIdFromRequest(body: { model?: unknown }): string {
  const raw = typeof body.model === "string" ? body.model : "instant"
  const last = raw.split("/").at(-1) || "instant"
  return MOCK_MODELS.some((model) => model.id === last) ? last : "instant"
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  })
  res.end(body)
}

async function handleChat(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body: { model?: unknown; messages?: unknown; stream?: unknown }
  try {
    body = JSON.parse(await readBody(req))
  } catch {
    sendJson(res, 400, { error: { message: "invalid JSON body" } })
    return
  }

  const modelId = modelIdFromRequest(body)
  const reply = mockReplyFor(modelId, body.messages)
  const completionId = `mock-${Date.now()}`
  const created = Math.floor(Date.now() / 1000)
  const debug = (event: string) => debugLog(event, { model: modelId, stream: body.stream === true })

  if (body.stream !== true) {
    debug("nonstream")
    sendJson(res, 200, {
      id: completionId,
      object: "chat.completion",
      created,
      model: modelId,
      choices: [
        { index: 0, message: { role: "assistant", content: reply }, finish_reason: "stop" },
      ],
      usage: openAIUsage(),
    })
    return
  }

  debug("stream")
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  })

  const controller = new AbortController()
  res.once("close", () => controller.abort())

  const chunk = (delta: Record<string, unknown>, finishReason: string | null = null, withUsage = false) => {
    const payload: Record<string, unknown> = {
      id: completionId,
      object: "chat.completion.chunk",
      created,
      model: modelId,
      choices: [{ index: 0, delta, finish_reason: finishReason }],
    }
    if (withUsage) payload.usage = openAIUsage()
    res.write(`data: ${JSON.stringify(payload)}\n\n`)
    debugLog("chunk", { type: finishReason ?? "delta" })
  }

  try {
    // Mirrors the pi event stream: start -> text_start -> text_delta* -> text_end -> done.
    chunk({ role: "assistant", content: "" })
    for (const word of splitWords(reply)) {
      if (controller.signal.aborted) break
      const delay = artificialDelayMs()
      if (delay > 0) await sleep(delay, controller.signal)
      chunk({ content: word })
    }
    if (!controller.signal.aborted) {
      chunk({}, "stop", true)
      res.write("data: [DONE]\n\n")
    }
  } catch {
    // Aborted mid-stream (client disconnected) — close cleanly.
    debug("aborted")
  } finally {
    res.end()
  }
}

export async function startMockServer(signal: AbortSignal): Promise<Server> {
  const server = createServer((req, res) => {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: { message: "method not allowed" } })
      return
    }
    void handleChat(req, res).catch((error: unknown) => {
      debugLog("server-error", { message: String(error) })
      if (!res.headersSent) sendJson(res, 500, { error: { message: "mock provider error" } })
      else res.end()
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject)
      resolve()
    })
  })
  signal.addEventListener("abort", () => server.close(), { once: true })
  return server
}
