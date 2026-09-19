import * as hsm from "../hsm.ts";
import { defineBotCritterElement, type BotCritterElement } from "../face/bot-critter.ts";
import { Chat, startChat, type ChatLine, type ChatTransport } from "./chat-machine.ts";

export const MOSFET_CHAT_TAG = "mosfet-chat";

const template = document.createElement("template");
template.innerHTML = `
  <style>
    :host {
      --accent: var(--chat-accent, #3ee0a8);
      --ink: var(--chat-ink, #eef0f4);
      --muted: var(--chat-muted, #8f96a6);
      --panel: var(--chat-panel, #15171c);
      --line: var(--chat-line, #2a2d35);
      display: grid; grid-template-rows: auto 1fr auto; gap: 1rem;
      block-size: 100%; min-block-size: 0; color: var(--ink);
      font: 15px/1.5 var(--chat-sans, system-ui, sans-serif);
    }
    header { display: flex; align-items: center; gap: 1rem; }
    bot-critter { inline-size: 7rem; block-size: 6rem; flex: none; }
    .who b { display: block; font-size: 18px; }
    .who span { color: var(--muted); font-size: 13px; }
    .status::before { content: ""; display: inline-block; inline-size: .5rem; block-size: .5rem; border-radius: 50%; margin-inline-end: .4rem; background: var(--muted); vertical-align: middle; }
    :host([data-state="ready"]) .status::before { background: var(--accent); }
    :host([data-state="thinking"]) .status::before { background: #f5c46b; animation: pulse 1s infinite; }
    :host([data-state="unconfigured"]) .status::before { background: #f5836b; }
    @keyframes pulse { 50% { opacity: .3; } }
    ol { list-style: none; margin: 0; padding: .25rem; display: grid; gap: .6rem; align-content: start; overflow-y: auto; min-block-size: 0; }
    li { max-inline-size: 78%; padding: .6rem .85rem; border-radius: 16px; white-space: pre-wrap; overflow-wrap: anywhere; animation: in .2s ease-out; }
    @keyframes in { from { opacity: 0; transform: translateY(4px); } }
    li[data-who="you"] { justify-self: end; background: var(--accent); color: #062a20; border-end-end-radius: 4px; }
    li[data-who="mosfet"] { justify-self: start; background: var(--panel); border: 1px solid var(--line); border-end-start-radius: 4px; }
    li[data-who="note"] { justify-self: center; max-inline-size: 90%; color: #f5b09b; font-size: 13px; text-align: center; background: none; padding: .2rem; }
    li.typing { color: var(--muted); }
    li.typing span { animation: pulse 1s infinite; }
    li.typing span:nth-child(2) { animation-delay: .15s; }
    li.typing span:nth-child(3) { animation-delay: .3s; }
    .banner { color: var(--muted); font-size: 13px; padding: .6rem .8rem; border: 1px dashed var(--line); border-radius: 12px; }
    .banner code { color: var(--ink); }
    form { display: flex; gap: .5rem; }
    input { flex: 1; min-inline-size: 0; font: inherit; color: inherit; background: var(--panel); border: 1px solid var(--line); border-radius: 999px; padding: .75rem 1rem; }
    input:focus-visible, button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    button { font: inherit; font-weight: 650; border: 0; border-radius: 999px; padding: .75rem 1.2rem; background: var(--accent); color: #062a20; cursor: pointer; }
    button:disabled, input:disabled { opacity: .45; cursor: default; }
    [hidden] { display: none !important; }
  </style>
  <header>
    <bot-critter expression="sleepy" track ink="#3ee0a8" eye="#15171c"></bot-critter>
    <div class="who"><b>mosfet</b><span class="status"></span></div>
  </header>
  <ol aria-live="polite"></ol>
  <div>
    <p class="banner" hidden></p>
    <form>
      <input name="text" autocomplete="off" placeholder="say something to mosfet" />
      <button type="submit">Send</button>
    </form>
  </div>
`;

