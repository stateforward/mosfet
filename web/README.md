# web

The workshop.

This is where bots get made, run, watched, poked, broken, and fixed. You build one here,
you ring it here, you watch what it did here, and when it does the wrong thing you correct
it here. Same surface for all of it, whether the one doing the correcting is you or mosfet.

A bot is a live thing, not a build artifact. So the workshop is not a deploy target with a
log viewer bolted on. It is the room the bot is in.

> **Today it does the watching part.** Live topology, live state, live events, and sending
> an event back at a running bot. The rest of what is described below is being built. This
> file says where it is going so the shape is clear; it does not pretend to have arrived.

## Run it

```sh
npm install
npm run dev
```

Point a bot at the collector and open the printed URL:

```sh
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4317
```

Machines appear as the bot emits them.

## What the workshop is for

**Make one.** Describe the bot you want. It gets assembled from abilities, devices, and
providers rather than scaffolded into a project you then maintain.

**Run it.** Bots are live. Start one, attach a phone or a microphone, let it sit in an
environment and wait for something to happen.

**Watch it.** Every machine, every state, every event, as it happens. Not logs after the
fact. The bot's actual topology, drawn from what it reports about itself.

**Poke it.** Click an edge, fire that event, see what the bot does. Ring the phone. Say
something. Find out whether it decided anything.

**Debug it.** When a bot does nothing, the first question is what it was given to act on,
and that is a question about perception and topology — exactly what is on screen. mosfet
reads the same view you do, so "why didn't it answer" is answerable by either of you.

**Teach it.** A correction becomes a stored rule. The workshop is where you watch a rule
get learned and confirm it stuck.

**Test it.** Replay a situation, pin what the bot was able to perceive and do, and never
pin the choice it makes. A bot whose output you can predict from reading its topology is a
script wearing a bot's clothes.

## How it connects

The Vite dev server *is* the collector. There is no separate process.

```
bot ──OTLP gRPC :4317──► collector ──SSE /v1/traces/stream──► page
    ◄──── Control.Subscribe ──── collector ◄── POST /v1/commands ────
```

Traces flow in over gRPC and out to the browser as server-sent events. Commands go the
other way: the page posts an event name, the collector fans it to the bot's
`Control.Subscribe` stream, and the bot dispatches it.

## What draws the graph

Only `bot.hsm.observe` spans, and only these attributes, all low-cardinality by contract
(see `observation_attributes` in `mosfet.py/src/mosfet/telemetry/hsm.py`):

| Attribute | Use |
|---|---|
| `hsm.machine.name` | node identity |
| `hsm.machine.state` | current state path |
| `hsm.event.name` / `hsm.event.kind` | edge label |
| `bot.component.name` | ownership shell |
| `hsm.observation.occurrence` | ordering |
| `bot.outcome` | success / failure styling |

No bot topology is hard-coded. Whatever the bot is, the graph is whatever it reports.
Nested shells show ownership, edges connect consecutive observations of the same machine
when its state changed, and the latest state is highlighted.

## Everything here is a state machine

The workshop is built the way the bots are. Every element is an HSM: autonomous custom
elements extend `hsm.from(HTMLElement)`, start in `connectedCallback`, stop in
`disconnectedCallback`.

`src/flow/` ports React Flow's surface to custom elements (`flow-graph`, `flow-node`,
`flow-edge`, `flow-handle`, `flow-background`, `flow-controls`, `flow-minimap`). Orthogonal
concerns are separate sibling machines rather than one tangled component:

| Machine | States |
|---|---|
| `Renderer` | `clean` / `dirty` / `rendering` — coalesces paints |
| `Panner` | `fixed` / `panning` |
| `Dragger` | `idle` / `dragging` |
| `Resizer` | `idle` / `resizing/pointer` / `resizing/keyboard` |
| `Focuser` | `unfocused` / `focused` |
| `Selection` | `none` / `picking` / `box` |
| `Connection` | `idle` / `connecting` |

Page-level machines are `bot-dashboard` (`idle` / `live` / `error`), `bot-otel-source`
(`idle` / `connecting` / `live` / `error`), and `bot-machine-graph`.

Resize supports pointer and keyboard as exclusive nested sessions: Enter or Space on a
resize control starts one, arrows step 1px in world units, Escape ends it.

## Develop

```sh
npm run typecheck     # tsc across app, node, test, and e2e configs
npm test              # node --test
npm run test:e2e      # playwright (npx playwright install chromium first)
npm run build
```

Exports: `./hsm` (`@stateforward/hsm.ts` plus the custom-element host protocol), `./flow`
(the graph library), `./elements` (studio registration).

TypeScript is strict with `noUncheckedIndexedAccess`. Styling is constructable stylesheets
plus `src/dashboard.css`. The collector uses `@grpc/grpc-js` and `@grpc/proto-loader`
in-process.

## Collector storage

Published models persist to `.data/models.json` (git-ignored) and reload when Vite starts.
Override with `BOT_MODEL_STORE_PATH`, or move the gRPC listener off `127.0.0.1:4317` with
`BOT_GRPC_PORT`. Writes are atomic replacements and a failed write returns an error rather
than a false success, so the collector must be the only writer.
