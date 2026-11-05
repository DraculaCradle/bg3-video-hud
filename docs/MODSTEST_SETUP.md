# ModsTest 自动部署与实机测试配置

工作流：`.github/workflows/modstest.yml`。只在 `main` 推送或从 `main` 手动运行时部署；代码提交前的 PR 只在 GitHub 托管 runner 上测试。当前尚未安装自托管 runner、创建 Environment 或 Secrets，因此本次未远程部署、未使用真实账号登录。

## 方案与权限边界

`build` 在 GitHub 的 Ubuntu runner 执行静态检查、Node 测试、Chromium fixture 测试、两组部署故障注入测试和打包。构建产物以提交 SHA 命名；后续部署下载同一次运行的产物并验证 SHA-256。

`deploy-and-test` 使用 Environment `modstest` 和标签 `[self-hosted, linux, x64, modstest]`，运行在测试服务器本机。它不需要 Codex 访问服务器，不使用 SSH、服务器密码、SSH 私钥或 Foundry Setup 管理密码。GitHub 自动提供的 `GITHUB_TOKEN` 仅有 `contents: read`，checkout 不保存该凭据。

必须使用 **ModsTest 独立 Foundry 实例与独立 dataPath**。仅在共享实例中选择 ModsTest 不构成隔离：`Data/modules` 是该实例全部世界共享的。本方案不允许对生产实例共享的 `Data/modules` 部署。如果当前 `https://redmagic.club/` 仍指向共享实例，请先将测试入口路由到独立实例；必要时使用独立子路径并相应修改 `FOUNDRY_URL`。

部署账号 `bg3deploy` 仅可写 `/srv/bg3-modstest-deploy` 和 runner 工作目录；不得加入生产账号组、`sudo` 组或 `docker` 组，不授予世界数据库目录读写权限。Foundry 以另一个账号 `foundry-modstest` 运行，只读部署的模组代码。唯一 sudo 权限是固定 helper 对固定测试 systemd unit 执行 start/stop/check。helper、sudoers、unit 和 `/etc/bg3-modstest.json` 均由 root 管理，工作流不会安装或更改它们。

```
/srv/foundry-modstest/                 # 独立 Foundry dataPath；运行账号私有
  Data/modules/bg3-video-hud -> /srv/bg3-modstest-deploy/current
/srv/bg3-modstest-deploy/              # bg3deploy 可写，Foundry 可遍历
  current -> releases/<ZIP SHA-256>    # 同目录 os.replace 原子切换
  releases/<SHA-256>/                 # 模组版本完整副本
  backups/<SHA-256>.zip               # 校验过的原始 ZIP；0700 目录
  pending.json                       # 中断恢复日志
  test-state/hud-snapshot.json        # 私有测试恢复快照；不上传
```

部署时先核验旧安装与原始 ZIP 备份一致，再完整写入新版本；保存并 fsync 恢复日志之后停止测试实例、原子更新指针并启动测试实例。Playwright 全部通过才提交事务。启动、健康检查或测试失败会停机、恢复旧指针并重启；任何回滚失败保留恢复日志及全部版本。不会自动清理备份或写入其他世界。

## GitHub 上的配置操作

1. 合并本次 PR 到 `main`。首次保持自动部署关闭；构建照常执行，部署 job 会跳过。
2. Repository → Settings → Environments → New environment，创建 **`modstest`**。限制该 Environment 的部署分支为 `main`。需要时可使用 required reviewers；本工作流本身不要求每次人工审批。
3. 在该 Environment 下添加以下 **Secrets**，用密码管理器设置已有的专用账号密码；不要把值写入 YAML、`.env`、命令行参数、PR 或聊天：

   | Secret 名称 | 用途 |
   | --- | --- |
   | `FOUNDRY_GM_PASSWORD` | 独立 ModsTest 世界中 `Gamemaster` 的密码；仅世界 GM，无 Setup/操作系统权限 |
   | `FOUNDRY_PLAYER_PASSWORD` | 独立 ModsTest 世界中普通玩家 `Player1` 的密码 |

