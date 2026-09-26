"""Headless physics checks for the bot model.

Run: .venv/bin/python check.py

Each check simulates from the standing keyframe and asserts something a person
would see in the viewer: it sits on its skid, a pulled cable bends the stalk
toward it and releasing springs it back, it stands up onto its wheels and
balances, drives and turns balanced, sits back down, and swinging the arms
while sitting changes how far it leans. Exits non-zero if any
check fails.
"""

from __future__ import annotations

import math
import sys

import mujoco
import numpy as np

import bot


def step(model, data, seconds: float) -> None:  # type: ignore[no-untyped-def]
    for _ in range(int(seconds / model.opt.timestep)):
        mujoco.mj_step(model, data)
        if not np.all(np.isfinite(data.qpos)):
            raise AssertionError("simulation went unstable (non-finite qpos)")


def body_pos(model, data, name: str) -> np.ndarray:  # type: ignore[no-untyped-def]
    return data.xpos[mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY, name)].copy()


def tilt_deg(data) -> float:  # type: ignore[no-untyped-def]
    """Angle between the bot's up axis and world up."""
    w, x, y, z = data.qpos[3:7]
    up_z = 1 - 2 * (x * x + y * y)
    return math.degrees(math.acos(max(-1.0, min(1.0, up_z))))


def yaw_deg(data) -> float:  # type: ignore[no-untyped-def]
    w, x, y, z = data.qpos[3:7]
    return math.degrees(math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z)))


def fresh():  # type: ignore[no-untyped-def]
    model, data = bot.load()
    step(model, data, 1.5)
    return model, data


def ctrl(model, data, name: str, value: float) -> None:  # type: ignore[no-untyped-def]
    data.ctrl[bot.actuator_index(model, name)] = value


def check_stands() -> str:
    model, data = fresh()
    z = data.qpos[2]
    tilt = tilt_deg(data)
    assert z > bot.BotSpec().dims.drum_radius * 0.9, f"drum sank to z={z:.3f}"
    assert tilt < 35, f"tipped over: tilt {tilt:.1f} deg"
    step(model, data, 1.5)
    drift = abs(data.qpos[2] - z)
    assert drift < 0.005, f"still settling after 3 s: z moved {drift * 1000:.1f} mm"
    return f"stands at z={z * 100:.1f} cm, tilt {tilt:.1f} deg, steady"


def check_cable_bends_and_springs_back() -> str:
    model, data = fresh()
    tip0 = body_pos(model, data, "stalk_left_eye")
    # Cable 1 runs along the back of the stalk; pulling it should bend the eye backward (-x in the bot frame).
    ctrl(model, data, "stalk_left_cable1", -6.0)
    step(model, data, 1.0)
    tip1 = body_pos(model, data, "stalk_left_eye")
    moved = np.linalg.norm(tip1 - tip0)
    assert moved > 0.02, f"pulled cable only moved the eye {moved * 1000:.1f} mm"
    back = tip1[0] - tip0[0]
    assert back < -0.01, f"eye did not bend toward the pulled cable (dx={back * 1000:.1f} mm)"
    ctrl(model, data, "stalk_left_cable1", 0.0)
    step(model, data, 1.5)
    tip2 = body_pos(model, data, "stalk_left_eye")
    returned = np.linalg.norm(tip2 - tip0)
    assert returned < moved * 0.25, f"stalk did not spring back ({returned * 1000:.1f} mm off rest)"
    return f"cable pull moved eye {moved * 100:.1f} cm toward the cable; released, back within {returned * 1000:.1f} mm"


def drive_through(schedule, seconds: float, eyes: bool = True):  # type: ignore[no-untyped-def]
    """Run the drive controller (and optionally the eye demo's cable pulls) against `schedule(t) -> Command`."""
    from controller import BotController  # noqa: PLC0415
    from run import Demo  # noqa: PLC0415

    model, data = bot.load()
    demo = Demo(model)
    drive = BotController(model)
    modes: list[str] = []
    while data.time < seconds:
        if eyes:
            demo.update(data)  # moves the eyes (and drives its own controller, which we override next)
        drive.update(data, schedule(data.time))
        mujoco.mj_step(model, data)
        if not np.all(np.isfinite(data.qpos)):
            raise AssertionError("simulation went unstable (non-finite qpos)")
        if not modes or modes[-1] != drive.mode.value:
            modes.append(drive.mode.value)
    return model, data, drive, modes


