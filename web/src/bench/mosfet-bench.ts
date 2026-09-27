import * as hsm from "../hsm.ts";
import { defineBotCritterElement, type BotCritterElement } from "../face/bot-critter.ts";
import { type ExpressionName } from "../face/presets.ts";
import { botTransport, Chat, startChat, type ChatLine } from "../playground/chat-machine.ts";
import { Bench, BENCH_TASKS, money, startBench, type BenchPhase, type BenchRule, type LogLine } from "./bench-machine.ts";
import { Builder, startBuilder, type Part } from "./builder-machine.ts";

export const MOSFET_BENCH_TAG = "mosfet-bench";

/** The rail. `done` is past the last step: the loop has been run end to end. */
type Step = "build" | "job" | "correct" | "free" | "done";
const WORK_STEPS = ["job", "correct", "free", "done"] as const;

const NEXT: Record<Step, string> = {
  build: "Pick what it's made of, give it a name, and boot it.",
  job: "Give it a job. The first run is live, so the meter runs.",
  correct: "Not quite how you'd do it? Tell it once, in plain words.",
  free: "Run the same job again. Keep an eye on the meter.",
  done: "That's the loop. Try another job — or unpin a rule and watch it go back on the meter.",
};

/** Plain-words blurbs for the parts the bridge knows; anything new falls back to the bridge's own description. */
const PART_BLURBS: Record<string, string> = {
  phone: "texts and calls — you can reach it by SMS",
  microphone: "hears what's going on around it",
  speaker: "a voice box",
  listening: "turns what it hears into thoughts",
  speaking: "says its replies out loud",
};

const PROMPTS = ["What can you do?", "What are you made of?", "Plan my morning in three steps"];

function stepOfPhase(phase: unknown): Step | null {
  switch (phase as BenchPhase) {
    case "offline":
    case "loading":
    case "fresh":
    case "running":
      return "job";
    case "reviewing":
    case "teaching":
      return "correct";
    case "learned":
    case "replaying":
      return "free";
    case "replayed":
      return "done";
    default:
      return null;
  }
}

function stepOfBenchState(path: string): Step {
  if (path.endsWith("/replayed")) return "done";
  if (path.includes("/learned")) return "free";
  if (path.endsWith("/reviewing") || path.endsWith("/teaching")) return "correct";
  return "job";
}

