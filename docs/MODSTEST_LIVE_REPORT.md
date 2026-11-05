# ModsTest 实机测试报告

状态：**受阻，HUD 实机验收尚未通过**。日期：2026-11-06（香港时间）。

目标是现有 `https://redmagic.club/`、世界标题 `ModsTest`、准确 world ID `modstest`、现有 Gamemaster 和无密码 Player1。没有创建第二实例、部署模组文件、停止或重启 Foundry、切换世界或修改其他世界。

| 检查 | 结果与证据 |
| --- | --- |
| 自动化回归 | 147 项通过：54 Node、22 离线安装、39 共享实例部署／配置、32 Chromium fixture 检查；另有语法、清单、打包、Playwright 用例发现和 actionlint 校验 |
| runner 浏览器能力 | Chromium 启动及 WebGL2 canvas 预检通过 |
| 世界身份 | 公开 Socket `getJoinData` 只读核实标题 ModsTest、ID modstest；不自动采用其他 ID 或切换世界 |
| 三个模组启用 | 用户确认均已启用；本次尚未成功进入认证后的完整守卫重新核实，不能将人工确认当作实机断言 |
| GM 登录 | [测试运行 42061094020](https://github.com/DraculaCradle/bg3-video-hud/actions/runs/42061094020) 第 2、3 次尝试均在提交密码前报告 `test-account-already-active` |
| 活动连接交叉核实 | 00:31:21 的匿名 Socket 快照显示 Gamemaster 在线、Player1 离线、非测试账号在线数 0；00:33:20 仍收到 GM `active=true` 活动消息。观察连接自身未认证；第 3 次测试步骤已于 00:31:44 结束 |
| runner 遗留浏览器 | [纯诊断运行 42066215567](https://github.com/DraculaCradle/bg3-video-hud/actions/runs/42066215567) 返回 `runnerUid=1000`、`browsers=[]`；该运行未启动浏览器、登录 Foundry 或终止进程。绿色状态只代表进程诊断成功 |
| 实机角色与数据 | 最新测试均止于初始认证守卫，未创建临时角色、token 或场景，未执行角色 HP／法术槽／布局修改 |
| 自动部署 | 保持关闭；main 构建中的 `deploy-and-test` 任务跳过 |

此前曾在成功认证后遇到 `foundry-or-dependency-version-mismatch`，随后退出错误覆盖了主错误。测试驱动现已分别报告主错误和退出错误，并在版本守卫失败时记录经过校验的数字版本及固定依赖启用布尔值。用户确认启用三个模组之后的最新尝试未越过 GM 已在线检查，因此不推断当前依赖仍不兼容。

已修复 V14 大小写敏感的 `userId` 表单字段、登录表单范围、世界标题与 ID 的区分、原生退出异步跳转等待，以及在关闭全部自有连接后从匿名页面核实账号释放的流程。已有会话不可选时仍停止，不强制踢人或绕过守卫。

仍待实机验证：临时规则书角色导入与清理、GM／Player1 双会话、角色切换、HP／AC、法术槽实时显示、戏法筛选、快捷栏隐藏／排序／刷新持久化、原 BG3 HUD 恢复及数据还原。普通测试和浏览器 fixture 的通过不代替这些结果；法术槽显示同步也不等于验证了真实施法消耗。

下一步是定位并释放仍在活动的 GM 连接。仅在公开账号状态确认释放后重跑只测试流程，保持 `MODS_TEST_ENABLED=false`，不启用自动部署。不得因登录受阻而重启服务、切换世界、强制清除未知会话或修改数据库。
