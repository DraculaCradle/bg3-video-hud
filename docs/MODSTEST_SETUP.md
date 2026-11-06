# 现有 Foundry V14 实例：ModsTest 自动更新指南

仅使用现有 `https://redmagic.club/`、Foundry Node.js 进程、端口、dataPath 和反向代理。只部署到现有 `Data/modules/bg3-video-hud` 普通目录；不会创建第二个 Foundry 实例，不调用任何 Foundry 服务停启命令，不切换世界，不修改其他模组或其他世界。

本次仅提交代码与自动化测试。你完成以下配置并明确启用之前，不执行线上部署或账号登录。

## GitHub 配置

1. 使用现有 `feat/modstest-actions` 分支上的本次修订。GitHub 查询显示 PR #2 已合并，不能重新打开；后续修改仍在同一开发分支，不直接推送 main。审阅并合并后才使用新的工作流。
2. 创建或保留 Environment **`modstest`**，限制部署分支为 `main`。配置 Environment Secrets，只在 GitHub Secrets 页面填写现有测试账号密码：

   | Secret | 用途 |
   | --- | --- |
   | `FOUNDRY_GM_PASSWORD` | 现有 ModsTest 世界的 Gamemaster；不需要 Setup 管理密码 |
   | `FOUNDRY_PLAYER_PASSWORD` | 可选；现有 Player1 无密码时不创建此 Secret，测试提交空密码 |

3. 在 Environment Variables 配置 `MODSTEST_TOKEN_IDS`：同一活动场景两个链接角色 token 的 ID，以英文逗号分隔，第一个施法者、第二个战士。URL 和准确世界 ID 由服务器上 root 管理的配置提供，不允许 workflow 输入任意部署目录或 service 名称。
4. Repository Settings → Actions → Runners，选择 Linux x64。按页面当前下载地址、校验和与短期注册 token 安装 runner，标签为 **`modstest`**。注册 token 不放入仓库、Secrets 示例、日志或聊天。runner 必须仅执行受信任维护者代码，PR 构建使用 GitHub 托管 runner；若是 public 仓库，配置 runner 访问策略，不能仅把标签当作授权边界。
5. **先保持 repository variable `MODS_TEST_ENABLED` 未设置或为 `false`**。Linux 配置、自测和管理员审阅全部完成后，由你明确将服务器配置 `enabled` 改为 `true`，再设置 repository variable `MODS_TEST_ENABLED=true`。两个开关缺一不可；本任务不替你打开它们。
6. Actions → **Build and update existing ModsTest** → Run workflow，选择 `main`。之后 main 推送自动构建并尝试受守卫保护的更新。构建产物绑定同一次运行及同一提交，部署前验证 SHA-256。工作流不接受任意 ref 或远端 shell 命令。
7. 查看 Step Summary 及 `modstest-live-<SHA>-<attempt>` artifact 的 `deployment.json`、`report.json`。`skipped`、`maintenance-required`、`recovered` 均不等于实机验收通过。

## 现有 Linux 服务器配置

### 1. 保留现有 Foundry，不配置任何新服务或监听端口

管理员确认现有模块目录的准确路径，例如 `/YOUR/EXISTING/DATA_PATH/Data/modules/bg3-video-hud`。示例路径必须替换，不能新建 Foundry dataPath。保持现有 Foundry 账号、Node 参数、端口、反代和世界目录不变。

在你允许的维护窗口中，确保此模组已正常安装到该普通目录，并已被当前进程识别；**仅在现有 ModsTest 世界手工启用**，同时手工确认其他世界未启用。自动化不会为了检查或启用模组而切换世界，也不读取/编辑其他世界的数据库。以后若管理员改变其他世界的启用状态，需要重新审阅该前提。

共享目录无法按世界保存不同版本。为避免意外影响，此模组另有运行时保护：非 ModsTest 标题的世界不注册 HUD 设置、按钮或 API，也不写入布局 flags；部署守卫还核对 ModsTest 的准确 world ID。运行时保护不代替管理员仅在 ModsTest 启用模组的要求。

