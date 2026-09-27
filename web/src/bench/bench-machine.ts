import * as hsm from "../hsm.ts";
import { type ExpressionName } from "../face/presets.ts";

export type BenchTask = {
  readonly id: string;
  readonly label: string;
  readonly ask: string;
  /** A correction to offer, so a newcomer can teach in one click. */
  readonly correction: string;
};

/** The jobs on the bench. Each one runs for real against the workshop bridge. */
export const BENCH_TASKS: readonly BenchTask[] = [
  {
    id: "plan",
    label: "plan the week",
    ask: "plan my week around the thursday demo",
    correction: "block friday morning as buffer — demos always slip",
  },
  {
    id: "code",
    label: "fix a failing test",
    ask: "checkout tests are red again, fix it",
    correction: "always run the tests twice before declaring green — the second run catches the flaky one",
  },
  {
    id: "computer",
    label: "clean up the repo",
    ask: "find and archive stale branches in the repo",
    correction: "never touch main, and comment on the branch before archiving it",
  },
];

/** A rule the bridge pinned for a job: a later run replays it with no model call. */
export type BenchRule = {
  readonly skill: string;
  readonly steps: readonly string[];
  readonly result: string;
  readonly learnedFrom: string;
};

export type RunReply = {
  readonly mode: "paid" | "free";
  readonly cost: number;
  readonly steps: readonly string[];
  readonly result: string;
  readonly problem: string | null;
};

export type TeachReply = { readonly rule: BenchRule | null; readonly problem: string | null };

/** How the bench reaches the bridge. Injected so tests can stand in for HTTP. Every method rejects when unreachable. */
export type BenchTransport = {
  rules(): Promise<Record<string, BenchRule>>;
  run(task: string, ask: string): Promise<RunReply>;
  teach(task: string, correction: string): Promise<TeachReply>;
  forget(task: string): Promise<void>;
};

export type LogKind = "ask" | "step" | "result" | "you" | "note";
export type LogLine = { readonly kind: LogKind; readonly text: string; readonly cost?: number };

/** Which step of the loop the bench is on, reported with every change so owners never read a mid-entry state path. */
export type BenchPhase = "offline" | "loading" | "fresh" | "running" | "reviewing" | "teaching" | "learned" | "replaying" | "replayed";

/** What the bridge bills a live run; replaced by the price a real paid run reports. */
export const LIVE_RUN_PRICE = 0.04;

async function json(response: Response): Promise<Record<string, unknown>> {
  const type = response.headers.get("Content-Type") ?? "";
  if (!type.includes("json")) throw new Error(`the workshop answered ${response.status}`);
  const body: unknown = await response.json();
  return hsm.isRecord(body) ? body : {};
}

function post(path: string, body: unknown): Promise<Record<string, unknown>> {
  return fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(json);
}

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : []);
const text = (value: unknown): string => (typeof value === "string" ? value : "");
const problemOf = (body: Record<string, unknown>): string | null => (typeof body["problem"] === "string" ? body["problem"] : null);

function ruleFrom(value: unknown): BenchRule | null {
  if (!hsm.isRecord(value) || text(value["skill"]) === "") return null;
  return { skill: text(value["skill"]), steps: strings(value["steps"]), result: text(value["result"]), learnedFrom: text(value["learned_from"]) };
}

/** The workshop bridge (`workshop/server.py`), through the dev server's `/api` proxy. */
export const httpBenchTransport: BenchTransport = {
  async rules() {
    const body = await json(await fetch("/api/bench/rules"));
    const rules: Record<string, BenchRule> = {};
    const raw = body["rules"];
    if (hsm.isRecord(raw)) {
      for (const [task, value] of Object.entries(raw)) {
        const rule = ruleFrom(value);
        if (rule !== null) rules[task] = rule;
      }
    }
    return rules;
  },
  async run(task, ask) {
    const body = await post("/api/bench/run", { task, ask });
    return {
      mode: body["mode"] === "free" ? "free" : "paid",
      cost: typeof body["cost"] === "number" ? body["cost"] : 0,
      steps: strings(body["steps"]),
      result: text(body["result"]),
      problem: problemOf(body),
    };
  },
  async teach(task, correction) {
    const body = await post("/api/bench/teach", { task, correction });
    return { rule: ruleFrom({ ...body, learned_from: body["learned_from"] ?? correction }), problem: problemOf(body) };
  },
  async forget(task) {
    await post("/api/bench/forget", { task });
  },
};

