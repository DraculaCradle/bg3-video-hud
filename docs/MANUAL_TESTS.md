# Foundry v14 / D&D5e 6.0.6 acceptance

Status: **Full live acceptance remains incomplete.** The existing ModsTest instance has the module installed; automated live document reads are currently blocked by missing Socket acknowledgements. See [the current live report](MODSTEST_LIVE_REPORT.md). The current Chinese UI, cast/source manager and coordinated attacks are verified with local Chromium fixtures, not yet installed or certified in Foundry; see [the 720P report](COMPACT_HUD.md). Earlier proxy failures in [the historical test report](TEST_REPORT.md) are not the current diagnosis.

Use only the existing ModsTest world and uniquely marked temporary test characters (never a second Foundry instance or another world), with two player-owned characters (martial and spellcaster, including a pact caster or multiclass test actor) and a separate GM account. v0.1.3 and v0.1.4 need no BG3 modules; the older v0.1.2 still does. Test optional BG3 coexistence separately only when the administrator chooses it. Automatic live testing is stopped; the user performs these checks. Record versions, browser, user role, steps and expected/observed results without credentials or private player data.

## Installation and first load

- [ ] Build `npm run package`; extract the ZIP with `module.json` directly in `Data/modules/bg3-video-hud/`. Foundry discovers the module and enforces system/dependency requirements.
- [ ] Enable all required modules. Reload as GM and as an ordinary player. No console errors occur. The activated module automatically starts on both clients; old enabled=false does not block it.
- [ ] Select an owned character Token after module activation; exactly one HUD appears without a client setting. Temporarily return to native, then reload to confirm automatic restoration and late upstream rendering. Assign a toggle keybinding and exercise it.
- [ ] Disable this module entirely, reload and confirm the public HUD still works. Re-enable and toggle off with **原版界面**. Check an originally hidden/minimized upstream HUD retains its own preference.

## Actors, permissions and display

- [ ] Select the martial PC, then the caster PC. Portrait (including token art), HP, temporary HP, AC and available resources update, with no stale item list.
- [ ] Clear token selection: assigned owned character is used. Without an assigned character the custom HUD is absent. Selecting only an unowned NPC does not fall back to the assigned PC. GM-owned NPCs work if selected.
- [ ] Test an actor with missing HP, AC, portrait and resources; show fallbacks without errors. Change token image, HP, AC, equipment, features and effects from another client and confirm updates.
- [ ] Switch/delete controlled tokens, scenes and actors; include linked/unlinked tokens and several controlled tokens. Scene teardown restores upstream display; the next scene uses its own controlled/assigned actor.
- [ ] Revoke ownership while HUD is open and attempt item use immediately. No unauthorized use occurs. Confirm ordinary players can edit **their own User flags** and cannot edit other players' layout data.

## System workflows (verify actual state before/after)

