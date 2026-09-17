import * as hsm from "../hsm.ts";

import { EYE_SHAPES, type EyeShape, type EyeShapeName } from "./presets.ts";

/** Milliseconds for one lid direction. A blink is close + open. */
export const LID_MS = 90;

/** `hsm.after` takes a time expression, not a literal. */
const lidDelay = (): number => LID_MS;

/**
 * One eye's lid, as topology rather than a tween flag.
 *
 * `open` is the resting state. A blink is `closing` -> `closed` -> `opening`,
 * each a real state with a modeled `hsm.after` timeout, so "is this eye mid
 * blink" is answered by the state path and never by a boolean.
 *
 * The eye owns lid position only. Expression shape is supplied by the owner on
 * every render, because which shape an eye wears is the face's decision, not
 * the eye's.
 */
export class Eye extends hsm.Instance {
  static readonly blinkEvent = { name: "eye.blink", kind: hsm.Kinds.Event } as const;
  static readonly closeEvent = { name: "eye.close", kind: hsm.Kinds.Event } as const;
  static readonly openEvent = { name: "eye.open", kind: hsm.Kinds.Event } as const;
  static readonly lidChangedEvent = { name: "eye.lid_changed", kind: hsm.Kinds.Event } as const;

  static readonly model = hsm.define(
    "Eye",
    hsm.initial(hsm.target("open")),
    hsm.state(
      "open",
      hsm.entry(Eye.enterOpen),
      hsm.transition(hsm.on(Eye.blinkEvent.name), hsm.target("../closing")),
      hsm.transition(hsm.on(Eye.closeEvent.name), hsm.target("../closing")),
    ),
    hsm.state(
      "closing",
      hsm.entry(Eye.enterClosing),
      hsm.transition(hsm.after(lidDelay), hsm.target("../closed")),
      hsm.transition(hsm.on(Eye.openEvent.name), hsm.target("../opening")),
    ),
    hsm.state(
      "closed",
      hsm.entry(Eye.enterClosed),
      // A blink reopens on its own; an explicit close stays shut until told.
      hsm.transition(hsm.after(lidDelay), hsm.target("../opening"), hsm.guard(Eye.isBlinking)),
      hsm.transition(hsm.on(Eye.openEvent.name), hsm.target("../opening")),
      hsm.transition(hsm.on(Eye.blinkEvent.name), hsm.target("../opening")),
    ),
    hsm.state(
      "opening",
      hsm.entry(Eye.enterOpening),
      hsm.transition(hsm.after(lidDelay), hsm.target("../open")),
      hsm.transition(hsm.on(Eye.closeEvent.name), hsm.target("../closing")),
      hsm.transition(hsm.on(Eye.blinkEvent.name), hsm.target("../closing")),
    ),
  );

  /** 1 is wide open, 0 is shut. Read by the renderer every frame. */
  lid = 1;

  /** True while the current closure came from a blink and should self-reopen. */
  blinking = false;

  static isBlinking(_ctx: hsm.Context, instance: hsm.Instance): boolean {
    return instance instanceof Eye && instance.blinking;
  }

  static enterOpen(_ctx: hsm.Context, instance: hsm.Instance): void {
    if (!(instance instanceof Eye)) return;
    instance.lid = 1;
    instance.blinking = false;
    Eye.announce(instance);
  }

  static enterClosing(_ctx: hsm.Context, instance: hsm.Instance, event: hsm.Event): void {
    if (!(instance instanceof Eye)) return;
    instance.blinking = event.name === Eye.blinkEvent.name;
    instance.lid = 0.5;
    Eye.announce(instance);
  }

  static enterClosed(_ctx: hsm.Context, instance: hsm.Instance): void {
    if (!(instance instanceof Eye)) return;
    instance.lid = 0;
    Eye.announce(instance);
  }

  static enterOpening(_ctx: hsm.Context, instance: hsm.Instance): void {
    if (!(instance instanceof Eye)) return;
    instance.blinking = false;
    instance.lid = 0.5;
    Eye.announce(instance);
  }

  private static announce(instance: Eye): void {
    void hsm.notifyOwner({
      instance,
      event: hsm.typedEvent({ event: Eye.lidChangedEvent, data: { lid: instance.lid } }),
    }).catch(hsm.catchFailure(hsm.ownerTarget(instance)));
  }
}

/**
 * Start an Eye under `ctx`.
 *
 * Inputs: `ctx` — owner context used as the HSM parent environment.
 * Outputs: a started Eye in `/Eye/open`.
 * Ownership: caller owns the returned actor and must `hsm.stop` it.
 * Lifetime: until `hsm.stop` or owner context cancel.
 * Failure modes: none; unknown events are ignored by HSM semantics.
 * Units: `lid` unitless 0..1; `LID_MS` milliseconds.
 * Classification: runtime-safe.
 */
export function startEye(args: { ctx: hsm.Context }): Eye {
  return hsm.start({ ctx: args.ctx, instance: new Eye(), model: Eye.model });
}

export function shapeOf(name: EyeShapeName): EyeShape {
  return EYE_SHAPES[name];
}
