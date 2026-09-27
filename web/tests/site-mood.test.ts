import "./dom.ts";
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import * as hsm from "../src/hsm.ts";
import { Mood, startMood, type MoodCue } from "../src/site/mood-machine.ts";
import { Maker, phaseOf, startMaker } from "../src/site/maker-machine.ts";
import { FREQUENCIES, learnedPerYear, rebilledPerYear, ROUTINE_COST, stopIndex, wholeDollars } from "../src/site/savings.ts";
import { firstRunCost, TASKS } from "../src/site/tasks.ts";

Mood.dozeMs = 15;
Mood.reactMs = 5;
Mood.wakeMs = 5;
Mood.cheerMs = 5;

Maker.autoplayMs = 0;
Maker.startMs = 1;
Maker.stepMs = 1;
Maker.learnMs = 1;
Maker.replayMs = 1;

const tick = (ms: number): Promise<void> => new Promise((resolve) => globalThis.setTimeout(resolve, ms));

async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 400; i += 1) {
    if (predicate()) return;
    await tick(1);
  }
  throw new Error(`timed out waiting for ${what}`);
}

function send(machine: hsm.Instance, event: { readonly name: string; readonly kind: hsm.Event["kind"] }, data?: unknown): Promise<void> {
  return Promise.resolve(
    data === undefined ? hsm.dispatch(machine, hsm.typedEvent({ event })) : hsm.dispatch(machine, hsm.typedEvent({ event, data })),
  ).then(() => undefined);
}

/** A parent that records every cue its Mood tells it. */
class Owner extends hsm.Instance {
  cues: Array<{ cue: MoodCue; expression: string }> = [];
  static readonly model = hsm.define(
    "MoodOwner",
    hsm.initial(hsm.target("listening")),
    hsm.state(
      "listening",
      hsm.transition(
        hsm.on(Mood.changedEvent.name),
        hsm.effect((_ctx: hsm.Context, instance: hsm.Instance, event: hsm.Event) => {
          const data = event.data;
          if (instance instanceof Owner && hsm.isRecord(data)) {
            instance.cues.push({ cue: data["cue"] as MoodCue, expression: String(data["expression"]) });
          }
        }),
      ),
    ),
  );
}

describe("homepage Mood", () => {
  test("nods off when left alone, startles awake on activity", async () => {
    const owner = hsm.start({ ctx: new hsm.Context(), instance: new Owner(), model: Owner.model });
    const mood = startMood({ ctx: owner.context() });
    try {
      assert.match(mood.state(), /\/awake\/calm$/);
      await waitFor(() => /\/dozing$/.test(mood.state()), "doze");
      assert.deepEqual(owner.cues.at(-1), { cue: "sleep", expression: "sleepy" });
      await send(mood, Mood.activityEvent);
      assert.match(mood.state(), /\/waking$/);
      assert.deepEqual(owner.cues.slice(-2).map((c) => c.cue), ["wake", "express"]);
      assert.equal(mood.expression, "surprised");
      await waitFor(() => /\/awake\/calm$/.test(mood.state()), "settle");
      assert.equal(mood.expression, "normal");
    } finally {
      await hsm.stop(mood);
      await hsm.stop(owner);
    }
  });

  test("activity keeps it awake", async () => {
    const mood = startMood({ ctx: new hsm.Context() });
    try {
      for (let i = 0; i < 6; i += 1) {
        await tick(6);
        await send(mood, Mood.activityEvent);
      }
      assert.match(mood.state(), /\/awake\/calm$/, "each sign of life re-arms the doze timer");
    } finally {
      await hsm.stop(mood);
    }
  });

  test("reacts with a named expression only, and cheering wins from anywhere", async () => {
    const mood = startMood({ ctx: new hsm.Context() });
    try {
      await send(mood, Mood.reactEvent, { expression: "nope" });
      assert.match(mood.state(), /\/awake\/calm$/, "unknown expressions ignored");
      await send(mood, Mood.reactEvent, { expression: "worried" });
      assert.match(mood.state(), /\/awake\/reacting$/);
      assert.equal(mood.expression, "worried");
      await send(mood, Mood.napEvent);
      assert.match(mood.state(), /\/dozing$/);
      await send(mood, Mood.cheerEvent);
      assert.match(mood.state(), /\/cheering$/);
      assert.equal(mood.cue, "cheer");
      await waitFor(() => /\/awake\/calm$/.test(mood.state()), "cheer to end");
    } finally {
      await hsm.stop(mood);
    }
  });
});

describe("demo beats and the free moment", () => {
  test("phase follows the maker, and the first free run is the one milestone", async () => {
    const owner = new (class extends hsm.Instance {})();
    const moments: unknown[] = [];
    const host = hsm.start({
      ctx: new hsm.Context(),
      instance: owner,
      model: hsm.define(
        "MakerOwner",
        hsm.initial(hsm.target("on")),
        hsm.state(
          "on",
          hsm.transition(
            hsm.on(Maker.changedEvent.name),
            hsm.effect((_ctx: hsm.Context, _instance: hsm.Instance, event: hsm.Event) => {
              const data = event.data;
              if (hsm.isRecord(data) && data["moment"] !== undefined) moments.push(data["moment"]);
            }),
          ),
        ),
      ),
    });
    const maker = startMaker({ ctx: host.context() });
    try {
      assert.equal(phaseOf(maker.state(), maker.freeRuns), 1);
      await send(maker, Maker.pickEvent, { task: "plan" });
      await waitFor(() => /\/reviewing$/.test(maker.state()), "paid run");
      assert.equal(phaseOf(maker.state(), maker.freeRuns), 2);
      await send(maker, Maker.teachEvent, { text: TASKS.plan.correction });
      await waitFor(() => /\/learned\/ready$/.test(maker.state()), "learned");
      assert.equal(phaseOf(maker.state(), maker.freeRuns), 3);
      await send(maker, Maker.runEvent);
      await waitFor(() => /\/replayed$/.test(maker.state()), "free run");
      await send(maker, Maker.runEvent);
      await waitFor(() => maker.freeRuns === 2, "second free run");
      assert.equal(phaseOf(maker.state(), maker.freeRuns), 4);
      assert.deepEqual(moments, ["learned", "free"], "only the first free run is announced");
    } finally {
      await hsm.stop(maker);
      await hsm.stop(host);
    }
  });
});

describe("savings dial math", () => {
  test("re-billed scales with runs; learned is the one paid run", () => {
    assert.equal(ROUTINE_COST, firstRunCost(TASKS.code));
    const daily = FREQUENCIES.findIndex((f) => f.runsPerYear === 250);
    assert.ok(Math.abs(rebilledPerYear(daily) - 250 * ROUTINE_COST) < 1e-9);
    assert.equal(learnedPerYear(), ROUTINE_COST);
    for (let i = 1; i < FREQUENCIES.length; i += 1) assert.ok(rebilledPerYear(i) > rebilledPerYear(i - 1));
  });

  test("slider values clamp to a stop, dollars format whole", () => {
    assert.equal(stopIndex("4"), 4);
    assert.equal(stopIndex(99), FREQUENCIES.length - 1);
    assert.equal(stopIndex(-3), 0);
    assert.equal(stopIndex("abc"), 2);
    assert.equal(wholeDollars(4680.4), "$4,680");
    assert.equal(wholeDollars(0), "$0");
  });
});
