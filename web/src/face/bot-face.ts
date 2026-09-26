import * as hsm from "../hsm.ts";

import { drawEye, resizeCanvasToHost, type CanvasPaint } from "./canvas.ts";
import { Eye } from "./eye.ts";
import { Face, startFace } from "./face-machine.ts";
import { Gaze, startGaze } from "./gaze.ts";
import {
  blendShape,
  EXPRESSIONS,
  EYE_SHAPES,
  parseExpression,
  withOpenness,
  type EyeShape,
  type ExpressionName,
} from "./presets.ts";

/** Fraction of the remaining distance an expression change covers per frame. */
const EXPRESSION_EASE = 0.22;
/** Per-frame easing for gaze and lids. Lids are fast; eyes dart but settle. */
const GAZE_EASE = 0.2;
const LID_EASE = 0.55;
/** Pointer distance, in CSS px, that counts as looking all the way to one side. */
const TRACK_REACH_PX = 480;

export const BOT_FACE_TAG = "bot-face";

const template = document.createElement("template");
template.innerHTML = `
  <style>
    :host {
      align-items: center;
      block-size: 4rem;
      box-sizing: border-box;
      display: inline-grid;
      gap: 8%;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      inline-size: 8.5rem;
      justify-items: center;
      min-block-size: 1rem;
      min-inline-size: 2rem;
    }

    :host([hidden]) { display: none; }

    canvas {
      block-size: 100%;
      display: block;
      inline-size: 100%;
    }
  </style>
  <canvas part="eye left" aria-hidden="true"></canvas>
  <canvas part="eye right" aria-hidden="true"></canvas>
`;

/**
 * The bot's face, as a custom element that is itself an HSM host.
 *
 * The element owns presentation only: a shadow root, two canvases, and a
 * resize observer. Every behavioral question -- which expression, blinking or
 * not, awake or asleep -- belongs to the `Face` machine it starts under its own
 * context. Attribute writes and method calls are dispatched as typed events;
 * nothing pokes machine fields from outside.
 *
 * Usage:
 *
 *     <bot-face expression="focused" fill="#26d1a2"></bot-face>
 *
 *     document.querySelector("bot-face").express("surprised");
 */
export class BotFaceElement extends hsm.from(HTMLElement) {
  static get observedAttributes(): string[] {
    return ["expression", "fill", "background", "track"];
  }

