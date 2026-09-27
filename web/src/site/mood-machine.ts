import * as hsm from "../hsm.ts";
import { isExpressionName, type ExpressionName } from "../face/presets.ts";

/**
 * What the owner should do to every bot on the page right now.
 *
 * `express` shows `Mood.expression`; `sleep` and `wake` close and open the
 * eyes; `cheer` is express happy plus a spin.
 */
export type MoodCue = "express" | "sleep" | "wake" | "cheer";

const dozeDelay = (): number => Mood.dozeMs;
const reactDelay = (): number => Mood.reactMs;
const wakeDelay = (): number => Mood.wakeMs;
const cheerDelay = (): number => Mood.cheerMs;

/**
 * The homepage's mood: how every bot on the page feels about the visitor.
 *
 * `awake/calm` re-arms a doze timer on every sign of life; left alone long
 * enough the page goes to `dozing` (eyes shut). Any activity then goes through
 * `waking` (a startled look) back to `calm`. `awake/reacting` holds a short
 * expression (a switch flipped, a lesson learned). `cheering` is the demo
 * going free and wins from anywhere. `nap` puts it straight to sleep, for when
 * the tab is hidden.
 *
 * The machine only decides; it tells its owner a `MoodCue` and the owner
 * moves the bots.
 */
export class Mood extends hsm.Instance {
  static readonly activityEvent = { name: "mood.activity", kind: hsm.Kinds.Event } as const;
  static readonly reactEvent = { name: "mood.react", kind: hsm.Kinds.Event } as const;
  static readonly cheerEvent = { name: "mood.cheer", kind: hsm.Kinds.Event } as const;
  static readonly napEvent = { name: "mood.nap", kind: hsm.Kinds.Event } as const;
  static readonly changedEvent = { name: "mood.changed", kind: hsm.Kinds.Event } as const;

  /** Quiet time before the bots nod off. */
  static dozeMs = 18000;
  static reactMs = 1400;
  static wakeMs = 900;
  static cheerMs = 2600;

  static readonly model = hsm.define(
    "Mood",
    hsm.initial(hsm.target("awake")),
    hsm.state(
      "awake",
      hsm.initial(hsm.target("calm")),
      hsm.state(
        "calm",
        // Re-entering `calm` is what restarts the doze timer.
        hsm.transition(hsm.on(Mood.activityEvent.name), hsm.target("../calm")),
        hsm.transition(hsm.after(dozeDelay), hsm.target("/Mood/dozing")),
      ),
      hsm.state(
        "reacting",
        hsm.entry(Mood.showReaction),
        hsm.exit(Mood.relax),
        hsm.transition(hsm.after(reactDelay), hsm.target("../calm")),
      ),
      hsm.transition(hsm.on(Mood.reactEvent.name), hsm.guard(Mood.hasExpression), hsm.target("/Mood/awake/reacting")),
    ),
    hsm.state(
      "dozing",
      hsm.entry(Mood.nodOff),
      hsm.exit(Mood.openEyes),
      hsm.transition(hsm.on(Mood.activityEvent.name), hsm.target("../waking")),
      hsm.transition(hsm.on(Mood.reactEvent.name), hsm.target("../waking")),
    ),
    hsm.state(
      "waking",
      hsm.entry(Mood.startle),
      hsm.exit(Mood.relax),
      hsm.transition(hsm.after(wakeDelay), hsm.target("../awake")),
    ),
    hsm.state(
      "cheering",
      hsm.entry(Mood.cheer),
      hsm.exit(Mood.relax),
      hsm.transition(hsm.after(cheerDelay), hsm.target("../awake")),
    ),
    hsm.transition(hsm.on(Mood.cheerEvent.name), hsm.target("/Mood/cheering")),
    hsm.transition(hsm.on(Mood.napEvent.name), hsm.target("/Mood/dozing")),
  );

  expression: ExpressionName = "normal";
  cue: MoodCue = "express";

  static hasExpression(_ctx: hsm.Context, _instance: hsm.Instance, event: hsm.Event): boolean {
    return isExpressionName(expressionOf(event));
  }

  static showReaction(_ctx: hsm.Context, instance: hsm.Instance, event: hsm.Event): void {
    const expression = expressionOf(event);
    if (instance instanceof Mood && isExpressionName(expression)) Mood.tell(instance, "express", expression);
  }

  static relax(_ctx: hsm.Context, instance: hsm.Instance): void {
    if (instance instanceof Mood) Mood.tell(instance, "express", "normal");
  }

  static nodOff(_ctx: hsm.Context, instance: hsm.Instance): void {
    if (instance instanceof Mood) Mood.tell(instance, "sleep", "sleepy");
  }

  static openEyes(_ctx: hsm.Context, instance: hsm.Instance): void {
    if (instance instanceof Mood) Mood.tell(instance, "wake", "normal");
  }

  static startle(_ctx: hsm.Context, instance: hsm.Instance): void {
    if (instance instanceof Mood) Mood.tell(instance, "express", "surprised");
  }

  static cheer(_ctx: hsm.Context, instance: hsm.Instance): void {
    if (instance instanceof Mood) Mood.tell(instance, "cheer", "happy");
  }

  private static tell(instance: Mood, cue: MoodCue, expression: ExpressionName): void {
    instance.cue = cue;
    instance.expression = expression;
    void hsm.notifyOwner({
      instance,
      event: hsm.typedEvent({ event: Mood.changedEvent, data: { cue, expression } }),
    }).catch(hsm.catchFailure(hsm.ownerTarget(instance)));
  }
}

function expressionOf(event: hsm.Event): unknown {
  const data = event.data;
  return hsm.isRecord(data) ? data["expression"] : undefined;
}

/**
 * Start a Mood under `ctx`.
 *
 * Outputs: a started Mood in `/Mood/awake/calm`. Ownership: caller must
 * `hsm.stop` it. Units: delays in milliseconds (`Mood.*Ms`).
 */
export function startMood(args: { ctx: hsm.Context }): Mood {
  return hsm.start({ ctx: args.ctx, instance: new Mood(), model: Mood.model });
}
