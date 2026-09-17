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
  /** Lean of the upper lid. Negative drops the inner corner (angry, skeptic). */
  readonly topTilt: number;
  /** Lean of the lower lid. */
  readonly bottomTilt: number;
  /**
   * Bow of the lower lid, independent of its lean. Positive arcs it upward
   * into the eye, which is what a smile actually does; a lean alone only ever
   * reads as a smirk.
   */
  readonly bottomCurve: number;
  /** Bow of the upper lid. Positive arcs it downward into the eye. */
  readonly topCurve: number;
  readonly skew: number;
};

/**
 * Eye shapes, tuned wide.
 *
 * A display eye reads as a lens: wider than it is tall, filling most of its
 * box. `topTilt` / `bottomTilt` are the expression -- they raise one corner and
 * drop the other, and mirrored across a pair they angle the eyes toward each
 * other (angry) or away (worried). `openness` is lid only, so a blink never
 * changes which expression is being worn.
 */
export const EYE_SHAPES: Record<EyeShapeName, EyeShape> = {
  normal: { openness: 1, width: 0.94, height: 0.72, topTilt: 0, bottomTilt: 0, bottomCurve: 0, topCurve: 0, skew: 0 },
  // A smile is the lower lid bowing up into the eye, symmetric, not a lean.
  happy: { openness: 0.9, width: 0.94, height: 0.72, topTilt: 0, bottomTilt: 0, bottomCurve: 0.78, topCurve: 0, skew: 0 },
  // Worry raises the inner corner of the upper lid.
  worried: { openness: 0.88, width: 0.94, height: 0.68, topTilt: 0.22, bottomTilt: 0, bottomCurve: 0, topCurve: 0, skew: 0.02 },
  worriedAlt: { openness: 0.88, width: 0.94, height: 0.68, topTilt: -0.22, bottomTilt: 0, bottomCurve: 0, topCurve: 0, skew: -0.02 },
  // Focus is a flat narrowing: both lids in, no lean.
  focused: { openness: 0.54, width: 0.96, height: 0.66, topTilt: 0, bottomTilt: 0, bottomCurve: 0, topCurve: 0, skew: 0 },
  sleepy: { openness: 0.26, width: 0.92, height: 0.62, topTilt: -0.05, bottomTilt: 0, bottomCurve: 0, topCurve: 0.15, skew: 0 },
  sleepyAlt: { openness: 0.26, width: 0.92, height: 0.62, topTilt: 0.05, bottomTilt: 0, bottomCurve: 0, topCurve: 0.15, skew: 0 },
  // Anger drops the inner corner of the upper lid hard.
  angry: { openness: 0.84, width: 0.96, height: 0.7, topTilt: -0.3, bottomTilt: 0, bottomCurve: 0, topCurve: 0, skew: 0 },
  surprised: { openness: 1, width: 0.88, height: 0.96, topTilt: 0, bottomTilt: 0, bottomCurve: 0, topCurve: 0, skew: 0 },
  // Skeptic is the asymmetric one: this eye narrows, the other stays open.
  skeptic: { openness: 0.46, width: 0.94, height: 0.68, topTilt: -0.16, bottomTilt: 0, bottomCurve: 0, topCurve: 0.1, skew: -0.02 },
  skepticAlt: { openness: 0.9, width: 0.94, height: 0.68, topTilt: 0.12, bottomTilt: 0, bottomCurve: 0, topCurve: 0, skew: 0.02 },
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
    bottomCurve: from.bottomCurve + (to.bottomCurve - from.bottomCurve) * k,
    topCurve: from.topCurve + (to.topCurve - from.topCurve) * k,
    skew: from.skew + (to.skew - from.skew) * k,
  };
}

/** Scale openness only, so a blink keeps the expression's shape. */
export function withOpenness(shape: EyeShape, scale: number): EyeShape {
  const k = scale < 0 ? 0 : scale > 1 ? 1 : scale;
  return { ...shape, openness: shape.openness * k };
}