  #root: ShadowRoot;
  #left: HTMLCanvasElement | null = null;
  #right: HTMLCanvasElement | null = null;
  #resizeObserver: ResizeObserver | null = null;
  #face: Face | null = null;
  #fill: CanvasPaint = "#26d1a2";
  #background: CanvasPaint | null = null;
  #frame = 0;
  /** Expression geometry currently on screen, eased toward the face's expression. */
  #shown: { left: EyeShape; right: EyeShape } | null = null;
  #gaze: Gaze | null = null;
  #look = { x: 0, y: 0 };
  #lids = { left: 1, right: 1 };
  #lastExpression: ExpressionName | null = null;
  #popAt = -Infinity;
  #pointer: { x: number; y: number } | null = null;
  #onPointer = (event: PointerEvent): void => {
    this.#pointer = { x: event.clientX, y: event.clientY };
  };

  constructor() {
    super();
    this.#root = this.attachShadow({ mode: "open" });
  }

  get expression(): ExpressionName {
    return this.#face?.expression ?? parseExpression(this.getAttribute("expression"));
  }

  set expression(value: ExpressionName) {
    this.setAttribute("expression", parseExpression(value));
  }

  get fill(): CanvasPaint {
    return this.#fill;
  }

  set fill(value: CanvasPaint) {
    this.#fill = value;
    this.#schedule();
  }

  get background(): CanvasPaint | null {
    return this.#background;
  }

  set background(value: CanvasPaint | null) {
    this.#background = value;
    this.#schedule();
  }

  connectedCallback(): void {
    if (!this.#left || !this.#right) {
      this.#root.append(template.content.cloneNode(true));
      this.#left = this.#root.querySelector('canvas[part~="left"]');
      this.#right = this.#root.querySelector('canvas[part~="right"]');
    }

    hsm.ensureStarted({ instance: this, model: BotFaceElement.model });
    this.#face = startFace({ ctx: this.context() });
    this.#gaze = startGaze({ ctx: this.context() });
    globalThis.addEventListener("pointermove", this.#onPointer, { passive: true });

    this.#readAttributes();
    // attributeChangedCallback fires before connect, when there is no face yet.
    this.express(parseExpression(this.getAttribute("expression")));
    this.#resizeObserver = new ResizeObserver(() => this.#schedule());
    this.#resizeObserver.observe(this);
    this.#schedule();
  }

  disconnectedCallback(): void {
    this.#resizeObserver?.disconnect();
    this.#resizeObserver = null;
    if (this.#frame !== 0) {
      cancelAnimationFrame(this.#frame);
      this.#frame = 0;
    }
    globalThis.removeEventListener("pointermove", this.#onPointer);
    const gaze = this.#gaze;
    this.#gaze = null;
    if (gaze !== null) void hsm.stop(gaze).catch(hsm.catchFailure(this));
    const face = this.#face;
    this.#face = null;
    if (face !== null) void hsm.stop(face).catch(hsm.catchFailure(this));
  }

  attributeChangedCallback(name: string, _old: string | null, _value: string | null): void {
    if (name === "expression") {
      this.express(parseExpression(this.getAttribute("expression")));
      return;
    }
    this.#readAttributes();
    this.#schedule();
  }

  /** Show an expression. */
  express(expression: ExpressionName): void {
    this.#send(Face.expressEvent, { expression });
  }

  /** Look at a point, in -1..1 of the eyes' travel. The eyes wander again once it goes still. */
  look(x: number, y: number): void {
    const gaze = this.#gaze;
    if (gaze === null) return;
    void Promise.resolve(hsm.dispatch(gaze, hsm.typedEvent({ event: Gaze.lookEvent, data: { x, y } })))
      .catch(hsm.catchFailure(this));
  }

  /** Blink once, now. */
  blink(): void {
    this.#send(Face.blinkEvent);
  }

  /** Close the eyes and stop idle blinking. */
  sleep(): void {
    this.#send(Face.sleepEvent);
  }

  /** Open the eyes and resume idle blinking. */
  wake(): void {
    this.#send(Face.wakeEvent);
  }

  /** Face state path, for the inspector. */
  faceState(): string {
    return this.#face?.state() ?? "/Face/unstarted";
  }

  #send(event: { readonly name: string; readonly kind: hsm.Event["kind"] }, data?: unknown): void {
    const face = this.#face;
    if (face === null) return;
    void Promise.resolve(
      data === undefined
        ? hsm.dispatch(face, hsm.typedEvent({ event }))
        : hsm.dispatch(face, hsm.typedEvent({ event, data })),
    )
      .then(() => this.#schedule())
      .catch(hsm.catchFailure(this));
  }

  #readAttributes(): void {
    this.#fill = this.getAttribute("fill") ?? "#26d1a2";
    this.#background = this.getAttribute("background");
  }

  #schedule(): void {
    if (this.#frame !== 0 || !this.isConnected) return;
    this.#frame = requestAnimationFrame(() => {
      this.#frame = 0;
      this.#paint();
    });
  }

  #paint(): void {
    const face = this.#face;
    const left = this.#left;
    const right = this.#right;
    if (face === null || left === null || right === null) return;

    const pair = EXPRESSIONS[face.expression];
    const target = { left: EYE_SHAPES[pair.left], right: EYE_SHAPES[pair.right] };
    const shown = this.#shown === null
      ? target
      : {
        left: blendShape(this.#shown.left, target.left, EXPRESSION_EASE),
        right: blendShape(this.#shown.right, target.right, EXPRESSION_EASE),
      };
    const settled = shapeClose(shown.left, target.left) && shapeClose(shown.right, target.right);
    this.#shown = settled ? target : shown;

    if (this.#lastExpression !== null && this.#lastExpression !== face.expression) this.#popAt = performance.now();
    this.#lastExpression = face.expression;

    this.#trackPointer();
    const gaze = this.#gaze;
    this.#look.x += ((gaze?.x ?? 0) - this.#look.x) * GAZE_EASE;
    this.#look.y += ((gaze?.y ?? 0) - this.#look.y) * GAZE_EASE;
    this.#lids.left += ((face.left?.lid ?? 1) - this.#lids.left) * LID_EASE;
    this.#lids.right += ((face.right?.lid ?? 1) - this.#lids.right) * LID_EASE;

    // Breathing, plus a springy pop when the expression changes.
    const now = performance.now();
    const since = now - this.#popAt;
    const pop = since < 700 ? 0.14 * Math.exp(-since / 160) * Math.cos(since / 45) : 0;
    const breath = 0.018 * Math.sin(now / 950);

    this.#paintOne(left, withOpenness(this.#shown.left, this.#lids.left), "left", pop, breath);
    this.#paintOne(right, withOpenness(this.#shown.right, this.#lids.right), "right", pop, breath);

    // The face is alive: it breathes and looks around, so it paints every frame while on the page.
    this.#schedule();
  }

  #trackPointer(): void {
    const pointer = this.#pointer;
    this.#pointer = null;
    if (pointer === null || !this.hasAttribute("track")) return;
    const box = this.getBoundingClientRect();
    const x = (pointer.x - (box.left + box.width / 2)) / TRACK_REACH_PX;
    const y = (pointer.y - (box.top + box.height / 2)) / TRACK_REACH_PX;
    this.look(x, y);
  }

  #paintOne(canvas: HTMLCanvasElement, shape: EyeShape, side: "left" | "right", pop: number, breath: number): void {
    const ctx = resizeCanvasToHost(canvas, 64, 64);
    if (!ctx) return;
    const ratio = Math.max(1, globalThis.devicePixelRatio || 1);
    const width = canvas.width / ratio;
    const height = canvas.height / ratio;
    if (this.#background !== null) {
      ctx.fillStyle = this.#background;
      ctx.fillRect(0, 0, width, height);
    }
    // A closing lid squashes the eye a little wider, like it is being pressed shut.
    const squash = 0.1 * (1 - shape.openness / Math.max(0.001, EYE_SHAPES.normal.openness));
    drawEye({
      ctx,
      width,
      height,
      shape,
      side,
      fill: this.#fill,
      lookX: this.#look.x,
      lookY: this.#look.y,
      scaleX: 1 + pop * 0.6 + Math.max(0, squash),
      scaleY: 1 + pop + breath,
    });
  }

  /** Host model: the element is a machine, even though the Face owns behavior. */
  static readonly model = hsm.define(
    "BotFace",
    hsm.initial(hsm.target("live")),
    hsm.state("live"),
  );
}

function shapeClose(a: EyeShape, b: EyeShape): boolean {
  return Math.abs(a.width - b.width) < 0.002
    && Math.abs(a.height - b.height) < 0.002
    && Math.abs(a.topTilt - b.topTilt) < 0.002
    && Math.abs(a.bottomTilt - b.bottomTilt) < 0.002
    && Math.abs(a.skew - b.skew) < 0.002
    && Math.abs(a.roundness - b.roundness) < 0.002;
}

export function defineBotFaceElement(): void {
  if (!customElements.get(BOT_FACE_TAG)) {
    customElements.define(BOT_FACE_TAG, BotFaceElement);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "bot-face": BotFaceElement;
  }
}

export { Eye, Face };
