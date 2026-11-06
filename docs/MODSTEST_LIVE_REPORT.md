# ModsTest 实机测试报告

日期：2026-11-06（中国标准时间 UTC+8）。**HUD 实机验收尚未通过。**

目标为现有 `https://redmagic.club/`、世界标题 `ModsTest`、world ID `modstest`。使用现有 Gamemaster 及无密码 Player1，凭据仅由 GitHub `modstest` Environment 提供。

## 最近一次实机诊断结果

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

## 诊断当时已验证和未验证

| 项目 | 结论 |
| --- | --- |
| 该次诊断提交的自动化回归 | 161 项通过：63 Node、44 共享实例部署／配置、22 离线安装、32 Chromium fixture；语法、清单、打包及 Playwright 用例发现通过。CI：[42169741375](https://github.com/DraculaCradle/bg3-video-hud/actions/runs/42169741375) |
| 浏览器兼容性 | 服务器发布的 V14 客户端要求 Chromium ≥146，旧 Playwright 1.56.1 的 Chromium 141 低于要求。[PR #19](https://github.com/DraculaCradle/bg3-video-hud/pull/19) 已升级为固定 Playwright 1.65.0／Chromium 158.0.8127.18，并加入登录前版本检查；本地及现有 runner 的版本和 WebGL2 预检通过 |
| 超时后的数据恢复 | [只恢复 42140503885](https://github.com/DraculaCradle/bg3-video-hud/actions/runs/42140503885) 通过，确认 pending journals 不存在；[42143717040](https://github.com/DraculaCradle/bg3-video-hud/actions/runs/42143717040) 再次明确断言两个私有恢复日志均不存在 |
| HUD 功能 | 尚未验证 GM／Player1 双会话、角色切换、HP／AC、法术槽显示同步、戏法筛选、快捷栏隐藏／排序／刷新持久化及原 HUD 恢复。未进行真实施法消耗验收 |
| 自动部署与服务 | 自动部署保持关闭；main [构建 42169868287](https://github.com/DraculaCradle/bg3-video-hud/actions/runs/42169868287) 的 `deploy-and-test` 被跳过。未部署模组文件、停止／重启服务、切换世界或修改其他世界 |

## 后续 HUD 开发状态（离线）

本轮在开发工作区补齐栏内活动／施放选择、原生来源管理、搜索和批量草稿编辑、血条／法术位图形、说明卡、目标预览、顺序攻击／射线结算、观察到的动作使用记录、队伍状态及可选效果。详见[操作说明](COMPLETE_HUD.md)和[视频对照](VIDEO_COMPARISON.md)。

当前 254 项离线检查通过（97 Node、44 共享实例／配置、22 安装、91 Chromium），不能替代上表中未执行的真实消费、恢复或第三方组合验收。720P～4K 原创模拟预览已更新。稳定安装地址仍为 v0.1.1，新代码尚未发布、部署或在现有 Foundry 中认证。本轮没有登录测试账号、写入世界文档、重复阻塞 RPC，不能据此宣称账号当前在线状态已重新核实。

## 相关诊断证据

- [42138235766](https://github.com/DraculaCradle/bg3-video-hud/actions/runs/42138235766)：GM 登录及世界／版本／模组启用守卫通过，临时规则书角色准备阶段达到 600 秒上限，退出时无法确认清理。不能把这轮记为“未创建角色”；后续以上述只恢复成功为依据。
- [42142183072](https://github.com/DraculaCradle/bg3-video-hud/actions/runs/42142183072) 和 [42143717040](https://github.com/DraculaCradle/bg3-video-hud/actions/runs/42143717040)：只读 Actor 文档阶段超时，尚未进入世界角色导入或 HUD 验收；调整合集优先级没有解决读取障碍。
- [42147966129](https://github.com/DraculaCradle/bg3-video-hud/actions/runs/42147966129)：旧 Chromium 下的只读诊断报告 Socket 用户匹配，本地缓存索引 337 条；真实索引、空结果世界 Actor 查询、直接 Socket 回调约 34.8 秒超时，原生包装读取约 34.3 秒超时，未捕获客户端错误类别。无世界文档写入，脱敏报告未记录退出异常。系统 `/usr/bin/node` 参考版本 v24.18.0 不证明运行中 Foundry PID 所加载的版本。

缓存索引读取成功不等于真实文档 RPC 成功，客户端没有在时限内收到回调也不足以断定请求是否抵达服务器。本轮已纠正浏览器版本并复核，文档读取障碍仍存在。

## 安全边界与恢复

测试保留精确世界身份、版本、启用状态、活动会话守卫及事务恢复。临时文档只使用唯一标记；保存的角色 HP／法术槽及两个用户布局必须先恢复并验证，才能清除私有日志。只读诊断发现 pending journal 会停止，交由单独的 `recover_only` 处理。只恢复或诊断绿色不代表 HUD 验收通过。

不强制断开未知会话，不新增实例、服务、端口或 dataPath，不自动启用模组或修改其他世界。测试结束应关闭自己的全部认证连接，并从全新匿名页面确认测试账号恢复可选；未确认时报告清理异常，不宣称账号已释放。

## 下一步操作

### GitHub

保持 `MODS_TEST_ENABLED=false`，不要启动部署。PR #19 已合并。先由管理员结合上述测试时段排查现有实例；问题修复后，只运行 **ModsTest live tests only**、main、`world_id=modstest`、`inspect_sources=true`。确认真实读取正常、无其他会话且账号释放后，才运行 `create_fixtures=true` 的完整验收。原测试凭据继续放在 `modstest` Environment Secrets，不需要在聊天或仓库提供密码。

### 现有 Linux 服务器

无需安装第二实例、改权限或重启服务。管理员可在本地只读核对现有服务状态，并查看本轮请求对应时段的日志：

```sh
systemctl show foundryvtt.service -p MainPID -p User -p ActiveState -p SubState
sudo journalctl -u foundryvtt.service --since '2026-11-06 05:45:00 UTC' --until '2026-11-06 05:50:00 UTC' --no-pager --output=short-iso
```

同时检查既有反向代理在相同时段的 WebSocket／upstream 错误，关注 `modifyDocument`、数据库异常、会话授权、超时或断线。上述日志只在服务器本地查看；对外只提供错误类别、时间及是否出现对应请求，不发送原始日志、Cookie、会话 ID 或密码。如果没有相关日志，应明确记为“未观察到”，不能推断请求没有到达。现有服务运行版本、日志和代理记录需要管理员核实，本轮未访问管理员日志；不为排查提升 runner 权限。任何需要重启的修复必须另行安排维护窗口。
