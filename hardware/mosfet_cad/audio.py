"""Voice: a speaker firing out of the drum's front, and a two-mic echo-cancelling array under the crown.

Chain: Jetson USB -> Seeed reSpeaker Lite (XMOS XU316, USB Audio Class 2: capture and playback on one device) ->
3.5 mm headphone out -> Adafruit PAM8302A 2.5 W class-D -> Adafruit 3968 40 mm 4 ohm speaker. The array plays what
the Jetson sends and cancels that same signal from its mics, so the bot hears people while it talks.

- **Speaker**: on the centreline (y = 0) in front of the winch deck's driver plate, firing forward through a grille
  in the shell. Its sealed back box is a cup fused to the driver plate (`speaker_cup`, part of the deck): the plate is
  the back wall, the speaker drops in from the front onto a ledge, and a foam ring between its flange and the shell
  seals it.
- **Mics**: the reSpeaker Lite (35 x 86) lies against the inside of the upper shell, long side along y, 65 degrees up
  the front, between the stalk pedestals and the winch deck's tubes. It screws onto four bosses on the shell
  (`mic_bosses`, part of the drum upper), mics toward the shell over two ports (`mic_ports`), a foam gasket round
  each.

Drum frame (body.py): x forward, y left, z up, origin on the drum axis at mid-length.
"""

from __future__ import annotations

import math
from functools import cache

from build123d import Location, Plane

from .geom import box, cut, cyl, fuse

# --- speaker: Adafruit 3968, 40 mm, 4 ohm, 3 W (5 W since 2024). Shape UNVERIFIED: a 40 mm flange 3 thick and a
# 29 mm magnet, 20 mm deep in all ---------------------------------------------------------------------------------
SPK_D, SPK_DEPTH, SPK_FLANGE_T, SPK_MAGNET_D = 40.0, 19.5, 3.0, 29.0
SPK_Z = 5.0  # speaker axis height, horizontal along +x at y = 0
SPK_FRONT_X = 111.0  # flange front face: 1.2 mm inside the shell at the flange's top edge, for a foam ring
PLATE_FRONT_X = 91.0  # the winch deck's driver plate front face: the cup's back wall
CUP_WALL = 2.0
CUP_IN = SPK_D / 2 + 0.5  # interior half-width, y and z
LEDGE_T = 2.0  # the flange sits on it
GRILLE_R = 15.0  # holes within this radius of the speaker axis
GRILLE_HOLE = 2.4
GRILLE_PITCH = 4.0

# --- mic array: Seeed reSpeaker Lite, 35 x 86 PCB (datasheet). Thickness, hole positions and mic positions
# UNVERIFIED: measure the board and set them here ------------------------------------------------------------------
MIC_BOARD = (86.0, 35.0, 1.6)  # along y, along the shell's curve, thick
MIC_DEG = 65.0  # board centre direction from +x toward +z (xz-angle)
MIC_D = 109.0  # the board's mic-side face, distance from the drum axis: 6 mm inside the shell at the centre
MIC_HOLES = ((-39.5, -14.0), (39.5, -14.0), (-39.5, 14.0), (39.5, 14.0))  # M2, board frame (x along y)
MIC_PORTS = ((-32.0, 0.0), (32.0, 0.0))  # the two MEMS mics, board frame
MIC_PARTS_T = 5.0  # connectors and parts on the inner face (USB-C, 3.5 mm jack, speaker header)
AMP_BOARD = (17.8, 20.3, 4.0)  # Adafruit PAM8302A (2130), 0.7 x 0.8 in, on the cup's left wall


def mic_frame() -> Location:
    """Board frame: origin on the mic-side face at the board centre, x along the drum axis (y), z out toward the
    shell."""
    a = math.radians(MIC_DEG)
    n = (math.cos(a), 0.0, math.sin(a))
    return Location(Plane(origin=(MIC_D * n[0], 0.0, MIC_D * n[2]), x_dir=(0, 1, 0), z_dir=n))