4. 在该 Environment 下添加以下 **Variables**：

   | Variable 名称 | 值 |
   | --- | --- |
   | `FOUNDRY_URL` | 默认 `https://redmagic.club/`；必须实际路由至独立 ModsTest 实例，包含需要的子路径 |
   | `FOUNDRY_WORLD_ID` | 实际 `game.world.id`；不能把世界标题当作 ID 猜测 |
   | `MODSTEST_TOKEN_IDS` | 活动场景两个测试 token 的 ID，英文逗号分隔；第一个施法者、第二个战士 |

5. Repository → Settings → Actions → Runners → New self-hosted runner，选择 Linux x64。按页面生成的当前下载地址、校验和、注册命令安装；添加标签 **`modstest`**，见下一节。注册 token 是短期安装凭据，不需要建立仓库 Secret，不保存到仓库。
6. Linux 配置完成并手工验证已知良好版本后，在 **Repository Actions Variables** 中设 `MODS_TEST_ENABLED=true`。此开关必须是 repository variable，因为它在 job 选择 Environment 之前判断。其他变量和两个密码均放在 Environment 内。
7. Actions → **Build and deploy ModsTest** → Run workflow，选择 `main`。之后 `main` 推送自动构建、部署和测试。检查 build、deploy-and-test 及 `modstest-live-<SHA>-<attempt>` 产物中的 `report.json`；部署跳过或没有报告不算实机通过。

工作流未配置 `pull_request_target`、任意 ref 输入或远端 shell 命令。若仓库是 public，GitHub 的 runner 分组与访问策略应只允许这个受信任部署工作流使用该 runner；不要让 PR 工作流选择它。对 `.github/workflows/`、`tools/`、`e2e/` 的变更先进行代码审查。

runner 标签是调度标识，不是授权边界。若当前 GitHub 套餐不支持按 workflow 限制 runner 组，不要直接把持久化服务器 runner 开放给 public 仓库的所有工作流；可将部署工作流和 runner 放入仅维护者可写的 private 部署仓库，再使用经过校验的本项目构建产物。该替代配置需相应调整 artifact 下载来源，不能直接用本工作流跨仓库下载。默认方案应在 runner 访问策略就绪后再打开开关。

## Linux 服务器上的配置操作

以下以 Ubuntu 24.04 x64、systemd、Node 24 和 Python 3.9+ 为例。由管理员执行系统配置；不要在现有生产 service 或世界目录上替换路径。

### 1. 准备独立 Foundry 实例

创建专用账号，并准备独立 dataPath：

```sh
sudo useradd --system --home-dir /srv/foundry-modstest --shell /usr/sbin/nologin foundry-modstest
sudo useradd --create-home --home-dir /srv/bg3deploy --shell /bin/bash bg3deploy
sudo install -d -o foundry-modstest -g foundry-modstest -m 0700 /srv/foundry-modstest
sudo install -d -o bg3deploy -g bg3deploy -m 0755 /srv/bg3-modstest-deploy
sudo install -d -o bg3deploy -g bg3deploy -m 0755 /srv/bg3-modstest-deploy/releases
sudo install -d -o bg3deploy -g bg3deploy -m 0700 /srv/bg3-modstest-deploy/backups /srv/bg3-modstest-deploy/test-state
```

在该独立实例安装 Foundry **V14**、D&D5e **6.0.6**、`bg3-hud-core >=0.8.0`、`bg3-hud-dnd5e >=0.8.0`；只配置测试世界，标题必须是 **ModsTest**。以此实例的实际路径和世界 ID 建立 `/etc/systemd/system/foundry-modstest.service`：

```ini
[Unit]
Description=Dedicated Foundry ModsTest
After=network.target

[Service]
User=foundry-modstest
Group=foundry-modstest
WorkingDirectory=/srv/foundry-modstest
# 将 /ABSOLUTE/PATH/TO/FOUNDRY_ENTRYPOINT 和 EXACT_WORLD_ID 替换为真实值。
ExecStart=/usr/bin/node /ABSOLUTE/PATH/TO/FOUNDRY_ENTRYPOINT --dataPath=/srv/foundry-modstest --world=EXACT_WORLD_ID --port=30001
Restart=on-failure
TimeoutStopSec=60
KillMode=control-group
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/srv/foundry-modstest

[Install]
WantedBy=multi-user.target
```

