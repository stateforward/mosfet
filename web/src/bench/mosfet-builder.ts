import { BOT_CRITTER_TAG, defineBotCritterElement } from "../face/index.ts";

const ELEMENT_NAME = "mosfet-builder";

type Part = { id: string; label: string; describes: string; kind?: string; available?: boolean; note?: string };
type Catalog = { devices: Part[]; abilities: Part[]; cognition: Part };

const STYLE = `
:host {
  --paper: #f2ede3; --panel: #ffffff; --ink: #141414; --ink-2: #57524a;
  --rule: #d5ccbb; --signal: #ff5a1f; --mint: #1fbf8f;
  --serif: "Instrument Serif", serif; --sans: "Inter Tight", system-ui, sans-serif; --mono: "JetBrains Mono", monospace;
  display: grid; gap: .8rem; color: var(--ink); font: 15px/1.5 var(--sans);
}
.panel {
  display: grid; gap: .9rem;
  background: var(--panel); border: 1px solid var(--rule); border-radius: 18px; padding: 1.1rem;
  box-shadow: 0 24px 60px -32px rgba(20,20,20,.25);
}
h2 { font: 400 1.7rem var(--serif); letter-spacing: -0.02em; margin: 0; }
h2 em { color: var(--signal); font-style: italic; }
.group-label { font: 600 12px var(--mono); text-transform: uppercase; letter-spacing: .08em; color: var(--ink-2); }
.parts { display: flex; gap: .45rem; flex-wrap: wrap; }
.part { position: relative; }
.part button {
  background: var(--paper); color: var(--ink); border: 1px solid var(--rule); border-radius: 12px;
  padding: .45rem .75rem; cursor: pointer; font: inherit; font-size: 13.5px; text-align: left;
  transition: border-color .2s, background .2s, color .2s;
}
.part button small { display: block; color: var(--ink-2); font-size: 11.5px; max-inline-size: 15rem; }
.part button[aria-pressed="true"] { background: var(--ink); color: var(--paper); border-color: var(--ink); }
.part button[aria-pressed="true"] small { color: #cfc8ba; }
.part button:disabled { opacity: .45; cursor: not-allowed; }
.part .why { position: absolute; inset-block-start: calc(100% + 4px); inset-inline-start: 0; z-index: 3;
  background: var(--ink); color: var(--paper); font-size: 11.5px; padding: .3rem .5rem; border-radius: 8px;
  max-inline-size: 18rem; opacity: 0; pointer-events: none; transition: opacity .15s; }
.part:hover .why { opacity: 1; }
.row { display: flex; gap: .5rem; align-items: center; flex-wrap: wrap; }
input.name {
  flex: 1; min-inline-size: 8rem; background: var(--paper); color: var(--ink); border: 1px solid var(--rule);
  border-radius: 999px; padding: .5rem .9rem; font: inherit; font-size: 14px;
}
button.go { background: var(--signal); color: #fff; border: 0; border-radius: 999px; padding: .55rem 1.1rem;
  font: inherit; font-weight: 600; cursor: pointer; }
button.go:hover { background: var(--ink); }
button.ghost { background: none; border: 1px solid var(--rule); color: var(--ink-2); border-radius: 999px;
  padding: .35rem .7rem; font: inherit; font-size: 12.5px; cursor: pointer; }
button.ghost:hover { border-color: var(--ink); color: var(--ink); }
.note { color: var(--ink-2); font: 12.5px var(--mono); min-block-size: 1.1em; }
.note.bad { color: #c23c0c; }
.bots { display: grid; gap: .8rem; }
.bot {
  display: grid; gap: .6rem; border: 1px dashed var(--rule); border-radius: 14px; padding: .8rem;
}
.bot header { display: flex; align-items: center; gap: .6rem; }
bot-critter { inline-size: 4.4rem; block-size: 3.6rem; flex: none; }
.bot .who { flex: 1; } .bot .who b { font: 600 15px var(--sans); display: block; }
.bot .who span { color: var(--ink-2); font-size: 12px; font-family: var(--mono); }
.chat { display: flex; gap: .4rem; }
.chat input { flex: 1; min-inline-size: 0; background: var(--paper); color: var(--ink); border: 1px solid var(--rule);
  border-radius: 999px; padding: .45rem .85rem; font: inherit; font-size: 13.5px; }
.transcript { display: grid; gap: .35rem; font: 13px var(--mono); max-block-size: 10rem; overflow-y: auto; }
.transcript .you { color: var(--ink); }
.transcript .bot { color: var(--mint); }
.transcript .err { color: #c23c0c; }
button:focus-visible, input:focus-visible { outline: 2px solid var(--signal); outline-offset: 2px; }
`;