const recheckDelay = (): number => Bench.recheckMs;
const paidStepDelay = (): number => Bench.paidStepMs;
const freeStepDelay = (): number => Bench.freeStepMs;

/**
 * The bench: run a job, correct it once, and every run after is free.
 *
 * `loading` asks the bridge for its pinned rules; `offline` retries on a modeled timer. Inside `online`, the current
 * job is either `fresh` (never taught) or `learned` (a rule is pinned). A paid run is `running` (the model call in
 * flight) then `revealing`, re-entered once per step so each step lands with its share of the bill. A correction is
 * `teaching` until the bridge pins the rule. A learned run replays the rule: `replaying` re-enters per step at no cost.
 * "Is this job learned" is the state path, never a flag; the machine owns the log, meter, and face; owners draw.
 */
export class Bench extends hsm.Instance {
  static readonly pickEvent = { name: "bench.pick", kind: hsm.Kinds.Event } as const;
  static readonly runEvent = { name: "bench.run", kind: hsm.Kinds.Event } as const;
  static readonly teachEvent = { name: "bench.teach", kind: hsm.Kinds.Event } as const;
  static readonly forgetEvent = { name: "bench.forget", kind: hsm.Kinds.Event } as const;
  static readonly repinEvent = { name: "bench.repin", kind: hsm.Kinds.Event } as const;
  static readonly loadedEvent = { name: "bench.loaded", kind: hsm.Kinds.Event } as const;
  static readonly ranEvent = { name: "bench.ran", kind: hsm.Kinds.Event } as const;
  static readonly taughtEvent = { name: "bench.taught", kind: hsm.Kinds.Event } as const;
  static readonly changedEvent = { name: "bench.changed", kind: hsm.Kinds.Event } as const;

  static recheckMs = 4000;
  static paidStepMs = 420;
  static freeStepMs = 140;

  static readonly model = hsm.define(
    "Bench",
    hsm.initial(hsm.target("loading")),
    hsm.state(
      "loading",
      hsm.entry(Bench.loadRules),
      hsm.transition(hsm.on(Bench.loadedEvent.name), hsm.guard(Bench.reached), hsm.target("../online"), hsm.effect(Bench.keepRules)),
      hsm.transition(hsm.on(Bench.loadedEvent.name), hsm.target("../offline")),
    ),
    hsm.state(
      "offline",
      hsm.entry(Bench.enterOffline),
      hsm.transition(hsm.after(recheckDelay), hsm.target("../loading")),
    ),
    hsm.state(
      "online",
      hsm.initial(hsm.target("which")),
      hsm.choice(
        "which",
        hsm.transition(hsm.guard(Bench.taskLearned), hsm.target("learned")),
        hsm.transition(hsm.target("fresh")),
      ),
      hsm.state(
        "fresh",
        hsm.entry(Bench.enterFresh),
        hsm.transition(hsm.on(Bench.runEvent.name), hsm.target("../running")),
      ),
      hsm.state(
        "running",
        hsm.entry(Bench.startRun),
        hsm.transition(hsm.on(Bench.ranEvent.name), hsm.guard(Bench.ranFree), hsm.target("../learned/replaying"), hsm.effect(Bench.acceptRun)),
        hsm.transition(hsm.on(Bench.ranEvent.name), hsm.guard(Bench.ranPaid), hsm.target("../revealing"), hsm.effect(Bench.acceptRun)),
        hsm.transition(hsm.on(Bench.ranEvent.name), hsm.target("../fresh"), hsm.effect(Bench.runFailed)),
      ),
      hsm.state(
        "revealing",
        hsm.entry(Bench.revealPaidStep),
        // Re-entering `revealing` lands the next step and bills its share.
        hsm.transition(hsm.after(paidStepDelay), hsm.guard(Bench.moreToReveal), hsm.target("../revealing")),
        hsm.transition(hsm.after(paidStepDelay), hsm.target("../reviewing")),
      ),
      hsm.state(
        "reviewing",
        hsm.entry(Bench.enterReviewing),
        hsm.transition(hsm.on(Bench.teachEvent.name), hsm.guard(Bench.hasText), hsm.target("../teaching"), hsm.effect(Bench.hearCorrection)),
        hsm.transition(hsm.on(Bench.runEvent.name), hsm.target("../running")),
      ),
      hsm.state(
        "teaching",
        hsm.entry(Bench.startTeach),
        hsm.transition(hsm.on(Bench.taughtEvent.name), hsm.guard(Bench.taughtRule), hsm.target("../learned"), hsm.effect(Bench.pinRule)),
        hsm.transition(hsm.on(Bench.taughtEvent.name), hsm.guard(Bench.wasReviewing), hsm.target("../reviewing"), hsm.effect(Bench.teachFailed)),
        hsm.transition(hsm.on(Bench.taughtEvent.name), hsm.target("../fresh"), hsm.effect(Bench.teachFailed)),
      ),
      hsm.state(
        "learned",
        hsm.initial(hsm.target("ready")),
        hsm.state(
          "ready",
          hsm.entry(Bench.enterReady),
          hsm.transition(hsm.on(Bench.runEvent.name), hsm.target("../../running")),
        ),
        hsm.state(
          "replaying",
          hsm.entry(Bench.revealFreeStep),
          hsm.transition(hsm.after(freeStepDelay), hsm.guard(Bench.moreToReveal), hsm.target("../replaying")),
          hsm.transition(hsm.after(freeStepDelay), hsm.target("../replayed")),
        ),
        hsm.state(
          "replayed",
          hsm.entry(Bench.enterReplayed),
          hsm.transition(hsm.on(Bench.runEvent.name), hsm.target("../../running")),
        ),
        hsm.transition(hsm.on(Bench.forgetEvent.name), hsm.guard(Bench.forgetsCurrent), hsm.target("../fresh"), hsm.effect(Bench.forget)),
      ),
      // Unpinning another job's rule does not move this one.
      hsm.transition(hsm.on(Bench.forgetEvent.name), hsm.guard(Bench.forgetsPinned), hsm.effect(Bench.forget)),
      hsm.transition(hsm.on(Bench.pickEvent.name), hsm.guard(Bench.picksTask), hsm.target("/Bench/online/which"), hsm.effect(Bench.pick)),
      hsm.transition(hsm.on(Bench.repinEvent.name), hsm.guard(Bench.hasGhost), hsm.target("/Bench/online/teaching"), hsm.effect(Bench.repin)),
    ),
  );