const template = document.createElement("template");
template.innerHTML = `
<style>
  :host {
    --paper: #f2ede3; --paper-2: #e9e2d4; --card: #fbf8f2; --ink: #141414; --ink-2: #57524a; --rule: #d5ccbb;
    --signal: #ff5a1f; --mint: #1fbf8f; --mint-wash: #c9f2e2; --bad: #c23c0c;
    --serif: "Instrument Serif", "Times New Roman", serif;
    --sans: "Inter Tight", system-ui, sans-serif;
    --mono: "JetBrains Mono", ui-monospace, Menlo, monospace;
    display: block; color: var(--ink); font: 15px/1.5 var(--sans);
  }
  * { box-sizing: border-box; }
  [hidden] { display: none !important; }
  button { font: inherit; color: inherit; cursor: pointer; }
  button:disabled { cursor: default; }
  :focus-visible { outline: 2.5px solid var(--signal); outline-offset: 2px; }
  .bench {
    background: var(--paper-2); border: 1.5px solid var(--ink); border-radius: 26px;
    box-shadow: 0 40px 80px -50px rgba(20,20,20,.55);
    padding: clamp(12px, 2vw, 22px); display: grid; gap: clamp(12px, 1.6vw, 18px);
  }

  /* rail */
  .rail { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; counter-reset: s; }
  .rail li {
    counter-increment: s; position: relative; display: grid; grid-template-columns: auto 1fr; column-gap: .6rem; align-items: center;
    padding: .6rem .8rem; border-radius: 14px; border: 1.5px solid transparent; color: var(--ink-2); transition: background .25s, border-color .25s, color .25s;
  }
  .rail li::before {
    content: counter(s); grid-row: span 2; inline-size: 1.9rem; block-size: 1.9rem; border-radius: 50%;
    display: grid; place-items: center; font: 600 13px var(--mono); border: 1.5px solid var(--rule); background: var(--paper);
  }
  .rail b { font-size: 14.5px; color: inherit; letter-spacing: -0.01em; }
  .rail small { font: 12px var(--mono); color: var(--ink-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .rail li[data-at="done"] { color: var(--ink); }
  .rail li[data-at="done"]::before { content: "✓"; background: var(--mint); border-color: var(--mint); color: #fff; }
  .rail li[aria-current="step"] { background: var(--paper); border-color: var(--ink); color: var(--ink); box-shadow: 3px 3px 0 var(--ink); }
  .rail li[aria-current="step"]::before { background: var(--signal); border-color: var(--signal); color: #fff; animation: beckon 1.6s ease-in-out infinite; }
  @keyframes beckon { 50% { box-shadow: 0 0 0 .35rem color-mix(in srgb, var(--signal) 22%, transparent); } }
  .next { margin: 0; display: flex; gap: .55rem; align-items: baseline; font: 400 clamp(1.25rem, 2.2vw, 1.6rem)/1.2 var(--serif); letter-spacing: -0.01em; }
  .next::before { content: "Next"; font: 600 11.5px var(--mono); text-transform: uppercase; letter-spacing: .08em; color: #fff; background: var(--ink); padding: .2rem .5rem; border-radius: 6px; transform: translateY(-.15em); flex: none; }

  .offline { margin: 0; padding: .8rem 1rem; border-radius: 14px; border: 1.5px dashed var(--bad); color: var(--bad); background: #fff5ef; font-size: 14px; }
  .offline code { font: 600 12.5px var(--mono); color: var(--ink); background: var(--paper); padding: .1rem .35rem; border-radius: 5px; }

  /* floor */
  .floor { display: grid; gap: clamp(12px, 1.6vw, 18px); grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr) minmax(0, .82fr); grid-template-areas: "ticket stage peg" "ticket talk peg"; align-items: start; }
  .ticket { grid-area: ticket; } .stage { grid-area: stage; } .peg { grid-area: peg; } .talk { grid-area: talk; }
  .card { background: var(--card); border: 1px solid var(--rule); border-radius: 18px; padding: clamp(14px, 1.6vw, 18px); display: grid; gap: .8rem; }
  .card-label { margin: 0; font: 600 11.5px var(--mono); text-transform: uppercase; letter-spacing: .08em; color: var(--ink-2); display: flex; justify-content: space-between; gap: .5rem; }
  h3 { margin: 0; font: 400 1.9rem/1 var(--serif); letter-spacing: -0.02em; }
  h3 em { color: var(--signal); }

  /* build */
  .parts { display: grid; gap: .45rem; }
  .part {
    display: grid; grid-template-columns: auto 1fr; gap: .1rem .65rem; align-items: center; text-align: start;
    background: var(--paper); border: 1.5px solid var(--rule); border-radius: 12px; padding: .55rem .7rem; transition: border-color .15s, background .15s, transform .15s;
  }
  .part::before { content: ""; grid-row: span 2; inline-size: 1.1rem; block-size: 1.1rem; border-radius: 5px; border: 1.5px solid var(--ink-2); background: var(--card); }
  .part b { font-size: 14px; }
  .part small { color: var(--ink-2); font-size: 12px; line-height: 1.3; }
  .part:hover:not(:disabled) { border-color: var(--ink); }
  .part[aria-pressed="true"] { border-color: var(--ink); background: #fff; }
  .part[aria-pressed="true"]::before { background: var(--ink); border-color: var(--ink); box-shadow: inset 0 0 0 3px #fff; }
  .part:disabled { opacity: .5; }
  .part:disabled small { font-style: italic; }
  .always { font: 12.5px var(--mono); color: var(--ink-2); margin: 0; padding: .5rem .7rem; border-radius: 10px; background: var(--paper); border: 1px dashed var(--rule); }
  .always b { color: var(--ink); }
  .name-row { display: flex; gap: .5rem; flex-wrap: wrap; }
  .name-row label { flex: 1 1 10rem; display: grid; gap: .25rem; font: 600 11.5px var(--mono); text-transform: uppercase; letter-spacing: .08em; color: var(--ink-2); }
  input[type="text"] {
    inline-size: 100%; min-inline-size: 0; font: 500 15px var(--sans); color: var(--ink); background: #fff;
    border: 1.5px solid var(--rule); border-radius: 999px; padding: .6rem 1rem; text-transform: none; letter-spacing: 0;
  }
  input[type="text"]:focus { border-color: var(--ink); }
  .primary {
    background: var(--signal); color: #fff; border: 1.5px solid var(--ink); border-radius: 999px; padding: .65rem 1.2rem; font-weight: 650; font-size: 15px;
    box-shadow: 3px 3px 0 var(--ink); transition: transform .12s, box-shadow .12s, background .2s; white-space: nowrap;
  }
  .primary:hover:not(:disabled) { transform: translate(-1px, -1px); box-shadow: 4px 4px 0 var(--ink); }
  .primary:active:not(:disabled) { transform: translate(2px, 2px); box-shadow: 1px 1px 0 var(--ink); }
  .primary:disabled { background: var(--rule); color: var(--ink-2); box-shadow: none; border-color: var(--rule); }
  .primary.free { background: var(--mint); }
  .name-row .primary { align-self: end; }
  .problem { margin: 0; color: var(--bad); font-size: 13.5px; }

  /* jobs */
  .jobs { display: grid; gap: .45rem; }
  .job {
    display: grid; grid-template-columns: 1fr auto; gap: .05rem .5rem; text-align: start; background: var(--paper);
    border: 1.5px solid var(--rule); border-radius: 12px; padding: .55rem .75rem; transition: border-color .15s, background .15s;
  }
  .job b { font-size: 14.5px; }
  .job small { grid-column: 1; color: var(--ink-2); font: 12px var(--mono); }
  .job .tag { grid-row: span 2; grid-column: 2; align-self: center; font: 600 11px var(--mono); padding: .15rem .45rem; border-radius: 999px; border: 1px solid var(--rule); color: var(--ink-2); }
  .job .tag.pinned { background: var(--mint-wash); border-color: var(--mint); color: #0b6b4e; }
  .job:hover:not(:disabled) { border-color: var(--ink); }
  .job[aria-pressed="true"] { background: #fff; border-color: var(--ink); box-shadow: 3px 3px 0 var(--ink); }
  .job:disabled:not([aria-pressed="true"]) { opacity: .55; }
  .go { display: flex; gap: .7rem; align-items: center; flex-wrap: wrap; }
  .go .hint { font: 12.5px var(--mono); color: var(--ink-2); }

  /* work log */
  .log { list-style: none; margin: 0; padding: .7rem .8rem; display: grid; gap: .35rem; font: 12.5px/1.45 var(--mono); background: #fff; border: 1px solid var(--rule); border-radius: 12px; max-block-size: 21rem; overflow-y: auto; }
  .log:empty { display: none; }
  .log li { display: flex; gap: .5rem; align-items: baseline; animation: land .28s cubic-bezier(.2,.8,.2,1); }
  @keyframes land { from { opacity: 0; transform: translateY(5px); } }
  .log .t { flex: 1; min-inline-size: 0; }
  .log [data-kind="ask"] { color: var(--ink-2); }
  .log [data-kind="ask"] .t::before { content: "job › "; color: var(--signal); font-weight: 600; }
  .log [data-kind="step"] .t::before { content: "· "; color: var(--ink-2); }
  .log [data-kind="result"] { font: 500 14px/1.4 var(--sans); padding: .5rem .6rem; border-radius: 9px; background: var(--paper); margin-top: .2rem; }
  .log [data-kind="result"] .t::before { content: "✓ "; color: var(--mint); font-weight: 700; }
  .log [data-kind="you"] .t::before { content: "you › "; color: var(--ink); font-weight: 600; }
  .log [data-kind="you"] { color: var(--ink); font-style: italic; }
  .log [data-kind="note"] { color: #0b6b4e; font-weight: 600; }
  .log .c { flex: none; font-weight: 600; font-variant-numeric: tabular-nums; color: var(--signal); }
  .log .c.free { color: var(--mint); }
  .thinking { display: flex; gap: .6rem; align-items: center; font: 12.5px var(--mono); color: var(--ink-2); padding: .2rem .1rem; }
  .thinking i { inline-size: .45rem; block-size: .45rem; border-radius: 50%; background: var(--signal); animation: blink 1s infinite; }
  .thinking i:nth-child(2) { animation-delay: .15s; } .thinking i:nth-child(3) { animation-delay: .3s; }
  .thinking.free i { background: var(--mint); }
  @keyframes blink { 50% { opacity: .2; } }

  /* correct */
  .teach { display: grid; gap: .55rem; padding: .8rem; border-radius: 14px; background: #fff5ef; border: 1.5px solid var(--signal); }
  .teach p { margin: 0; font: 400 1.25rem/1.15 var(--serif); }
  .suggest { text-align: start; background: #fff; border: 1.5px dashed var(--signal); border-radius: 10px; padding: .5rem .7rem; font-size: 13.5px; }
  .suggest::before { content: "one click: "; font: 600 11px var(--mono); text-transform: uppercase; letter-spacing: .06em; color: var(--signal); }
  .suggest:hover:not(:disabled) { border-style: solid; }
  .teach .row { display: flex; gap: .5rem; }
  .teach .row input { flex: 1; }
  .callout { display: flex; gap: .6rem; align-items: center; padding: .7rem .8rem; border-radius: 14px; background: var(--mint-wash); border: 1.5px solid var(--mint); }
  .callout .dot { flex: none; inline-size: .9rem; block-size: .9rem; border-radius: 50%; background: var(--signal); border: 2px solid var(--ink); }
  .callout small { display: block; font: 600 11px var(--mono); text-transform: uppercase; letter-spacing: .08em; color: #0b6b4e; }
  .callout span { font-weight: 600; }

  /* stage */
  .stage { position: relative; display: grid; justify-items: center; gap: .3rem; background: var(--paper); border: 1px solid var(--rule); border-radius: 22px; padding: 14px 14px 16px; overflow: hidden; }
  .stage::after { content: ""; position: absolute; inset-inline: 12%; inset-block-end: 4.6rem; block-size: 1.1rem; border-radius: 50%; background: radial-gradient(closest-side, rgba(20,20,20,.14), transparent); pointer-events: none; }
  .meter { justify-self: stretch; display: grid; grid-template-columns: 1fr; gap: .35rem; position: relative; padding: .6rem .8rem; border-radius: 14px; background: var(--ink); color: var(--paper); }
  .meter small { font: 600 10.5px var(--mono); text-transform: uppercase; letter-spacing: .1em; color: #9d978b; }
  .meter output { display: block; font: 600 clamp(1.9rem, 3vw, 2.4rem)/1 var(--mono); font-variant-numeric: tabular-nums; letter-spacing: -0.03em; transition: color .25s; }
  .meter[data-mode="paid"] output { color: var(--signal); }
  .meter[data-mode="free"] output { color: #3ee0a8; }
  .meter[data-mode="calling"] output { color: var(--signal); animation: blink 1.1s infinite; }
  .meter .tally { display: flex; gap: .4rem 1.2rem; flex-wrap: wrap; font: 12px var(--mono); color: #cfc8ba; border-top: 1px dashed #3a3834; padding-top: .35rem; }
  .meter .tally b { font-weight: 600; font-variant-numeric: tabular-nums; }
  .meter .tally .saved b { color: #3ee0a8; }
  .coin { position: absolute; inset-inline-start: 5.5rem; inset-block-start: .6rem; font: 700 13px var(--mono); color: var(--ink); background: #ffc93c; border: 1.5px solid var(--ink); border-radius: 999px; padding: .05rem .4rem; pointer-events: none; animation: coin .9s cubic-bezier(.2,.7,.3,1) forwards; }
  @keyframes coin { from { opacity: 0; transform: translateY(10px) scale(.6); } 25% { opacity: 1; transform: translateY(-4px) scale(1.1); } to { opacity: 0; transform: translateY(-26px) scale(1); } }
  .stamp {
    position: absolute; inset-inline-end: .9rem; inset-block-start: 1.1rem; rotate: -12deg; pointer-events: none;
    font: 700 1.6rem/1 var(--mono); letter-spacing: .08em; color: #3ee0a8; border: 3px solid #3ee0a8; border-radius: 8px; padding: .15rem .5rem;
    background: color-mix(in srgb, var(--ink) 80%, transparent); opacity: 0;
  }
  .stamp.on { opacity: 1; }
  .stamp.slam { animation: slam .5s cubic-bezier(.2,1.6,.4,1) both; }
  @keyframes slam { from { opacity: 0; scale: 2.6; rotate: -30deg; } 60% { opacity: 1; scale: .92; } to { opacity: 1; scale: 1; rotate: -12deg; } }
  .speech {
    position: relative; justify-self: stretch; margin-top: .5rem; padding: .6rem .85rem; border-radius: 16px; background: #fff; border: 1.5px solid var(--ink);
    font: 400 1.2rem/1.2 var(--serif); text-align: center; min-block-size: 2.9rem; display: grid; place-items: center;
  }
  .speech::after { content: ""; position: absolute; inset-block-end: -9px; inset-inline-start: 50%; inline-size: 14px; block-size: 14px; background: #fff; border-inline-end: 1.5px solid var(--ink); border-block-end: 1.5px solid var(--ink); transform: translateX(-50%) rotate(45deg); }
  .speech.pop { animation: pop .3s cubic-bezier(.2,1.4,.4,1); }
  @keyframes pop { from { scale: .92; } }
  bot-critter { inline-size: min(100%, 17rem); block-size: clamp(9.5rem, 16vw, 13rem); position: relative; z-index: 1; }
  .nametag { display: flex; align-items: center; gap: .6rem; flex-wrap: wrap; justify-content: center; }
  .nametag b { font: 400 1.9rem/1 var(--serif); letter-spacing: -0.02em; }
  .nametag small { font: 12px var(--mono); color: var(--ink-2); }
  .nametag[data-asleep] b { color: var(--ink-2); font-style: italic; }
  .ghost { background: none; border: 1px solid var(--rule); border-radius: 999px; padding: .25rem .65rem; font-size: 12.5px; color: var(--ink-2); }
  .ghost:hover { border-color: var(--ink); color: var(--ink); }

  /* talk */
  .talk header { display: flex; align-items: baseline; justify-content: space-between; gap: .5rem; }
  .talk header b { font-size: 15px; }
  .talk .status { font: 12px var(--mono); color: var(--ink-2); display: inline-flex; align-items: center; gap: .35rem; }
  .talk .status::before { content: ""; inline-size: .5rem; block-size: .5rem; border-radius: 50%; background: var(--rule); }
  .talk[data-chat="ready"] .status::before { background: var(--mint); }
  .talk[data-chat="thinking"] .status::before { background: var(--signal); animation: blink 1s infinite; }
  .chat { list-style: none; margin: 0; padding: 0; display: grid; gap: .45rem; align-content: start; max-block-size: 15rem; overflow-y: auto; }
  .chat:empty { display: none; }
  .chat li { max-inline-size: 88%; padding: .5rem .75rem; border-radius: 14px; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 14px; animation: land .2s ease-out; }
  .chat li[data-who="you"] { justify-self: end; background: var(--ink); color: var(--paper); border-end-end-radius: 4px; }
  .chat li[data-who="mosfet"] { justify-self: start; background: var(--paper); border: 1px solid var(--rule); border-end-start-radius: 4px; }
  .chat li[data-who="note"] { justify-self: center; background: none; color: var(--bad); font-size: 12.5px; text-align: center; }
  .chat li.typing { color: var(--ink-2); letter-spacing: .2em; }
  .prompts { display: flex; gap: .4rem; flex-wrap: wrap; }
  .prompts button { background: var(--paper); border: 1px solid var(--rule); border-radius: 999px; padding: .3rem .7rem; font-size: 13px; }
  .prompts button:hover:not(:disabled) { border-color: var(--ink); }
  .prompts button:disabled { opacity: .5; }
  .say { display: flex; gap: .45rem; }
  .say input { flex: 1; }
  .say button { background: var(--ink); color: var(--paper); border: 0; border-radius: 999px; padding: .55rem 1rem; font-weight: 600; }
  .say button:disabled, .say input:disabled { opacity: .45; }
  .talk-hint { margin: 0; font-size: 13px; color: var(--ink-2); }

  /* pegboard */
  .peg {
    background-color: #d9ccb2; border: 1.5px solid var(--ink); border-radius: 18px; padding: 14px; display: grid; gap: .8rem; align-content: start; min-block-size: 20rem;
    background-image: radial-gradient(circle at center, rgba(20,20,20,.28) 2.2px, transparent 2.6px); background-size: 22px 22px; background-position: 11px 11px;
  }
  .peg .card-label { color: var(--ink); background: var(--card); padding: .35rem .6rem; border-radius: 8px; border: 1px solid var(--ink); justify-self: stretch; }
  .stickers { list-style: none; margin: 0; padding: 0; display: grid; gap: 14px; }
  .sticker {
    position: relative; background: #fffdf6; border: 1px solid rgba(20,20,20,.25); border-radius: 6px; padding: 1.1rem .8rem .7rem; display: grid; gap: .35rem;
    box-shadow: 0 10px 18px -10px rgba(20,20,20,.5); rotate: var(--tilt, -1.5deg); transition: rotate .3s, opacity .3s, filter .3s;
  }
  .sticker::before { content: ""; position: absolute; inset-block-start: -7px; inset-inline-start: 50%; translate: -50% 0; inline-size: 16px; block-size: 16px; border-radius: 50%; background: var(--signal); border: 2px solid var(--ink); box-shadow: 0 3px 4px rgba(0,0,0,.3); }
  .sticker:hover { rotate: 0deg; }
  .sticker small { font: 600 10.5px var(--mono); text-transform: uppercase; letter-spacing: .08em; color: var(--ink-2); }
  .sticker p { margin: 0; font: 400 1.3rem/1.1 var(--serif); letter-spacing: -0.01em; }
  .sticker .from { font: 11.5px/1.35 var(--mono); color: var(--ink-2); text-transform: none; letter-spacing: 0; font-weight: 400; }
  .sticker .row { display: flex; justify-content: space-between; align-items: center; gap: .5rem; margin-top: .2rem; }
  .sticker .row span { font: 600 11.5px var(--mono); color: #0b6b4e; }
  .switch { display: inline-flex; align-items: center; gap: .4rem; background: none; border: 0; padding: .1rem; font: 600 12px var(--mono); color: var(--ink-2); }
  .switch i { inline-size: 2.2rem; block-size: 1.25rem; border-radius: 999px; background: var(--rule); position: relative; transition: background .2s; }
  .switch i::after { content: ""; position: absolute; inset-block: 3px; inset-inline-start: 3px; inline-size: calc(1.25rem - 6px); border-radius: 50%; background: #fff; transition: transform .2s; }
  .switch[aria-checked="true"] i { background: var(--mint); }
  .switch[aria-checked="true"] i::after { transform: translateX(.95rem); }
  .sticker.off { opacity: .6; filter: grayscale(1); border-style: dashed; box-shadow: none; }
  .sticker.off::before { background: var(--rule); }
  .sticker.off p { text-decoration: line-through; text-decoration-thickness: 1px; }
  .sticker.new { animation: stick .6s cubic-bezier(.2,1.5,.4,1); }
  @keyframes stick { from { opacity: 0; transform: translateY(-40px) scale(1.15); rotate: 12deg; } }
  .empty-peg { border: 2px dashed rgba(20,20,20,.45); border-radius: 10px; padding: 1rem; background: color-mix(in srgb, var(--card) 80%, transparent); font-size: 13.5px; color: var(--ink-2); text-align: center; }
  .empty-peg b { display: block; font: 400 1.3rem/1.1 var(--serif); color: var(--ink); margin-bottom: .25rem; }

  @media (max-width: 1100px) {
    .floor { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); grid-template-areas: "stage ticket" "talk ticket" "peg peg"; }
    .peg { min-block-size: 0; }
    .stickers { grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr)); }
  }
  @media (max-width: 720px) {
    .floor { grid-template-columns: minmax(0, 1fr); grid-template-areas: "stage" "ticket" "peg" "talk"; }
    .rail { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 4px; }
    .rail li { grid-template-columns: 1fr; justify-items: center; text-align: center; padding: .45rem .2rem; row-gap: .2rem; }
    .rail li::before { grid-row: auto; }
    .rail b { font-size: 12px; line-height: 1.15; }
    .rail small { display: none; }
    .bench { border-radius: 20px; }
    bot-critter { block-size: 9rem; }
  }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation: none !important; transition: none !important; }
    .stamp.slam { opacity: 1; }
  }
</style>
<div class="bench">
  <ol class="rail" aria-label="The loop">
    <li data-step="build"><b>Build it</b><small>parts + a name</small></li>
    <li data-step="job"><b>Give it a job</b><small>live · on the meter</small></li>
    <li data-step="correct"><b>Correct it once</b><small>plain words</small></li>
    <li data-step="free"><b>Run it free</b><small>rule pinned · $0.00</small></li>
  </ol>
  <p class="next" aria-live="polite"></p>
  <p class="offline" role="status" hidden>The workshop bridge isn't running, so the bot can't wake up. Start it with <code>uv run --project workshop workshop/server.py</code> — this page checks again every few seconds.</p>
  <div class="floor">
    <section class="ticket card" aria-labelledby="ticket-title">
      <div data-panel="build">
        <div style="display:grid;gap:.8rem">
          <p class="card-label"><span>step 1 · the parts bin</span></p>
          <h3 id="ticket-title">Build <em>your bot</em></h3>
          <div class="parts" role="group" aria-label="Parts"></div>
          <p class="always"></p>
          <form class="name-row">
            <label>name<input type="text" name="name" autocomplete="off" maxlength="40" /></label>
            <button type="submit" class="primary boot">Boot it</button>
          </form>
          <p class="problem build-problem" role="alert" hidden></p>
        </div>
      </div>
      <div data-panel="work" hidden>
        <div style="display:grid;gap:.8rem">
          <p class="card-label"><span>the job</span><span class="job-count"></span></p>
          <div class="jobs" role="group" aria-label="Pick a job"></div>
          <div class="go">
            <button type="button" class="primary run">Run it</button>
            <span class="hint"></span>
          </div>
          <ol class="log" aria-live="polite" aria-label="What it did"></ol>
          <div class="thinking" hidden><i></i><i></i><i></i><span></span></div>
          <form class="teach" hidden>
            <p>Not how you'd do it? <em>Tell it once.</em></p>
            <button type="button" class="suggest"></button>
            <div class="row">
              <input type="text" name="fix" autocomplete="off" placeholder="or say it your way…" aria-label="Your correction" />
              <button type="submit" class="primary">Teach it</button>
            </div>
          </form>
          <div class="callout" hidden><span class="dot" aria-hidden="true"></span><div><small>pinned to the board</small><span class="callout-text"></span></div></div>
        </div>
      </div>
    </section>

    <section class="stage" aria-label="Your bot">
      <div class="meter" data-mode="idle">
        <div><small class="meter-label">this run</small><output aria-live="off">$0.00</output></div>
        <div class="tally"><span>spent <b class="spent">$0.00</b></span><span class="saved">saved <b>$0.00</b></span></div>
        <span class="stamp" aria-hidden="true">FREE</span>
      </div>
      <div class="speech" aria-live="polite"></div>
      <bot-critter expression="sleepy" track></bot-critter>
      <div class="nametag" data-asleep>
        <b class="botname">unbuilt</b><small class="made"></small>
        <button type="button" class="ghost rebuild" hidden>rebuild</button>
      </div>
    </section>

    <section class="talk card" aria-label="Talk to your bot" data-chat="off">
      <header><b>Talk to <span class="talkname">it</span></b><span class="status">asleep</span></header>
      <ol class="chat" aria-live="polite"></ol>
      <p class="talk-hint"></p>
      <div class="prompts" role="group" aria-label="Things to say"></div>
      <form class="say">
        <input type="text" name="text" autocomplete="off" aria-label="Message" placeholder="Boot it first, then say hi" disabled />
        <button type="submit" disabled>Send</button>
      </form>
    </section>

    <section class="peg" aria-label="Pinned rules">
      <p class="card-label"><span>the board · pinned rules</span><span class="rule-count">0</span></p>
      <ul class="stickers"></ul>
    </section>
  </div>
</div>
`;

