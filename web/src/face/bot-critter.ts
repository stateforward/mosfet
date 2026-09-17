import * as hsm from "../hsm.ts";

import { resizeCanvasToHost, type CanvasPaint } from "./canvas.ts";
import {
  CRITTER_POSES,
  DEFAULT_GEOMETRY,
  drawCritter,
  shade,
  stepSpring, type CritterGeometry, type CritterHits, type CritterPose, type Spring, type StalkPose } from "./critter.ts";
import { Face, startFace } from "./face-machine.ts";
import { Drive, startDrive, type DriveView } from "./drive.ts";
import { Gaze, startGaze } from "./gaze.ts";
import { Reaction, startReaction, type PokeTarget } from "./reaction.ts";
import { parseExpression, type ExpressionName } from "./presets.ts";

export const BOT_CRITTER_TAG = "bot-critter";

/** Pointer distance, in CSS px, that counts as looking all the way to one side. */
const TRACK_REACH_PX = 420;
/** Degrees a stalk bends toward what its eye is looking at. */
const GAZE_BEND_DEG = 16;
const LID_EASE = 0.5;

const template = document.createElement("template");
template.innerHTML = `
  <style>
    :host { display: inline-block; inline-size: 8rem; block-size: 8rem; }
    :host([hidden]) { display: none; }
    canvas { display: block; inline-size: 100%; block-size: 100%; }
  </style>
  <canvas aria-hidden="true"></canvas>
`;

type StalkMotion = { length: Spring; lean: Spring; droop: Spring; lookX: Spring; lookY: Spring; lid: number };

const motion = (): StalkMotion => ({
  length: { value: 0.2, velocity: 0 },
  lean: { value: 40, velocity: 0 },
  droop: { value: 0, velocity: 0 },
  lookX: { value: 0, velocity: 0 },
  lookY: { value: 0, velocity: 0 },
  lid: 1,
});

/**
 * The mosfet bot: a round body with two eye stalks, as a custom element that is
 * an HSM host.
 *
 * Behavior lives in machines the element starts under its own context: `Face`
 * owns expression and blinking, and each stalk has its own `Gaze`, so the eyes
 * wander independently and only agree when something (the pointer) holds both
 * their attention. The element owns presentation only: springs, sway, and
 * drawing.
 *
 *     <bot-critter expression="surprised" track ink="#141414" eye="#f2ede3"></bot-critter>
 */
export class BotCritterElement extends hsm.from(HTMLElement) {
  static get observedAttributes(): string[] {
    return ["expression", "ink", "eye", "pupil", "tire", "arm"];
  }

  static readonly shownEvent = { name: "critter.shown", kind: hsm.Kinds.Event } as const;
  static readonly hiddenEvent = { name: "critter.hidden", kind: hsm.Kinds.Event } as const;

  /**
   * Painting is topology: `onscreen` owns the animation loop (entry starts it,
   * exit cancels it), so an offscreen critter costs nothing and "is it
   * animating" is the state path.
   */
  static readonly model = hsm.define(
    "BotCritter",
    hsm.initial(hsm.target("offscreen")),
    hsm.state(
      "offscreen",
      hsm.transition(hsm.on(BotCritterElement.shownEvent.name), hsm.target("../onscreen")),
    ),
    hsm.state(
      "onscreen",
      hsm.entry(BotCritterElement.startPainting),
      hsm.exit(BotCritterElement.stopPainting),
      hsm.transition(hsm.on(BotCritterElement.hiddenEvent.name), hsm.target("../offscreen")),
    ),
    // The Reaction machine decides when to run off; the host just drives.
    hsm.transition(hsm.on(Reaction.fleeEvent.name), hsm.effect(BotCritterElement.runAway)),
    hsm.transition(hsm.on(Reaction.returnEvent.name), hsm.effect(BotCritterElement.returnHome)),
  );

