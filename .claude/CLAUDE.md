# Sky Rings — project guide for Claude

A browser flight game built with three.js. The player flies a low-poly biplane through endless curvy courses of gold rings, shoots enemy biplanes and hot-air balloons, and manages fuel. It can be flown with the keyboard or with a paired phone (accelerometer tilt plus a FIRE button). See `README.md` for the player-facing overview and screenshots.

## Running

```bash
python3 server.py          # game: http://localhost:8137   phone: https://<lan-ip>:8443/controller.html
```

- There's no build step and no npm: everything is plain ES modules loaded by the browser. three.js **0.170.0** comes from jsDelivr through the import map in `index.html` (`three` and `three/addons/`). The pairing QR code uses `qrcode-generator` from the same CDN (a global `qrcode`).
- `.claude/launch.json` starts `server.py` for the in-app browser preview (`preview_start` with name `flightsim`).
- `server.py` uses only the Python standard library. On first run it creates a self-signed certificate with `openssl` in `.certs/`, which is gitignored and recreated when the LAN IP changes.

## Requirements the user set (keep these true)

- Flight model "B" (hybrid arcade): rate-based roll and pitch, bank-to-turn (yaw rate = g·tan(bank)/v), speed traded against climbing and diving, velocity that lags the nose (`slipTime`), optional auto-level. Arcade pitch by default (↑ = nose up), with an invert option.
- The game starts in the air. There's no landing or take-off. Any collision (ground, water, building, tree, enemy) is a crash that **resets the score**, then respawns before the next ring.
- Rings are passed through, never collided with. Spacing is set by the menu slider (default 340 m, about 4.7 s), and the first ring is always 170 m straight ahead at start height. The first two segments never get a path cloud.
- Fuel: +10% per ring; burns 10% per (ring spacing / cruise speed) seconds. At 0% the engine stops and the plane glides (no crash).
- Phone controller: a level phone means level flight, and phone tilt sets the plane's bank and pitch angles. Calibration is a 3-step wizard. **Never show a "rotate your phone" blocking overlay**: the controller must work upright too, because users play with rotation lock on.
- Visual direction comes from the user's references: a red/yellow low-poly biplane, a warm sunset over a mountain bay with a glittering sun path, and a compact top stats bar.

## Code map

