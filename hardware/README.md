# hardware

The real mosfet: parametric, printable CAD in Python ([build123d](https://github.com/gumyr/build123d)). Bought
parts are off the shelf; everything else prints on a Bambu Lab X1 (256 mm cube). The look is the character in
`web/src/face/critter.ts` and `sim/bot.py`, scaled up as far as the printer allows.

```sh
cd hardware
uv sync
uv run python -m ocp_viewer --port 3939 &   # live viewer: open http://localhost:3939
uv run python build.py                      # build, check fit, export, show in the viewer
uv run python build.py --only kit           # just the stalk test kit
uv run python build.py --clash --no-show    # also list every pair of overlapping parts
uv run python shots.py out/shots            # render the proof views through the viewer
```

`build.py` writes to `out/` (git-ignored):

- `out/mosfet.step`, `out/stalk_kit.step`: assemblies with named, coloured parts, for Shapr3D or any CAD.
- `out/print/<part>.3mf` and `.stl`: one file per distinct printed part, already in its print orientation,
  centred and sitting on the bed, for Bambu Studio. The fit report says how many of each to print.
- `out/print/fit_segment_i020..i035.stl`: the ball/socket interference sweep (see the stalk kit below).

The build fails (exit 1) if any printed part's bounding box, in its print orientation, is bigger than 250 mm
on any axis (256 mm less 3 mm margin each side).

| File | What |
|---|---|
| `mosfet_cad/params.py` | every driving dimension: character ratios, bought-part sizes, `StalkSpec`, `EyeSpec`, docked pose |
| `mosfet_cad/stalk.py` | ball/socket segment, stalk base and tip, double pulley, stalk servo pod |
| `mosfet_cad/eye.py` | eye bezel with camera bump, eye back with mounting post |
| `mosfet_cad/kit.py` | the stalk test kit and the fit sweep |
| `mosfet_cad/body.py` | drum halves, end caps, tray, shelf, battery sling, driver mount, skid, gears, arms, wheels |
| `mosfet_cad/dock.py` | charging dock |
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
| stalks | 166 long (base plate to tip top), roots 25° forward of the top, 78 apart |
| eyes | Ø124 bezel (Ø115 round display), camera bump on the rim |
| overall, docked | 372 wide (tyre to tyre), 359 long, 540 tall; on the dock 383 × 400 footprint |

Docked, the bot sits on its wheels and its skid. The skid touches at 14.4° behind the drum's bottom, so the body
pitches back 14.4°, and the stalks bend forward by the same amount to keep the eyes level
(`params.docked_pose`). That pitch comes from the common tangent of the wheel circle and the skid circle.

## Stalk test kit (print this first)

`uv run python build.py --only kit`: one stalk (base, 7 segments, tip), one eye, one servo pod with two pulleys.

**Segments are printed Loc-Line.** Each segment has a socket at the bottom and a Ø20 ball at the top, 18 mm
apart. The socket snaps over the ball below it and holds it by friction, so the stalk keeps a pose with the
power off. There are no springs.

- **Fit.** The socket cavity is 0.25 mm (diametral) smaller than the ball (`interference`). The mouth wraps
  0.5 mm past the ball's equator (`snap`). Four 1 mm slits in the skirt let it snap on and set how hard it
  grips. FDM tolerance varies by printer and filament, so `build.py` also exports
  `fit_segment_i020/025/030/035`. Print three of each, snap them together, and keep the stiffest pair that
  still moves smoothly. Then set `StalkSpec.interference` to match.
- **Range.** The CAD hits a hard stop at about 34° per joint (checked by rotating a segment until the solids
  collide). Eight joints give roughly 270° of total bend, enough to curl the eye down and look behind.
- **Cables.** A Ø10 bore runs the full length and flares where it leaves each ball, so a lead never meets a
  sharp edge. The flare also trims the ball's crown, which adds tilt clearance. It carries the eye's USB-C
  lead, or the 9 mm IMX219 flex in the fallback wiring below.
- **Print.** As modelled: socket down, ball up, no supports. PETG, 0.2 mm layers, 4 walls, 40% gyroid. The
  cavity crown bridges over the bore, which is fine because the crown isn't a contact surface. About 6 g each.

**Tendons: 4 at 90°, in two antagonistic pairs, one double pulley per pair.** That's 2 servos per stalk, 4 in
total. The research draft proposed 3 at 120° on 3 servos, because a spring spine shortens under tension and
lets an antagonistic pair go slack. A ball-and-socket chain can't shorten: the balls sit in their sockets. So
the argument against pairs goes away:

- For the real hole positions (exit 12.6 mm below each pivot, entry 1.5 mm above it, r = 12), the pulled side
  shortens by 6.66 mm at a joint's full 34° while the other side lengthens by 6.86 mm. A double pulley pays
  out equal lengths, so each joint at full bend leaves 0.2 mm of slack, and 0.04 mm at 10°. Pretension and
  Spectra's low stretch cover that.
- The joints hold themselves by friction, so the stalk doesn't need co-contraction to stay stiff. When it does
  need to be stiffer, pretensioning both pairs clamps every ball into its socket and raises the friction.
- Two pairs cover both bending planes (fore/aft and sideways), which is all a stalk needs. The camera looks
  wherever the stalk points.
- It saves 2 servos per bot (−110 g, about −$45) and keeps the pod small enough to fit inside the drum.
- Loads: an eye of about 170 g at 166 mm puts about 0.28 N·m on the root joint. At r = 12 that's 23 N of tendon,
  or 0.23 N·m (2.4 kg·cm) at the 10 mm pulley, about 8% of an STS3215's stall. Travel for 180° of stalk bend is
  12 mm × π = 38 mm of tendon, or about 216° of servo rotation.

Tendons: 0.41 mm PowerPro Spectra (65 lb). At the pulley, each tendon passes through its groove's cross hole
and is knotted. The two tendons of a pair wrap their grooves in opposite directions. At the tip they're knotted
in Ø3 counterbores on the tip's top face, which the eye then covers. Between the pod and the stalk base they
run in 2 × 4 mm PTFE tube that seats in the base's counterbores.

**Stalk base** bolts to its pedestal on the drum with 3 × M3 on Ø36 (heat-set inserts in the pedestal).
**Stalk tip** takes 4 × M3 × 5.7 heat-set inserts (Ø4.0 holes) for the eye. **Servo pod** holds two STS3215s
shafts-up and bolts to the end cap through a 2-hole flange. The M2 holes in its floor and the shaft offset are
UNVERIFIED: check them against the STS3215 STEP from
[TheRobotStudio/SO-ARM100](https://github.com/TheRobotStudio/SO-ARM100). **Pulleys** bolt to the stock horn with
4 × M2 on a Ø14 circle (UNVERIFIED horn pattern).

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
  spy camera with a 300 mm extension, straight to the Jetson's CSI ports, 9 mm flex in the Ø10 bore, with the
  display on Wi-Fi and only power up the stalk.
- *Housing.* The bezel holds the glass against a 2.5 mm lip and has 4 ears with M3 inserts. Print it front face
  down. The camera bump sits on the rim, 30° from the top toward the outside, clear of the glass: a Ø18 boss with a
  10 × 10 mm head pocket (UNVERIFIED: spy-cam head size), a Ø7 lens hole, and a flex path back behind the display.
  The eye back is a 2.5 mm cover plus the post that bolts to the stalk tip. The lead goes up the post and through
  the cover. `EyeSpec` has the glass diameter, the stack depth (18 mm, UNVERIFIED), the camera angle, and the
  camera head size.
- *Mass at the tip:* bezel about 26 g and back about 57 g solid PETG (less with infill), plus the display
  (weight UNVERIFIED, Waveshare doesn't list it; budget 80 g).

## Body

- **Drum:** two half-tubes split at the axis (236 × 150 × 118 each). The top half carries the two stalk pedestals,
  which are tall enough (top at z = 117) that the Ø44 base plates clear the drum's crown. Both halves screw
  radially into the end-cap rims (8 × M3 into inserts).
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
- **Inside** (see `bot_section.png`): tray at z −70, Jetson Orin Nano Super on M2.5 standoffs (86 × 58 pattern,
  UNVERIFIED). Above it, an electronics shelf with the Teensy 4.1, the BNO085 within 20 mm of the drum axis,
  and the bus-servo adapter. The battery hangs low and forward in a sling under the tray. The MDD10A stands on
  the driver mount at the back. The 12 V and 5 V regulators and the charge module sit on the front of the tray.
  The stalk servo pods are high and forward under the pedestals. The arm servos and gears sit next to the end caps.
- **Skid:** a 4 mm PETG ski on the drum's back-bottom (UHMW tape on the running surface) with recesses for the
  three brass charge pads.

## Charging dock

The bot docks by sitting down. The parked pose is the docking pose: it drives up balancing, facing the tag mast,
stops over the dock pad, and sits. The arms swing forward, the wheels roll forward into the two cradles, and the
drum tips back until the skid lands on the pad.

- **Guides.** Each cradle has a circular trough (wheel radius + 3 mm) that centres its wheel fore-aft. Walls sit
  8 mm clear of the tyre on each side, and their entry ends are cut to the ramp slope, so they flare. A 15° ramp
  brings the wheels up from the floor. The contact strips are 12 mm wide and 36 mm long along the skid, so the
  skid tolerates about ±6 mm sideways and ±15 mm fore-aft.
- **Contacts.** On the bot are three brass strips in the skid: GND at y = −35, SENSE at −10, VIN at +30. On the
  dock are three spring pins (Mill-Max 0873 power pins, 9 A,
  [datasheet](https://www.mill-max.com/products/discrete-spring-loaded-pins/through-hole-mount-spring-loaded-pin/0873/0873-0-15-20-82-14-11-0))
  pressed into the pad. Barrel Ø3.0, UNVERIFIED; stroke UNVERIFIED.
- **Polarity safety.** The gaps are uneven (25 and 40 mm), so no sideways shift can land a wrong pin on a pad.
  The dock only turns VIN on when it sees its SENSE pin tied to its GND pin through the bot's 1 kΩ (SENSE pad to
  GND on the bot). That uses a small comparator plus a P-FET high-side switch, so the pins are dead until the
  bot is seated correctly. A mis-seat can't short, and nothing on the dock is live when no bot is on it. On the
  bot, VIN goes through an ideal diode, so the pads are never live from the battery.
- **Docked detection.** The bot sees charger input voltage on a divider into the Teensy ADC. For homing, a
  94 mm AprilTag 36h11 (printed and glued into the mast's recess) faces the approach, so the eye cameras can see
  it. An IR beacon can go on the mast later.
- **Power path.** Unattended charging needs a pack with a BMS. The bare RC LiPo in the research draft is
  replaced by a **4S1P 21700 Li-ion pack with BMS**: Keeppower 6000 mAh, 90 × 75 × 22.8 mm,
  [product](https://keeppower.com/product/4s1p-21700-14-4v-6000mah-li-ion-battery-pack-with-amass-xt30u-connector/).
  The dock supplies 24 V from a laptop-style adapter. On the bot, a CC/CV buck module (XL4015-class, 5 A, set to
  16.8 V / 1.5 A) charges the pack. The Teensy measures charge current (INA219) and cuts the charger off when
  it tapers below C/10, so the pack doesn't sit at 4.2 V/cell. The BMS is the backstop.
- **Parts.** Pad, two cradles, and the tag mast (40 × 200 × 200), joined by six printed dog-bone keys in pockets
  on the underside. All fit the X1.

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
| Feetech STS3215 12 V (stalks) | 4 | [Seeed](https://www.seeedstudio.com/STS3215-19kg-cm-7-4V-Serial-Servo-p-6338.html), RobotShop | 2 per stalk (tendon pairs) |
| Waveshare Bus Servo Adapter (A) | 1 | [Waveshare](https://www.waveshare.com/bus-servo-adapter-a.htm) | $4.99 |
| Pololu D24V150F12 (12 V servo bus) | 1 | [Pololu 2885](https://www.pololu.com/product/2885) | $79.95 |
| Pololu D36V50F5 (5 V logic) | 1 | [Pololu 4091](https://www.pololu.com/product/4091) | |
| 4S1P 21700 Li-ion pack w/ BMS, 6000 mAh | 1 | [Keeppower](https://keeppower.com/product/4s1p-21700-14-4v-6000mah-li-ion-battery-pack-with-amass-xt30u-connector/) | 90 × 75 × 22.8; XT30U |
| CC/CV buck charge module, 5 A (XL4015-class) | 1 | generic (Amazon) | set 16.8 V / 1.5 A; dims UNVERIFIED |
| Ideal diode module (charge input) | 1 | generic | keeps the pads dead from the battery |
| INA219 current sensor | 1 | [Adafruit 904](https://www.adafruit.com/product/904) | charge termination |
| 24 V ≥2.5 A DC adapter (dock) | 1 | any laptop-style brick | |
| Mill-Max 0873 spring power pins | 3 | [Mill-Max](https://www.mill-max.com/products/discrete-spring-loaded-pins/through-hole-mount-spring-loaded-pin/0873/0873-0-15-20-82-14-11-0) | dock contacts |
| Brass strip 0.8 × 12 mm | 150 mm | hobby/K&S | bot pads |
| 6805-2RS bearings (25 × 37 × 7) | 4 | Amazon | arm pivots |
| PowerPro Spectra 65 lb (0.41 mm) | 1 spool | [Tackle Warehouse](https://www.tacklewarehouse.com/Power_Pro_Spectra_Braided_Line_Moss_Green/descpage-PPSL.html) | tendons |
| PTFE tube 2 × 4 mm | 1 m | Amazon | tendon guides, pod to base |
| M3 × 5.7 heat-set inserts (ruthex) | 100 | [ruthex](https://www.ruthex.de/en/products/ruthex-gewindeeinsatz-m3-100-stuck-rx-m3x5-7-messing-gewindebuchsen) | Ø4.0 holes throughout |
| M2.5 inserts, M3/M2.5/M2 screws | kit | Amazon | |
| UHMW tape | 0.1 m | Amazon | skid running surface |

## Print settings (Bambu X1)

| Part | Qty | Material | Orientation (as exported) | Settings |
|---|---|---|---|---|
| stalk segment, base, tip | 14 / 2 / 2 | PETG | socket down, ball up | 0.2 mm, 4 walls, 40% gyroid, no supports |
| fit sweep segments | 3 of each | PETG | same | same as segments |
| tendon pulley | 4 | PETG | flat | 0.16 mm, 100% |
| servo pod | 2 | PETG | floor down | 0.2 mm, 3 walls, 25% |
| eye bezel L/R | 1 + 1 | PETG (white) | front face down | 0.16 mm, 3 walls; tree supports under the ears only |
| eye back | 2 | PETG (white) | post down | 0.2 mm, 3 walls, 20% |
| drum upper / lower | 1 + 1 | PETG | rim down (open side on the bed) | 0.24 mm, 3 walls, 15% gyroid; pedestals need supports |
| end cap L/R | 1 + 1 | PETG | flat, boss up | 0.24 mm, 4 walls around bearing bores, 20% |
| arm inner/outer L/R | 4 | PETG | flat, diagonal | 0.2 mm, 4 walls, 25% |
| arm gear / pinion | 2 + 2 | PETG or PA-CF | flat | 0.12 mm, 100% |
| wheel rim | 2 | PETG | hub face down | 0.2 mm, 3 walls, 20% |
| tyre | 2 | TPU 95A | on its side | 0.2 mm, 3 walls, 15% gyroid, slow (≤ 40 mm/s) |
| tray, shelf, sling, driver mount, arm servo mounts, skid | 1 each / 2 | PETG | flat | 0.2 mm, 3 walls, 20% |
| dock pad, cradles, mast, keys | 1 / 2 / 1 / 6 | PETG | flat | 0.24 mm, 3 walls, 15% |

Heat-set inserts go in at 230 °C after printing. The bearing bores are nominal +0.05 mm on radius. Print one end
cap first and adjust `BEARING_FIT` in `params.py` to your printer.

Fit report (`uv run python build.py`, current parameters): all 36 distinct printed parts fit. The largest are
the drum halves (236 × 150 × 118), the end caps (229.6 × 229.6 × 22), the arms (210 × 210 diagonal), and the dock
cradles (215 × 100 × 40), all against a 250 mm per-axis limit.

## Open questions

1. **Display stack depth and weight** (Waveshare doesn't list them): measure, then set `EyeSpec.depth`. If the
   eye comes out over about 170 g, drop to a 2.8" round or shorten the stalk.
2. **Camera path:** P4 CSI → USB video (one lead per stalk) vs. the IMX219 spy-cam flex to the Jetson's CSI
   (a native driver, but a flat flex through 8 ball joints). Prototype one stalk both ways.
3. **Measure before freezing:** STS3215/STS3250 mounting holes, horn pattern, and shaft offset; Jetson hole
   pattern; Pololu hub PCD; spy-cam head size; pogo barrel and stroke; charge module size.
4. **Arm clamshell screws** go through the arm's full thickness. If the arm flexes at 2.9 kg, add a rib or print
   the halves at 40% infill.
5. **Sim update:** heavier eyes (about 170 g), the ball/socket spine (friction instead of springs), 4 tendons,
   and the 21700 pack mass/placement should go into `sim/bot.py` before the controllers are retuned.
