export { BOT_FACE_TAG, BotFaceElement, defineBotFaceElement } from "./bot-face.ts";
export { Eye, LID_MS, startEye } from "./eye.ts";
export { Face, startFace } from "./face-machine.ts";
export { Gaze, startGaze, TRACK_HOLD_MS } from "./gaze.ts";
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
export { BOT_CRITTER_TAG, BotCritterElement, defineBotCritterElement } from "./bot-critter.ts";
export { CRITTER_POSES, DEFAULT_GEOMETRY, drawCritter, shade, stepSpring, type CritterFrame, type CritterGeometry, type CritterHits, type CritterPose, type Spring, type StalkFrame, type StalkPose } from "./critter.ts";
export { Drive, ROLL_MS, SPIN_MS, startDrive, type DriveView } from "./drive.ts";
export { FED_UP_POKES, FED_UP_WINDOW_MS, Reaction, startReaction, type PokeTarget } from "./reaction.ts";
