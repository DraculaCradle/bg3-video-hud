# BG3 Video HUD

Foundry VTT v14 + D&D5e HUD customization project. An independently implemented extension inspired by private demonstration videos and built to work **alongside** the publicly released BG3 Inspired HUD.

> **Status:** experimental; not yet verified in a running Foundry VTT v14 / D&D5e 6.0.6 world.

## Goals

- Compact round portrait with HP/AC and resource indicators.
- Separate **Equipment**, **Features**, **Spells** panels with direct clickable actions.
- Customizable visibility and drag/drop ordering per character.
- Spell-level switching and real spell-slot counters.
- Action / Bonus Action / Reaction indicators and Short/Long Rest access.
- Preserve existing BG3 Inspired HUD data; offer a simple toggle to revert.
- Prioritize usability for human player characters over GM-only controls.

## Target versions

- Foundry VTT v14 Stable
- D&D5e 6.0.6
- BG3 Inspired HUD – Core 0.8.0
- BG3 Inspired HUD – D&D5e 0.8.0

## Upstream references

- https://github.com/BragginRites/bg3-hud-core
- https://github.com/BragginRites/bg3-hud-dnd5e

**Source and rights:** The video author's unreleased code is unavailable. Build our own UI and integration; do not copy or redistribute upstream source without establishing permission/license. The privately shared videos/screenshots must not be committed to this public repository.

## Start here

Read [AGENTS.md](./AGENTS.md) and [the MVP development brief](./docs/CODEX_TASK.md), then create a small working Foundry module with installable `module.json` and smoke tests. Develop on a feature branch and raise a PR.

## Safety

Test only in a backed-up test world first. Spell/item consumption, ownership permissions, PC token switches and chat cards must be verified before real sessions.