/**
 * Chat with mosfet, as a custom element that is an HSM host.
 *
 * Presentation only: it starts a `Chat` under its own context, turns the form into a typed event, and redraws on
 * every change. Its own topology is the input's: `composing` while you can type, `waiting` while mosfet is thinking or
 * unreachable, so "can I send" is the host's state path.
 *
 *     <mosfet-chat></mosfet-chat>
 */
export class MosfetChatElement extends hsm.from(HTMLElement) {
  static readonly model = hsm.define(
    "MosfetChat",
    hsm.initial(hsm.target("waiting")),
    hsm.state(
      "waiting",
      hsm.entry(MosfetChatElement.lockInput),
      hsm.transition(hsm.on(Chat.changedEvent.name), hsm.guard(MosfetChatElement.chatReady), hsm.target("../composing")),
      hsm.transition(hsm.on(Chat.changedEvent.name), hsm.effect(MosfetChatElement.redraw)),
    ),
    hsm.state(
      "composing",
      hsm.entry(MosfetChatElement.unlockInput),
      hsm.transition(hsm.on(Chat.changedEvent.name), hsm.guard(MosfetChatElement.chatBusy), hsm.target("../waiting")),
      hsm.transition(hsm.on(Chat.changedEvent.name), hsm.effect(MosfetChatElement.redraw)),
    ),
  );

  /** Swap the transport before connecting (tests, or a transport other than the HTTP workshop). */
  transport: ChatTransport | undefined;
  #root: ShadowRoot;
  #chat: Chat | null = null;
  #frame = 0;
  #shown = -1;

  constructor() {
    super();
    this.#root = this.attachShadow({ mode: "open" });
  }

