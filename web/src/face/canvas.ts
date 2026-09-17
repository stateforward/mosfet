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
  const eyeWidth = width * clamp(shape.width, 0.1, 0.95);
  const eyeHeight = height * clamp(shape.height * shape.openness, 0.02, 0.95);
  const centerX = width / 2 + (side === "left" ? -shape.skew : shape.skew) * width;
  const centerY = height / 2;
  const left = centerX - eyeWidth / 2;
  const right = centerX + eyeWidth / 2;
  const top = centerY - eyeHeight / 2;
  const bottom = centerY + eyeHeight / 2;
  const topTilt = (side === "left" ? -shape.topTilt : shape.topTilt) * eyeHeight;
  const bottomTilt = (side === "left" ? -shape.bottomTilt : shape.bottomTilt) * eyeHeight;
  const radius = Math.min(eyeWidth, eyeHeight) * 0.36;

  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(left + radius, top - topTilt);
  ctx.bezierCurveTo(
    centerX - eyeWidth * 0.22,
    top - topTilt - eyeHeight * 0.18,
    centerX + eyeWidth * 0.22,
    top + topTilt - eyeHeight * 0.18,
    right - radius,
    top + topTilt,
  );
  ctx.quadraticCurveTo(right, centerY, right - radius, bottom - bottomTilt);
  ctx.bezierCurveTo(
    centerX + eyeWidth * 0.22,
    bottom - bottomTilt + eyeHeight * 0.14,
    centerX - eyeWidth * 0.22,
    bottom + bottomTilt + eyeHeight * 0.14,
    left + radius,
    bottom + bottomTilt,
  );
  ctx.quadraticCurveTo(left, centerY, left + radius, top - topTilt);
  ctx.closePath();
  ctx.fill();
}
