# hardware

The real mosfet: parametric, printable CAD in Python ([build123d](https://github.com/gumyr/build123d)). Bought
parts are off the shelf; everything else prints on a Bambu Lab X1 (256 mm cube). The look is the character in
`web/src/face/critter.ts` and `sim/bot.py`, scaled up as far as the printer allows.

```sh
cd hardware
uv sync
uv run python -m ocp_viewer --port 3939 &   # live viewer: open http://localhost:3939
uv run python build.py                      # build, check fit, export, show in the viewer
uv run python build.py --only kit           # just the spring-stalk test kit
uv run python build.py --clash --no-show    # also list every pair of overlapping parts
uv run python shots.py out/shots            # render the proof views through the viewer
uv run python shots.py out/shots 3947 10    # ...through a second viewer on 3947, 10 s per view (headless GL)
```

`build.py` writes to `out/` (git-ignored):

- `out/mosfet.step`, `out/stalk_kit.step`: assemblies with named, coloured parts, for Shapr3D or any CAD.
- `out/print/<part>.3mf` and `.stl`: one file per distinct printed part, already in its print orientation,
  centred and sitting on the bed, for Bambu Studio. The fit report says how many of each to print.

It also prints the stalk spring's numbers: bending stiffness, axial rate, the tendon pull for a 90° bend and how
much the spring shortens under it.

The build fails (exit 1) if any printed part's bounding box, in its print orientation, is bigger than 250 mm
on any axis (256 mm less 3 mm margin each side).

| File | What |
|---|---|
| `mosfet_cad/params.py` | every driving dimension: character ratios, bought-part sizes, `SpringSpec`, `StalkSpec`, `EyeSpec`, `CellSpec`, `PackSpec`, docked pose |
| `mosfet_cad/stalk.py` | spring, base plate, guide disc, tip plate, tendon pulley, stalk servo pod |
| `mosfet_cad/eye.py` | eye bezel with camera bump and chin, eye back cover |
| `mosfet_cad/kit.py` | the spring-stalk test kit |
| `mosfet_cad/body.py` | drum halves, end caps, tray, shelf, battery cradle, driver mount, skid, gears, arms, wheels |
| `mosfet_cad/dock.py` | charging dock: curved stop cradle with the pins in its seat, tower with the tag |
| `mosfet_cad/assembly.py` | the whole bot in its docked pose, on the dock |

Frames follow the sim: x forward, y left (the drum axis), z up; millimetres. Anything marked UNVERIFIED below
is a parameter in `params.py`. Measure the real part and change the number.

## Size

The drum radius sets the scale: `DRUM_R = 118` (Ø236, the biggest round drum that prints on the X1). Every other
proportion comes from `GEOMETRY` in `sim/bot.py`:

| | value |
|---|---|
| drum | Ø236 × 150 |
| wheels | Ø172 × 73 (TPU tyre 8 mm on a Ø156 rim) |
| arms | 184 pivot to axle, 80 wide, 36 thick; pivot 45 above the drum axis; parked 50° forward |
| stalks | 160 long (base plate to tip top), roots on the crown straight above the drum axis, 96 apart, splayed 5° outward |
| eyes | Ø124 bezel (Ø115 round display), camera bump on the rim; screen centre on the stalk axis, 68 above the tip |
| overall, docked | 372 wide (tyre to tyre), 357 long, 530 tall; dock 285 × 184 |

**Everything is on the centreline.** In side view the stalk roots, the stalk axes and the screen centres all
lie in the x = 0 plane, straight above the drum and arm-pivot axis, mirror-symmetric about y = 0. The drawing's
root spread (0.26 × 150 = 39 mm each side) would put two Ø120 eyes on top of each other, so the roots sit at
y = ±48 (the Ø47 pedestals end at |y| 71.5, inside the drum's 75) and each stalk leans 5° outward, sideways only.
The screen centres end up at y = ±67.9, 136 apart, with a 16 mm gap between the bezels. Gravity pulls a splayed
stalk further out, so the gap only grows.

Docked, the bot sits on its wheels (on the floor) and its skid (on the dock's 6 mm seat). The skid
touches at 12.1° behind the drum's bottom, so the body pitches back 12.1° (`params.docked_pose`), and the
straight stalks and the screens pitch back with it: docked, the screens look 12.1° up. Nothing leans forward to
cancel it. A fore-aft offset would take the eyes off the centreline, and a bent spring costs constant servo
torque. The screens are level whenever the body is. On a flat floor (`lift=0`) the pitch comes
from the common tangent of the wheel circle and the skid circle: 14.4°.

## Spring-stalk test kit (print this first)

`uv run python build.py --only kit`: one stalk (base plate, spring, 5 guide discs, tip plate), one eye, and one
servo pod with three pulleys.

**The spine is a compression spring.** It's a bought music-wire spring, 3/4 in OD × 0.120 in wire (Ø19.05 ×
3.05), cut to 150 mm with plain ends and about 9 mm pitch (`STEEL_SPRING`; part number and pitch UNVERIFIED:
any 9657K-series or Lee Spring LC-series long stock that measures close). With no tendon pulling, the spring
holds the stalk straight up. Pulling one or two tendons bends it toward them, and letting go springs it back.
That's the same model as `sim/bot.py`, where the stalk is a springy segment chain with three cables through guide
discs.

- **Stiffness.** Bending stiffness is what matters: EI = d⁴p / (32D(1/E + 1/2G)) = 0.137 N·m² for this coil
  (`SpringSpec.ei`; `build.py` prints it). It's sized for the eye, about 160 g with the tip plate, whose centre
  sits 73 mm above the spring's top. The sideways load that would buckle that is EI / (L²/2 + aL) = 6.2 N,
  about 4× the eye's weight. So the 5° splay sags only to about 6.7°, and a nudge settles instead of flopping.
  The sim's softer 1/2 in spring (EI 0.011) would fold under this eye.
- **Cost of a bend.** A 90° bend takes 1.43 N·m at the root, which is 98 N on a tendon at r = 14.5, or 0.98 N·m
  at the 10 mm pulley: about a third of an STS3215's stall (≈2.9 N·m at 12 V, UNVERIFIED). Spectra 65 lb is
  good for 289 N. Held bends cost that torque the whole time, so the rest pose is straight: the pedestals set the
  splay, and no servo holds anything.
- **It shortens under the tendons.** For a spring the shortening at a bend θ is about D²θ / (3.5 r), whatever
  the wire, which is 7.8 mm at 90° here (axial rate 12.6 N/mm). There's 99 mm of gap before the coils bind.
- **Collars and guide discs screw onto the coil.** Each has a helical groove cut by the spring itself plus
  0.25 mm (`clearance`), so it threads on along the coil and stays put without glue. The base and tip collars
  grip 1.5 turns. The five Ø35 guide discs (4 mm thick, at 21, 48, 75, 102 and 129 mm up the spring) sit a whole
  number of pitches apart (27 mm = 3 pitches), so they're one part, printed 5 times per stalk. Each carries the
  three tendon holes on r = 14.5, 5 mm off the spring. Standing the tendons off the spring is what gives them
  leverage.
- **Cables.** The display lead runs up the middle of the spring (ID 13) and through Ø12 bores in the plates.
  The USB-C plug has to fit through, so it needs a slim overmold of ≤ 11.5 mm (UNVERIFIED), or fit the plug
  after threading the cable.
- **Printed spring instead.** `PRINTED_SPRING` is a PETG coil, Ø30 × 6 mm wire at 12 mm pitch. Swap it in
  (`StalkSpec(spring=PRINTED_SPRING)`) and the collars, discs, plates and pedestal all resize from it; the kit
  builds and fits. PETG is about 100× softer than steel, though. That coil's EI is 0.017 N·m² (UNVERIFIED:
  layer lines, creep), and it buckles under about 0.75 N, less than half the eye. It's for bench-testing the
  tendons and discs with a dummy eye, not for carrying the display. Print it upright with tree supports under
  the coils. A printed coil stiff enough for the eye would be Ø36 or more, and its pedestal wouldn't fit inside
  the drum at y = ±48.

**Tendons: 3 at 120°, one servo each.** That's 3 STS3215s per stalk and 6 in all, up from 4 with the Loc-Line
stalk. A spring shortens when a tendon pulls it (7.8 mm at 90°, above), so an antagonistic pair on one double
pulley would go 7.8 mm slack on the far side and give the stalk backlash every time it changed direction.
Independent tendons stay taut, and three at 120° reach every bending direction. It's also what the sim models.
One tendon runs straight back and two run forward at ±60°. That's mirror-symmetric, so both stalks use the same
parts.

Tendons: 0.41 mm PowerPro Spectra (65 lb). Each passes through its pulley's cross hole and is knotted. At the
tip they're knotted in Ø3 counterbores on the tip plate's top face, which the eye's chin then covers. Between
the pod and the stalk base they run in 2 × 4 mm PTFE tube that seats in counterbores under the base plate and
in the pedestal.

**Base plate** (Ø47) bolts to its pedestal on the drum with 3 × M3 on Ø39 (heat-set inserts in the pedestal).
**Tip plate** (Ø43) takes the eye's chin with 2 × M3 from below. Their heads sit beside the collar and screw
into inserts in the chin. **Servo pod** holds three STS3215s side by side, shafts up, and bolts to the end cap
through a 2-hole flange. The M2 holes in its floor and the shaft offset are UNVERIFIED: check them against the
STS3215 STEP from [TheRobotStudio/SO-ARM100](https://github.com/TheRobotStudio/SO-ARM100). **Pulleys** are
single-groove, Ø20 at the groove, and bolt to the stock horn with 4 × M2 on a Ø14 circle (UNVERIFIED horn
pattern).

**Try on the bench:** screw the discs on and thread the tendons. Hang the eye (or 160 g) on the tip and check
the sag against the numbers above. That's the real test of `SpringSpec.ei`. Then pull each tendon with its
servo and measure the pull and the shortening.

## Eyes

**Display: [Waveshare ESP32-P4-WIFI6-Touch-LCD-3.4C](https://www.waveshare.com/esp32-p4-wifi6-touch-lcd-3.4c.htm).**
It's a 3.4" round IPS, 800×800, 87.6 mm active area on a Ø115 outline, with its own ESP32-P4 and Wi-Fi 6, a USB-C
(OTG HS) port, and a MIPI-CSI camera connector (15-pin, 1.0 mm). $65–75. Its Ø115 outline puts the bezel at
Ø124, closest to the sim's Ø118 eye.

- *Why not the others.* The Jetson Orin Nano dev kit has no DSI and only one DisplayPort, so HDMI round panels
  (Waveshare [4" 720×720](https://www.waveshare.com/4inch-720x720-lcd.htm),
  [5" 1080×1080](https://www.waveshare.com/5inch-1080x1080-lcd.htm)) would need a DP MST hub and a thick HDMI
  cable up each stalk. The 5" also weighs about 0.5 kg with its board, per the listing. SPI GC9A01-class rounds are
  1.28" (≈Ø32), and the ESP32-S3 rounds top out at 2.1–2.8". The same board in 4" (ESP32-P4-WIFI6-Touch-LCD-4C,
  Ø126, 720×720) is the upgrade if the stalk carries it. It's heavier, and the bezel grows to Ø135.
- *Wiring.* **One USB-C lead per stalk.** The Jetson sends frames or expression commands, and the P4 draws
  them. The P4 can also carry its camera back as a USB video device, so nothing else goes up the stalk. That
  camera path over USB is UNVERIFIED: check that ESP-IDF's `esp_video`/`usb_device_uvc` supports the IMX219 on the
  P4 before relying on it (OV5647 is the safe sensor there). The fallback keeps the research plan: an Arducam IMX219
  spy camera with a 300 mm extension, straight to the Jetson's CSI ports, 9 mm flex up the Ø12 bore, with the
  display on Wi-Fi and only power up the stalk.
- *Mount: the screen stands on its stalk.* The stalk meets the eye at the bottom of its rim (6 o'clock). The
  screen stands straight up in line with the stalk axis, and its centre sits on that axis (x = 0, y = 0), 68 mm
  above the tip plate: the rim radius plus an 8 mm chin. The display glass is on the axis too, so the eye's
  body sits 2 mm in front of it and 20 mm behind. The chin is a 36 × 20 mm lug at the bottom of the bezel. It
  sits on the tip plate and takes 2 × M3 from below into inserts. The lead comes up the spring and the tip
  plate's bore and goes into the display pocket through a 10 × 13 slot in the chin, big enough for a USB-C plug.
  Nothing hangs behind the eye.
- *Housing.* The bezel holds the glass against a 2.5 mm lip and has 4 ears with M3 inserts. Print it front face
  down; the chin prints straight up off the ring. The camera bump sits on the rim, 30° from the top toward the
  outside, clear of the glass: a Ø18 boss with a 10 × 10 mm head pocket (UNVERIFIED: spy-cam head size), a Ø7
  lens hole, and a flex path back behind the display. The eye back is a 2.5 mm cover that screws to the ears.
  `EyeSpec` has the glass diameter, the stack depth (18 mm, UNVERIFIED), the camera angle, the camera head size,
  and the chin.
- *Mass at the tip:* bezel about 33 g and back about 36 g solid PETG (less with infill), tip plate 13 g, plus
  the display (weight UNVERIFIED, Waveshare doesn't list it; budget 80 g). About 160 g in all.

## Body

- **Drum:** two half-tubes split at the axis (236 × 150 × 118 each). The top half carries the two stalk pedestals
  on the crown at x = 0, y = ±48. Each is a Ø47 boss tilted 5° outward, with its top at z = 122 so the splayed
  base plate clears the crown. Each pedestal has the Ø13 lead bore, three PTFE bores, and three M3 inserts. Both
  halves screw radially into the end-cap rims (8 × M3 into inserts).
- **End caps:** 8 mm discs inside the drum ends. Each has a 22 mm boss with two **6805-2RS** bearings (25 × 37 × 7)
  for the arm pivot, six vents, and inserts for the tray, the stalk pod, and the arm-servo mount.
- **Arm drive:** Feetech **STS3250** → printed **2:1** spur pair (m2, 16:32 teeth, centre distance 48.5 including
  0.5 mm printed backlash) → hollow Ø25 arm hub turning in the bearings. The teeth are trapezoids approximating a
  20° involute. They're good enough to print and test. If it chatters, cut true involutes (e.g. `bd_warehouse`
  gears) at the same module and centre distance. The motor and encoder leads run through the hollow hub.
- **Arms:** two 18 mm clamshell halves per arm, hollow, joined by 4 × M3 into bosses. The outer half carries a
  clamp sleeve for the **Pololu 37D** gearmotor. The motor sits inside the wheel cup with its shaft outward, and
  a Pololu 1083 hub bolts to the rim's hub face (4 holes on Ø19, UNVERIFIED). An arm is 264 mm long, so it prints
  flat and **diagonally**: 210 × 210 mm on the bed.
- **Wheels:** PETG rim (Ø156 cup, lightening holes) plus a **TPU 95A tyre**, 8 mm thick with 36 tread grooves,
  0.5 mm stretch fit.
- **Inside** (see `bot_section.png`): the battery fills the bottom of the drum (see Battery, below), and the rest
  stacks on it. The tray is the pack's lid: z −43 to −39, 2 mm over the pack's wrap, bolted to both end caps by four
  tabs (x −40 and 25). On it: the Jetson Orin Nano Super on M2.5 standoffs (86 × 58 pattern, UNVERIFIED), board
  back edge at x −65, heatsink top at z +1. Across the front of the tray are the 4S BMS, both regulators and the
  charge module. A slot at x 88–100 lets the pack leads up from the lead bay in front of the pack. The electronics
  shelf is at z 9–12, 8 mm over the heatsink and 0.9 mm under the arm servo mounts, on four posts outside the
  Jetson board. It carries the Teensy 4.1 and the BNO085, 14 mm from the drum axis. The driver mount is an upright
  plate behind the Jetson, bolted to both end caps. The MDD10A hangs on its back and the bus-servo adapter on its
  front. The stalk servo pods (three servos each) sit forward against the end caps: centre x = 67, bottom z = −20.
  The charge module stands in the gap between them, its top 1 mm below theirs. The pods' PTFE tubes run up and back
  to the crown pedestals. The arm servos and gears sit next to the end caps. Each arm servo mount's lower post is
  behind the servo (x −58), clear of the heatsink and the shelf.
- **Lead path from the arms.** The motor and encoder leads come out of each hollow arm hub (Ø19 bore) at
  |y| = 44. They run down the band |y| 40–58, x −16 to 12, between the shelf posts and past the Jetson, to the
  tray. Nothing sits in that band. It's also the route for extra packs in the arms, later: their leads come
  through the same hub bore to the BMS (see Open questions).
- **Skid:** a 4 mm PETG ski on the drum's back-bottom (UHMW tape on the running surface) with recesses for the
  three brass charge pads. Its two M3 screws go through the shell into the battery cradle (thread-forming screws in
  Ø2.5 pilots), which holds the cradle in place. The pad wires come through the shell into a 4 × 2.5 mm groove in
  the cradle's underside, run along it to the ends of the drum, and go up beside the end caps.

## Battery

**4S6P Samsung 50S: 30 Ah, 432 Wh, about 1.8 kg**, custom-built (spot-welded nickel strip, fishpaper, PVC wrap),
lying low in the drum in a printed cradle (`PackSpec` in `params.py`, `cradle()` in `body.py`). The system stays 4S
(16.8 V full, 12.0 V empty) because the Jetson, the regulators, the charger and the dock all assume it.

- **Layout.** The 24 cells lie fore-aft (along x) in three layers of five across the drum (y). Each layer shifts
  half a pitch across and nests into the grooves of the one below, so the layers are 18.5 mm apart instead of 21.4.
  They step up the drum's curved bottom:
  - bottom layer: one cell long (x −32 to 40), 5 slots with the middle one empty (the BMS thermistor goes there);
  - middle layer: two cells end to end (x −72 to 72). It just fits: its end corners are 3 mm off the shell;
  - top layer: two cells long, shifted 12 mm forward (x −60 to 84).

  The pack is 157 × 118 × 58 mm over all, stepped, from z −104 to −45.5. Its cells' centre is at x 5.7, y −0.9,
  z −70. Each series group is five cells in one end of the middle or top layer plus one cell from the bottom
  layer. The pack builder should confirm the busbar plan.
- **Why 21700s in nested layers.** The space under the tray is a circle segment 134 mm long between the end caps,
  and a cell has to fit whole. Cells along y waste half that length: a 21700 is 71 long, and two 18650s end to end
  (131) don't fit with walls. Cells along x in nested rows fill it best. With the tray as high as it goes, that's 25
  slots of 21700 (4S6P, 432 Wh) against 30 of 18650 (4S7P, 353 Wh) or 12 of 26650 (4S3P, 216 Wh). LiFePO4
  (32700) is out: 4S LFP tops out at 14.6 V, not 16.8. 46xx cells aren't reliably sold to individuals. The tray
  sets the limit. Put it 12 mm lower and the top layer is gone (4S3P). It can't go higher without moving the Jetson
  off it, because the shelf above is already 0.9 mm under the arm servo mounts and the BNO085 has to stay near the
  axis.
- **Cells.** Samsung INR21700-50S: 5.0 Ah, 25 A continuous, 69 g, Ø21.25 × 70.8 max (dimensions and mass
  UNVERIFIED). Any 5 Ah 21700 up to Ø21.3 × 70.9 fits the 21.4 pitch: the Samsung 50E, or the Molicel P50B if its
  diameter measures under the pitch. Buy all 24 from one lot, from a reseller that tests (18650batterystore, IMR
  Batteries).
- **BMS: 4S Li-ion, ≥ 40 A continuous, with balancing.** For example a Daly 4S 40 A, or a JBD/Overkill 4S smart
  BMS so the Teensy can read state of charge over UART. It sits on the tray (60 × 40 × 12 envelope, UNVERIFIED).
  The worst case is about 30 A: both wheel motors stalled at 16.8 V (2 × 7.7 A), all eight servos pulling through
  the D24V150F12 (≤ 15 A at 12 V, about 11.5 A from the pack), and the Jetson (25 W, 1.7 A). That's 5 A per cell,
  1 C against a 25 A rating. Normal driving draws 1.7 A.
- **Cradle.** A curved trough that sits on the shell, open upward, with a stepped pocket for each layer (0.8 mm over
  the wrap) and 2 mm side walls. Its floor is 1.7 mm at the thinnest, under the middle layer's ends. The tray above
  is the lid: stick 2 mm EVA foam on top of the pack. At the back, above z −51, the cradle stops at x −66.5 to
  clear the MDD10A. At the front, the space between the pack and the shell is the lead bay: the pack leads come over
  a notch in the front wall and up through the tray slot to the BMS. The cradle is 162 × 123 × 70 mm and prints
  curved side down, with tree supports under the curve.
- **Runtime** on 90% of 432 Wh, with the old 4S2P 12 Ah (173 Wh) for comparison:

  | | draw | 4S6P, 432 Wh | 4S2P, 173 Wh |
  |---|---|---|---|
  | idle (docked or sitting, Jetson idle) | ~3 W | 130 h (5.4 days) | 52 h |
  | awake (looking, talking, eyes on) | ~12 W | 32 h | 13 h |
  | driving (balancing and rolling) | ~25 W | 16 h | 6.2 h |

- **Shipping.** 432 Wh is over the 100 Wh and 160 Wh airline limits. The bot can't fly with the pack in it, and a
  built pack ships as Class 9 dangerous goods.

## Mass and balance

These are estimates from the CAD volumes (PETG at the print table's infill), the pack, and bought-part masses. The
bought parts are all UNVERIFIED: Jetson 200 g, 37D motor 195 g, STS3250 70 g, display 80 g, and 300 g of wiring
and fasteners.

| | 4S2P 12 Ah in the old sling | 4S6P 30 Ah in the cradle |
|---|---|---|
| total | 4.97 kg | **6.26 kg** |
| body (drum, internals, stalks, eyes) | 3.40 kg | 4.70 kg |
| body CoM, drum frame (x, z) | 7.3, +12.9 | 4.6, −6.7 |
| whole-bot CoM, docked pose, drum frame (x, y, z) | 42.9, 0.1, −8.8 | 33.5, −0.3, −19.0 |

The pack pulls the body's centre of mass down 20 mm, to below the drum axis, and 2.7 mm back. It can't go further
forward, because the middle layer spans the whole chord.

- **Standing up.** In the worst case the whole body hangs on the arm pivots, with the arms at 50° and the wheels
  rolling freely: 4.70 kg × g × 184 sin 50° = 6.5 N·m. That's 3.25 N·m per arm and 1.62 N·m at each STS3250
  through the 2:1 (1.18 before), a third of its ≈ 4.9 N·m stall (50 kg·cm at 12 V, UNVERIFIED). Driving the
  wheels back under the body takes some of that.
- **Balancing.** With the arms straight down, the body's CoM is 132 mm over the axle (152 before). Holding a 5°
  lean takes 0.27 N·m per wheel motor. The 37D 50:1 stalls at 2.06 N·m at 12 V, and Pololu suggests keeping
  continuous loads under about 1 N·m (UNVERIFIED). At 1 N·m each the motors hold a 19° static lean, or accelerate
  the whole bot at 3.7 m/s², enough to recover about 20°. The lower CoM falls a little faster (√(h/g) is 116 ms
  instead of 125 ms), so retune the balance loop.
- **Docked.** The centre of mass is 37 mm ahead of the skid contact and the wheels are 153 mm ahead, so the wheels
  carry 24% (15 N) and the skid 76% (29% and 71% before). The pads press on the pins harder. The dock geometry
  and `docked_pose` don't change.

## Charging dock

The dock is a concave wheel stop for the drum. The bot backs in at floor level. Its round drum meets a curve
rising behind it and slides down that curve into a seat, where the skid rests on the charge pins. Docked, the
bot faces the room, and none of the charging hardware shows from the front (`bot_front.png`,
`dock_section.png`).

- **The curve is the stop and the centering.** Behind the seat, the cradle rises as a curve of radius 128 about
  a line along the drum axis. That's 6 mm bigger than the skid circle, so a seated drum touches only at the
  bottom, on the skid, over the pins. The curve rises until it's vertical, at z = 134 (about drum-axis height),
  and its rim has a 10 mm 45° round-over. Both approaches end in the same seat:
  - *Backing in while sitting* (drum low, skid on the floor). There's no lip to climb. The front edge is a 12°
    chamfer from the floor up to the curve, which is 8 mm high where the chamfer meets it, and the seat floor is
    6 mm. The skid rides up the chamfer and over a 2 mm crest into the seat. There the drum meets the curve right
    behind it, and the curve stops it: a drum 6 mm smaller than the curve can't move back more than 6 mm.
  - *Backing in while balancing* (drum axis 225 mm up, underside 107 mm up). The drum passes over the chamfer and
    the seat, and its lower back bumps the rounded rim when the drum axis is 63 mm past the seat. That's the stop.
    Then it sits: the arms swing forward, and the drum comes down against the curve. The curve slopes 40–75°
    along that path, well past PETG-on-PETG friction (about 17°), so the drum slides forward and down into the
    seat. At the rim the tower's face is still 17 mm behind the drum.
  - *Sideways:* the curve runs 3 mm past each drum end, and end cheeks stand beyond that. Their inner top edges
    are cut back 2:1 up to 40 mm, so a drum end that comes down up to about 12 mm off-centre slides in, and the
    drum seats within ±3 mm. The pads tolerate ±6 mm sideways and ±15 mm fore-aft (12 × 36 mm strips).
  - *Arm and wheel clearance:* the tall curve stays inside |y| = 72 (the arms start at 76). Out past that the
    cradle is at most 40 mm tall, below a balancing bot's lowest arm point at 46 mm. The wheels roll on the floor
    outside it (cradle |y| ≤ 92, wheels |y| ≥ 113).
  - *Height:* the seat floor under the pins is 6 mm (`DOCK_H`). The wheels are on the floor and the skid is 6 mm
    up, so the docked pitch is 12.1° (`params.docked_pose(lift=DOCK_H)`).
- **Everything electrical is out of sight.** The three pins are pressed into the seat at x = 0, under the drum's
  lowest point. Their wires run in a 2 mm channel on the cradle's underside back to the tower. The tower stands
  behind the curve, 140 wide (inside the drum's 150 mm length) and 230 tall. In a front view from the bot's
  height the drum crown (246) still covers it. The VIN switch board goes in its bay, which opens underneath, and
  the 24 V jack is on its rear face. What shows below the drum from the front is the 8 mm front chamfer and the
  corners of the end cheeks (|y| 75–92).
- **Contacts.** On the bot are three brass strips in the skid: GND at y = −35, SENSE at −10, VIN at +30. On the
  dock are three spring pins (Mill-Max 0873 power pins, 9 A,
  [datasheet](https://www.mill-max.com/products/discrete-spring-loaded-pins/through-hole-mount-spring-loaded-pin/0873/0873-0-15-20-82-14-11-0))
  pressed into the seat. Barrel Ø3.0, UNVERIFIED; stroke UNVERIFIED.
- **Polarity safety.** The gaps are uneven (25 and 40 mm), so no sideways shift can land a wrong pin on a pad.
  The dock only turns VIN on when it sees its SENSE pin tied to its GND pin through the bot's 1 kΩ (SENSE pad to
  GND on the bot). That uses a small comparator plus a P-FET high-side switch, so the pins are dead until the
  bot is seated correctly. A mis-seat can't short, and nothing on the dock is live when no bot is on it. On the
  bot, VIN goes through an ideal diode, so the pads are never live from the battery.
- **Homing while reversing.** A 94 mm AprilTag 36h11 (printed and glued into a 1 mm recess) is on the tower's
  front face above the curve's rim, facing the bot. Its centre is 190 mm up the face and it spans z 134–223. An
  optional 5 mm 940 nm IR LED beacon sits beside it (y = 58). Why there:
  - The stalks bend back far enough (a 120° bend takes about 1.3 N·m at the pulley, under half a servo's stall)
    that on the way in the eyes curl back over the drum and look down behind it. The
    face leans back 20° so it points up toward the eyes instead of across the floor, which keeps the tag from
    being foreshortened.
  - A 2D line-of-sight check against the drum in the balancing pose keeps the whole tag in view until the drum
    axis is 10 mm *past* the seat, for an eye level over the drum crown. The rim stops the drum at 63 mm past.
    With the eye pushed 110 mm forward the tag is lost 45 mm before the seat, and with the eye curled back
    behind the crown, 30–45 mm past it. So the bot homes on the tag nearly the whole way, and the curve takes
    over from there. There's no final stretch on odometry: backing until the bot bumps is the procedure.
  - Once docked, the tag is behind the drum at |y| ≤ 47, below the crown, so it only shows from the side or
    from behind. From a standing adult's height you can see over the drum, and the top of the tower shows.
- **Docked detection.** The bot sees charger input voltage on a divider into the Teensy ADC.
- **Power path.** Unattended charging needs a pack with a BMS: the **4S6P pack** (see Battery). The dock takes
  24 V from a laptop-style adapter into a panel jack on the tower's back (Ø11 hole, UNVERIFIED). On the bot, a
  CC/CV buck module charges the pack at 16.8 V. At the old 1.5 A setting the 30 Ah pack would take about 20 hours,
  so the charger goes up to **5 A** (0.17 C, about 6.5 hours from empty). That needs an XL4016-class 8 A module:
  the 5 A XL4015 runs hot above 4 A. It draws about 4–4.3 A at 24 V with the bot idle or awake, so the adapter
  is 24 V ≥ 5 A (120 W), and each dock pin (Mill-Max 0873, 9 A) carries under half its rating. The Teensy measures
  charge current and cuts the charger off when it tapers below C/20 (1.5 A), so the pack doesn't sit at
  4.2 V/cell. The BMS is the backstop. The INA219 breakout's 0.1 Ω shunt reads only ±3.2 A, so use an INA226
  board with a 10 mΩ shunt.
- **Parts.** Cradle (234 × 184 × 134) and tower (100 × 140 × 230), joined by two printed dog-bone keys in
  pockets on the underside, across the seam at x = −125. Both fit the X1. The whole dock is 285 × 184.

## BOM

Prices are the listed ones where a page was read, otherwise UNVERIFIED. Nothing has been ordered. The dimensions behind most rows
come from the parts research draft, which isn't in the repo.

| Part | Qty | Source | Notes |
|---|---|---|---|
| Jetson Orin Nano Super Developer Kit 8 GB | 1 | [Amazon](https://www.amazon.com/NVIDIA-Jetson-Orin-Nano-Developer/dp/B0BZJTQ5YP), [SparkFun](https://www.sparkfun.com/nvidia-jetson-orin-nano-developer-kit.html) | 100 × 79 carrier; 9–20 V in, runs from the pack |
| Waveshare ESP32-P4-WIFI6-Touch-LCD-3.4C | 2 | [Waveshare](https://www.waveshare.com/esp32-p4-wifi6-touch-lcd-3.4c.htm) | the eyes, $65–75 |
| IMX219 camera (spy-cam w/ extension) | 2 | [Arducam B0185 via UCTronics](https://www.uctronics.com/arducam-imx219-spy-camera-ir-300mm-extension-cable-for-nvidia-jetson-nano.html) | $24.99; see Eyes for wiring |
| Teensy 4.1 | 1 | [Adafruit 4622](https://www.adafruit.com/product/4622) | balance loop, encoders, servo bus |
| Adafruit BNO085 | 1 | [Adafruit 4754](https://www.adafruit.com/product/4754) | IMU |
| Pololu 37D 50:1 12 V, 64 CPR encoder | 2 | [Pololu 4753](https://www.pololu.com/product/4753) | $60.95 |
| Pololu universal hub 6 mm | 1 pair | [Pololu 1083](https://www.pololu.com/product/1083) | $12.95 |
| Cytron MDD10A | 1 | [Cytron](https://www.cytron.io/p-10amp-5v-30v-dc-motor-driver-2-channels) | 84.5 × 62 |
| Feetech STS3250 12 V (arms) | 2 | [Feetech](https://www.feetechrc.com/en/562636.html) | through the printed 2:1 |
| Feetech STS3215 12 V (stalks) | 6 | [Seeed](https://www.seeedstudio.com/STS3215-19kg-cm-7-4V-Serial-Servo-p-6338.html), RobotShop | 3 per stalk, one per tendon |
| Music-wire compression spring, 3/4 in OD × 0.120 in wire, plain ends | 2 | McMaster 9657K-series or Lee Spring LC-series long stock (part number UNVERIFIED) | cut to 150 mm, ~9 mm pitch; the stalk spines |
| Waveshare Bus Servo Adapter (A) | 1 | [Waveshare](https://www.waveshare.com/bus-servo-adapter-a.htm) | $4.99 |
| Pololu D24V150F12 (12 V servo bus) | 1 | [Pololu 2885](https://www.pololu.com/product/2885) | $79.95 |
| Pololu D36V50F5 (5 V logic) | 1 | [Pololu 4091](https://www.pololu.com/product/4091) | |
| Samsung INR21700-50S cells (5.0 Ah, 25 A) | 24 + 2 spare | 18650batterystore, IMR Batteries (price UNVERIFIED) | the 4S6P pack, one lot; or Samsung 50E, Molicel P50B if ≤ Ø21.3 |
| 4S Li-ion BMS, ≥ 40 A, balancing | 1 | Daly 4S 40 A, or JBD/Overkill 4S smart BMS (UART) | 60 × 40 × 12 envelope UNVERIFIED |
| Pure nickel strip 0.15 × 8 mm, fishpaper rings, PVC wrap, XT60 | 1 set | Amazon | for the pack; needs a spot welder, or have a pack shop build it |
| CC/CV buck charge module, 8 A (XL4016-class) | 1 | generic (Amazon) | set 16.8 V / 5 A; 39 × 23 × 18 modelled, dims UNVERIFIED |
| EVA foam 2 mm | 150 × 120 mm | craft store | between the pack and the tray |
| Ideal diode module (charge input), ≥ 6 A | 1 | generic | keeps the pads dead from the battery |
| INA226 current sensor, 10 mΩ shunt | 1 | generic (Amazon) | charge termination; the INA219's 0.1 Ω shunt tops out at 3.2 A |
| 24 V ≥ 5 A (120 W) DC adapter (dock) | 1 | any laptop-style brick | for charging at 5 A |
| 5.5 × 2.1 mm panel DC jack | 1 | generic | dock tower, rear face |
| 940 nm 5 mm IR LED | 1 | generic | optional homing beacon |
| Mill-Max 0873 spring power pins | 3 | [Mill-Max](https://www.mill-max.com/products/discrete-spring-loaded-pins/through-hole-mount-spring-loaded-pin/0873/0873-0-15-20-82-14-11-0) | dock contacts |
| Brass strip 0.8 × 12 mm | 150 mm | hobby/K&S | bot pads |
| 6805-2RS bearings (25 × 37 × 7) | 4 | Amazon | arm pivots |
| PowerPro Spectra 65 lb (0.41 mm) | 1 spool | [Tackle Warehouse](https://www.tacklewarehouse.com/Power_Pro_Spectra_Braided_Line_Moss_Green/descpage-PPSL.html) | tendons |
| PTFE tube 2 × 4 mm | 1.5 m | Amazon | tendon guides, pod to base (6 runs) |
| M3 × 5.7 heat-set inserts (ruthex) | 100 | [ruthex](https://www.ruthex.de/en/products/ruthex-gewindeeinsatz-m3-100-stuck-rx-m3x5-7-messing-gewindebuchsen) | Ø4.0 holes throughout |
| M2.5 inserts, M3/M2.5/M2 screws | kit | Amazon | |
| UHMW tape | 0.1 m | Amazon | skid running surface |

## Print settings (Bambu X1)

| Part | Qty | Material | Orientation (as exported) | Settings |
|---|---|---|---|---|
| stalk base, tip | 2 / 2 | PETG | as modelled (plate down / collar down) | 0.16 mm, 4 walls, 40% gyroid; the coil groove prints as a thread, no supports |
| stalk guide disc | 10 | PETG | flat | 0.16 mm, 100% |
| stalk spring (only with `PRINTED_SPRING`) | 2 | PETG | upright | 0.2 mm, 100%, tree supports under the coils |
| tendon pulley | 6 | PETG | flat | 0.16 mm, 100% |
| servo pod | 2 | PETG | floor down | 0.2 mm, 3 walls, 25% |
| eye bezel L/R | 1 + 1 | PETG (white) | front face down, chin up | 0.16 mm, 3 walls; tree supports under the ears only |
| eye back | 2 | PETG (white) | flat | 0.2 mm, 3 walls, 20% |
| drum upper / lower | 1 + 1 | PETG | rim down (open side on the bed) | 0.24 mm, 3 walls, 15% gyroid; pedestals need supports |
| end cap L/R | 1 + 1 | PETG | flat, boss up | 0.24 mm, 4 walls around bearing bores, 20% |
| arm inner/outer L/R | 4 | PETG | flat, diagonal | 0.2 mm, 4 walls, 25% |
| arm gear / pinion | 2 + 2 | PETG or PA-CF | flat | 0.12 mm, 100% |
| wheel rim | 2 | PETG | hub face down | 0.2 mm, 3 walls, 20% |
| tyre | 2 | TPU 95A | on its side | 0.2 mm, 3 walls, 15% gyroid, slow (≤ 40 mm/s) |
| tray, shelf, driver mount, arm servo mounts, skid | 1 each / 2 | PETG | flat | 0.2 mm, 3 walls, 20% |
| battery cradle | 1 | PETG | curved side down, as modelled | 0.2 mm, 3 walls, 15% gyroid; tree supports under the curve |
| dock cradle, keys | 1 / 2 | PETG | flat, curve up | 0.24 mm, 3 walls, 15%; the curve is supported by the solid behind it, no supports |
| dock tower | 1 | PETG | upright, bay opening down | 0.24 mm, 3 walls, 15%; the 20° lean needs no supports |

Heat-set inserts go in at 230 °C after printing. The bearing bores are nominal +0.05 mm on radius. Print one end
cap first and adjust `BEARING_FIT` in `params.py` to your printer.

Fit report (`uv run python build.py`, current parameters): all 34 distinct printed parts fit. The largest are
the drum halves (236 × 150 × 118, 124 for the upper with its pedestals), the end caps (229.6 × 229.6 × 22), the arms (210 × 210 diagonal), the battery
cradle (162 × 123 × 70), and the dock cradle (234 × 184 × 134) and tower (100 × 140 × 230), all against a 250 mm per-axis limit.

## Open questions

1. **Display stack depth and weight** (Waveshare doesn't list them): measure, then set `EyeSpec.depth`. If the
   eye comes out much over 160 g, the spring's margin shrinks (buckling at 6.2 N, about 630 g, but the sag grows
   as 1 / (1 − W / 6.2 N)): go to a stiffer wire, or drop to a 2.8" round.
2. **Camera path:** P4 CSI → USB video (one lead per stalk) vs. the IMX219 spy-cam flex to the Jetson's CSI
   (a native driver, but a flat flex up a bending spring). Prototype one stalk both ways.
3. **Measure before freezing:** STS3215/STS3250 mounting holes, horn pattern, and shaft offset; Jetson hole
   pattern; Pololu hub PCD; spy-cam head size; pogo barrel and stroke; charge module size; the stalk spring's OD, wire and pitch, and its
   bending stiffness (hang a weight on the tip, measure the sag).
4. **Arm clamshell screws** go through the arm's full thickness. If the arm flexes at 2.9 kg, add a rib or print
   the halves at 40% infill.
5. **Sim update:** heavier eyes (about 160 g), the stiffer 3/4 in spring (EI 0.137 instead of 0.011), the
   roots on the crown at y = ±48 with 5° of splay instead of 25° forward, and the 4S6P pack should go into
   `sim/bot.py` before the controllers are retuned. The pack is about 1.8 kg, 38% of the body, centred 0.05 R
   forward and 0.59 R down (the sim has 0.55 R and 0.4 R). The sim's three cables at 120° already match.
6. **Packs in the arms.** Each arm is hollow and its hub bore (Ø19) is already the lead path, so a 4S pack can ride
   in an arm with its leads through the hub. Packs are only safe to parallel at the same voltage, so give each arm
   pack its own BMS and fuse and join it through ideal-diode ORing (or a precharge switch), not straight onto the
   main pack. It adds mass low and forward when the arms are parked, and swinging mass when they move. Size it once
   the bot runs.
7. **Pack build:** confirm the series-group busbar plan with whoever welds it, glue the layers so the nesting holds,
   and put the BMS thermistor in the bottom layer's empty slot.
