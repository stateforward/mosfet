"""The whole bot in its docked (parked) pose, sitting on the charging dock."""

from __future__ import annotations

from build123d import Location, Pos, Rot

from . import body as B
from . import part as C
from .dock import dock_parts
from .eye import eye_parts
from .geom import box, cyl, rot_xz
from .params import (
    ARM_PIVOT,
    ARM_SWING,
    BATTERY,
    BEARING_ID,
    BEARING_OD,
    BEARING_W,
    BOSS_Z,
    DOCK_H,
    DRUM_L,
    EYE,
    JETSON_BOARD,
    JETSON_H,
    MDD10A,
    STALK,
    STALK_SPREAD,
    EyeSpec,
    StalkSpec,
    docked_pose,
)
from .part import Part
from .stalk import pod_parts, stalk_parts


def _ref(name: str, shape, color=C.REF) -> Part:
    return Part(f"REF {name}", shape, color, printed=False)


def electronics() -> list[Part]:
    bx, by = JETSON_BOARD
    x0, z0 = B.JETSON_X0, B.TRAY_Z[1] + 5
    (b0, b1) = B.BATTERY_BOX
    return [
        _ref(
            "Jetson Orin Nano Super dev kit",
            box((x0, -by / 2, z0), (x0 + bx, by / 2, z0 + 1.6)).fuse(box((x0 + 15, -35, z0 + 1.6), (x0 + 85, 35, z0 + JETSON_H))),
        ),
        _ref(f"4S1P 21700 pack {BATTERY[1]:.0f}x{BATTERY[0]:.0f}x{BATTERY[2]}", box(b0, b1)),
        _ref("Cytron MDD10A", box((-81, -MDD10A[0] / 2, -62), (-65, MDD10A[0] / 2, -62 + MDD10A[1]))),
        _ref("Pololu D24V150F12 (12 V servo bus)", box((52, -56, -66), (84, -13, -55))),
        _ref("Pololu D36V50F5 (5 V logic)", box((55, -10, -66), (80.4, 15.4, -58))),
        _ref("CC/CV charge module", box((52, 18, -66), (75, 57, -48))),
        _ref("Teensy 4.1", box((-40, 5, -15), (21, 23, -11))),
        _ref("BNO085", box((-12.8, -30, -15), (12.8, -7.3, -10.4))),
        _ref("Waveshare bus servo adapter", box((-46, -37, -15), (-14, -4, -5))),
    ]


def side_parts(side: int, s: StalkSpec, e: EyeSpec, swing: float, lean: float, bend: float, level: float, refs: bool) -> list[Part]:
    tag = "L" if side > 0 else "R"
    arm_loc = Pos(0, 0, ARM_PIVOT) * rot_xz(swing)
    parts = [
        Part(f"end cap {tag}", B.end_cap(side), C.SHELL),
        Part(f"arm inner {tag}", B.arm_inner(side), C.ARM, arm_loc, print_pose=Rot(-side * 90, 0, 0) * Rot(0, 0, 0)),
        Part(f"arm outer {tag}", B.arm_outer(side), C.ARM, arm_loc),
        Part(f"wheel rim {tag}", B.wheel_rim(side), C.RIM, arm_loc),
        Part(f"tire {tag}", B.tire(side), C.TIRE, arm_loc, material="TPU 95A"),
        Part(f"arm gear {tag}", B.arm_gear(side), C.INNER),
        Part(f"arm pinion {tag}", B.pinion(side), C.INNER),
        Part(f"arm servo mount {tag}", B.arm_servo_mount(side), C.INNER),
    ]
    # Arms lie flat and diagonal on the bed; the motor sleeve points up.
    parts[1].print_pose = Rot(0, 0, 45) * Rot(-side * 90, 0, 0)
    parts[2].print_pose = Rot(0, 0, 45) * Rot(side * 90, 0, 0)
    parts[3].print_pose = Rot(side * 90, 0, 0)
    parts[4].print_pose = Rot(side * 90, 0, 0)
    for i in (5, 6, 7):
        parts[i].print_pose = Rot(side * 90, 0, 0)
    parts[0].print_pose = Rot(side * 90, 0, 0)

    pod_loc = Pos(B.POD_CENTRE[0], side * B.POD_CENTRE[1], B.POD_CENTRE[2]) * (Location() if side > 0 else Rot(0, 0, 180))
    parts += pod_parts(pod_loc, f"{tag} ", refs)

    root = Pos(50, side * STALK_SPREAD, BOSS_Z)  # the base plate sits flat on its pedestal; the joints do the leaning
    stalk, tip_top = stalk_parts(s, root, -side * (lean + bend), level, f"{tag} ")
    parts += stalk
    parts += eye_parts(e, tip_top, side, f"{tag} ", refs)

    if refs:
        parts += [
            _ref(f"STS3250 arm servo {tag}", B.arm_servo_box(side)),
            _ref(f"Pololu 37D 50:1 motor {tag}", B.motor_ref(side), (0.6, 0.6, 0.62)).placed(arm_loc),
        ]
        for k, y in enumerate((DRUM_L / 2 - BEARING_W, DRUM_L / 2 - 22)):
            ring = cyl((0, side * y, ARM_PIVOT), (0, side * (y + BEARING_W), ARM_PIVOT), BEARING_OD / 2).cut(
                cyl((0, side * (y - 1), ARM_PIVOT), (0, side * (y + BEARING_W + 1), ARM_PIVOT), BEARING_ID / 2)
            )
            parts.append(_ref(f"6805-2RS {tag}{k + 1}", ring, C.METAL))
    return parts


def bot(
    s: StalkSpec = STALK,
    e: EyeSpec = EYE,
    swing: float = ARM_SWING,
    lean: float = 4.0,
    bend: float = 8.0,
    refs: bool = True,
    dock: bool = True,
) -> list[Part]:
    pose = docked_pose(swing)
    beta = pose["beta"]
    parts = [
        Part("drum upper", B.shell_upper(), C.SHELL, print_pose=Rot(0, 0, 0)),
        Part("drum lower", B.shell_lower(beta), C.SHELL, print_pose=Rot(180, 0, 0)),
        Part("skid", B.skid(beta), C.INNER, print_pose=Rot(0, -(beta + 90), 0) * Rot(180, 0, 0)),
        Part("tray", B.tray(), C.INNER),
        Part("electronics shelf", B.shelf(), C.INNER),
        Part("battery sling", B.sling(), C.INNER),
        Part("driver mount", B.driver_mount(), C.INNER),
    ]
    if refs:
        parts += electronics()
        parts += [_ref(f"brass pad {n}", shape, C.METAL) for n, shape in B.pads(beta)]
    for side in (1, -1):
        parts += side_parts(side, s, e, swing, lean, bend, pose["tilt"], refs)  # stalks bend forward to level the eyes

    world = Pos(0, 0, pose["axis_z"] + DOCK_H) * rot_xz(pose["tilt"])
    parts = [p.placed(world) for p in parts]
    if dock:
        parts += [p for p in dock_parts(pose["wheel_x"]) if refs or p.printed]
    return parts
