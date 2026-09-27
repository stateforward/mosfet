"""Every dimension the CAD is driven by.

Character proportions come from `sim/bot.py` GEOMETRY (copied from web/src/face/critter.ts), scaled so the drum is
as big as the Bambu X1 allows. Bought-part dimensions carry their source in hardware/README.md; the ones marked
UNVERIFIED there are parameters here, so measure the part and change the number.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

# --- printer -------------------------------------------------------------------------------------------------------
BED = 256.0  # Bambu Lab X1 build volume, mm (cube)
BED_MARGIN = 3.0  # every printed part must fit BED - 2*margin on each axis

# --- character proportions (sim/bot.py GEOMETRY) -------------------------------------------------------------------
GEOMETRY = {
    "wheelRadius": 0.12,
    "wheelThickness": 0.85,
    "shellSize": 0.165,
    "shellLength": 0.21,
    "armSwing": 50.0,
    "armLength": 1.56,
    "armPivot": 0.38,
    "armWidth": 0.112,
    "stalkWidth": 0.034,
    "stalkSpread": 0.26,
}

DRUM_R = 118.0  # drum radius: 236 mm is the biggest round drum that prints in one piece on the X1
UNIT = DRUM_R / GEOMETRY["shellSize"]  # 715 mm: one "unit" of the 2D character
DRUM_L = round(UNIT * GEOMETRY["shellLength"])  # 150
WHEEL_R = round(UNIT * GEOMETRY["wheelRadius"])  # 86
WHEEL_W = round(WHEEL_R * GEOMETRY["wheelThickness"])  # 73
ARM_L = round(DRUM_R * GEOMETRY["armLength"])  # 184 pivot to axle
ARM_PIVOT = round(DRUM_R * GEOMETRY["armPivot"])  # 45 above the drum axis
ARM_W = round(UNIT * GEOMETRY["armWidth"])  # 80
ARM_T = round(ARM_W * 0.45)  # 36 plate thickness, printed as two 18 mm clamshell halves
ARM_SWING = GEOMETRY["armSwing"]  # parked/docked: degrees forward of straight down
STALK_SPREAD = round(DRUM_L * GEOMETRY["stalkSpread"])  # 39: stalk roots at y = +-39
STALK_ROOT_DEG = 25.0  # roots sit 25 degrees forward of the drum top

SHELL = 3.0  # drum wall
CAP_T = 8.0  # end cap thickness
SKID_T = 4.0  # skid proud of the drum
ARM_Y0 = DRUM_L / 2 + 1  # arm inner face, 1 mm outside the end cap
BOSS_Z = 117.0  # stalk pedestal top (drum frame): clears the drum crown behind the 44 mm base plate

# --- bought parts (see README BOM; UNVERIFIED ones are marked) -----------------------------------------------------
BEARING_OD, BEARING_ID, BEARING_W = 37.0, 25.0, 7.0  # 6805-2RS
BEARING_FIT = 0.05  # radial press allowance added to the pocket
MOTOR_D, MOTOR_L = 37.0, 70.0  # Pololu 37D 50:1 w/ encoder (#4753), gearbox face to encoder cap
MOTOR_SHAFT_L = 16.0
POLOLU_HUB_PCD = 19.0  # UNVERIFIED: Pololu 1083 hub bolt circle
SERVO_L, SERVO_W, SERVO_H = 45.2, 24.7, 35.0  # Feetech STS3215 / STS3250 case
SERVO_SHAFT_OFF = 11.0  # UNVERIFIED: output shaft centre from the near end of the case
HORN_PCD = 14.0  # UNVERIFIED: stock horn screw circle
JETSON_BOARD = (100.0, 79.0)  # carrier PCB, NVIDIA SP-11324-001
JETSON_HOLES = (86.0, 58.0)  # UNVERIFIED (scaled from the drawing)
JETSON_HOLE_INSET = 4.0  # UNVERIFIED: hole centres from the left and top board edges
JETSON_H = 35.0  # kit height incl. heatsink/fan
BATTERY = (75.0, 90.0, 22.8)  # Keeppower 4S1P 21700 6000 mAh w/ BMS, x, y, z (90 x 75 x 22.8)
MDD10A = (84.5, 62.0, 15.0)
POGO_D = 3.0  # UNVERIFIED: Mill-Max 0873 barrel press-fit diameter
POGO_PROUD = 1.5

# Charge contacts along the drum axis (y). Uneven gaps: no single-pitch shift can line up a wrong pair.
PADS = {"gnd": -35.0, "sense": -10.0, "vin": 30.0}
PAD_W = 12.0  # pad width along y (brass strip)

DOCK_H = 6.0  # dock plate thickness under the skid


@dataclass(frozen=True)
class StalkSpec:
    """Loc-Line style ball-and-socket stalk. All mm."""

    length: float = 170.0  # base plate to tip top, drawing ratio (unit x 0.24)
    ball_dia: float = 20.0
    pitch: float = 18.0  # ball centre to socket centre on one segment
    interference: float = 0.25  # diametral ball/socket interference: friction that holds a pose
    snap: float = 0.5  # radial undercut at the socket mouth: how far it snaps over the ball
    wall: float = 2.4
    bore: float = 10.0  # central cable bore (USB-C lead, or the 9 mm camera flex)
    tendon_r: float = 12.0  # tendon holes on this radius
    flange_r: float = 14.0  # stalk outer radius: Ø28 vs the drawing's Ø24
    tendon_hole: float = 1.5  # for 0.41 mm Spectra
    slits: int = 4  # socket skirt slits: tune the snap and the hold
    slit_w: float = 1.0
    tendons: int = 4  # 2 antagonistic pairs, one double pulley per pair

    @property
    def rb(self) -> float:
        return self.ball_dia / 2

    @property
    def rc(self) -> float:
        return self.rb - self.interference / 2

    @property
    def ro(self) -> float:
        return self.rc + self.wall

    @property
    def h(self) -> float:
        """Depth of the socket mouth below the socket centre."""
        mouth = self.rb - self.snap
        return math.sqrt(self.rc**2 - mouth**2)

    @property
    def rn(self) -> float:
        return self.rb * 0.62

    @property
    def base_h(self) -> float:
        return self.rc + 12

    @property
    def tip_h(self) -> float:
        return self.rc + 8

    @property
    def segments(self) -> int:
        return max(1, round((self.length - self.base_h - self.tip_h) / self.pitch))


@dataclass(frozen=True)
class EyeSpec:
    """Round colour display in a printed bezel with a camera bump on its rim."""

    glass_d: float = 115.0  # Waveshare ESP32-P4-WIFI6-Touch-LCD-3.4C outline (round, 800x800, 87.6 mm active)
    depth: float = 18.0  # UNVERIFIED: glass + board stack behind it
    wall: float = 2.0
    lip: float = 2.5
    cam_deg: float = 30.0  # camera bump position on the rim, degrees from the top toward the outside
    cam_w: float = 10.0  # UNVERIFIED: spy-camera head, square
    post_r: float = 14.0
    back_t: float = 2.5  # back cover: it rides at the stalk tip, so keep it thin

    @property
    def pocket_r(self) -> float:
        return self.glass_d / 2 + 0.3

    @property
    def rim_r(self) -> float:
        return self.pocket_r + self.wall

    @property
    def centre_z(self) -> float:
        return self.rim_r + 12

    @property
    def bump_r(self) -> float:
        """Camera bump centre, radius from the eye axis: just clear of the glass."""
        return self.pocket_r + self.cam_w / 2 + 1


STALK = StalkSpec()
EYE = EyeSpec()


def docked_pose(swing_deg: float = ARM_SWING) -> dict[str, float]:
    """Body pitch when it sits back on its skid, wheels and skid both on the floor.

    The floor is the common tangent below the skid circle (drum radius + skid) and the wheel circle.
    """
    r1 = DRUM_R + SKID_T
    a = math.radians(swing_deg)
    cx, cz = ARM_L * math.sin(a), ARM_PIVOT - ARM_L * math.cos(a)
    d = math.hypot(cx, cz)
    alpha = math.degrees(math.atan2(cz, cx))
    beta = alpha - math.degrees(math.acos((r1 - WHEEL_R) / d))  # skid contact direction, xz-angle
    tilt = -90.0 - beta  # nose-up pitch that puts the contact straight down
    wheel_x = d * math.cos(math.radians(alpha + tilt))
    return {"beta": beta, "tilt": tilt, "wheel_x": wheel_x, "axis_z": r1, "axle": (cx, cz)}
