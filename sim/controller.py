"""Drive controller for the bot: sit on the skid when stopped, balance on the wheels when moving.

Balancing uses an LQR gain computed from MuJoCo's own linearization (lqr.py).

Parked, the arms splay forward and the bot rests back on the skid under its
drum: three points, no balancing. To move, it stands up: the balance loop takes
over the wheels while the arms swing to vertical, which puts the wheels under
the drum and lifts it off the floor. It drives and turns balanced on two
wheels, like a Segway. To stop, it slows to a stand, then brakes the wheels and
swings the arms back out quickly, tipping back onto the skid. (No balanced pose
reaches the skid: splaying the arms while balanced tips the drum nose-down.)

States: sitting -> standing_up -> balancing -> sitting_down -> sitting.
"""

from __future__ import annotations

import enum
import math
from dataclasses import dataclass

import mujoco
import numpy as np

import bot
import lqr


class Mode(enum.Enum):
    SITTING = "sitting"
    STANDING_UP = "standing_up"
    BALANCING = "balancing"
    SITTING_DOWN = "sitting_down"


@dataclass
class Gains:
    max_accel: float = 0.6  # m/s², how fast the speed target ramps
    level: float = 0.3  # N·m per rad of drum pitch while standing up
    level_rate: float = 0.02
    hold: float = -1.0  # N·m per m of drift from the start while standing up
    hold_rate: float = -0.5  # N·m per m/s
    hold_yaw: float = 0.0  # N·m of steering per rad of heading drift while standing up (pinched wheels twist it)
    hold_yaw_rate: float = 0.0
    brake: float = 0.3  # N·m per rad/s of wheel speed while sitting down
    tip_back: float = 0.03  # N·m forward wheel nudge at the start of sitting down
    tip_back_s: float = 0.05


@dataclass
class Command:
    speed: float = 0.0  # m/s, forward positive
    turn_rate: float = 0.0  # rad/s, left positive
    move: bool = False  # True: stand up and drive; False: come to a stop and sit


