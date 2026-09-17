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
  /** Corner radius as a fraction of the eye's smaller side; 0.5 is fully round. */
  readonly roundness: number;
};

export const EYE_SHAPES: Record<EyeShapeName, EyeShape> = {
  normal: { openness: 1, width: 0.62, height: 0.78, topTilt: 0, bottomTilt: 0, skew: 0, roundness: 0.34 },
  happy: { openness: 1, width: 0.7, height: 0.34, topTilt: 0, bottomTilt: -0.35, skew: 0, roundness: 0.5 },
  worried: { openness: 1, width: 0.62, height: 0.62, topTilt: -0.3, bottomTilt: 0, skew: 0.02, roundness: 0.3 },
  worriedAlt: { openness: 1, width: 0.62, height: 0.58, topTilt: -0.24, bottomTilt: 0, skew: -0.02, roundness: 0.3 },
  focused: { openness: 1, width: 0.72, height: 0.4, topTilt: 0.06, bottomTilt: 0, skew: 0, roundness: 0.28 },
  sleepy: { openness: 1, width: 0.66, height: 0.24, topTilt: 0.04, bottomTilt: 0, skew: 0, roundness: 0.45 },
  sleepyAlt: { openness: 1, width: 0.66, height: 0.3, topTilt: 0.08, bottomTilt: 0, skew: 0, roundness: 0.45 },
  angry: { openness: 1, width: 0.68, height: 0.56, topTilt: 0.32, bottomTilt: 0, skew: 0, roundness: 0.22 },
  surprised: { openness: 1, width: 0.84, height: 0.84, topTilt: 0, bottomTilt: 0, skew: 0, roundness: 0.5 },
  skeptic: { openness: 1, width: 0.66, height: 0.34, topTilt: 0.1, bottomTilt: 0, skew: 0, roundness: 0.3 },
  skepticAlt: { openness: 1, width: 0.62, height: 0.76, topTilt: -0.08, bottomTilt: 0, skew: 0, roundness: 0.34 },
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
    roundness: from.roundness + (to.roundness - from.roundness) * k,
  };
}

/** Scale openness only, so a blink keeps the expression's shape. */
export function withOpenness(shape: EyeShape, scale: number): EyeShape {
  const k = scale < 0 ? 0 : scale > 1 ? 1 : scale;
  return { ...shape, openness: shape.openness * k };
}
