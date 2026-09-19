"""MJCF model of the mosfet bot.

A drum lying on its side on two wheels, which ride on long arms that pivot high
on the drum and swing forward or back. Both wheels share one axle line, so the
bot tips back onto a skid on the drum and stands on three points without
balancing; the arm swing sets how far back it leans. Two eye stalks grow out of the drum's top
front. Each eye is a round memory LCD facing forward with a small camera
module in a bump on its rim (a real MuJoCo camera, so each eye can render
what it sees). Each stalk is a spring column inside a tube: a chain of short segments
whose joints have stiffness, with three cables 120 degrees apart routed through
every segment, through guide discs that stand them off the spine, and anchored
at the tip. Pulling one or two cables bends the stalk toward them; letting go
springs it back upright.

Proportions come from the tuned 2D character (web/src/face/critter.ts
DEFAULT_GEOMETRY), where every length is a fraction of one "unit". Here the
unit is chosen so the drum radius is `DRUM_RADIUS` metres.

Frame: x forward, y left, z up. The drum's axis runs along y.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

# Tuned 2D proportions, copied from DEFAULT_GEOMETRY.
GEOMETRY = {
    "wheelRadius": 0.12,
    "wheelThickness": 0.85,
    "shellSize": 0.165,
    "shellLength": 0.21,
    "armSwing": 50.0,
    "armLength": 1.56,
    "armPivot": 0.38,
    "armWidth": 0.112,
    "stalkLength": 0.24,  # unused: the spring's free length sets the stalk (kept for reference against the drawing)
    "stalkWidth": 0.034,
    "stalkSpread": 0.26,
    "eyeRadius": 0.115,
}

DRUM_RADIUS = 0.06  # metres
EYE_RADIUS_MAX = 0.03  # metres


@dataclass(frozen=True)
class Dimensions:
    """Physical sizes in metres, derived from the tuned proportions."""

    drum_radius: float
    drum_half_length: float
    wheel_radius: float
    wheel_half_width: float
    arm_length: float
    arm_pivot_rise: float
    arm_width: float
    arm_plate: float
    arm_swing: float  # radians, forward from straight down
    stalk_length: float
    stalk_radius: float
    stalk_spread: float  # half distance between stalk roots, along y
    eye_radius: float

    @staticmethod
    def from_geometry(g: dict[str, float] = GEOMETRY, drum_radius: float = DRUM_RADIUS) -> Dimensions:
        unit = drum_radius / g["shellSize"]
        wheel_r = unit * g["wheelRadius"]
        arm_w = unit * g["armWidth"]
        length = unit * g["shellLength"]
        return Dimensions(
            drum_radius=drum_radius,
            drum_half_length=length / 2,
            wheel_radius=wheel_r,
            wheel_half_width=wheel_r * g["wheelThickness"] / 2,
            arm_length=drum_radius * g["armLength"],
            arm_pivot_rise=drum_radius * g["armPivot"],
            arm_width=arm_w,
            arm_plate=arm_w * 0.45,
            arm_swing=math.radians(g["armSwing"]),
            # The spine is a real spring, so it sets the stalk's length and the tube's diameter.
            stalk_length=STALK_SPRING.free_length,
            stalk_radius=STALK_SPRING.outside_diameter / 2,
            stalk_spread=length * g["stalkSpread"],
            # Big round displays, like the character's eyes (a ~60 mm round LCD; the drawing's would be ~84 mm).
            eye_radius=min(unit * g["eyeRadius"], EYE_RADIUS_MAX),
        )


@dataclass(frozen=True)
class Spring:
    """A real compression spring used as a stalk's spine (McMaster-Carr).

    `bending_stiffness` is what matters here: the advertised `rate_lbf_in` is axial (how hard it is to squash), while
    a stalk bends. It follows from the wire and coil geometry: for a close-coiled helical spring under pure bending,
    EI = d^4 / (32 D n' (1/E + 1/2G)), with d the wire diameter, D the mean coil diameter, and n' coils per unit length.
    """

    part: str
    free_length: float  # metres
    outside_diameter: float  # metres
    wire_diameter: float  # metres
    rate: float  # N/m, axial
    material_e: float = 207e9  # music wire
    material_g: float = 79.3e9

    @property
    def mean_diameter(self) -> float:
        return self.outside_diameter - self.wire_diameter

    @property
    def active_coils(self) -> float:
        return self.material_g * self.wire_diameter**4 / (8 * self.mean_diameter**3 * self.rate)

    @property
    def bending_stiffness(self) -> float:
        """EI of the spring as a beam, N·m²."""
        coils_per_length = (self.active_coils + 2) / self.free_length  # closed ends add ~2 dead coils
        compliance = 1 / self.material_e + 1 / (2 * self.material_g)
        return self.wire_diameter**4 / (32 * self.mean_diameter * coils_per_length * compliance)


IN = 0.0254
LBF_PER_IN = 4.4482189 / IN

STALK_SPRING = Spring(
    part="9657K218",
    free_length=4.5 * IN,
    outside_diameter=0.5 * IN,
    wire_diameter=0.072 * IN,
    rate=17 * LBF_PER_IN,
)
"""The spine: a 4.5 in, 1/2 in OD music-wire compression spring (EI ~0.011 N·m²; ~12 N of cable bends it 90 degrees).

The softer 4 in 9657K222 needs only half the cable force, but its eyes droop about twice as far under their own weight.
"""


@dataclass(frozen=True)
class StalkSpec:
    """Spring column and cable tuning for one eye stalk."""

    spring: Spring = field(default_factory=lambda: STALK_SPRING)
    segments: int = 10
    stiffness: float | None = None  # N·m/rad per joint; None derives it from the spring's bending stiffness
    damping: float = 0.012  # N·m·s/rad per joint
    cable_offset: float = 0.57  # cable radius as a fraction of the tube radius: guide discs stand the cables off the
    # spine, which is what buys the bend (at 0.9, against the tube, a full pull manages only ~80 degrees)
    max_pull: float = 45.0  # newtons; enough to curl a stalk right over (the spring's coils bind near 330 degrees)
    joint_range_deg: float = 35.0  # per hinge; the stalk's total bend is roughly segments x this
    lean_deg: float = 18.0  # outward lean at rest


@dataclass(frozen=True)
class Motor:
    """A gearmotor: its housing's size and mass, and what it does to the joint it drives.

    `armature` is the rotor's inertia reflected through the gearbox (kg·m²),
    `friction` the gearbox's static friction torque (N·m), and `torque` the
    stall torque the actuator is clamped to (N·m).
    """

    mass: float
    radius: float
    length: float
    torque: float
    armature: float
    friction: float


@dataclass(frozen=True)
class BotSpec:
    dims: Dimensions = field(default_factory=Dimensions.from_geometry)
    stalk: StalkSpec = field(default_factory=StalkSpec)
    drum_mass: float = 0.1  # shell and electronics
    battery_mass: float = 0.45
    battery_forward: float = 0.55  # battery x position as a fraction of drum radius; forward loads the wheels
    arm_mass: float = 0.03
    wheel_mass: float = 0.05
    eye_mass: float = 0.018  # 60 mm round display, bezel, and camera module together
    eye_depth: float = 0.006  # display plus bezel thickness, metres
    camera_bump: float = 0.009  # camera module size, metres
    camera_fovy: float = 70.0
    skid_friction: float = 0.08  # drum-on-floor sliding friction (a skid pad)
    arm_kp: float = 6.0
    # Arm gearmotors: a small servo-class gearmotor at each pivot, inside the drum's end.
    arm_motor: Motor = field(default_factory=lambda: Motor(mass=0.025, radius=0.012, length=0.024, torque=1.2, armature=0.0006, friction=0.01))
    # Wheel hub motors: an N20-class gearmotor on each arm at the wheel axle.
    wheel_motor: Motor = field(default_factory=lambda: Motor(mass=0.012, radius=0.006, length=0.024, torque=0.6, armature=0.0002, friction=0.002))


CABLE_ANGLES_DEG = (90.0, 210.0, 330.0)
"""Cable positions around each stalk, measured from +x (forward): left-ish-forward, back, right-ish-forward."""

SIDES = (("left", 1), ("right", -1))


def _f(x: float) -> str:
    return f"{x:.5f}".rstrip("0").rstrip(".") if x != 0 else "0"


def _v(*xs: float) -> str:
    return " ".join(_f(x) for x in xs)


def _stalk_xml(name: str, side_sign: int, spec: BotSpec) -> tuple[str, list[str]]:
    """The stalk body chain (nested bodies) and its three tendon paths' site names."""
    d, s = spec.dims, spec.stalk
    seg = d.stalk_length / s.segments
    # Spread the spring's bending stiffness across the joints: each joint stands in for one segment of spring.
    stiffness = s.stiffness if s.stiffness is not None else s.spring.bending_stiffness / seg
    cable_r = d.stalk_radius * s.cable_offset
    seg_mass = 0.0015
    lean = math.radians(s.lean_deg) * side_sign
    # Roots sit on the drum surface, a little forward of the top.
    root_angle = math.radians(25)
    root = (d.drum_radius * math.sin(root_angle), side_sign * d.stalk_spread, d.drum_radius * math.cos(root_angle))

    sites: list[list[str]] = [[] for _ in CABLE_ANGLES_DEG]

    def ring(prefix: str, z: float, indent: str) -> str:
        out = []
        for k, a in enumerate(CABLE_ANGLES_DEG):
            ang = math.radians(a)
            site = f"{prefix}_c{k}"
            sites[k].append(site)
            out.append(f'{indent}<site name="{site}" pos="{_v(cable_r * math.cos(ang), cable_r * math.sin(ang), z)}" size="0.0015" rgba="0.9 0.5 0.2 1"/>')
        return "\n".join(out)

    # Base ring anchored in the drum body, rotated with the stalk's lean.
    base_ring = []
    for k, a in enumerate(CABLE_ANGLES_DEG):
        ang = math.radians(a)
        x, y = cable_r * math.cos(ang), cable_r * math.sin(ang)
        # Rotate (x, y, 0) about the x axis by -lean to match the stalk base frame.
        y_r = y * math.cos(-lean)
        z_r = y * math.sin(-lean)
        site = f"{name}_base_c{k}"
        sites[k].append(site)
        base_ring.append(f'      <site name="{site}" pos="{_v(root[0] + x, root[1] + y_r, root[2] + z_r)}" size="0.0015" rgba="0.9 0.5 0.2 1"/>')

    lines = ["\n".join(base_ring)]
    indent = "      "
    quat = _quat_axis_angle((1, 0, 0), -lean)
    lines.append(f'{indent}<body name="{name}_seg0" pos="{_v(*root)}" quat="{_v(*quat)}">')
    for i in range(s.segments):
        ind = indent + "  " * (i + 1)
        if i > 0:
            lines.append(f'{ind[:-2]}<body name="{name}_seg{i}" pos="0 0 {_f(seg)}">')
        lines.append(f'{ind}<joint name="{name}_j{i}x" type="hinge" axis="1 0 0" stiffness="{_f(stiffness)}" damping="{_f(s.damping)}" armature="0.00002" range="{_v(-s.joint_range_deg, s.joint_range_deg)}"/>')
        lines.append(f'{ind}<joint name="{name}_j{i}y" type="hinge" axis="0 1 0" stiffness="{_f(stiffness)}" damping="{_f(s.damping)}" armature="0.00002" range="{_v(-s.joint_range_deg, s.joint_range_deg)}"/>')
        lines.append(f'{ind}<geom class="stalk" fromto="0 0 0 0 0 {_f(seg)}" size="{_f(d.stalk_radius)}" mass="{_f(seg_mass)}"/>')
        lines.append(f'{ind}<geom class="guide" type="cylinder" pos="0 0 {_f(seg * 0.95)}" size="{_v(cable_r * 1.12, seg * 0.06)}" mass="0.0004"/>')
        lines.append(ring(f"{name}_s{i}", seg * 0.95, ind))
    tip = indent + "  " * (s.segments + 1)
    lines.append(f'{tip}<body name="{name}_eye" pos="0 0 {_f(seg + d.eye_radius)}">')
    # Round memory LCD facing forward (+x): a thin disc, its face a darker inset.
    lines.append(f'{tip}  <geom class="eye" type="cylinder" euler="0 90 0" size="{_v(d.eye_radius, spec.eye_depth / 2)}" mass="{_f(spec.eye_mass)}"/>')
    # The display itself: a textured quad just in front of the disc. Its texture (lcd_left / lcd_right) is redrawn
    # at run time with the current expression; pixels outside the round screen match the bezel.
    lines.append(f'{tip}  <geom class="lcd" type="mesh" mesh="lcd_disc" material="lcd_{"left" if side_sign > 0 else "right"}" pos="{_v(spec.eye_depth / 2 + 0.0004, 0, 0)}"/>')
    # Camera module in a bump on the top rim, looking the same way as the display.
    bump = spec.camera_bump
    cam_z = d.eye_radius + bump * 0.35
    lines.append(f'{tip}  <geom class="eye" type="box" pos="{_v(0, 0, cam_z)}" size="{_v(spec.eye_depth / 2 + 0.001, bump / 2, bump / 2)}"/>')
    lines.append(f'{tip}  <geom class="lens" type="cylinder" euler="0 90 0" pos="{_v(spec.eye_depth / 2 + 0.001, 0, cam_z)}" size="{_v(bump * 0.28, 0.0006)}"/>')
    lines.append(f'{tip}  <camera name="{name}_camera" pos="{_v(spec.eye_depth / 2 + 0.002, 0, cam_z)}" xyaxes="0 -1 0 0 0 1" fovy="{_f(spec.camera_fovy)}"/>')
    lines.append(f'{tip}  <site name="{name}_tip" pos="0 0 0" size="0.003"/>')
    lines.append(f"{tip}</body>")
    for i in reversed(range(s.segments)):
        lines.append(f'{indent + "  " * i}</body>')
    return "\n".join(lines), [" ".join(path) for path in sites]


BALL_START = (-0.1, 0.15, 0.031)
"""Where the poking ball starts (metres): back and to the bot's left, clear of the path it drives."""

LCD_PIXELS = 96
"""Resolution of each round eye display's texture (square; the round screen shows its inscribed circle)."""


def _disc(r: float, segments: int = 40) -> str:
    """Mesh attributes for a round screen facing +x: a triangle fan whose texture coordinates map the texture's
    inscribed circle onto it, so the image's column 0 is on the viewer's left and row 0 at the top."""
    vertex = [0.0, 0.0, 0.0]
    texcoord = [0.5, 0.5]
    for i in range(segments):
        a = 2 * math.pi * i / segments
        y, z = math.cos(a), math.sin(a)
        vertex += [0.0, r * y, r * z]
        texcoord += [0.5 + 0.5 * y, 0.5 - 0.5 * z]
    face = []
    for i in range(segments):
        face += [0, 1 + i, 1 + (i + 1) % segments]
    return f'vertex="{_v(*vertex)}" texcoord="{_v(*texcoord)}" face="{" ".join(str(f) for f in face)}"'


def _quat_axis_angle(axis: tuple[float, float, float], angle: float) -> tuple[float, float, float, float]:
    h = angle / 2
    return (math.cos(h), axis[0] * math.sin(h), axis[1] * math.sin(h), axis[2] * math.sin(h))


def build_mjcf(spec: BotSpec = BotSpec()) -> str:
    """Return the full MJCF document for the bot on a floor."""
    d = spec.dims
    # Standing height: wheels on the ground, arms at their resting swing.
    drum_z = d.wheel_radius + d.arm_length * math.cos(d.arm_swing) - d.arm_pivot_rise
    drum_z = max(drum_z, d.drum_radius)

    arms = []
    for side, sign in SIDES:
        y = sign * (d.drum_half_length + d.arm_plate / 2)
        wheel_y = sign * (d.arm_plate / 2 + d.wheel_half_width)
        arms.append(
            f"""
      <body name="arm_{side}" pos="{_v(0, y, d.arm_pivot_rise)}">
        <joint name="arm_{side}" type="hinge" axis="0 1 0" range="-80 80" damping="0.02" armature="{_f(spec.arm_motor.armature)}" frictionloss="{_f(spec.arm_motor.friction)}"/>
        <geom class="arm" type="box" pos="{_v(0, 0, -d.arm_length / 2)}" size="{_v(d.arm_width / 2, d.arm_plate / 2, d.arm_length / 2 + d.arm_width / 2)}" mass="{_f(spec.arm_mass)}"/>
        <!-- Wheel hub motor, bolted to the arm at the axle; its output shaft drives the wheel. -->
        <geom name="wheel_motor_{side}" class="motor" type="cylinder" euler="90 0 0" pos="{_v(0, -sign * spec.wheel_motor.length / 2, -d.arm_length)}" size="{_v(spec.wheel_motor.radius, spec.wheel_motor.length / 2)}" mass="{_f(spec.wheel_motor.mass)}"/>
        <body name="wheel_{side}" pos="{_v(0, wheel_y, -d.arm_length)}">
          <joint name="wheel_{side}" type="hinge" axis="0 1 0" damping="0.0005" armature="{_f(spec.wheel_motor.armature)}" frictionloss="{_f(spec.wheel_motor.friction)}"/>
          <geom class="wheel" type="cylinder" euler="90 0 0" size="{_v(d.wheel_radius, d.wheel_half_width)}" mass="{_f(spec.wheel_mass)}"/>
          <geom class="hub" type="box" size="{_v(d.wheel_radius * 0.75, d.wheel_half_width * 1.05, d.wheel_radius * 0.08)}"/>
        </body>
      </body>"""
        )

    stalk_bodies, tendons, cable_actuators = [], [], []
    for side, sign in SIDES:
        name = f"stalk_{side}"
        body, paths = _stalk_xml(name, sign, spec)
        stalk_bodies.append(body)
        for k, path in enumerate(paths):
            tendons.append(
                f'    <spatial name="{name}_cable{k}" width="0.0008" rgba="0.9 0.5 0.2 1">'
                + "".join(f'<site site="{site}"/>' for site in path.split())
                + "</spatial>"
            )
            cable_actuators.append(
                f'    <motor name="{name}_cable{k}" tendon="{name}_cable{k}" ctrllimited="true" ctrlrange="{_v(-spec.stalk.max_pull, 0)}"/>'
            )

    swing_ctrl = spec.dims.arm_swing
    return f"""<mujoco model="mosfet-bot">
  <compiler angle="degree" autolimits="true"/>
  <option timestep="0.001" integrator="implicitfast"/>
  <visual><headlight diffuse="0.6 0.6 0.6" ambient="0.3 0.3 0.3"/><global offwidth="1280" offheight="720"/></visual>
  <default>
    <geom contype="2" conaffinity="1" friction="1 0.005 0.0001" rgba="0.24 0.84 0.64 1"/>
    <default class="arm"><geom rgba="0.09 0.32 0.24 1"/></default>
    <default class="wheel"><geom rgba="0.12 0.42 0.32 1" friction="1.4 0.01 0.001"/></default>
    <default class="motor"><geom contype="0" conaffinity="0" rgba="0.55 0.57 0.6 1"/></default>
    <default class="hub"><geom contype="0" conaffinity="0" rgba="0.05 0.07 0.09 1"/></default>
    <default class="guide"><geom contype="0" conaffinity="0" rgba="0.12 0.42 0.32 1"/></default>
    <!-- Stalks and eyes collide with the world (contype 2 / conaffinity 1 pairs with the floor but not with the bot),
         so a stalk can be used as a limb: reach out, poke something, curl around it. -->
    <default class="stalk"><geom type="capsule" contype="2" conaffinity="1"/></default>
    <default class="eye"><geom contype="2" conaffinity="1"/></default>
    <default class="lcd"><geom contype="0" conaffinity="0" mass="0.0001" rgba="1 1 1 1"/></default>
    <default class="lens"><geom contype="0" conaffinity="0" rgba="0.02 0.02 0.03 1"/></default>
  </default>
  <asset>
    <mesh name="lcd_disc" inertia="shell" {_disc(d.eye_radius * 0.92)}/>
    <texture name="lcd_left" type="2d" builtin="flat" rgb1="0.78 0.81 0.75" width="{LCD_PIXELS}" height="{LCD_PIXELS}"/>
    <texture name="lcd_right" type="2d" builtin="flat" rgb1="0.78 0.81 0.75" width="{LCD_PIXELS}" height="{LCD_PIXELS}"/>
    <material name="lcd_left" texture="lcd_left" emission="0.35" specular="0.1"/>
    <material name="lcd_right" texture="lcd_right" emission="0.35" specular="0.1"/>
    <texture name="grid" type="2d" builtin="checker" rgb1="0.1 0.12 0.15" rgb2="0.13 0.15 0.19" width="512" height="512"/>
    <material name="grid" texture="grid" texrepeat="8 8" reflectance="0.1"/>
  </asset>
  <worldbody>
    <light pos="0 0 2" dir="0 0 -1"/>
    <geom name="floor" type="plane" size="3 3 0.05" material="grid" contype="1" conaffinity="1"/>
    <body name="bot" pos="{_v(0, 0, drum_z + 0.002)}">
      <freejoint name="bot"/>
      <!-- With both wheels on one axle the bot tips back onto the drum: a three-point stance, so it never has to balance.
           The drum's contact is a low-friction skid pad so it slides instead of dragging. -->
      <geom name="drum" type="cylinder" euler="90 0 0" size="{_v(d.drum_radius, d.drum_half_length)}" mass="{_f(spec.drum_mass)}" friction="{_v(spec.skid_friction, 0.001, 0.0001)}"/>
      <!-- Arm gearmotors, inside the drum's ends on the pivot axis; each output shaft turns its arm. -->
      <geom name="arm_motor_left" class="motor" type="cylinder" euler="90 0 0" pos="{_v(0, d.drum_half_length - spec.arm_motor.length / 2, d.arm_pivot_rise)}" size="{_v(spec.arm_motor.radius, spec.arm_motor.length / 2)}" mass="{_f(spec.arm_motor.mass)}"/>
      <geom name="arm_motor_right" class="motor" type="cylinder" euler="90 0 0" pos="{_v(0, -d.drum_half_length + spec.arm_motor.length / 2, d.arm_pivot_rise)}" size="{_v(spec.arm_motor.radius, spec.arm_motor.length / 2)}" mass="{_f(spec.arm_motor.mass)}"/>
      <!-- Battery low and forward inside the drum, so most of the weight sits over the wheels, not the skid. -->
      <geom name="battery" type="box" contype="0" conaffinity="0" rgba="0.1 0.1 0.1 1" pos="{_v(d.drum_radius * spec.battery_forward, 0, -d.drum_radius * 0.4)}" size="{_v(d.drum_radius * 0.25, d.drum_half_length * 0.7, d.drum_radius * 0.18)}" mass="{_f(spec.battery_mass)}"/>
      <camera name="face" pos="0.36 0 0.2" xyaxes="0 1 0 -0.1 0 0.99" fovy="40"/>
      <camera name="follow" mode="trackcom" pos="0.55 -0.55 0.35" xyaxes="0.7 0.7 0 -0.25 0.25 0.93"/>
{"".join(arms)}
{chr(10).join(stalk_bodies)}
    </body>
    <!-- Something to poke: the stalks can reach it, and it is last so it never shifts the bot's state indices. -->
    <body name="ball" pos="{_v(BALL_START[0], BALL_START[1], BALL_START[2])}">
      <freejoint name="ball"/>
      <geom name="ball" type="sphere" size="0.03" mass="0.05" rgba="0.95 0.55 0.25 1" contype="1" conaffinity="3"/>
    </body>
  </worldbody>
  <tendon>
{chr(10).join(tendons)}
  </tendon>
  <actuator>
    <position name="arm_left" joint="arm_left" kp="{_f(spec.arm_kp)}" ctrlrange="-1.4 1.4" forcerange="{_v(-spec.arm_motor.torque, spec.arm_motor.torque)}"/>
    <position name="arm_right" joint="arm_right" kp="{_f(spec.arm_kp)}" ctrlrange="-1.4 1.4" forcerange="{_v(-spec.arm_motor.torque, spec.arm_motor.torque)}"/>
    <!-- Wheels are torque-controlled so the balance controller can hold it upright on two wheels. -->
    <motor name="wheel_left" joint="wheel_left" ctrlrange="{_v(-spec.wheel_motor.torque, spec.wheel_motor.torque)}"/>
    <motor name="wheel_right" joint="wheel_right" ctrlrange="{_v(-spec.wheel_motor.torque, spec.wheel_motor.torque)}"/>
{chr(10).join(cable_actuators)}
  </actuator>
  <keyframe>
    <key name="stand" qpos="{_rest_qpos(drum_z + 0.002, spec)}" ctrl="{_v(-swing_ctrl, -swing_ctrl, 0, 0, *([0] * 6))}"/>
  </keyframe>
</mujoco>
"""


def _rest_qpos(z: float, spec: BotSpec) -> str:
    """Free joint at rest, arms at their resting swing, everything else zero."""
    swing = -spec.dims.arm_swing  # negative hinge angle swings the arm forward (+x)
    free = [0, 0, z, 1, 0, 0, 0]
    arm_and_wheel = [swing, 0]  # per side: arm hinge, wheel hinge
    stalk = [0.0] * (spec.stalk.segments * 2)
    ball = [*BALL_START, 1, 0, 0, 0]
    left = arm_and_wheel
    right = arm_and_wheel
    # Body order in the model: arm_left, wheel_left, arm_right, wheel_right, stalk chains, then the ball.
    return _v(*free, *left, *right, *stalk, *stalk, *ball)


def actuator_index(model, name: str) -> int:  # type: ignore[no-untyped-def]
    import mujoco

    return mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_ACTUATOR, name)


def load(spec: BotSpec = BotSpec()):  # type: ignore[no-untyped-def]
    """Compile the model and return (model, data) reset to the standing keyframe."""
    import mujoco

    model = mujoco.MjModel.from_xml_string(build_mjcf(spec))
    data = mujoco.MjData(model)
    mujoco.mj_resetDataKeyframe(model, data, 0)
    mujoco.mj_forward(model, data)
    return model, data


if __name__ == "__main__":
    print(build_mjcf())