**首次未安装、进程未识别/未启用模组、版本变化、任何 module.json 字节变化、依赖或系统版本不匹配，均报告 `maintenance-required` 并停止。** 自动化不会尝试重启、重载世界、关闭世界或从 Setup 安装来绕过。维护窗口由你安排；维护后应手工确认当前进程已加载准确清单。清单完全相同的 JS/CSS/文档资源更新才允许自动热更新。

### 2. 创建受限 runner 账号和两个独立状态目录

以管理员身份执行，仅创建 runner/备份相关目录：

```sh
sudo useradd --create-home --home-dir /srv/bg3deploy --shell /bin/bash bg3deploy
sudo install -d -o root -g root -m 0700 /srv/bg3-video-hud-deploy-state
sudo install -d -o bg3deploy -g bg3deploy -m 0700 /srv/bg3deploy/modstest-state
```

账号已存在时复用，不重复创建。`bg3deploy` 不加入 Foundry 服务账号组、sudo 组或 docker 组，不授予现有 Data/modules 父目录或世界数据库的写权限；模组目录继续由现有 Foundry 账号持有。runner 无权任意替换其他模组。

root 私有事务状态目录必须与现有模块目录位于**同一文件系统**，且在 Foundry Data 目录之外；若示例 `/srv` 与现有模块不在同一文件系统，选择满足条件的备份目录并修改配置。检查不满足时自动化会要求维护窗口，不退回多次 rename 的非原子更新。

### 3. 安装只能操作这个模组的文件 helper

从本次已审查的 checkout 安装两个 root 管理文件。它们不是 Foundry 服务，不会启动新的 Node 进程：

```sh
sudo install -d -o root -g root -m 0755 /usr/local/libexec/bg3-video-hud-deploy
sudo install -o root -g root -m 0755 tools/modstest_filesystem.py /usr/local/libexec/bg3-video-hud-deploy/session
sudo install -o root -g root -m 0644 tools/deploy_linux.py /usr/local/libexec/bg3-video-hud-deploy/deploy_linux.py
sudo visudo -f /etc/sudoers.d/bg3-video-hud-deploy
```

sudoers 仅写入以下一条（末尾空参数串限制 helper 不接受命令行参数）：

```sudoers
bg3deploy ALL=(root) NOPASSWD: /usr/local/libexec/bg3-video-hud-deploy/session ""
```

执行 `sudo visudo -cf /etc/sudoers.d/bg3-video-hud-deploy` 校验。**不授予 systemctl、shell、Python、rsync 或任何通用命令权限。** helper 使用隔离 Python 解释器，只接受固定 JSON 操作及经校验的 ZIP 内容；模块目标、备份目录和配置均不从请求中接受路径。不会自动更新自己的 root 权限代码；以后修改 helper 也由管理员审阅安装。

如果以前按旧指南配置过 `bg3-modstest-service` sudoers/helper 或第二实例资源，先人工核查是否实际存在和是否被使用；本工作流不调用它们，也不自动删除或停用任何现有服务。

### 4. 创建 root 管理的现有实例配置，先保持禁用

创建 `/etc/bg3-modstest.json`：

```json
{
  "schema": 2,
  "mode": "existing-instance",
  "enabled": false,
  "url": "https://redmagic.club/",
  "world_id": "REPLACE_WITH_EXACT_EXISTING_WORLD_ID",
  "module_dir": "/YOUR/EXISTING/DATA_PATH/Data/modules/bg3-video-hud",
  "state_dir": "/srv/bg3-video-hud-deploy-state",
  "test_state_dir": "/srv/bg3deploy/modstest-state",
  "other_worlds_disabled_reviewed": false
}
```

```sh
sudo chown root:root /etc/bg3-modstest.json
sudo chmod 0644 /etc/bg3-modstest.json
```

准确 world ID 可以在已进入 ModsTest 的 GM 浏览器控制台读取 `game.world.id`，标题必须是 ModsTest。token ID 可以从 `canvas.tokens.placeables.map(t => ({id: t.id, name: t.name}))` 中选择。不要把密码写入此配置。

