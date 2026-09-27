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
# Stalk roots sit on the crown, straight above the drum axis (x = 0), mirror-symmetric about y = 0. The drawing's
# spread (0.26 x 150 = 39) would put two Ø120 eyes on top of each other, so the roots go out to +-48 (the Ø47
# pedestals end at |y| 71.5, inside the drum's 75) and splay 5 degrees outward, sideways only: screen centres 136 apart.
STALK_SPREAD = 48.0  # stalk roots at y = +-48
STALK_SPLAY = 5.0  # degrees each stalk leans outward (a roll about x), none fore-aft

SHELL = 3.0  # drum wall
CAP_T = 8.0  # end cap thickness
SKID_T = 4.0  # skid proud of the drum
ARM_Y0 = DRUM_L / 2 + 1  # arm inner face, 1 mm outside the end cap
BOSS_Z = 122.0  # stalk pedestal top on the crown (drum frame): the splayed Ø47 base plate clears the drum

# --- bought parts (see README BOM; UNVERIFIED ones are marked) -----------------------------------------------------
BEARING_OD, BEARING_ID, BEARING_W = 37.0, 25.0, 7.0  # 6805-2RS
BEARING_FIT = 0.05  # radial press allowance added to the pocket
MOTOR_D, MOTOR_L = 37.0, 70.0  # Pololu 37D 50:1 w/ encoder (#4753), gearbox face to encoder cap
MOTOR_SHAFT_L = 16.0
POLOLU_HUB_PCD = 19.0  # UNVERIFIED: Pololu 1083 hub bolt circle
SERVO_L, SERVO_W, SERVO_H = 45.2, 24.7, 35.0  # Feetech STS3250 case (the arm servos)
SERVO_SHAFT_OFF = 11.0  # UNVERIFIED: output shaft centre from the near end of the case
JETSON_BOARD = (100.0, 79.0)  # carrier PCB, NVIDIA SP-11324-001
JETSON_HOLES = (86.0, 58.0)  # UNVERIFIED (scaled from the drawing)
JETSON_HOLE_INSET = 4.0  # UNVERIFIED: hole centres from the left and top board edges
JETSON_H = 35.0  # kit height incl. heatsink/fan
MDD10A = (84.5, 62.0, 15.0)
POGO_D = 3.0  # UNVERIFIED: Mill-Max 0873 barrel press-fit diameter
POGO_PROUD = 1.5

# Charge contacts along the drum axis (y). Uneven gaps: no single-pitch shift can line up a wrong pair.
PADS = {"gnd": -35.0, "sense": -10.0, "vin": 30.0}
PAD_W = 12.0  # pad width along y (brass strip)

DOCK_H = 6.0  # cradle floor under the skid (the pins press in from below)


@dataclass(frozen=True)
class SpringSpec:
    """A helical compression spring used as a stalk's spine: bought steel or printed. All mm.

    `ei` is what matters: the stalk bends, it isn't squashed. For an open-coiled helical spring under pure bending,
    EI = d^4 p / (32 D (1/E + 1/2G)), with d the wire, D the mean coil diameter and p the pitch (same model as
    `sim/bot.py` Spring).
    """

    name: str
    od: float
    wire: float
    free_length: float
    pitch: float  # plain (open) ends, constant pitch: the collars and guide discs screw on along the coil
    printed: bool
    material: str
    e_gpa: float
    g_gpa: float

    @property
    def mean_d(self) -> float:
        return self.od - self.wire

    @property
    def id(self) -> float:
        return self.od - 2 * self.wire

    @property
    def coils(self) -> float:
        return self.free_length / self.pitch

    @property
    def rate(self) -> float:
        """Axial rate, N/mm."""
        return self.g_gpa * 1e3 * self.wire**4 / (8 * self.mean_d**3 * self.coils)

    @property
    def ei(self) -> float:
        """Bending stiffness, N·m²."""
        compliance = 1 / (self.e_gpa * 1e9) + 1 / (2 * self.g_gpa * 1e9)
        return (self.wire * 1e-3) ** 4 * self.pitch * 1e-3 / (32 * self.mean_d * 1e-3 * compliance)


