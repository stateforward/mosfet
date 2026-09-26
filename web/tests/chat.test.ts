import "./dom.ts";
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import * as hsm from "../src/hsm.ts";
import { Chat, startChat, type ChatTransport } from "../src/playground/chat-machine.ts";

Chat.recheckMs = 5;

async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 400; i += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 1));
  }
  throw new Error(`timed out waiting for ${what}`);
}

const ended: string[] = [];

function transport(overrides: Partial<ChatTransport> = {}): ChatTransport {
  let next = 0;
  return {
    health: async () => ({ ready: true, model: "test-model", problem: null }),
    open: async () => ({ session: `s${(next += 1)}`, problem: null }),
    send: async (_session, text) => ({ reply: `you said: ${text}`, problem: null }),
    end: (session) => void ended.push(session),
    ...overrides,
  };
}

const send = (chat: Chat, text: string) =>
  Promise.resolve(hsm.dispatch(chat, hsm.typedEvent({ event: Chat.sendEvent, data: { text } })));

describe("Chat", () => {
  test("connects silently and turns a message into a reply", async () => {
    const chat = startChat({ ctx: new hsm.Context(), transport: transport() });
    try {
      await waitFor(() => /\/ready$/.test(chat.state()), "ready");
      assert.equal(chat.model, "test-model");
      assert.deepEqual(chat.lines, [], "mosfet says nothing canned");
      await send(chat, "   ");
      assert.match(chat.state(), /\/ready$/, "blank messages are ignored");
      await send(chat, "hello");
      await waitFor(() => chat.lines.at(-1)?.text === "you said: hello", "reply");
      assert.deepEqual(chat.lines.slice(-2), [
        { who: "you", text: "hello" },
        { who: "mosfet", text: "you said: hello" },
      ]);
      assert.match(chat.state(), /\/ready$/);
      assert.equal(chat.expression, "happy");
    } finally {
      await hsm.stop(chat);
    }
  });

  test("a missing key is unconfigured, and a key added later is picked up without a reload", async () => {
    let ready = false;
    const chat = startChat({
      ctx: new hsm.Context(),
      transport: transport({ health: async () => ({ ready, model: "m", problem: ready ? null : "No API key." }) }),
    });
    try {
      await waitFor(() => /\/unconfigured$/.test(chat.state()), "unconfigured");
      assert.equal(chat.problem, "No API key.");
      ready = true;
      await waitFor(() => /\/ready$/.test(chat.state()), "ready after the key appears");
    } finally {
      await hsm.stop(chat);
    }
  });

  test("each chat opens its own mosfet session, and stopping the chat ends it", async () => {
    const sent: Array<[string, string]> = [];
    const chat = startChat({
      ctx: new hsm.Context(),
      transport: transport({ send: async (session, text) => (sent.push([session, text]), { reply: "ok", problem: null }) }),
    });
    await waitFor(() => /\/session\/ready$/.test(chat.state()), "ready");
    const session = chat.session;
    assert.ok(session);
    await send(chat, "hi");
    await waitFor(() => sent.length === 1, "sent");
    assert.deepEqual(sent[0], [session, "hi"]);
    await hsm.stop(chat);
    assert.ok(ended.includes(session), "stopping the chat ends its mosfet");
  });

  test("a mosfet that ended is replaced by a fresh session, and the chat says so", async () => {
    let calls = 0;
    const chat = startChat({
      ctx: new hsm.Context(),
      transport: transport({
        send: async () => ((calls += 1) === 1 ? { reply: null, problem: "ended", ended: true } : { reply: "hello again", problem: null }),
      }),
    });
    try {
      await waitFor(() => /\/ready$/.test(chat.state()), "ready");
      const first = chat.session;
      await send(chat, "hi");
      await waitFor(() => /\/ready$/.test(chat.state()) && chat.session !== first, "a new session");
      assert.match(chat.lines.at(-1)?.text ?? "", /ended/);
    } finally {
      await hsm.stop(chat);
    }
  });

  test("an unreachable workshop is offline, and a failed exchange says why instead of replying", async () => {
    const down = startChat({ ctx: new hsm.Context(), transport: transport({ health: async () => { throw new Error("refused"); } }) });
    try {
      await waitFor(() => /\/offline$/.test(down.state()), "offline");
    } finally {
      await hsm.stop(down);
    }
    const chat = startChat({ ctx: new hsm.Context(), transport: transport({ send: async () => ({ reply: null, problem: "model failed" }) }) });
    try {
      await waitFor(() => /\/ready$/.test(chat.state()), "ready");
      await send(chat, "hi");
      await waitFor(() => chat.lines.at(-1)?.who === "note", "a note");
      assert.equal(chat.lines.at(-1)?.text, "model failed");
      assert.equal(chat.expression, "worried");
      assert.match(chat.state(), /\/ready$/, "you can try again");
    } finally {
      await hsm.stop(chat);
    }
  });
});