@cache
def speaker_cup():
    """The speaker's back box, drum frame: a square tube from the driver plate forward to the shell (the deck clips it
    to the shell), with a ledge ring the flange sits on. The deck fuses it on."""
    x0, x1, zc, w = PLATE_FRONT_X - 0.01, 118.0, SPK_Z, CUP_IN + CUP_WALL
    ledge_x = SPK_FRONT_X - SPK_FLANGE_T
    body = box((x0, -w, zc - w), (x1, w, zc + w))
    inner = box((x0 + 0.01 + 0.0, -CUP_IN, zc - CUP_IN), (x1 + 1, CUP_IN, zc + CUP_IN))
    body = cut(body, inner)
    ledge = cut(
        box((ledge_x - LEDGE_T, -CUP_IN - 0.01, zc - CUP_IN - 0.01), (ledge_x, CUP_IN + 0.01, zc + CUP_IN + 0.01)),
        cyl((ledge_x - LEDGE_T - 1, 0, zc), (ledge_x + 1, 0, zc), SPK_MAGNET_D / 2 + 1.5),
    )
    return fuse(body, ledge)


def speaker_ref():
    x1 = SPK_FRONT_X
    x0 = x1 - SPK_FLANGE_T
    return fuse(
        cyl((x0, 0, SPK_Z), (x1, 0, SPK_Z), SPK_D / 2),
        cyl((x1 - SPK_DEPTH, 0, SPK_Z), (x0 + 0.01, 0, SPK_Z), SPK_MAGNET_D / 2),
    )


def amp_ref():
    """PAM8302A on the cup's left outside wall, parts side out."""
    w = CUP_IN + CUP_WALL
    bw, bh, bt = AMP_BOARD
    return box((PLATE_FRONT_X + 2, w + 0.5, SPK_Z - bh / 2), (PLATE_FRONT_X + 2 + bw, w + 0.5 + bt, SPK_Z + bh / 2))


def grille_tools():
    """Holes through the shell in front of the speaker, on a hex grid within GRILLE_R of its axis."""
    out = []
    rows = int(GRILLE_R // (GRILLE_PITCH * math.sqrt(3) / 2))
    for j in range(-rows, rows + 1):
        z = j * GRILLE_PITCH * math.sqrt(3) / 2
        off = GRILLE_PITCH / 2 if j % 2 else 0.0
        k = int(GRILLE_R // GRILLE_PITCH) + 1
        for i in range(-k, k + 1):
            y = i * GRILLE_PITCH + off
            if math.hypot(y, z) <= GRILLE_R - GRILLE_HOLE / 2:
                out.append(cyl((100.0, y, SPK_Z + z), (125.0, y, SPK_Z + z), GRILLE_HOLE / 2))
    return out


def mic_ref():
    bl, bw, bt = MIC_BOARD
    pcb = box((-bl / 2, -bw / 2, -bt), (bl / 2, bw / 2, 0))
    parts = box((-bl / 2 + 8, -bw / 2 + 3, -bt - MIC_PARTS_T), (bl / 2 - 8, bw / 2 - 3, -bt + 0.01))
    tools = [cyl((x, y, -bt - 1), (x, y, 1), 1.1) for x, y in MIC_HOLES]
    return cut(fuse(pcb, parts), *tools).moved(mic_frame())


def mic_bosses():
    """Four bosses from the shell down to the board's mic-side face, drum frame; fused into the drum upper."""
    return [cyl((x, y, 0), (x, y, 10), 3.0).moved(mic_frame()) for x, y in MIC_HOLES]


def mic_tools():
    """M2 pilots in the bosses and the two mic ports through the shell, drum frame."""
    t = [cyl((x, y, -1), (x, y, 5), 0.8) for x, y in MIC_HOLES]
    t += [cyl((x, y, -1), (x, y, 15), 0.8) for x, y in MIC_PORTS]
    return [s.moved(mic_frame()) for s in t]