- [ ] In an explicitly installed development build, with BG3 modules absent or manually disabled only in ModsTest, enable this HUD and use an owned actor. Native hotbar is hidden only while the replacement is mounted; disabling restores its original display state. If testing optional BG3 coexistence, confirm its flags/settings and enabled state stay unchanged.
- [ ] Default quick use: one usable activity on an ordinary item/cantrip skips redundant HUD choices; a levelled spell still requires slot/source choice. Multiple activities remain explicit. Enable **详细** to access all activity/count/allocation/native options. Activities, cast pools/sources and manual allocations appear outside the HUD in viewport-bounded scrollable dialogs. Check keyboard Tab/Enter, Esc, close, cancel and actor/token changes. The choice dialog closes before map/system interaction, and a nested source dialog closes independently.

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
- [ ] Supported weapons, active items/features and spells appear in Weapons/Items/Features/Spells with stable IDs even when names collide. Passive inventory/features are excluded in normal and edit views. Levels 0–highest and separate regular/pact slot counts match the character sheet, including depleted pools.
- [ ] Action/Bonus Action/Reaction filter activities, including multi-activity items. Observed-use counts update from native uses and reset with combat position, without enforcing invented remaining actions. Filters reset on actor change.
- [ ] Enter Edit: hide/show items, pin/unpin spells, reorder via drag and both arrow buttons. Hidden and unpinned items stay discoverable there. Save commits the whole draft; Cancel discards every pending visibility/pin/order change. Repeated arrows must follow draft order, not the old saved order. Exiting Edit enables use again. Pinned-only and level filters compose correctly.
- [ ] Reload/logout/login and switch actors/users: each user's layout persists independently; linked/unlinked token identities behave as documented. Add/delete/rename items without remapping IDs or corrupting order.
- [ ] Reject cross-actor, foreign UUID, malformed and cross-group drag payloads. None creates or consumes an item.
- [ ] Snapshot public HUD settings and actor/user flags before edits, rests, token switches, disabling and reloading. Verify layout edits write only this module's User layout flags; only an explicit source-editor Save creates/updates the marked native source feature on the current actor. Original spells, unrelated features, public HUD layouts and other-world settings are unchanged.
- [ ] Navigate controls with keyboard only; inspect focus, accessible names, tooltips, arrow-order controls and errors. Resize below 650px and use browser zoom; all groups remain reachable by scrolling and no control is stranded.

## Added video feature acceptance

- [ ] Inline activity/casting panels: Back and Cancel do not activate anything; normal weapons/cantrips have a coordinated entry; native-only mode remains usable even if custom repetition fields are invalid. Compare normal, pact and final native upcast choices to the sheet.
- [ ] Source editor: Cancel creates nothing; explicit Save creates exactly one marked native feat. Verify limited/unlimited sources, depleted/disabled rejection, preserved original spell/material costs, source-only charge, short/long-rest and daily recovery through native routines. Snapshot and restore only uniquely marked temporary test sources.
- [ ] Scorching Ray and Eldritch Blast: one native activation, correct final count, one attack/damage per allocated ray, repeated targets, criticals, native known misses, cancellation and errors. Match native ability/ammo/weapon mode choices. No second activation or automatic HP application. Custom/magic-missile/shared-roll rules require separate native comparison.
- [ ] Default range auto-selection and optional manual repeat/undo allocation; cancellation before use versus after native consumption; stopping during a native dialog, changing actors/scenes or revoking ownership prevents later steps and false completion feedback.
- [ ] Search/IME, safe rich tooltip by hover and keyboard, complete names, classification bulk select/clear/reset/count, draft Save/Cancel and concurrent-client change guard. At 640×360 effective CSS space, scroll to every option and return/close control without losing focus.
- [ ] HP/temp HP and slot pips match actual values. Aim line/icon/count and basic estimates do not expose hidden or non-observer HP/AC. Unknown formulas stay unknown; preview disagreements never override native rules.
- [ ] Party overview and floating status obey observer/owner permissions and only select visible current-scene tokens. No scene/world switch. Test fallback VFX with reduced motion, AA on/off, Dice So Nice and other automation. Native-only mode should avoid duplicate roll/effect paths.

## Optional compatibility checks

- [ ] If used in the target world, compare Midi-QOL/other automation behavior with the character sheet's official item workflow. This MVP does not promise every module combination.
- [ ] Test a deliberately unsupported system/version; custom HUD stays disabled and original remains available.

Release sign-off requires all applicable required checkboxes above, with recorded versions and observations. Automated fixture results alone do not close these boxes.

## v0.1.4 优先人工验收

