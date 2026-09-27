"""Render proof views through the running OCP viewer and save them as PNGs.

uv run python shots.py OUTDIR      # needs `python -m ocp_viewer --port 3939` running
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


def main(outdir: str) -> None:
    out = Path(outdir)
    out.mkdir(parents=True, exist_ok=True)
    set_port(3939)
    whole = bot()
    no_mast = [p for p in whole if "mast" not in p.name and "AprilTag" not in p.name]
    shots = {
        "bot_iso": (whole, (900, -700, 650), (60, 0, 230), 1.0),
        "bot_front": (no_mast, (1400, 0, 280), (60, 0, 280), 1.0),
        "bot_side": (whole, (60, -1400, 280), (60, 0, 280), 1.0),
        "bot_back_iso": (whole, (-800, 700, 600), (60, 0, 230), 1.0),
        "bot_section": (
            section([p for p in whole if not p.name.startswith(("dock", "REF pogo", "REF April"))], 0.0),
            (60, 1300, 250),
            (40, 0, 230),
            1.1,
        ),
    }
    k = kit()
    stalk = [p for p in k if "stalk" in p.name][:4]
    shots["stalk_segments_section"] = (section(stalk), (0, 260, 60), (0, 0, 45), 1.0)
    shots["stalk_kit"] = (k, (450, -420, 300), (-40, 0, 120), 1.0)
    for name, (parts, pos, target, zoom) in shots.items():
        _show(parts, pos, target, zoom=zoom)
        time.sleep(2.0)
        save_screenshot(str(out / f"{name}.png"))
        time.sleep(1.0)
        print("saved", out / f"{name}.png")
    _show(whole + [p.placed(Pos(0, 520, 0)) for p in k], (900, -700, 650), (60, 150, 230))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "out/shots")