按照实际安装包定位 Foundry 入口文件，确认 Node 路径；不要照抄占位路径。配置反向代理将测试 URL（默认 `https://redmagic.club/`）和 WebSocket 转发至该实例，保留 HTTPS 验证；子路径须与 Foundry routePrefix 一致。先手工确认测试 URL 的 `/join` 页面显示 ModsTest，且服务只使用此 dataPath。

### 2. 安装固定服务 helper 与配置

从已审查的本仓库 checkout 中执行：

```sh
sudo install -o root -g root -m 0755 tools/bg3-modstest-service /usr/local/sbin/bg3-modstest-service
sudo tee /etc/bg3-modstest.json >/dev/null <<'JSON'
{
  "world": "ModsTest",
  "dedicated_instance": true,
  "deploy_root": "/srv/bg3-modstest-deploy"
}
JSON
sudo chown root:root /etc/bg3-modstest.json
sudo chmod 0644 /etc/bg3-modstest.json
sudo visudo -f /etc/sudoers.d/bg3-modstest
```

在 sudoers 文件写入以下三条精确授权，保存后用 `sudo visudo -cf /etc/sudoers.d/bg3-modstest` 校验：

```sudoers
bg3deploy ALL=(root) NOPASSWD: /usr/local/sbin/bg3-modstest-service start
bg3deploy ALL=(root) NOPASSWD: /usr/local/sbin/bg3-modstest-service stop
bg3deploy ALL=(root) NOPASSWD: /usr/local/sbin/bg3-modstest-service check
```

不得授予通用 `systemctl`、shell、Python、rsync、chown、docker 或任意 service 名称的 sudo 权限。

helper 的 `check` 除检查 systemd active，还在 30 次有限等待内检查固定 `http://127.0.0.1:30001/join` 返回 ModsTest 页面。如果实例使用 routePrefix，管理员需在安装 helper 前将这个固定探测路径改为相应本地路径。恢复旧版本后也使用该探测，失败会保留 journal。

### 3. 建立经过验证的初始版本与固定链接

以 `bg3deploy` 在该账号工作目录 clone 已审查代码。使用已手工验证的 ZIP 及从受信任构建取得的 SHA-256 作为初始回滚版本：

```sh
sudo -u bg3deploy python3 tools/seed_modstest.py --zip /ABSOLUTE/PATH/known-good.zip --sha256 TRUSTED_64_HEX_SHA256
sudo systemctl stop foundry-modstest.service
```

确保 `bg3deploy` 可读取指定 ZIP 和仓库脚本。seed 不启动/停止服务，不写 Foundry dataPath，只允许尚未初始化的部署根；不会覆盖现有 `current`。如果已存在此模组的普通目录，管理员先将它备份到测试 dataPath 之外，保留完整副本；自动脚本不会移动它。确认 `Data/modules/bg3-video-hud` 不存在后，由管理员创建一次固定链接：

```sh
sudo ln -s /srv/bg3-modstest-deploy/current /srv/foundry-modstest/Data/modules/bg3-video-hud
sudo systemctl daemon-reload
sudo systemctl enable --now foundry-modstest.service
```

在 ModsTest 的 Manage Modules 中启用此模组及两个依赖。使用普通浏览器手工验证这个初始版本能加载和工作，再启用自动部署。需要其他基线时必须先手工验证，不能把未经验证的初始包称为“已知良好备份”。

### 4. 准备账号与 fixture

- 世界中建立专用 **Gamemaster**（GM）和 **Player1**（普通玩家），分别使用不同的非空密码。它们都不是 Foundry Setup 管理账号。
- 当前活动场景中放置两个**链接到角色**的 token，分配给 Player1 OWNER 权限；两个 token 对应不同角色。第一个施法者应有一级法术槽、至少一个戏法和一个一级法术；第二个角色应有至少两件物品。不要使用正式玩家角色。
- 玩家应能进入相同活动场景并控制两个 token；测试运行期间不允许其他用户在线或人工同时操作这两个账号。原始 BG3 HUD 应能显示。
- GM 浏览器控制台读取 `game.world.id` 和 `canvas.tokens.placeables.map(t => ({id: t.id, name: t.name}))`，将正确 world ID 和两个 token ID 配置到 GitHub Variables；无需输出角色数据或密码。