1. 普通近战／远程武器点击后出现地图选目标提示，未点目标前没有聊天卡或消耗；点空地不使用，Esc／右键取消；点有效目标只进入一次原生流程。另测多活动武器的单／双手选择。
2. 对照原作者：独立圆形头像及 AC／血条、四块金边技能栏、上方资源条、右侧圆形按钮；720P 与 4K、侧栏开关、浏览器缩放下可达。拖动分栏／方向键微调、Esc 撤销、Home 重置，重新载入后比例保留。
3. 分组编辑在弹窗完成，保存与取消分开；施法环阶／来源卡片、删除来源二次确认不挤入 HUD。
4. 本人当前回合可结束且连点不连跳；切其他 Token 不可结束；短休／长休保留系统确认。
5. SRD 魔法飞弹在不启用额外战斗自动化的测试组合中：三枚／升环多枚目标分配、原生伤害卡和一次消费。启用 Midi-QOL／CPR 的组合单独验证其原生分配，不能把 mock 测试当认证。
6. 已有护盾术及可用免费来源的角色，在原生 Midi-QOL 反应已确认时检查来源弹窗：法术位、来源、取消各一次，核对实际消费及无重复反应。不要为了此测试自动安装／启用其他模组。

自动实机测试继续停止。请只使用 ModsTest 的临时测试角色并记录结果；不向公开问题贴玩家数据、账号凭据或完整私有截图。

## v0.1.6 Player 与点击回归

- GM 激活世界内模组后，GM／Player 客户端均自动启用 HUD；Player 仅选择 OWNER 角色的 Token；不自动授予或提升权限。先保持 ModsTest 人工验收。
- 若 Player 未显示，记录黄色／红色提示；如可使用开发者工具，运行 `game.modules.get('bg3-video-hud').api.status()`，只反馈原因码及布尔状态。浏览器阻止粘贴则跳过，不关闭保护。先前现场原因已由用户确认是旧客户端开关关闭；新版移除此开关。
- 普通武器进入点选后点击可见 Token：应使用原生攻击流程，当前受控 Token 保持操作者；取消不消耗。随后普通地图点击应恢复选择功能。

## v0.1.8 战斗分类（历史；被动项目显示规则由 v0.1.9 替代）

- 选择包含职业、子职业、背景、种族与独立种族／职业 feat 的角色。资料条目不出现在装备、特性、法术栏或编辑器；独立 feat、武器、防具、药水、工具、容器及杂物仍可显示。
- 进入分组／全部编辑，计数和批量显示只针对上述支持项目。恢复自动显示或旧排序不能把背景等资料带回；角色卡上的职业、背景、等级、授予特性和原有数据保持不变。

## v0.1.9 四栏与主动项目

- 武器、物品、特性、法术分别显示且独立搜索／滚动／编辑，三个分隔条均支持键盘。旧三栏布局读取后转换，重置为 2:2:3:5；旧隐藏／排序仍按稳定 ID 生效。
- 普通铠甲、盾牌、弹药、宝石、羊皮纸和被动 feat 不显示。药水、主动魔法物品、可施放卷轴、反应及无动作消耗能力保留。测试带多个活动、CPR 隐藏活动以及剩余次数为零的主动能力，避免漏显或让自动化助手冒充主动能力。
- 验证被动效果仍影响角色卡统计，过滤只是 HUD 视图，不修改或删除项目。低分辨率、浏览器缩放、空物品栏和独立弹窗保持可用。

## v0.1.10 正方形图标与透明占位

- 用透明 PNG、长条武器图和普通方形图核实：背后的大字占位隐藏，底部物品名称仍显示，次数／环阶角标保留。图片失效时可见文字回退。
- 调整栏宽并切换720P～4K有效视口，图标格子宽高保持一致、图片等比显示，悬停和键盘焦点可查看完整名称／说明；编辑按钮、滚动和物品使用继续可达。

## v0.1.11 自动栏宽与 GM 取消选择（历史；总宽规则由 v0.1.12 替代）

- 在物品多／法术少、物品少／法术多、各栏均少三类角色间切换：对应拥挤栏变宽，稀疏角色整体收窄，视口内不足部分仍滚动。增删条目、隐藏条目后重排；不产生用户 flags 写入。
- 搜索、动作筛选和环阶筛选时栏宽保持稳定；列表滚动、九环筛选和焦点不丢失。窄栏编辑按钮和聚焦展开搜索可用；图标正方形、底部名称继续保留。
- 手动拖动进入保存比例模式，Home／双击恢复自动，同时保留隐藏／排序；旧比例不会阻挡新版默认自动，不做迁移写入。
- GM 不分配任何角色，选择 Token 后取消全部选择：HUD 隐藏、原界面恢复、不弹权限提示；再次选择角色可正常显示。