  connectedCallback(): void {
    if (this.#root.childElementCount === 0) {
      defineBotCritterElement();
      this.#root.append(template.content.cloneNode(true));
      const submit = (): void => {
        const input = this.#q<HTMLInputElement>("input");
        const text = input.value;
        if (input.disabled || text.trim() === "") return;
        input.value = "";
        this.#send(text);
      };
      this.#q("form").addEventListener("submit", (event) => {
        event.preventDefault();
        submit();
      });
      // Enter sends even where implicit form submission does not fire (some embedded browsers).
      this.#q("input").addEventListener("keydown", (event) => {
        if (event.key !== "Enter" || event.isComposing) return;
        event.preventDefault();
        submit();
      });
    }
    hsm.ensureStarted({ instance: this, model: MosfetChatElement.model });
    // Closing or leaving the page ends this chat's mosfet, not just removing the element.
    window.addEventListener("pagehide", this.#endChat);
    this.#chat = startChat({ ctx: this.context(), ...(this.transport ? { transport: this.transport } : {}) });
  }

  disconnectedCallback(): void {
    if (this.#frame !== 0) cancelAnimationFrame(this.#frame);
    this.#frame = 0;
    window.removeEventListener("pagehide", this.#endChat);
    this.#endChat();
  }

  readonly #endChat = (): void => {
    const chat = this.#chat;
    this.#chat = null;
    if (chat !== null) void hsm.stop(chat).catch(hsm.catchFailure(this));
  };

  /** Send a message as if typed. */
  say(text: string): void {
    this.#send(text);
  }

  /** Chat state path, for tests and the inspector. */
  chatState(): string {
    return this.#chat?.state() ?? "/Chat/unstarted";
  }

  static chatReady(_ctx: hsm.Context, _instance: hsm.Instance, event: hsm.Event): boolean {
    return hsm.isRecord(event.data) && event.data["ready"] === true;
  }

  static chatBusy(ctx: hsm.Context, instance: hsm.Instance, event: hsm.Event): boolean {
    return !MosfetChatElement.chatReady(ctx, instance, event);
  }

  static lockInput(_ctx: hsm.Context, instance: hsm.Instance): void {
    if (instance instanceof MosfetChatElement) instance.#setInput(false);
  }

  static unlockInput(_ctx: hsm.Context, instance: hsm.Instance): void {
    if (!(instance instanceof MosfetChatElement)) return;
    instance.#setInput(true);
    instance.#q<HTMLInputElement>("input").focus();
  }

  static redraw(_ctx: hsm.Context, instance: hsm.Instance): void {
    if (instance instanceof MosfetChatElement) instance.#schedule();
  }

  #send(text: string): void {
    const chat = this.#chat;
    if (chat === null) return;
    void Promise.resolve(hsm.dispatch(chat, hsm.typedEvent({ event: Chat.sendEvent, data: { text } }))).catch(
      hsm.catchFailure(this),
    );
  }

  #setInput(enabled: boolean): void {
    this.#q<HTMLInputElement>("input").disabled = !enabled;
    this.#q<HTMLButtonElement>("button").disabled = !enabled;
    this.#schedule();
  }

  #schedule(): void {
    if (this.#frame !== 0 || !this.isConnected) return;
    this.#frame = requestAnimationFrame(() => {
      this.#frame = 0;
      this.#render();
    });
  }

  #render(): void {
    const chat = this.#chat;
    if (chat === null) return;
    const state = chat.state().split("/").pop() ?? "";
    this.dataset["state"] = state;
    this.#q<BotCritterElement>("bot-critter").express(chat.expression);
    this.#q(".status").textContent = statusText(state, chat.model);

    const banner = this.#q(".banner");
    banner.hidden = !(state === "offline" || state === "unconfigured");
    banner.replaceChildren(...bannerContent(state, chat.problem));

    const list = this.#q("ol");
    const lines = chat.lines;
    const thinking = state === "thinking";
    const key = lines.length * 2 + (thinking ? 1 : 0);
    if (key !== this.#shown) {
      this.#shown = key;
      list.replaceChildren(...lines.map(lineItem), ...(thinking ? [typingItem()] : []));
      list.scrollTop = list.scrollHeight;
    }
  }

  #q<T extends Element = HTMLElement>(selector: string): T {
    const found = this.#root.querySelector<T>(selector);
    if (found === null) throw new Error(`mosfet-chat: template is missing ${selector}`);
    return found;
  }
}

function statusText(state: string, model: string | null): string {
  switch (state) {
    case "ready":
      return model ? `online · ${model}` : "online";
    case "thinking":
      return "thinking…";
    case "unconfigured":
      return "needs an API key";
    case "offline":
      return "workshop not running";
    case "opening":
      return "starting a mosfet…";
    default:
      return "connecting…";
  }
}

function bannerContent(state: string, problem: string | null): Node[] {
  if (state === "offline") {
    const code = document.createElement("code");
    code.textContent = "uv run --project workshop workshop/server.py";
    return [document.createTextNode("Start the workshop: "), code, document.createTextNode(" (retrying every few seconds)")];
  }
  if (state === "unconfigured") return [document.createTextNode(`${problem ?? "No API key."} (retrying every few seconds)`)];
  return [];
}

function lineItem(line: ChatLine): HTMLLIElement {
  const item = document.createElement("li");
  item.dataset["who"] = line.who;
  item.textContent = line.text;
  return item;
}

function typingItem(): HTMLLIElement {
  const item = document.createElement("li");
  item.dataset["who"] = "mosfet";
  item.className = "typing";
  for (let i = 0; i < 3; i += 1) {
    const dot = document.createElement("span");
    dot.textContent = "●";
    item.append(dot);
  }
  return item;
}

export function defineMosfetChatElement(): void {
  if (!customElements.get(MOSFET_CHAT_TAG)) customElements.define(MOSFET_CHAT_TAG, MosfetChatElement);
}

declare global {
  interface HTMLElementTagNameMap {
    "mosfet-chat": MosfetChatElement;
  }
}
