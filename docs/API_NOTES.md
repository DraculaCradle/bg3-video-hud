# Interfaces and integration boundaries

This implementation is independently written. Public dependencies were read for interface discovery only; none of their source, assets or templates are distributed. No license was found at their repository roots during inspection, so this repository makes no claim to their reuse rights. Private demonstration video code and frames are not used or included.

## Inspected references

- BG3 HUD Core 0.8.0, `ffae3d75bf9be5ceb670b826e3f049e288864a48`:
  [module registration](https://github.com/BragginRites/bg3-hud-core/blob/ffae3d75bf9be5ceb670b826e3f049e288864a48/scripts/module.js),
  [application shell](https://github.com/BragginRites/bg3-hud-core/blob/ffae3d75bf9be5ceb670b826e3f049e288864a48/scripts/BG3Hotbar.js), and `scripts/utils/registry.js`.
  Exposes `ui.BG3HOTBAR.api`, adapter registration hooks, and `ui.BG3HUD_APP`. Its `toggle()` writes its own client setting, so this module deliberately does **not** call it to avoid overwriting the user's original visibility preference.
- BG3 HUD D&D5e 0.8.0, `13385bc483a186984560b609feb0f221d3ae5922`:
  [item/activity workflows](https://github.com/BragginRites/bg3-hud-dnd5e/blob/13385bc483a186984560b609feb0f221d3ae5922/scripts/features/ItemUseWorkflow.js),
  [rest definitions](https://github.com/BragginRites/bg3-hud-dnd5e/blob/13385bc483a186984560b609feb0f221d3ae5922/scripts/components/containers/DnD5eActionButtonsContainer.js), and spell-slot display interfaces.
- Official D&D5e `release-6.0.6`,
  [Item5e.use](https://github.com/foundryvtt/dnd5e/blob/release-6.0.6/module/documents/item.mjs):
  `use(config, dialog, message)` chooses a usable activity (including multi-activity choice dialogs) and returns the activity workflow result, or a system chat card for activity-less items. `config.event` preserves modifier keys. The explicit embedded-activity adapter preserves native configuration, consumption and message creation. The HUD uses the public `game.dnd5e.applications.activity.ActivityChoiceDialog.create(item)` when needed, selects map targets, then delegates once to the current embedded activity. Activity-less items keep the Item5e workflow.

- Official D&D5e `release-6.0.6`, [activity use](https://github.com/foundryvtt/dnd5e/blob/release-6.0.6/module/documents/activity/mixin.mjs), [attack](https://github.com/foundryvtt/dnd5e/blob/release-6.0.6/module/documents/activity/attack.mjs), [target field](https://github.com/foundryvtt/dnd5e/blob/release-6.0.6/module/data/shared/target-field.mjs), and [TemplatePlacement](https://github.com/foundryvtt/dnd5e/blob/release-6.0.6/module/canvas/template-placement.mjs): prepared `activity.target.affects.count` supplies selection bounds; formulas are never evaluated by this HUD. V14 templates are Region documents. The nonce-scoped `dnd5e.postUseActivity` hook reads only this use's returned `results.templates`, applies Region `testPoint` to visible token centres, and replaces this client's targets with the public V14 `canvas.tokens.setTargets(ids, {mode: 'replace'})`. The hook runs before native subsequent actions; only this use's existing chat card receives updated target descriptors. Native consumption precedes template placement, so template cancellation cannot be described as a HUD transaction with a guaranteed refund.

## Deliberate boundaries

The HUD uses standard Foundry hooks, client settings, keybindings, scene controls and DOM APIs. It is not an upstream subclass and does not patch upstream methods. `module.json` requires both public modules. Runtime guards limit activation to Foundry 14 and D&D5e 6.0.6; unsupported systems leave the original HUD alone.

The integration's sole upstream DOM dependency is the Core 0.8.0 application id `bg3-hotbar`. Scoped CSS suppresses that shell only while `body.bg3-video-hud-active` is present. Because it is CSS, late renders and upstream inline visibility changes remain suppressed. Removing the body class restores the upstream shell's own state. No render-order wait or upstream setting writes are needed. A future upstream release changing this id requires revalidation. Public HUD auto-population and any other behavior it performs independently remain upstream responsibilities.

This module resolves the current controlled owned actor and embedded item on use, checks OWNER permission immediately, and never accepts external Item UUIDs as executable drag/drop payloads. Full actor UUIDs distinguish synthetic tokens. Layouts write only the current User's namespaced flag leaf. They do not migrate actor flags or touch public HUD data. Separate simultaneous clients for the same User are last-write-wins; no distributed synchronization is claimed.

HP, AC, resources, slot pools, limited-use labels and action filters read system data. They never implement game rules. In particular, zero spell slots do not locally disable a spell: pact slots, upcasting, innate casting and activity rules are resolved by D&D5e. Unsupported item types report a useful error; errors do not trigger a second consumption path. Action filters are not turn tracking, and spell preparation is not modified by pinning.

## Validation boundary

Node tests exercise real module logic with small document doubles. Chromium tests load the actual module entry point and styles against fixtures for Foundry hooks/settings/documents, then drive actual DOM events. This verifies local behavior, including flags, canceled/error workflows and restoration, but is not a substitute for the licensed Foundry runtime. Official dialogs, real multiplayer permissions, target templates, chat and third-party automation must pass the manual checklist before use in a real game.
