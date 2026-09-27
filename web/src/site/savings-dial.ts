import * as hsm from "../hsm.ts";
import { FREQUENCIES, learnedPerYear, rebilledPerYear, stopIndex, wholeDollars } from "./savings.ts";

export const SAVINGS_DIAL_TAG = "savings-dial";

const rollDelay = (): number => SavingsDialElement.rollMs;

/**
 * "How often do you do this?" A slider that drives the them-vs-us yearly cost,
 * as a custom element that is an HSM host.
 *
 * Enhances light DOM it is given (so the page styles it and it reads fine
 * before scripts run): `input[type=range]`, `[data-dial=them]`, `[data-dial=us]`,
 * `[data-dial=quip]`, `[data-dial=often]`.
 *
 * `unseen` holds the number at $0 until the dial scrolls into view. `rolling`
 * counts the re-billed number toward its target (entry starts the tween, exit
 * cancels it, a new pick re-enters and re-aims). `resting` shows the settled
 * number and its quip. With reduced motion it never rolls.
 */
export class SavingsDialElement extends hsm.from(HTMLElement) {
  static rollMs = 700;

  static readonly seenEvent = { name: "dial.seen", kind: hsm.Kinds.Event } as const;
  static readonly pickEvent = { name: "dial.pick", kind: hsm.Kinds.Event } as const;

  static readonly model = hsm.define(
    "SavingsDial",
    hsm.initial(hsm.target("unseen")),
    hsm.state(
      "unseen",
      hsm.entry(SavingsDialElement.zero),
      hsm.transition(hsm.on(SavingsDialElement.seenEvent.name), hsm.guard(SavingsDialElement.stillMotion), hsm.target("../resting")),
      hsm.transition(hsm.on(SavingsDialElement.seenEvent.name), hsm.target("../rolling")),
      hsm.transition(hsm.on(SavingsDialElement.pickEvent.name), hsm.target("../resting")),
    ),
    hsm.state(
      "rolling",
      hsm.entry(SavingsDialElement.startRoll),
      hsm.exit(SavingsDialElement.stopRoll),
      hsm.transition(hsm.after(rollDelay), hsm.target("../resting")),
      hsm.transition(hsm.on(SavingsDialElement.pickEvent.name), hsm.target("../rolling")),
    ),
    hsm.state(
      "resting",
      hsm.entry(SavingsDialElement.showSettled),
      hsm.transition(hsm.on(SavingsDialElement.pickEvent.name), hsm.guard(SavingsDialElement.stillMotion), hsm.target("../resting")),
      hsm.transition(hsm.on(SavingsDialElement.pickEvent.name), hsm.target("../rolling")),
    ),
  );

  static stillMotion(): boolean {
    return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  }

  static zero(_ctx: hsm.Context, instance: hsm.Instance): void {
    if (instance instanceof SavingsDialElement) instance.#write(0);
  }

  static startRoll(_ctx: hsm.Context, instance: hsm.Instance): void {
    if (!(instance instanceof SavingsDialElement)) return;
    const from = instance.#shown;
    const to = rebilledPerYear(instance.#index());
    const began = performance.now();
    instance.#writeQuip();
    const step = (now: number): void => {
      const t = Math.min(1, (now - began) / SavingsDialElement.rollMs);
      const eased = 1 - (1 - t) ** 3;
      instance.#write(from + (to - from) * eased);
      instance.#frame = t < 1 ? requestAnimationFrame(step) : 0;
    };
    instance.#frame = requestAnimationFrame(step);
  }

  static stopRoll(_ctx: hsm.Context, instance: hsm.Instance): void {
    if (!(instance instanceof SavingsDialElement) || instance.#frame === 0) return;
    cancelAnimationFrame(instance.#frame);
    instance.#frame = 0;
  }

  static showSettled(_ctx: hsm.Context, instance: hsm.Instance): void {
    if (!(instance instanceof SavingsDialElement)) return;
    instance.#write(rebilledPerYear(instance.#index()));
    instance.#writeQuip();
  }

  #frame = 0;
  #shown = 0;
  #seen: IntersectionObserver | null = null;
  #onInput = (): void => {
    this.#send(SavingsDialElement.pickEvent);
  };

  connectedCallback(): void {
    hsm.ensureStarted({ instance: this, model: SavingsDialElement.model });
    this.#slider()?.addEventListener("input", this.#onInput);
    const us = this.querySelector("[data-dial=us]");
    if (us !== null) us.textContent = `$${learnedPerYear().toFixed(2)}`;
    this.#seen = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      this.#seen?.disconnect();
      this.#seen = null;
      this.#send(SavingsDialElement.seenEvent);
    }, { threshold: 0.4 });
    this.#seen.observe(this);
  }

  disconnectedCallback(): void {
    this.#slider()?.removeEventListener("input", this.#onInput);
    this.#seen?.disconnect();
    this.#seen = null;
  }

  /** Dial state path, for tests and the inspector. */
  dialState(): string {
    return this.state();
  }

  #slider(): HTMLInputElement | null {
    return this.querySelector<HTMLInputElement>("input[type=range]");
  }

  #index(): number {
    return stopIndex(this.#slider()?.value);
  }

  #write(dollars: number): void {
    this.#shown = dollars;
    const them = this.querySelector("[data-dial=them]");
    if (them !== null) them.textContent = wholeDollars(dollars);
  }

  #writeQuip(): void {
    const stop = FREQUENCIES[this.#index()];
    if (stop === undefined) return;
    const quip = this.querySelector("[data-dial=quip]");
    if (quip !== null) quip.textContent = stop.quip;
    const often = this.querySelector("[data-dial=often]");
    if (often !== null) often.textContent = stop.label.toLowerCase();
    const slider = this.#slider();
    slider?.setAttribute("aria-valuetext", `${stop.label}: ${wholeDollars(rebilledPerYear(this.#index()))} a year re-billed`);
    this.style.setProperty("--dial", String(this.#index() / (FREQUENCIES.length - 1)));
  }

  #send(event: { readonly name: string; readonly kind: hsm.Event["kind"] }): void {
    void Promise.resolve(hsm.dispatch(this, hsm.typedEvent({ event }))).catch(hsm.catchFailure(this));
  }
}

export function defineSavingsDialElement(): void {
  if (!customElements.get(SAVINGS_DIAL_TAG)) {
    customElements.define(SAVINGS_DIAL_TAG, SavingsDialElement);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "savings-dial": SavingsDialElement;
  }
}
