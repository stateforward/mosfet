import * as hsm from "../hsm.ts";
import { type ExpressionName } from "../face/presets.ts";
import { firstRunCost, isTaskId, TASKS, type Task, type TaskId } from "./tasks.ts";

export type Speaker = "you" | "bot" | "step" | "result" | "note";

/** Milestones the owner reacts to. */
export type MakerMoment = "learned" | "free";

export type Line = { readonly who: Speaker; readonly text: string; readonly cost?: number };

const stepDelay = (): number => Maker.stepMs;
const learnDelay = (): number => Maker.learnMs;
const replayDelay = (): number => Maker.replayMs;
const startDelay = (): number => Maker.startMs;
const autoplayDelay = (): number => Maker.autoplayMs;

/**
 * The mosfet.bot demo: a bot does a job, you correct it once, and every run
 * after that is free.
 *
 * The paid run is a state re-entered once per step (`working`), each entry
 * spending one model call. Once taught, the job runs from `learned` with no
 * spend. "Has it learned this" is the state path, never a flag. The machine
 * owns the transcript, meter, and face expression; the element only draws.
 *
 * A front-end mock: no model is called and nothing persists.
 */
export class Maker extends hsm.Instance {
  static readonly pickEvent = { name: "maker.pick", kind: hsm.Kinds.Event } as const;
  static readonly teachEvent = { name: "maker.teach", kind: hsm.Kinds.Event } as const;
  static readonly runEvent = { name: "maker.run", kind: hsm.Kinds.Event } as const;
  static readonly forgetEvent = { name: "maker.forget", kind: hsm.Kinds.Event } as const;
  static readonly resetEvent = { name: "maker.reset", kind: hsm.Kinds.Event } as const;
  static readonly changedEvent = { name: "maker.changed", kind: hsm.Kinds.Event } as const;

  /** Idle time before the demo starts a job by itself; 0 disables it. */
  static autoplayMs = 900;
  static startMs = 300;
  static stepMs = 650;
  static learnMs = 900;
  static replayMs = 450;

  static readonly model = hsm.define(
    "Maker",
    hsm.initial(hsm.target("choosing")),
    hsm.state(
      "choosing",
      hsm.entry(Maker.enterChoosing),
      // An empty demo sells nothing: start the first job if nobody picks one.
      hsm.transition(
        hsm.after(autoplayDelay),
        hsm.guard(Maker.shouldAutoplay),
        hsm.target("../untaught"),
        hsm.effect(Maker.autoplay),
      ),
    ),
    hsm.state(
      "untaught",
      hsm.initial(hsm.target("starting")),
      hsm.state(
        "starting",
        hsm.entry(Maker.beginRun),
        hsm.transition(hsm.after(startDelay), hsm.target("../working")),
      ),
      hsm.state(
        "working",
        hsm.entry(Maker.spendStep),
        // Re-entering `working` is what spends the next call and re-arms the timer.
        hsm.transition(hsm.after(stepDelay), hsm.guard(Maker.hasMoreSteps), hsm.target("../working")),
        hsm.transition(hsm.after(stepDelay), hsm.guard(Maker.isLastStep), hsm.target("../reviewing")),
      ),
      hsm.state(
        "reviewing",
        hsm.entry(Maker.enterReviewing),
        hsm.transition(hsm.on(Maker.teachEvent.name), hsm.guard(Maker.hasText), hsm.target("../../learning")),
        hsm.transition(hsm.on(Maker.runEvent.name), hsm.target("../starting")),
      ),
    ),
    hsm.state(
      "learning",
      hsm.entry(Maker.enterLearning),
      hsm.transition(hsm.after(learnDelay), hsm.target("../learned")),
    ),
    hsm.state(
      "learned",
      hsm.initial(hsm.target("ready")),
      hsm.entry(Maker.enterLearned),
      hsm.state(
        "ready",
        hsm.entry(Maker.enterReady),
        hsm.transition(hsm.on(Maker.runEvent.name), hsm.target("../replaying")),
      ),
      hsm.state(
        "replaying",
        hsm.entry(Maker.enterReplaying),
        hsm.transition(hsm.after(replayDelay), hsm.target("../replayed")),
      ),
      hsm.state(
        "replayed",
        hsm.entry(Maker.enterReplayed),
        hsm.transition(hsm.on(Maker.runEvent.name), hsm.target("../replaying")),
      ),
      hsm.transition(hsm.on(Maker.forgetEvent.name), hsm.target("../untaught"), hsm.effect(Maker.forget)),
    ),
    hsm.transition(hsm.on(Maker.pickEvent.name), hsm.guard(Maker.hasTask), hsm.target("/Maker/untaught"), hsm.effect(Maker.pick)),
    hsm.transition(hsm.on(Maker.resetEvent.name), hsm.target("/Maker/choosing")),
  );

