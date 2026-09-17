import { clamp, type CanvasPaint } from "./canvas.ts";
import { type EyeSide, type ExpressionName } from "./presets.ts";

/**
 * One eye stalk's posture for an expression.
 *
 * `length` is stalk reach as a fraction of the max; `lean` is degrees outward
 * from vertical (negative leans in toward the other stalk); `lid` caps how open
 * the eye gets; `pupil` scales the pupil; `wobble` is idle sway amplitude in
 * degrees; `droop` wilts the stalk over like a tired flower (0 upright, 1 fully hung).
 */
export type StalkPose = {
  readonly length: number;
  readonly lean: number;
  readonly lid: number;
  readonly pupil: number;
  readonly wobble: number;
  readonly droop: number;
};

export type CritterPose = { readonly left: StalkPose; readonly right: StalkPose };

const pose = (length: number, lean: number, lid: number, pupil: number, wobble: number, droop = 0): StalkPose => ({
  length,
  lean,
  lid,
  pupil,
  wobble,
  droop,
});

/** Posture per expression. Asymmetry is the point: two independent eyes. */
export const CRITTER_POSES: Record<ExpressionName, CritterPose> = {
  normal: { left: pose(0.78, 20, 1, 1, 3), right: pose(0.82, 16, 1, 1, 3) },
  happy: { left: pose(0.88, 26, 0.55, 1, 7), right: pose(0.88, 26, 0.55, 1, 7) },
  worried: { left: pose(0.6, 30, 0.9, 0.8, 9, 0.12), right: pose(0.56, 34, 0.85, 0.8, 9, 0.18) },
  focused: { left: pose(0.9, 14, 0.6, 0.9, 1), right: pose(0.9, 14, 0.6, 0.9, 1) },
  sleepy: { left: pose(0.8, 14, 0.28, 1, 2, 0.7), right: pose(0.74, 18, 0.2, 1, 2, 0.9) },
  angry: { left: pose(0.62, 12, 0.5, 0.75, 1), right: pose(0.62, 12, 0.5, 0.75, 1) },
  surprised: { left: pose(1, 12, 1, 0.55, 0), right: pose(1, 12, 1, 0.55, 0) },
  skeptic: { left: pose(0.98, 8, 0.45, 0.9, 1), right: pose(0.55, 40, 1, 1, 4) },
};

/** A damped spring value, stepped once per frame. */
export type Spring = { value: number; velocity: number };

/**
 * Advance `spring` toward `target`.
 *
 * Underdamped on purpose: stalks overshoot and settle, which is what makes an
 * expression change read as a reaction instead of a tween.
 */
export function stepSpring(spring: Spring, target: number, stiffness = 0.12, damping = 0.78): void {
  spring.velocity = (spring.velocity + (target - spring.value) * stiffness) * damping;
  spring.value += spring.velocity;
}

/** Everything the renderer needs for one stalk this frame. */
export type StalkFrame = {
  /** Reach, 0..1 of max. */
  readonly length: number;
  /** Degrees outward from vertical. */
  readonly lean: number;
  /** Eye openness after lid cap and blink, 0..1. */
  readonly open: number;
  readonly pupil: number;
  /** Pupil offset in -1..1 of the eyeball's free travel. */
  readonly lookX: number;
  readonly lookY: number;
  readonly droop: number;
  /** Squeezed shut from a poke: drawn as a `>` or `<` instead of an eye. */
  readonly squeeze?: boolean;
};

export type CritterFrame = {
  readonly left: StalkFrame;
  readonly right: StalkFrame;
  readonly ink: CanvasPaint;
  readonly eye: CanvasPaint;
  /** A darker shade of `ink`, so a lid cropping the pupil never merges with it. */
  readonly pupil: CanvasPaint;
  /** Tire color: its own shade of `ink`, distinct from the pupil. */
  readonly tire: CanvasPaint;
  /** Radians the bot has turned; 0 faces the viewer. */
  readonly heading: number;
  /** Position across the box, -1..1. */
  readonly x: number;
  /** Wheel rotation in radians, for the spokes and tread. */
  readonly wheel: number;
  readonly geometry: CritterGeometry;
};

/**
 * Tunable proportions, each a fraction of the box's unit size (its height, or
 * width / 1.15 if that is smaller). `stalkSpread` is how far apart the stalk
 * roots sit, as a fraction of drum length. The eye stalks grow out of the
 * drum's top front, and a wheel mounts low on each end cap.
 */
