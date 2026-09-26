import * as hsm from "../hsm.ts";

/** Idle gap between spontaneous glances. */
const GLANCE_MIN_MS = 700;
const GLANCE_MAX_MS = 2600;
/** How long the eyes keep following something after it stops moving. */
export const TRACK_HOLD_MS = 2200;

const restDelay = (): number => GLANCE_MIN_MS + Math.random() * (GLANCE_MAX_MS - GLANCE_MIN_MS);
const trackHold = (): number => TRACK_HOLD_MS;
const glanceHold = (): number => 0;

/**
 * Where the eyes are looking, as topology.
 *
 * `wandering` glances somewhere new on a jittered `hsm.after`, mostly near the
 * middle, the way an idle thing looks around. A `look` event moves to
 * `tracking`, which follows the given point and falls back to wandering once it
 * has been still for `TRACK_HOLD_MS`. Re-entering `tracking` on every look is
 * what re-arms that hold.
 *
 * `x` and `y` are the target in -1..1 of the eye's travel; the renderer eases
 * toward them, so the machine never tweens.
 */
export class Gaze extends hsm.Instance {
  static readonly lookEvent = { name: "gaze.look", kind: hsm.Kinds.Event } as const;
  static readonly wanderEvent = { name: "gaze.wander", kind: hsm.Kinds.Event } as const;

  static readonly model = hsm.define(
    "Gaze",
    hsm.initial(hsm.target("wandering")),
    hsm.state(
      "wandering",
      hsm.initial(hsm.target("resting")),
      hsm.state(
        "resting",
        hsm.transition(hsm.after(restDelay), hsm.target("../glancing")),
      ),
      hsm.state(
        "glancing",
        hsm.entry(Gaze.glance),
        hsm.transition(hsm.after(glanceHold), hsm.target("../resting")),
      ),
    ),
    hsm.state(
      "tracking",
      hsm.entry(Gaze.follow),
      hsm.transition(hsm.after(trackHold), hsm.target("../wandering")),
      hsm.transition(hsm.on(Gaze.wanderEvent.name), hsm.target("../wandering")),
    ),
    hsm.transition(hsm.on(Gaze.lookEvent.name), hsm.guard(Gaze.hasPoint), hsm.target("/Gaze/tracking")),
  );

  x = 0;
  y = 0;

  static hasPoint(_ctx: hsm.Context, _instance: hsm.Instance, event: hsm.Event): boolean {
    return pointOf(event) !== null;
  }

  static follow(_ctx: hsm.Context, instance: hsm.Instance, event: hsm.Event): void {
    if (!(instance instanceof Gaze)) return;
    const point = pointOf(event);
    if (point === null) return;
    instance.x = point.x;
    instance.y = point.y;
  }

  static glance(_ctx: hsm.Context, instance: hsm.Instance): void {
    if (!(instance instanceof Gaze)) return;
    // Favor the middle: most glances are small, a few are big.
    if (Math.random() < 0.35) {
      instance.x = 0;
      instance.y = 0;
      return;
    }
    instance.x = (Math.random() * 2 - 1) * (Math.random() < 0.3 ? 1 : 0.5);
    instance.y = (Math.random() * 2 - 1) * 0.6;
  }
}

function pointOf(event: hsm.Event): { x: number; y: number } | null {
  const data = event.data;
  if (!hsm.isRecord(data)) return null;
  const x = data["x"];
  const y = data["y"];
  if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)) };
}

/** Start a Gaze under `ctx`. Caller owns it and must `hsm.stop` it. */
export function startGaze(args: { ctx: hsm.Context }): Gaze {
  return hsm.start({ ctx: args.ctx, instance: new Gaze(), model: Gaze.model });
}
