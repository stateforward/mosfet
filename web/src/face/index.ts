export { BOT_FACE_TAG, BotFaceElement, defineBotFaceElement } from "./bot-face.ts";
export { Eye, LID_MS, startEye } from "./eye.ts";
export { Face, startFace } from "./face-machine.ts";
export {
  blendShape,
  EXPRESSIONS,
  EYE_SHAPES,
  isExpressionName,
  isEyeShapeName,
  parseExpression,
  parseEyeSide,
  withOpenness,
  type ExpressionName,
  type EyeShape,
  type EyeShapeName,
  type EyeSide,
} from "./presets.ts";
export { clamp, drawEye, resizeCanvasToHost, type CanvasPaint } from "./canvas.ts";