class BotController:
    """One instance per simulated bot; call `update` every physics step."""

    STAND_UP_S = 1.5
    CATCH_LEAN = math.radians(50)
    PINCH_FRACTION = 0.35  # of the stand-up spent bracing before the lift
    PINCH_SPREAD = math.radians(45)  # how far apart the arms pinch (wider is stronger but starts to slip)
    SIT_DOWN_S = 0.8

    def __init__(self, model: mujoco.MjModel, gains: Gains | None = None) -> None:
        self.model = model
        self.gains = gains or Gains()
        self.spec = bot.BotSpec()
        self.mode = Mode.SITTING
        self.mode_since = 0.0
        self.speed_target = 0.0
        self._arm = [bot.actuator_index(model, "arm_left"), bot.actuator_index(model, "arm_right")]
        self._wheel = [bot.actuator_index(model, "wheel_left"), bot.actuator_index(model, "wheel_right")]
        self._body = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY, "bot")
        self._arm_joint = [mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_JOINT, f"arm_{s}") for s in ("left", "right")]
        self._wheel_joint = [mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_JOINT, f"wheel_{s}") for s in ("left", "right")]
        self._start: tuple[float, float] | None = None
        self._start_yaw: float | None = None
        self._wheels = [
            mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY, "wheel_left"),
            mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY, "wheel_right"),
        ]
        self._torque = self.spec.wheel_motor.torque
        self._pose = lqr.balance_pose(model)
        self._k = lqr.lqr_gain(model, self._pose, self._wheel)
        self._ref: lqr.Reference | None = None

    # -- state estimates ---------------------------------------------------
    def pitch(self, data: mujoco.MjData) -> float:
        """Forward lean in radians: positive is nose down."""
        r = data.xmat[self._body].reshape(3, 3)
        return math.asin(max(-1.0, min(1.0, -r[2, 0])))

    def lean(self, data: mujoco.MjData) -> float:
        """How far the whole bot's center of mass sits ahead of the wheel axle, as an angle: positive is falling forward.

        Balancing on this rather than the drum's pitch accounts for the battery sitting forward in the drum.
        """
        r = data.xmat[self._body].reshape(3, 3)
        heading = np.array([r[0, 0], r[1, 0], 0.0])
        norm = np.linalg.norm(heading)
        heading = heading / norm if norm > 1e-6 else np.array([1.0, 0.0, 0.0])
        axle = (data.xpos[self._wheels[0]] + data.xpos[self._wheels[1]]) / 2
        offset = data.subtree_com[self._body] - axle
        return math.atan2(float(np.dot(offset, heading)), float(offset[2]))

    def pitch_rate(self, data: mujoco.MjData) -> float:
        """Rate about the body's lateral axis, nose-down positive."""
        r = data.xmat[self._body].reshape(3, 3)
        return float(np.dot(data.qvel[3:6], r[:, 1]))

    def forward_speed(self, data: mujoco.MjData) -> float:
        r = data.xmat[self._body].reshape(3, 3)
        heading = np.array([r[0, 0], r[1, 0], 0.0])
        norm = np.linalg.norm(heading)
        return float(np.dot(data.qvel[0:3], heading / norm)) if norm > 1e-6 else 0.0

    def yaw_rate(self, data: mujoco.MjData) -> float:
        return float(data.qvel[5])

    # -- control -----------------------------------------------------------
    def _enter(self, mode: Mode, now: float) -> None:
        self.mode = mode
        self.mode_since = now

    def update(self, data: mujoco.MjData, command: Command) -> None:
        now = data.time
        elapsed = now - self.mode_since
        splay = -self.spec.dims.arm_swing

        if self.mode is Mode.SITTING:
            self._set_arms(data, splay)
            self._set_wheels(data, 0.0, 0.0)
            if command.move:
                self._start = None
                self._enter(Mode.STANDING_UP, now)
            return

        if self.mode is Mode.STANDING_UP:
            k = min(1.0, elapsed / self.STAND_UP_S)
            # Pinch first: one arm swings forward and the other back, so the wheels straddle the drum and it cannot roll
            # away from the arm motors. Then both arms come up together and lever the drum onto its wheels.
            pinch = 1.0 if self.PINCH_FRACTION <= 0 else min(1.0, k / self.PINCH_FRACTION)
            lift = _ease(max(0.0, (k - self.PINCH_FRACTION) / (1 - self.PINCH_FRACTION)))
            spread = self.PINCH_SPREAD * pinch * (1 - lift)
            self._set_arms(data, splay * (1 - lift) + spread, splay * (1 - lift) - spread)
            if abs(self.lean(data)) < self.CATCH_LEAN:
                self._balance(data, 0.0, 0.0)
            else:
                self._ref = None
                self.speed_target = 0.0
                self._level_while_rising(data)
            if k >= 1.0:
                self._enter(Mode.BALANCING, now)
            return

        if self.mode is Mode.BALANCING:
            self._set_arms(data, 0.0)
            wanted = command.speed if command.move else 0.0
            self._balance(data, wanted, command.turn_rate if command.move else 0.0)
            settled = abs(self.speed_target) < 0.02 and abs(self.forward_speed(data)) < 0.05
            if not command.move and settled:
                self._start = None
                self._enter(Mode.SITTING_DOWN, now)
            return

        if self.mode is Mode.SITTING_DOWN:
            k = min(1.0, elapsed / self.SIT_DOWN_S)
            self._set_arms(data, splay * _ease(k))
            # Sitting means tipping back onto the skid, which no balanced pose reaches (splaying the arms while balanced
            # just tips the drum nose-down over the wheels). So stop balancing, brake the wheels, and let the slow arm
            # swing settle it back onto the skid.
            self._ref = None
            if elapsed < self.gains.tip_back_s:
                # A quick forward shove on the wheels pulls the base out from under the drum so it always tips back.
                self._set_wheels(data, self.gains.tip_back, self.gains.tip_back)
            else:
                self._brake(data)
            if k >= 1.0:
                self._enter(Mode.SITTING, now)
            return

    def _balance(self, data: mujoco.MjData, speed: float, turn_rate: float) -> None:
        """LQR on the wheels around the balanced pose, tracking a reference that moves with the command."""
        g = self.gains
        dt = self.model.opt.timestep
        if self._ref is None:
            r = data.xmat[self._body].reshape(3, 3)
            self._ref = lqr.Reference(float(data.qpos[0]), float(data.qpos[1]), math.atan2(r[1, 0], r[0, 0]))
        ref = self._ref
        step = g.max_accel * dt
        ref.speed += max(-step, min(step, speed - ref.speed))
        ref.turn_rate = turn_rate
        ref.yaw += turn_rate * dt
        ref.x += ref.speed * math.cos(ref.yaw) * dt
        ref.y += ref.speed * math.sin(ref.yaw) * dt
        self.speed_target = ref.speed
        u = -self._k @ lqr.state_error(self.model, data, self._pose, ref)
        self._set_wheels(data, float(u[0]), float(u[1]))

    def _level_while_rising(self, data: mujoco.MjData) -> None:
        g = self.gains
        level, level_rate, hold, hold_rate = g.level, g.level_rate, g.hold, g.hold_rate
        if self._start is None:
            self._start = (float(data.qpos[0]), float(data.qpos[1]))
            self._start_yaw = None
        r = data.xmat[self._body].reshape(3, 3)
        heading = np.array([r[0, 0], r[1, 0]])
        norm = np.linalg.norm(heading)
        heading = heading / norm if norm > 1e-6 else np.array([1.0, 0.0])
        drift = float(np.dot(data.qpos[0:2] - np.array(self._start), heading))
        torque = (
            level * self.pitch(data)
            + level_rate * self.pitch_rate(data)
            + hold * drift
            + hold_rate * self.forward_speed(data)
        )
        # Pinched, one wheel is ahead of the other, so equal torques twist the bot; steer to hold the starting heading.
        yaw = math.atan2(r[1, 0], r[0, 0])
        if self._start_yaw is None:
            self._start_yaw = yaw
        yaw_error = math.atan2(math.sin(yaw - self._start_yaw), math.cos(yaw - self._start_yaw))
        steer = g.hold_yaw * yaw_error + g.hold_yaw_rate * float(data.qvel[5])
        self._set_wheels(data, torque + steer, torque - steer)

    def _brake(self, data: mujoco.MjData) -> None:
        g = self.gains
        speeds = [data.qvel[self.model.jnt_dofadr[j]] for j in self._wheel_joint]
        self._set_wheels(data, -g.brake * speeds[0], -g.brake * speeds[1])

    def _set_arms(self, data: mujoco.MjData, left: float, right: float | None = None) -> None:
        data.ctrl[self._arm[0]] = left
        data.ctrl[self._arm[1]] = left if right is None else right

    def _set_wheels(self, data: mujoco.MjData, left: float, right: float) -> None:
        data.ctrl[self._wheel[0]] = max(-self._torque, min(self._torque, left))
        data.ctrl[self._wheel[1]] = max(-self._torque, min(self._torque, right))


def _ease(k: float) -> float:
    return 0.5 - 0.5 * math.cos(math.pi * max(0.0, min(1.0, k)))
