import { defineBotCritterElement, BOT_CRITTER_TAG } from "../face/index.ts";
import type { ExpressionName } from "../face/presets.ts";

const ELEMENT_NAME = "mosfet-bench";

export type BenchTask = {
  readonly id: string;
  readonly label: string;
  readonly ask: string;
  readonly correction: string;
};

/** The bench jobs. Mirrors the marketing demo's tasks; these run for real. */
export const BENCH_TASKS: readonly BenchTask[] = [
  { id: "code", label: "fix a failing test", ask: "checkout tests are red again, fix it", correction: "always run the tests twice before declaring green — the second run catches the flaky one" },
  { id: "plan", label: "plan the week", ask: "plan my week around the thursday demo", correction: "block friday morning as buffer — demos always slip" },
  { id: "computer", label: "clean up the repo", ask: "find and archive stale branches in the repo", correction: "never touch main, and comment on the branch before archiving it" },
];

const STYLE = `
:host { display: grid; gap: .8rem; color: inherit; font: 14px/1.5 system-ui, sans-serif; }
.panel {
  display: grid; gap: .8rem;
  background: #12141a; border: 1px solid #2a3140; border-radius: 16px; padding: 1rem;
}
header { display: flex; align-items: center; gap: .8rem; }
bot-critter { block-size: 3.2rem; inline-size: 4rem; flex: none; }
.who { flex: 1; } .who b { display: block; font-size: 15px; } .who span { color: #8b93a7; font-size: 12.5px; }
.meter {
  font: 600 14px ui-monospace, Menlo, monospace; padding: .3rem .55rem; border-radius: 8px;
  border: 1px solid #2a3140; font-variant-numeric: tabular-nums; transition: color .3s, border-color .3s;
}
.meter[data-mode="paid"] { color: #f5b25b; border-color: #f5b25b73; }
.meter[data-mode="free"] { color: #2dd4bf; border-color: #2dd4bf73; }
.tasks { display: flex; gap: .4rem; flex-wrap: wrap; }
button {
  background: #1a1e25; color: #c9d1d9; border: 1px solid #2a3140; border-radius: 8px;
  padding: .35rem .7rem; cursor: pointer; font: inherit; font-size: 13px;
}
button[aria-pressed="true"] { border-color: #2dd4bf; color: #2dd4bf; }
button:disabled { opacity: .5; cursor: default; }
.run { display: grid; gap: .45rem; min-block-size: 6rem; }
ol { list-style: none; margin: 0; padding: 0; display: grid; gap: .25rem; font: 13px ui-monospace, Menlo, monospace; }
li { display: flex; gap: .5rem; } li .cost { color: #f5b25b; } li .cost.free { color: #2dd4bf; }
.result { color: #c9d1d9; font-size: 13.5px; }
.teach { display: flex; gap: .4rem; }
input {
  flex: 1; background: #0d1117; color: #e8eaef; border: 1px solid #2a3140;
  border-radius: 8px; padding: .4rem .6rem; font: inherit; font-size: 13.5px;
}
.problem { color: #f85149; font-size: 13px; }
.status { color: #8b93a7; font-size: 12.5px; min-block-size: 1.1em; }
.skill { color: #2dd4bf; font-size: 13px; }
`;

export class MosfetBench extends HTMLElement {
  #root: ShadowRoot;
  #face: HTMLElement;
  #meter: HTMLElement;
  #log: HTMLOListElement;
  #result: HTMLParagraphElement;
  #skill: HTMLSpanElement;
  #correction: HTMLInputElement;
  #teachBtn: HTMLButtonElement;
  #runBtn: HTMLButtonElement;
  #status: HTMLSpanElement;
  #task: BenchTask = BENCH_TASKS[0]!;
  #busy = false;