  task: Task | null = null;
  lines: Line[] = [];
  expression: ExpressionName = "normal";
  /** Index of the next paid step in the current run. */
  step = 0;
  /** Dollars spent in the run on screen. */
  runCost = 0;
  /** Dollars spent on this task across every run. */
  spent = 0;
  /** Runs of this task, paid and free. */
  runs = 0;
  freeRuns = 0;
  skill: string | null = null;
  /** The demo starts itself once per page, never again after a reset. */
  autoplayed = false;

  static shouldAutoplay(_ctx: hsm.Context, instance: hsm.Instance): boolean {
    return instance instanceof Maker && !instance.autoplayed && Maker.autoplayMs > 0;
  }

  static autoplay(_ctx: hsm.Context, instance: hsm.Instance): void {
    if (!(instance instanceof Maker)) return;
    Maker.load(instance, "code");
  }

  static hasTask(_ctx: hsm.Context, _instance: hsm.Instance, event: hsm.Event): boolean {
    return isTaskId(field(event, "task"));
  }

  static hasText(_ctx: hsm.Context, _instance: hsm.Instance, event: hsm.Event): boolean {
    const text = field(event, "text");
    return typeof text === "string" && text.trim() !== "";
  }

  static hasMoreSteps(_ctx: hsm.Context, instance: hsm.Instance): boolean {
    return instance instanceof Maker && instance.task !== null && instance.step < instance.task.steps.length;
  }

  static isLastStep(ctx: hsm.Context, instance: hsm.Instance): boolean {
    return !Maker.hasMoreSteps(ctx, instance);
  }

  static enterChoosing(ctx: hsm.Context, instance: hsm.Instance): void {
    if (!(instance instanceof Maker)) return;
    instance.task = null;
    instance.lines = [];
    instance.skill = null;
    instance.spent = 0;
    instance.runs = 0;
    instance.freeRuns = 0;
    instance.runCost = 0;
    Maker.show(ctx, instance, "normal");
  }

  static pick(_ctx: hsm.Context, instance: hsm.Instance, event: hsm.Event): void {
    const id = field(event, "task");
    if (instance instanceof Maker && isTaskId(id)) Maker.load(instance, id);
  }

  private static load(instance: Maker, id: TaskId): void {
    instance.autoplayed = true;
    instance.task = TASKS[id];
    instance.lines = [];
    instance.skill = null;
    instance.spent = 0;
    instance.runs = 0;
    instance.freeRuns = 0;
    instance.step = 0;
    instance.runCost = 0;
  }

  static beginRun(ctx: hsm.Context, instance: hsm.Instance): void {
    if (!(instance instanceof Maker) || instance.task === null) return;
    instance.step = 0;
    instance.runCost = 0;
    instance.lines.push({ who: "you", text: instance.task.ask });
    Maker.show(ctx, instance, "normal");
  }

  static spendStep(ctx: hsm.Context, instance: hsm.Instance): void {
    if (!(instance instanceof Maker) || instance.task === null) return;
    const step = instance.task.steps[instance.step];
    if (step === undefined) return;
    instance.step += 1;
    instance.runCost += step.cost;
    instance.spent += step.cost;
    instance.lines.push({ who: "step", text: step.text, cost: step.cost });
    Maker.show(ctx, instance, "focused");
  }

