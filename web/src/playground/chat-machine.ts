import * as hsm from "../hsm.ts";
import { type ExpressionName } from "../face/presets.ts";

export type ChatSpeaker = "you" | "mosfet" | "note";

export type ChatLine = { readonly who: ChatSpeaker; readonly text: string };

/** What the workshop answers: a reply, or the reason there is none. */
export type BridgeReply = { readonly reply: string | null; readonly problem: string | null };
export type BridgeHealth = { readonly ready: boolean; readonly model: string | null; readonly problem: string | null };
/** A new session: its own mosfet in the workshop, or the reason there is none. */
export type BridgeSession = { readonly session: string | null; readonly problem: string | null };

/** How the chat reaches the library. Injected so tests and other transports can stand in for HTTP. */
export type ChatTransport = {
  health(): Promise<BridgeHealth>;
  /** Start this chat's own mosfet. */
  open(): Promise<BridgeSession>;
  /** `ended` is true when the session's mosfet is gone and a new one is needed. */
  send(session: string, text: string): Promise<BridgeReply & { readonly ended?: boolean }>;
  /** Stop this chat's mosfet. Best effort: it must also work while the page is unloading. */
  end(session: string): void;
};

/** The workshop (`workshop/`), reached through the dev server's `/api` proxy. */
export const httpTransport: ChatTransport = {
  async health() {
    const response = await fetch("/api/health");
    if (!response.ok) throw new Error(`workshop answered ${response.status}`);
    return (await response.json()) as BridgeHealth;
  },
  async open() {
    const response = await fetch("/api/session", { method: "POST" });
    const body = (await response.json()) as BridgeSession;
    return { session: body.session ?? null, problem: body.problem ?? (response.ok ? null : `workshop answered ${response.status}`) };
  },
  async send(session: string, text: string) {
    const response = await fetch("/api/sms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session, text }),
    });
    const body = (await response.json()) as BridgeReply;
    return {
      reply: body.reply ?? null,
      problem: body.problem ?? (response.ok ? null : `workshop answered ${response.status}`),
      ended: response.status === 404,
    };
  },
  end(session: string) {
    // sendBeacon survives the page closing, which is exactly when a session usually ends.
    const url = `/api/session/${session}/end`;
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function" && navigator.sendBeacon(url)) return;
    void fetch(url, { method: "POST", keepalive: true }).catch(() => undefined);
  },
};

/**
 * Talk to a bot the workshop builder already booted. The builder owns that bot's lifetime, so opening a session is
 * just naming it and ending one leaves the bot running.
 */
export function botTransport(bot: string): ChatTransport {
  return {
    health: httpTransport.health,
    async open() {
      return { session: bot, problem: null };
    },
    async send(session: string, text: string) {
      const response = await fetch("/api/builder/interact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bot: session, text }),
      });
      const body = (await response.json()) as BridgeReply;
      return {
        reply: body.reply ?? null,
        problem: body.problem ?? (response.ok ? null : `workshop answered ${response.status}`),
        ended: response.status === 404,
      };
    },
    end() {},
  };
}

const recheckDelay = (): number => Chat.recheckMs;

/**
 * A conversation with mosfet through the library.
 *
 * `connecting` asks the workshop whether it can reach a model. `offline` (workshop not running) and `unconfigured`
 * (running, but no API key) retry on a modeled timer, so starting the workshop or adding a key is picked up without a
 * reload. `ready` waits for you; `thinking` is one exchange in flight, and a reply or a problem both land back in
 * `ready`. "Is it waiting on the model" is the state path, never a flag. The machine owns the transcript and the
 * bot's expression; the element only draws them.
 */
export class Chat extends hsm.Instance {
  static readonly sendEvent = { name: "chat.send", kind: hsm.Kinds.Event } as const;
  static readonly repliedEvent = { name: "chat.replied", kind: hsm.Kinds.Event } as const;
  static readonly healthEvent = { name: "chat.health", kind: hsm.Kinds.Event } as const;
  static readonly openedEvent = { name: "chat.opened", kind: hsm.Kinds.Event } as const;
  static readonly changedEvent = { name: "chat.changed", kind: hsm.Kinds.Event } as const;

  static recheckMs = 4000;

