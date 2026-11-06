# ModsTest 实机测试报告

状态：**超时后的只恢复已通过；HUD 实机验收尚未通过**。日期：2026-11-06（中国标准时间 UTC+8）。

[只恢复运行 42140503885](https://github.com/DraculaCradle/bg3-video-hud/actions/runs/42140503885) 于 09:00:59 生成 `mode=recovery-only`、`status=passed` 报告，断言待恢复日志已处理并确认不存在，未创建新角色或开始 HUD 测试；正常退出确认也通过。此结果只证明本轮恢复成功，不能替代 HUD 验收。

[后续验收运行 42142183072](https://github.com/DraculaCradle/bg3-video-hud/actions/runs/42142183072) 于 09:16:16 明确报告 `fixture-source-read-timeout:actor-source-document`，已定位到规则书角色文档的只读阶段，尚未进入世界角色导入或 HUD 测试，后续恢复／退出未报告异常。系统安装顺序将 heroes 排在 monsters 之前；准备代码现改为优先标准怪物合集，保留只读超时和所有守卫，待下一轮实机验证。

[标准怪物合集验收运行 42143717040](https://github.com/DraculaCradle/bg3-video-hud/actions/runs/42143717040) 于 09:29:47 在同一只读文档阶段超时，报告明确通过断言 `Fixture recovery completed; both private recovery journals absent`，退出未报告异常。这次没有进入世界角色导入或 HUD 测试；仅调整合集优先级不足以解决读取障碍。下一步使用 `inspect_sources` 比较原始 Socket get 与 `pack.getDocument()`，不创建任何世界文档。

[只读源诊断 42145551770](https://github.com/DraculaCradle/bg3-video-hud/actions/runs/42145551770) 于 09:46:18 报告本地索引 337 条、读取 1ms；原始 Actor Socket get 在约 34.8 秒超时，包装读取约 34.4 秒超时。缓存索引可读不能证明服务端索引 RPC 正常。下一步补测真实索引 RPC、空结果世界 Actor get、Socket 用户匹配布尔值及系统 Node 参考版本，仍不写世界文档。

最新重试：[运行 42138235766](https://github.com/DraculaCradle/bg3-video-hud/actions/runs/42138235766) 已通过 GM 登录、世界身份、Foundry／D&D5e／依赖版本及启用状态守卫，进入临时规则书角色／token 准备阶段后在 10 分钟上限超时。报告于 08:48:45 生成，`lastStage=Import temporary SRD actors and create marked tokens`，超时后的会话守卫锁存，无法确认临时文档清理完成；不能宣称本轮未创建角色或已还原数据。公开账号状态随后核实 GM／Player1 均离线，非测试账号在线数为 0。

已使用新增 `recover_only` 入口和原私有日志／唯一标记完成恢复验证。以下表格保留之前的诊断背景；关于旧轮次“未创建角色”的描述不适用于本次超时。

目标是现有 `https://redmagic.club/`、世界标题 `ModsTest`、准确 world ID `modstest`、现有 Gamemaster 和无密码 Player1。没有创建第二实例、部署模组文件、停止或重启 Foundry、切换世界或修改其他世界。

| 检查 | 结果与证据 |
| --- | --- |
| 自动化回归 | 149 项通过：54 Node、22 离线安装、41 共享实例部署／配置／进程清单、32 Chromium fixture 检查；另有语法、清单、打包、Playwright 用例发现和 actionlint 校验 |
| runner 浏览器能力 | Chromium 启动及 WebGL2 canvas 预检通过 |
| 世界身份 | 公开 Socket `getJoinData` 只读核实标题 ModsTest、ID modstest；不自动采用其他 ID 或切换世界 |
| 三个模组启用 | 用户确认均已启用；本次尚未成功进入认证后的完整守卫重新核实，不能将人工确认当作实机断言 |
| GM 登录 | [测试运行 42061094020](https://github.com/DraculaCradle/bg3-video-hud/actions/runs/42061094020) 第 2、3 次尝试均在提交密码前报告 `test-account-already-active` |
| 活动连接交叉核实 | 00:31:21 的匿名 Socket 快照显示 Gamemaster 在线、Player1 离线、非测试账号在线数 0；00:33:20 仍收到 GM `active=true` 活动消息。观察连接自身未认证；第 3 次测试步骤已于 00:31:44 结束 |
| runner 遗留浏览器 | [修正版纯诊断运行 42067889378](https://github.com/DraculaCradle/bg3-video-hud/actions/runs/42067889378) 返回 `runnerUid=1000`、`browsers=[]`，已包含固定 Playwright 使用的 `headless_shell` 及 Chrome／Chromium 名称检查和回归。初版清单曾漏检，不能作为排除证据；以本次复核为准。纯诊断不启动浏览器、登录 Foundry 或终止进程；绿色状态不是 HUD 验收通过 |
| 实机角色与数据 | 最新测试均止于初始认证守卫，未创建临时角色、token 或场景，未执行角色 HP／法术槽／布局修改 |
| 自动部署 | 保持关闭；main 构建中的 `deploy-and-test` 任务跳过 |

此前曾在成功认证后遇到 `foundry-or-dependency-version-mismatch`，随后退出错误覆盖了主错误。测试驱动现已分别报告主错误和退出错误，并在版本守卫失败时记录经过校验的数字版本及固定依赖启用布尔值。用户确认启用三个模组之后的最新尝试未越过 GM 已在线检查，因此不推断当前依赖仍不兼容。

已修复 V14 大小写敏感的 `userId` 表单字段、登录表单范围、世界标题与 ID 的区分、原生退出异步跳转等待，以及在关闭全部自有连接后从匿名页面核实账号释放的流程。已有会话不可选时仍停止，不强制踢人或绕过守卫。

仍待实机验证：临时规则书角色导入与清理、GM／Player1 双会话、角色切换、HP／AC、法术槽实时显示、戏法筛选、快捷栏隐藏／排序／刷新持久化、原 BG3 HUD 恢复及数据还原。普通测试和浏览器 fixture 的通过不代替这些结果；法术槽显示同步也不等于验证了真实施法消耗。

下一步是定位并释放仍在活动的 GM 连接。仅在公开账号状态确认释放后重跑只测试流程，保持 `MODS_TEST_ENABLED=false`，不启用自动部署。不得因登录受阻而重启服务、切换世界、强制清除未知会话或修改数据库。

修正版进程诊断后，再次只读请求公开账号状态，Gamemaster 仍在线、Player1 离线、非测试账号在线数为 0。当前没有正在执行的实机测试，且该受限 runner 没有上述浏览器进程；现有 GM 连接的来源尚未定位，不归因于某台具体设备，也不强制断开。

## 后续操作

- GitHub：`modstest` Environment 的 `FOUNDRY_WORLD_ID` 使用 `modstest`，保持 `MODS_TEST_ENABLED=false`。账号释放后使用 **ModsTest live tests only**，选择 main、`world_id=modstest`、`create_fixtures=true`；不要勾选纯诊断来代替 HUD 验收。
- 现有 Linux 服务器：无需新增服务、端口或 dataPath。管理员可先只读查看现有 Foundry 服务连接日志，定位活动 GM 连接；不修改数据库或删除会话文件，不自动重启。以下命令仅在服务器本地查看，勿发送原始日志、会话 ID 或 Cookie：

```sh
sudo journalctl -u foundryvtt.service --since '20 minutes ago' --no-pager --grep='(?i)(gamemaster|connect|disconnect|session)'
```

服务日志不足以定位时，应由管理员检查现有反向代理的 WebSocket 连接记录及实例会话状态。是否需要维护窗口取决于管理员诊断；本报告不授权自动重启或强制清除未知连接。