  static enterReviewing(ctx: hsm.Context, instance: hsm.Instance): void {
    if (!(instance instanceof Maker) || instance.task === null) return;
    instance.runs += 1;
    instance.lines.push({ who: "result", text: instance.task.result });
    Maker.show(ctx, instance, "normal");
  }

  static enterLearning(ctx: hsm.Context, instance: hsm.Instance, event: hsm.Event): void {
    if (!(instance instanceof Maker)) return;
    const text = field(event, "text");
    instance.lines.push({ who: "you", text: typeof text === "string" ? text.trim() : "" });
    Maker.show(ctx, instance, "surprised");
  }

  static enterLearned(ctx: hsm.Context, instance: hsm.Instance): void {
    if (!(instance instanceof Maker) || instance.task === null) return;
    instance.skill = instance.task.skill;
    instance.lines.push({ who: "bot", text: "got it. I'll do it that way from now on." });
    Maker.show(ctx, instance, "happy", "learned");
  }

  static enterReady(ctx: hsm.Context, instance: hsm.Instance): void {
    if (!(instance instanceof Maker)) return;
    Maker.show(ctx, instance, "happy");
  }

  static enterReplaying(ctx: hsm.Context, instance: hsm.Instance): void {
    if (!(instance instanceof Maker) || instance.task === null) return;
    instance.runCost = 0;
    instance.lines.push({ who: "you", text: instance.task.ask });
    // First free run shows its work; after that one line is enough.
    if (instance.freeRuns === 0) {
      for (const text of instance.task.learnedSteps) instance.lines.push({ who: "step", text, cost: 0 });
    }
    Maker.show(ctx, instance, "focused");
  }

  static enterReplayed(ctx: hsm.Context, instance: hsm.Instance): void {
    if (!(instance instanceof Maker) || instance.task === null) return;
    instance.runs += 1;
    instance.freeRuns += 1;
    instance.lines.push({ who: "result", text: instance.task.learnedResult, cost: 0 });
    // The first free run is the payoff the whole demo builds to.
    Maker.show(ctx, instance, "happy", instance.freeRuns === 1 ? "free" : undefined);
  }

  static forget(ctx: hsm.Context, instance: hsm.Instance): void {
    if (!(instance instanceof Maker)) return;
    instance.skill = null;
    instance.step = 0;
    instance.lines.push({ who: "note", text: "forgot it. next run is back on the meter." });
    Maker.show(ctx, instance, "worried");
  }

  /** What the same number of runs would have cost if every one hit the model. */
  wouldHaveSpent(): number {
    return this.task === null ? 0 : this.runs * firstRunCost(this.task);
  }

  /**
   * Tell the owner something changed. `moment` names a milestone worth reacting
   * to ("learned" when it keeps the lesson, "free" on the first run that costs
   * nothing), because the state path read during an entry
   * action can still be the previous state.
   */
  private static show(_ctx: hsm.Context, instance: Maker, expression: ExpressionName, moment?: MakerMoment): void {
    instance.expression = expression;
    void hsm.notifyOwner({
      instance,
      event: hsm.typedEvent({ event: Maker.changedEvent, data: { state: instance.state(), moment } }),
    }).catch(hsm.catchFailure(hsm.ownerTarget(instance)));
  }
}

/**
 * Which of the demo's three beats is current, from a Maker state path:
 * 1 it does the job, 2 you correct it, 3 it runs free, 4 all done.
 */
export function phaseOf(state: string, freeRuns: number): number {
  if (state.endsWith("/reviewing") || state.endsWith("/learning")) return 2;
  if (state.startsWith("/Maker/learned")) return freeRuns > 0 ? 4 : 3;
  return 1;
}

function field(event: hsm.Event, key: string): unknown {
  const data = event.data;
  return hsm.isRecord(data) ? data[key] : undefined;
}

/**
 * Start a Maker under `ctx`.
 *
 * Outputs: a started Maker in `/Maker/choosing`. Ownership: caller must
 * `hsm.stop` it. Units: delays in milliseconds (`Maker.*Ms`), costs in dollars.
 */
export function startMaker(args: { ctx: hsm.Context }): Maker {
  return hsm.start({ ctx: args.ctx, instance: new Maker(), model: Maker.model });
}
