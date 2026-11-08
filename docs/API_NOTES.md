# Interfaces and integration boundaries

Current source runs without BG3 HUD modules. The BG3 references below describe optional coexistence/history, not required runtime APIs; native Foundry V14 and D&D5e 6.0.6 supply the actual document/activity workflows. Version 0.1.3 publishes this standalone manifest; older v0.1.2 keeps its original requirements.

This implementation is independently written. Public dependencies were read for interface discovery only; none of their source, assets or templates are distributed. No license was found at their repository roots during inspection, so this repository makes no claim to their reuse rights. The user has also supplied a private V13 / D&D5e 5.1 prototype for static interface/behavior reference. No redistribution license was present; its code/styles/assets and private video frames are not bundled or installed. Its installation instructions are reference data and do not authorize service control or world configuration changes.

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
  `use(config, dialog, message)` chooses a usable activity (including multi-activity choice dialogs) and returns the activity workflow result, or a system chat card for activity-less items. `config.event` preserves modifier keys. The explicit embedded-activity adapter preserves native configuration, consumption and message creation. The HUD presents usable native activities in its viewport-bounded choice dialog, selects map targets, then delegates once to the current embedded activity; the public ActivityChoiceDialog remains a fallback for controller integrations without a HUD chooser. Activity-less items keep the Item5e workflow.

