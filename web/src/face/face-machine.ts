import * as hsm from "../hsm.ts";

import { Eye, startEye } from "./eye.ts";
import {
  EXPRESSIONS,
  EYE_SHAPES,
  isExpressionName,
  withOpenness,
  type ExpressionName,
  type EyeShape,
} from "./presets.ts";

/** Idle gap before a spontaneous blink, jittered so it never looks metronomic. */
const BLINK_MIN_MS = 2400;
const BLINK_MAX_MS = 6200;

const blinkDelay = (): number => BLINK_MIN_MS + Math.random() * (BLINK_MAX_MS - BLINK_MIN_MS);

/**
 * The face: which expression the bot is wearing, and whether it is awake.
 *
 * Expression is a state, not a string field, so "what is the bot showing" is
 * answered by the state path. `awake` blinks on an `hsm.after` cycle; `asleep`
 * holds the lids shut and does not blink, because a sleeping thing does not
 * blink.
 *
 * The face owns two Eye actors and tells them when to blink. It does not draw:
 * the element renders from `shapes()` whenever the face says something changed.
 */
export class Face extends hsm.Instance {
  static readonly expressEvent = { name: "face.express", kind: hsm.Kinds.Event } as const;
  static readonly blinkEvent = { name: "face.blink", kind: hsm.Kinds.Event } as const;
  static readonly sleepEvent = { name: "face.sleep", kind: hsm.Kinds.Event } as const;
  static readonly wakeEvent = { name: "face.wake", kind: hsm.Kinds.Event } as const;
  static readonly changedEvent = { name: "face.changed", kind: hsm.Kinds.Event } as const;

  static readonly model = hsm.define(
    "Face",
    hsm.initial(hsm.target("awake")),
    hsm.state(
      "awake",
      hsm.initial(hsm.target("showing")),
      hsm.state(
        "showing",
        hsm.entry(Face.announce),
        // Spontaneous blink on an idle timer, then straight back to showing.
        hsm.transition(hsm.after(blinkDelay), hsm.target("../blinking")),
        hsm.transition(hsm.on(Face.blinkEvent.name), hsm.target("../blinking")),
      ),
      hsm.state(
        "blinking",
        hsm.entry(Face.blinkEyes),
        hsm.transition(hsm.after(Face.blinkHold), hsm.target("../showing")),
      ),
      hsm.transition(hsm.on(Face.expressEvent.name), hsm.effect(Face.setExpression)),
      hsm.transition(hsm.on(Face.sleepEvent.name), hsm.target("../asleep")),
    ),
    hsm.state(
      "asleep",
      hsm.entry(Face.closeEyes),
      hsm.exit(Face.openEyes),
      hsm.transition(hsm.on(Face.wakeEvent.name), hsm.target("../awake")),
      hsm.transition(hsm.on(Face.expressEvent.name), hsm.effect(Face.setExpression)),
    ),
  );

  expression: ExpressionName = "normal";
  left: Eye | null = null;
  right: Eye | null = null;

  /** Hold long enough for both lid directions to finish. */
  static blinkHold(): number {
    return 260;
  }

  /** Current drawn shape per side, expression shape scaled by each eye's lid. */
  shapes(): { readonly left: EyeShape; readonly right: EyeShape } {
    const pair = EXPRESSIONS[this.expression];
    return {
      left: withOpenness(EYE_SHAPES[pair.left], this.left?.lid ?? 1),
      right: withOpenness(EYE_SHAPES[pair.right], this.right?.lid ?? 1),
    };
  }

  static setExpression(_ctx: hsm.Context, instance: hsm.Instance, event: hsm.Event): void {
    if (!(instance instanceof Face)) return;
    const data = event.data;
    const next = hsm.isRecord(data) ? data["expression"] : undefined;
    if (!isExpressionName(next) || next === instance.expression) return;
    instance.expression = next;
    Face.announce(_ctx, instance);
  }

  static blinkEyes(_ctx: hsm.Context, instance: hsm.Instance): void {
    if (!(instance instanceof Face)) return;
    Face.tellEyes(instance, Eye.blinkEvent);
  }

  static closeEyes(_ctx: hsm.Context, instance: hsm.Instance): void {
    if (!(instance instanceof Face)) return;
    Face.tellEyes(instance, Eye.closeEvent);
    Face.announce(_ctx, instance);
  }

  static openEyes(_ctx: hsm.Context, instance: hsm.Instance): void {
    if (!(instance instanceof Face)) return;
    Face.tellEyes(instance, Eye.openEvent);
  }

  static announce(_ctx: hsm.Context, instance: hsm.Instance): void {
    if (!(instance instanceof Face)) return;
    void hsm.notifyOwner({
      instance,
      event: hsm.typedEvent({ event: Face.changedEvent, data: { expression: instance.expression } }),
    }).catch(hsm.catchFailure(hsm.ownerTarget(instance)));
  }

  /**
   * Tell both eyes the same thing.
   *
   * A dispatch racing the eye's own stop rejects with the library's
   * "requires a started HSM"; that is the face shutting down, not a fault, so
   * it is classified against the eye that refused it and dropped.
   */
  private static tellEyes(instance: Face, event: { readonly name: string; readonly kind: hsm.Event["kind"] }): void {
    for (const eye of [instance.left, instance.right]) {
      if (eye === null) continue;
      void Promise.resolve(hsm.dispatch(eye, hsm.typedEvent({ event }))).catch((error: unknown) => {
        if (hsm.hostDropFrom({ error, host: eye }) !== null) return;
        hsm.catchFailure(hsm.ownerTarget(instance))(error);
      });
    }
  }
}

/**
 * Start a Face and its two Eye actors under `ctx`.
 *
 * Inputs: `ctx` — owner context used as the HSM parent environment.
 * Outputs: a started Face in `/Face/awake/showing` owning two started Eyes.
 * Ownership: caller owns the Face and must `hsm.stop` it; stopping the Face
 * stops the eyes it owns.
 * Lifetime: until `hsm.stop` or owner context cancel.
 * Failure modes: eye dispatch failures surface as host-drop on the owner.
 * Units: blink timings in milliseconds.
 * Classification: runtime-safe.
 */
export function startFace(args: { ctx: hsm.Context }): Face {
  const face = hsm.start({ ctx: args.ctx, instance: new Face(), model: Face.model });
  face.left = startEye({ ctx: face.context() });
  face.right = startEye({ ctx: face.context() });
  return face;
}