type StickerKey = string;

/**
 * The workshop bench, as a custom element that is an HSM host.
 *
 * It starts a `Builder` (assemble and boot a real bot), a `Bench` (run a job, correct it once, rerun free), and — once
 * a bot is booted — a `Chat` with that bot, all under its own context. Its own topology is the rail: `build` until a
 * bot is booted, then `working` with one sub-state per step (`job`, `correct`, `free`, `done`) that follows the bench's
 * reported phase. Clicks become typed events on the machines; the element only draws what they hold.
 *
 *     <mosfet-bench></mosfet-bench>
 */
export class MosfetBenchElement extends hsm.from(HTMLElement) {
  static readonly model = hsm.define(
    "MosfetBench",
    hsm.initial(hsm.target("build")),
    hsm.state(
      "build",
      hsm.entry(MosfetBenchElement.enterStep),
      hsm.transition(hsm.on(Builder.changedEvent.name), hsm.guard(MosfetBenchElement.botBooted), hsm.target("../working")),
    ),
    hsm.state(
      "working",
      hsm.entry(MosfetBenchElement.wakeBot),
      hsm.exit(MosfetBenchElement.dropBot),
      hsm.initial(hsm.target("placing")),
      hsm.choice(
        "placing",
        hsm.transition(hsm.guard(MosfetBenchElement.benchAt("job")), hsm.target("job")),
        hsm.transition(hsm.guard(MosfetBenchElement.benchAt("correct")), hsm.target("correct")),
        hsm.transition(hsm.guard(MosfetBenchElement.benchAt("free")), hsm.target("free")),
        hsm.transition(hsm.guard(MosfetBenchElement.benchAt("done")), hsm.target("done")),
        hsm.transition(hsm.target("job")),
      ),
      hsm.state(
        "job",
        hsm.entry(MosfetBenchElement.enterStep),
        hsm.transition(hsm.on(Bench.changedEvent.name), hsm.guard(MosfetBenchElement.movesTo("correct")), hsm.target("../correct"), hsm.effect(MosfetBenchElement.benchChanged)),
        hsm.transition(hsm.on(Bench.changedEvent.name), hsm.guard(MosfetBenchElement.movesTo("free")), hsm.target("../free"), hsm.effect(MosfetBenchElement.benchChanged)),
        hsm.transition(hsm.on(Bench.changedEvent.name), hsm.guard(MosfetBenchElement.movesTo("done")), hsm.target("../done"), hsm.effect(MosfetBenchElement.benchChanged)),
      ),
      hsm.state(
        "correct",
        hsm.entry(MosfetBenchElement.enterStep),
        hsm.transition(hsm.on(Bench.changedEvent.name), hsm.guard(MosfetBenchElement.movesTo("job")), hsm.target("../job"), hsm.effect(MosfetBenchElement.benchChanged)),
        hsm.transition(hsm.on(Bench.changedEvent.name), hsm.guard(MosfetBenchElement.movesTo("free")), hsm.target("../free"), hsm.effect(MosfetBenchElement.benchChanged)),
        hsm.transition(hsm.on(Bench.changedEvent.name), hsm.guard(MosfetBenchElement.movesTo("done")), hsm.target("../done"), hsm.effect(MosfetBenchElement.benchChanged)),
      ),
      hsm.state(
        "free",
        hsm.entry(MosfetBenchElement.enterStep),
        hsm.transition(hsm.on(Bench.changedEvent.name), hsm.guard(MosfetBenchElement.movesTo("job")), hsm.target("../job"), hsm.effect(MosfetBenchElement.benchChanged)),
        hsm.transition(hsm.on(Bench.changedEvent.name), hsm.guard(MosfetBenchElement.movesTo("correct")), hsm.target("../correct"), hsm.effect(MosfetBenchElement.benchChanged)),
        hsm.transition(hsm.on(Bench.changedEvent.name), hsm.guard(MosfetBenchElement.movesTo("done")), hsm.target("../done"), hsm.effect(MosfetBenchElement.benchChanged)),
      ),
      hsm.state(
        "done",
        hsm.entry(MosfetBenchElement.enterStep),
        hsm.transition(hsm.on(Bench.changedEvent.name), hsm.guard(MosfetBenchElement.movesTo("job")), hsm.target("../job"), hsm.effect(MosfetBenchElement.benchChanged)),
        hsm.transition(hsm.on(Bench.changedEvent.name), hsm.guard(MosfetBenchElement.movesTo("correct")), hsm.target("../correct"), hsm.effect(MosfetBenchElement.benchChanged)),
        hsm.transition(hsm.on(Bench.changedEvent.name), hsm.guard(MosfetBenchElement.movesTo("free")), hsm.target("../free"), hsm.effect(MosfetBenchElement.benchChanged)),
      ),
      hsm.transition(hsm.on(Builder.changedEvent.name), hsm.guard(MosfetBenchElement.botGone), hsm.target("../build")),
    ),
    hsm.transition(hsm.on(Builder.changedEvent.name), hsm.effect(MosfetBenchElement.builderChanged)),
    hsm.transition(hsm.on(Bench.changedEvent.name), hsm.effect(MosfetBenchElement.benchChanged)),
    hsm.transition(hsm.on(Chat.changedEvent.name), hsm.effect(MosfetBenchElement.chatChanged)),
  );

