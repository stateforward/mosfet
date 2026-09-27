"""The whole bot in its docked (parked) pose, sitting on the charging dock."""

from __future__ import annotations

from build123d import Compound, Pos, Rot

from . import body as B
from . import part as C
from .audio import amp_ref, mic_ref, speaker_ref
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
    BMS,
    DRUM_L,
    EYE,
    JETSON_BOARD,
    JETSON_H,
    MDD10A,
    STALK,
    EyeSpec,
    StalkSpec,
    docked_pose,
)
from .part import Part
from .stalk import stalk_parts
from .winch import winch_parts


def _ref(name: str, shape, color=C.REF) -> Part:
    return Part(f"REF {name}", shape, color, printed=False)


def battery_pack():
    """The 4S pack's cells (reference), one cylinder each, lying along x."""
    r = BATTERY.cell.d / 2
    return Compound(children=[cyl((x0 + 0.75, y, z), (x1 - 0.75, y, z), r) for x0, x1, y, z in BATTERY.cells()])


def electronics() -> list[Part]:
    bx, by = JETSON_BOARD
    x0, z0 = B.JETSON_X0, B.TRAY_Z[1] + 5
    t = B.TRAY_Z[1]  # tray top
    dx0, dx1 = B.DRIVER_X
    return [
        _ref(
            "Jetson Orin Nano Super dev kit",
            box((x0, -by / 2, z0), (x0 + bx, by / 2, z0 + 1.6)).fuse(box((x0 + 15, -35, z0 + 1.6), (x0 + 85, 35, z0 + JETSON_H))),
        ),
        _ref(BATTERY.name, battery_pack(), (0.2, 0.35, 0.75)),
        _ref("4S BMS", box((40, 16, t), (40 + BMS[0], 16 + BMS[1], t + BMS[2]))),
        _ref("Cytron MDD10A", box((dx0 - 16, -MDD10A[0] / 2, B.DRIVER_Z[0]), (dx0, MDD10A[0] / 2, B.DRIVER_Z[0] + MDD10A[1]))),
        _ref("Waveshare bus servo adapter", box((dx1, 25, -31), (dx1 + 10, 58, 1))),
        _ref("Pololu D24V150F12 (12 V servo bus)", box((38, -62, t), (81, -30, t + 11))),
        _ref("Pololu D36V50F5 (5 V logic)", box((38, -28, t), (63.4, -2.6, t + 8))),
        _ref("CC/CV charge module", box((64, -11.5, t), (103, 11.5, t + 18))),
        _ref("Teensy 4.1", box((-31, -30.5, B.SHELF_Z[1]), (-13, 30.5, B.SHELF_Z[1] + 4))),
        _ref("BNO085", box((-10.8, -11.35, B.SHELF_Z[1]), (14.8, 11.35, B.SHELF_Z[1] + 4.6))),
        _ref("Adafruit 3968 speaker, 40 mm 4 ohm", speaker_ref(), (0.15, 0.15, 0.15)),
        _ref("Adafruit PAM8302A amp", amp_ref()),
        _ref("Seeed reSpeaker Lite mic array", mic_ref()),
    ]


def side_parts(side: int, s: StalkSpec, e: EyeSpec, swing: float, refs: bool) -> list[Part]:
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

    stalk, tip_top = stalk_parts(s, B.stalk_root(side), f"{tag} ")  # straight up the splayed pedestal: no bend at rest
    parts += stalk
    parts += eye_parts(e, s, tip_top, side, f"{tag} ", refs)

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
        Part("battery cradle", B.cradle(beta), C.INNER),
        Part("driver mount", B.driver_mount(), C.INNER),
    ]
    if refs:
        parts += electronics()
        parts += [_ref(f"brass pad {n}", shape, C.METAL) for n, shape in B.pads(beta)]
    for side in (1, -1):
        parts += side_parts(side, s, e, swing, refs)  # docked, the whole bot (eyes too) pitches back pose["tilt"]
    parts += winch_parts(B.stalk_root, refs)

    world = Pos(0, 0, pose["axis_z"]) * rot_xz(pose["tilt"])
    parts = [p.placed(world) for p in parts]
    if dock:
        parts += [p for p in dock_parts(pose["wheel_x"]) if refs or p.printed]
    return parts