  transport: BenchTransport = httpBenchTransport;
  task: BenchTask = BENCH_TASKS[0]!;
  rules = new Map<string, BenchRule>();
  /** Rules unpinned this visit, kept so they can be pinned back. */
  ghosts = new Map<string, BenchRule>();
  log: LogLine[] = [];
  /** The run being revealed. */
  pending: { steps: readonly string[]; result: string; cost: number; next: number } | null = null;
  /** The correction being taught. */
  correction = "";
  /** Where a failed teach returns: a fresh correction after a run goes back to reviewing. */
  teachFrom: "reviewing" | "fresh" = "reviewing";
  /** Dollars on the meter for the run on screen. */
  runCost = 0;
  /** Dollars spent on live runs this visit. */
  spent = 0;
  /** Dollars the free runs this visit would have cost live. */
  saved = 0;
  freeRuns = 0;
  livePrice = LIVE_RUN_PRICE;
  expression: ExpressionName = "sleepy";
  /** What the bot says about what it is doing. */
  say = "";
  problem: string | null = null;
  private generation = 0;

  static reached(_ctx: hsm.Context, _instance: hsm.Instance, event: hsm.Event): boolean {
    return hsm.isRecord(event.data) && hsm.isRecord(event.data["rules"]);
  }

  static taskLearned(_ctx: hsm.Context, instance: hsm.Instance): boolean {
    return instance instanceof Bench && instance.rules.has(instance.task.id);
  }

  static ranFree(_ctx: hsm.Context, _instance: hsm.Instance, event: hsm.Event): boolean {
    const reply = replyOf(event);
    return reply !== null && reply.problem === null && reply.mode === "free";
  }

  static ranPaid(_ctx: hsm.Context, _instance: hsm.Instance, event: hsm.Event): boolean {
    const reply = replyOf(event);
    return reply !== null && reply.problem === null && reply.mode === "paid";
  }

  static moreToReveal(_ctx: hsm.Context, instance: hsm.Instance): boolean {
    return instance instanceof Bench && instance.pending !== null && instance.pending.next <= instance.pending.steps.length;
  }

  static hasText(_ctx: hsm.Context, _instance: hsm.Instance, event: hsm.Event): boolean {
    return textOf(event) !== "";
  }

  static taughtRule(_ctx: hsm.Context, _instance: hsm.Instance, event: hsm.Event): boolean {
    return hsm.isRecord(event.data) && event.data["rule"] !== null && event.data["rule"] !== undefined;
  }

  static wasReviewing(_ctx: hsm.Context, instance: hsm.Instance): boolean {
    return instance instanceof Bench && instance.teachFrom === "reviewing";
  }

