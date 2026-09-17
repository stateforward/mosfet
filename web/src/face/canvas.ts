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
 * Draw one eye as a closed bezier lid pair.
 *
 * `shape.openness` collapses the vertical span, so a blink is the same path
 * with a smaller height rather than a different drawing.
 */
export function drawEye(args: {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  shape: EyeShape;
  side: EyeSide;
  fill: CanvasPaint;
}): void {
  const { ctx, width, height, shape, side, fill } = args;

  // The box is the eye. Fill it: a display eye reads as a lens, not a dot
  // floating in space.
  const eyeWidth = width * clamp(shape.width, 0.1, 1);
  const eyeHeight = height * clamp(shape.height, 0.05, 1);
  const lid = clamp(shape.openness, 0, 1);

  const centerX = width / 2 + (side === "left" ? -shape.skew : shape.skew) * width;
  const centerY = height / 2;
  const halfW = eyeWidth / 2;
  const halfH = eyeHeight / 2;
  const left = centerX - halfW;
  const right = centerX + halfW;

  // Tilts raise one corner and drop the other: that asymmetry is the whole
  // expression. Mirror them so a pair angles toward or away from each other.
  const sign = side === "left" ? -1 : 1;
  const topTilt = sign * shape.topTilt * eyeHeight;
  const bottomTilt = sign * shape.bottomTilt * eyeHeight;

  // Lids close toward the middle from both directions, so a blink keeps the
  // pupil line centered instead of sliding the shape upward.
  const openHalf = halfH * lid;

  // A lid may lean, but it may never cross the far lid: past that the two
  // curves swap sides and the eye renders as a bowtie. Clamp each corner to
  // leave a minimum aperture, which is what keeps a strong tilt reading as a
  // squint instead of a fold.
  const minGap = openHalf * 0.12;
  const lidY = (base: number, tilt: number, x: number, isTop: boolean): number => {
    const y = base + tilt * x;
    const limit = isTop ? centerY - minGap : centerY + minGap;
    return isTop ? Math.min(y, limit) : Math.max(y, limit);
  };
  const topAt = (x: number): number => lidY(centerY - openHalf, topTilt, x, true);
  const bottomAt = (x: number): number => lidY(centerY + openHalf, bottomTilt, x, false);

  // Rounded ends, but never so round that the tilt is sanded off.
  const radius = Math.min(halfW, openHalf) * 0.55;

  // Curvature bows a lid toward the eye's middle. The control points sit
  // beyond the endpoints, so a positive curve arcs the lid inward across its
  // whole span rather than kinking it at the center.
  const topBow = -openHalf * 0.22 + openHalf * shape.topCurve * 2.1;
  const bottomBow = openHalf * 0.18 - openHalf * shape.bottomCurve * 2.1;

  ctx.fillStyle = fill;
  ctx.beginPath();

  // Top lid: left corner -> right corner.
  ctx.moveTo(left + radius, topAt(-1));
  ctx.bezierCurveTo(
    centerX - halfW * 0.35, topAt(-0.35) + topBow,
    centerX + halfW * 0.35, topAt(0.35) + topBow,
    right - radius, topAt(1),
  );
  // Right end cap.
  ctx.quadraticCurveTo(right, topAt(1) + openHalf * 0.2, right, centerY);
  ctx.quadraticCurveTo(right, bottomAt(1) - openHalf * 0.2, right - radius, bottomAt(1));
  // Bottom lid: right corner -> left corner.
  ctx.bezierCurveTo(
    centerX + halfW * 0.35, bottomAt(0.35) + bottomBow,
    centerX - halfW * 0.35, bottomAt(-0.35) + bottomBow,
    left + radius, bottomAt(-1),
  );
  // Left end cap.
  ctx.quadraticCurveTo(left, bottomAt(-1) - openHalf * 0.2, left, centerY);
  ctx.quadraticCurveTo(left, topAt(-1) + openHalf * 0.2, left + radius, topAt(-1));

  ctx.closePath();
  ctx.fill();
}