人工确认只有 ModsTest 启用此模组后，才将 `other_worlds_disabled_reviewed` 改为 true。此记录是明确的管理员前提确认，不宣称通过活跃世界的 API 验证了所有离线世界；自动化不能为审计而擅自启动其他世界。旧 schema / 独立实例配置会被拒绝，不能只删除旧检查就运行。

### 5. 准备测试账号、角色和 runner

- 复用现有 Gamemaster（世界 GM）和 Player1（普通玩家），密码通过上述两个 Secrets 提供；不生成或索要新密码；Player1 无密码时允许空值，Gamemaster 仍必须有 Secret。
- 在 ModsTest 的同一活动场景放置两个**链接到角色**的测试 token，对应不同的专用测试角色，均给 Player1 OWNER。施法者要有数值 HP、正的最大 HP、一级法术槽、至少一个戏法和一个一级法术；另一个角色至少有两件物品。不要指定正式玩家角色。
- 安装 Node 24、Python 3.9+、git、curl 和 Playwright Chromium 所需 OS 库。OS 库由管理员预装，工作流只以普通账号下载浏览器。
- 在 `/srv/bg3deploy/actions-runner`，以 `bg3deploy` 执行 GitHub Runners 页面提供的注册步骤，额外标签 `modstest`。可按官方步骤将 **GitHub runner 本身**注册为服务，进程用户仍为 bg3deploy；这不是新的 Foundry 服务。
- 确保 runner Online/Idle；能读取 root 配置、写自己的工作目录和私有 fixture 快照目录，不能直接写 Data/modules 父目录、其他模组或世界数据库。
- 你选择当前活动世界为 ModsTest、测试时段无其他用户在线并确认配置无误后，再显式开启两个部署开关。自动化不会替你切换。

## 自动检查、更新与恢复行为

1. 登录前检查现有 `/join` 页的 ModsTest 标题；不是则 `skipped`，不提交测试账号密码。
2. 登录现有 Gamemaster，核对准确世界 ID、账号身份、Foundry 14、D&D5e 6.0.6、两个 BG3 依赖及本模组启用状态。发现 Gamemaster/Player1 之外的活动账号，立即 `blocked`，不启动文件 helper。
3. 保持一个 GM socket 会话用于持续守卫。正式用户加入、世界导航或连接断开会锁存不安全状态；每次准备、交换、提交、回滚和恢复前还会重新检查。
4. 文件 helper 持有事务锁，验证 ZIP、清单/版本、完整本地 JS import 图、目录边界、链接、磁盘空间和同文件系统。旧版 ZIP 校验通过后，将新版本完整写入私有 staging，fsync 日志，用 Linux `renameat2(RENAME_EXCHANGE)` 一次交换 **现有普通模组目录**和候选目录。其他模块、世界数据库、service 和配置文件均不操作。
5. 校验服务器实际返回的 JS/CSS SHA-256。测试客户端绕过自身与反代旧缓存，不修改反代配置，也不重载世界。使用现有 GM 会话认证创建测试页面，Player1 独立登录，避免重复执行 GM 登录。
6. 验证角色切换、HP/AC、真实 socket 的 HP/法术槽显示更新、戏法过滤、快捷栏显示/隐藏/排序/刷新持久化以及原 HUD 恢复。所有测试角色字段和两用户的本模组布局在修改前保存私有快照，finally 恢复并验证；快照限制为指定两个角色及两账号。
7. 通过后提交；失败且守卫仍安全时交换回旧目录，验证旧资源、恢复 fixture 后才清除 journal。若期间有人加入或世界切换，**不继续写入、不切回世界、不重启、不强行回滚**，报告 `recovery-required` 并保留版本、备份与快照。

会话检查无法与用户登录形成服务器端原子锁；管理员应安排无人使用的测试时段。持续守卫可检测变化并停止，但不能在不修改现有服务器的条件下阻止别人登录，也不能撤销已加载到另一个浏览器内存的 JS。回滚恢复磁盘及后续新测试页面，不宣称热替换已打开页面的代码。

