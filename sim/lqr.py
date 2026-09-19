"""LQR balance controller for the bot standing on two wheels.

The bot is balanced when its whole center of mass sits over the wheel axle.
`balance_pose` finds that pose (arms vertical, drum pitched so the battery's
forward weight is over the wheels), MuJoCo linearizes the dynamics there
(`mjd_transitionFD`), and `lqr_gain` solves the discrete Riccati equation for
the wheel torques. The controller then tracks a reference that moves with the
drive command: position along the heading and yaw, so standing still holds its
spot and driving tracks speed and turn rate.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import mujoco
import numpy as np

import bot


def _set_pitch_quat(qpos: np.ndarray, pitch: float, yaw: float) -> None:
    """Free-joint quaternion for yaw about z then pitch about the body's y (nose down positive)."""
    cy, sy = math.cos(yaw / 2), math.sin(yaw / 2)
    cp, sp = math.cos(pitch / 2), math.sin(pitch / 2)
    # q = q_yaw * q_pitch, with q_pitch about +y (positive tips the nose down).
    qpos[3:7] = [cy * cp, -sy * sp, cy * sp, sy * cp]


def balance_pose(model: mujoco.MjModel, arm_angle: float = 0.0) -> np.ndarray:
    """qpos with the arms at `arm_angle`, wheels on the ground, and the center of mass over the axle."""
    data = mujoco.MjData(model)
    arm_q = [model.jnt_qposadr[mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_JOINT, f"arm_{s}")] for s in ("left", "right")]
    body = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY, "bot")
    wheels = [mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY, f"wheel_{s}") for s in ("left", "right")]
    wheel_r = bot.BotSpec().dims.wheel_radius

    def place(pitch: float) -> float:
        data.qpos[:] = 0
        data.qpos[arm_q] = arm_angle
        _set_pitch_quat(data.qpos, pitch, 0.0)
        data.qpos[2] = 0.3
        mujoco.mj_kinematics(model, data)
        mujoco.mj_comPos(model, data)
        axle = (data.xpos[wheels[0]] + data.xpos[wheels[1]]) / 2
        data.qpos[2] += wheel_r - axle[2]
        mujoco.mj_kinematics(model, data)
        mujoco.mj_comPos(model, data)
        axle = (data.xpos[wheels[0]] + data.xpos[wheels[1]]) / 2
        return float(data.subtree_com[body][0] - axle[0])

    lo, hi = -1.0, 1.0
    for _ in range(60):
        mid = (lo + hi) / 2
        if place(lo) * place(mid) <= 0:
            hi = mid
        else:
            lo = mid
    place((lo + hi) / 2)
    return data.qpos.copy()


def lqr_gain(model: mujoco.MjModel, qpos0: np.ndarray, wheel_actuators: list[int]) -> np.ndarray:
    """Wheel-torque gain K (2 x 2nv) so that u = -K * dx, with dx from `state_error`."""
    data = mujoco.MjData(model)
    data.qpos[:] = qpos0
    data.qvel[:] = 0
    data.ctrl[:] = 0
    mujoco.mj_forward(model, data)
    nv = model.nv
    a = np.zeros((2 * nv, 2 * nv))
    b_all = np.zeros((2 * nv, model.nu))
    mujoco.mjd_transitionFD(model, data, 1e-6, True, a, b_all, None, None)
    b = b_all[:, wheel_actuators]

    q = np.zeros(2 * nv)
    q[0:2] = 40.0  # x, y position
    q[3:5] = 400.0  # roll, pitch (free joint angular dofs 3..5)
    q[5] = 20.0  # yaw
    q[nv : nv + 3] = 4.0  # linear velocity
    q[nv + 3 : nv + 6] = 4.0  # angular velocity
    q[6:nv] = 0.01  # arms, wheels, stalk joints: barely care
    q[nv + 6 :] = 0.01
    r = np.eye(2) * 60.0
    qm = np.diag(q)

    p = qm.copy()
    for _ in range(5000):
        bt_p = b.T @ p
        k = np.linalg.solve(r + bt_p @ b, bt_p @ a)
        p_next = qm + a.T @ p @ (a - b @ k)
        if np.max(np.abs(p_next - p)) < 1e-9 * max(1.0, np.max(np.abs(p))):
            p = p_next
            break
        p = p_next
    bt_p = b.T @ p
    return np.linalg.solve(r + bt_p @ b, bt_p @ a)


@dataclass
class Reference:
    x: float
    y: float
    yaw: float
    speed: float = 0.0
    turn_rate: float = 0.0


def state_error(model: mujoco.MjModel, data: mujoco.MjData, qpos0: np.ndarray, ref: Reference) -> np.ndarray:
    """dx = [qpos - reference (tangent space), qvel - reference velocity]."""
    target = qpos0.copy()
    pitch0 = 2 * math.atan2(qpos0[5], qpos0[3])
    _set_pitch_quat(target, pitch0, ref.yaw)
    target[0], target[1] = ref.x, ref.y
    # Joints we don't balance on track themselves: arms and wheels at their current angles, stalks wherever they are.
    target[7:] = data.qpos[7:]
    dq = np.zeros(model.nv)
    mujoco.mj_differentiatePos(model, dq, 1.0, target, data.qpos)
    vref = np.zeros(model.nv)
    vref[0] = ref.speed * math.cos(ref.yaw)
    vref[1] = ref.speed * math.sin(ref.yaw)
    vref[5] = ref.turn_rate
    dv = data.qvel - vref
    dv[6:] = 0
    # The gain was computed facing +x. Express the free joint's linear position and velocity errors in the heading
    # frame so the same gain works whichever way the bot is facing. (Its angular parts are already in the body frame.)
    c, sn = math.cos(-ref.yaw), math.sin(-ref.yaw)
    for vec in (dq, dv):
        x, y = vec[0], vec[1]
        vec[0], vec[1] = c * x - sn * y, sn * x + c * y
    return np.concatenate([dq, dv])


@dataclass
class Schedule:
    """Balance poses and gains at a range of arm angles, blended by the current arm angle."""

    angles: np.ndarray
    poses: list[np.ndarray]
    gains: list[np.ndarray]

    @staticmethod
    def build(model: mujoco.MjModel, wheel_actuators: list[int], lowest: float, steps: int = 11) -> "Schedule":
        angles = np.linspace(0.0, lowest, steps)
        poses = [balance_pose(model, float(a)) for a in angles]
        return Schedule(angles, poses, [lqr_gain(model, p, wheel_actuators) for p in poses])

    def at(self, arm_angle: float) -> tuple[np.ndarray, np.ndarray]:
        """Pose and gain for `arm_angle`, linearly blended between the two nearest schedule points."""
        a = self.angles
        # angles run from 0 down to `lowest` (negative), so search on their magnitudes.
        x = min(max(abs(arm_angle), 0.0), abs(a[-1]))
        i = min(int(x / abs(a[1] - a[0])), len(a) - 2)
        t = (x - abs(a[i])) / abs(a[i + 1] - a[i])
        pose = self.poses[i] + (self.poses[i + 1] - self.poses[i]) * t
        pose[3:7] /= np.linalg.norm(pose[3:7])
        return pose, self.gains[i] + (self.gains[i + 1] - self.gains[i]) * t
