import "./dom.ts";
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import * as hsm from "../src/hsm.ts";
import { Drive, startDrive } from "../src/face/drive.ts";

describe("Drive", () => {
  test("parks facing front, spins a full turn, rolls sideways then faces front", async () => {
    const drive = startDrive({ ctx: new hsm.Context() });
    try {
      assert.match(drive.state(), /\/parked$/);
      assert.equal(drive.heading, 0);

      await hsm.dispatch(drive, hsm.typedEvent({ event: Drive.spinEvent, data: { direction: -1 } }));
      assert.match(drive.state(), /\/spinning$/);
      assert.equal(drive.heading, -Math.PI * 2);

      await hsm.dispatch(drive, hsm.typedEvent({ event: Drive.rollEvent, data: { x: 5 } }));
      assert.match(drive.state(), /\/rolling$/);
      assert.equal(drive.x, 1, "clamped to the box");
      assert.equal(drive.heading, -Math.PI * 2 + Math.PI / 2, "quarter turn toward travel");

      await hsm.dispatch(drive, hsm.typedEvent({ event: Drive.rollEvent, data: { x: "left" } }));
      assert.equal(drive.x, 1, "a bad target is ignored");
    } finally {
      await hsm.stop(drive);
    }
  });

  test("holds a view with no idle spins until released, turning the short way", async () => {
    const drive = startDrive({ ctx: new hsm.Context() });
    try {
      await hsm.dispatch(drive, hsm.typedEvent({ event: Drive.holdEvent, data: { view: "right" } }));
      assert.match(drive.state(), /\/holding$/);
      assert.equal(drive.heading, Math.PI / 2);
      await hsm.dispatch(drive, hsm.typedEvent({ event: Drive.holdEvent, data: { view: "left" } }));
      assert.ok(Math.abs(Math.abs(drive.heading - Math.PI / 2) - Math.PI) < 1e-9, "a half turn either way");
      await hsm.dispatch(drive, hsm.typedEvent({ event: Drive.holdEvent, data: { view: "sideways" } }));
      assert.match(drive.state(), /\/holding$/, "unknown view ignored");
      await hsm.dispatch(drive, hsm.typedEvent({ event: Drive.releaseEvent }));
      assert.match(drive.state(), /\/parked$/);
      assert.equal(Math.abs(Math.cos(drive.heading)), 1, "faces front or back of a full turn");
    } finally {
      await hsm.stop(drive);
    }
  });
});
