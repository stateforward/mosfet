import * as hsm from "../hsm.ts";
import { defineBotCritterElement, type BotCritterElement } from "../face/bot-critter.ts";
import { Maker, phaseOf, startMaker, type Line } from "./maker-machine.ts";
import { firstRunCost, RUNS_PER_YEAR, TASKS } from "./tasks.ts";

export const MOSFET_MAKER_TAG = "mosfet-maker";

/** DOM events the demo fires on itself (bubbling, composed) at its big moments. */
export const MAKER_LEARNED_EVENT = "mosfet-learned";
export const MAKER_FREE_EVENT = "mosfet-free";

const COINS = 14;

const template = document.createElement("template");
template.innerHTML = `
  <style>
    :host {
      --m-ink: var(--site-ink, #141414);
      --m-muted: var(--site-muted, #6d675d);
      --m-line: var(--site-line, #d5ccbb);
      --m-accent: var(--site-accent, #0f9d74);
      --m-accent-bg: var(--site-accent-bg, #c9f2e2);
      --m-money: var(--site-money, #e0480f);
      --m-paper: var(--site-bg, #f2ede3);
      display: grid;
      gap: .85rem;
      position: relative;
      background: var(--site-panel, #fbf8f2);
      border-radius: 18px;
      padding: clamp(.9rem, 2.4vw, 1.3rem);
      color: var(--m-ink);
      font: 14px/1.45 var(--site-sans, system-ui, sans-serif);
      overflow: hidden;
    }
    header { display: flex; align-items: center; gap: .8rem; }
    bot-critter { block-size: 3.6rem; inline-size: 4.2rem; flex: none; cursor: pointer; }
    .who { flex: 1; min-inline-size: 0; }
    .who b { display: block; font-size: 15px; }
    .who span { color: var(--m-muted); font-size: 12.5px; }
    .meter-wrap { position: relative; flex: none; }
    .meter {
      display: grid; justify-items: end; gap: .05rem;
      font: 600 22px/1 var(--site-mono, ui-monospace, Menlo, monospace);
      padding: .45rem .7rem; border-radius: 12px; border: 1.5px solid var(--m-line);
      font-variant-numeric: tabular-nums; transition: color .3s, border-color .3s, background .3s;
      min-inline-size: 6.5rem;
    }
    .meter small { font: 500 10px var(--site-mono, ui-monospace, monospace); letter-spacing: .08em; text-transform: uppercase; color: var(--m-muted); }
    .meter[data-mode="paid"] { color: var(--m-money); border-color: color-mix(in srgb, var(--m-money) 55%, transparent); background: color-mix(in srgb, var(--m-money) 7%, transparent); }
    .meter[data-mode="free"] { color: var(--m-accent); border-color: var(--m-accent); background: var(--m-accent-bg); }
    .stamp {
      position: absolute; inset-block-start: -.55rem; inset-inline-end: -.4rem;
      font: 700 13px/1 var(--site-mono, ui-monospace, monospace); letter-spacing: .12em;
      color: var(--m-paper); background: var(--m-accent); padding: .3rem .45rem; border-radius: 6px;
      transform: rotate(8deg); box-shadow: 0 0 0 2px var(--site-panel, #fbf8f2);
      pointer-events: none;
    }
    .stamp.slam { animation: slam .55s cubic-bezier(.2,1.6,.4,1) both; }
    @keyframes slam { from { transform: rotate(-20deg) scale(3); opacity: 0; } to { transform: rotate(8deg) scale(1); opacity: 1; } }
    .coin {
      position: absolute; inset-block-start: 50%; inset-inline-end: 2.5rem; inline-size: 1.1rem; block-size: 1.1rem;
      border-radius: 50%; background: #ffc83d; border: 2px solid var(--m-ink);
      display: grid; place-items: center; font: 700 9px var(--site-mono, monospace); color: var(--m-ink);
      animation: coin 1.1s cubic-bezier(.2,.7,.3,1) forwards; pointer-events: none; z-index: 2;
    }
    .coin:nth-child(3n) { background: var(--m-accent-bg); }
    .coin:nth-child(4n) { background: var(--m-money); color: #fff; }
    @keyframes coin {
      0% { transform: translate(0, 0) rotate(0) scale(.4); opacity: 1; }
      60% { opacity: 1; }
      100% { transform: translate(var(--dx), var(--dy)) rotate(var(--r)) scale(1); opacity: 0; }
    }

    .steps { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .4rem; margin: 0; padding: 0; list-style: none; counter-reset: s; }
    .steps li {
      counter-increment: s; display: flex; align-items: center; gap: .45rem; min-inline-size: 0;
      font: 500 12px/1.2 var(--site-sans, system-ui, sans-serif); color: var(--m-muted);
      padding: .45rem .55rem; border-radius: 10px; border: 1.5px dashed var(--m-line); transition: all .3s;
    }
    .steps li::before {
      content: counter(s); flex: none; display: grid; place-items: center; inline-size: 1.25rem; block-size: 1.25rem;
      border-radius: 50%; border: 1.5px solid currentColor; font: 600 11px var(--site-mono, monospace);
    }
    .steps li[data-at="now"] { color: var(--m-ink); border-style: solid; border-color: var(--m-ink); background: var(--site-bg, #f2ede3); }
    .steps li[data-at="now"]::before { background: var(--m-ink); color: var(--site-panel, #fbf8f2); border-color: var(--m-ink); }
    .steps li[data-at="done"] { color: var(--m-accent); border-style: solid; border-color: color-mix(in srgb, var(--m-accent) 40%, transparent); }
    .steps li[data-at="done"]::before { content: "✓"; background: var(--m-accent); color: #fff; border-color: var(--m-accent); }
    .steps span { overflow: hidden; text-overflow: ellipsis; }

    .jobs { display: flex; gap: .4rem; flex-wrap: wrap; align-items: center; }
    .jobs > span { font: 500 11px var(--site-mono, monospace); text-transform: uppercase; letter-spacing: .07em; color: var(--m-muted); margin-inline-end: .2rem; }
    .jobs button { font-size: 13px; padding: .35rem .7rem; border-radius: 999px; }
    .jobs button[aria-pressed="true"] { background: var(--m-ink); color: var(--site-panel, #fbf8f2); border-color: var(--m-ink); }

    ol.log {
      list-style: none; margin: 0; padding: .7rem .8rem; display: grid; gap: .3rem; align-content: start;
      block-size: 14rem; overflow-y: auto; scroll-behavior: smooth; scrollbar-width: thin;
      font-family: var(--site-mono, ui-monospace, Menlo, monospace); font-size: 12.5px;
      background: var(--site-bg, #f2ede3); border-radius: 12px; border: 1px solid var(--m-line);
    }
    .empty { color: var(--m-muted); display: grid; place-items: center; block-size: 100%; text-align: center; font-family: inherit; }
    .log li { display: flex; gap: .6rem; align-items: baseline; animation: in .25s ease-out; }
    @keyframes in { from { opacity: 0; transform: translateY(4px); } }
    .log li .t { flex: 1; min-inline-size: 0; }
    .log li .c { color: var(--m-money); font-variant-numeric: tabular-nums; font-weight: 600; }
    .log li .c.free { color: var(--m-accent); }
    .log li[data-who="you"] .t { color: var(--m-ink); font-weight: 600; }
    .log li[data-who="you"]::before { content: "you"; color: var(--signal, #ff5a1f); inline-size: 2.2rem; flex: none; font-weight: 600; }
    .log li[data-who="step"] { color: var(--m-muted); padding-inline-start: 2.8rem; }
    .log li[data-who="result"] { padding-inline-start: 2.8rem; color: var(--m-ink); font-weight: 600; }
    .log li[data-who="result"]::before { content: "✓"; color: var(--m-accent); }
    .log li[data-who="bot"] { padding-inline-start: 2.8rem; color: var(--m-accent); font-weight: 600; }
    .log li[data-who="note"] { padding-inline-start: 2.8rem; color: var(--m-money); }

    .panel { display: grid; gap: .6rem; }
    .panel > p { margin: 0; font-weight: 600; font-size: 15px; }
    .panel > p span { color: var(--m-muted); font-weight: 400; }
    form { display: flex; gap: .5rem; }
    input {
      flex: 1; min-inline-size: 0; font: inherit; color: inherit; background: var(--site-panel, #fbf8f2);
      border: 1.5px solid var(--m-line); border-radius: 10px; padding: .5rem .7rem;
    }
    input:focus-visible, button:focus-visible { outline: 3px solid var(--signal, #ff5a1f); outline-offset: 2px; }
    button {
      font: inherit; cursor: pointer; border-radius: 10px; padding: .5rem .8rem;
      border: 1.5px solid var(--m-line); background: transparent; color: inherit; transition: transform .15s, background .2s, border-color .2s;
    }
    button:hover { border-color: var(--m-ink); }
    button:active { transform: translateY(1px); }
    button:disabled { opacity: .5; cursor: default; }
    .go {
      display: flex; align-items: center; justify-content: space-between; gap: .8rem; text-align: start;
      background: var(--m-ink); color: var(--site-panel, #fbf8f2); border-color: var(--m-ink);
      padding: .8rem 1rem; border-radius: 12px; font-weight: 600; font-size: 15px;
      box-shadow: 4px 4px 0 var(--signal, #ff5a1f);
    }
    .go:hover { background: #000; border-color: #000; transform: translate(-1px, -1px); box-shadow: 5px 5px 0 var(--signal, #ff5a1f); }
    .go:active { transform: translate(3px, 3px); box-shadow: 1px 1px 0 var(--signal, #ff5a1f); }
    .go .price { font: 600 13px var(--site-mono, monospace); padding: .2rem .45rem; border-radius: 6px; background: var(--m-accent-bg); color: #075e46; flex: none; }
    .go.nudge { animation: nudge 1.8s ease-in-out infinite; }
    @keyframes nudge { 0%, 70%, 100% { transform: none; } 80% { transform: translateX(3px) rotate(.4deg); } 90% { transform: translateX(-2px); } }
    .ghost { font-size: 13px; }
    details summary { cursor: pointer; color: var(--m-muted); font-size: 13px; }
    details[open] summary { margin-bottom: .5rem; }
    .skill {
      display: flex; gap: .7rem; align-items: center; padding: .65rem .8rem; border-radius: 12px;
      background: var(--m-accent-bg); border: 1.5px solid var(--m-accent);
      animation: in .35s ease-out;
    }
    .skill div { flex: 1; min-inline-size: 0; }
    .skill small { display: block; color: #075e46; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; font-size: 10.5px; }
    .skill button { font-size: 12px; padding: .25rem .55rem; color: #075e46; border-color: color-mix(in srgb, var(--m-accent) 50%, transparent); }
    .tally { display: grid; grid-template-columns: 1fr 1fr; gap: .5rem; }
    .tally:empty { display: none; }
    .tally div { border: 1.5px solid var(--m-line); border-radius: 12px; padding: .55rem .7rem; }
    .tally small { display: block; color: var(--m-muted); font-size: 11.5px; }
    .tally strong { font: 700 21px var(--site-mono, ui-monospace, Menlo, monospace); font-variant-numeric: tabular-nums; letter-spacing: -0.02em; }
    .tally .them strong { color: var(--m-money); text-decoration: line-through; text-decoration-thickness: 2px; }
    .tally .us { border-color: var(--m-accent); background: color-mix(in srgb, var(--m-accent-bg) 45%, transparent); }
    .tally .us strong { color: var(--m-accent); }
    [hidden] { display: none !important; }
    @media (max-width: 420px) {
      .steps li { font-size: 11px; padding: .4rem; gap: .3rem; }
      .meter { font-size: 18px; min-inline-size: 5.4rem; }
      .tally strong { font-size: 18px; }
    }
    @media (prefers-reduced-motion: reduce) {
      .stamp.slam, .coin, .go.nudge, .log li, .skill { animation: none; }
      .coin { display: none; }
    }
  </style>
  <header>
    <bot-critter expression="normal" track title="poke me"></bot-critter>
    <div class="who"><b>Your bot</b><span class="status">idle</span></div>
    <div class="meter-wrap">
      <output class="meter" data-mode="idle" title="Model spend for this run"><small class="meter-label">this run</small><span class="amount">$0.00</span></output>
      <span class="stamp" hidden>FREE</span>
    </div>
  </header>
  <ol class="steps" aria-label="Progress">
    <li data-step="1"><span>It does the job</span></li>
    <li data-step="2"><span>You correct it</span></li>
    <li data-step="3"><span>Runs free</span></li>
  </ol>
  <ol class="log" aria-live="polite"></ol>
  <div class="panel" data-panel="working">
    <p>Watch the meter climb. <span>Every step is a model call.</span></p>
  </div>
  <div class="panel" data-panel="review" hidden>
    <p>It works. <span>But that's not how you'd do it.</span></p>
    <button type="button" class="go suggest nudge"><span class="suggest-text"></span><span aria-hidden="true">→</span></button>
    <details>
      <summary>or say it your way</summary>
      <form>
        <input name="text" autocomplete="off" placeholder="e.g. always …" aria-label="Your correction" />
        <button type="submit">Tell it</button>
      </form>
    </details>
  </div>
  <div class="panel" data-panel="learned" hidden>
    <div class="skill">
      <div><small>Learned for good</small><span class="skill-text"></span></div>
      <button type="button" data-do="forget">forget</button>
    </div>
    <button type="button" class="go run nudge" data-do="run"><span class="run-text">Run it again</span><span class="price">$0.00</span></button>
    <div class="tally"></div>
  </div>
  <div class="jobs" role="group" aria-label="Pick a job"><span>Try a job</span></div>
`;