  static readonly model = hsm.define(
    "Chat",
    hsm.initial(hsm.target("connecting")),
    hsm.state(
      "connecting",
      hsm.entry(Chat.checkHealth),
      hsm.transition(hsm.on(Chat.healthEvent.name), hsm.guard(Chat.isReady), hsm.target("../session")),
      hsm.transition(hsm.on(Chat.healthEvent.name), hsm.guard(Chat.isUnconfigured), hsm.target("../unconfigured")),
      hsm.transition(hsm.on(Chat.healthEvent.name), hsm.target("../offline")),
    ),
    hsm.state(
      "offline",
      hsm.entry(Chat.enterOffline),
      hsm.transition(hsm.after(recheckDelay), hsm.target("../connecting")),
    ),
    hsm.state(
      "unconfigured",
      hsm.entry(Chat.enterUnconfigured),
      hsm.transition(hsm.after(recheckDelay), hsm.target("../connecting")),
    ),
    // This chat's own mosfet. Leaving the state, for any reason including stopping the chat, ends it.
    hsm.state(
      "session",
      hsm.exit(Chat.endSession),
      hsm.initial(hsm.target("opening")),
      hsm.state(
        "opening",
        hsm.entry(Chat.openSession),
        hsm.transition(hsm.on(Chat.openedEvent.name), hsm.guard(Chat.hasSession), hsm.target("../ready")),
        hsm.transition(hsm.on(Chat.openedEvent.name), hsm.target("../../offline")),
      ),
      hsm.state(
        "ready",
        hsm.entry(Chat.enterReady),
        hsm.transition(hsm.on(Chat.sendEvent.name), hsm.guard(Chat.hasText), hsm.target("../thinking")),
      ),
      hsm.state(
        "thinking",
        hsm.entry(Chat.ask),
        hsm.transition(hsm.on(Chat.repliedEvent.name), hsm.guard(Chat.sessionEnded), hsm.target("../opening"), hsm.effect(Chat.record)),
        hsm.transition(hsm.on(Chat.repliedEvent.name), hsm.target("../ready"), hsm.effect(Chat.record)),
      ),
    ),
  );

  transport: ChatTransport = httpTransport;
  lines: ChatLine[] = [];
  expression: ExpressionName = "sleepy";
  model: string | null = null;
  /** This chat's mosfet in the workshop, while in `session`. */
  session: string | null = null;
  problem: string | null = null;
  /** Bumped on every exchange so a late reply from an abandoned request can be ignored. */
  private exchange = 0;

  static isReady(_ctx: hsm.Context, _instance: hsm.Instance, event: hsm.Event): boolean {
    return hsm.isRecord(event.data) && event.data["ready"] === true;
  }

  static isUnconfigured(_ctx: hsm.Context, _instance: hsm.Instance, event: hsm.Event): boolean {
    return hsm.isRecord(event.data) && event.data["reachable"] === true && event.data["ready"] !== true;
  }

  static hasText(_ctx: hsm.Context, _instance: hsm.Instance, event: hsm.Event): boolean {
    return textOf(event) !== "";
  }

  static hasSession(_ctx: hsm.Context, instance: hsm.Instance): boolean {
    return instance instanceof Chat && instance.session !== null;
  }

  static sessionEnded(_ctx: hsm.Context, _instance: hsm.Instance, event: hsm.Event): boolean {
    return hsm.isRecord(event.data) && event.data["ended"] === true;
  }

  static openSession(ctx: hsm.Context, instance: hsm.Instance): void {
    if (!(instance instanceof Chat)) return;
    Chat.show(ctx, instance, "sleepy");
    instance.transport.open().then(
      (opened) => {
        instance.session = opened.session;
        instance.problem = opened.problem;
        Chat.tell(instance, Chat.openedEvent, null);
      },
      () => {
        instance.session = null;
        instance.problem = "The workshop isn't running.";
        Chat.tell(instance, Chat.openedEvent, null);
      },
    );
  }

  static endSession(_ctx: hsm.Context, instance: hsm.Instance): void {
    if (!(instance instanceof Chat) || instance.session === null) return;
    instance.transport.end(instance.session);
    instance.session = null;
  }