恢复仍要通过同样的世界/会话守卫。让现有实例处于 ModsTest 且仅测试账号在线后，在 runner checkout 根目录、具备既有 Secrets 的安全环境中执行：

```sh
python3 tools/deploy_modstest.py --recover-only
```

下一次工作流发现 pending journal 时也只恢复旧事务，报告 `recovered`，不会同时发布新版本；再次运行才会更新。无法登录、旧备份损坏、未知外部文件改动或 fixture 恢复失败时保留证据，报告需要人工维护，不猜测状态或覆盖未知文件。不要手工删除私有快照、pending.json 并声称恢复完成。备份不会自动清理。

## 报告状态

| 状态 | 含义 |
| --- | --- |
| passed | 完成目录更新、实机断言和测试数据恢复 |
| skipped | 当前世界不是 ModsTest，或管理员未启用；未部署 |
| blocked | 非测试会话、连接或身份不安全；停止 |
| maintenance-required | 首次安装、清单/版本/依赖/注册变化或不支持原子交换；未自动重启 |
| rolled-back | 失败后恢复旧目录和 fixture；本次验收失败 |
| recovery-required | 无法安全完成即时恢复；保留 journal、备份和私有快照 |
| recovered | 完成旧事务恢复；没有发布新版本 |

只上传脱敏报告，默认禁止 trace、截图、视频、完整错误附件、Cookie、密码和认证状态文件。法术槽同步由测试 GM 临时编辑资源验证，不冒充通过真实施法证明的官方扣槽；pact、专注、模板、休息和聊天卡仍按 MANUAL_TESTS.md 验收。

## 已安装后的“只测试”入口

使用 **ModsTest live tests only** (`modstest-test.yml`) 的 Run workflow，选择 main。此入口不执行打包部署、不调用 sudo/helper、不修改模组文件、不切换世界或重启，也不要求开启 MODS_TEST_ENABLED 或服务器 enabled。测试会临时修改指定 fixture 的 HP/法术槽和本模组布局，并恢复原值。

需要 modstest runner Online、Gamemaster Secret、准确 world ID 和两个 token ID。world ID 优先使用手动输入或 Environment Variable `FOUNDRY_WORLD_ID`，也可读取现有 root 配置；token ID 使用输入或 `MODSTEST_TOKEN_IDS`。状态默认保存于 `/srv/bg3deploy/modstest-state`，也可读取 root 配置的 `test_state_dir`。Player1 没有密码时无需创建 Secret。

Environment 目前仅允许 main；先审阅合并 PR #3 才能从 main 运行新入口，保持自动部署开关关闭。若 runner 尚未上线，任务只会排队；若缺少 metadata 或 GM Secret，会明确停止。不要将“已排队”或“配置失败”描述为实机通过。

## 没有测试角色 / token 时

用户授权后，可在手动的 **ModsTest live tests only** 中勾选 `create_fixtures`。默认 false；部署流程强制保持 false，不能通过自动部署创建世界文档。

这个模式不需要预先填写 token ID：登录和世界/会话守卫通过后，从已安装 D&D5e 系统的 SRD Actor 合集导入两个临时角色，必要时从同系统的法术合集补入戏法和一级法术。给予 Player1 所有权，并在活动场景创建链接 token；若没有活动场景，只创建并使用带专属标记的临时测试场景。不会安装新规则书、修改 compendium 或复用/覆盖现有正式角色。

对临时施法者初始化的一级槽属于 fixture 设置，不代表通过真实施法验证消耗。角色、token 和临时场景均有本次唯一标记，创建前先持久化私有意向日志；测试后恢复快照、删除本次文档并验证。中断、外来 token 引用、身份/世界变化或不明缺失会保留日志并停止，不递归删除或猜测所有权。下次运行先恢复上次临时数据，再创建新一组。

登录表单如果显示 GM 已活动/不可选，会报告 `test-account-already-active`；不会踢掉已有会话。完成测试会调用原生退出方法释放本任务自己的 GM / Player1 会话，并关闭自己的浏览器上下文。之前因 metadata 缺失而停在准备阶段的任务未启动浏览器，不应被解释为该任务占用了 GM。

