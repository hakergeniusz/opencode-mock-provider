/**
 * End-to-end checks for the local OpenAI-compatible endpoint. No OpenCode host
 * and no pi packages are needed. `bun test/server.test.ts`
 */
import assert from "node:assert/strict"
import type { AddressInfo } from "node:net"
import { startMockServer } from "../src/server"

delete process.env.PI_MOCK_DELAY_MS

const controller = new AbortController()
const server = await startMockServer(controller.signal)
const { port } = server.address() as AddressInfo
const url = `http://127.0.0.1:${port}/v1/chat/completions`

let passed = 0
function check(name: string, fn: () => void): void {
  fn()
  passed++
  console.log(`ok   ${name}`)
}

async function post(body: unknown): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Connection: "close" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  })
}

type Chunk = {
  choices?: Array<{ delta?: { role?: string; content?: string }; finish_reason?: string | null }>
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
}

async function sse(body: unknown): Promise<{ chunks: Chunk[]; done: boolean; text: string }> {
  const response = await post(body)
  assert.equal(response.status, 200)
  assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/)
  const text = await response.text()
  const chunks: Chunk[] = []
  let done = false
  for (const line of text.split("\n")) {
    if (!line.startsWith("data: ")) continue
    const data = line.slice(6)
    if (data === "[DONE]") {
      done = true
      continue
    }
    chunks.push(JSON.parse(data) as Chunk)
  }
  return { chunks, done, text }
}

const textOf = (chunks: Chunk[]) =>
  chunks.flatMap((c) => c.choices ?? []).map((c) => c.delta?.content ?? "").join("")

// --- streaming ----------------------------------------------------------------

const instant = await sse({
  model: "mock/instant",
  messages: [{ role: "user", content: "hi" }],
  stream: true,
})
check("stream starts with an assistant role chunk", () => {
  assert.equal(instant.chunks[0]?.choices?.[0]?.delta?.role, "assistant")
})
check("stream emits word deltas that reconstruct the reply", () => {
  assert.equal(textOf(instant.chunks), "Mock reply.")
})
check("stream ends with a stop chunk, zero usage and [DONE]", () => {
  const last = instant.chunks.at(-1)
  assert.equal(last?.choices?.[0]?.finish_reason, "stop")
  assert.deepEqual(last?.usage, { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 })
  assert.equal(instant.done, true)
})

const echoed = await sse({
  model: "echo",
  messages: [{ role: "user", content: "hello world" }],
  stream: true,
})
check("echo model streams the last user message", () => {
  assert.equal(textOf(echoed.chunks), "hello world")
})

const long = "x".repeat(300)
const truncated = await sse({ model: "echo", messages: [{ role: "user", content: long }], stream: true })
check("echo truncates to 200 chars with ellipsis on the wire", () => {
  assert.equal(textOf(truncated.chunks), "x".repeat(200) + "…")
})

// --- non-stream and errors ----------------------------------------------------

const nonstream = await post({ model: "instant", messages: [{ role: "user", content: "hi" }] })
const nonstreamJson = (await nonstream.json()) as {
  object: string
  choices: Array<{ message: { role: string; content: string } }>
  usage: Record<string, number>
}
check("non-stream replies with a chat.completion and zero usage", () => {
  assert.equal(nonstream.status, 200)
  assert.equal(nonstreamJson.object, "chat.completion")
  assert.equal(nonstreamJson.choices[0]?.message.content, "Mock reply.")
  assert.deepEqual(nonstreamJson.usage, { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 })
})

const bad = await post("{not json")
const get = await fetch(url, { headers: { Connection: "close" } })
check("invalid JSON is a 400 and GET is a 405", () => {
  assert.equal(bad.status, 400)
  assert.equal(get.status, 405)
})

controller.abort()
console.log(`\n${passed} passed, 0 failed`)