export type CritterGeometry = {
  readonly wheelRadius: number;
  /** Edge-on tire width, as a fraction of wheel radius. */
  readonly wheelThickness: number;
  /** Tire corner rounding, 0 square to 1 fully round (edge-on it becomes a pill). */
  readonly wheelRoundness: number;
  /** Tread grooves around the tire. */
  readonly treadCount: number;
  /** Drum radius: the body is a cylinder lying on its side, round when seen side-on. */
  readonly shellSize: number;
  /** Front-view corner radius, as a fraction of drum radius: 0 square corners, 1 fully round ends. */
  readonly drumCornerRadius: number;
  /** Drum length between its end caps, which is its width from the front. */
  readonly shellLength: number;
  /** How far below the drum's center the wheel hubs sit, as a fraction of drum radius. */
  readonly wheelDrop: number;
  readonly stalkLength: number;
  readonly stalkWidth: number;
  readonly stalkSpread: number;
  readonly eyeRadius: number;
};

export const DEFAULT_GEOMETRY: CritterGeometry = {
  wheelRadius: 0.12,
  wheelThickness: 0.85,
  wheelRoundness: 1,
  treadCount: 14,
  shellSize: 0.165,
  shellLength: 0.21,
  drumCornerRadius: 0.25,
  wheelDrop: 0.63,
  stalkLength: 0.34,
  stalkWidth: 0.034,
  stalkSpread: 0.26,
  eyeRadius: 0.115,
};

/**
 * Darken a `#rgb` or `#rrggbb` color toward black by `amount` (0..1).
 *
 * Non-hex paints are returned unchanged; callers that pass named or rgb()
 * colors should pass an explicit pupil color instead.
 */