def catalog_pitch(od: float, wire: float, stock_length: float, stock_rate: float, g_gpa: float) -> float:
    """Pitch of a bought spring from its catalogue rate: k = G d^4 / (8 D^3 n) gives the stock's coil count n."""
    n = g_gpa * 1e3 * wire**4 / (8 * (od - wire) ** 3 * stock_rate)
    return stock_length / n


IN = 25.4
LBF_IN = 4.44822 / IN  # lbf/in -> N/mm
# McMaster 9662K33: spring-steel cut-to-length compression spring, 36 in long, OD 1.00 in, ID 0.73 in, wire 0.135 in,
# 5.6 lbf/in over the full 36 in, open ends. Cut to 6 in (152.4 mm) per stalk; a cut piece's rate goes as 36 / length.
# The catalogue rate puts 131.7 coils in the 36 in stock: pitch 6.94 mm, 22 coils in 6 in. The steel's E and G are the
# usual spring-steel values (UNVERIFIED for this stock). Measure the pitch of the real spring and set it here.
STEEL_SPRING = SpringSpec(
    "McMaster 9662K33, 1.00 in OD x 0.135 in wire, cut to 6 in",
    1.00 * IN,
    0.135 * IN,
    6 * IN,
    catalog_pitch(1.00 * IN, 0.135 * IN, 36 * IN, 5.6 * LBF_IN, 79.3),
    False,
    "spring steel",
    207.0,
    79.3,
)
# The printed alternative: PETG is ~100x softer than steel, so the coil has to be much fatter to carry the eye.
# Print it upright with tree supports under the coils. Its stiffness is UNVERIFIED (layer lines, creep).
PRINTED_SPRING = SpringSpec("printed PETG coil, 30 OD x 6 wire", 30.0, 6.0, 150.0, 12.0, True, "PETG", 2.0, 0.75)


