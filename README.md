# BG3 Video HUD

独立实现的 Foundry VTT V14／D&D5e 玩家操作界面，参考用户提供的视频与半成品交互。开发版无需安装 BG3 HUD Core 或 BG3 HUD D&D5e；已安装时保留共存与返回能力。

> **开发版变更尚未发布。** 当前公开 Release v0.1.2 仍声明 BG3 依赖。下面的独立运行与快捷交互适用于当前源码；本轮不发布、不部署、不登录服务器，实机验收由用户手动进行。[原作者半成品对照与改动](docs/PROTOTYPE_COMPARISON.md)。

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

**Source and rights:** A prototype supplied privately by the user is now available for static behavior/interface reference. It targets Foundry V13 / D&D5e 5.1 and contains no redistribution license. Continue the independent V14 implementation; establish permission before copying or redistributing its source/styles. The privately shared videos/screenshots must not be committed to this public repository.

## Start here

Read [AGENTS.md](./AGENTS.md) and [the MVP development brief](./docs/CODEX_TASK.md). The module is implemented in `scripts/` and `styles/`, with no runtime npm dependencies or compilation step.

## Install in a backed-up test world

1. Use the existing Foundry v14 instance with D&D5e **6.0.6**. Current source needs no other HUD module; no upstream code is bundled. Do not change other worlds or enable/disable optional modules automatically.
2. Run `npm run package` from this checkout (Node >=22.8 and Python 3 required). Extract `dist/bg3-video-hud.zip` into `<Foundry User Data>/Data/modules/bg3-video-hud/`, with `module.json` directly inside that directory. Alternatively copy `module.json`, `scripts/`, and `styles/` into that directory.
3. Enable only **BG3 视频界面** in the existing ModsTest world. If package discovery or manifest changes need a reload/restart, the administrator schedules a maintenance window; this project never controls the service automatically.
4. Each player opts in using **Game Settings → Configure Settings → BG3 视频界面 → 启用 BG3 视频界面**, or the **切换 BG3 视频界面** token scene tool. It is off by default. A keybinding can be assigned in Foundry's controls configuration.
5. Select an owned token; with no controlled token, the assigned owned character is used. Selecting only unowned tokens hides this HUD. During canvas teardown the original HUD is restored.

The stable [module.json installation/update address](https://github.com/DraculaCradle/bg3-video-hud/releases/latest/download/module.json) still serves **v0.1.2**, which requires the two BG3 modules. The standalone changes here require a future release or an explicitly installed development build. Tagged releases provide the ZIP, manifest, standalone installer and checksums; branch pushes and PRs do not publish or install updates. Full live HUD acceptance remains incomplete; automatic live testing is stopped at the user's request.

For Linux server installation or upgrades, use the [deployment guide](docs/DEPLOYMENT.md) and `tools/deploy_linux.py`. It accepts the real user data directory, checks permissions/dependencies, verifies a backup before replacement, and rolls back caught failures. Release assets also include the standalone script and SHA-256 checksums. No server path is assumed, and server deployment / ModsTest validation have not yet been performed.

## Use

中文化与本轮功能由 v0.1.2 发布。模组自身控件、设置、提示与可访问名称现使用中文。角色、物品名及系统弹窗采用 Foundry／D&D5e 提供的内容，不自动修改世界语言或重命名数据。地图目标选择已按用户确认的单体点选／多目标范围选择实现，尚待 Foundry 实机验收；详见[中文界面与视频提供说明](docs/CHINESE_UI.md)。

- The bottom dock automatically scales its width, height, icons, text and spacing with the available CSS viewport: about 188px high at 720P, 230px at 1080P, 273px at 1440P and 348px at 4K, with upper/lower bounds. Zoomed or short viewports keep a compact side layout. Each group scrolls independently; names/details remain available in tooltips and accessible names. Spell levels, slots and activation filters share the top strip. **编辑** reveals names and editing controls within the same height. See the [adaptive layout guide and five-resolution previews](docs/COMPACT_HUD.md).
- 普通单一活动和无来源选择的戏法点击后直接进入目标／原生流程；单一活动的等级法术直接显示环阶和来源；多活动物品仍明确选择。底栏 **详细** 可打开完整活动、重复次数、手动分配和原生模式选项；栏内选择支持 Esc，系统弹窗保留自己的 Esc 行为。单体点选／多目标框选保持原设计，实际配置、掷骰及消费仍由系统处理。See [targeting and cancellation boundaries](docs/TARGETING.md).
- **装备 / 特性 / 法术** show owned embedded items. Level tabs include cantrips (0). Regular and pact slots are separate read-only pools, including zero remaining slots. Innate/unprepared spells are not silently removed: the system remains responsible for eligibility and consumption.
- **动作 / 附赠动作 / 反应** filter activities and show locally observed native uses in the current combat turn position. They are not authoritative remaining-action limits and never enforce combat rules.
- Search each category; hover or focus an item for a safe rich description. **编辑** or category gears open a staged layout draft: show/hide, pin, drag/arrow order, bulk select/clear/reset, then Save or Cancel. Short/long rests still call official dialogs.
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

For the existing shared Foundry instance at redmagic.club, see [ModsTest deployment and runner setup](docs/MODSTEST_SETUP.md). Automation verifies the active world and test-only sessions before updating only `Data/modules/bg3-video-hud`, keeps verified backups and recovery journals, and never stops/restarts Foundry or switches worlds. First installation or any manifest/version change requires an administrator's maintenance window. The module is inert outside a world titled ModsTest. [The test report](docs/AUTOMATION_REPORT.md) distinguishes local validation from live checks that have not run.

Test only in a backed-up test world first. Spell/item consumption, ownership permissions, PC token switches and chat cards must be verified before real sessions.
