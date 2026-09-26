import { type EyeShape, type EyeSide } from "./presets.ts";

export type CanvasPaint = string;

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * Size `canvas` to its host box at device pixel ratio and return a reset 2D context.
 *
 * Returns null when the element has no layout box yet or 2D is unavailable.
 */
export function resizeCanvasToHost(
  canvas: HTMLCanvasElement,
  fallbackWidth: number,
  fallbackHeight: number,
): CanvasRenderingContext2D | null {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const ratio = Math.max(1, globalThis.devicePixelRatio || 1);
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width || fallbackWidth));
  const height = Math.max(1, Math.round(rect.height || fallbackHeight));
  const pixelWidth = Math.round(width * ratio);
  const pixelHeight = Math.round(height * ratio);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return ctx;
}

/**
 * Draw one eye as a rounded quad whose top and bottom lids are straight, tilted edges.
 *
 * Size is measured against the canvas's smaller side, so a surprised circle stays
 * a circle in a non-square host. Positive `topTilt` drops the lid toward the nose
 * (angry); negative raises it (worried). Positive `bottomTilt` raises the lower lid
 * toward the nose; negative arches both lower corners up into a smile.
 * `shape.openness` collapses height about the center, so a blink is the same shape
 * squeezed flat rather than a different drawing.
 */
export function drawEye(args: {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  shape: EyeShape;
  side: EyeSide;
  fill: CanvasPaint;
  /** Gaze offset in -1..1 of the eye's free travel inside its box. */
  lookX?: number;
  lookY?: number;
  /** Presentation squash and stretch; 1 is at rest. */
  scaleX?: number;
  scaleY?: number;
}): void {
  const { ctx, width, height, shape, side, fill } = args;
  const unit = Math.min(width, height);
  const eyeWidth = unit * clamp(shape.width * (args.scaleX ?? 1), 0.1, 0.98);
  const eyeHeight = Math.max(
    unit * 0.04,
    unit * clamp(shape.height * (args.scaleY ?? 1), 0.02, 0.98) * clamp(shape.openness, 0, 1),
  );
  // "Toward the nose" is +x for the left eye and -x for the right.
  const nose = side === "left" ? 1 : -1;
  // Travel is whatever room the eye leaves in its box, so a big surprised eye moves less and never clips.
  const travelX = Math.max(0, (width - eyeWidth) / 2 - 1);
  const travelY = Math.max(0, (height - eyeHeight) / 2 - 1);
  const centerX = width / 2 + nose * shape.skew * unit + clamp(args.lookX ?? 0, -1, 1) * travelX;
  const centerY = height / 2 + clamp(args.lookY ?? 0, -1, 1) * travelY;
  const left = centerX - eyeWidth / 2;
  const right = centerX + eyeWidth / 2;
  const top = centerY - eyeHeight / 2;
  const bottom = centerY + eyeHeight / 2;
  const topDrop = clamp(shape.topTilt, -0.9, 0.9) * eyeHeight;
  const bottomLift = clamp(shape.bottomTilt, -0.9, 0.9) * eyeHeight;

  // Lid corners, outer/inner relative to the nose.
  const noseX = nose > 0 ? right : left;
  const outerX = nose > 0 ? left : right;
  const topNose = { x: noseX, y: top + Math.max(0, topDrop) };
  const topOuter = { x: outerX, y: top + Math.max(0, -topDrop) };
  const smile = bottomLift < 0 ? -bottomLift : 0;
  const bottomNose = { x: noseX, y: bottom - Math.max(0, bottomLift) };
  const bottomOuter = { x: outerX, y: bottom };

  const corners = [topOuter, topNose, bottomNose, bottomOuter];
  const shortest = Math.min(eyeWidth, bottomNose.y - topNose.y, bottomOuter.y - topOuter.y);
  const radius = Math.max(0, shortest) * clamp(shape.roundness, 0, 0.5);

  ctx.fillStyle = fill;
  ctx.beginPath();
  const start = midpoint(corners[3]!, corners[0]!);
  ctx.moveTo(start.x, start.y);
  for (let i = 0; i < corners.length; i += 1) {
    const corner = corners[i]!;
    const next = corners[(i + 1) % corners.length]!;
    ctx.arcTo(corner.x, corner.y, next.x, next.y, radius);
  }
  ctx.closePath();
  if (smile <= 0) {
    ctx.fill();
    return;
  }
  // Bite an arch out of the bottom so the eye reads as a smiling, squinted lid.
  ctx.save();
  ctx.clip();
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.ellipse(centerX, bottom + eyeHeight * 0.1, eyeWidth * 0.56, smile * 1.6, 0, 0, Math.PI * 2);
  ctx.fill("evenodd");
  ctx.restore();
}

function midpoint(a: { x: number; y: number }, b: { x: number; y: number }): { x: number; y: number } {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
