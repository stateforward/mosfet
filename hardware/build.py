"""Build the mosfet CAD: show it in the OCP viewer, check it fits the printer, export STEP and per-part 3MF/STL.

    uv run python build.py              # whole bot on its dock + stalk kit: check, export, show
    uv run python build.py --only kit   # just the stalk test kit
    uv run python build.py --no-show    # headless (no viewer needed)
    uv run python build.py --no-export

The viewer: `uv run python -m ocp_viewer --port 3939`, then open http://localhost:3939.
"""

from __future__ import annotations

import argparse
import re
import sys
import time
from pathlib import Path

from build123d import Compound, Mesher, Pos, export_step, export_stl

from mosfet_cad.params import BED, BED_MARGIN
from mosfet_cad.part import Part

OUT = Path(__file__).parent / "out"


def slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")


def unique_printed(parts: list[Part]) -> dict[str, tuple[Part, int]]:
    """One entry per distinct printed shape (identical segments share one file) with how many to print."""
    by_shape: dict[int, list[Part]] = {}
    for p in parts:
        if p.printed:
            by_shape.setdefault(id(p.shape), []).append(p)
    out: dict[str, tuple[Part, int]] = {}
    for group in by_shape.values():
        stem = slug(re.sub(r" \d+$", "", group[0].name))
        if len({slug(re.sub(r" \d+$", "", p.name)) for p in group}) > 1:
            stem = re.sub(r"^[lr]_", "", stem)  # the same shape on both sides
        while stem in out:  # different shapes that share a name keep separate files
            stem += "_b"
        out[stem] = (group[0], len(group))
    return out


def fit_report(parts: dict[str, tuple[Part, int]]) -> tuple[list[str], bool]:
    limit = BED - 2 * BED_MARGIN
    lines, ok = [], True
    for stem, (p, qty) in sorted(parts.items()):
        size = p.printable().bounding_box().size
        dims = sorted((size.X, size.Y, size.Z), reverse=True)
        fits = size.X <= limit and size.Y <= limit and size.Z <= limit
        ok &= fits
        lines.append(
            f"{'ok  ' if fits else 'FAIL'} {qty:2d} x {stem:28s} {size.X:6.1f} x {size.Y:6.1f} x {size.Z:6.1f} mm  (max {dims[0]:.1f})"
        )
    lines.append(
        f"limit {limit:.0f} mm per axis (X1 {BED:.0f} mm less {BED_MARGIN:.0f} mm margin each side): {'ALL FIT' if ok else 'SOMETHING DOES NOT FIT'}"
    )
    return lines, ok


def clash_report(parts: list[Part], min_volume: float = 1.0) -> list[str]:
    """Every pair of parts whose solids overlap by more than min_volume mm^3 (press fits show up too)."""
    world = [(p.name, p.world()) for p in parts]
    boxes = [w.bounding_box() for _, w in world]

    def near(a, b) -> bool:
        return all(getattr(a.min, k) < getattr(b.max, k) and getattr(b.min, k) < getattr(a.max, k) for k in "XYZ")

    lines = []
    for i in range(len(world)):
        for j in range(i + 1, len(world)):
            if near(boxes[i], boxes[j]):
                common = world[i][1] & world[j][1]
                volume = common.volume if common is not None else 0.0
                if volume > min_volume:
                    lines.append(f"{volume:9.1f} mm3  {world[i][0]}  x  {world[j][0]}")
    return lines


def export(parts: list[Part], printed: dict[str, tuple[Part, int]], name: str) -> None:
    OUT.mkdir(exist_ok=True)
    (OUT / "print").mkdir(exist_ok=True)
    assembly = []
    for p in parts:
        s = p.world()
        s.label, s.color = p.name, p.color
        assembly.append(s)
    export_step(Compound(children=assembly, label=name), OUT / f"{name}.step")
    for stem, (p, _) in printed.items():
        s = p.printable()
        bb = s.bounding_box()
        s = s.moved(Pos(-bb.center().X, -bb.center().Y, -bb.min.Z))  # centred on the bed, sitting on it
        export_stl(s, OUT / "print" / f"{stem}.stl")
        mesher = Mesher()
        mesher.add_shape(s)
        mesher.write(OUT / "print" / f"{stem}.3mf")


def show_parts(parts: list[Part], port: int) -> None:
    from ocp_viewer import set_port, show

    set_port(port)
    shapes, names, colors = [], [], []
    for p in parts:
        shapes.append(p.world())
        names.append(p.name)
        colors.append(p.color)
    show(*shapes, names=names, colors=colors, reset_camera="keep")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", choices=["kit", "bot", "all"], default="all")
    ap.add_argument("--no-show", action="store_true")
    ap.add_argument("--no-export", action="store_true")
    ap.add_argument("--port", type=int, default=3939)
    ap.add_argument("--clash", action="store_true", help="list overlapping parts (slow)")
    args = ap.parse_args()

    t0 = time.time()
    from mosfet_cad.kit import kit

    groups: dict[str, list[Part]] = {}
    if args.only in ("kit", "all"):
        groups["stalk_kit"] = kit()
    if args.only in ("bot", "all"):
        from mosfet_cad.assembly import bot

        groups["mosfet"] = bot()
    print(f"built in {time.time() - t0:.1f} s")

    all_ok = True
    for name, parts in groups.items():
        printed = unique_printed(parts)
        lines, ok = fit_report(printed)
        all_ok &= ok
        print(f"\n== {name}: {len(parts)} parts, {len(printed)} distinct printed ==")
        print("\n".join(lines))
        if args.clash:
            clashes = clash_report(parts)
            print(f"-- {name}: {len(clashes)} overlapping pairs --")
            print("\n".join(clashes))
        if not args.no_export:
            export(parts, printed, name)
    if not args.no_export:
        from mosfet_cad.kit import fit_sweep

        OUT.mkdir(exist_ok=True)
        for stem, shape in fit_sweep():
            export_stl(shape, OUT / "print" / f"{stem}.stl")
        print(f"\nexported to {OUT}")

    if not args.no_show:
        show_group = groups.get("mosfet") or groups["stalk_kit"]
        if "mosfet" in groups and "stalk_kit" in groups:
            show_group = groups["mosfet"] + [p.placed(Pos(0, 520, 0)) for p in groups["stalk_kit"]]
        show_parts(show_group, args.port)
    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main())