  static checkHealth(_ctx: hsm.Context, instance: hsm.Instance): void {
    if (!(instance instanceof Chat)) return;
    instance.transport.health().then(
      (health) => {
        instance.model = health.model;
        instance.problem = health.problem;
        Chat.tell(instance, Chat.healthEvent, { reachable: true, ready: health.ready });
      },
      () => {
        instance.problem = "The workshop isn't running.";
        Chat.tell(instance, Chat.healthEvent, { reachable: false, ready: false });
      },
    );
  }

  static enterOffline(ctx: hsm.Context, instance: hsm.Instance): void {
    if (instance instanceof Chat) Chat.show(ctx, instance, "sleepy");
  }

  static enterUnconfigured(ctx: hsm.Context, instance: hsm.Instance): void {
    if (instance instanceof Chat) Chat.show(ctx, instance, "worried");
  }

  static enterReady(ctx: hsm.Context, instance: hsm.Instance): void {
    if (!(instance instanceof Chat)) return;
    // Nothing is said until you say something; coming back from an exchange keeps the face the reply just set.
    if (instance.lines.length === 0) instance.expression = "normal";
    Chat.show(ctx, instance, instance.expression, true);
  }

  static ask(ctx: hsm.Context, instance: hsm.Instance, event: hsm.Event): void {
    if (!(instance instanceof Chat)) return;
    const text = textOf(event);
    const exchange = ++instance.exchange;
    instance.lines.push({ who: "you", text });
    Chat.show(ctx, instance, "focused");
    const session = instance.session;
    if (session === null) return;
    instance.transport.send(session, text).then(
      (answer) => {
        if (exchange === instance.exchange) Chat.tell(instance, Chat.repliedEvent, answer);
      },
      (error: unknown) => {
        if (exchange !== instance.exchange) return;
        Chat.tell(instance, Chat.repliedEvent, { reply: null, problem: `Couldn't reach the workshop: ${String(error)}` });
      },
    );
  }

  static record(ctx: hsm.Context, instance: hsm.Instance, event: hsm.Event): void {
    if (!(instance instanceof Chat)) return;
    const data = hsm.isRecord(event.data) ? event.data : {};
    const reply = typeof data["reply"] === "string" ? data["reply"] : null;
    const problem = typeof data["problem"] === "string" ? data["problem"] : null;
    if (reply !== null) {
      instance.lines.push({ who: "mosfet", text: reply });
      instance.problem = null;
      instance.expression = "happy";
    } else if (data["ended"] === true) {
      instance.lines.push({ who: "note", text: "That mosfet ended; starting a new one. It won't remember this chat." });
      instance.expression = "sleepy";
    } else {
      instance.lines.push({ who: "note", text: problem ?? "No reply." });
      instance.problem = problem;
      instance.expression = "worried";
    }
    Chat.show(ctx, instance, instance.expression);
  }

  private static tell(instance: Chat, event: { readonly name: string; readonly kind: hsm.Event["kind"] }, data: unknown): void {
    void Promise.resolve(hsm.dispatch(instance, hsm.typedEvent({ event, data }))).catch((error: unknown) => {
      // A reply arriving after the chat was stopped is the page closing, not a fault.
      if (hsm.hostDropFrom({ error, host: instance }) !== null) return;
      hsm.catchFailure(hsm.ownerTarget(instance))(error);
    });
  }

  /**
   * Tell the owner something changed. `ready` says whether you can send now: it is passed explicitly because these
   * calls run inside entry actions, where the state path can still read as the state being left.
   */
  private static show(_ctx: hsm.Context, instance: Chat, expression: ExpressionName, ready = false): void {
    instance.expression = expression;
    void hsm.notifyOwner({
      instance,
      event: hsm.typedEvent({ event: Chat.changedEvent, data: { ready } }),
    }).catch(hsm.catchFailure(hsm.ownerTarget(instance)));
  }
}

function textOf(event: hsm.Event): string {
  const data = event.data;
  const text = hsm.isRecord(data) ? data["text"] : undefined;
  return typeof text === "string" ? text.trim() : "";
}

/**
 * Start a Chat under `ctx`, optionally over a different transport than the HTTP workshop.
 *
 * Outputs: a started Chat in `/Chat/connecting`. Ownership: caller must `hsm.stop` it.
 */
export function startChat(args: { ctx: hsm.Context; transport?: ChatTransport }): Chat {
  const chat = new Chat();
  if (args.transport) chat.transport = args.transport;
  return hsm.start({ ctx: args.ctx, instance: chat, model: Chat.model });
}