## v0.1.12 同视口保持总宽

- 固定窗口、缩放和侧栏状态，依次选择大量能力、少量能力、没有物品能力的测试角色。HUD 总宽和左右边界应一致，四栏内部仍可根据数量改变份额，空白允许保留。
- 同一角色增加／删除、隐藏能力，或搜索／筛选：总宽不变。改变视口／侧栏才按既有规则改变总宽；图标保持正方形，滚动和手动调整仍可用。

- 自动模式中，某栏分别准备2、3、4个可显示项目，与一个有大量法术的分类并列。3个起至少两个图标同处首行；增加侧栏占用后仍至少两列，正方形及总宽约束保持。


## v0.1.13 总宽内填满完整网格

- 固定窗口、缩放及侧栏，比较3武器／16主动物品／3主动特性／3法术的角色与少量、全空角色：外框左右边界不变，内部按数量分配，数量>=3至少两列。
- 图标保持正方形，各栏最后一列贴近列表右内边缘（除内距和滚动槽），没有不足一列的空条。内容少时允许完整空位；不是强行把单个图标拉大。
- 720P到4K及各档有效缩放视口检查两排可见性、侧栏避让、列表滚动、底部名称／tooltip、搜索与九环筛选焦点；没有数据写入或角色权限变化。
- 如曾手动调整分隔条，双击分隔条或按Home恢复自动；手动模式仍由用户决定比例。


## v0.1.14 NPC 法术可见性

- 在同一NPC上比较原生法术页与HUD：系统隐藏项和displayInSpellbook为false的内部缓存不应出现；原生明确显示的缓存仍应存在。不要删除NPC法术来处理显示问题。
- 进入HUD法术栏编辑、批量操作与环阶筛选，确认内部隐藏项不影响数量、自动栏宽或出现在编辑器。用户手动隐藏的普通法术仍能在编辑器恢复。
- 不同施法来源的同名法术仍保持各自ID和原生使用/次数；不要把名字相同直接当成重复文档。NPC未读取，截图问题的实际来源及本次修复是否覆盖仍需用户人工验收。


## v0.1.15 无底栏与Token状态环（历史；更多菜单已在v0.1.16移除）

- 原最底部“编辑／原版界面／队伍／联动／详细”长条及空行消失；右侧更多菜单保留这些功能，原生返回也可用Token工具栏。分组齿轮不受影响。
- 给测试Token增删中毒、倒地、专注等状态以及临时增益，确认头像环通过原生事件刷新，停用／抑制效果消失；无状态没有图标。
- 同一世界角色的不同Token叠加状态、未链接Token合成Actor和另一角色间切换，图标不得串用。只读悬停／键盘可查全名，坏图有回退；超过10项通过+N查看全部。点击图标不会删改状态。
- 720P到4K和100%/125%/150%/200%有效视口查看状态环、更多菜单、原版返回、分组编辑、取消目标和停止后续操作；HUD宽度仍固定按视口决定，原始720P/4K保留两排，底栏移除后高度约193px/357px。
- 自动实机测试仍关闭，这些步骤由用户人工验收；没有将离线模拟当作服务器状态验证。


## v0.1.16 顶部相邻状态与删除更多菜单

- 同一Token依次保持1、2、3、4、5项状态，图标应从头顶向两侧相邻展开，两个状态不会一个在头顶、一个在脚下。增加状态后之前图标的位置不跳动。
- 更多按钮、更多弹窗及原次要操作全部消失，没有新菜单或底栏；四栏齿轮仍可编辑显示／排序。Token工具栏已有临时切换能力保持。
- 继续检查10项以上的+N只读列表、坏图全名回退、Token切换、有效缩放视口和状态刷新，确认没有更改角色／状态数据。