/**
 * The mosfet.bot demo, as a custom element that is an HSM host.
 *
 * Presentation only: it starts a `Maker` under its own context, turns clicks
 * into typed events, and redraws when the maker reports a change. Which panel
 * shows is read from the maker's state path.
 *
 *     <mosfet-maker></mosfet-maker>
 */
export class MosfetMakerElement extends hsm.from(HTMLElement) {
  static readonly celebrateMs = 1400;
  static readonly freedMs = 2200;

  static readonly seenEvent = { name: "maker-host.seen", kind: hsm.Kinds.Event } as const;

  /**
   * `offstage` waits for the demo to scroll into view, so nobody misses the
   * paid run; its exit starts the maker. `watching` redraws on every maker change. The moment the bot learns a job
   * the host goes to `celebrating` (the bot spins). The first free run goes to
   * `freed`: the meter gets its FREE stamp and spits coins, and the page hears
   * about it. Both settle back to `watching`; changes keep redrawing meanwhile.
   */
  static readonly model = hsm.define(
    "MosfetMaker",
    hsm.initial(hsm.target("offstage")),
    hsm.state(
      "offstage",
      hsm.exit(MosfetMakerElement.startShow),
      hsm.transition(hsm.on(MosfetMakerElement.seenEvent.name), hsm.target("../watching")),
    ),
    hsm.state(
      "watching",
      hsm.transition(hsm.on(Maker.changedEvent.name), hsm.guard(MosfetMakerElement.justLearned), hsm.target("../celebrating")),
      hsm.transition(hsm.on(Maker.changedEvent.name), hsm.guard(MosfetMakerElement.wentFree), hsm.target("../freed")),
      hsm.transition(hsm.on(Maker.changedEvent.name), hsm.effect(MosfetMakerElement.onChanged)),
    ),
    hsm.state(
      "celebrating",
      hsm.entry(MosfetMakerElement.celebrate),
      hsm.transition(hsm.after(() => MosfetMakerElement.celebrateMs), hsm.target("../watching")),
      hsm.transition(hsm.on(Maker.changedEvent.name), hsm.guard(MosfetMakerElement.wentFree), hsm.target("../freed")),
      hsm.transition(hsm.on(Maker.changedEvent.name), hsm.effect(MosfetMakerElement.onChanged)),
    ),
    hsm.state(
      "freed",
      hsm.entry(MosfetMakerElement.goFree),
      hsm.exit(MosfetMakerElement.settle),
      hsm.transition(hsm.after(() => MosfetMakerElement.freedMs), hsm.target("../watching")),
      hsm.transition(hsm.on(Maker.changedEvent.name), hsm.effect(MosfetMakerElement.onChanged)),
    ),
  );

