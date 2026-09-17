export type EyeSide = "left" | "right";

export type ExpressionName =
  | "normal"
  | "happy"
  | "worried"
  | "focused"
  | "sleepy"
  | "angry"
  | "surprised"
  | "skeptic";

export type EyeShapeName =
  | "normal"
  | "happy"
  | "worried"
  | "worriedAlt"
  | "focused"
  | "sleepy"
  | "sleepyAlt"
  | "angry"
  | "surprised"
  | "skeptic"
  | "skepticAlt";

/**
 * One eye's drawn geometry.
 *
 * `openness` scales height and is what a blink drives to zero; the rest is
 * expression shape. All values are unitless ratios of the host box.
 */
export type EyeShape = {
  readonly openness: number;
  readonly width: number;
  readonly height: number;
  readonly topTilt: number;
  readonly bottomTilt: number;
  readonly skew: number;
};

export const EYE_SHAPES: Record<EyeShapeName, EyeShape> = {
  normal: { openness: 0.86, width: 0.68, height: 0.58, topTilt: 0, bottomTilt: 0, skew: 0 },
  happy: { openness: 0.44, width: 0.7, height: 0.46, topTilt: -0.14, bottomTilt: 0.18, skew: 0 },
  worried: { openness: 0.62, width: 0.68, height: 0.52, topTilt: 0.18, bottomTilt: -0.08, skew: 0.04 },
  worriedAlt: { openness: 0.62, width: 0.68, height: 0.52, topTilt: -0.18, bottomTilt: 0.08, skew: -0.04 },
  focused: { openness: 0.52, width: 0.74, height: 0.42, topTilt: 0, bottomTilt: 0, skew: 0 },
  sleepy: { openness: 0.34, width: 0.72, height: 0.36, topTilt: -0.05, bottomTilt: 0.1, skew: 0 },
  sleepyAlt: { openness: 0.34, width: 0.72, height: 0.36, topTilt: 0.05, bottomTilt: -0.1, skew: 0 },
  angry: { openness: 0.5, width: 0.74, height: 0.42, topTilt: 0.22, bottomTilt: -0.08, skew: 0 },
  surprised: { openness: 1, width: 0.64, height: 0.76, topTilt: 0, bottomTilt: 0, skew: 0 },
  skeptic: { openness: 0.5, width: 0.72, height: 0.44, topTilt: -0.18, bottomTilt: 0.06, skew: -0.04 },
  skepticAlt: { openness: 0.5, width: 0.72, height: 0.44, topTilt: 0.18, bottomTilt: -0.06, skew: 0.04 },
};

/** An expression is an asymmetric pair: the two eyes are rarely the same shape. */
export const EXPRESSIONS: Record<ExpressionName, { readonly left: EyeShapeName; readonly right: EyeShapeName }> = {
  normal: { left: "normal", right: "normal" },
  happy: { left: "happy", right: "happy" },
  worried: { left: "worriedAlt", right: "worried" },
  focused: { left: "focused", right: "focused" },
  sleepy: { left: "sleepyAlt", right: "sleepy" },
  angry: { left: "angry", right: "angry" },
  surprised: { left: "surprised", right: "surprised" },
  skeptic: { left: "skeptic", right: "skepticAlt" },
};

export function isExpressionName(value: unknown): value is ExpressionName {
  return typeof value === "string" && value in EXPRESSIONS;
}

export function isEyeShapeName(value: unknown): value is EyeShapeName {
  return typeof value === "string" && value in EYE_SHAPES;
}

export function parseExpression(value: string | null): ExpressionName {
  return isExpressionName(value) ? value : "normal";
}

export function parseEyeSide(value: string | null): EyeSide {
  return value === "left" ? "left" : "right";
}

/** Blend two shapes; `t` of 0 returns `from`, 1 returns `to`. */
export function blendShape(from: EyeShape, to: EyeShape, t: number): EyeShape {
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  return {
    openness: from.openness + (to.openness - from.openness) * k,
    width: from.width + (to.width - from.width) * k,
    height: from.height + (to.height - from.height) * k,
    topTilt: from.topTilt + (to.topTilt - from.topTilt) * k,
    bottomTilt: from.bottomTilt + (to.bottomTilt - from.bottomTilt) * k,
    skew: from.skew + (to.skew - from.skew) * k,
  };
}

/** Scale openness only, so a blink keeps the expression's shape. */
export function withOpenness(shape: EyeShape, scale: number): EyeShape {
  const k = scale < 0 ? 0 : scale > 1 ? 1 : scale;
  return { ...shape, openness: shape.openness * k };
}