  #root: ShadowRoot;
  #builder: Builder | null = null;
  #bench: Bench | null = null;
  #chat: Chat | null = null;
  /** Which machine spoke last, so the face follows the conversation you are having. */
  #voice: "builder" | "bench" | "chat" = "builder";
  #frame = 0;
  #shown = { log: "", chat: -1, stickers: "", parts: "", say: "" };
  #lastRunCost = 0;
  #pinnedSeen = new Set<string>();
  #boardLoaded = false;
  #stamped = false;

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
    hsm.ensureStarted({ instance: this, model: MosfetBenchElement.model });
    window.addEventListener("pagehide", this.#teardown);
    this.#builder = startBuilder({ ctx: this.context() });
    this.#bench = startBench({ ctx: this.context() });
    this.#schedule();
  }

  disconnectedCallback(): void {
    if (this.#frame !== 0) cancelAnimationFrame(this.#frame);
    this.#frame = 0;
    window.removeEventListener("pagehide", this.#teardown);
    this.#teardown();
  }

  /** Stopping the builder stops the booted bot on the bridge. */
  readonly #teardown = (): void => {
    for (const machine of [this.#chat, this.#bench, this.#builder]) {
      if (machine !== null) void hsm.stop(machine).catch(hsm.catchFailure(this));
    }
    this.#chat = null;
    this.#bench = null;
    this.#builder = null;
  };

  /** Machine state paths, for tests and the inspector. */
  benchState(): string {
    return this.#bench?.state() ?? "/Bench/unstarted";
  }

  builderState(): string {
    return this.#builder?.state() ?? "/Builder/unstarted";
  }

  chatState(): string {
    return this.#chat?.state() ?? "/Chat/unstarted";
  }

  // -- topology hooks --------------------------------------------------------

  static botBooted(_ctx: hsm.Context, _instance: hsm.Instance, event: hsm.Event): boolean {
    return hsm.isRecord(event.data) && event.data["booted"] === true;
  }

  static botGone(ctx: hsm.Context, instance: hsm.Instance, event: hsm.Event): boolean {
    return !MosfetBenchElement.botBooted(ctx, instance, event);
  }

  /** Initial placement after boot: the bench is settled, so its state path is safe to read. */
  static benchAt(step: Step): (ctx: hsm.Context, instance: hsm.Instance) => boolean {
    return (_ctx, instance) => instance instanceof MosfetBenchElement && stepOfBenchState(instance.benchState()) === step;
  }

  static movesTo(step: Step): (ctx: hsm.Context, instance: hsm.Instance, event: hsm.Event) => boolean {
    return (_ctx, _instance, event) => hsm.isRecord(event.data) && stepOfPhase(event.data["phase"]) === step;
  }

  static enterStep(_ctx: hsm.Context, instance: hsm.Instance): void {
    if (instance instanceof MosfetBenchElement) instance.#schedule(true);
  }

  static wakeBot(_ctx: hsm.Context, instance: hsm.Instance): void {
    if (!(instance instanceof MosfetBenchElement)) return;
    const bot = instance.#builder?.bot ?? null;
    if (bot !== null) instance.#chat = startChat({ ctx: instance.context(), transport: botTransport(bot) });
    instance.#voice = "bench";
    instance.#critter().spin();
    instance.#schedule(true);
  }

  static dropBot(_ctx: hsm.Context, instance: hsm.Instance): void {
    if (!(instance instanceof MosfetBenchElement)) return;
    const chat = instance.#chat;
    instance.#chat = null;
    if (chat !== null) void hsm.stop(chat).catch(hsm.catchFailure(instance));
    instance.#shown.chat = -1;
    instance.#voice = "builder";
    instance.#schedule();
  }

  static builderChanged(_ctx: hsm.Context, instance: hsm.Instance): void {
    if (!(instance instanceof MosfetBenchElement)) return;
    instance.#voice = "builder";
    instance.#schedule();
  }

  /** Every bench change redraws; the two milestones also get a moment of their own. */
  static benchChanged(_ctx: hsm.Context, instance: hsm.Instance, event: hsm.Event): void {
    if (!(instance instanceof MosfetBenchElement)) return;
    const moment = hsm.isRecord(event.data) ? event.data["moment"] : undefined;
    if (instance.#builder?.bot !== null) instance.#voice = "bench";
    if (moment === "learned") instance.#critter().spin();
    if (moment === "free") instance.#stamped = true;
    instance.#schedule();
  }

  static chatChanged(_ctx: hsm.Context, instance: hsm.Instance): void {
    if (!(instance instanceof MosfetBenchElement)) return;
    instance.#voice = "chat";
    instance.#schedule();
  }

  // -- input -----------------------------------------------------------------

  #wire(): void {
    const nameForm = this.#q<HTMLFormElement>(".name-row");
    const nameInput = this.#q<HTMLInputElement>('.name-row input[name="name"]');
    nameInput.addEventListener("input", () => this.#tell(this.#builder, Builder.nameEvent, { name: nameInput.value }));
    nameForm.addEventListener("submit", (event) => {
      event.preventDefault();
      this.#tell(this.#builder, Builder.bootEvent);
    });
    this.#q(".rebuild").addEventListener("click", () => this.#tell(this.#builder, Builder.rebuildEvent));

    const jobs = this.#q(".jobs");
    for (const task of BENCH_TASKS) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "job";
      button.dataset["task"] = task.id;
      const label = document.createElement("b");
      label.textContent = task.label;
      const ask = document.createElement("small");
      ask.textContent = `“${task.ask}”`;
      const tag = document.createElement("span");
      tag.className = "tag";
      button.append(label, tag, ask);
      button.addEventListener("click", () => this.#tell(this.#bench, Bench.pickEvent, { task: task.id }));
      jobs.append(button);
    }
    this.#q(".run").addEventListener("click", () => this.#tell(this.#bench, Bench.runEvent));

    const teach = this.#q<HTMLFormElement>(".teach");
    const fix = this.#q<HTMLInputElement>('.teach input[name="fix"]');
    teach.addEventListener("submit", (event) => {
      event.preventDefault();
      const text = fix.value;
      if (text.trim() === "") return fix.focus();
      fix.value = "";
      this.#tell(this.#bench, Bench.teachEvent, { text });
    });
    this.#q(".suggest").addEventListener("click", () => {
      const text = this.#bench?.task.correction;
      if (text !== undefined) this.#tell(this.#bench, Bench.teachEvent, { text });
    });
    // Being corrected is a little embarrassing.
    fix.addEventListener("focus", () => this.#critter().express("worried"));
    fix.addEventListener("blur", () => this.#schedule());

    const say = this.#q<HTMLFormElement>(".say");
    const input = this.#q<HTMLInputElement>('.say input[name="text"]');
    say.addEventListener("submit", (event) => {
      event.preventDefault();
      if (input.disabled || input.value.trim() === "") return;
      const text = input.value;
      input.value = "";
      this.#tell(this.#chat, Chat.sendEvent, { text });
    });
    const prompts = this.#q(".prompts");
    for (const prompt of PROMPTS) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = prompt;
      button.addEventListener("click", () => this.#tell(this.#chat, Chat.sendEvent, { text: prompt }));
      prompts.append(button);
    }

    this.#q(".stickers").addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLButtonElement>(".switch") : null;
      const task = target?.dataset["task"];
      if (target === null || task === undefined) return;
      const pinned = target.getAttribute("aria-checked") === "true";
      this.#tell(this.#bench, pinned ? Bench.forgetEvent : Bench.repinEvent, { task });
    });
  }

  #tell(
    machine: Builder | Bench | Chat | null,
    event: { readonly name: string; readonly kind: hsm.Event["kind"] },
    data?: unknown,
  ): void {
    if (machine === null) return;
    void Promise.resolve(
      data === undefined ? hsm.dispatch(machine, hsm.typedEvent({ event })) : hsm.dispatch(machine, hsm.typedEvent({ event, data })),
    )
      .then(() => this.#schedule())
      .catch(hsm.catchFailure(this));
  }

  // -- drawing ---------------------------------------------------------------

  #focusNext = false;

  #schedule(stepChanged = false): void {
    if (stepChanged && this.#root.activeElement !== null) this.#focusNext = true;
    if (this.#frame !== 0 || !this.isConnected) return;
    this.#frame = requestAnimationFrame(() => {
      this.#frame = 0;
      this.#render();
    });
  }