def check_stands_up_and_balances() -> str:
    from controller import Command  # noqa: PLC0415

    model, data, drive, modes = drive_through(lambda t: Command(move=t > 0.5), 6.0)
    assert modes[-1] == "balancing", f"never got up: modes {modes}"
    z = data.qpos[2]
    assert z > bot.BotSpec().dims.drum_radius + 0.03, f"balancing but the drum is still low (z={z * 100:.1f} cm)"
    lean = abs(math.degrees(drive.lean(data)))
    assert lean < 5, f"center of mass is {lean:.1f} deg off the axle"
    return f"stood up ({' -> '.join(modes)}), drum up at {z * 100:.1f} cm, center of mass {lean:.1f} deg off the axle"


def check_drives_balanced() -> str:
    from controller import Command  # noqa: PLC0415

    model, data, drive, modes = drive_through(lambda t: Command(move=t > 0.5, speed=0.3 if t > 4.5 else 0.0), 8.0)
    assert drive.mode.value == "balancing", f"not balancing while driving: {modes}"
    speed = drive.forward_speed(data)
    assert 0.2 < speed < 0.45, f"asked for 0.3 m/s, going {speed:.2f}"
    return f"balancing on two wheels at {speed:.2f} m/s (asked 0.3)"


def check_turns_balanced() -> str:
    from controller import Command  # noqa: PLC0415

    model, data, drive, modes = drive_through(lambda t: Command(move=t > 0.5, turn_rate=1.2 if 4.5 < t < 7 else 0.0), 8.5)
    turned = abs(yaw_deg(data))
    assert drive.mode.value == "balancing", f"fell out of balancing while turning: {modes}"
    assert turned > 90, f"only turned {turned:.0f} deg"
    return f"turned {turned:.0f} deg while balancing"


def check_sits_back_down() -> str:
    from controller import Command  # noqa: PLC0415

    model, data, drive, modes = drive_through(lambda t: Command(move=0.5 < t < 6.5), 13.0)
    assert modes[-1] == "sitting" and "balancing" in modes, f"did not stand and sit: {modes}"
    pitch = math.degrees(drive.pitch(data))
    assert -35 < pitch < 5, f"sat down but ended pitched {pitch:.0f} deg (should lean back onto the skid)"
    return f"{' -> '.join(modes)}; resting back on the skid at {pitch:.0f} deg"


def check_arms_change_lean() -> str:
    model, data = fresh()
    tilt_splayed = tilt_deg(data)
    swing = bot.BotSpec().dims.arm_swing
    # Swing the arms partway back toward vertical: the wheels move under the drum and it leans further back onto its skid.
    # (Tucking them past the center of mass would tip it forward, just like the real thing.)
    ctrl(model, data, "arm_left", -swing * 0.7)
    ctrl(model, data, "arm_right", -swing * 0.7)
    step(model, data, 1.5)
    tilt_tucked = tilt_deg(data)
    assert abs(tilt_tucked - tilt_splayed) > 3, f"arm swing did not change the lean ({tilt_splayed:.1f} -> {tilt_tucked:.1f} deg)"
    assert tilt_tucked < 45, f"fell over tucking the arms: tilt {tilt_tucked:.1f} deg"
    return f"swinging the arms in changed the lean from {tilt_splayed:.1f} to {tilt_tucked:.1f} deg"


def check_eye_cameras_render() -> str:
    model, data = fresh()
    renderer = mujoco.Renderer(model, height=120, width=160)
    try:
        renderer.update_scene(data, camera="stalk_left_camera")
        pixels = renderer.render()
    finally:
        renderer.close()
    assert pixels.std() > 1, "left eye camera rendered a flat image"
    return f"left eye camera renders {pixels.shape[1]}x{pixels.shape[0]} (pixel spread {pixels.std():.0f})"


CHECKS = [
    check_stands,
    check_cable_bends_and_springs_back,
    check_stands_up_and_balances,
    check_drives_balanced,
    check_turns_balanced,
    check_sits_back_down,
    check_arms_change_lean,
    check_eye_cameras_render,
]


def main() -> int:
    failed = 0
    for check in CHECKS:
        name = check.__name__.removeprefix("check_").replace("_", " ")
        try:
            print(f"PASS  {name}: {check()}")
        except Exception as error:  # noqa: BLE001 - report every check, then fail
            failed += 1
            print(f"FAIL  {name}: {error}")
    print(f"\n{len(CHECKS) - failed}/{len(CHECKS)} checks passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