  static forgetsCurrent(_ctx: hsm.Context, instance: hsm.Instance, event: hsm.Event): boolean {
    return instance instanceof Bench && fieldOf(event, "task") === instance.task.id;
  }

  static forgetsPinned(_ctx: hsm.Context, instance: hsm.Instance, event: hsm.Event): boolean {
    const task = fieldOf(event, "task");
    return instance instanceof Bench && typeof task === "string" && instance.rules.has(task);
  }

  static picksTask(_ctx: hsm.Context, instance: hsm.Instance, event: hsm.Event): boolean {
    const task = fieldOf(event, "task");
    return instance instanceof Bench && task !== instance.task.id && BENCH_TASKS.some((t) => t.id === task);
  }

  static hasGhost(_ctx: hsm.Context, instance: hsm.Instance, event: hsm.Event): boolean {
    const task = fieldOf(event, "task");
    return instance instanceof Bench && typeof task === "string" && instance.ghosts.has(task);
  }

  static loadRules(ctx: hsm.Context, instance: hsm.Instance): void {
    if (!(instance instanceof Bench)) return;
    Bench.show(ctx, instance, "loading", instance.expression, "");
    instance.transport.rules().then(
      (rules) => Bench.tell(instance, Bench.loadedEvent, { rules }),
      () => Bench.tell(instance, Bench.loadedEvent, { rules: null }),
    );
  }

  static keepRules(_ctx: hsm.Context, instance: hsm.Instance, event: hsm.Event): void {
    if (!(instance instanceof Bench) || !hsm.isRecord(event.data) || !hsm.isRecord(event.data["rules"])) return;
    instance.rules = new Map(Object.entries(event.data["rules"] as Record<string, BenchRule>));
    for (const task of instance.rules.keys()) instance.ghosts.delete(task);
    instance.problem = null;
    // A first visit starts on a job it has not learned, so the whole loop is there to see.
    if (instance.log.length === 0) instance.task = BENCH_TASKS.find((t) => !instance.rules.has(t.id)) ?? instance.task;
  }

  static enterOffline(ctx: hsm.Context, instance: hsm.Instance): void {
    if (!(instance instanceof Bench)) return;
    instance.problem = "The workshop bridge isn't answering.";
    Bench.show(ctx, instance, "offline", "sleepy", "zzz… the workshop is closed.");
  }

  static pick(_ctx: hsm.Context, instance: hsm.Instance, event: hsm.Event): void {
    if (!(instance instanceof Bench)) return;
    const task = BENCH_TASKS.find((t) => t.id === fieldOf(event, "task"));
    if (task === undefined) return;
    instance.task = task;
    instance.log = [];
    instance.pending = null;
    instance.runCost = 0;
    instance.problem = null;
  }

  static enterFresh(ctx: hsm.Context, instance: hsm.Instance): void {
    if (!(instance instanceof Bench)) return;
    const say = instance.problem ?? `Give me the job and I'll do it live. That one's on the meter.`;
    Bench.show(ctx, instance, "fresh", instance.problem === null ? "normal" : "worried", say);
  }

  static startRun(ctx: hsm.Context, instance: hsm.Instance): void {
    if (!(instance instanceof Bench)) return;
    const generation = ++instance.generation;
    const learned = instance.rules.has(instance.task.id);
    instance.log = [{ kind: "ask", text: instance.task.ask }];
    instance.pending = null;
    instance.runCost = 0;
    instance.problem = null;
    // A learned job's run in flight is already the free step; only an untaught one is on the meter.
    Bench.show(
      ctx,
      instance,
      learned ? "replaying" : "running",
      "focused",
      learned ? "Pulling the pinned rule…" : "Thinking it through… the meter's running.",
    );
    instance.transport.run(instance.task.id, instance.task.ask).then(
      (reply) => {
        if (generation === instance.generation) Bench.tell(instance, Bench.ranEvent, reply);
      },
      (error: unknown) => {
        if (generation !== instance.generation) return;
        Bench.tell(instance, Bench.ranEvent, { mode: "paid", cost: 0, steps: [], result: "", problem: `Couldn't reach the workshop: ${String(error)}` });
      },
    );
  }

  static acceptRun(_ctx: hsm.Context, instance: hsm.Instance, event: hsm.Event): void {
    const reply = replyOf(event);
    if (!(instance instanceof Bench) || reply === null) return;
    const free = reply.mode === "free";
    if (!free && reply.cost > 0) instance.livePrice = reply.cost;
    instance.pending = { steps: reply.steps, result: reply.result, cost: free ? 0 : reply.cost, next: 0 };
  }

