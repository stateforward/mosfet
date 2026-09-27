import * as hsm from "../hsm.ts";
import { type BotCritterElement } from "../face/bot-critter.ts";
import { MAKER_FREE_EVENT, MAKER_LEARNED_EVENT } from "./mosfet-maker.ts";
import { Mood, startMood } from "./mood-machine.ts";

export const CRITTER_CREW_TAG = "critter-crew";

/** Activity closer together than this is one sign of life, not many. */
const ACTIVITY_THROTTLE_MS = 400;

/**
 * Gives every `<bot-critter data-crew>` on the page one shared mood, as a
 * custom element that is an HSM host.
 *
 * It starts a `Mood` and feeds it the visitor's activity, the demo's big
 * moments, and flipped switches inside `[data-crew-react]`; when the mood
 * says so, it moves the bots. Its own topology is whether anyone is looking:
 * `attending` while the tab is visible, `away` while it is hidden (the bots
 * nap, and wake startled when you come back). Renders nothing.
 *
 *     <critter-crew></critter-crew>
 */
export class CritterCrewElement extends hsm.from(HTMLElement) {
  static readonly hiddenEvent = { name: "crew.hidden", kind: hsm.Kinds.Event } as const;
  static readonly visibleEvent = { name: "crew.visible", kind: hsm.Kinds.Event } as const;

  static readonly model = hsm.define(
    "CritterCrew",
    hsm.initial(hsm.target("attending")),
    hsm.state(
      "attending",
      hsm.transition(hsm.on(CritterCrewElement.hiddenEvent.name), hsm.target("../away")),
    ),
    hsm.state(
      "away",
      hsm.entry(CritterCrewElement.nap),
      hsm.exit(CritterCrewElement.welcomeBack),
      hsm.transition(hsm.on(CritterCrewElement.visibleEvent.name), hsm.target("../attending")),
    ),
    hsm.transition(hsm.on(Mood.changedEvent.name), hsm.effect(CritterCrewElement.applyMood)),
  );

  static nap(_ctx: hsm.Context, instance: hsm.Instance): void {
    if (instance instanceof CritterCrewElement) instance.#tell(Mood.napEvent);
  }

  static welcomeBack(_ctx: hsm.Context, instance: hsm.Instance): void {
    if (instance instanceof CritterCrewElement) instance.#tell(Mood.activityEvent);
  }

  static applyMood(_ctx: hsm.Context, instance: hsm.Instance): void {
    if (!(instance instanceof CritterCrewElement)) return;
    const mood = instance.#mood;
    if (mood === null) return;
    document.documentElement.toggleAttribute("data-crew-dozing", mood.cue === "sleep");
    for (const critter of document.querySelectorAll<BotCritterElement>("bot-critter[data-crew]")) {
      if (mood.cue === "sleep") critter.sleep();
      else if (mood.cue === "wake") critter.wake();
      else {
        critter.express(mood.expression);
        if (mood.cue === "cheer") critter.spin(Math.random() < 0.5 ? 1 : -1);
      }
    }
  }

  #mood: Mood | null = null;
  #lastActivity = -Infinity;
  #onActivity = (): void => {
    const now = performance.now();
    if (now - this.#lastActivity < ACTIVITY_THROTTLE_MS) return;
    this.#lastActivity = now;
    this.#tell(Mood.activityEvent);
  };
  #onVisibility = (): void => {
    this.#dispatchSelf(document.hidden ? CritterCrewElement.hiddenEvent : CritterCrewElement.visibleEvent);
  };
  #onFree = (): void => this.#tell(Mood.cheerEvent);
  #onLearned = (): void => this.#tell(Mood.reactEvent, { expression: "happy" });
  #onChange = (event: Event): void => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.type !== "checkbox") return;
    if (input.closest("[data-crew-react]") === null) return;
    this.#tell(Mood.reactEvent, { expression: input.checked ? "happy" : "worried" });
  };

  /** Mood state path, for tests and the inspector. */
  moodState(): string {
    return this.#mood?.state() ?? "/Mood/unstarted";
  }

  connectedCallback(): void {
    hsm.ensureStarted({ instance: this, model: CritterCrewElement.model });
    this.#mood = startMood({ ctx: this.context() });
    for (const type of ["pointermove", "pointerdown", "keydown", "scroll", "wheel", "touchstart"]) {
      globalThis.addEventListener(type, this.#onActivity, { passive: true });
    }
    document.addEventListener("visibilitychange", this.#onVisibility);
    document.addEventListener(MAKER_FREE_EVENT, this.#onFree);
    document.addEventListener(MAKER_LEARNED_EVENT, this.#onLearned);
    document.addEventListener("change", this.#onChange);
  }

  disconnectedCallback(): void {
    for (const type of ["pointermove", "pointerdown", "keydown", "scroll", "wheel", "touchstart"]) {
      globalThis.removeEventListener(type, this.#onActivity);
    }
    document.removeEventListener("visibilitychange", this.#onVisibility);
    document.removeEventListener(MAKER_FREE_EVENT, this.#onFree);
    document.removeEventListener(MAKER_LEARNED_EVENT, this.#onLearned);
    document.removeEventListener("change", this.#onChange);
    const mood = this.#mood;
    this.#mood = null;
    if (mood !== null) void hsm.stop(mood).catch(hsm.catchFailure(this));
  }

  #tell(event: { readonly name: string; readonly kind: hsm.Event["kind"] }, data?: unknown): void {
    const mood = this.#mood;
    if (mood === null) return;
    void Promise.resolve(
      data === undefined ? hsm.dispatch(mood, hsm.typedEvent({ event })) : hsm.dispatch(mood, hsm.typedEvent({ event, data })),
    ).catch(hsm.catchFailure(this));
  }

  #dispatchSelf(event: { readonly name: string; readonly kind: hsm.Event["kind"] }): void {
    void Promise.resolve(hsm.dispatch(this, hsm.typedEvent({ event }))).catch(hsm.catchFailure(this));
  }
}

export function defineCritterCrewElement(): void {
  if (!customElements.get(CRITTER_CREW_TAG)) {
    customElements.define(CRITTER_CREW_TAG, CritterCrewElement);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "critter-crew": CritterCrewElement;
  }
}
