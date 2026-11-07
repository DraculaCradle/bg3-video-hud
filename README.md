# BG3 Video HUD

独立实现的 Foundry VTT V14／D&D5e 玩家操作界面，参考用户提供的视频与半成品交互。无需安装 BG3 HUD Core 或 BG3 HUD D&D5e；已安装时保留共存与返回能力。

> **v0.1.6：修复地图目标点击穿透。** 单击武器目标不再被画布原生选择事件抢先处理；补充 Player 角色权限提示与只读状态查询。Player 不显示 HUD 的具体现场原因仍待用户提供状态，未声称实机通过。保留原作者布局、自适应与独立弹窗，无需 BG3 模组。自动部署与自动实机测试关闭，由用户人工验收。

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
- No required HUD modules. BG3 Inspired HUD is optional; existing settings and data are preserved.

## Upstream references

- https://github.com/BragginRites/bg3-hud-core
- https://github.com/BragginRites/bg3-hud-dnd5e

**Source and rights:** A prototype supplied privately by the user is now available for behavior/interface reference, including isolated read-only rendering with synthetic data. It targets Foundry V13 / D&D5e 5.1 and contains no redistribution license. Continue the independent V14 implementation; establish permission before copying or redistributing its source/styles. The privately shared videos/screenshots must not be committed to this public repository.

## Start here

Read [AGENTS.md](./AGENTS.md) and [the MVP development brief](./docs/CODEX_TASK.md). The module is implemented in `scripts/` and `styles/`, with no runtime npm dependencies or compilation step.

## Install in a backed-up test world

1. Use the existing Foundry v14 instance with D&D5e **6.0.6**. Current source needs no other HUD module; no upstream code is bundled. Do not change other worlds or enable/disable optional modules automatically.
2. Run `npm run package` from this checkout (Node >=22.8 and Python 3 required). Extract `dist/bg3-video-hud.zip` into `<Foundry User Data>/Data/modules/bg3-video-hud/`, with `module.json` directly inside that directory. Alternatively copy `module.json`, `scripts/`, and `styles/` into that directory.
3. 在需要使用的世界中，先通过“管理模组”启用 **BG3 视频界面**，再到“配置设定 → BG3 视频界面”勾选“启用 BG3 视频界面”。此开关默认关闭，仅影响当前客户端。 If package discovery or manifest changes need a reload/restart, the administrator schedules a maintenance window; this project never controls the service automatically.
4. Each player opts in using **Game Settings → Configure Settings → BG3 视频界面 → 启用 BG3 视频界面**, or the **切换 BG3 视频界面** token scene tool. It is off by default. A keybinding can be assigned in Foundry's controls configuration.
5. Select an owned token; with no controlled token, the assigned owned character is used. Selecting only unowned tokens hides this HUD. During canvas teardown the original HUD is restored.

Use the stable [module.json installation/update address](https://github.com/DraculaCradle/bg3-video-hud/releases/latest/download/module.json) for v0.1.6. It includes the reference-layout revision and weapon targeting fix, standalone operation and scrollable choice dialogs. Tagged releases provide ZIP, manifest, installer and checksums; publishing does not update the running server. Full live HUD acceptance remains incomplete; automatic live testing is stopped at the user's request.

For Linux server installation or upgrades, use the [deployment guide](docs/DEPLOYMENT.md) and `tools/deploy_linux.py`. It accepts the real user data directory, checks permissions/dependencies, verifies a backup before replacement, and rolls back caught failures. Release assets also include the standalone script and SHA-256 checksums. No server path is assumed, and server deployment / ModsTest validation have not yet been performed.

## Use

中文化与本轮功能由 v0.1.2 发布。模组自身控件、设置、提示与可访问名称现使用中文。角色、物品名及系统弹窗采用 Foundry／D&D5e 提供的内容，不自动修改世界语言或重命名数据。地图目标选择已按用户确认的单体点选／多目标范围选择实现，尚待 Foundry 实机验收；详见[中文界面与视频提供说明](docs/CHINESE_UI.md)。

- 底栏按实际 CSS 视口自动调整，720P～4K 有界增大；头像、三栏和右侧操作组独立，按真实侧栏宽度避让。默认三栏 2:3:5，可拖动／方向键调整；双击／Home 恢复。名称和环阶显示在图标上，完整说明通过悬停／焦点查看；每栏独立滚动。各档实测与原创预览见 [自适应说明](docs/COMPACT_HUD.md)。
- 普通单一活动和无来源选择的戏法点击后直接进入目标／原生流程；单一活动的等级法术直接显示环阶和来源；多活动物品仍明确选择。底栏 **详细** 可打开完整活动、重复次数、手动分配和原生模式选项；需要选择的活动、环阶／来源和手动分配都在独立弹窗中；Esc、关闭按钮和取消均可退出，系统流程开始前会关闭自有弹窗。单体点选／多目标框选保持原设计，实际配置、掷骰及消费仍由系统处理。See [targeting and cancellation boundaries](docs/TARGETING.md).
- **装备 / 特性 / 法术** show owned embedded items. Level tabs include cantrips (0). Regular and pact slots are separate read-only pools, including zero remaining slots. Innate/unprepared spells are not silently removed: the system remains responsible for eligibility and consumption.
- **动作 / 附赠动作 / 反应** filter activities and show locally observed native uses in the current combat turn position. They are not authoritative remaining-action limits and never enforce combat rules.
- Search each category; hover or focus an item for a safe rich description. **编辑** opens the full draft; category gears open a separate scrollable editor dialog: show/hide, pin, drag/arrow order, bulk select/clear/reset, then Save or Cancel. Short/long rests still call official dialogs.
- Settings are stored on the current **User**, under `flags.bg3-video-hud.layouts`, keyed by full actor UUID. Players can configure their own layout without permission to modify another user's document. Synthetic token actors have separate identities. Same-client edits are serialized; simultaneous sessions for the same user use last-write-wins semantics.
- **原版界面** 关闭本 HUD，恢复 Foundry 原生快捷栏及可选 BG3 HUD 原有的显示状态。仅在本 HUD 已挂载时临时隐藏它们的 DOM 外壳；不修改快捷栏内容、BG3 设置、用户 flags 或源码，也不会主动启用其他模组。
- Optional macro: `await game.modules.get("bg3-video-hud").api.toggle()`.

新增来源管理、目标预览、可选重复分配、队伍概览与骰子／动画联动状态的中文操作与边界，见[视频功能补齐](docs/COMPLETE_HUD.md)及[视频对照](docs/VIDEO_COMPARISON.md)。这些代码已纳入 v0.1.2 发布；发布不会自动安装到线上。

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

For the existing shared Foundry instance at redmagic.club, see [ModsTest deployment and runner setup](docs/MODSTEST_SETUP.md). Automation verifies the active world and test-only sessions before updating only `Data/modules/bg3-video-hud`, keeps verified backups and recovery journals, and never stops/restarts Foundry or switches worlds. First installation or any manifest/version change requires an administrator's maintenance window. The HUD may be manually enabled in any world; automated deployment and live test scripts remain strictly restricted to ModsTest. [The test report](docs/AUTOMATION_REPORT.md) distinguishes local validation from live checks that have not run.

Test only in a backed-up test world first. Spell/item consumption, ownership permissions, PC token switches and chat cards must be verified before real sessions.
