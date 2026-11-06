# ModsTest 实机测试报告

日期：2026-11-06。**v0.1.2 已发布，最新版 HUD 实机验收尚未开始／通过。**

目标始终是现有 `https://redmagic.club/`、世界 `modstest`／`ModsTest`。仅使用既有测试账号；凭据来自 GitHub `modstest` Environment，Player1 空密码。自动文件部署继续关闭。

## 最新结果：已装版本不同（15:40 UTC）

[只测试运行 42244683796](https://github.com/DraculaCradle/bg3-video-hud/actions/runs/42244683796) 于 `2026-11-06T15:40:19.482Z` 输出脱敏报告，模式 `source-inspection`、状态 `failed`。停止原因：

```text
installed-module-version-mismatch:expected=0.1.2;installed=0.1.1
```

GM 认证、精确世界／账号／版本／依赖守卫完成后，测试读取的已安装模组版本仍是 **0.1.1**。发布成功不会自动升级现有 Foundry。为避免拿旧版结果冒充新版验收，流程在这个守卫停止，未进入 SRD／Actor RPC 诊断、Player1 登录、角色导入或 HUD 测试。本次没有调用世界文档写入，没有更改模组文件或配置。

流程结束未报告 `cleanupReason`：本次自有 GM 会话的原生登出及新匿名页面账号可选性检查没有报异常。启动前受限 runner 的浏览器清单为空；未另做结束后的进程清单检查，不把启动前清单作为结束后证明。此前恢复日志检查的历史结果见下文；本轮停在版本守卫，不能声称又检查了日志不存在。

早先的文档 RPC 超时问题**本轮没有重新检测**；它也没有被本轮版本检查解决。当前阻碍首先是已装版本不同，需更新后再进行一次只读预检。

## 发布与下载验证

- [v0.1.2 Release](https://github.com/DraculaCradle/bg3-video-hud/releases/tag/v0.1.2)，发布提交 `d3ba97f5068d778e1fe79ec240c4a814b2832f75`。
- [发布工作流 42244392838](https://github.com/DraculaCradle/bg3-video-hud/actions/runs/42244392838) 成功；255 项检查通过。
- 公开 `releases/latest/download/module.json` 已实际下载并确认版本 0.1.2；ZIP／manifest／独立安装器按公开 SHA256SUMS 校验通过。ZIP 37 个文件，12 个运行时 JS/CSS 与发布标签一致。
- main [构建 42244291552](https://github.com/DraculaCradle/bg3-video-hud/actions/runs/42244291552) 成功，`deploy-and-test` 明确 skipped。没有开启文件部署，没有停止／重启 Foundry、切换世界或创建第二实例。

## 下一步（仅现有实例）

管理员在维护窗口通过原 module.json 地址**只更新 bg3-video-hud**，核对版本显示为 0.1.2，再重新载入 ModsTest。若界面要求服务重启，由管理员安排，不交给 runner 自动处理；不更改端口、dataPath、反向代理或其他模组／世界。

退出 Gamemaster／Player1 并关闭相关页面后，先运行 main 的 `ModsTest live tests only`、`world_id=modstest`、`inspect_sources=true`。版本一致且原生文档读取正常，才运行 `create_fixtures=true` 完整测试。完整流程还会在创建临时角色前验证服务器实际 JS/CSS 的 SHA-256；恢复模式不因版本变化而被禁止。

若仍出现相同 RPC 超时，则停止重复请求，结合下面的历史诊断让管理员检查服务／代理日志。只测试或恢复绿色也不能代替实际 HUD 功能与原生消费验收。

## 之前的 RPC 诊断（05:49 UTC）

[新版浏览器只读运行 42169878299](https://github.com/DraculaCradle/bg3-video-hud/actions/runs/42169878299) 于 13:49:09 结束，`mode=source-inspection`、`status=failed`，守卫原因 `srd-source-inspection-unavailable`。runner 日志确认 Chromium 158.0.8127.18、WebGL2=true，已通过 GM 认证及世界／版本／依赖守卫；没有执行 Player1 登录或 HUD 验收。

| 读取检查 | 实机结果 |
| --- | --- |
| 本地缓存索引 | 337 条，0ms；只证明缓存可用 |
| Socket 用户与 GM 匹配 | true |
| 真实合集索引 RPC | 33,756ms 超时 |
| 当前世界随机不存在 ID 的空结果查询 | 33,757ms 超时 |
| 直接 Socket get 回调 | 33,757ms 超时，未收到可记录的回调参数 |
| 原生 `pack.getDocument()` | 32,793ms 超时 |
| 客户端错误类别 | 未捕获 |

新版浏览器未解决文档读取障碍。证据只能证明这些请求未在时限内向测试客户端返回回调，不能证明请求是否抵达服务端，也不能单凭此定位为数据库、Node 或反向代理故障。本轮未开始创建角色，后续相同重试已停止。

该模式拒绝待恢复日志，不执行任何世界文档写入；本轮未创建角色／token／场景或修改 HP、法术槽、布局。原生退出、关闭自有认证连接和全新匿名账号可选性检查未报告异常。结束后另用匿名公开 Socket 状态复核：Gamemaster 与 Player1 均为离线，非测试账号在线数为 0。runner 开始时同账号浏览器清单为空；这只反映启动前清单，不能代替结束后的进程证明。

## 上述 RPC 诊断当时的验证范围

| 项目 | 结论 |
| --- | --- |
| 该次诊断提交的自动化回归 | 161 项通过：63 Node、44 共享实例部署／配置、22 离线安装、32 Chromium fixture；语法、清单、打包及 Playwright 用例发现通过。CI：[42169741375](https://github.com/DraculaCradle/bg3-video-hud/actions/runs/42169741375) |
| 浏览器兼容性 | 服务器发布的 V14 客户端要求 Chromium ≥146，旧 Playwright 1.56.1 的 Chromium 141 低于要求。[PR #19](https://github.com/DraculaCradle/bg3-video-hud/pull/19) 已升级为固定 Playwright 1.65.0／Chromium 158.0.8127.18，并加入登录前版本检查；本地及现有 runner 的版本和 WebGL2 预检通过 |
| 超时后的数据恢复 | [只恢复 42140503885](https://github.com/DraculaCradle/bg3-video-hud/actions/runs/42140503885) 通过，确认 pending journals 不存在；[42143717040](https://github.com/DraculaCradle/bg3-video-hud/actions/runs/42143717040) 再次明确断言两个私有恢复日志均不存在 |
| HUD 功能 | 尚未验证 GM／Player1 双会话、角色切换、HP／AC、法术槽显示同步、戏法筛选、快捷栏隐藏／排序／刷新持久化及原 HUD 恢复。未进行真实施法消耗验收 |
| 自动部署与服务 | 自动部署保持关闭；main [构建 42169868287](https://github.com/DraculaCradle/bg3-video-hud/actions/runs/42169868287) 的 `deploy-and-test` 被跳过。未部署模组文件、停止／重启服务、切换世界或修改其他世界 |

## HUD 开发与发布

v0.1.2 包含栏内活动／施放选择、原生来源管理、搜索和批量草稿编辑、生命／法术位图形、说明卡、目标预览、顺序攻击／射线结算、观察到的动作使用记录、队伍状态及可选效果。详见[操作说明](COMPLETE_HUD.md)与[视频对照](VIDEO_COMPARISON.md)。255 项离线检查通过（98 Node、44 共享实例／配置、22 安装、91 Chromium），不能替代真实消费、恢复或第三方组合验收。

## 相关诊断证据

- [42138235766](https://github.com/DraculaCradle/bg3-video-hud/actions/runs/42138235766)：GM 登录及世界／版本／模组启用守卫通过，临时规则书角色准备阶段达到 600 秒上限，退出时无法确认清理。不能把这轮记为“未创建角色”；后续以上述只恢复成功为依据。
- [42142183072](https://github.com/DraculaCradle/bg3-video-hud/actions/runs/42142183072) 和 [42143717040](https://github.com/DraculaCradle/bg3-video-hud/actions/runs/42143717040)：只读 Actor 文档阶段超时，尚未进入世界角色导入或 HUD 验收；调整合集优先级没有解决读取障碍。
- [42147966129](https://github.com/DraculaCradle/bg3-video-hud/actions/runs/42147966129)：旧 Chromium 下的只读诊断报告 Socket 用户匹配，本地缓存索引 337 条；真实索引、空结果世界 Actor 查询、直接 Socket 回调约 34.8 秒超时，原生包装读取约 34.3 秒超时，未捕获客户端错误类别。无世界文档写入，脱敏报告未记录退出异常。系统 `/usr/bin/node` 参考版本 v24.18.0 不证明运行中 Foundry PID 所加载的版本。

缓存索引读取成功不等于真实文档 RPC 成功，客户端没有在时限内收到回调也不足以断定请求是否抵达服务器。本轮已纠正浏览器版本并复核，文档读取障碍仍存在。

## 安全边界与恢复

测试保留精确世界身份、版本、启用状态、活动会话守卫及事务恢复。临时文档只使用唯一标记；保存的角色 HP／法术槽及两个用户布局必须先恢复并验证，才能清除私有日志。只读诊断发现 pending journal 会停止，交由单独的 `recover_only` 处理。只恢复或诊断绿色不代表 HUD 验收通过。

不强制断开未知会话，不新增实例、服务、端口或 dataPath，不自动启用模组或修改其他世界。测试结束应关闭自己的全部认证连接，并从全新匿名页面确认测试账号恢复可选；未确认时报告清理异常，不宣称账号已释放。

## 历史 RPC 故障排查路径

### GitHub

保持 `MODS_TEST_ENABLED=false`，不要启动部署。PR #19 已合并。先由管理员结合上述测试时段排查现有实例；问题修复后，只运行 **ModsTest live tests only**、main、`world_id=modstest`、`inspect_sources=true`。确认真实读取正常、无其他会话且账号释放后，才运行 `create_fixtures=true` 的完整验收。原测试凭据继续放在 `modstest` Environment Secrets，不需要在聊天或仓库提供密码。

### 现有 Linux 服务器

无需安装第二实例、改权限或重启服务。管理员可在本地只读核对现有服务状态，并查看本轮请求对应时段的日志：

```sh
systemctl show foundryvtt.service -p MainPID -p User -p ActiveState -p SubState
sudo journalctl -u foundryvtt.service --since '2026-11-06 05:45:00 UTC' --until '2026-11-06 05:50:00 UTC' --no-pager --output=short-iso
```

同时检查既有反向代理在相同时段的 WebSocket／upstream 错误，关注 `modifyDocument`、数据库异常、会话授权、超时或断线。上述日志只在服务器本地查看；对外只提供错误类别、时间及是否出现对应请求，不发送原始日志、Cookie、会话 ID 或密码。如果没有相关日志，应明确记为“未观察到”，不能推断请求没有到达。现有服务运行版本、日志和代理记录需要管理员核实，本轮未访问管理员日志；不为排查提升 runner 权限。任何需要重启的修复必须另行安排维护窗口。
