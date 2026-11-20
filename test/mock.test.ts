/**
 * Tests for the mock reply logic in `src/mock.ts`; they need no OpenCode host.
 *
 *   bun test/mock.test.ts
 */
import assert from "node:assert/strict"
import {
  artificialDelayMs,
  debugLog,
  lastUserText,
  mockReplyFor,
  openAIUsage,
  sleep,
  splitWords,
  zeroUsage,
} from "../src/mock"

let passed = 0
function check(name: string, fn: () => void): void {
  fn()
  passed++
  console.log(`ok   ${name}`)
}

const contextWithUser = (content: unknown) => [{ role: "user", content }]
const textOf = (reply: string) => splitWords(reply).join("")

// --- reply logic -------------------------------------------------------------

check("instant replies 'Mock reply.'", () => {
  assert.equal(mockReplyFor("instant", contextWithUser("hi")), "Mock reply.")
})

check("unknown model id behaves as instant", () => {
  assert.equal(mockReplyFor("anything", contextWithUser("hi")), "Mock reply.")
})

check("echo returns the last user message", () => {
  assert.equal(mockReplyFor("echo", contextWithUser("hello world")), "hello world")
})

check("echo flattens array text blocks, ignoring non-text parts", () => {
  const messages = contextWithUser([
    { type: "text", text: "a" },
    { type: "image", data: "x" },
    { type: "text", text: "b" },
  ])
  assert.equal(mockReplyFor("echo", messages), "a b")
})

check("echo truncates to 200 chars with ellipsis", () => {
  const long = "x".repeat(300)
  assert.equal(mockReplyFor("echo", contextWithUser(long)), "x".repeat(200) + "…")
})

check("echo falls back with no user message", () => {
  assert.equal(mockReplyFor("echo", [{ role: "assistant", content: "nope" }]), "(no user message found)")
})

check("lastUserText picks the most recent user message", () => {
  assert.equal(
    lastUserText([
      { role: "user", content: "old" },
      { role: "assistant", content: "reply" },
      { role: "user", content: "new" },
    ]),
    "new",
  )
})

check("splitWords produces word-shaped deltas that reconstruct the reply", () => {
  const reply = "Mock reply."
  assert.deepEqual(splitWords(reply), ["Mock", " ", "reply."])
  assert.equal(textOf(reply), reply)
  assert.ok(splitWords(reply).every((word) => word.length > 0))
})

// --- usage -------------------------------------------------------------------

check("zero usage shapes are all zero", () => {
  const usage = zeroUsage()
  assert.equal(usage.totalTokens, 0)
  assert.equal(usage.cost.total, 0)
  assert.deepEqual(openAIUsage(), { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 })
})

// --- config / abort ----------------------------------------------------------

check("artificialDelayMs defaults to 0 and ignores bad values", () => {
  delete process.env.OPENCODE_MOCK_DELAY_MS
  assert.equal(artificialDelayMs(), 0)
  process.env.OPENCODE_MOCK_DELAY_MS = "not-a-number"
  assert.equal(artificialDelayMs(), 0)
  process.env.OPENCODE_MOCK_DELAY_MS = "-5"
  assert.equal(artificialDelayMs(), 0)
  process.env.OPENCODE_MOCK_DELAY_MS = "25"
  assert.equal(artificialDelayMs(), 25)
  delete process.env.OPENCODE_MOCK_DELAY_MS
})

check("debugLog is a no-op unless enabled and never throws", () => {
  delete process.env.OPENCODE_MOCK_DEBUG
  assert.doesNotThrow(() => debugLog("noop", { a: 1 }))
  process.env.OPENCODE_MOCK_DEBUG = "1"
  assert.doesNotThrow(() => debugLog("enabled", { a: 1 }))
  delete process.env.OPENCODE_MOCK_DEBUG
})

await sleep(1)
const controller = new AbortController()
controller.abort()
await assert.rejects(() => sleep(50, controller.signal), /Aborted/)
passed++
console.log("ok   sleep resolves normally and rejects on abort")

console.log(`\n${passed} passed, 0 failed`)