  #critter(): BotCritterElement {
    return this.#q<BotCritterElement>("bot-critter");
  }

  #step(): Step {
    const path = this.state();
    const leaf = path.split("/").pop() ?? "build";
    return (["build", ...WORK_STEPS] as string[]).includes(leaf) ? (leaf as Step) : "build";
  }

  #render(): void {
    const builder = this.#builder;
    const bench = this.#bench;
    if (builder === null || bench === null) return;
    const step = this.#step();
    const builderState = builder.state();
    const benchState = bench.state();
    const offline = builderState.endsWith("/offline") || benchState.endsWith("/offline");
    const booted = builderState.endsWith("/booted");

    this.#q(".bench").setAttribute("data-step", step);
    const order: Step[] = ["build", "job", "correct", "free", "done"];
    for (const li of this.#root.querySelectorAll<HTMLLIElement>(".rail li")) {
      const at = order.indexOf(li.dataset["step"] as Step);
      const now = order.indexOf(step);
      li.dataset["at"] = at < now ? "done" : at === now ? "now" : "later";
      if (at === now) li.setAttribute("aria-current", "step");
      else li.removeAttribute("aria-current");
    }
    this.#q(".next").textContent = offline ? "Start the workshop bridge, then come back — this page will notice." : NEXT[step];
    this.#q(".offline").hidden = !offline;

    this.#renderBuild(builder, booted);
    this.#renderWork(bench, booted);
    this.#renderStage(builder, bench, booted, offline);
    this.#renderTalk(builder, booted);
    this.#renderBoard(bench);

    if (this.#focusNext) {
      this.#focusNext = false;
      const target =
        step === "build" ? this.#q<HTMLElement>(".boot")
        : step === "correct" && benchState.endsWith("/reviewing") ? this.#q<HTMLElement>(".suggest")
        : this.#q<HTMLElement>(".run");
      if (!(target as HTMLButtonElement).disabled) target.focus();
    }
  }

  #renderBuild(builder: Builder, booted: boolean): void {
    this.#q('[data-panel="build"]').hidden = booted;
    this.#q('[data-panel="work"]').hidden = !booted;
    if (booted) return;
    const state = builder.state();
    const catalog = builder.catalog;
    const booting = state.endsWith("/booting");
    const parts = this.#q(".parts");
    const signature = catalog === null ? `none:${state.endsWith("/offline")}` : `${[...builder.devices].join()}|${[...builder.abilities].join()}|${booting}`;
    if (signature !== this.#shown.parts) {
      this.#shown.parts = signature;
      if (catalog === null) {
        const wait = document.createElement("p");
        wait.className = "always parts-wait";
        wait.textContent = state.endsWith("/offline") ? "The parts bin is locked until the bridge is up." : "Opening the parts bin…";
        parts.replaceChildren(wait);
      } else {
        const make = (part: Part, picked: boolean, kind: string): HTMLButtonElement => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "part";
          button.setAttribute("aria-pressed", String(picked));
          button.disabled = !part.available || booting;
          const title = document.createElement("b");
          title.textContent = part.label;
          const small = document.createElement("small");
          small.textContent = part.available ? `${kind} · ${PART_BLURBS[part.id] ?? part.describes}` : "not fitted in this workshop yet";
          if (!part.available && part.note !== null) button.title = part.note;
          button.append(title, small);
          button.addEventListener("click", () => this.#tell(this.#builder, Builder.toggleEvent, { part: part.id }));
          return button;
        };
        parts.replaceChildren(
          ...catalog.devices.map((p) => make(p, builder.devices.has(p.id), "device")),
          ...catalog.abilities.map((p) => make(p, builder.abilities.has(p.id), p.needs.length > 0 ? `ability · needs ${p.needs.join(", ")}` : "ability")),
        );
      }
    }
    const always = this.#q("p.always:not(.parts-wait)");
    const b = document.createElement("b");
    b.textContent = "always fitted: a mind";
    always.replaceChildren(b, document.createTextNode(` — ${catalog?.cognition || "it thinks, plans, and reflects"}`));
    always.hidden = catalog === null;

    const nameInput = this.#q<HTMLInputElement>('.name-row input[name="name"]');
    if (this.#root.activeElement !== nameInput && nameInput.value !== builder.name) nameInput.value = builder.name;
    nameInput.disabled = catalog === null || booting;
    const boot = this.#q<HTMLButtonElement>(".boot");
    boot.disabled = catalog === null || booting;
    boot.textContent = booting ? "Booting…" : `Boot ${builder.name || "it"} ↗`;
    const problem = this.#q(".build-problem");
    problem.hidden = builder.problem === null || state.endsWith("/offline");
    problem.textContent = builder.problem ?? "";
  }

  #renderWork(bench: Bench, booted: boolean): void {
    if (!booted) return;
    const state = bench.state();
    const learned = state.includes("/learned");
    const busy = state.endsWith("/running") || state.endsWith("/revealing") || state.endsWith("/teaching") || state.endsWith("/replaying") || state.endsWith("/loading");
    const online = state.startsWith("/Bench/online");

    this.#q(".job-count").textContent = `${bench.rules.size} of ${BENCH_TASKS.length} learned`;
    for (const button of this.#root.querySelectorAll<HTMLButtonElement>(".job")) {
      const id = button.dataset["task"] ?? "";
      button.setAttribute("aria-pressed", String(id === bench.task.id));
      button.disabled = busy || !online;
      const tag = button.querySelector<HTMLElement>(".tag")!;
      const pinned = bench.rules.has(id);
      tag.textContent = pinned ? "free" : "live";
      tag.className = pinned ? "tag pinned" : "tag";
    }

    const run = this.#q<HTMLButtonElement>(".run");
    run.disabled = busy || !online;
    run.classList.toggle("free", learned);
    run.textContent =
      state.endsWith("/running") || state.endsWith("/revealing") ? "Running…"
      : state.endsWith("/replaying") ? "Running free…"
      : state.endsWith("/teaching") ? "Learning…"
      : learned ? (state.endsWith("/replayed") ? "Run it again · free" : "Run it · free")
      : state.endsWith("/reviewing") ? "Run it again · live"
      : "Run it · live";
    this.#q(".go .hint").textContent = learned ? "rule pinned — no model call" : `≈ ${money(bench.livePrice)} a run, billed per step`;

    const logSignature = `${bench.task.id}:${bench.log.length}`;
    const log = this.#q("ol.log");
    if (logSignature !== this.#shown.log) {
      this.#shown.log = logSignature;
      log.replaceChildren(...bench.log.map(logItem));
      log.scrollTop = log.scrollHeight;
    }

    const waiting = state.endsWith("/running") || state.endsWith("/teaching");
    const thinking = this.#q(".thinking");
    thinking.hidden = !waiting;
    thinking.classList.toggle("free", false);
    thinking.querySelector("span")!.textContent = state.endsWith("/teaching") ? "distilling your correction into a rule…" : "calling the model — this is the paid part";

    const reviewing = state.endsWith("/reviewing") || state.endsWith("/teaching");
    const teach = this.#q<HTMLFormElement>(".teach");
    teach.hidden = !reviewing;
    const suggest = this.#q<HTMLButtonElement>(".suggest");
    suggest.textContent = `“${bench.task.correction}”`;
    suggest.disabled = state.endsWith("/teaching");
    for (const control of teach.querySelectorAll<HTMLInputElement | HTMLButtonElement>("input, button[type=submit]")) control.disabled = state.endsWith("/teaching");

    const rule = bench.rules.get(bench.task.id);
    const callout = this.#q(".callout");
    callout.hidden = !learned || rule === undefined;
    this.#q(".callout-text").textContent = rule?.skill ?? "";
  }

  #renderStage(builder: Builder, bench: Bench, booted: boolean, offline: boolean): void {
    const critter = this.#critter();
    const builderState = builder.state();
    const benchState = bench.state();
    const fixing = this.#root.activeElement === this.#q('.teach input[name="fix"]');

    let expression: ExpressionName;
    let say: string;
    if (offline) {
      expression = "sleepy";
      say = "zzz… the workshop is closed.";
    } else if (!booted) {
      expression = builderState.endsWith("/booting") ? "surprised" : "sleepy";
      say = builderState.endsWith("/booting") ? "Oh! Parts! Booting…" : builder.problem !== null && builderState.endsWith("/picking") ? "Hm, that didn't work. Try again?" : "I'm in pieces. Put me together?";
    } else if (this.#voice === "chat" && this.#chat !== null) {
      expression = this.#chat.expression;
      say = this.#chat.state().endsWith("/thinking") ? "Hmm, let me think…" : bench.say;
    } else {
      expression = bench.expression;
      say = bench.say;
    }
    if (!fixing && critter.expression !== expression) critter.express(expression);
    const speech = this.#q(".speech");
    if (say !== this.#shown.say) {
      this.#shown.say = say;
      speech.textContent = say;
      speech.classList.remove("pop");
      void speech.offsetWidth;
      speech.classList.add("pop");
    }

    const nametag = this.#q(".nametag");
    nametag.toggleAttribute("data-asleep", !booted);
    const name = booted ? builder.label.split(" [")[0] || builder.name : builder.name ? `${builder.name}, unbooted` : "unbuilt";
    this.#q(".botname").textContent = name;
    this.#q(".made").textContent = booted ? `${[...builder.devices].join(" · ") || "no devices"} · mind` : "";
    this.#q(".rebuild").hidden = !booted;

    // The meter: paid runs tick up with a coin per step; free runs get stamped.
    const meter = this.#q(".meter");
    const learned = benchState.includes("/learned");
    const calling = benchState.endsWith("/running") && !learned;
    meter.dataset["mode"] = calling ? "calling" : learned ? "free" : bench.runCost > 0 ? "paid" : "idle";
    this.#q(".meter-label").textContent = calling ? "calling the model…" : learned ? "this run · no model call" : "this run";
    this.#q<HTMLOutputElement>(".meter output").textContent = money(bench.runCost);
    this.#q(".spent").textContent = money(bench.spent);
    this.#q(".saved b").textContent = money(bench.saved);
    if (bench.runCost > this.#lastRunCost) this.#coin(bench.runCost - this.#lastRunCost);
    this.#lastRunCost = bench.runCost;

    const stamp = this.#q(".stamp");
    const stamped = benchState.endsWith("/replayed");
    stamp.classList.toggle("on", stamped);
    if (this.#stamped) {
      this.#stamped = false;
      stamp.classList.remove("slam");
      void stamp.offsetWidth;
      stamp.classList.add("slam");
    } else if (!stamped) {
      stamp.classList.remove("slam");
    }
  }

  #coin(dollars: number): void {
    const coin = document.createElement("span");
    coin.className = "coin";
    coin.setAttribute("aria-hidden", "true");
    coin.textContent = `+${Math.round(dollars * 100)}¢`;
    coin.addEventListener("animationend", () => coin.remove());
    this.#q(".meter").append(coin);
    globalThis.setTimeout(() => coin.remove(), 1500);
  }

  #renderTalk(builder: Builder, booted: boolean): void {
    const talk = this.#q(".talk");
    const chat = this.#chat;
    const chatLeaf = chat?.state().split("/").pop() ?? "off";
    talk.dataset["chat"] = booted ? chatLeaf : "off";
    const name = booted ? builder.label.split(" [")[0] || builder.name : "it";
    this.#q(".talkname").textContent = name;
    this.#q(".talk .status").textContent =
      !booted ? "asleep"
      : chatLeaf === "ready" ? "listening"
      : chatLeaf === "thinking" ? "thinking…"
      : chatLeaf === "unconfigured" ? "needs an API key"
      : chatLeaf === "offline" ? "can't reach it"
      : "waking up…";

    const ready = booted && chatLeaf === "ready";
    const input = this.#q<HTMLInputElement>('.say input[name="text"]');
    input.disabled = !ready;
    input.placeholder = booted ? `Say something to ${name}…` : "Boot it first, then say hi";
    this.#q<HTMLButtonElement>(".say button").disabled = !ready;
    const lines = chat?.lines ?? [];
    for (const button of this.#root.querySelectorAll<HTMLButtonElement>(".prompts button")) button.disabled = !ready;
    this.#q(".prompts").hidden = booted && lines.length > 2;
    this.#q(".talk-hint").textContent = !booted
      ? "Once it's booted you can talk to it here — it's a real bot on the bridge, not a script."
      : lines.length === 0
        ? `Ask ${name} anything, or try one of these:`
        : "";
    this.#q(".talk-hint").hidden = booted && lines.length > 0;

    const thinking = chatLeaf === "thinking";
    const key = lines.length * 2 + (thinking ? 1 : 0);
    if (key !== this.#shown.chat) {
      this.#shown.chat = key;
      const list = this.#q("ol.chat");
      list.replaceChildren(...lines.map(chatItem), ...(thinking ? [typingItem()] : []));
      list.scrollTop = list.scrollHeight;
    }
  }

  #renderBoard(bench: Bench): void {
    const entries: [StickerKey, BenchRule, boolean][] = [];
    for (const task of BENCH_TASKS) {
      const rule = bench.rules.get(task.id);
      const ghost = bench.ghosts.get(task.id);
      if (rule !== undefined) entries.push([task.id, rule, true]);
      else if (ghost !== undefined) entries.push([task.id, ghost, false]);
    }
    this.#q(".rule-count").textContent = `${bench.rules.size} pinned`;
    const busy = /\/(running|revealing|teaching|replaying)$/.test(bench.state());
    const signature = `${entries.map(([id, rule, on]) => `${id}:${on}:${rule.skill}`).join("|")}|${busy}`;
    if (signature === this.#shown.stickers) return;
    this.#shown.stickers = signature;

    const list = this.#q(".stickers");
    if (entries.length === 0) {
      const empty = document.createElement("li");
      empty.className = "empty-peg";
      const b = document.createElement("b");
      b.textContent = "Nothing pinned yet.";
      empty.append(b, document.createTextNode("Correct your bot once and the rule it learns gets pinned right here. Pinned rules run free."));
      list.replaceChildren(empty);
      return;
    }
    const tilts = ["-2.2deg", "1.6deg", "-.8deg"];
    list.replaceChildren(
      ...entries.map(([id, rule, on], index) => {
        const task = BENCH_TASKS.find((t) => t.id === id)!;
        const item = document.createElement("li");
        item.className = on ? "sticker" : "sticker off";
        if (on && this.#boardLoaded && !this.#pinnedSeen.has(id)) item.classList.add("new");
        item.style.setProperty("--tilt", tilts[index % tilts.length]!);
        const job = document.createElement("small");
        job.textContent = task.label;
        const skill = document.createElement("p");
        skill.textContent = rule.skill;
        const from = document.createElement("small");
        from.className = "from";
        from.textContent = rule.learnedFrom ? `from: “${rule.learnedFrom}”` : "";
        const row = document.createElement("div");
        row.className = "row";
        const status = document.createElement("span");
        status.textContent = on ? "runs free" : "back on the meter";
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "switch";
        toggle.setAttribute("role", "switch");
        toggle.setAttribute("aria-checked", String(on));
        toggle.setAttribute("aria-label", on ? `Unpin “${rule.skill}”` : `Pin “${rule.skill}” again (re-teaches it: one live call)`);
        toggle.dataset["task"] = id;
        toggle.disabled = busy;
        const knob = document.createElement("i");
        toggle.append(knob, document.createTextNode(on ? "pinned" : "unpinned"));
        row.append(status, toggle);
        item.append(job, skill, from, row);
        return item;
      }),
    );
    for (const [id, , on] of entries) if (on) this.#pinnedSeen.add(id);
    // Rules already on the board when the page opened are not news; only ones pinned while you watch drop in.
    if (bench.state().startsWith("/Bench/online")) this.#boardLoaded = true;
  }

  #q<T extends Element = HTMLElement>(selector: string): T {
    const found = this.#root.querySelector<T>(selector);
    if (found === null) throw new Error(`mosfet-bench: template is missing ${selector}`);
    return found;
  }
}

function logItem(line: LogLine): HTMLLIElement {
  const item = document.createElement("li");
  item.dataset["kind"] = line.kind;
  const text = document.createElement("span");
  text.className = "t";
  text.textContent = line.text;
  item.append(text);
  if (line.cost !== undefined) {
    const cost = document.createElement("span");
    cost.className = line.cost === 0 ? "c free" : "c";
    cost.textContent = line.cost === 0 ? "free" : `${Math.round(line.cost * 100)}¢`;
    item.append(cost);
  }
  return item;
}

function chatItem(line: ChatLine): HTMLLIElement {
  const item = document.createElement("li");
  item.dataset["who"] = line.who;
  item.textContent = line.text;
  return item;
}

function typingItem(): HTMLLIElement {
  const item = document.createElement("li");
  item.dataset["who"] = "mosfet";
  item.className = "typing";
  item.textContent = "•••";
  return item;
}

export function defineMosfetBenchElement(): void {
  if (!customElements.get(MOSFET_BENCH_TAG)) customElements.define(MOSFET_BENCH_TAG, MosfetBenchElement);
}

declare global {
  interface HTMLElementTagNameMap {
    "mosfet-bench": MosfetBenchElement;
  }
}
