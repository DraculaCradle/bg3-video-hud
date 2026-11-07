# Instructions for Codex agents

This repository contains an independent Foundry VTT module, *not* the original unshipped mod shown in private demo videos.

**Deliver working code rather than a design-only response.** On each task: inspect the repository, make changes, run relevant syntax/build tests, document what was and wasn't tested, and open a PR with concise notes.

## Constraints

- Target Foundry 14 Stable / D&D5e 6.0.6.
- Run independently of other HUD modules. `bg3-hud-core` and `bg3-hud-dnd5e` are optional coexistence integrations; do not require, enable, disable or import them. Inspect public APIs before adding optional integrations.
- Do not mutate or fork upstream module files in place; prefer a distinct module id `bg3-video-hud` and isolated CSS namespace.
- Preserve player data and avoid irreversible flag migrations.
- Use the system's official item/activity use routines for spell slots, limited uses, targets, concentration and chat cards. Never simply decrement a slot in custom UI code.
- Guard for absent actor/token, GM vs PC permissions, scene changes, unsupported item/activity types.
- Respect upstream licensing: no license file was found at the inspected public repo roots, so avoid assuming blanket reuse rights. Treat videos as user-provided private references; do not commit them.
- Do not store credentials or tokens in repo, logs, tests or issues.

## MVP acceptance

1. Module can be installed with `module.json` and loads without console errors in a v14 test world.
2. HUD shows selected actor portrait, HP and AC without throwing on actors missing one stat.
3. Equipment/Features/Spells lists display user-owned actor items, with stable IDs.
4. Clicking an item delegates to D&D5e's actual use/activity method and reports errors rather than fabricating success.
5. Filter spell levels including cantrips, show spell slots from the system and handle pact spells.
6. Edit visibility and order, persist per actor/user without damaging original BG3 HUD flags.
7. Toggle custom HUD on/off to return to Foundry, restoring any optionally installed BG3 HUD shell; avoid overlapping widgets.
8. Include unit tests for grouping/filtering/persistence and explicit manual smoke-test checklist.

When uncertain, first deliver an MVP that is installable, conservative, and testable. Document unverified Foundry integrations.
