import * as hsm from "../hsm.ts";

export type PokeTarget = "left" | "right" | "body";

export const OUCH_MS = 700;
export const GLARE_MS = 1600;
export const GIGGLE_MS = 600;
export const FLEE_MS = 2200;
/** Pokes inside this window count toward getting fed up. */
export const FED_UP_WINDOW_MS = 2500;
export const FED_UP_POKES = 3;

const ouchDelay = (): number => OUCH_MS;
const glareDelay = (): number => GLARE_MS;
const giggleDelay = (): number => GIGGLE_MS;
const fleeDelay = (): number => FLEE_MS;

/**
 * How the bot reacts to being poked, as topology.
 *
 * `calm` is the resting state. Poking an eye goes to `ouch` (that eye squeezes
 * shut, the stalk recoils), then `glaring` at whoever did it, then back to
 * `calm`. Poking the body goes to `giggling`. A third poke inside
 * `FED_UP_WINDOW_MS` goes to `fleeing`, which tells the owner to drive away and
 * come back when it's over.
 *
 * `side` is which eye got it; `pokes` counts every poke so a renderer can
 * detect a fresh one (and recoil again) even while already in `ouch`.
 */
export class Reaction extends hsm.Instance {
  static readonly pokeEvent = { name: "reaction.poke", kind: hsm.Kinds.Event } as const;
  static readonly fleeEvent = { name: "reaction.flee", kind: hsm.Kinds.Event } as const;
  static readonly returnEvent = { name: "reaction.return", kind: hsm.Kinds.Event } as const;

  static readonly model = hsm.define(
    "Reaction",
    hsm.initial(hsm.target("calm")),
    hsm.state(
      "calm",
      hsm.entry(Reaction.forgetSide),
      hsm.transition(hsm.on(Reaction.pokeEvent.name), hsm.guard(Reaction.isEyePoke), hsm.target("../ouch"), hsm.effect(Reaction.record)),
      hsm.transition(hsm.on(Reaction.pokeEvent.name), hsm.guard(Reaction.isBodyPoke), hsm.target("../giggling"), hsm.effect(Reaction.record)),
    ),
    hsm.state(
      "ouch",
      hsm.transition(hsm.after(ouchDelay), hsm.target("../glaring")),
      hsm.transition(hsm.on(Reaction.pokeEvent.name), hsm.guard(Reaction.isFedUp), hsm.target("../fleeing"), hsm.effect(Reaction.record)),
      hsm.transition(hsm.on(Reaction.pokeEvent.name), hsm.guard(Reaction.isEyePoke), hsm.target("../ouch"), hsm.effect(Reaction.record)),
    ),
    hsm.state(
      "glaring",
      hsm.transition(hsm.after(glareDelay), hsm.target("../calm")),
      hsm.transition(hsm.on(Reaction.pokeEvent.name), hsm.guard(Reaction.isFedUp), hsm.target("../fleeing"), hsm.effect(Reaction.record)),
      hsm.transition(hsm.on(Reaction.pokeEvent.name), hsm.guard(Reaction.isEyePoke), hsm.target("../ouch"), hsm.effect(Reaction.record)),
      hsm.transition(hsm.on(Reaction.pokeEvent.name), hsm.guard(Reaction.isBodyPoke), hsm.target("../giggling"), hsm.effect(Reaction.record)),
    ),
    hsm.state(
      "giggling",
      hsm.transition(hsm.after(giggleDelay), hsm.target("../calm")),
      hsm.transition(hsm.on(Reaction.pokeEvent.name), hsm.guard(Reaction.isFedUp), hsm.target("../fleeing"), hsm.effect(Reaction.record)),
      hsm.transition(hsm.on(Reaction.pokeEvent.name), hsm.guard(Reaction.isEyePoke), hsm.target("../ouch"), hsm.effect(Reaction.record)),
    ),
    hsm.state(
      "fleeing",
      hsm.entry(Reaction.flee),
      hsm.exit(Reaction.comeBack),
      // It's not listening while it runs away.
      hsm.transition(hsm.after(fleeDelay), hsm.target("../calm")),
    ),
  );

  side: PokeTarget | null = null;
  pokes = 0;
  /** Timestamps (ms) of recent pokes, for the fed-up window. */
  recent: number[] = [];

  static isEyePoke(_ctx: hsm.Context, _instance: hsm.Instance, event: hsm.Event): boolean {
    const target = targetOf(event);
    return target === "left" || target === "right";
  }

  static isBodyPoke(_ctx: hsm.Context, _instance: hsm.Instance, event: hsm.Event): boolean {
    return targetOf(event) === "body";
  }

  static isFedUp(_ctx: hsm.Context, instance: hsm.Instance, event: hsm.Event): boolean {
    if (!(instance instanceof Reaction) || targetOf(event) === null) return false;
    const now = timeOf(event);
    const inWindow = instance.recent.filter((at) => now - at < FED_UP_WINDOW_MS).length;
    return inWindow + 1 >= FED_UP_POKES;
  }

  static record(_ctx: hsm.Context, instance: hsm.Instance, event: hsm.Event): void {
    if (!(instance instanceof Reaction)) return;
    const now = timeOf(event);
    instance.side = targetOf(event);
    instance.pokes += 1;
    instance.recent = [...instance.recent.filter((at) => now - at < FED_UP_WINDOW_MS), now];
  }

  static forgetSide(_ctx: hsm.Context, instance: hsm.Instance): void {
    if (instance instanceof Reaction) instance.side = null;
  }

  static flee(_ctx: hsm.Context, instance: hsm.Instance): void {
    if (!(instance instanceof Reaction)) return;
    instance.recent = [];
    Reaction.tellOwner(instance, Reaction.fleeEvent);
  }

  static comeBack(_ctx: hsm.Context, instance: hsm.Instance): void {
    if (instance instanceof Reaction) Reaction.tellOwner(instance, Reaction.returnEvent);
  }

  private static tellOwner(instance: Reaction, event: { readonly name: string; readonly kind: hsm.Event["kind"] }): void {
    void hsm.notifyOwner({ instance, event: hsm.typedEvent({ event }) }).catch(hsm.catchFailure(hsm.ownerTarget(instance)));
  }
}

function targetOf(event: hsm.Event): PokeTarget | null {
  const data = event.data;
  const target = hsm.isRecord(data) ? data["target"] : undefined;
  return target === "left" || target === "right" || target === "body" ? target : null;
}

function timeOf(event: hsm.Event): number {
  const data = event.data;
  const at = hsm.isRecord(data) ? data["at"] : undefined;
  return typeof at === "number" && Number.isFinite(at) ? at : Date.now();
}

/** Start a Reaction under `ctx`. Caller owns it and must `hsm.stop` it. */
export function startReaction(args: { ctx: hsm.Context }): Reaction {
  return hsm.start({ ctx: args.ctx, instance: new Reaction(), model: Reaction.model });
}
