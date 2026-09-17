import * as hsm from "../hsm.ts";

import { drawEye, resizeCanvasToHost, type CanvasPaint } from "./canvas.ts";
import { Eye } from "./eye.ts";
import { Face, startFace } from "./face-machine.ts";
import { parseExpression, type ExpressionName } from "./presets.ts";

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
    return ["expression", "fill", "background"];
  }

  #root: ShadowRoot;
  #left: HTMLCanvasElement | null = null;
  #right: HTMLCanvasElement | null = null;
  #resizeObserver: ResizeObserver | null = null;
  #face: Face | null = null;
  #fill: CanvasPaint = "#26d1a2";
  #background: CanvasPaint | null = null;
  #frame = 0;

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

    this.#readAttributes();
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

    const shapes = face.shapes();
    this.#paintOne(left, shapes.left, "left");
    this.#paintOne(right, shapes.right, "right");

    // Lids move through timed states, so keep painting while one is in flight.
    if (face.left?.lid !== 1 || face.right?.lid !== 1) this.#schedule();
  }

  #paintOne(canvas: HTMLCanvasElement, shape: ReturnType<Face["shapes"]>["left"], side: "left" | "right"): void {
    const ctx = resizeCanvasToHost(canvas, 64, 64);
    if (!ctx) return;
    const ratio = Math.max(1, globalThis.devicePixelRatio || 1);
    const width = canvas.width / ratio;
    const height = canvas.height / ratio;
    if (this.#background !== null) {
      ctx.fillStyle = this.#background;
      ctx.fillRect(0, 0, width, height);
    }
    drawEye({ ctx, width, height, shape, side, fill: this.#fill });
  }

  /** Host model: the element is a machine, even though the Face owns behavior. */
  static readonly model = hsm.define(
    "BotFace",
    hsm.initial(hsm.target("live")),
    hsm.state("live"),
  );
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
