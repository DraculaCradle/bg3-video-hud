# 现有实例自动更新重构报告 — 2026-11-05

本次按用户要求改为只使用现有 Foundry V14 实例、`https://redmagic.club/`、现有进程/端口/dataPath/反代和 ModsTest 世界。删除旧服务停启 helper 与第二实例初始化脚本，不部署新实例。**本次没有请求线上 Foundry、使用真实账号登录、写入线上目录、改动服务器配置或启用部署。** 网络操作仅用于 GitHub 仓库和开发依赖；fixture 浏览器只访问本地临时测试服务器。

GitHub 实际查询显示 PR #2 已合并，head 为 `1ea5b2d`。修订继续使用原 `feat/modstest-actions` 分支，不直接更新 main；已合并 PR 不能重新打开，需要使用同一分支上的后续修订审阅。此前网络/旧方案报告不代表本次实机验证。

## 最终行为及安全边界

| 要求 | 本次实现 |
| --- | --- |
| 保留现有服务与入口 | 没有 service、端口、dataPath 或反代创建/修改代码；helper 没有服务控制权限 |
| 只更新此模组 | root 配置固定现有 Data/modules/bg3-video-hud；runner 没有共享 modules 父目录写权限；特权 helper 不接受其他目标路径 |
| 当前世界不是 ModsTest | 登录前检查标题，认证后核对准确 ID；明确 skipped，不切世界、不进入 Setup |
| 正式用户在线 | 实时检查账号身份和活动会话；持续 socket/hook 监控并锁存不安全状态；停止后续写入 |
| 首次安装或需重新注册 | maintenance-required；清单/版本任一字节改变、系统/依赖不符或进程注册信息不匹配均不热更新 |
| 备份、原子更新 | 原版 ZIP 验证、完整 candidate 写入与 fsync、Linux renameat2(RENAME_EXCHANGE) 一次交换普通目录，无空目标间隔 |
| 失败与中断 | 持锁覆盖测试；安全时交换回原目录并核验资源、恢复 fixture；状态不安全时保留 journal，不强行回滚或重启 |
| 恢复 | prepared/active 阶段由实际两棵目录指纹识别；重跑只恢复旧事务，不同时部署新版本 |
| 其他世界 | 不改启用状态、配置或数据库；管理员核验其他世界未启用并在 root 配置确认；运行时代码在非 ModsTest 标题世界保持无 UI/设置/flags 写入 |
| 凭据 | 使用现有 Gamemaster / Player1 的两项 Environment Secrets；不需 SSH 私钥、服务器密码或 Setup 管理密码 |
| 默认关闭 | repository variable 与 root 配置 enabled 双开关；旧配置 schema 拒绝，未简单移除隔离检查 |

离线世界的启用状态无法通过当前活动世界的 API 完整枚举。本方案要求管理员确认其他世界未启用模组，不谎称自动审计了离线数据库，也不为审计启动其他世界。共享目录只有一个版本；热更新已打开的浏览器代码、阻止用户登录，都不在不更改现有服务器的操作范围内。发现会话变化后守卫会停止，尚未安全恢复的情况明确报告 recovery-required。

## 已执行自动化验证

| 检查 | 结果与边界 |
| --- | --- |
| npm run check | 清单、版本、资源路径和 JS 语法通过 |
| npm test | **29 通过**，包含精确世界、身份、会话、连接、系统/依赖版本与登录前拒绝检查 |
| npm run test:browser | **32 通过**；真实本地 Chromium + API fixtures，包含非 ModsTest 启动无副作用检查 |
| npm run test:deploy | **22 通过**；保留原离线安装器测试，不会在自动更新流程调用其 CLI |
| npm run test:modstest-deploy | **34 通过**；真实 Linux 临时目录交换、备份、回滚、中断、相同内容重发的 inode 恢复、外部改动拒绝、并发锁、配置权限、旧 schema 拒绝、维护窗口判定、会话变化时推迟恢复，以及超时响应不充当新安全证明 |
| npm ci / e2e npm ci | 锁文件依赖安装通过 |
| Playwright test --list | 发现 1 个两角色实机场景，仅解析/发现，不执行真实账号登录 |
| actionlint 1.7.7 | 三个 GitHub 工作流验证通过 |
| Python/e2e JS 编译、打包、SHA256SUMS、git diff --check | 通过 |

合计 **117 项本地自动化测试通过**。本次增加异步 foreign-world 检查后，曾发现 fixture 驱动把尚未结束的 interactive 阶段再次触发；已在键盘交互完成后正确恢复 running 状态，全套 32 项浏览器检查重跑通过。没有把未执行的实机场景计入通过数。

## 实机项目状态

Gamemaster / Player1 登录、现有服务器目录更新、真实 socket 行为、特权 helper 安装和实际角色恢复均 **未执行**；须由用户配置并明确开启后运行工作流。Playwright 代码使用持续守卫的现有 GM 认证、新测试页面和独立 Player1 会话，验证角色切换、HP/AC、槽数同步、快捷栏过滤/可见性/排序/刷新持久性及原 HUD 恢复，并恢复指定两个角色和两个用户的本模组布局。

快照在首次修改前 fsync，恢复前校验准确世界、两个 fixture 与账号身份；失败保留私有快照，不上传。官方施法扣槽、pact、专注、模板、休息与聊天卡仍需 MANUAL_TESTS.md 中的实机验收；GM 编辑槽数的显示同步不等价于实际施法消耗验证。

完整 GitHub 与现有 Linux 配置、root 文件 helper 权限及维护/恢复步骤见 [MODSTEST_SETUP.md](MODSTEST_SETUP.md)。