export function shade(color: string, amount: number): string {
  const hex = color.trim().replace(/^#/, "");
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return color;
  const k = 1 - clamp(amount, 0, 1);
  const channel = (i: number): string =>
    Math.round(parseInt(full.slice(i, i + 2), 16) * k).toString(16).padStart(2, "0");
  return `#${channel(0)}${channel(2)}${channel(4)}`;
}

/** Where each eye and the body were drawn, in canvas CSS pixels, for hit testing. */
export type CritterHits = {
  readonly left: { readonly x: number; readonly y: number; readonly r: number };
  readonly right: { readonly x: number; readonly y: number; readonly r: number };
  readonly body: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
};

/**
 * Draw the bot: a drum (a cylinder on its side) on two wheels, with two eye
 * stalks growing out of its top.
 *
 * From the front the drum is a wide bar; side-on it is a circle with a wheel
 * overlapping its lower edge. In between, its silhouette is a bar of length
 * `L·|cos|` with elliptical end caps `R·|sin|` wide, which is what a real
 * cylinder looks like as it turns. Wheels mount low on the end caps; whatever
 * is farther away is drawn first.
 */
export function drawCritter(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  frame: CritterFrame,
): CritterHits {
  const unit = Math.min(height, width / 1.15);
  const g = frame.geometry;
  const wheelR = unit * g.wheelRadius;
  const tireHalf = (wheelR * clamp(g.wheelThickness, 0.2, 2)) / 2;
  const drumR = unit * g.shellSize;
  const halfLen = (unit * g.shellLength) / 2;
  const facing = Math.cos(frame.heading);
  const sideways = Math.sin(frame.heading);
  const ground = height - unit * 0.02;
  const axleY = ground - wheelR;
  // Hubs sit low on the end caps; the drum rides above them but never sinks below the ground.
  const drumY = Math.min(axleY - drumR * clamp(g.wheelDrop, 0, 1), ground - drumR);
  const stalkMax = unit * g.stalkLength;
  const eyeR = unit * g.eyeRadius;

  // Keep the whole bot in its box at the ends of a roll.
  const sideReach = halfLen + tireHalf + wheelR * 0.5;
  // Eyes lean out past the drum toward the direction of travel, so leave room for them.
  const reachX = Math.max(drumR * 0.5 + eyeR * 1.8 + stalkMax * 0.3, drumR, sideReach);
  const cx = width / 2 + clamp(frame.x, -1, 1) * Math.max(0, width / 2 - reachX);

  const wheels = [-1, 1].map((side) => ({ x: cx + side * (halfLen + tireHalf) * facing, depth: side * sideways }));
  // A wheel only goes behind the drum once the bot has turned well away from us.
  const behind = (w: { depth: number }): boolean => w.depth < -0.55;
  for (const w of wheels) if (behind(w)) drawWheel(ctx, w.x, axleY, wheelR, sideways, frame);

  const stalks = (["left", "right"] as const).map((side) => {
    const out = side === "left" ? -1 : 1;
    // Roots sit on the drum's top front: along its length, and forward along the way it faces.
    const root = {
      x: cx + out * halfLen * g.stalkSpread * 2 * facing + drumR * 0.4 * sideways,
      y: drumY - drumR * 0.82,
    };
    const stalk = side === "left" ? frame.left : frame.right;
    const tip = stalkTip({ root, stalkMax, eyeR, side, stalk, turn: facing });
    // Side-on the two stalks would stack into one; splay them so the near eye leads and the far one trails.
    const splay = out * Math.abs(sideways) * eyeR * 0.55;
    tip.x += splay;
    tip.bendX += splay * 0.4;
    return { tip, stalk, depth: out * sideways, side };
  });
  const drawStalks = (): void => {
    ctx.strokeStyle = frame.ink;
    ctx.lineWidth = unit * g.stalkWidth;
    ctx.lineCap = "round";
    for (const { tip } of stalks) {
      ctx.beginPath();
      ctx.moveTo(tip.baseX, tip.baseY);
      ctx.quadraticCurveTo(tip.bendX, tip.bendY, tip.x, tip.y);
      ctx.stroke();
    }
  };
  const drawDrum = (): void => {
    // A rounded rectangle whose width swings from the drum's length (head-on) to its diameter (side-on).
    // Its corners go from the tuned front-view radius to full elliptical end caps, which makes a circle side-on.
    const turn = Math.abs(sideways);
    const w = 2 * halfLen * Math.abs(facing) + 2 * drumR * turn;
    const corner = drumR * clamp(g.drumCornerRadius, 0, 1);
    const rx = Math.min(w / 2, corner + (drumR - corner) * turn);
    const ry = Math.min(drumR, corner + (drumR - corner) * turn);
    ctx.fillStyle = frame.ink;
    ctx.beginPath();
    ctx.roundRect(cx - w / 2, drumY - drumR, w, drumR * 2, [{ x: rx, y: ry }]);
    ctx.fill();
  };

  // Facing us, the stalks grow out of the drum's front; turned away, the drum hides their roots.
  if (facing >= 0) {
    drawDrum();
    drawStalks();
  } else {
    drawStalks();
    drawDrum();
  }

  for (const w of wheels) if (!behind(w)) drawWheel(ctx, w.x, axleY, wheelR, sideways, frame);

  const hitOf = (index: number) => ({ x: stalks[index]!.tip.x, y: stalks[index]!.tip.y, r: eyeR });
  const hits: CritterHits = {
    left: hitOf(0),
    right: hitOf(1),
    body: { x: cx, y: drumY, w: (halfLen * Math.abs(facing) + drumR * Math.abs(sideways) + tireHalf) * 2, h: drumR },
  };
  stalks.sort((a, b) => a.depth - b.depth);
  for (const { tip, stalk, depth, side } of stalks) {
    drawEyeball(ctx, tip.x, tip.y, eyeR * (1 + depth * 0.07), stalk, frame, facing, sideways, side);
  }
  return hits;
}

/**
 * One wheel. Edge-on (facing the viewer) it is a rounded-rectangle tire with
 * grooves rolling over it; turned sideways it widens into a round wheel with a
 * hub and spokes.
 */
function drawWheel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  sideways: number,
  frame: CritterFrame,
): void {
  const g = frame.geometry;
  const open = Math.abs(sideways);
  const edge = r * clamp(g.wheelThickness, 0.2, 2);
  // Width swings from the tire's thickness to the full diameter as it turns toward us.
  const w = edge + (r * 2 - edge) * open;
  const h = r * 2;
  // Corners go from the tuned rounding (edge-on) to a full circle (face-on).
  const edgeRadius = (Math.min(edge, h) / 2) * clamp(g.wheelRoundness, 0, 1);
  const radius = edgeRadius + (r - edgeRadius) * open;
  ctx.save();
  ctx.fillStyle = frame.tire;
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - r, w, h, Math.min(radius, w / 2, r));
  ctx.fill();
  ctx.clip();

  ctx.strokeStyle = frame.eye;
  ctx.lineCap = "butt";
  if (open < 0.6) {
    // Grooves on the near half of the tread, bunching up where the tire curves away.
    ctx.globalAlpha = 0.55 * (1 - open / 0.6);
    const count = Math.max(2, Math.round(g.treadCount));
    ctx.lineWidth = Math.max(1, (r * 1.6) / count) * 0.45;
    for (let k = 0; k < count; k += 1) {
      const a = frame.wheel + (k * Math.PI * 2) / count;
      if (Math.cos(a) <= 0) continue;
      const gy = y - Math.sin(a) * r;
      ctx.beginPath();
      ctx.moveTo(x - w / 2, gy);
      ctx.lineTo(x + w / 2, gy);
      ctx.stroke();
    }
  }
  if (open > 0.3) {
    // Hub and spokes, squashed by how far the wheel has turned toward us.
    ctx.globalAlpha = Math.min(1, (open - 0.3) / 0.4);
    ctx.lineCap = "round";
    ctx.lineWidth = r * 0.12;
    for (let k = 0; k < 3; k += 1) {
      const a = frame.wheel + (k * Math.PI * 2) / 3;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * (w / 2) * 0.72, y + Math.sin(a) * r * 0.72);
      ctx.stroke();
    }
    ctx.fillStyle = frame.eye;
    ctx.beginPath();
    ctx.ellipse(x, y, (w / 2) * 0.22, r * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}