@dataclass(frozen=True)
class StalkSpec:
    """Spring stalk: base plate, spring, guide discs, tip plate. Three tendons at 120 degrees, one winch each. All mm.

    The winches are worm-geared and can't be back-driven, so each tendon holds its length with no current. They're
    pretensioned (`pretension` each), which squeezes the spring: the stalk is modelled at that installed length. The
    collars and discs grip the coil, so only the free coils between them bend and compress (`bend_length`).
    """

    spring: SpringSpec = STEEL_SPRING
    guides: int = 5
    guide_t: float = 4.0
    guide_step: float = 28.0  # target spacing, rounded to whole pitches so every disc is the same part
    collar_turns: float = 1.5  # coil turns the base and tip collars grip
    plate_t: float = 5.0
    bore: float = 15.0  # display lead: a stock USB-C plug (<= 13 wide, UNVERIFIED) threads through; spring ID 18.5
    tendons: int = 3
    tendon_hole: float = 1.5  # for 0.41 mm Spectra
    clearance: float = 0.25  # radial, coil groove over the wire
    pretension: float = 10.0  # N per tendon, held by the locked winches

    @property
    def tendon_r(self) -> float:
        """Tendons stand 5 mm off the spring: a bigger radius means less pull, and less shortening, per degree."""
        return self.spring.od / 2 + 5

    @property
    def guide_r(self) -> float:
        return self.tendon_r + 3

    @property
    def collar_r(self) -> float:
        return self.spring.od / 2 + 2.5

    @property
    def collar_h(self) -> float:
        return self.collar_turns * self.spring.pitch

    @property
    def bolt_r(self) -> float:
        """Base plate to pedestal, 3 x M3, between the tendons: the heads clear the collar by 0.75 mm."""
        return self.tendon_r + 1

    @property
    def base_r(self) -> float:
        return self.bolt_r + 4

    @property
    def tip_bolts(self) -> tuple[tuple[float, float], ...]:
        """Tip plate to the eye's chin, 2 x M3 from below, heads beside the collar, inside the chin's 36 mm width."""
        r, y = self.collar_r + 3.5, 14.0
        x = -math.sqrt(r * r - y * y)
        return ((x, y), (x, -y))

    @property
    def tip_r(self) -> float:
        return self.tendon_r + 7

    @property
    def guide_z(self) -> list[float]:
        """Guide disc centres, spring frame (0 at the spring's bottom end), a whole number of pitches apart."""
        p = self.spring.pitch
        step = p * max(1, round(self.guide_step / p))
        free = self.spring.free_length - 2 * self.collar_h
        n = min(self.guides, int((free - self.guide_t) // step) + 1)
        start = self.collar_h + (free - (n - 1) * step) / 2
        return [start + i * step for i in range(n)]

    # --- the spring as installed: gripped turns are rigid, the free coils between them bend and compress ----------

    def gripped(self) -> list[tuple[float, float]]:
        """Spring-frame spans the collars and discs hold rigid."""
        top, h = self.spring.free_length, self.guide_t / 2
        return [(0.0, self.collar_h)] + [(z - h, z + h) for z in self.guide_z] + [(top - self.collar_h, top)]

    @property
    def bend_length(self) -> float:
        """Free coil between the collars and discs, free state: only this bends or compresses."""
        return self.spring.free_length - sum(b - a for a, b in self.gripped())

    @property
    def rate(self) -> float:
        """Axial rate of the installed spring, N/mm: its gripped turns are inactive."""
        return self.spring.rate * self.spring.free_length / self.bend_length

    @property
    def preload(self) -> float:
        """Spring compression at rest, N: every tendon at its pretension."""
        return self.tendons * self.pretension

    @property
    def preload_shortening(self) -> float:
        return self.preload / self.rate

    @property
    def squeeze(self) -> float:
        """Installed / free length of the free coils: their pitch shrinks by this much."""
        return 1 - self.preload_shortening / self.bend_length

    @property
    def ei(self) -> float:
        """Bending stiffness at rest, N·m²: EI goes with the pitch, so the preload softens it a little."""
        return self.spring.ei * self.squeeze

    def installed_z(self, z: float) -> float:
        """Where a point z of the free spring (spring frame) sits once the preload has squeezed it."""
        out, prev = 0.0, 0.0
        for a, b in self.gripped():
            if z <= a:
                return out + (z - prev) * self.squeeze
            out += (a - prev) * self.squeeze
            if z <= b:
                return out + (z - a)
            out += b - a
            prev = b
        return out + (z - prev) * self.squeeze

    @property
    def installed_length(self) -> float:
        return self.installed_z(self.spring.free_length)

    @property
    def length(self) -> float:
        """Base plate bottom to tip plate top, installed."""
        return self.plate_t + self.installed_length + self.plate_t

    def moment(self, deg: float) -> float:
        """Root moment for a constant-curvature bend of deg degrees, N·m."""
        return self.ei * math.radians(deg) / (self.bend_length * self.squeeze / 1000)

    def pull(self, deg: float) -> float:
        """Tension on the pulling tendon for a bend of deg degrees, N. With three tendons the other two stay at their
        pretension, 60 degrees off the far side (lever r/2 each), so they cost the puller one more pretension."""
        return self.moment(deg) / (self.tendon_r / 1000) + self.pretension

    def deg_at(self, pull: float) -> float:
        """The bend a tendon pull holds, degrees: the inverse of pull()."""
        m = (pull - self.pretension) * self.tendon_r / 1000
        return math.degrees(m * self.bend_length * self.squeeze / 1000 / self.ei)

    def shortening(self, deg: float) -> float:
        """Extra shortening at a bend, over the preload, mm: the puller's tension rises, the others hold."""
        return (self.pull(deg) - self.pretension) / self.rate

    def buckle_load(self, lever: float) -> float:
        """Weight (N) that would fold the straight stalk sideways with its centre `lever` mm above the spring's top.

        Small-angle cantilever: the eye's offset feeds back through the curvature of the free coils, so the critical
        load is EI / (L_bend (L / 2 + lever)).
        """
        lb = self.bend_length * self.squeeze / 1000
        return self.ei / (lb * (self.installed_length / 2000 + lever / 1000))


@dataclass(frozen=True)
class EyeSpec:
    """Round colour display in a printed bezel with a camera bump on its rim, centred on the stalk axis."""

    glass_d: float = 115.0  # Waveshare ESP32-P4-WIFI6-Touch-LCD-3.4C outline (round, 800x800, 87.6 mm active)
    depth: float = 18.0  # UNVERIFIED: glass + board stack behind it
    wall: float = 2.0
    lip: float = 2.5
    cam_deg: float = 30.0  # camera bump position on the rim, degrees from the top toward the outside
    cam_w: float = 10.0  # UNVERIFIED: spy-camera head, square
    back_t: float = 2.5  # back cover: it rides at the stalk tip, so keep it thin
    rise: float = 8.0  # bottom of the rim above the stalk tip: the bezel's chin fills it and bolts to the tip plate
    chin_w: float = 36.0  # chin lug width along y
    chin_up: float = 8.0  # how far the chin runs up into the rim

    @property
    def pocket_r(self) -> float:
        return self.glass_d / 2 + 0.3

    @property
    def rim_r(self) -> float:
        return self.pocket_r + self.wall

    @property
    def centre_z(self) -> float:
        """Screen centre above the stalk tip, on the stalk axis."""
        return self.rim_r + self.rise

    @property
    def back_x(self) -> float:
        """The bezel's back face, x: puts the display glass (centre) on the stalk axis, x = 0."""
        return 1.0 - self.depth

    @property
    def bump_r(self) -> float:
        """Camera bump centre, radius from the eye axis: just clear of the glass."""
        return self.pocket_r + self.cam_w / 2 + 1


@dataclass(frozen=True)
class CellSpec:
    """One cylindrical Li-ion cell, from its datasheet. Diameter and length are the maximums: the pockets fit those."""

    name: str
    d: float
    length: float
    ah: float
    volts: float  # nominal
    grams: float
    amps: float  # max continuous discharge

    @property
    def wh(self) -> float:
        return self.ah * self.volts


# UNVERIFIED dimensions and mass: check the datasheet of the cells you buy. Any 5 Ah 21700 no bigger than 21.3 x 70.9
# drops in (Samsung 50E, Molicel P50B if its diameter measures under the pitch).
SAMSUNG_50S = CellSpec("Samsung INR21700-50S", 21.25, 70.8, 5.0, 3.6, 69.0, 25.0)


@dataclass(frozen=True)
class PackSpec:
    """A custom 4S Li-ion pack, spot-welded, lying low in the drum in nested layers that follow its curved bottom.

    The cells lie along x (fore-aft). Each layer is a row of `per_row` cells across y; the next layer up shifts half a
    pitch and nests into the grooves, so layers stack `row_pitch` apart. `layers` gives, bottom up, how many cells sit
    end to end along x in each layer and how far forward that layer is shifted. The bottom of the lowest layer is `z0`
    (drum frame). The bottom-layer slots listed in `empty` (counted across y) carry no cell.
    """

    cell: CellSpec = SAMSUNG_50S
    s: int = 4
    p: int = 6
    pitch: float = 21.4  # cell centres across a row: glued, fishpaper rings on the + ends
    ends: float = 1.5  # nickel strip (2 x 0.15) and the end insulators, added to the cell length
    per_row: int = 5
    z0: float = -104.0
    layers: tuple[tuple[int, float], ...] = ((1, 4.0), (2, 0.0), (2, 12.0))
    empty: tuple[int, ...] = (2,)  # the middle one: keeps the pack centred in y; the BMS thermistor goes there
    wrap: float = 0.5  # PVC heat-shrink and fishpaper outside the cells
    extra_g: float = 130.0  # nickel strip, fishpaper, wrap, BMS, leads and XT60: UNVERIFIED

    @property
    def slot_len(self) -> float:
        return self.cell.length + self.ends

    @property
    def row_pitch(self) -> float:
        return self.pitch * math.sqrt(3) / 2

    @property
    def width(self) -> float:
        """Across y, every layer included: the rows alternate a quarter pitch either side of the centre."""
        return (self.per_row + 0.5) * self.pitch

    def layer_box(self, k: int) -> tuple[float, float, float, float]:
        """x0, x1, z0, z1 of layer k's cells (no wrap)."""
        n, off = self.layers[k]
        zb = self.z0 + k * self.row_pitch
        return off - n * self.slot_len / 2, off + n * self.slot_len / 2, zb, zb + self.pitch

    @property
    def top(self) -> float:
        return max(self.layer_box(k)[3] for k in range(len(self.layers)))

    def slots(self) -> list[tuple[float, float, float, float]]:
        """Every cell slot: x0, x1, y, z of its axis."""
        out = []
        for k, (n, _) in enumerate(self.layers):
            x0, _, zb, _ = self.layer_box(k)
            shift = self.pitch / 4 * (1 if k % 2 else -1)
            for j in range(n):
                for i in range(self.per_row):
                    y = (i - (self.per_row - 1) / 2) * self.pitch + shift
                    out.append((x0 + j * self.slot_len, x0 + (j + 1) * self.slot_len, y, zb + self.pitch / 2))
        return out

    def cells(self) -> list[tuple[float, float, float, float]]:
        slots = self.slots()
        n0 = self.layers[0][0] * self.per_row
        full = [c for i, c in enumerate(slots[:n0]) if i % self.per_row not in self.empty] + slots[n0:]
        assert len(full) == self.s * self.p, f"{len(full)} slots for a {self.s}S{self.p}P pack"
        return full

    @property
    def ah(self) -> float:
        return self.p * self.cell.ah

    @property
    def wh(self) -> float:
        return self.s * self.p * self.cell.wh

    @property
    def kg(self) -> float:
        return (self.s * self.p * self.cell.grams + self.extra_g) / 1000

    @property
    def name(self) -> str:
        return f"{self.s}S{self.p}P {self.cell.name.split()[-1]} {self.ah:.0f} Ah {self.wh:.0f} Wh"


# The biggest 4S pack that fits under the electronics tray: 4S6P Samsung 50S, 30 Ah, 432 Wh, about 1.8 kg.
# 25 slots in three nested layers (5 + 10 + 10), the middle one of the bottom layer empty. Top (with wrap) at z = -45.
BATTERY = PackSpec()
BMS = (60.0, 40.0, 12.0)  # UNVERIFIED envelope: 4S Li-ion BMS, >= 40 A continuous, with balancing
STALK = StalkSpec()
EYE = EyeSpec()
EYE_KG = 0.165  # UNVERIFIED: eye (display budget 80 g) plus the tip plate, riding on the stalk


@dataclass(frozen=True)
class WormMotorSpec:
    """A right-angle worm gearmotor with a Hall encoder on the motor shaft. All mm, N·m, A, rpm.

    Motor frame: origin on the output shaft axis in the gearbox's output face, the shaft along +z, the gearbox's long
    axis along +y from its far end (y = -shaft_from_end) to the motor end, where the can and the encoder carry on.
    """

    name: str
    box_l: float  # gearbox length, far end to motor end
    box_w: float
    box_t: float  # thickness, output face to back face
    shaft_from_end: float  # output shaft centre from the gearbox's far end
    shaft_d: float
    shaft_l: float  # past the output face
    holes: tuple[tuple[float, float], ...]  # M3, output face, (x, y) from the far end's centre
    can_d: float
    can_l: float
    enc_d: float
    enc_l: float
    ratio: float
    ppr: int  # encoder pulses per motor revolution, per channel
    no_load_rpm: float
    no_load_a: float
    rated_rpm: float
    rated_nm: float
    rated_a: float
    stall_a: float
    stall_nm: float
    kg: float

    @property
    def length(self) -> float:
        return self.box_l + self.can_l + self.enc_l

    @property
    def can_z(self) -> float:
        """Can axis below the output face: centred on the gearbox's thickness (UNVERIFIED)."""
        return -self.box_t / 2

    @property
    def kt(self) -> float:
        """Output torque per amp over the no-load current, N·m/A, from the rated point."""
        return self.rated_nm / (self.rated_a - self.no_load_a)

    def torque(self, amps: float) -> float:
        return self.kt * max(0.0, amps - self.no_load_a)

    def rpm(self, nm: float) -> float:
        """Speed at 12 V under a load, on the straight line through no-load and the rated point."""
        return self.no_load_rpm - (self.no_load_rpm - self.rated_rpm) * nm / self.rated_nm

    @property
    def counts(self) -> int:
        """Quadrature counts per output revolution."""
        return round(4 * self.ppr * self.ratio)


# NFP-JGY-370-EN, 12 V "A type", 337:1, from the NFP listing (nfpshop.com / microdcmotors.com): 35 rpm and <= 0.25 A
# no-load, 25 rpm at the rated 1.37 N·m and <= 1.3 A, >= 35 kg·cm (3.4 N·m) and <= 5.5 A stalled, self-locking,
# 11 PPR AB Hall encoder (3.3 or 5 V). Dimensions from the ASLONG JGY-370 drawing (46 x 32 x 21.5 gearbox, 4 x M3 on
# 18 x 33, shaft 15 from the far end), the NFP shaft (D 6 x 18.5) and the listing's 162-200 g. Can and encoder sizes
# are guesses. All UNVERIFIED: measure one and set them here.
WINCH_MOTOR = WormMotorSpec(
    "NFP-JGY-370-EN 12 V 337:1",
    46.0,
    32.0,
    21.5,
    15.0,
    6.0,
    18.5,
    ((-9.0, 6.0), (9.0, 6.0), (-9.0, 39.0), (9.0, 39.0)),
    24.4,
    30.8,
    21.5,
    14.0,
    337.0,
    11,
    35.0,
    0.25,
    25.0,
    1.37,
    1.3,
    5.5,
    3.4,
    0.20,
)
PULLEY_R = 10.0  # winch pulley groove radius: 1 N·m is 100 N of tendon
WINCH_LIMIT_A = 1.6  # TB67H420FTG chopping threshold per channel (VREF 1.28 V): caps the tendon pull in hardware
SPECTRA_N = 289.0  # PowerPro Spectra 65 lb breaking strength


def docked_pose(swing_deg: float = ARM_SWING, lift: float = DOCK_H) -> dict[str, float]:
    """Body pitch when it sits back on its skid: wheels on the floor, skid on the cradle floor `lift` above it.

    The skid circle (drum radius + skid) touches z = lift straight below the drum axis, and the wheel circle
    touches z = 0. With lift = 0 that's the common tangent of the two circles.
    """
    r1 = DRUM_R + SKID_T
    a = math.radians(swing_deg)
    cx, cz = ARM_L * math.sin(a), ARM_PIVOT - ARM_L * math.cos(a)
    d = math.hypot(cx, cz)
    alpha = math.degrees(math.atan2(cz, cx))
    axle_dir = -90.0 + math.degrees(math.acos((r1 + lift - WHEEL_R) / d))  # axle direction from the drum axis, world
    tilt = axle_dir - alpha  # nose-up pitch
    beta = -90.0 - tilt  # skid contact direction in the drum frame: straight down in the world
    wheel_x = d * math.cos(math.radians(axle_dir))
    return {"beta": beta, "tilt": tilt, "wheel_x": wheel_x, "axis_z": r1 + lift, "axle": (cx, cz)}
