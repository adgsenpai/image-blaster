# Room polish plan: first-class Survivor Trader room + in-game editor

Loop rules: take the first unchecked item, implement it so it works end to end, typecheck
(`npx --prefix app tsc --noEmit -p app`, ignoring the pre-existing SplatRenderer error), verify in the browser
(`window.__fps.roomGo(x, z, yawDeg, pitchDeg)`, `__fps.cash(n)`, `__fps.prompt()`; screenshots), tick the item, then commit
(author adgsenpai <adgrules.rsa@gmail.com>, with the Co-Authored-By and Claude-Session lines) and push with
`git push mine worktree-local-gen:main`. Keep it simple and robust, and use the local GPU (RTX 5060, venv
`~/.cache/image-blaster-local/venv`) wherever it helps.

Room space: the photo camera is at the origin looking down -z. The world is `worlds/survivor-trader-room` (main checkout),
the config lives in `local-gen/regions/rainy-bo-kaap-night-reflections-game.json` → `arena.room`, and is copied to
`worlds/rainy-bo-kaap-night-reflections/game.json`. Tools: `local-gen/room_find.py` (colour/depth probes),
`local-gen/clip_room.py` (splat clipping), `app/src/modules/game/RoomProps.tsx` (crisp props).

## Backlog

- [x] 1. **Measure the real walls.** Extend `room_find.py` to print the front-most wall depth (z) per x slice at
      several heights (0.3, 1.2, 2.5 m), plus the floor/ceiling heights, from the splats (alpha > 0.5).
      Use it to place the SURVIVOR TRADER sign, the price board and both machines flush against walls (no floating).
- [x] 2. **Clean remnants.** Enlarge the clip boxes around both machines (the grey "smoke" remnants), and clip
      everything behind the photo camera (z > 0.4), since that side is invented by World Labs (fake arched windows).
      Re-run `clip_room.py`.
- [x] 3. **Proper back wall + EXIT door.** In RoomProps add a built back wall at z ≈ 0.6 spanning the room width:
      wood wainscot + plaster texture matching the room's red/brown palette, a real double door with a lit green
      EXIT sign above it and a wall lamp, and boarded windows either side. Move the exit hotspot to that door. Drop the old
      RoomBarricade if it's redundant.
- [x] 4. **Walk limits.** Invisible colliders keep the player inside the well-scanned zone (between the back wall and the
      counter, x within the side walls), so no one can walk into a floating splat or out of the room.
- [x] 5. **In-game room editor (CAD-like).** Toggle with `F2` while indoors and paused-safe:
      - click a room prop to select it; TransformControls (drei) for translate / rotate (`W`/`R`), snap with Shift
      - prop palette: add vending machines, sign, board, crates, sandbag walls, planks, lamps, barrels, and any
        CC0 GLBs in `app/public/game/` (zombie excluded), plus the world's generated object GLBs
      - Delete removes the selection; `Ctrl+S` saves the props back to `game.json` through a dev-server endpoint
        (`/__game-config`, POST, writes `worlds/<slug>/game.json` and the `local-gen/regions` copy)
      - the HUD shows the selected object, its position and a cheat sheet
- [x] 6. **GPU textures.** Use the local GPU to make proper textures for the built parts (wood planks, plaster,
      the door, sandbag fabric) from tileable procedural bases → Real-ESRGAN detail, matching the scan's palette
      (sample colours with `scan_stats`-style probes). If Hugging Face text-to-image is available (HF_TOKEN in .env;
      an ungated model such as `stabilityai/sdxl-turbo` running locally via diffusers fp16), generate the
      textures / a sign illustration from prompts instead.
- [x] 7. **Lighting pass.** Warm practical lights on the built parts that match the scan's baked lighting (chandelier,
      lamps). The machines' glow should spill onto the floor; no flat-lit boxes.
- [x] 8. **Room QA.** Walk all four directions from 6+ spots, screenshot, and fix anything floating, intersecting or
      blurry. Update the README showcase with a "room" section and screenshots.

## Rules
- Only CC0 / properly licensed assets; record sources in `app/public/game/CREDITS.txt`.
- Don't break the street, the stage, or gameplay. Keep the room around 45 fps or better on the RTX 5060.
- Commit after every item.
