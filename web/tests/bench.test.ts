import "./dom.ts";
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import * as hsm from "../src/hsm.ts";
import { Bench, startBench, type BenchRule, type BenchTransport } from "../src/bench/bench-machine.ts";
import { Builder, startBuilder, type BuilderTransport, type Catalog } from "../src/bench/builder-machine.ts";

Bench.recheckMs = 5;
Bench.paidStepMs = 1;
Bench.freeStepMs = 1;
Builder.recheckMs = 5;

async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 400; i += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 1));
  }
  throw new Error(`timed out waiting for ${what}`);
}

const send = (machine: hsm.Instance, event: { readonly name: string; readonly kind: hsm.Event["kind"] }, data?: unknown) =>
  Promise.resolve(hsm.dispatch(machine, data === undefined ? hsm.typedEvent({ event }) : hsm.typedEvent({ event, data })));

/** A bridge that behaves like workshop/server.py: paid until taught, free after. */
function bridge(overrides: Partial<BenchTransport> = {}): BenchTransport & { calls: string[]; pinned: Map<string, BenchRule> } {
  const pinned = new Map<string, BenchRule>();
  const calls: string[] = [];
  return {
    calls,
    pinned,
    rules: async () => Object.fromEntries(pinned),
    run: async (task) => {
      calls.push(`run:${task}`);
      const rule = pinned.get(task);
      return rule
        ? { mode: "free", cost: 0, steps: rule.steps, result: rule.result, problem: null }
        : { mode: "paid", cost: 0.04, steps: ["a", "b", "c", "d"], result: "done", problem: null };
    },
    teach: async (task, correction) => {
      calls.push(`teach:${task}`);
      const rule = { skill: `learned ${correction}`, steps: ["a", "b"], result: "done right", learnedFrom: correction };
      pinned.set(task, rule);
      return { rule, problem: null };
    },
    forget: async (task) => {
      calls.push(`forget:${task}`);
      pinned.delete(task);
    },
    ...overrides,
  };
}

