"""Render proof views through the running OCP viewer and save them as PNGs.

uv run python shots.py OUTDIR [PORT [SETTLE_S]]  # needs `python -m ocp_viewer --port PORT` running (default 3939)
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

from build123d import Pos
from ocp_viewer import Camera, save_screenshot, set_port, show

from mosfet_cad.assembly import bot
from mosfet_cad.geom import box
from mosfet_cad.kit import kit
from mosfet_cad.part import Part


def _show(parts: list[Part], position, target, up="Z", zoom=1.0):
    show(
        *[p.world() for p in parts],
        names=[p.name for p in parts],
        colors=[p.color for p in parts],
        position=position,
        target=target,
        up=up,
        zoom=zoom,
        reset_camera=Camera.RESET,
        tree_width=0,
    )


def section(parts: list[Part], keep_y_below: float = 0.0) -> list[Part]:
    """Half-section: cut away everything with y > keep_y_below."""
    cutter = box((-1000, keep_y_below, -1000), (1000, 1000, 1000))
    out = []
    for p in parts:
        w = p.world().cut(cutter)
        if w is not None and w.volume > 0:
            out.append(Part(p.name, w, p.color, printed=p.printed))
    return out


def main(outdir: str, port: int = 3939, settle: float = 2.0) -> None:
    out = Path(outdir)
    out.mkdir(parents=True, exist_ok=True)
    set_port(port)
    whole = bot()
    dock = [p for p in whole if p.name.startswith(("dock", "REF pogo", "REF April", "REF IR"))]
    shots = {
        "bot_iso": (whole, (900, -700, 650), (60, 0, 230), 1.0),
        "bot_front": (whole, (1400, 0, 280), (60, 0, 280), 1.0),  # the dock's charging hardware is all behind the bot
        "dock_iso": (dock, (900, -800, 700), (-50, 0, 60), 0.8),
        "dock_back_iso": (dock, (-900, 750, 600), (-50, 0, 60), 0.8),
        "bot_side": (whole, (60, -1400, 280), (60, 0, 280), 1.0),
        "bot_back_iso": (whole, (-800, 700, 600), (60, 0, 230), 1.0),
        "bot_section": (
            section([p for p in whole if not p.name.startswith(("dock", "REF pogo", "REF April"))], 0.0),
            (60, 1300, 250),
            (40, 0, 230),
            1.1,
        ),
        # the drum seated at the foot of the cradle's curve, cut at y = -12 so the SENSE and GND pins show under the skid
        "dock_section": (section(whole, -12.0), (-20, 1300, 150), (-20, 0, 120), 1.3),
    }
    # the winches with the drum's top half, the eyes and the far end cap off: the deck in front, a back winch each side
    bay = [p for p in whole if not p.name.startswith(("drum upper", "dock", "REF pogo", "REF April", "REF IR", "end cap L"))]
    bay = [p for p in bay if " eye " not in p.name and "round display" not in p.name and "stalk" not in p.name]
    shots["bot_winches"] = (bay, (700, 650, 700), (20, 0, 130), 1.6)
    # the front of the drum close up: the speaker grille and the two mic ports
    shots["bot_voice"] = (whole, (900, -350, 450), (70, 0, 190), 2.0)
    k = kit()
    stalk_eye = [p for p in k if "winch" not in p.name]
    lower = [p for p in stalk_eye if p.name.startswith(("stalk base", "REF stalk spring", "stalk spring", "stalk guide 1"))]
    # the closed end in the base plate's seat cup and the first guide disc screwed onto the coil, cut through the axis
    shots["stalk_seat_section"] = (section(lower, 0.0), (0, 320, 30), (0, 0, 30), 2.2)
    # side view: the screen centre sits on the stalk axis, the mount's spine behind it
    shots["stalk_eye_side"] = (stalk_eye, (0, -900, 160), (0, 0, 160), 1.0)
    shots["stalk_eye_front"] = (stalk_eye, (900, 0, 160), (0, 0, 160), 1.0)
    shots["stalk_kit"] = (k, (450, -420, 300), (-60, 0, 120), 1.0)
    for name, (parts, pos, target, zoom) in shots.items():
        _show(parts, pos, target, zoom=zoom)
        time.sleep(settle)  # a software-GL (headless) viewer needs longer to draw
        save_screenshot(str(out / f"{name}.png"))
        time.sleep(1.0)
        print("saved", out / f"{name}.png")
    _show(whole + [p.placed(Pos(0, 520, 0)) for p in k], (900, -700, 650), (60, 150, 230))


if __name__ == "__main__":
    main(
        sys.argv[1] if len(sys.argv) > 1 else "out/shots",
        int(sys.argv[2]) if len(sys.argv) > 2 else 3939,
        float(sys.argv[3]) if len(sys.argv) > 3 else 2.0,
    )
