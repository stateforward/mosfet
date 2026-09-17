# web

Watch a bot think.

This is a dashboard that draws the live state machines inside a running bot: which machines
exist, what state each one is in, what event moved it there, and what it did next. You can
click an edge and fire that event back at the bot.

It reads one thing only: `bot.hsm.observe` spans, exported over OTLP. No bot topology is
hard-coded here. Whatever the bot is, the graph is whatever it reports.

## Run it

```sh
npm install
npm run dev
```

Point a bot at the collector and open the printed URL:

```sh
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4317
```

Spans appear as the bot emits them.

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

Nested shells show ownership. Edges connect consecutive observations of the same machine
when its state changed. The latest state is highlighted.

## Everything is a state machine

The UI is built the same way the bot is: every element is an HSM. Autonomous custom
elements extend `hsm.from(HTMLElement)`, start in `connectedCallback`, stop in
`disconnectedCallback`.

`src/flow/` is a graph library that ports React Flow's surface to custom elements
(`flow-graph`, `flow-node`, `flow-edge`, `flow-handle`, `flow-background`, `flow-controls`,
`flow-minimap`). Orthogonal concerns are separate sibling machines rather than one tangled
component:

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