  static startShow(_ctx: hsm.Context, instance: hsm.Instance): void {
    if (instance instanceof MosfetMakerElement) instance.#startMaker();
  }

  static justLearned(_ctx: hsm.Context, _instance: hsm.Instance, event: hsm.Event): boolean {
    return momentOf(event) === "learned";
  }

  static wentFree(_ctx: hsm.Context, _instance: hsm.Instance, event: hsm.Event): boolean {
    return momentOf(event) === "free";
  }

  static celebrate(_ctx: hsm.Context, instance: hsm.Instance): void {
    if (!(instance instanceof MosfetMakerElement)) return;
    instance.#schedule();
    instance.#root.querySelector<BotCritterElement>("bot-critter")?.spin();
    instance.#announce(MAKER_LEARNED_EVENT);
  }

  static goFree(_ctx: hsm.Context, instance: hsm.Instance): void {
    if (!(instance instanceof MosfetMakerElement)) return;
    instance.#schedule();
    instance.#root.querySelector<BotCritterElement>("bot-critter")?.spin(-1);
    instance.#q(".stamp").classList.add("slam");
    instance.#burst();
    instance.#announce(MAKER_FREE_EVENT);
  }

  static settle(_ctx: hsm.Context, instance: hsm.Instance): void {
    if (!(instance instanceof MosfetMakerElement)) return;
    instance.#q(".stamp").classList.remove("slam");
    for (const coin of instance.#root.querySelectorAll(".coin")) coin.remove();
  }

  #root: ShadowRoot;
  #maker: Maker | null = null;
  #frame = 0;
  #lineCount = -1;
  #shownCost = -1;
  #seen: IntersectionObserver | null = null;

  constructor() {
    super();
    this.#root = this.attachShadow({ mode: "open" });
  }

  connectedCallback(): void {
    if (this.#root.childElementCount === 0) {
      defineBotCritterElement();
      this.#root.append(template.content.cloneNode(true));
      this.#wire();
    }
    hsm.ensureStarted({ instance: this, model: MosfetMakerElement.model });
    if (!this.state().endsWith("/offstage")) {
      this.#startMaker();
      return;
    }
    this.#seen = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      this.#seen?.disconnect();
      this.#seen = null;
      void Promise.resolve(hsm.dispatch(this, hsm.typedEvent({ event: MosfetMakerElement.seenEvent }))).catch(hsm.catchFailure(this));
    }, { threshold: 0.35 });
    this.#seen.observe(this);
  }

  #startMaker(): void {
    if (this.#maker !== null) return;
    this.#maker = startMaker({ ctx: this.context() });
    this.#schedule();
  }

  disconnectedCallback(): void {
    this.#seen?.disconnect();
    this.#seen = null;
    if (this.#frame !== 0) cancelAnimationFrame(this.#frame);
    this.#frame = 0;
    const maker = this.#maker;
    this.#maker = null;
    if (maker !== null) void hsm.stop(maker).catch(hsm.catchFailure(this));
  }

  /** Maker state path, for tests and the inspector. */
  makerState(): string {
    return this.#maker?.state() ?? "/Maker/unstarted";
  }

  /** Start a job by id, as if its chip was clicked. */
  pick(task: string): void {
    this.#send(Maker.pickEvent, { task });
  }

  static onChanged(_ctx: hsm.Context, instance: hsm.Instance): void {
    if (instance instanceof MosfetMakerElement) instance.#schedule();
  }

  #wire(): void {
    const jobs = this.#q(".jobs");
    for (const task of Object.values(TASKS)) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = task.label;
      button.dataset["task"] = task.id;
      button.addEventListener("click", () => this.pick(task.id));
      jobs.append(button);
    }
    this.#q("form").addEventListener("submit", (event) => {
      event.preventDefault();
      const input = this.#q<HTMLInputElement>("input");
      const text = input.value;
      if (text.trim() === "") return;
      input.value = "";
      this.#send(Maker.teachEvent, { text });
    });
    this.#q(".suggest").addEventListener("click", () => {
      const text = this.#maker?.task?.correction;
      if (text !== undefined) this.#send(Maker.teachEvent, { text });
    });
    this.#q('[data-do="run"]').addEventListener("click", () => this.#send(Maker.runEvent));
    this.#q('[data-do="forget"]').addEventListener("click", () => this.#send(Maker.forgetEvent));
  }

  #send(event: { readonly name: string; readonly kind: hsm.Event["kind"] }, data?: unknown): void {
    const maker = this.#maker;
    if (maker === null) return;
    void Promise.resolve(
      data === undefined
        ? hsm.dispatch(maker, hsm.typedEvent({ event }))
        : hsm.dispatch(maker, hsm.typedEvent({ event, data })),
    )
      .then(() => this.#schedule())
      .catch(hsm.catchFailure(this));
  }

  #announce(name: string): void {
    this.dispatchEvent(new CustomEvent(name, { bubbles: true, composed: true, detail: { task: this.#maker?.task?.id ?? null } }));
  }

  /** Coins fly out of the meter. Removed on exit from `freed`. */
  #burst(): void {
    const wrap = this.#q(".meter-wrap");
    for (let i = 0; i < COINS; i += 1) {
      const coin = document.createElement("span");
      coin.className = "coin";
      coin.textContent = "$";
      coin.setAttribute("aria-hidden", "true");
      const angle = Math.PI * (0.55 + (i / (COINS - 1)) * 0.9);
      const reach = 70 + ((i * 37) % 60);
      coin.style.setProperty("--dx", `${Math.cos(angle) * reach}px`);
      coin.style.setProperty("--dy", `${Math.sin(angle) * reach * 0.8 + 30}px`);
      coin.style.setProperty("--r", `${(i % 2 === 0 ? 1 : -1) * (180 + i * 25)}deg`);
      coin.style.animationDelay = `${(i % 5) * 40}ms`;
      wrap.append(coin);
    }
  }

  #schedule(): void {
    if (this.#frame !== 0 || !this.isConnected) return;
    this.#frame = requestAnimationFrame(() => {
      this.#frame = 0;
      this.#render();
    });
  }

  #render(): void {
    const maker = this.#maker;
    if (maker === null) return;
    const state = maker.state();
    const task = maker.task;

    this.#q<BotCritterElement>("bot-critter").express(maker.expression);
    this.#q(".status").textContent = statusFor(state);

    const learned = state.startsWith("/Maker/learned");
    const meter = this.#q<HTMLOutputElement>(".meter");
    this.#q(".amount").textContent = money(maker.runCost);
    // Green only once a run actually costs nothing; the paid run's total stays orange until then.
    meter.dataset["mode"] = task === null ? "idle" : learned && maker.runCost === 0 ? "free" : "paid";
    if (maker.runCost !== this.#shownCost) {
      if (maker.runCost > this.#shownCost && this.#shownCost >= 0 && !reducedMotion()) {
        meter.animate([{ transform: "scale(1.14) rotate(-2deg)" }, { transform: "none" }], { duration: 260, easing: "ease-out" });
      }
      this.#shownCost = maker.runCost;
    }
    const stamped = learned && maker.freeRuns > 0;
    this.#q(".stamp").hidden = !stamped;
    this.#q(".meter-label").style.visibility = stamped ? "hidden" : "visible";

    const phase = phaseOf(state, maker.freeRuns);
    for (const step of this.#root.querySelectorAll<HTMLElement>(".steps li")) {
      const n = Number(step.dataset["step"]);
      const at = n < phase ? "done" : n === phase ? "now" : "next";
      step.dataset["at"] = at;
      if (at === "now") step.setAttribute("aria-current", "step");
      else step.removeAttribute("aria-current");
    }

    for (const chip of this.#root.querySelectorAll<HTMLButtonElement>(".jobs button")) {
      chip.setAttribute("aria-pressed", String(task?.id === chip.dataset["task"]));
    }

    const list = this.#q("ol.log");
    if (maker.lines.length !== this.#lineCount) {
      this.#lineCount = maker.lines.length;
      if (maker.lines.length === 0) {
        const empty = document.createElement("li");
        empty.className = "empty";
        empty.textContent = "Pick a job below. Watch what it costs.";
        list.replaceChildren(empty);
      } else {
        list.replaceChildren(...maker.lines.map(lineItem));
        list.scrollTop = list.scrollHeight;
      }
    }

    const reviewing = state.endsWith("/untaught/reviewing");
    this.#q("[data-panel=working]").hidden = learned || reviewing;
    this.#q("[data-panel=review]").hidden = !reviewing;
    if (task !== null) this.#q(".suggest-text").textContent = `Tell it: “${task.correction}”`;

    this.#q("[data-panel=learned]").hidden = !learned;
    this.#q(".skill-text").textContent = maker.skill ?? "";
    const run = this.#q<HTMLButtonElement>('[data-do="run"]');
    run.disabled = state.endsWith("/replaying");
    run.classList.toggle("nudge", state.endsWith("/learned/ready"));
    this.#q(".run-text").textContent = maker.freeRuns === 0 ? "Now run it again" : "Again. It never gets pricier";
    const tally = this.#q(".tally");
    tally.textContent = "";
    if (task !== null && learned && maker.freeRuns > 0) {
      tally.append(
        stat("them", "Daily for a year, re-billed", money(firstRunCost(task) * RUNS_PER_YEAR)),
        stat("us", "Daily for a year, mosfet", money(maker.spent)),
      );
    }
  }

  #q<T extends Element = HTMLElement>(selector: string): T {
    const found = this.#root.querySelector<T>(selector);
    if (found === null) throw new Error(`mosfet-maker: template is missing ${selector}`);
    return found;
  }
}