type Point = { x: number; y: number };

function stalkTip(args: {
  root: Point;
  stalkMax: number;
  eyeR: number;
  side: EyeSide;
  stalk: StalkFrame;
  /** cos(heading): squeezes sideways lean as the bot turns. */
  turn: number;
}): { baseX: number; baseY: number; bendX: number; bendY: number; x: number; y: number } {
  const { root, stalkMax, eyeR, side, stalk, turn } = args;
  const out = side === "left" ? -1 : 1;
  const baseX = root.x;
  const baseY = root.y;
  const angle = (out * clamp(stalk.lean, -40, 85) * Math.PI) / 180;
  const reach = eyeR * 0.6 + stalkMax * clamp(stalk.length, 0.2, 1);
  const d = clamp(stalk.droop, 0, 1);
  // Upright: a gentle curve out along `angle`. Drooped: rise, then hang over
  // outward so the eye dangles about level with the root.
  const x = baseX + turn * reach * (Math.sin(angle) * (1 - d) + out * 0.95 * d);
  const y = baseY - reach * (Math.cos(angle) * (1 - d) - 0.35 * d);
  const bendX = baseX + turn * reach * (Math.sin(angle * 0.35) * 0.55 * (1 - d) + out * 0.35 * d);
  const bendY = baseY - reach * (Math.cos(angle * 0.35) * 0.55 * (1 - d) + 0.95 * d);
  return { baseX, baseY, bendX, bendY, x, y };
}

function drawEyeball(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  stalk: StalkFrame,
  frame: CritterFrame,
  facing: number,
  sideways: number,
  side: EyeSide,
): void {
  const open = clamp(stalk.open, 0, 1);
  ctx.save();
  // The ball itself is round from every side.
  ctx.fillStyle = frame.ink;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();

  // Eyes look where the bot faces: in profile the front shows on the side it's heading,
  // and facing away you only see the back of the ball.
  const front = Math.max(clamp(facing, 0, 1), Math.abs(sideways) * 0.55 * clamp(facing + 0.6, 0, 1));
  if (front < 0.06) {
    ctx.restore();
    return;
  }
  ctx.translate(x + sideways * clamp(1 - facing, 0, 1) * r * 0.32, y);
  ctx.scale(front, 1);

  if (stalk.squeeze) {
    // Poked: squeezed shut as a chevron pointing at the other eye, so the pair reads ">  <".
    const point = side === "left" ? 1 : -1;
    ctx.strokeStyle = frame.eye;
    ctx.lineWidth = r * 0.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(-point * r * 0.38, -r * 0.42);
    ctx.lineTo(point * r * 0.38, 0);
    ctx.lineTo(-point * r * 0.38, r * 0.42);
    ctx.stroke();
    ctx.restore();
    return;
  }

  if (open < 0.08) {
    // Shut: a lid seam, so a closed eye still reads as an eye.
    ctx.strokeStyle = frame.eye;
    ctx.lineWidth = r * 0.16;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(0, -r * 0.28, r * 0.52, Math.PI * 0.18, Math.PI * 0.82);
    ctx.stroke();
    ctx.restore();
    return;
  }

  // The opening, then the pupil clipped to it. The pupil is a darker shade than the lids, so a squint never washes it out.
  const inner = r * 0.8;
  ctx.beginPath();
  ctx.ellipse(0, 0, inner, inner * open, 0, 0, Math.PI * 2);
  ctx.fillStyle = frame.eye;
  ctx.fill();
  ctx.clip();

  const travel = inner * (1 - 0.45 * stalk.pupil) * 0.6;
  ctx.beginPath();
  ctx.arc(
    clamp(stalk.lookX, -1, 1) * travel,
    clamp(stalk.lookY, -1, 1) * travel * open,
    inner * 0.46 * clamp(stalk.pupil, 0.3, 1.3),
    0,
    Math.PI * 2,
  );
  ctx.fillStyle = frame.pupil;
  ctx.fill();
  ctx.restore();
}