### 5. 安装专用 self-hosted runner

在 `/srv/bg3deploy/actions-runner` 目录，以 `bg3deploy` 执行 GitHub 设置页面提供的下载、SHA 校验和 `./config.sh` 注册步骤；URL 为 `https://github.com/DraculaCradle/bg3-video-hud`，额外标签 `modstest`。不要以 root 运行 runner 进程。注册完成后管理员在该目录执行：

```sh
sudo ./svc.sh install bg3deploy
sudo ./svc.sh start
```

通过 GitHub UI 验证 runner Online/Idle，标签包含 self-hosted/linux/x64/modstest。安装 Node 24、Python 3、git、curl、unzip，以及 Playwright Chromium 所需操作系统库。管理员可在自己的受信任临时目录用固定 `@playwright/test@1.56.1` 执行 `playwright install-deps chromium` 一次；部署 job 只执行普通用户的 `playwright install chromium`，不获取通用 sudo 权限。

Runner 仅需出站访问 GitHub Actions、npm、Playwright 下载站和测试 HTTPS 入口，无需开放新的 SSH 入站端口。检查 `bg3deploy` 可以调用三个固定 helper 动作、可以写部署根和 `test-state`、不能读取/写入世界数据库和生产 dataPath。随后按 GitHub 步骤启用开关并运行工作流。

## Playwright 覆盖、报告与恢复

`e2e/` 固定 Playwright **1.56.1** 并提交 npm lockfile。两个独立浏览器 context 分别登录 Gamemaster 和 Player1，检查准确世界 ID/标题、Foundry 14、D&D5e 6.0.6 和三个已启用模组，再验证：

- 两个 token 来回切换后角色名、HP、AC 匹配真实文档。
- GM 修改测试角色 HP 和一级法术槽数值，两个独立会话通过真实 Foundry socket 更新 HUD。
- 戏法过滤、快捷栏隐藏、刷新后持久性、排序、切回原 BG3 HUD。
- 两个会话无 pageerror 或 console error。
- `finally` 恢复并核验两个测试角色的 HP、法术槽以及两账号原有布局 flags。只修改该模组自己的 flags，不更改上游布局、世界设置、物品或正式角色。

**法术槽同步测试是 GM 资源编辑，不代表通过法术施放证明了官方消耗。** 官方 item/activity 使用、真实施法扣槽、pact、专注、模板、休息和聊天卡仍按 `MANUAL_TESTS.md` 手工验收；不会通过伪造系统消耗关闭这些项目。本次没有真实登录报告。

私有 snapshot 在修改前写入磁盘，浏览器中断后由后续测试先恢复；不能把它放进 artifact 或仓库。默认禁用 Playwright trace、截图、视频和完整错误附件，报告只含固定检查名称、最后阶段、通过状态和版本。失败不输出账号密码、Cookie、完整 DOM、角色数据或认证状态文件。

硬断电、runner 被强制终止、sudo helper 超时等情况可能阻止即时回滚。`pending.json` 和备份会保留，下一次部署首先恢复旧版本并停止本次发布；之后再运行一次才会部署新版本。也可以在仓库根目录用部署账号执行：

```sh
python3 tools/deploy_modstest.py --recover-only
```

此命令只恢复模组，不需要 Secrets；测试角色 snapshot 的恢复需要下一次成功登录 GM。若 snapshot 仍存在，不要手工删除它并宣布数据已恢复；排查登录/场景/模组问题后重新测试，或由管理员依照私有快照恢复指定 fixture 字段。若 `pending.json` 仍存在，服务恢复未完成，应保留所有版本及原始 ZIP，先修复测试服务。

备份和历史版本不会自动删除。确认不再用于恢复后，由管理员维护保留策略；不要在部署脚本中递归清理 Foundry 数据目录。