- Official D&D5e `release-6.0.6`, [activity use](https://github.com/foundryvtt/dnd5e/blob/release-6.0.6/module/documents/activity/mixin.mjs), [attack](https://github.com/foundryvtt/dnd5e/blob/release-6.0.6/module/documents/activity/attack.mjs), [target field](https://github.com/foundryvtt/dnd5e/blob/release-6.0.6/module/data/shared/target-field.mjs), and [TemplatePlacement](https://github.com/foundryvtt/dnd5e/blob/release-6.0.6/module/canvas/template-placement.mjs): prepared `activity.target.affects.count` supplies selection bounds; formulas are never evaluated by this HUD. V14 templates are Region documents. The nonce-scoped `dnd5e.postUseActivity` hook reads only this use's returned `results.templates`, applies Region `testPoint` to visible token centres, and replaces this client's targets with the public V14 `canvas.tokens.setTargets(ids, {mode: 'replace'})`. The hook runs before native subsequent actions; only this use's existing chat card receives updated target descriptors. Native consumption precedes template placement, so template cancellation cannot be described as a HUD transaction with a guaranteed refund.

## Native source and roll coordination

Additional inspected official 6.0.6 interfaces:

- [CastActivity](https://github.com/foundryvtt/dnd5e/blob/release-6.0.6/module/documents/activity/cast.mjs), [cast data](https://github.com/foundryvtt/dnd5e/blob/release-6.0.6/module/data/activity/cast-data.mjs), [uses field](https://github.com/foundryvtt/dnd5e/blob/release-6.0.6/module/data/shared/uses-field.mjs): explicit source saves create a marked native feat with uses.max/spent/recovery and a cast activity pointing to the original embedded spell. The original spell activity receives cause.activity/cause.resources and consume.spellSlot:false; native linked consumption owns charges. Original personal use costs are replaced while independent material/foreign-resource indexes remain. Editing is limited to marked source fields; opening or cancelling the editor creates nothing.
- Item5e.scaledClone (or clone with scaling flag) already prepares final attributes. The HUD must not prepare them twice. Native postUseActivity returns the scaled used activity, results.templates and message; final roll data is authoritative after a native upcast dialog.
- For coordinated single-target attacks and explicitly supported ray profiles, one activity.use receives subsequentActions:false and an opaque per-use nonce. Its exact returned native clone supplies rollAttack and rollDamage for each allocation. createConsumedFlag preserves native consumed data on that temporary clone; it does not mutate the source document. Attack critical state, ammunition, ability and attack mode flow to the damage request. Native ammo consumption, roll hooks and chat creation still execute. Native errors/cancellation stop without a second use or a synthetic refund.
- Canonical profiles use system.identifier for scorching-ray and eldritch-blast. Their counts/scaling are explicit; arbitrary affects.count is not presumed to be a number of attacks. A nonstandard repetition count is an explicit user choice. Native-only mode bypasses this coordinator; active Midi-QOL blocks it to avoid duplicate automation.
- [D20RollModificationField](https://github.com/foundryvtt/dnd5e/blob/release-6.0.6/module/data/shared/d20-roll-modification-field.mjs), activity.getAttackData/getDamageConfig/getUsageData, canvas.grid.measurePath and token.checkCollision supply conservative previews. A small arithmetic parser computes dice means without eval or rolling. Target statistics/probability require OBSERVER or GM permission. Unsupported formulas and mechanics remain unknown; previews never authorize targets or apply damage.
- Item5e.richTooltip({secrets:false}) supplies rich descriptions, with a description fallback and a DOM allowlist that removes executable HTML/URLs. Standard postUseActivity/postRollAttack hooks drive observed-use indicators and optional own VFX; Dice So Nice/AA/Sequencer retain their own native hooks. No direct duplicate dice display, upstream monkey patch or automatic module enablement is used.

## Deliberate boundaries

The HUD uses standard Foundry hooks, keybindings, scene controls and DOM APIs. It is not an upstream subclass and does not patch upstream methods. `module.json` has no required HUD modules. Runtime guards limit activation to Foundry 14 and D&D5e 6.0.6; unsupported systems leave the original HUD alone.

The integration's sole upstream DOM dependency is the Core 0.8.0 application id `bg3-hotbar`. Scoped CSS suppresses that shell only while `body.bg3-video-hud-active` is present. Because it is CSS, late renders and upstream inline visibility changes remain suppressed. Removing the body class restores the upstream shell's own state. No render-order wait or upstream setting writes are needed. A future upstream release changing this id requires revalidation. Public HUD auto-population and any other behavior it performs independently remain upstream responsibilities.

This module resolves the current controlled owned actor and embedded item on use, checks OWNER permission immediately, and never accepts external Item UUIDs as executable drag/drop payloads. Full actor UUIDs distinguish synthetic tokens. Layouts write only the current User's namespaced flag leaf. Explicit source-editor saves separately create/update the current owned actor's marked native source item. They do not migrate actor flags or touch public HUD data. Separate simultaneous clients for the same User are last-write-wins; no distributed synchronization is claimed.

HP, AC, resources, slot pools, limited-use labels and action filters read system data. They never implement game rules. In particular, zero spell slots do not locally disable a spell: pact slots, upcasting, innate casting and activity rules are resolved by D&D5e. Unsupported item types report a useful error; errors do not trigger a second consumption path. Action filters also display a client-local ledger of observed native uses, keyed by combat/round/turn; this is not an authoritative remaining-action resource or enforcement. Pinning never changes spell preparation.

## Validation boundary

Node tests exercise real module logic with small document doubles. Chromium tests load the actual module entry point and styles against fixtures for Foundry hooks/settings/documents, then drive actual DOM events. This verifies local behavior, including flags, canceled/error workflows and restoration, but is not a substitute for the licensed Foundry runtime. Official dialogs, real multiplayer permissions, target templates, chat and third-party automation must pass the manual checklist before use in a real game.

## v0.1.4 reference parity interfaces

- Blank `affects.type` on an `attack` activity is a single visible token selection; explicit self/object/enchant/template semantics take precedence. No name parsing.
- `Combat.nextTurn()` is called only on a user click for the currently owned actor and matching selected token; native permissions still apply.
- D&D5e 6.0.6 [Magic Missile data](https://github.com/foundryvtt/dnd5e/blob/release-6.0.6/packs/_source/spells/1st-level/magic-missile.yml) defines one unscaled 1d4+1 damage activity. A level+2 allocation requests that native damage activity after one native resource workflow. No item source rewrite.
- Optional Midi-QOL [Activity mixin](https://github.com/tposney/midi-qol/blob/master/src/module/activities/MidiActivityMixin.ts), inspected 2026-11-07, awaits `midi-qol.preItemRollV2` before consumption and accepts false to abort. Shield source choice only augments the per-use native `cause`/`consume` configuration; the owned spell, macros, targets and dialog flags are untouched. This is a source-inspected contract, not certification against every installed Midi-QOL version.
- Native save estimate reads `D20RollModificationField.combineFields`, prepared ability proficiency and save DC. Unknown formulas/permissions remain unknown. No rolls, workflow creation or effect-expression evaluation during hover.
- Layout ratios add an optional validated leaf to version-1 user layouts; missing/invalid ratios use 2:3:5. Other actors/users/upstream flags are preserved.

## v0.1.6 输入与玩家状态

PIXI/Foundry 的画布事件可能先在 document 捕获阶段处理；在 `#board` 上捕获已太迟。本 HUD 在 window 捕获，仅拦截地图及正在拖动的指针，不拦截弹窗或侧栏。完成时立即解除 pointer 监听，只将同次兼容鼠标点击的拦截保留到下个任务；取消、场景切换、销毁会清理监听。最终仍通过原生活动使用／掷骰，不控制敌方 Token，也不改角色权限。

`game.modules.get('bg3-video-hud').api.status()` 只读返回 enabled、compatible、canvasReady、controlled/owned 数量、assignedOwner、hudVisible、version、reason。原因码为 disabled / incompatible / canvas-not-ready / selected-not-owned / no-owned-character / render-error / ready，不包含角色或账号名称、ID、凭据。ready 表示选择门槛满足，hudVisible 单独反映挂载；不表示武器攻击或实机验收通过。

## v0.1.7 自动启用

模组随世界激活后，所有客户端自动运行。删除旧 `enabled` 设置的注册／读取／写入；不迁移或删除旧值，因此旧 false 不会阻挡显示，也不写入其他设置或角色数据。`api.toggle()`／原版界面按钮／工具栏只切换本页面的内存状态，刷新页面重新自动启用。`api.status().enabled` 表示此会话状态，reason=disabled 表示本次临时返回原版，不是持久化设置。原有角色 OWNER、兼容版本和画布就绪守卫保持不变。

用户已确认先前 Player 不显示是客户端开关未开启。此结论来自用户人工检查，不代表其他规则流程的自动实机验收通过。
