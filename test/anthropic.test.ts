import { describe, expect, it } from "vitest"
import { rewriteCommandCodeMessages } from "../src/anthropic.js"

describe("rewriteCommandCodeMessages", () => {
  it("drops empty system markers and folds system text into a user turn", async () => {
    const request = new Request("https://example.test/v1/messages", {
      method: "POST",
      body: JSON.stringify({
        model: "claude-haiku-5-5",
        messages: [
          { role: "user", content: [{ type: "text", text: "first" }] },
          { role: "assistant", content: [{ type: "text", text: "answer" }] },
          { role: "system", content: [] },
          { role: "system", content: [{ type: "text", text: "updated" }] },
        ],
      }),
      headers: { "content-type": "application/json" },
    })

    const result = await rewriteCommandCodeMessages(request)
    expect(await result.json()).toMatchObject({
      messages: [
        { role: "user", content: [{ type: "text", text: "first" }] },
        { role: "assistant", content: [{ type: "text", text: "answer" }] },
        { role: "user", content: [{ type: "text", text: "updated" }] },
      ],
    })
  })

  it("merges a system update after a user turn", async () => {
    const request = new Request("https://example.test/v1/messages", {
      method: "POST",
      body: JSON.stringify({
        messages: [
          { role: "user", content: [{ type: "text", text: "first" }] },
          { role: "system", content: [{ type: "text", text: "updated" }] },
        ],
      }),
    })

    const result = await rewriteCommandCodeMessages(request)
    expect((await result.json() as { messages: unknown }).messages).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "first" },
          { type: "text", text: "updated" },
        ],
      },
    ])
  })

  it("does not rewrite requests without system messages", async () => {
    const request = new Request("https://example.test/v1/messages", {
      method: "POST",
      body: JSON.stringify({ messages: [{ role: "user", content: "hello" }] }),
    })
    expect(await rewriteCommandCodeMessages(request)).toBe(request)
  })

  it("does not rewrite chat completions requests", async () => {
    const request = new Request("https://example.test/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({ messages: [{ role: "system", content: "keep" }] }),
    })
    expect(await rewriteCommandCodeMessages(request)).toBe(request)
  })
})
