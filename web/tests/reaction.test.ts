import "./dom.ts";
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import * as hsm from "../src/hsm.ts";
import { Reaction, startReaction } from "../src/face/reaction.ts";

const poke = (reaction: Reaction, target: string, at: number) =>
  hsm.dispatch(reaction, hsm.typedEvent({ event: Reaction.pokeEvent, data: { target, at } }));

describe("Reaction", () => {
  test("an eye poke says ouch on that side, a body poke giggles", async () => {
    const reaction = startReaction({ ctx: new hsm.Context() });
    try {
      await poke(reaction, "right", 0);
      assert.match(reaction.state(), /\/ouch$/);
      assert.equal(reaction.side, "right");
      assert.equal(reaction.pokes, 1);
    } finally {
      await hsm.stop(reaction);
    }
    const other = startReaction({ ctx: new hsm.Context() });
    try {
      await poke(other, "body", 0);
      assert.match(other.state(), /\/giggling$/);
      await poke(other, "nose", 10);
      assert.equal(other.pokes, 1, "unknown targets are ignored");
    } finally {
      await hsm.stop(other);
    }
  });

  test("three quick pokes and it runs off; spaced-out pokes don't count", async () => {
    const reaction = startReaction({ ctx: new hsm.Context() });
    try {
      await poke(reaction, "left", 0);
      await poke(reaction, "left", 5000);
      assert.match(reaction.state(), /\/ouch$/, "the first poke aged out of the window");
      await poke(reaction, "right", 5400);
      assert.match(reaction.state(), /\/ouch$/, "two in the window is still just ouch");
      await poke(reaction, "left", 5600);
      assert.match(reaction.state(), /\/fleeing$/);
      await poke(reaction, "right", 5700);
      assert.match(reaction.state(), /\/fleeing$/, "not listening while it runs");
    } finally {
      await hsm.stop(reaction);
    }
  });
});