  static runAway(_ctx: hsm.Context, instance: hsm.Instance): void {
    if (!(instance instanceof BotCritterElement)) return;
    instance.roll((instance.#drive?.x ?? 0) > 0 ? -1 : 1);
  }

  static returnHome(_ctx: hsm.Context, instance: hsm.Instance): void {
    if (instance instanceof BotCritterElement) instance.roll(0);
  }

  static startPainting(_ctx: hsm.Context, instance: hsm.Instance): void {
    if (instance instanceof BotCritterElement) instance.#schedule();
  }

  static stopPainting(_ctx: hsm.Context, instance: hsm.Instance): void {
    if (!(instance instanceof BotCritterElement) || instance.#frame === 0) return;
    cancelAnimationFrame(instance.#frame);
    instance.#frame = 0;
  }

  #root: ShadowRoot;
  #canvas: HTMLCanvasElement | null = null;
  #face: Face | null = null;
  #gazes: { left: Gaze | null; right: Gaze | null } = { left: null, right: null };
  #stalks = { left: motion(), right: motion() };
  #drive: Drive | null = null;
  #reaction: Reaction | null = null;
  #hits: CritterHits | null = null;
  #seenPokes = 0;
  #heading: Spring = { value: 0, velocity: 0 };
  #x: Spring = { value: 0, velocity: 0 };
  #wheel = 0;
  #swing: Spring = { value: 0, velocity: 0 };
  #geometry: CritterGeometry = DEFAULT_GEOMETRY;
  #pupilShade = 0.25;
  #tireShade = 0.5;
  #armShade = 0.62;
  #arm: CanvasPaint = shade("#141414", 0.62);
  #tire: CanvasPaint = shade("#141414", 0.5);
  #ink: CanvasPaint = "#141414";
  #eye: CanvasPaint = "#f7f3ea";
  #pupil: CanvasPaint = shade("#141414", 0.25);
  #frame = 0;
  #visibility: IntersectionObserver | null = null;
  #pointer: { x: number; y: number } | null = null;
  #onPointer = (event: PointerEvent): void => {
    this.#pointer = { x: event.clientX, y: event.clientY };
  };
  #onPoke = (event: PointerEvent): void => {
    const target = this.#hitTest(event);
    if (target !== null) this.poke(target);
  };

  constructor() {
    super();
    this.#root = this.attachShadow({ mode: "open" });
  }

  get expression(): ExpressionName {
    return this.#face?.expression ?? parseExpression(this.getAttribute("expression"));
  }

  connectedCallback(): void {
    if (this.#canvas === null) {
      this.#root.append(template.content.cloneNode(true));
      this.#canvas = this.#root.querySelector("canvas");
    }
    hsm.ensureStarted({ instance: this, model: BotCritterElement.model });
    this.#face = startFace({ ctx: this.context() });
    this.#gazes = { left: startGaze({ ctx: this.context() }), right: startGaze({ ctx: this.context() }) };
    this.#drive = startDrive({ ctx: this.context() });
    this.#reaction = startReaction({ ctx: this.context() });
    this.#readAttributes();
    this.addEventListener("pointerdown", this.#onPoke);
    this.express(parseExpression(this.getAttribute("expression")));
    globalThis.addEventListener("pointermove", this.#onPointer, { passive: true });
    this.#visibility = new IntersectionObserver((entries) => {
      const shown = entries.some((entry) => entry.isIntersecting);
      this.#send(this, shown ? BotCritterElement.shownEvent : BotCritterElement.hiddenEvent);
    });
    this.#visibility.observe(this);
  }

  disconnectedCallback(): void {
    globalThis.removeEventListener("pointermove", this.#onPointer);
    this.removeEventListener("pointerdown", this.#onPoke);
    this.#visibility?.disconnect();
    this.#visibility = null;
    this.#send(this, BotCritterElement.hiddenEvent);
    for (const machine of [this.#gazes.left, this.#gazes.right, this.#drive, this.#reaction, this.#face]) {
      if (machine !== null) void hsm.stop(machine).catch(hsm.catchFailure(this));
    }
    this.#drive = null;
    this.#reaction = null;
    this.#gazes = { left: null, right: null };
    this.#face = null;
  }

  attributeChangedCallback(name: string): void {
    if (name === "expression") {
      this.express(parseExpression(this.getAttribute("expression")));
      return;
    }
    this.#readAttributes();
  }

  /** Show an expression. */
  express(expression: ExpressionName): void {
    this.#send(this.#face, Face.expressEvent, { expression });
  }

  /** Blink both eyes, now. */
  blink(): void {
    this.#send(this.#face, Face.blinkEvent);
  }

  /** Close the eyes and stop idle blinking; the stalks droop. */
  sleep(): void {
    this.#send(this.#face, Face.sleepEvent);
  }

  /** Open the eyes and resume idle blinking. */
  wake(): void {
    this.#send(this.#face, Face.wakeEvent);
  }

  /** Spin a full turn in place. */
  spin(direction: 1 | -1 = 1): void {
    this.#send(this.#drive, Drive.spinEvent, { direction });
  }

  /** Turn to a view and stay there (no idle spins) until `release()`. */
  hold(view: DriveView): void {
    this.#send(this.#drive, Drive.holdEvent, { view });
  }

  /** Let go of a held view: face front and resume idle behavior. */
  release(): void {
    this.#send(this.#drive, Drive.releaseEvent);
  }

  /** Drive to `x` across the box (-1..1), turning to face the way it goes, then face front. */
  roll(x: number): void {
    this.#send(this.#drive, Drive.rollEvent, { x });
  }

  /** Current proportions and pupil shade, for tuning tools. */
  get tuning(): CritterGeometry & { readonly pupilShade: number; readonly tireShade: number; readonly armShade: number } {
    return { ...this.#geometry, pupilShade: this.#pupilShade, tireShade: this.#tireShade, armShade: this.#armShade };
  }

  /**
   * Adjust proportions live. Presentation only: unknown keys and non-finite
   * values are ignored, so a tuning panel can pass its form state straight in.
   */
  tune(changes: Partial<CritterGeometry & { pupilShade: number; tireShade: number; armShade: number }>): void {
    const next: Record<string, number> = { ...this.#geometry };
    for (const [key, value] of Object.entries(changes)) {
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      if (key === "pupilShade") this.#pupilShade = Math.max(0, Math.min(1, value));
      else if (key === "tireShade") this.#tireShade = Math.max(0, Math.min(1, value));
      else if (key === "armShade") this.#armShade = Math.max(0, Math.min(1, value));
      else if (key in DEFAULT_GEOMETRY) next[key] = value;
    }
    this.#geometry = next as CritterGeometry;
    this.#readAttributes();
  }

  /** Poke an eye or the body, as if clicked there. */
  poke(target: PokeTarget): void {
    this.#send(this.#reaction, Reaction.pokeEvent, { target, at: performance.now() });
  }

  /** Reaction state path, for the inspector. */
  reactionState(): string {
    return this.#reaction?.state() ?? "/Reaction/unstarted";
  }

  #hitTest(event: PointerEvent): PokeTarget | null {
    const hits = this.#hits;
    const canvas = this.#canvas;
    if (hits === null || canvas === null) return null;
    const box = canvas.getBoundingClientRect();
    const x = event.clientX - box.left;
    const y = event.clientY - box.top;
    // A little forgiveness around each eye: small targets are no fun to poke.
    for (const side of ["left", "right"] as const) {
      const eye = hits[side];
      if (Math.hypot(x - eye.x, y - eye.y) <= eye.r * 1.35) return side;
    }
    const body = hits.body;
    if (Math.abs(x - body.x) <= body.w / 2 && Math.abs(y - body.y) <= body.h) return "body";
    return null;
  }

  /** Drive state path, for the inspector. */
  driveState(): string {
    return this.#drive?.state() ?? "/Drive/unstarted";
  }

  /** Both eyes look at a point in -1..1; they wander off on their own once it goes still. */
  look(x: number, y: number): void {
    this.#send(this.#gazes.left, Gaze.lookEvent, { x, y });
    this.#send(this.#gazes.right, Gaze.lookEvent, { x, y });
  }

  /** Host state path: `/BotCritter/onscreen` while it is animating. */
  critterState(): string {
    return this.state();
  }

  /** Face state path, for the inspector. */
  faceState(): string {
    return this.#face?.state() ?? "/Face/unstarted";
  }

  #send(target: Parameters<typeof hsm.dispatch>[0] | null, event: { readonly name: string; readonly kind: hsm.Event["kind"] }, data?: unknown): void {
    if (target === null) return;
    void Promise.resolve(
      data === undefined ? hsm.dispatch(target, hsm.typedEvent({ event })) : hsm.dispatch(target, hsm.typedEvent({ event, data })),
    ).catch(hsm.catchFailure(this));
  }

  #readAttributes(): void {
    this.#ink = this.getAttribute("ink") ?? "#141414";
    this.#eye = this.getAttribute("eye") ?? "#f7f3ea";
    this.#pupil = this.getAttribute("pupil") ?? shade(this.#ink, this.#pupilShade);
    this.#tire = this.getAttribute("tire") ?? shade(this.#ink, this.#tireShade);
    this.#arm = this.getAttribute("arm") ?? shade(this.#ink, this.#armShade);
  }

  #schedule(): void {
    if (this.#frame !== 0 || !this.isConnected) return;
    this.#frame = requestAnimationFrame((now) => {
      this.#frame = 0;
      this.#paint(now);
      // Only the onscreen state keeps the loop alive; its exit cancels the next frame.
      if (/\/onscreen$/.test(this.state())) this.#schedule();
    });
  }

  #trackPointer(): void {
    const pointer = this.#pointer;
    this.#pointer = null;
    if (pointer === null || !this.hasAttribute("track")) return;
    const box = this.getBoundingClientRect();
    this.look(
      (pointer.x - (box.left + box.width / 2)) / TRACK_REACH_PX,
      (pointer.y - (box.top + box.height * 0.3)) / TRACK_REACH_PX,
    );
  }

  #paint(now: number): void {
    const face = this.#face;
    const canvas = this.#canvas;
    if (face === null || canvas === null) return;
    this.#trackPointer();

    // Asleep is a Face state, so the droop follows the state path rather than a flag.
    const pose = /\/asleep$/.test(face.state()) ? CRITTER_POSES.sleepy : CRITTER_POSES[face.expression];
    const reacting = this.#reactionPose(pose);
    const left = this.#stepStalk("left", reacting.left, face.left?.lid ?? 1, now);
    const right = this.#stepStalk("right", reacting.right, face.right?.lid ?? 1, now);
    this.#stepDrive();

    const ctx = resizeCanvasToHost(canvas, 128, 128);
    if (!ctx) return;
    const ratio = Math.max(1, globalThis.devicePixelRatio || 1);
    this.#hits = drawCritter(ctx, canvas.width / ratio, canvas.height / ratio, {
      left: { ...left, squeeze: reacting.squeeze === "left" },
      right: { ...right, squeeze: reacting.squeeze === "right" },
      heading: this.#heading.value,
      x: this.#x.value,
      wheel: this.#wheel,
      swing: this.#swing.value,
      geometry: this.#geometry,
      ink: this.#ink,
      eye: this.#eye,
      pupil: this.#pupil,
      tire: this.#tire,
      arm: this.#arm,
    });
  }

  /**
   * Override the expression's posture while the Reaction machine is in a
   * reacting state, and kick the poked stalk on every fresh poke.
   */
  #reactionPose(pose: CritterPose): { left: StalkPose; right: StalkPose; squeeze: "left" | "right" | null } {
    const reaction = this.#reaction;
    const state = reaction?.state() ?? "";
    const side = reaction?.side;
    if (reaction !== null && reaction.pokes !== this.#seenPokes) {
      this.#seenPokes = reaction.pokes;
      if (side === "left" || side === "right") {
        // Recoil: the poked stalk snaps short and flinches outward.
        this.#stalks[side].length.velocity -= 0.14;
        this.#stalks[side].lean.velocity += 9;
      } else {
        // Giggle: a quick back-and-forth wiggle on the wheels.
        this.#heading.velocity += 0.09;
      }
    }
    const poked = side === "left" || side === "right" ? side : null;
    const other = poked === "left" ? "right" : "left";
    if (state.endsWith("/ouch") && poked !== null) {
      const hurt = { ...pose[poked], length: 0.45, lean: 40, wobble: 10 };
      const shocked = CRITTER_POSES.surprised[other];
      return { ...(poked === "left" ? { left: hurt, right: shocked } : { left: shocked, right: hurt }), squeeze: poked };
    }
    if (state.endsWith("/glaring")) return { ...CRITTER_POSES.angry, squeeze: null };
    if (state.endsWith("/giggling")) return { ...CRITTER_POSES.happy, squeeze: null };
    if (state.endsWith("/fleeing")) return { ...CRITTER_POSES.worried, squeeze: null };
    return { left: pose.left, right: pose.right, squeeze: null };
  }

  /** Spring toward the Drive's heading and position; the wheels turn with both. */
  #stepDrive(): void {
    const drive = this.#drive;
    stepSpring(this.#heading, drive?.heading ?? 0, 0.045, 0.84);
    stepSpring(this.#x, drive?.x ?? 0, 0.03, 0.86);
    // Standing still, the side arms splay forward to plant a tripod; on the move they trail back a little.
    const moving = /\/(rolling|spinning)$/.test(drive?.state() ?? "");
    stepSpring(this.#swing, moving ? -this.#geometry.armSwing * 0.35 : this.#geometry.armSwing, 0.05, 0.82);
    // Rolling turns the wheels forward; spinning in place turns them too.
    this.#wheel += this.#x.velocity * 9 + this.#heading.velocity * 2.2;
  }

  #stepStalk(side: "left" | "right", pose: StalkPose, lid: number, now: number) {
    const stalk = this.#stalks[side];
    const gaze = this.#gazes[side];
    const out = side === "left" ? -1 : 1;
    const gx = gaze?.x ?? 0;
    const gy = gaze?.y ?? 0;
    // Each stalk sways on its own phase so the eyes never move in lockstep.
    const sway = Math.sin(now / (side === "left" ? 820 : 960) + (side === "left" ? 0 : 1.7)) * pose.wobble;
    // Leaning "outward" is mirrored per side, so looking right bends the left stalk in and the right one out.
    const leanTarget = pose.lean + sway + out * gx * GAZE_BEND_DEG;
    const lengthTarget = pose.length - Math.max(0, gy) * 0.12 + Math.max(0, -gy) * 0.06;
    stepSpring(stalk.lean, leanTarget);
    stepSpring(stalk.length, lengthTarget);
    // Wilting is slow and heavy; perking back up is quick.
    const perking = pose.droop < stalk.droop.value;
    stepSpring(stalk.droop, pose.droop, perking ? 0.14 : 0.03, perking ? 0.75 : 0.86);
    stepSpring(stalk.lookX, gx, 0.22, 0.62);
    stepSpring(stalk.lookY, gy, 0.22, 0.62);
    stalk.lid += (Math.min(lid, 1) * pose.lid - stalk.lid) * LID_EASE;
    return {
      length: stalk.length.value,
      lean: stalk.lean.value,
      open: stalk.lid,
      pupil: pose.pupil,
      lookX: stalk.lookX.value,
      lookY: stalk.lookY.value,
      droop: stalk.droop.value,
    };
  }
}

export function defineBotCritterElement(): void {
  if (!customElements.get(BOT_CRITTER_TAG)) {
    customElements.define(BOT_CRITTER_TAG, BotCritterElement);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "bot-critter": BotCritterElement;
  }
}