describe("Bench", () => {
  test("run live, correct once, rerun free", async () => {
    const transport = bridge();
    const bench = startBench({ ctx: new hsm.Context(), transport });
    try {
      await waitFor(() => /\/online\/fresh$/.test(bench.state()), "fresh");
      assert.equal(bench.task.id, "plan", "a first visit starts on an unlearned job");

      await send(bench, Bench.runEvent);
      await waitFor(() => /\/reviewing$/.test(bench.state()), "reviewing");
      assert.equal(bench.runCost, 0.04, "the steps' shares add up to the real bill");
      assert.equal(bench.spent, 0.04);
      assert.deepEqual(bench.log.filter((l) => l.kind === "step").map((l) => l.cost), [0.01, 0.01, 0.01, 0.01]);

      await send(bench, Bench.teachEvent, { text: "   " });
      assert.match(bench.state(), /\/reviewing$/, "a blank correction teaches nothing");
      await send(bench, Bench.teachEvent, { text: "buffer friday" });
      await waitFor(() => /\/learned\/ready$/.test(bench.state()), "learned");
      assert.equal(bench.rules.get("plan")?.skill, "learned buffer friday");

      await send(bench, Bench.runEvent);
      await waitFor(() => /\/learned\/replayed$/.test(bench.state()), "replayed");
      assert.equal(bench.runCost, 0, "a learned run is free");
      assert.equal(bench.spent, 0.04, "and adds nothing to the spend");
      assert.equal(bench.saved, 0.04, "it saves what a live run costs");
      assert.deepEqual(transport.calls, ["run:plan", "teach:plan", "run:plan"]);
    } finally {
      await hsm.stop(bench);
    }
  });

  test("unpinning puts the job back on the meter, and pinning again re-teaches it", async () => {
    const transport = bridge();
    transport.pinned.set("plan", { skill: "old rule", steps: [], result: "r", learnedFrom: "block friday" });
    const bench = startBench({ ctx: new hsm.Context(), transport });
    try {
      await waitFor(() => /\/online\//.test(bench.state()), "online");
      await send(bench, Bench.pickEvent, { task: "plan" });
      await waitFor(() => /\/learned\/ready$/.test(bench.state()), "learned job");
      await send(bench, Bench.forgetEvent, { task: "plan" });
      await waitFor(() => /\/online\/fresh$/.test(bench.state()), "fresh after forget");
      assert.equal(bench.rules.has("plan"), false);
      assert.equal(bench.ghosts.get("plan")?.skill, "old rule");

      await send(bench, Bench.repinEvent, { task: "plan" });
      await waitFor(() => /\/learned\/ready$/.test(bench.state()), "re-pinned");
      assert.equal(bench.rules.get("plan")?.learnedFrom, "block friday", "re-teaches from the original correction");
      assert.equal(bench.ghosts.has("plan"), false);
    } finally {
      await hsm.stop(bench);
    }
  });

  test("a failed run says why and stays on the job; an unreachable bridge is offline and retries", async () => {
    let reachable = false;
    const transport = bridge({
      rules: async () => {
        if (!reachable) throw new Error("down");
        return {};
      },
      run: async () => ({ mode: "paid", cost: 0, steps: [], result: "", problem: "no model key configured" }),
    });
    const bench = startBench({ ctx: new hsm.Context(), transport });
    try {
      await waitFor(() => /\/offline$/.test(bench.state()), "offline");
      reachable = true;
      await waitFor(() => /\/online\/fresh$/.test(bench.state()), "recovered");
      await send(bench, Bench.runEvent);
      await waitFor(() => bench.problem === "no model key configured", "problem");
      assert.match(bench.state(), /\/online\/fresh$/);
      assert.equal(bench.expression, "worried");
      assert.equal(bench.spent, 0);
    } finally {
      await hsm.stop(bench);
    }
  });
});

const catalog: Catalog = {
  devices: [
    { id: "phone", label: "phone", describes: "", needs: [], available: true, note: null },
    { id: "speaker", label: "speaker", describes: "", needs: [], available: true, note: null },
  ],
  abilities: [
    { id: "speaking", label: "speaking", describes: "", needs: ["speaker"], available: true, note: null },
    { id: "listening", label: "listening", describes: "", needs: [], available: false, note: "not here" },
  ],
  cognition: "thinks",
};

describe("Builder", () => {
  test("fits what an ability needs, boots a bot, and stops it on rebuild", async () => {
    const stopped: string[] = [];
    const specs: unknown[] = [];
    const transport: BuilderTransport = {
      catalog: async () => catalog,
      build: async (spec) => {
        specs.push(spec);
        return { bot: "b1", label: `${spec.name} [cognition]`, problem: null };
      },
      stop: (bot) => void stopped.push(bot),
    };
    const builder = startBuilder({ ctx: new hsm.Context(), transport });
    try {
      await waitFor(() => /\/picking$/.test(builder.state()), "picking");
      await send(builder, Builder.toggleEvent, { part: "speaking" });
      assert.deepEqual([...builder.devices].sort(), ["phone", "speaker"], "speaking fits its speaker");
      await send(builder, Builder.toggleEvent, { part: "listening" });
      assert.equal(builder.abilities.has("listening"), false, "unavailable parts can't be fitted");
      await send(builder, Builder.toggleEvent, { part: "speaker" });
      assert.equal(builder.abilities.has("speaking"), false, "removing a device removes what needs it");
      await send(builder, Builder.nameEvent, { name: "  moss " });
      await send(builder, Builder.bootEvent);
      await waitFor(() => /\/booted$/.test(builder.state()), "booted");
      assert.equal(builder.bot, "b1");
      assert.deepEqual(specs, [{ name: "moss", devices: ["phone"], abilities: [] }]);
      await send(builder, Builder.rebuildEvent);
      assert.match(builder.state(), /\/picking$/);
      assert.deepEqual(stopped, ["b1"]);
      assert.equal(builder.bot, null);
    } finally {
      await hsm.stop(builder);
    }
  });

  test("a failed build says why and goes back to picking", async () => {
    const builder = startBuilder({
      ctx: new hsm.Context(),
      transport: {
        catalog: async () => catalog,
        build: async () => ({ bot: null, label: null, problem: "no model key" }),
        stop: () => undefined,
      },
    });
    try {
      await waitFor(() => /\/picking$/.test(builder.state()), "picking");
      await send(builder, Builder.bootEvent);
      await waitFor(() => builder.problem === "no model key", "problem");
      assert.match(builder.state(), /\/picking$/);
    } finally {
      await hsm.stop(builder);
    }
  });
});
