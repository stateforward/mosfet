import * as hsm from "../hsm.ts";
import { defineBotCritterElement, type BotCritterElement } from "../face/bot-critter.ts";
import { Maker, startMaker, type Line } from "./maker-machine.ts";
import { firstRunCost, RUNS_PER_YEAR, TASKS } from "./tasks.ts";

export const MOSFET_MAKER_TAG = "mosfet-maker";

const template = document.createElement("template");
template.innerHTML = `
  <style>
    :host {
      --accent: var(--site-accent, #2dd4bf);
      --muted: var(--site-muted, #8b93a7);
      --line: var(--site-line, #2a3140);
      --money: #f5b25b;
      display: grid;
      gap: .9rem;
      background: var(--site-panel, #12141a);
      border: 1px solid var(--line);
      border-radius: 18px;
      padding: 1.1rem;
      color: var(--site-ink, #e8eaef);
      font: 14px/1.45 var(--site-sans, system-ui, sans-serif);
      box-shadow: 0 30px 80px -30px rgba(45, 212, 191, .18);
    }
    header { display: flex; align-items: center; gap: .8rem; }
    bot-critter { block-size: 3.4rem; inline-size: 4rem; flex: none; }
    .who { flex: 1; min-inline-size: 0; }
    .who b { display: block; font-size: 15px; }
    .who span { color: var(--muted); font-size: 12.5px; }
    .meter {
      font: 600 15px var(--site-mono, ui-monospace, Menlo, monospace);
      padding: .35rem .6rem; border-radius: 9px; border: 1px solid var(--line);
      font-variant-numeric: tabular-nums; transition: color .3s, border-color .3s;
    }
    .meter[data-mode="paid"] { color: var(--money); border-color: color-mix(in srgb, var(--money) 45%, transparent); }
    .meter[data-mode="free"] { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 45%, transparent); }
    .tasks { display: flex; gap: .4rem; flex-wrap: wrap; }
    .tasks button[aria-pressed="true"] { border-color: var(--accent); color: var(--accent); }
    ol {
      list-style: none; margin: 0; padding: .2rem 0; display: grid; gap: .3rem; align-content: start;
      block-size: 15.5rem; overflow-y: auto; scroll-behavior: smooth; padding-inline-end: .8rem; scrollbar-width: thin;
      font-family: var(--site-mono, ui-monospace, Menlo, monospace); font-size: 13px;
    }
    .empty { color: var(--muted); display: grid; place-items: center; block-size: 100%; text-align: center; font-family: inherit; }
    li { display: flex; gap: .6rem; align-items: baseline; animation: in .25s ease-out; }
    @keyframes in { from { opacity: 0; transform: translateY(4px); } }
    li .t { flex: 1; min-inline-size: 0; }
    li .c { color: var(--money); font-variant-numeric: tabular-nums; }
    li .c.free { color: var(--accent); }
    li[data-who="you"] .t { color: var(--site-ink, #e8eaef); }
    li[data-who="you"]::before { content: "you"; color: var(--muted); inline-size: 2.4rem; flex: none; }
    li[data-who="step"] { color: var(--muted); padding-inline-start: 3rem; }
    li[data-who="result"] { padding-inline-start: 3rem; color: var(--site-ink, #e8eaef); font-weight: 600; }
    li[data-who="result"]::before { content: "✓"; color: var(--accent); }
    li[data-who="bot"] { padding-inline-start: 3rem; color: var(--accent); }
    li[data-who="note"] { padding-inline-start: 3rem; color: var(--money); }
    .panel { display: grid; gap: .6rem; border-top: 1px solid var(--line); padding-top: .9rem; }
    .panel p { margin: 0; color: var(--muted); }
    .suggest { text-align: start; border-style: dashed; }
    form { display: flex; gap: .5rem; }
    input {
      flex: 1; min-inline-size: 0; font: inherit; color: inherit; background: var(--site-bg, #0b0d12);
      border: 1px solid var(--line); border-radius: 10px; padding: .55rem .7rem;
    }
    input:focus-visible, button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
    button {
      font: inherit; cursor: pointer; border-radius: 10px; padding: .5rem .8rem;
      border: 1px solid var(--line); background: transparent; color: inherit;
    }
    button:hover { border-color: var(--muted); }
    .primary { background: var(--accent); color: #042f2e; border-color: transparent; font-weight: 650; }
    .primary:hover { filter: brightness(1.08); border-color: transparent; }
    .skill {
      display: flex; gap: .7rem; align-items: center; padding: .7rem .8rem; border-radius: 12px;
      background: color-mix(in srgb, var(--accent) 10%, transparent);
      border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
      animation: in .35s ease-out;
    }
    .skill div { flex: 1; min-inline-size: 0; }
    .skill small { display: block; color: var(--accent); font-weight: 650; letter-spacing: .04em; text-transform: uppercase; font-size: 11px; }
    .skill button { font-size: 12.5px; padding: .3rem .55rem; color: var(--muted); }
    .hint { color: var(--muted); font-size: 13px; }
    .row { display: flex; gap: .5rem; align-items: center; flex-wrap: wrap; }
    .tally { display: grid; grid-template-columns: 1fr 1fr; gap: .5rem; }
    .tally:empty { display: none; }
    .tally div { border: 1px solid var(--line); border-radius: 12px; padding: .55rem .7rem; }
    .tally small { display: block; color: var(--muted); font-size: 11.5px; }
    .tally strong { font: 700 22px var(--site-mono, ui-monospace, Menlo, monospace); font-variant-numeric: tabular-nums; letter-spacing: -0.02em; }
    .tally .them strong { color: var(--money); text-decoration: line-through; text-decoration-thickness: 2px; }
    .tally .us { border-color: color-mix(in srgb, var(--accent) 40%, transparent); }
    .tally .us strong { color: var(--accent); }
    [hidden] { display: none !important; }
  </style>
  <header>
    <bot-critter expression="normal" track ink="#3ee0a8" eye="#17181c"></bot-critter>
    <div class="who"><b>Your bot</b><span class="status">idle</span></div>
    <output class="meter" data-mode="idle" title="Model spend for this run">$0.00</output>
  </header>
  <div class="tasks" role="group" aria-label="Pick a job"></div>
  <ol aria-live="polite"></ol>
  <div class="panel" data-panel="review" hidden>
    <p>Done, but not how you'd do it? Tell it once.</p>
    <button type="button" class="suggest"></button>
    <form>
      <input name="text" autocomplete="off" placeholder="or say it your way" />
      <button type="submit" class="primary">Tell it</button>
    </form>
  </div>
  <div class="panel" data-panel="learned" hidden>
    <div class="skill">
      <div><small>Learned</small><span class="skill-text"></span></div>
      <button type="button" data-do="forget">forget</button>
    </div>
    <div class="tally"></div>
    <div class="row">
      <button type="button" class="primary" data-do="run">Run it again</button>
      <span class="hint">free, and it does it your way</span>
    </div>
  </div>
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

  /**
   * `watching` redraws on every maker change. The moment the bot learns a job
   * the host goes to `celebrating`: the bot spins, and more changes still
   * redraw, until it settles back to `watching`.
   */
  static readonly model = hsm.define(
    "MosfetMaker",
    hsm.initial(hsm.target("watching")),
    hsm.state(
      "watching",
      hsm.transition(hsm.on(Maker.changedEvent.name), hsm.guard(MosfetMakerElement.justLearned), hsm.target("../celebrating")),
      hsm.transition(hsm.on(Maker.changedEvent.name), hsm.effect(MosfetMakerElement.onChanged)),
    ),
    hsm.state(
      "celebrating",
      hsm.entry(MosfetMakerElement.celebrate),
      hsm.transition(hsm.after(() => MosfetMakerElement.celebrateMs), hsm.target("../watching")),
      hsm.transition(hsm.on(Maker.changedEvent.name), hsm.effect(MosfetMakerElement.onChanged)),
    ),
  );

  static justLearned(_ctx: hsm.Context, _instance: hsm.Instance, event: hsm.Event): boolean {
    const data = event.data;
    return hsm.isRecord(data) && data["moment"] === "learned";
  }

  static celebrate(_ctx: hsm.Context, instance: hsm.Instance): void {
    if (!(instance instanceof MosfetMakerElement)) return;
    instance.#schedule();
    instance.#root.querySelector<BotCritterElement>("bot-critter")?.spin();
  }

  #root: ShadowRoot;
  #maker: Maker | null = null;
  #frame = 0;
  #lineCount = -1;

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
    this.#maker = startMaker({ ctx: this.context() });
    this.#schedule();
  }

  disconnectedCallback(): void {
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
    const tasks = this.#q(".tasks");
    for (const task of Object.values(TASKS)) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = task.label;
      button.dataset["task"] = task.id;
      button.addEventListener("click", () => this.pick(task.id));
      tasks.append(button);
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

    const status = this.#q(".status");
    status.textContent = statusFor(state);

    const learned = state.startsWith("/Maker/learned");
    const meter = this.#q<HTMLOutputElement>(".meter");
    meter.textContent = money(maker.runCost);
    meter.dataset["mode"] = task === null ? "idle" : learned ? "free" : "paid";

    for (const chip of this.#root.querySelectorAll<HTMLButtonElement>(".tasks button")) {
      chip.setAttribute("aria-pressed", String(task?.id === chip.dataset["task"]));
    }

    const list = this.#q("ol");
    if (maker.lines.length !== this.#lineCount) {
      this.#lineCount = maker.lines.length;
      if (maker.lines.length === 0) {
        const empty = document.createElement("li");
        empty.className = "empty";
        empty.textContent = "Pick a job above. Watch what it costs.";
        list.replaceChildren(empty);
      } else {
        list.replaceChildren(...maker.lines.map(lineItem));
        list.scrollTop = list.scrollHeight;
      }
    }

    const review = this.#q("[data-panel=review]");
    review.hidden = !state.endsWith("/untaught/reviewing");
    if (task !== null) this.#q(".suggest").textContent = `“${task.correction}”`;

    const learnedPanel = this.#q("[data-panel=learned]");
    learnedPanel.hidden = !learned;
    this.#q(".skill-text").textContent = maker.skill ?? "";
    const run = this.#q<HTMLButtonElement>('[data-do="run"]');
    run.disabled = state.endsWith("/replaying");
    const tally = this.#q(".tally");
    tally.textContent = "";
    if (task !== null && learned) {
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

function statusFor(state: string): string {
  if (state.endsWith("/choosing")) return "waiting for a job";
  if (state.endsWith("/starting") || state.endsWith("/working")) return "thinking · on the meter";
  if (state.endsWith("/reviewing")) return "done";
  if (state.endsWith("/learning")) return "learning";
  if (state.endsWith("/replaying")) return "doing what it learned · free";
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
