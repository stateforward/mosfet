import * as hsm from "../hsm.ts";

/** Idle gap before the bot spins on its own, jittered so it feels spontaneous. */
const IDLE_MIN_MS = 9000;
const IDLE_MAX_MS = 18000;
export const SPIN_MS = 1100;
export const ROLL_MS = 1300;

const idleDelay = (): number => IDLE_MIN_MS + Math.random() * (IDLE_MAX_MS - IDLE_MIN_MS);
const spinDelay = (): number => SPIN_MS;
const rollDelay = (): number => ROLL_MS;

const TURN = Math.PI * 2;

/**
 * The bot's wheels, as topology.
 *
 * `parked` faces the viewer and, left alone long enough, spins for fun.
 * `holding` turns to a requested view (front, left, right, back) and stays
 * there with no idle spins until released, which is for inspecting it.
 * `spinning` adds a full turn in place. `rolling` turns sideways toward where
 * it's going, drives there, and parks facing front again. "Is it moving" is the
 * state path, never a flag.
 *
 * `heading` (radians, 0 faces the viewer) and `x` (-1..1 across its box) are
 * targets; the renderer springs toward them, so the machine never tweens.
 */
export class Drive extends hsm.Instance {
  static readonly spinEvent = { name: "drive.spin", kind: hsm.Kinds.Event } as const;
  static readonly rollEvent = { name: "drive.roll", kind: hsm.Kinds.Event } as const;
  static readonly holdEvent = { name: "drive.hold", kind: hsm.Kinds.Event } as const;
  static readonly releaseEvent = { name: "drive.release", kind: hsm.Kinds.Event } as const;

  static readonly model = hsm.define(
    "Drive",
    hsm.initial(hsm.target("parked")),
    hsm.state(
      "parked",
      hsm.entry(Drive.faceFront),
      hsm.transition(hsm.after(idleDelay), hsm.target("../spinning")),
    ),
    hsm.state(
      "spinning",
      hsm.entry(Drive.addSpin),
      hsm.transition(hsm.after(spinDelay), hsm.target("../parked")),
    ),
    hsm.state(
      "rolling",
      hsm.entry(Drive.beginRoll),
      hsm.transition(hsm.after(rollDelay), hsm.target("../parked")),
    ),
    hsm.state(
      "holding",
      hsm.entry(Drive.turnToView),
      hsm.transition(hsm.on(Drive.holdEvent.name), hsm.guard(Drive.hasView), hsm.target("../holding")),
      hsm.transition(hsm.on(Drive.releaseEvent.name), hsm.target("../parked")),
    ),
    hsm.transition(hsm.on(Drive.holdEvent.name), hsm.guard(Drive.hasView), hsm.target("/Drive/holding")),
    hsm.transition(hsm.on(Drive.spinEvent.name), hsm.target("/Drive/spinning")),
    hsm.transition(hsm.on(Drive.rollEvent.name), hsm.guard(Drive.hasX), hsm.target("/Drive/rolling")),
  );

  heading = 0;
  x = 0;

  static hasX(_ctx: hsm.Context, _instance: hsm.Instance, event: hsm.Event): boolean {
    return targetX(event) !== null;
  }

  static hasView(_ctx: hsm.Context, _instance: hsm.Instance, event: hsm.Event): boolean {
    return viewOf(event) !== null;
  }

  /** Turn the shortest way to the requested view, from wherever it is now. */
  static turnToView(_ctx: hsm.Context, instance: hsm.Instance, event: hsm.Event): void {
    if (!(instance instanceof Drive)) return;
    const view = viewOf(event);
    if (view === null) return;
    const target = VIEW_HEADINGS[view];
    const delta = ((((target - instance.heading) % TURN) + TURN * 1.5) % TURN) - TURN / 2;
    instance.heading += delta;
  }

  static faceFront(_ctx: hsm.Context, instance: hsm.Instance): void {
    if (!(instance instanceof Drive)) return;
    instance.heading = Math.round(instance.heading / TURN) * TURN;
  }

  static addSpin(_ctx: hsm.Context, instance: hsm.Instance, event: hsm.Event): void {
    if (!(instance instanceof Drive)) return;
    const data = event.data;
    const direction = hsm.isRecord(data) && data["direction"] === -1 ? -1 : 1;
    instance.heading = Math.round(instance.heading / TURN) * TURN + direction * TURN;
  }

  static beginRoll(_ctx: hsm.Context, instance: hsm.Instance, event: hsm.Event): void {
    if (!(instance instanceof Drive)) return;
    const next = targetX(event);
    if (next === null) return;
    const front = Math.round(instance.heading / TURN) * TURN;
    // Turn a quarter toward the direction of travel, like a real two-wheeler would.
    instance.heading = front + (next >= instance.x ? 1 : -1) * (Math.PI / 2);
    instance.x = next;
  }
}

export type DriveView = "front" | "left" | "right" | "back";

/** Heading per view: "right" means it faces the viewer's right, showing its profile. */
const VIEW_HEADINGS: Record<DriveView, number> = { front: 0, right: Math.PI / 2, back: Math.PI, left: -Math.PI / 2 };

function viewOf(event: hsm.Event): DriveView | null {
  const data = event.data;
  const view = hsm.isRecord(data) ? data["view"] : undefined;
  return typeof view === "string" && view in VIEW_HEADINGS ? (view as DriveView) : null;
}

function targetX(event: hsm.Event): number | null {
  const data = event.data;
  const x = hsm.isRecord(data) ? data["x"] : undefined;
  return typeof x === "number" && Number.isFinite(x) ? Math.max(-1, Math.min(1, x)) : null;
}

/** Start a Drive under `ctx`. Caller owns it and must `hsm.stop` it. */
export function startDrive(args: { ctx: hsm.Context }): Drive {
  return hsm.start({ ctx: args.ctx, instance: new Drive(), model: Drive.model });
}
