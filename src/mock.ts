/**
 * Framework-agnostic helpers for the mock provider.
 *
 * Kept free of `@opencode/plugin` imports so the reply logic can be exercised
 * on its own — see `test/mock.test.ts`.
 *
 * Environment:
 *   OPENCODE_MOCK_DELAY_MS  artificial delay in ms (default 0)
 *   OPENCODE_MOCK_DEBUG=1   trace logging to stderr
 */

/** Trace logging. Must never break the provider. */
export function debugLog(event: string, data: Record<string, unknown> = {}): void {
  if (process.env.OPENCODE_MOCK_DEBUG !== "1") return
  try {
    console.error("[opencode-mock] " + JSON.stringify({ event, ...data }))
  } catch {
    // ignore
  }
}

/** Optional artificial delay, used to simulate a slow provider. */
export function artificialDelayMs(): number {
  const raw = Number(process.env.OPENCODE_MOCK_DELAY_MS)
  return Number.isFinite(raw) && raw > 0 ? raw : 0
}

/** Cancellable sleep — an abort rejects so callers can stop mid-stream. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Aborted"))
      return
    }
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer)
        reject(new Error("Aborted"))
      },
      { once: true },
    )
  })
}

/** Zero-usage shape, preserved for parity/reference. */
export function zeroUsage() {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  }
}

/** OpenAI-compatible usage shape used on the wire by the local mock server. */
export function openAIUsage() {
  return { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
}

type TextPart = { type: "text"; text: string }

/**
 * Flatten the last user message of an OpenAI-style `messages` array to text.
 * Accepts both string content and arrays of content parts (text parts only).
 */
export function lastUserText(messages: unknown): string {
  const list = Array.isArray(messages) ? messages : []
  for (let i = list.length - 1; i >= 0; i--) {
    const message = list[i] as { role?: string; content?: unknown }
    if (message?.role !== "user") continue
    const content = message.content
    if (typeof content === "string") return content
    if (Array.isArray(content)) {
      return content
        .filter((block) => (block as TextPart)?.type === "text")
        .map((block) => (block as TextPart).text)
        .join(" ")
        .trim()
    }
  }
  return "(no user message found)"
}

/** Reply for a mock model id: `echo` echoes the prompt, everything else is instant. */
export function mockReplyFor(modelId: string, messages: unknown): string {
  if (modelId === "echo") {
    const text = lastUserText(messages)
    return text.length > 200 ? `${text.slice(0, 200)}…` : text
  }
  return "Mock reply."
}

/** Split a reply into word/whitespace tokens (exercises the delta path). */
export function splitWords(reply: string): string[] {
  return reply.split(/(\s+)/u).filter((word) => word.length > 0)
}