| File | Responsibility |
|---|---|
| `js/main.js` | Boot, renderer + post-processing (bloom, HalfFloat MSAA target), game state machine (`menu` / `playing` / `crashed`), input, menu wiring, scoring, fuel, chase camera, main loop. Exposes `window.__sim` for debugging. |
| `js/flight.js` | `FlightModel` and `FLIGHT_PARAMS` (all tuning). Local axes: **forward = −Z, up = +Y, right = +X**. `bank` > 0 means right wing down; `pitch` > 0 means nose up. `engineOn` false gives glide. |
| `js/aircraft.js` | `buildAircraft(livery)` builds the biplane from primitives (flat-shaded). Returns `{group, propeller, strobe, tips, halfSpan, gearDepth}`. Enemies reuse it with `ENEMY_LIVERY`. |
| `js/world.js` | Scene defs (`createSceneDef`: terrain height/colour functions, fog density, obstacle type). `Terrain` re-centres on the player and rebuilds over several frames (double-buffered generator). `Water` is a custom shader (3 drifting wave layers). `City` and `Forest` are chunk-streamed `InstancedMesh`es with deterministic hash placement; `topAt(x,z)` answers collision queries. `World.solidAt()` = max(ground, water, obstacles). |
| `js/atmosphere.js` | `TIME` presets (sunrise/midday/sunset/night) and weather modifiers (clear/storm/snow) combined into a `look` by `buildLook()`. `Atmosphere` owns the sky (three's `Sky` with an injected tint, saturation and night-floor glow), lights, PMREM environment, stars, moon, `Rain`, `Snow` and `Lightning`. |
| `js/clouds.js` | Single instanced billboard mesh, sorted back-to-front every frame. A procedural 2×2 puff atlas (density + baked shading) and a shader with sun-facing rim glow and near-camera fade. `update()` returns how far inside a cloud the player is (0–1), used for fog and a white-out overlay. |
| `js/course.js` | Ring path generation (wander + valley seeking + terrain clearance via `_corridor`), ring pass/miss detection by crossing each ring's plane, respawn point. |
| `js/combat.js` | Laser bolt pool (swept-segment hit tests), enemy spawning relative to upcoming rings (head-on, same-direction, balloons), hits/kills, player–enemy collision events. |
| `js/effects.js` | Wingtip ribbon trails, sprite explosions. |
| `js/hud.js` | DOM HUD: stats, next-ring marker, crosshair, enemy brackets, fuel gauge and warnings, popups. |
| `js/sound.js` | Web Audio synthesis: rain loop, thunder, laser, hit, boom. Starts on the first user gesture (Start button). |
| `js/phone.js` | Game side of the phone link: `EventSource('/api/events?s=CODE')`, pairing URL, `flightInput()` (attitude control toward phone tilt). The code is kept in `localStorage`. |
| `js/controller.js` | Phone page: `devicemotion` gravity vector, 3-step calibration in the **phone's sensor frame**, POSTs `{t:'in', roll, pitch, fire, cal}` every 33 ms, plus `{t:'start'}` / `{t:'menu'}`. |
| `server.py` | HTTP on 127.0.0.1:8137 (game) and HTTPS on 0.0.0.0:8443 (phone). `/api/info`, `/api/events` (SSE), `/api/input` (POST relay), `/api/status`. Sends `Cache-Control: no-store`. |

## Conventions and gotchas

- **Server allowlist:** `server.py` only serves `ALLOWED_FILES` plus `/js/*.js`. A new top-level file (a page, stylesheet, image or doc served to the browser) must be added to `ALLOWED_FILES`, or it returns 404. This keeps `.certs/`, `server.py` and `.claude/` private on the LAN.
- **Shader variants:** materials patched with `onBeforeCompile` that bake values into the shader text must set `customProgramCacheKey`, or three.js reuses a stale program after a scene or weather change (see the building and water materials).
- **Half-float overflow:** the render target is HalfFloat. Very sharp, bright speculars (water roughness < 0.1 with a low sun) overflow it, and bloom then smears that into black rectangles. Keep water roughness ≥ 0.1.
- **Settings** live in `localStorage['skyrings.settings']` (scene, time, weather, invert, autoLevel, sound, ringGap, combat). The phone uses `skyrings.phonecal`, `skyrings.phonesens`; the game uses `skyrings.phonecode`, `skyrings.phonepaired`. Changing scene, time or weather calls `loadScene()`, which rebuilds the world and resets the run.
- **Determinism:** world content (terrain, buildings, trees) comes from seeded noise and `hash2`, so collision queries and rendering always agree. Use those helpers, not `Math.random()`, for anything the player can collide with.
- **Calibration maths** (controller.js): `n0` = level gravity, `r` = direction gravity moves when banking right, `p` = direction for nose-down (orthogonalised against `r`). `bank = atan2(g·r, g·n0)` and `pitch = −atan2(g·p, g·n0)`. This makes it independent of how the phone is held and of iOS vs Android sign conventions. During the wizard the dial shows tilt away from `n0`, because `r`/`p` aren't known yet.
- **Phone permissions:** iOS needs `DeviceMotionEvent.requestPermission()` from a tap, and every sensor API needs a secure context, which is why the controller is served over HTTPS. Don't block on fullscreen, orientation-lock or wake-lock promises; some browsers leave them pending.
- UI text and code comments are in plain English. Keep the HUD compact; the look is warm and dark with an orange accent.

## Testing tips

- Use the in-app browser preview. When the pane is hidden, `requestAnimationFrame` is heavily throttled, so test logic by waiting for frames (`await new Promise(r => requestAnimationFrame(r))` in a loop) rather than wall-clock time.
- `window.__sim` gives `flight`, `course`, `world`, `combat`, `atmo`, `phone`, `keys`, `stats`, `settings`, `look`, `state`, plus `fuel` (get/set) and `fuelBurnRate()`. Examples: teleport with `__sim.flight.reset(pos, dir)`, spawn with `__sim.combat._spawnBalloon()`, force lightning with `__sim.atmo.lightning.timer = 0`.
- Simulate keys with `dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }))`.
- Simulate the phone without hardware:
  - Relay: `curl -k -X POST -d '{"t":"in","roll":0.6,"pitch":0,"fire":true,"cal":true}' "https://<lan-ip>:8443/api/input?s=<code>"`
  - Controller page: open `http://localhost:8137/controller.html?s=CODE` (localhost counts as secure), stub `DeviceMotionEvent.requestPermission = async () => 'granted'`, and dispatch `new Event('devicemotion')` with an `accelerationIncludingGravity` property added.
- README screenshots in `docs/screenshots/` were captured with headless Brave/Chrome (`--use-angle=swiftshader`) driven over the DevTools protocol at 1280×720, with the phone controller at 844×390.