  static runFailed(_ctx: hsm.Context, instance: hsm.Instance, event: hsm.Event): void {
    if (!(instance instanceof Bench)) return;
    const reply = replyOf(event);
    instance.problem = reply?.problem ?? "The run didn't come back.";
    instance.log.push({ kind: "note", text: instance.problem });
  }

  /** Land the next step of a paid run, billing its share; the last reveal is the result. */
  static revealPaidStep(ctx: hsm.Context, instance: hsm.Instance): void {
    if (!(instance instanceof Bench) || instance.pending === null) return;
    const pending = instance.pending;
    const share = pending.cost / Math.max(1, pending.steps.length);
    if (pending.next < pending.steps.length) {
      const cost = pending.next === pending.steps.length - 1 ? round(pending.cost - share * (pending.steps.length - 1)) : round(share);
      instance.log.push({ kind: "step", text: pending.steps[pending.next]!, cost });
      instance.runCost = round(instance.runCost + cost);
      instance.spent = round(instance.spent + cost);
    } else {
      if (pending.steps.length === 0) {
        instance.runCost = round(instance.runCost + pending.cost);
        instance.spent = round(instance.spent + pending.cost);
      }
      if (pending.result !== "") instance.log.push({ kind: "result", text: pending.result });
    }
    pending.next += 1;
    Bench.show(ctx, instance, "running", "focused", "Working… every step is a model call.");
  }

  static enterReviewing(ctx: hsm.Context, instance: hsm.Instance): void {
    if (!(instance instanceof Bench)) return;
    instance.pending = null;
    const say = instance.problem ?? `Done — that cost ${money(instance.runCost)}. Not how you'd do it? Tell me once.`;
    Bench.show(ctx, instance, "reviewing", instance.problem === null ? "normal" : "worried", say);
  }

  static hearCorrection(_ctx: hsm.Context, instance: hsm.Instance, event: hsm.Event): void {
    if (!(instance instanceof Bench)) return;
    instance.correction = textOf(event);
    instance.teachFrom = "reviewing";
    instance.log.push({ kind: "you", text: instance.correction });
  }

  static startTeach(ctx: hsm.Context, instance: hsm.Instance): void {
    if (!(instance instanceof Bench)) return;
    const generation = ++instance.generation;
    instance.problem = null;
    const task = instance.task.id;
    Bench.show(ctx, instance, "teaching", "worried", "Oh. Right. Writing that down…");
    instance.transport.teach(task, instance.correction).then(
      (reply) => {
        if (generation === instance.generation) Bench.tell(instance, Bench.taughtEvent, reply);
      },
      (error: unknown) => {
        if (generation !== instance.generation) return;
        Bench.tell(instance, Bench.taughtEvent, { rule: null, problem: `Couldn't reach the workshop: ${String(error)}` });
      },
    );
  }

  static pinRule(_ctx: hsm.Context, instance: hsm.Instance, event: hsm.Event): void {
    if (!(instance instanceof Bench) || !hsm.isRecord(event.data)) return;
    const rule = event.data["rule"] as BenchRule;
    instance.rules.set(instance.task.id, rule);
    instance.ghosts.delete(instance.task.id);
    instance.log.push({ kind: "note", text: `pinned: ${rule.skill}` });
  }

  static teachFailed(_ctx: hsm.Context, instance: hsm.Instance, event: hsm.Event): void {
    if (!(instance instanceof Bench)) return;
    const problem = fieldOf(event, "problem");
    instance.problem = typeof problem === "string" ? problem : "That didn't stick.";
    instance.log.push({ kind: "note", text: instance.problem });
  }

  static enterReady(ctx: hsm.Context, instance: hsm.Instance): void {
    if (!(instance instanceof Bench)) return;
    const justLearned = instance.log.at(-1)?.text.startsWith("pinned: ") === true;
    Bench.show(
      ctx,
      instance,
      "learned",
      justLearned ? "surprised" : "happy",
      justLearned ? "Got it — pinned. Run it again: this one's free." : "I know this one. Run it — no model call.",
      justLearned ? "learned" : undefined,
    );
  }

