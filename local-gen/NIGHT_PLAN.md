# Night polish plan: BO-KAAP: LAST NIGHT

Goal: by 08:00, make the game look and play as polished as possible. Keep it simple; ship one item at a time.
Each loop iteration: pick the first unchecked item, implement it, typecheck
(`npx --prefix app tsc --noEmit -p app`, ignoring the existing SplatRenderer error), verify in the browser if possible,
tick it here, commit, and push (`git push mine worktree-local-gen:main`).

Context: worktree `.claude/worktrees/local-gen`, branch `worktree-local-gen`. Dev server: `npm --prefix app run dev` (port 5173).
World: `worlds/rainy-bo-kaap-night-reflections` (game.json copy in `local-gen/regions/`). Game code: `app/src/modules/game/`.
Dev hook: `window.__fps.teleport(u, v)` / `window.__fps.look(yawDeg, pitchDeg)`.

## Backlog (in order)

- [x] 1. **Real zombies**: replace the procedural box zombies with `app/public/game/zombie.glb`
      (Quaternius, CC0, 50-bone rig; clips Walk / Run / Punch / Death / HitReact / Crawl / Idle).
      Use SkeletonUtils.clone per zombie and an AnimationMixer. Raycast hits via bone proximity
      or a hidden capsule hitbox per zombie, with head and limb hitboxes.
- [x] 2. **Gore**: headshot pops the head (scale the `Head` bone to 0, spawn a flying head gib and a blood fountain).
      Leg damage shears off a leg (scale `UpperLeg.*`) and switches to the `Crawl` clip. Arm hits shear off an arm.
- [x] 3. **Blood**: particle sprays on every hit, plus blood pool decals on the street that fade slowly.
- [x] 4. **Ragdoll-ish deaths**: play the Death clip, add knockback along the shot and settle on the ground. Simple physics bodies for gibs.
- [ ] 5. **Bullet impacts**: rapier `castRayAndGetNormal` against the world collider gives a bullet-hole decal
      (oriented to the normal, capped at 80, oldest removed) plus a dust/spark puff.
- [ ] 6. **Gun models**: CC0 guns (Quaternius on poly.pizza; check that the page says CC0) for the pistol, rifle and sniper viewmodels.
- [ ] 7. **Gun and zombie sounds**: CC0 OpenGameArt packs ("Gunshot sounds", "Gun reload sounds"), with the synth as fallback.
- [ ] 8. **Doors**: E near a scan door (start with the pink #97 door, left side, u≈1.5, v≈-4.8) fades to black and
      teleports you into a simple cube room (walls, floor, ceiling light, colliders). E at its door returns you to the street.
      Zombies pause while you're inside.
- [ ] 9. **Polish**: performance pass, HUD tidy, README showcase screenshots, update `docs/showcase`.

## Rules
- Only CC0 / public-domain downloads; record the source in `app/public/game/CREDITS.txt`.
- Don't break the scanned world or the stage. Keep about 45 fps or better.
- Commit after every item.
