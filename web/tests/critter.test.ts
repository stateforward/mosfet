import "./dom.ts";
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { CRITTER_POSES, shade, stepSpring } from "../src/face/critter.ts";
import { EXPRESSIONS } from "../src/face/presets.ts";

describe("critter poses", () => {
  test("every expression has a stalk posture for both eyes", () => {
    for (const name of Object.keys(EXPRESSIONS)) {
      const pose = CRITTER_POSES[name as keyof typeof CRITTER_POSES];
      assert.ok(pose, name);
      for (const stalk of [pose.left, pose.right]) {
        assert.ok(stalk.length > 0 && stalk.length <= 1, `${name} length`);
        assert.ok(stalk.lid > 0 && stalk.lid <= 1, `${name} lid`);
      }
    }
  });

  test("a spring overshoots, then settles on its target", () => {
    const spring = { value: 0, velocity: 0 };
    let peak = 0;
    for (let i = 0; i < 400; i += 1) {
      stepSpring(spring, 1);
      peak = Math.max(peak, spring.value);
    }
    assert.ok(peak > 1, "overshoots");
    assert.ok(Math.abs(spring.value - 1) < 1e-3, "settles");
  });

  test("shade darkens hex colors and leaves others alone", () => {
    assert.equal(shade("#26d1a2", 0.5), "#136951");
    assert.equal(shade("#fff", 0), "#ffffff");
    assert.equal(shade("teal", 0.5), "teal");
  });

});
