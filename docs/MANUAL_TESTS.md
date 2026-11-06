# Foundry v14 / D&D5e 6.0.6 acceptance

Status: **Full live acceptance remains incomplete.** The existing ModsTest instance has the module installed; automated live document reads are currently blocked by missing Socket acknowledgements. See [the current live report](MODSTEST_LIVE_REPORT.md). The compact UI revision below is verified with local Chromium fixtures, not yet installed or certified in Foundry; see [the 720P report](COMPACT_HUD.md). Earlier proxy failures in [the historical test report](TEST_REPORT.md) are not the current diagnosis.

Use a backed-up disposable world with two player-owned characters (martial and spellcaster, including a pact caster or multiclass test actor), a separate GM account, and Core/D&D5e HUD 0.8.0. Record exact Foundry build, system/module versions, browser, user role, steps, expected/observed result and console errors for every failure. Do not include credentials, private videos or player data in reports.

## Installation and first load

- [ ] Build `npm run package`; extract the ZIP with `module.json` directly in `Data/modules/bg3-video-hud/`. Foundry discovers the module and enforces system/dependency requirements.
- [ ] Enable all required modules. Reload as GM and as an ordinary player. No console errors occur. This module is opt-in and original HUD initially looks unchanged.
- [ ] Enable the client option or token toolbar toggle. Exactly one HUD appears. Reload with it enabled to check persistence and late upstream rendering. Assign a toggle keybinding and exercise it.
- [ ] Disable this module entirely, reload and confirm the public HUD still works. Re-enable and toggle off with **原版界面**. Check an originally hidden/minimized upstream HUD retains its own preference.

## Actors, permissions and display

- [ ] Select the martial PC, then the caster PC. Portrait (including token art), HP, temporary HP, AC and available resources update, with no stale item list.
- [ ] Clear token selection: assigned owned character is used. Without an assigned character the custom HUD is absent. Selecting only an unowned NPC does not fall back to the assigned PC. GM-owned NPCs work if selected.
- [ ] Test an actor with missing HP, AC, portrait and resources; show fallbacks without errors. Change token image, HP, AC, equipment, features and effects from another client and confirm updates.
- [ ] Switch/delete controlled tokens, scenes and actors; include linked/unlinked tokens and several controlled tokens. Scene teardown restores upstream display; the next scene uses its own controlled/assigned actor.
- [ ] Revoke ownership while HUD is open and attempt item use immediately. No unauthorized use occurs. Confirm ordinary players can edit **their own User flags** and cannot edit other players' layout data.

## System workflows (verify actual state before/after)

Map-targeting behavior is implemented but not live-certified. Follow the additional [single-click, range-selection and native Region checklist](TARGETING.md), including cancellation/consumption timing and multi-ray limitations.

- [ ] Use a weapon attack and a multi-activity item: official activity choice/roll dialogs, targeting, advantage modifiers and chat cards appear exactly once.
- [ ] Use a cantrip: no spell slot consumed. Use levelled spells with normal casting, upcasting and pact slots; selected pool is consumed exactly once. Include multiclass and zero-normal-slots/remaining-pact cases.
- [ ] Cancel activity, casting, targeting/template or roll dialogs at each stage. No fabricated success notification or extra consumption occurs. Compare to identical use from the system character sheet.
- [ ] Use a concentration spell, replace concentration, place an area template and verify system concentration/target behavior and resulting chat actions.
- [ ] Use limited-use features and consumables: charges/quantity change only through the system workflow and update on the HUD. Use innate/at-will and unprepared spells; system eligibility rules remain authoritative.
- [ ] Try a passive/activity-less item and an unsupported item type. The official chat card or meaningful error appears, with no invented roll or resource mutation.
- [ ] Double-click while a dialog/workflow is pending: one workflow opens. Inject/observe a system error; error is visible and the button becomes usable again. Switch tokens while a workflow remains open; no action is redirected to the new actor.
- [ ] Short and long rests open the system's dialogs. Cancel and confirm each; check resource/slot recovery, chat and HUD refresh. Compare with sheet rest behavior, including combat restrictions imposed by the system.

## Filtering, persistence and accessibility

- [ ] Resize continuously through 1280×720, 1366×768, 1920×1080, 2560×1440 and 3840×2160. Confirm the dock, icons, text, portrait and gaps grow smoothly and remain bounded; at 720P it should stay compact. Keep the original-HUD control and both rests visible. Check short browser windows and the real Foundry sidebar, toolbars, chat and system dialogs.
- [ ] On actual displays, test browser zoom 100%/125%/150%/200%, OS scaling and moving between monitors. Record CSS viewport, DPR and observed results separately. Automated effective-viewport/DPR emulation does not certify these physical configurations. In particular, verify 640×360 effective CSS space still allows editing, sorting and returning to the original HUD, and a focused high-level spell remains visible after zoom/resize.
- [ ] With many equipment items, features and spells, wheel-scroll each group to its last item. Updates from another client should preserve each group's scroll position; switching actors should start at the top. Check full bilingual names in hover hints, keyboard accessible names, missing images and use-count badges.
- [ ] Verify spell levels through level 9, pact/regular slot summaries and Edit controls remain reachable without increasing the dock height. Explicit editing may require scrolling; no item should be usable while editing.
- [ ] All owned items appear in Equipment/Features/Spells with stable IDs even when names collide. Levels 0–highest and separate regular/pact slot counts match the character sheet, including depleted pools.
- [ ] Action/Bonus Action/Reaction filter activities, including multi-activity items, without spending turn resources. Filters reset on actor change.
- [ ] Enter Edit: hide/show items, pin/unpin spells, reorder via drag and both arrow buttons. Hidden and unpinned items stay discoverable there. Exiting Edit enables use again. Pinned-only and level filters compose correctly.
- [ ] Reload/logout/login and switch actors/users: each user's layout persists independently; linked/unlinked token identities behave as documented. Add/delete/rename items without remapping IDs or corrupting order.
- [ ] Reject cross-actor, foreign UUID, malformed and cross-group drag payloads. None creates or consumes an item.
- [ ] Snapshot public HUD settings and actor/user flags before edits, rests, token switches, disabling and reloading. Verify this module writes only its own User flags and its own client toggle; public layouts and settings are unchanged.
- [ ] Navigate controls with keyboard only; inspect focus, accessible names, tooltips, arrow-order controls and errors. Resize below 650px and use browser zoom; all groups remain reachable by scrolling and no control is stranded.

## Optional compatibility checks

- [ ] If used in the target world, compare Midi-QOL/other automation behavior with the character sheet's official item workflow. This MVP does not promise every module combination.
- [ ] Test a deliberately unsupported system/version; custom HUD stays disabled and original remains available.

Release sign-off requires all applicable required checkboxes above, with recorded versions and observations. Automated fixture results alone do not close these boxes.
