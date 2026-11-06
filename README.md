# BG3 Video HUD

Foundry VTT v14 + D&D5e HUD customization project. An independently implemented extension inspired by private demonstration videos and built to work **alongside** the publicly released BG3 Inspired HUD.

> **Status:** functional MVP with automated model/action/persistence and Chromium DOM tests. Not yet verified in a running Foundry VTT v14 / D&D5e 6.0.6 world. Manifest compatibility declares the intended target, not a completed in-game certification.

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

Read [AGENTS.md](./AGENTS.md) and [the MVP development brief](./docs/CODEX_TASK.md). The module is implemented in `scripts/` and `styles/`, with no runtime npm dependencies or compilation step.

## Install in a backed-up test world

1. Install Foundry v14 Stable, D&D5e **6.0.6**, `bg3-hud-core` **0.8.0** and `bg3-hud-dnd5e` **0.8.0** separately. No upstream code is bundled here.
2. Run `npm run package` from this checkout (Node >=22.8 and Python 3 required). Extract `dist/bg3-video-hud.zip` into `<Foundry User Data>/Data/modules/bg3-video-hud/`, with `module.json` directly inside that directory. Alternatively copy `module.json`, `scripts/`, and `styles/` into that directory.
3. Restart Foundry if needed, then enable both public HUD modules and **BG3 Video HUD** in the test world's module management.
4. Each player opts in using **Game Settings → Configure Settings → BG3 Video HUD → Use BG3 Video HUD**, or the **Toggle BG3 Video HUD** token scene tool. It is off by default. A keybinding can be assigned in Foundry's controls configuration.
5. Select an owned token; with no controlled token, the assigned owned character is used. Selecting only unowned tokens hides this HUD. During canvas teardown the original HUD is restored.

The manifest's release URLs become usable after a maintainer publishes release `v0.1.0` with the built ZIP and `module.json` as assets. They are not pre-existing hosted downloads. The release workflow handles version-matching tags; ordinary branch pushes and PRs do not publish a release.

For Linux server installation or upgrades, use the [deployment guide](docs/DEPLOYMENT.md) and `tools/deploy_linux.py`. It accepts the real user data directory, checks permissions/dependencies, verifies a backup before replacement, and rolls back caught failures. Release assets also include the standalone script and SHA-256 checksums. No server path is assumed, and server deployment / ModsTest validation have not yet been performed.

## Use

- The bottom dock automatically scales its width, height, icons, text and spacing with the available CSS viewport: about 188px high at 720P, 230px at 1080P, 273px at 1440P and 348px at 4K, with upper/lower bounds. Zoomed or short viewports keep a compact side layout. Each group scrolls independently; names/details remain available in tooltips and accessible names. Spell levels, slots and activation filters share the top strip. **Edit** reveals names and editing controls within the same height. See the [adaptive layout guide and five-resolution previews](docs/COMPACT_HUD.md).
- Click an item cell to call D&D5e's `Item5e.use({event})`. The system chooses among activities and owns targeting, spell-slot choice/upcasting, limited uses, concentration, templates and chat cards. An item without activities may display its system chat card. No slot/resource values are manually decremented, and canceled dialogs do not produce a success notification.
- **Equipment / Features / Spells** show owned embedded items. Level tabs include cantrips (0). Regular and pact slots are separate read-only pools, including zero remaining slots. Innate/unprepared spells are not silently removed: the system remains responsible for eligibility and consumption.
- **Action / Bonus Action / Reaction** are activity filters, not invented turn-resource counters. Multi-activity items match every relevant activation type. They do not change combat state.
- In **Edit**, show/hide items, pin spells and reorder within each group by dragging or the accessible ↑/↓ buttons. Hidden and unpinned items remain visible for editing; item use is disabled there. **Pinned only** filters spells. Short/long rests call the official system dialogs.
- Settings are stored on the current **User**, under `flags.bg3-video-hud.layouts`, keyed by full actor UUID. Players can configure their own layout without permission to modify another user's document. Synthetic token actors have separate identities. Same-client edits are serialized; simultaneous sessions for the same user use last-write-wins semantics.
- **Original HUD** turns this module's client setting off. The module temporarily hides only the public HUD's DOM shell while the replacement is actually mounted. Original HUD settings, flags, order and source files remain unchanged, including an originally disabled public HUD.
- Optional macro: `await game.modules.get("bg3-video-hud").api.toggle()`.

## Development and checks

```sh
npm ci
npm run check
npm test
npm run test:browser
npm run test:deploy
npm run package
```

There are no npm dependencies; `npm ci` only checks the lockfile. `check` validates the manifest, its asset paths and JS syntax. The Node suite covers grouping, filters, ownership, UUID-scoped persistence and official method delegation. Browser tests use a **local Foundry API fixture** in real Chromium, not a Foundry server. Install Chromium on your development machine or set `CHROMIUM_PATH` to a compatible Chrome executable. The runner uses a temporary browser profile, a loopback-only HTTP server, and container-compatible `--no-sandbox`; run these trusted local fixtures in an isolated development environment.

See [the test report](docs/TEST_REPORT.md) for executed checks, including real Chromium viewport/keyboard testing and the remote access blocker; [manual acceptance tests](docs/MANUAL_TESTS.md) for in-game requirements; and [API notes](docs/API_NOTES.md) for inspected interfaces and compatibility limitations. Automated checks cannot prove actual D&D5e consumption, permissions, targeting, concentration or chat-card behavior without a Foundry world.

## Safety

For the existing shared Foundry instance at redmagic.club, see [ModsTest deployment and runner setup](docs/MODSTEST_SETUP.md). Automation verifies the active world and test-only sessions before updating only `Data/modules/bg3-video-hud`, keeps verified backups and recovery journals, and never stops/restarts Foundry or switches worlds. First installation or any manifest/version change requires an administrator's maintenance window. The module is inert outside a world titled ModsTest. [The test report](docs/AUTOMATION_REPORT.md) distinguishes local validation from live checks that have not run.

Test only in a backed-up test world first. Spell/item consumption, ownership permissions, PC token switches and chat cards must be verified before real sessions.