  static revealFreeStep(ctx: hsm.Context, instance: hsm.Instance): void {
    if (!(instance instanceof Bench) || instance.pending === null) return;
    const pending = instance.pending;
    if (pending.next < pending.steps.length) instance.log.push({ kind: "step", text: pending.steps[pending.next]!, cost: 0 });
    else if (pending.result !== "") instance.log.push({ kind: "result", text: pending.result, cost: 0 });
    pending.next += 1;
    Bench.show(ctx, instance, "replaying", "happy", "Doing it your way. No model call.");
  }

  static enterReplayed(ctx: hsm.Context, instance: hsm.Instance): void {
    if (!(instance instanceof Bench)) return;
    instance.pending = null;
    instance.runCost = 0;
    instance.freeRuns += 1;
    instance.saved = round(instance.saved + instance.livePrice);
    Bench.show(ctx, instance, "replayed", "skeptic", `$0.00. Told you. Saved ${money(instance.saved)} so far.`, "free");
  }

  static forget(ctx: hsm.Context, instance: hsm.Instance, event: hsm.Event): void {
    if (!(instance instanceof Bench)) return;
    const task = fieldOf(event, "task");
    if (typeof task !== "string") return;
    const rule = instance.rules.get(task);
    if (rule !== undefined) instance.ghosts.set(task, rule);
    instance.rules.delete(task);
    instance.transport.forget(task).catch(() => undefined);
    if (task !== instance.task.id) Bench.show(ctx, instance, "learned", instance.expression, instance.say);
    else instance.log = [{ kind: "note", text: "unpinned. the next run goes back on the meter." }];
  }

  static repin(_ctx: hsm.Context, instance: hsm.Instance, event: hsm.Event): void {
    if (!(instance instanceof Bench)) return;
    const task = BENCH_TASKS.find((t) => t.id === fieldOf(event, "task"));
    const ghost = task === undefined ? undefined : instance.ghosts.get(task.id);
    if (task === undefined || ghost === undefined) return;
    if (task.id !== instance.task.id) {
      instance.task = task;
      instance.log = [];
    }
    instance.correction = ghost.learnedFrom || task.correction;
    instance.teachFrom = "fresh";
    instance.log.push({ kind: "you", text: instance.correction });
  }

  private static tell(instance: Bench, event: { readonly name: string; readonly kind: hsm.Event["kind"] }, data: unknown): void {
    void Promise.resolve(hsm.dispatch(instance, hsm.typedEvent({ event, data }))).catch((error: unknown) => {
      if (hsm.hostDropFrom({ error, host: instance }) !== null) return;
      hsm.catchFailure(hsm.ownerTarget(instance))(error);
    });
  }

  /**
   * Tell the owner something changed. `phase` and `moment` are passed explicitly because these calls run inside
   * entry actions, where the state path can still read as the state being left.
   */
  private static show(
    _ctx: hsm.Context,
    instance: Bench,
    phase: BenchPhase,
    expression: ExpressionName,
    say: string,
    moment?: "learned" | "free",
  ): void {
    instance.expression = expression;
    instance.say = say;
    void hsm.notifyOwner({
      instance,
      event: hsm.typedEvent({ event: Bench.changedEvent, data: { phase, moment } }),
    }).catch(hsm.catchFailure(hsm.ownerTarget(instance)));
  }
}

function round(dollars: number): number {
  return Math.round(dollars * 10000) / 10000;
}

export function money(dollars: number): string {
  return `$${dollars.toFixed(2)}`;
}

function fieldOf(event: hsm.Event, key: string): unknown {
  return hsm.isRecord(event.data) ? event.data[key] : undefined;
}

function textOf(event: hsm.Event): string {
  const value = fieldOf(event, "text");
  return typeof value === "string" ? value.trim() : "";
}

function replyOf(event: hsm.Event): RunReply | null {
  const data = event.data;
  if (!hsm.isRecord(data)) return null;
  return {
    mode: data["mode"] === "free" ? "free" : "paid",
    cost: typeof data["cost"] === "number" ? data["cost"] : 0,
    steps: strings(data["steps"]),
    result: text(data["result"]),
    problem: typeof data["problem"] === "string" ? data["problem"] : null,
  };
}

/**
 * Start a Bench under `ctx`, optionally over a transport other than the HTTP bridge.
 *
 * Outputs: a started Bench in `/Bench/loading`. Ownership: caller must `hsm.stop` it. Units: delays in milliseconds
 * (`Bench.*Ms`), money in dollars.
 */
export function startBench(args: { ctx: hsm.Context; transport?: BenchTransport }): Bench {
  const bench = new Bench();
  if (args.transport) bench.transport = args.transport;
  return hsm.start({ ctx: args.ctx, instance: bench, model: Bench.model });
}
