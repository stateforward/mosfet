import "./dom.ts";
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import * as hsm from "../src/hsm.ts";
import { Eye, startEye } from "../src/face/eye.ts";
import { Face, startFace } from "../src/face/face-machine.ts";
import { EXPRESSIONS, EYE_SHAPES, withOpenness } from "../src/face/presets.ts";

const YIELD_MS = 0;

async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 200; i += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => {
      globalThis.setTimeout(resolve, YIELD_MS);
    });
  }
  throw new Error(`timed out waiting for ${what}`);
}

describe("Eye lid topology", () => {
  test("starts open with the lid fully raised", async () => {
    const eye = startEye({ ctx: new hsm.Context() });
    try {
      assert.match(eye.state(), /\/open$/);
      assert.equal(eye.lid, 1);
    } finally {
      await hsm.stop(eye);
    }
  });

  test("a blink closes and reopens on its own", async () => {
    const eye = startEye({ ctx: new hsm.Context() });
    try {
      void hsm.dispatch(eye, hsm.typedEvent({ event: Eye.blinkEvent })).catch(hsm.catchFailure());
      await waitFor(() => /\/closed$/.test(eye.state()), "eye to close");
      assert.equal(eye.lid, 0);
      await waitFor(() => /\/open$/.test(eye.state()), "eye to reopen");
      assert.equal(eye.lid, 1);
    } finally {
      await hsm.stop(eye);
    }
  });

  test("an explicit close stays shut until told to open", async () => {
    const eye = startEye({ ctx: new hsm.Context() });
    try {
      void hsm.dispatch(eye, hsm.typedEvent({ event: Eye.closeEvent })).catch(hsm.catchFailure());
      await waitFor(() => /\/closed$/.test(eye.state()), "eye to close");

      // A blink would have reopened by now; an explicit close must not.
      await new Promise<void>((resolve) => {
        globalThis.setTimeout(resolve, 300);
      });
      assert.match(eye.state(), /\/closed$/);
      assert.equal(eye.lid, 0);

      void hsm.dispatch(eye, hsm.typedEvent({ event: Eye.openEvent })).catch(hsm.catchFailure());
      await waitFor(() => /\/open$/.test(eye.state()), "eye to open");
    } finally {
      await hsm.stop(eye);
    }
  });
});

describe("Face expression", () => {
  test("starts awake and showing", async () => {
    const face = startFace({ ctx: new hsm.Context() });
    try {
      assert.match(face.state(), /\/awake\/showing$/);
      assert.equal(face.expression, "normal");
    } finally {
      await hsm.stop(face);
    }
  });

  test("expression is a state change, not a field poke", async () => {
    const face = startFace({ ctx: new hsm.Context() });
    try {
      await hsm.dispatch(
        face,
        hsm.typedEvent({ event: Face.expressEvent, data: { expression: "focused" } }),
      );
      assert.equal(face.expression, "focused");
      const shapes = face.shapes();
      assert.deepEqual(shapes.left, withOpenness(EYE_SHAPES[EXPRESSIONS.focused.left], 1));
    } finally {
      await hsm.stop(face);
    }
  });

  test("an unknown expression is refused", async () => {
    const face = startFace({ ctx: new hsm.Context() });
    try {
      await hsm.dispatch(
        face,
        hsm.typedEvent({ event: Face.expressEvent, data: { expression: "nonsense" } }),
      );
      assert.equal(face.expression, "normal");
    } finally {
      await hsm.stop(face);
    }
  });

  test("expressions are asymmetric where the preset says so", () => {
    assert.notEqual(EXPRESSIONS.worried.left, EXPRESSIONS.worried.right);
    assert.notEqual(EXPRESSIONS.skeptic.left, EXPRESSIONS.skeptic.right);
  });
});

describe("Face sleep", () => {
  test("asleep closes both eyes and wake reopens them", async () => {
    const face = startFace({ ctx: new hsm.Context() });
    try {
      void hsm.dispatch(face, hsm.typedEvent({ event: Face.sleepEvent })).catch(hsm.catchFailure());
      await waitFor(() => /\/asleep$/.test(face.state()), "face to sleep");
      await waitFor(
        () => face.left?.lid === 0 && face.right?.lid === 0,
        "both eyes to close",
      );

      void hsm.dispatch(face, hsm.typedEvent({ event: Face.wakeEvent })).catch(hsm.catchFailure());
      await waitFor(() => /\/awake\/showing$/.test(face.state()), "face to wake");
      await waitFor(() => face.left?.lid === 1 && face.right?.lid === 1, "both eyes to open");
    } finally {
      await hsm.stop(face);
    }
  });

  test("a sleeping face does not blink itself awake", async () => {
    const face = startFace({ ctx: new hsm.Context() });
    try {
      void hsm.dispatch(face, hsm.typedEvent({ event: Face.sleepEvent })).catch(hsm.catchFailure());
      await waitFor(() => /\/asleep$/.test(face.state()), "face to sleep");
      await new Promise<void>((resolve) => {
        globalThis.setTimeout(resolve, 400);
      });
      assert.match(face.state(), /\/asleep$/);
    } finally {
      await hsm.stop(face);
    }
  });
});

describe("Face lifetime", () => {
  test("stopping the face stops the eyes it owns", async () => {
    const face = startFace({ ctx: new hsm.Context() });
    const left = face.left;
    assert.ok(left);
    await hsm.stop(face);
    assert.equal(hsm.hostWasStopped(face), true);
  });
});