  constructor() {
    super();
    this.#root = this.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = STYLE;

    this.#face = document.createElement(BOT_CRITTER_TAG);
    this.#face.setAttribute("expression", "normal");

    const name = document.createElement("b");
    name.textContent = "mosfet · the bench";
    const sub = document.createElement("span");
    sub.textContent = "run it · correct it once · every run after is free";
    const who = document.createElement("div");
    who.className = "who";
    who.append(name, sub);

    this.#meter = document.createElement("span");
    this.#meter.className = "meter";
    this.#meter.textContent = "$0.00";
    this.#meter.dataset["mode"] = "free";

    const header = document.createElement("header");
    header.append(this.#face, who, this.#meter);

    const tasks = document.createElement("div");
    tasks.className = "tasks";
    for (const task of BENCH_TASKS) {
      const btn = document.createElement("button");
      btn.textContent = task.label;
      btn.setAttribute("aria-pressed", String(task === this.#task));
      btn.addEventListener("click", () => {
        this.#task = task;
        for (const b of tasks.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b === btn));
        this.#reset();
      });
      tasks.append(btn);
    }

    this.#log = document.createElement("ol");
    this.#result = document.createElement("p");
    this.#result.className = "result";
    this.#skill = document.createElement("span");
    this.#skill.className = "skill";
    const run = document.createElement("div");
    run.className = "run";
    run.append(this.#log, this.#result, this.#skill);

    this.#correction = document.createElement("input");
    this.#correction.placeholder = "…or correct it once, in plain words";
    this.#correction.value = this.#task.correction;
    this.#teachBtn = document.createElement("button");
    this.#teachBtn.textContent = "teach";
    this.#teachBtn.addEventListener("click", () => void this.#teach());
    const teach = document.createElement("div");
    teach.className = "teach";
    teach.append(this.#correction, this.#teachBtn);

    this.#runBtn = document.createElement("button");
    this.#runBtn.textContent = `run: ${this.#task.label}`;
    this.#runBtn.addEventListener("click", () => void this.#run());

    this.#status = document.createElement("span");
    this.#status.className = "status";

    const panel = document.createElement("div");
    panel.className = "panel";
    panel.append(header, tasks, run, this.#runBtn, teach, this.#status);
    this.#root.append(style, panel);

    defineBotCritterElement();
    void this.#loadRules();
  }

  #express(expression: ExpressionName): void {
    this.#face.setAttribute("expression", expression);
  }

  #cost(cents: number): void {
    this.#meter.textContent = `$${(cents / 100).toFixed(2)}`;
    this.#meter.dataset["mode"] = cents > 0 ? "paid" : "free";
  }

  #reset(): void {
    this.#log.replaceChildren();
    this.#result.textContent = "";
    this.#skill.textContent = "";
    this.#status.textContent = "";
    this.#correction.value = this.#task.correction;
    this.#runBtn.textContent = `run: ${this.#task.label}`;
    this.#express("normal");
    void this.#loadRules();
  }

  async #loadRules(): Promise<void> {
    try {
      const response = await fetch("/api/bench/rules");
      const body = (await response.json()) as { rules?: Record<string, { skill?: string }> };
      const rule = body.rules?.[this.#task.id];
      this.#skill.textContent = rule?.skill ? `learned: ${rule.skill}` : "";
    } catch {
      /* bridge not up; the run reports it */
    }
  }

  #step(text: string, cost: number | null): void {
    const li = document.createElement("li");
    const body = document.createElement("span");
    body.className = "t";
    body.textContent = text;
    li.append(body);
    if (cost !== null) {
      const c = document.createElement("span");
      c.className = cost > 0 ? "cost" : "cost free";
      c.textContent = cost > 0 ? `$${cost.toFixed(2)}` : "free";
      li.append(c);
    }
    this.#log.append(li);
  }

  async #run(): Promise<void> {
    if (this.#busy) return;
    this.#busy = true;
    this.#runBtn.disabled = true;
    this.#teachBtn.disabled = true;
    this.#express("focused");
    this.#status.textContent = "working…";
    this.#log.replaceChildren();
    try {
      const response = await fetch("/api/bench/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task: this.#task.id, ask: this.#task.ask }),
      });
      const body = (await response.json()) as {
        mode?: string; cost?: number; steps?: string[]; result?: string; skill?: string; problem?: string;
      };
      if (body.problem) {
        this.#status.textContent = body.problem;
        this.#express("worried");
        return;
      }
      const free = body.mode === "free";
      for (const step of body.steps ?? []) this.#step(step, free ? 0 : 0.01);
      this.#result.textContent = body.result ?? "";
      this.#skill.textContent = body.skill ? `learned: ${body.skill}` : this.#skill.textContent;
      this.#cost(free ? 0 : Math.round((body.cost ?? 0.04) * 100));
      this.#status.textContent = free ? "ran it from the pinned rule — no model call" : "ran it live — teach it and the next run is free";
      this.#express(free ? "happy" : "normal");
    } catch (error) {
      this.#status.textContent = `run failed: ${String(error)}`;
      this.#express("worried");
    } finally {
      this.#busy = false;
      this.#runBtn.disabled = false;
      this.#teachBtn.disabled = false;
    }
  }

  async #teach(): Promise<void> {
    if (this.#busy) return;
    const correction = this.#correction.value.trim();
    if (correction === "") return;
    this.#busy = true;
    this.#runBtn.disabled = true;
    this.#teachBtn.disabled = true;
    this.#express("focused");
    this.#status.textContent = "learning…";
    try {
      const response = await fetch("/api/bench/teach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task: this.#task.id, correction }),
      });
      const body = (await response.json()) as { skill?: string; problem?: string };
      if (body.problem) {
        this.#status.textContent = body.problem;
        this.#express("worried");
        return;
      }
      this.#skill.textContent = body.skill ? `learned: ${body.skill}` : "";
      this.#status.textContent = "learned it. run again — that one's free.";
      this.#express("happy");
      this.#correction.value = "";
    } catch (error) {
      this.#status.textContent = `teach failed: ${String(error)}`;
      this.#express("worried");
    } finally {
      this.#busy = false;
      this.#runBtn.disabled = false;
      this.#teachBtn.disabled = false;
    }
  }
}

export function registerMosfetBench(): void {
  if (customElements.get(ELEMENT_NAME) === undefined) {
    customElements.define(ELEMENT_NAME, MosfetBench);
  }
}