function momentOf(event: hsm.Event): unknown {
  const data = event.data;
  return hsm.isRecord(data) ? data["moment"] : undefined;
}

function reducedMotion(): boolean {
  return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

function statusFor(state: string): string {
  if (state.endsWith("/choosing")) return "waiting for a job";
  if (state.endsWith("/starting") || state.endsWith("/working")) return "thinking · on the meter";
  if (state.endsWith("/reviewing")) return "done, the long way";
  if (state.endsWith("/learning")) return "learning";
  if (state.endsWith("/replaying")) return "doing it your way · free";
  return "knows this job";
}

function money(dollars: number): string {
  return `$${dollars.toFixed(2)}`;
}

function stat(kind: "them" | "us", label: string, value: string): HTMLElement {
  const box = document.createElement("div");
  box.className = kind;
  const small = document.createElement("small");
  small.textContent = label;
  const strong = document.createElement("strong");
  strong.textContent = value;
  box.append(small, strong);
  return box;
}

function lineItem(line: Line): HTMLLIElement {
  const item = document.createElement("li");
  item.dataset["who"] = line.who;
  const text = document.createElement("span");
  text.className = "t";
  text.textContent = line.text;
  item.append(text);
  if (line.cost !== undefined) {
    const cost = document.createElement("span");
    cost.className = line.cost === 0 ? "c free" : "c";
    cost.textContent = line.cost === 0 ? "free" : money(line.cost);
    item.append(cost);
  }
  return item;
}

export function defineMosfetMakerElement(): void {
  if (!customElements.get(MOSFET_MAKER_TAG)) {
    customElements.define(MOSFET_MAKER_TAG, MosfetMakerElement);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "mosfet-maker": MosfetMakerElement;
  }
}
