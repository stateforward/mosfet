"""Build the mosfet CAD: show it in the OCP viewer, check it fits the printer, export STEP and per-part 3MF/STL.

    uv run python build.py              # whole bot on its dock + stalk kit: check, export, show
    uv run python build.py --only kit   # just the stalk test kit
    uv run python build.py --no-show    # headless (no viewer needed)
    uv run python build.py --no-export

The viewer: `uv run python -m ocp_viewer --port 3939`, then open http://localhost:3939.
"""

from __future__ import annotations

import argparse
import math
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


TENDON_EA = 4350.0  # N: PowerPro Spectra 65 lb, ~0.079 mm2 of fibre at ~55 GPa (UNVERIFIED)
TUBE_MU = 0.07  # Spectra on PTFE (UNVERIFIED): the capstan loss in a tube is exp(mu * its turning)


def bend_time(deg: float, friction: float = 1.0) -> float:
    """Seconds for one winch to pull a straight stalk to deg degrees at 12 V, the other two paying out."""
    from mosfet_cad.params import PULLEY_R, STALK, WINCH_MOTOR

    s, m, t, steps = STALK, WINCH_MOTOR, 0.0, 180
    for i in range(steps):
        d0, d1 = deg * i / steps, deg * (i + 1) / steps
        dl = s.tendon_r * math.radians(d1 - d0) + (s.pull(d1) - s.pull(d0)) / s.rate  # tendon taken in, mm
        nm = s.pull((d0 + d1) / 2) * friction * PULLEY_R / 1000
        t += dl / (m.rpm(nm) / 60 * 2 * math.pi * PULLEY_R)
    return t


def stalk_report() -> str:
    """The spring spine's numbers: what bends the stalk, what holds it, and what that costs the winches."""
    from mosfet_cad import body as B
    from mosfet_cad.params import EYE, EYE_KG, PULLEY_R, SPECTRA_N, STALK, STALK_SPLAY, WINCH_LIMIT_A, WINCH_MOTOR
    from mosfet_cad.winch import tube_runs, tube_turn_deg

    s, sp, m = STALK, STALK.spring, WINCH_MOTOR
    lines = [
        f"\n== stalk spring: {sp.name} ({sp.material}, {'printed' if sp.printed else 'bought'}) ==",
        (
            f"OD {sp.od:.1f} x wire {sp.wire:.3f} x {sp.free_length:.1f} free, pitch {sp.pitch:.2f}, {sp.coils:.1f} coils, "
            f"ID {sp.id:.1f}, mean D {sp.mean_d:.2f}; {sp.rate:.2f} N/mm as cut"
        ),
        (
            f"collars and discs grip {sp.free_length - s.bend_length:.1f} mm; {s.bend_length:.1f} mm of free coil bends: "
            f"{s.rate:.2f} N/mm installed"
        ),
        (
            f"preload {s.tendons} x {s.pretension:.0f} N = {s.preload:.0f} N squeezes it {s.preload_shortening:.1f} mm, to "
            f"{s.installed_length:.1f} (stalk {s.length:.1f} base to tip); EI {sp.ei:.3f} free, {s.ei:.3f} N·m2 installed"
        ),
    ]
    for deg in (90.0, 120.0):
        pull = s.pull(deg)
        lines.append(
            f"{deg:.0f} deg: {s.moment(deg):.2f} N·m at the root, {pull:.0f} N on the pulling tendon at r {s.tendon_r:.1f} "
            f"({s.moment(deg) / (s.tendon_r / 1000):.0f} + {s.pretension:.0f} held by the others), "
            f"{pull * PULLEY_R / 1000:.2f} N·m at the pulley; shortens {s.shortening(deg):.1f} mm more; "
            f"{bend_time(deg):.1f} s at 12 V"
        )
    lever = s.plate_t + EYE.centre_z
    w = EYE_KG * 9.81
    crit = s.buckle_load(lever)
    sag_free = STALK_SPLAY / (1 - w / crit)
    tendon_l = s.length + 120  # stalk plus a tube run
    k_tendons = 1.5 * TENDON_EA / (tendon_l / 1000) * (s.tendon_r / 1000) ** 2  # N·m/rad, three tendons at 120 deg
    reach = (s.length + EYE.centre_z) / 1000
    m_splay = w * reach * math.sin(math.radians(STALK_SPLAY))
    sag_locked = math.degrees(m_splay / (k_tendons + s.ei / (s.bend_length * s.squeeze / 1000)))
    lines.append(
        f"eye {EYE_KG * 1000:.0f} g, {lever:.1f} over the spring: folds at {crit:.2f} N, {crit / w:.1f} x its weight; "
        f"winches slack, the {STALK_SPLAY:.0f} deg splay would sag to {sag_free:.1f} deg; tendons locked, it sags "
        f"{sag_locked:.2f} deg more (tendon stretch, EA {TENDON_EA:.0f} N)"
    )
    rated_pull = m.rated_nm / (PULLEY_R / 1000)
    limit_pull = m.torque(WINCH_LIMIT_A) / (PULLEY_R / 1000)
    bind = math.degrees((1 - sp.wire / (sp.pitch * s.squeeze)) / (sp.mean_d / 2000) * s.bend_length * s.squeeze / 1000)
    lines.append(
        f"reach: {s.deg_at(rated_pull):.0f} deg at the rated {m.rated_nm} N·m ({rated_pull:.0f} N), "
        f"{s.deg_at(limit_pull):.0f} deg at the {WINCH_LIMIT_A} A chop limit ({limit_pull:.0f} N, "
        f"{limit_pull / SPECTRA_N:.0%} of the Spectra's {SPECTRA_N:.0f} N); the coils would bind at {bind:.0f} deg"
    )
    lines.append(f"guide discs at {', '.join(f'{z:.1f}' for z in s.guide_z)} mm up the free spring")
    lines.append(f"\n== winches: 6 x {m.name}, {PULLEY_R:.0f} mm pulley ==")
    lines.append(
        f"{m.counts} counts/rev ({2 * math.pi * PULLEY_R / m.counts * 1000:.1f} um of tendon each); "
        f"{m.kt:.2f} N·m/A over {m.no_load_a} A no-load; 0 A holding (worm, self-locking)"
    )
    runs = tube_runs(B.stalk_root)
    worst = 1.0
    for label, _, path in runs:
        turn = tube_turn_deg(path)
        cap = math.exp(TUBE_MU * math.radians(turn))
        worst = max(worst, cap)
        lines.append(f"PTFE {label}: {path.length:.0f} mm, turns {turn:.0f} deg, capstan x{cap:.2f} at mu {TUBE_MU}")
    lines.append(
        f"through the worst tube (x{worst:.2f}): 90 deg takes {s.pull(90) * worst * PULLEY_R / 1000:.2f} N·m and "
        f"{bend_time(90, worst):.1f} s; reach {s.deg_at(rated_pull / worst):.0f} deg rated, "
        f"{s.deg_at(limit_pull / worst):.0f} deg at the chop limit"
    )
    return "\n".join(lines)


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
    print(stalk_report())
    if not args.no_export:
        print(f"\nexported to {OUT}")

    if not args.no_show:
        show_group = groups.get("mosfet") or groups["stalk_kit"]
        if "mosfet" in groups and "stalk_kit" in groups:
            show_group = groups["mosfet"] + [p.placed(Pos(0, 520, 0)) for p in groups["stalk_kit"]]
        show_parts(show_group, args.port)
    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main())
