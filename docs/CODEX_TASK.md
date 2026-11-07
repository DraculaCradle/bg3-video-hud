# Codex task: BG3 Video HUD – functional MVP

> Historical brief. The user now requires standalone operation without BG3 HUD dependencies and performs live tests manually. Current instructions and behavior are in [AGENTS.md](../AGENTS.md) and [the prototype comparison](PROTOTYPE_COMPARISON.md); do not restore the old required-module gate or restart automatic live tests from this brief.

## User goal
User runs Foundry VTT **v14 Stable** with **D&D5e 6.0.6** and already uses the publicly released BG3 Inspired HUD. Player-character usability is poor. They have two unpublished demonstration videos by a separate author who customized BG3 Inspired HUD; reimplement similar layout and usability from description, not from unavailable author code.

## Visual/UX specification
- Bottom-of-screen compact overlay like an RPG HUD, anchored near screen edge without obscuring map.
- Left: rounded/circular PC portrait, HP, AC, key actor resources; support token/portrait change, no portrait fallback.
- Three readily visible, distinct groups rather than the default large 'action/bonus/reaction' tiles: **Equipment**, **Features**, **Spells**; pictogram cells are clickable with tooltips.
- Spells have level tabs (0/cantrip to highest available), remaining slots, show only configured/pinned spells when filtering.
- An edit mode that lets a player show/hide, reorder, and drag/drop skills by stable item ID; changes persist for that player/actor.
- Action, Bonus Action, Reaction affordances and a compact Short Rest/Long Rest area.
- Optional toggle between original UI and video HUD. Avoid duplicate HUD overlays or hijacking system controls.
- Optimize for PC use; do not require GM role for common controls.

## Phase 1 deliverables (required first)
- A working `module.json` with `id=bg3-video-hud`, compatibility v14, module dependencies on `bg3-hud-core` and `bg3-hud-dnd5e`.
- ES module registration `scripts/module.js`, isolated `styles/video-hud.css`, appropriate templates/components.
- Actor/Token selection handling, rerender on item/resource updates.
- Equipment, Features, Spells taxonomy and item usage adapter with safe fallbacks.
- Per-user/per-actor visibility/order persistence; show/hide edit UI.
- Accessible tooltips and compact responsive layout.
- Code tests + manual acceptance checklist, installation instructions.
- Create a PR against `main`, note tests and any unavailable Foundry runtime limitations.

## Phase 2
- Full visual polish based on screenshots supplied within authorized task context, animations, keyboard shortcuts, localization zh-CN, multi-PC use and performance.
- Additional item activity variants and robust permission handling.
- Packaging of installable zip + module manifest release pipeline.

## Acceptance
Manual Foundry v14 + D&D5e 6.0.6 test with at least two player characters (martial + spellcaster), a GM view, switching tokens/scenes, spell use including slot/pact/cantrip, short/long rest, actor HP changes, and disabling the addon without loss of upstream quickbar configuration.

## Resources
https://github.com/BragginRites/bg3-hud-core
https://github.com/BragginRites/bg3-hud-dnd5e

Do not copy unreleased video source or unpublished mod files. Do not commit video frames or credentials to this public repository. Upstream code licensing must be checked before copying code.