V14 登录使用 `#join-game-form` 内大小写敏感的 `userId` 字段和提交按钮；测试不会点击相邻的返回 Setup 表单。`v14-login-form-unavailable` 表示尚未输入凭据；`test-login-or-world-initialization-failed` 表示已提交登录但认证或世界初始化未完成，不能据此判定密码错误。报告不保留密码、页面内容或原始错误。两种情况都未进入角色创建阶段。

表单渲染后还会在输入凭据前读取公开世界 ID，登录后再次核对。标题为 ModsTest 但配置 ID 不符时，报告 `modstest-world-id-mismatch:<准确ID>` 并停止；不会自动接受这个 ID。管理员核实后可修正 Environment 的 `FOUNDRY_WORLD_ID` 或使用只测试工作流的 `world_id` 输入。标题变化仍报告 `active-world-not-modstest`，不会输出其他世界内容或切换世界。

2026-11-05 实机只读检查确认现有世界标题为 `ModsTest`、ID 为 `modstest`，配置 `FOUNDRY_WORLD_ID` 时使用后者。原生退出会发起异步跳转；测试等待 `/join` 请求完成后关闭自己的全部页面与连接，再从全新匿名上下文确认账号恢复可选，最后关闭匿名探测页。旧认证 Cookie 的 join 页面可能保持账号活动，不能在关闭该连接之前把其选项当作释放证明。未确认释放时报告 `test-session-release-unconfirmed`，不冒充退出成功，也不强制清除其他会话。

浏览器预检还必须通过 WebGL2 canvas 创建，失败时在任何登录或部署之前停止。脱敏报告中的 `guardReason` 保留主失败原因，`cleanupReason` 单独记录退出失败阶段（`native-navigation`、`join-form` 或 `account-availability`）；退出异常不会覆盖更早的版本/世界/认证错误。若退出未确认，先检查已有 GM 页面，不反复提交登录或重启服务。

版本守卫失败还会报告 Foundry／D&D5e 及两个依赖的数字版本、依赖启用布尔值。只记录固定模组 ID 和经过校验的版本，不输出其他设置或世界文档；校验仍然要求 Foundry 14、D&D5e 6.0.6 和已启用的兼容依赖。

若所有人工页面已关闭但 GM 仍显示在线，可在只测试工作流勾选 `diagnostics_only`。这只清点受限 runner 账号名下的 Chromium 进程，输出 PID、父 PID、运行时长及是否具有 Playwright 浏览器标记；不启动浏览器、不请求 Foundry、不使用测试密码、不终止任何进程，也不要求角色或 token 配置。原始命令参数不输出。结果保存在 `runner-browser-inventory.json`，它属于进程诊断，不是 HUD 实机验收通过证明。普通测试也会在启动浏览器前记录同样清单。

名称检查必须包括固定 Playwright 1.56.1 实际使用的 `headless_shell`，以及 Chromium／Chrome 名称；只检查 chrome 字样会漏掉该版本的无界面浏览器，不能用这种空清单排除遗留进程。

## 实机超时后的只恢复入口

在 **ModsTest live tests only** 中选择 main、`world_id=modstest`、勾选 `recover_only`，不要勾选 `diagnostics_only`。`recover_only` 优先于角色创建开关：仅登录 GM，通过同样的世界、账号、版本及会话守卫，恢复已有私有快照、清理带原意向日志唯一标记的临时文档，并确认恢复日志已清除；不创建新角色、不登录 Player1、不执行 HUD 验收，也不触及模组文件或服务。

恢复临时规则书角色不需要预先提供 token ID；恢复既有未标记测试角色的 HP／法术槽快照仍必须提供原来的两个 token ID，缺失时停止并保留快照。恢复失败会保留日志；不得手工删 journal 来宣称成功。报告的 `mode=recovery-only` 和对应测试标题明确区分只恢复成功与 HUD 验收通过。自动文件部署强制使用正常验收模式，不能用只恢复结果替代部署后的测试。
