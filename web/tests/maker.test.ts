import "./dom.ts";
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import * as hsm from "../src/hsm.ts";
import { Maker, startMaker } from "../src/site/maker-machine.ts";
import { firstRunCost, TASKS } from "../src/site/tasks.ts";

Maker.autoplayMs = 0;
Maker.startMs = 1;
Maker.stepMs = 1;
Maker.learnMs = 1;
Maker.replayMs = 1;

async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 400; i += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 1));
  }
  throw new Error(`timed out waiting for ${what}`);
}

function send(maker: Maker, event: { readonly name: string; readonly kind: hsm.Event["kind"] }, data?: unknown): Promise<void> {
  return Promise.resolve(
    data === undefined ? hsm.dispatch(maker, hsm.typedEvent({ event })) : hsm.dispatch(maker, hsm.typedEvent({ event, data })),
  ).then(() => undefined);
}

describe("Maker demo", () => {
  test("starts the first job by itself once, not after a reset", async () => {
    Maker.autoplayMs = 1;
    const maker = startMaker({ ctx: new hsm.Context() });
    try {
      await waitFor(() => maker.task?.id === "code", "autoplay");
      await send(maker, Maker.resetEvent);
      await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 20));
      assert.match(maker.state(), /\/choosing$/);
    } finally {
      Maker.autoplayMs = 0;
      await hsm.stop(maker);
    }
  });

  test("paid run, one correction, then free runs", async () => {
    const maker = startMaker({ ctx: new hsm.Context() });
    try {
      assert.match(maker.state(), /\/choosing$/);
      await send(maker, Maker.pickEvent, { task: "nope" });
      assert.match(maker.state(), /\/choosing$/, "unknown task ignored");

      await send(maker, Maker.pickEvent, { task: "code" });
      await waitFor(() => /\/untaught\/reviewing$/.test(maker.state()), "paid run to finish");
      const cost = firstRunCost(TASKS.code);
      assert.ok(Math.abs(maker.runCost - cost) < 1e-9);
      assert.equal(maker.lines.filter((line) => line.who === "step").length, TASKS.code.steps.length);

      await send(maker, Maker.teachEvent, { text: "  " });
      assert.match(maker.state(), /\/reviewing$/, "blank correction ignored");
      await send(maker, Maker.teachEvent, { text: TASKS.code.correction });
      await waitFor(() => /\/learned\/ready$/.test(maker.state()), "learning");
      assert.equal(maker.skill, TASKS.code.skill);

      await send(maker, Maker.runEvent);
      await waitFor(() => /\/learned\/replayed$/.test(maker.state()), "free run");
      assert.equal(maker.runCost, 0);
      assert.ok(Math.abs(maker.spent - cost) < 1e-9, "free run adds no spend");
      assert.equal(maker.runs, 2);
      assert.ok(Math.abs(maker.wouldHaveSpent() - 2 * cost) < 1e-9);

      await send(maker, Maker.forgetEvent);
      assert.equal(maker.skill, null);
      await waitFor(() => /\/untaught\/reviewing$/.test(maker.state()), "forgotten job back on the meter");
      assert.ok(maker.spent > cost, "forgetting makes the next run paid again");

      await send(maker, Maker.resetEvent);
      assert.match(maker.state(), /\/choosing$/);
      assert.equal(maker.lines.length, 0);
    } finally {
      await hsm.stop(maker);
    }
  });
});