export class MosfetBuilder extends HTMLElement {
  #root: ShadowRoot;
  #catalog: Catalog | null = null;
  #pickedDevices = new Set<string>(["phone"]);
  #pickedAbilities = new Set<string>();
  #bots = new Map<string, { label: string; node: HTMLElement; log: HTMLElement; input: HTMLInputElement }>();

  constructor() {
    super();
    this.#root = this.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = STYLE;
    const panel = document.createElement("div");
    panel.className = "panel";
    const h2 = document.createElement("h2");
    h2.innerHTML = "Build a <em>bot</em>";
    const note = document.createElement("div");
    note.className = "note";
    note.textContent = "loading the parts bin…";
    panel.append(h2, note);
    this.#root.append(style, panel);
    defineBotCritterElement();
    void this.#load();
  }

  async #load(): Promise<void> {
    try {
      const response = await fetch("/api/builder/catalog");
      this.#catalog = (await response.json()) as Catalog;
    } catch {
      const note = this.#root.querySelector(".note")!;
      note.textContent = "the bridge is not running — start workshop/server.py";
      note.classList.add("bad");
      return;
    }
    this.#render();
  }

  #render(): void {
    const catalog = this.#catalog!;
    const panel = this.#root.querySelector(".panel")!;
    panel.replaceChildren();
    const h2 = document.createElement("h2");
    h2.innerHTML = "Build a <em>bot</em>";
    panel.append(h2);

    const devicesLabel = document.createElement("div");
    devicesLabel.className = "group-label";
    devicesLabel.textContent = "devices";
    const devices = document.createElement("div");
    devices.className = "parts";
    for (const part of catalog.devices) devices.append(this.#partButton(part, this.#pickedDevices));
    panel.append(devicesLabel, devices);

    const abilitiesLabel = document.createElement("div");
    abilitiesLabel.className = "group-label";
    abilitiesLabel.textContent = "abilities";
    const abilities = document.createElement("div");
    abilities.className = "parts";
    for (const part of catalog.abilities) abilities.append(this.#partButton(part, this.#pickedAbilities));
    panel.append(abilitiesLabel, abilities);

    const cog = document.createElement("div");
    cog.className = "group-label";
    cog.textContent = `+ ${catalog.cognition.label} (always wired — ${catalog.cognition.describes})`;
    panel.append(cog);

    const name = document.createElement("input");
    name.className = "name";
    name.placeholder = "name your bot…";
    name.value = "fetch";
    const build = document.createElement("button");
    build.className = "go";
    build.textContent = "boot it";
    build.addEventListener("click", () => void this.#build(name));
    const row = document.createElement("div");
    row.className = "row";
    row.append(name, build);
    panel.append(row);

    const status = document.createElement("div");
    status.className = "note";
    panel.append(status);

    const bots = document.createElement("div");
    bots.className = "bots";
    panel.append(bots);
    this.#status = status;
    this.#botsHost = bots;
  }

  #status!: HTMLElement;
  #botsHost!: HTMLElement;

  #partButton(part: Part, picked: Set<string>): HTMLDivElement {
    const wrap = document.createElement("div");
    wrap.className = "part";
    const btn = document.createElement("button");
    btn.innerHTML = `${part.label}<small>${part.describes}</small>`;
    btn.setAttribute("aria-pressed", String(picked.has(part.id)));
    if (part.available === false) btn.disabled = true;
    btn.addEventListener("click", () => {
      if (picked.has(part.id)) picked.delete(part.id);
      else picked.add(part.id);
      btn.setAttribute("aria-pressed", String(picked.has(part.id)));
    });
    const why = document.createElement("span");
    why.className = "why";
    why.textContent = part.note ?? (part.kind ? `${part.kind} ability` : "device");
    wrap.append(btn, why);
    return wrap;
  }

  async #build(name: HTMLInputElement): Promise<void> {
    const botName = name.value.trim() || "mosfet";
    this.#status.className = "note";
    this.#status.textContent = "assembling…";
    try {
      const response = await fetch("/api/builder/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: botName,
          devices: [...this.#pickedDevices],
          abilities: [...this.#pickedAbilities],
        }),
      });
      const body = (await response.json()) as { bot?: string; label?: string };
      if (!body.bot) {
        this.#status.className = "note bad";
        this.#status.textContent = body.label ?? "build failed";
        return;
      }
      this.#status.textContent = `booted: ${body.label}`;
      this.#addBot(body.bot, body.label ?? botName);
    } catch (error) {
      this.#status.className = "note bad";
      this.#status.textContent = `build failed: ${String(error)}`;
    }
  }

  #addBot(id: string, label: string): void {
    const node = document.createElement("div");
    node.className = "bot";
    const face = document.createElement(BOT_CRITTER_TAG);
    face.setAttribute("expression", "happy");
    const who = document.createElement("div");
    who.className = "who";
    const name = document.createElement("b");
    name.textContent = label.split(" [")[0]!;
    const spec = document.createElement("span");
    spec.textContent = label.split("[").pop()?.replace("]", "") ?? "";
    who.append(name, spec);
    const header = document.createElement("header");
    header.append(face, who);
    const stop = document.createElement("button");
    stop.className = "ghost";
    stop.textContent = "stop";
    header.append(stop);

    const log = document.createElement("div");
    log.className = "transcript";
    const input = document.createElement("input");
    input.placeholder = "text your bot…";
    const send = document.createElement("button");
    send.className = "ghost";
    send.textContent = "send";
    const chat = document.createElement("div");
    chat.className = "chat";
    chat.append(input, send);
    node.append(header, log, chat);
    this.#botsHost.append(node);
    this.#bots.set(id, { label, node, log, input });

    const say = (kind: string, text: string) => {
      const line = document.createElement("div");
      line.className = kind;
      line.textContent = text;
      log.append(line);
      log.scrollTop = log.scrollHeight;
    };
    const go = async () => {
      const text = input.value.trim();
      if (text === "") return;
      input.value = "";
      say("you", text);
      face.setAttribute("expression", "focused");
      try {
        const response = await fetch("/api/builder/interact", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bot: id, text }),
        });
        const body = (await response.json()) as { reply?: string | null; problem?: string | null };
        if (body.reply) {
          say("bot", body.reply);
          face.setAttribute("expression", "happy");
        } else {
          say("err", body.problem ?? "no reply");
          face.setAttribute("expression", "worried");
        }
      } catch (error) {
        say("err", String(error));
        face.setAttribute("expression", "worried");
      }
    };
    send.addEventListener("click", () => void go());
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") void go();
    });
    stop.addEventListener("click", async () => {
      await fetch("/api/builder/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bot: id }),
      });
      node.remove();
      this.#bots.delete(id);
    });
  }
}

export function registerMosfetBuilder(): void {
  if (customElements.get(ELEMENT_NAME) === undefined) {
    customElements.define(ELEMENT_NAME, MosfetBuilder);
  }
}
