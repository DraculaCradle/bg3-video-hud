> v0.1.4（2026-11-07）：本次仅离线UI优化及发布，用户继续人工验收。没有新的服务器登录、实机测试、部署或恢复操作；下文证据仍为历史记录。

# ModsTest 实机测试报告

**当前自动实机测试已由用户停止，后续由用户人工验收。** v0.1.3 的发布不自动安装到服务器；下面保留的是当时 v0.1.2 的历史诊断事实，不代表 v0.1.3 实机验收，也不构成恢复自动登录或执行下文历史计划的授权。

更新：2026-11-07（香港时间 UTC+8）。**线上已确认 v0.1.2；完整 Chromium 仍出现就绪后原生时钟查询超时，但初始化观察窗口捕获到过有效回包。文档读取障碍仍未解决，HUD 实机验收尚未开始／通过。**

目标始终是现有 `https://redmagic.club/`、世界 `modstest`／`ModsTest`。仅使用既有测试账号；凭据来自 GitHub `modstest` Environment，Player1 空密码。自动文件部署继续关闭。

## 最新结果：完整 Chromium 对照（11月7日 11:44，香港时间）

[只读诊断 42335038943](https://github.com/DraculaCradle/bg3-video-hud/actions/runs/42335038943) 使用 [PR #34](https://github.com/DraculaCradle/bg3-video-hud/pull/34) 合并后的 main；runner 实际 smoke 为完整 Chromium 158.0.8127.18、WebGL2=true，本机 HTTPS 端点和版本 0.1.2 守卫通过。

| 观察窗口 | time 请求／匹配 ACK／有效时间 ACK |
| --- | --- |
| 登录与初始化阶段，被动观察 | 3／1／1 |
| 重置统计后，显式查询到期 | 2／0／0 |
| 到期后额外 1 秒被动观察 | 2／0／0 |

显式查询的 10 秒页面计时器实际约 14.53 秒后超时，画布就绪等待约 22.68 秒。查询前连接仍为 connected／WebSocket／open／writable，缓冲为 0；观察期间累计 2 次 ping／pong 往返。接口指纹与此前一致。帧数包含可能的原生周期同步，诊断只主动发出一次查询。

**切换完整 Chromium 没有恢复显式回调。** 初始化观察窗口有真实有效 ACK，说明不能把问题概括为“连接从未收到回包”；但它也不能让就绪后的超时变为通过。具体故障层仍不明确，不归因于某个插件、数据库或 Node 版本。

本轮未读取 Actor／SRD、登录 Player1、导入角色／token／场景或更新世界文档。报告没有退出清理异常：本次自有 GM 会话的原生登出及新匿名页面可选性检查未报错。没有把旧恢复日志结果算成本轮检查。

[CI 42334950567](https://github.com/DraculaCradle/bg3-video-hud/actions/runs/42334950567) 通过 271 项检查（109 Node、49 共享实例／配置、22 安装、91 Chromium），完整 Chromium／WebGL2 smoke 通过且文件部署开关为 false；main [构建 42335015219](https://github.com/DraculaCradle/bg3-video-hud/actions/runs/42335015219) 成功、部署任务 skipped。

下一次只读对照只改变本测试匿名连接与 HTTP 认证的交接：输入凭据前确认自己的匿名 Socket／传输已关闭，再用原生登录表单认证。已认证用户或不同世界连接一律不操作；关闭未确认就停止。它用于检查交接阶段的可能影响，尚未证实竞态；不重复原配置的查询，不绕过世界／账号／版本／恢复守卫。

## 人工浏览器对照

11 月 7 日管理员确认：日常浏览器可以正常打开 SRD 怪物条目，未提供耗时。它证明该次人工读取路径可用，尚不能排除缓存，也不证明自动化浏览器或所有文档 RPC 正常。

离线核查 Playwright 的浏览器选择发现：原流程默认无界面启动使用独立 headless shell，离线 UI 检查则使用完整 Chromium。现统一预登录 smoke、实机工作流和部署守卫为完整 Chromium 的无界面模式，保留版本／WebGL2、严格 TLS、世界／版本／会话及恢复守卫。只读时钟对照同时保留初始化阶段的被动回包计数，显式查询前重置窗口；不能拿初始化回包充当显式查询通过。

完整 Chromium 对照现已完成，仍然超时，详见上文；该差异不是已确认的故障原因。账号仍在线时照常停止，不强制登出他人。只有新的时钟对照与真实文档预检都正常后才考虑完整 HUD 测试。

## 最新结果：本机 HTTPS 路径对照（11月7日 10:08，北京时间）

[只读诊断 42327421500](https://github.com/DraculaCradle/bg3-video-hud/actions/runs/42327421500) 使用已合并的 [PR #32](https://github.com/DraculaCradle/bg3-video-hud/pull/32)，在服务器上的受限 runner 中，仅将临时浏览器对既有域名的解析指向本机。仍使用原 HTTPS 域名、443、Host/SNI 和严格 TLS；输入凭据前已验证响应源与实际本机端点。不更改服务器 DNS、反代配置、服务、端口或 dataPath，也没有使用 Codex 出站代理访问测试站点。

脱敏报告的 `connectionRoute=server-loopback`，已安装版本断言为 0.1.2。测试等待活动场景画布约 9.10 秒后就绪，再主动发出一次原生 `time` 只读请求：

| 观察项 | 结果 |
| --- | --- |
| 查询状态 | `timeout`；10 秒页面计时器实际约 14.26 秒后执行 |
| 到期时的 time 请求／匹配 ACK | 2／0 |
| 额外 1 秒被动观察后的 time 请求／匹配 ACK | 3／0 |
| 观察期间的 WebSocket 心跳 | 1 次 ping、1 次 pong |
| 查询前连接 | connected、WebSocket、open、writable；发送缓冲均为 0 |
| 客户端接口 | 数据库后台、SocketInterface.dispatch、GameTime.sync 等指纹与此前保留的原生 V14 客户端一致 |

诊断代码只主动发送一次请求；额外帧的来源未确定，不能称为诊断重试。心跳有往返而应用回调未收到，说明连接没有完全中断；**本机路径同样失败，降低了“仅公网／CDN 路径导致”的可能性，但仍不能定位客户端、反代或服务端中的具体故障层。** 指纹匹配也不能证明整个客户端未受其他代码影响。

随后离线复核发现，旧观察器只对连接生命周期限定域名，time 帧入口还未再次限制连接归属。因此，上述旧计数不能单独证明全部请求帧均来自指定端点；原生回调实际超时的结果独立于这些计数。现已补上精确域名、端口、路径和已注册连接过滤，并回归验证其他连接的同名请求／回包不会污染结果。该修正仅用于提高诊断可信度，没有重跑线上查询，也不宣称解决了 RPC 故障。

观察器修正后的本地离线回归为 269 项通过（107 Node、49 共享实例／配置、22 安装、91 Chromium）；语法、打包及 Playwright 用例发现通过。Chromium 测试仅使用原创模拟数据，没有访问 Foundry。

本轮未读取 Actor／SRD、登录 Player1、创建或更新世界文档、施放技能或执行 HUD 验收。脱敏报告未记录 `cleanupReason`：本次自有 GM 会话的原生登出与新匿名页面账号可选性检查没有报异常。WebSocket 生命周期计数采集在退出前，不能另作退出后的连接证明；历史恢复日志结果也不冒充本轮恢复检查。

该诊断改动的 [CI 42327279712](https://github.com/DraculaCradle/bg3-video-hud/actions/runs/42327279712) 通过 268 项检查（106 Node、49 共享实例／配置、22 安装、91 Chromium），记录自动文件部署开关为 false；main [构建 42327388283](https://github.com/DraculaCradle/bg3-video-hud/actions/runs/42327388283) 成功，`deploy-and-test` 明确 skipped。没有发布新版本或改动线上模组文件。

后续人工浏览器已确认能打开 SRD 条目，完整 Chromium 对照仍然超时，见上文。不因时钟诊断失败直接开始写入临时角色的完整测试。

## 公网路径的原生时钟对照（11月7日 00:39，北京时间）

[42253788425](https://github.com/DraculaCradle/bg3-video-hud/actions/runs/42253788425) 在活动场景画布就绪后，使用世界初始化／周期同步同样的 `time` 只读事件。画布等待约 8.45 秒，版本 0.1.2 与会话守卫通过；数据库后台、SocketInterface.dispatch、GameTime.sync 指纹均与保留的原生 V14 客户端一致。

页面计时器设置 10 秒，实际约 14.11 秒后超时。窗口结束和额外 1 秒被动观察均记录 3 个 time 请求帧、0 个匹配 ACK。诊断代码只主动调用一次 emit；窗口还可能包含原生周期同步或其他内部发送，仅凭计数不能把额外帧归因于诊断重试或确定来源。没有记录原始帧、请求标识或时间值。

这次仍未读取 Actor／SRD、登录 Player1、创建临时文档或执行 HUD 验收；未报告退出清理异常。它表明缺少回包不只出现在文档读取流程，但不能证明请求已被服务端处理，或在客户端、代理、服务端中定位根因。

后续已完成同一 HTTPS 域名的本机反代路径对照，结果见上文；本机端点验证通过，但没有恢复时钟回调。

## 客户端接口与首次状态对照（11月7日 00:26，香港时间）

[42251858333](https://github.com/DraculaCradle/bg3-video-hud/actions/runs/42251858333) 仅执行客户端诊断，没有任何文档请求。版本 0.1.2 守卫通过，数据库后台类、SocketInterface.dispatch、Game.getWorldStatus 的方法指纹与私有保留的 V14 客户端一致；未复制该商业客户端源码到仓库。

连接状态为 connected／WebSocket／open／writable，发送缓冲为 0，非 volatile。观察到 1 个 getWorldStatus 请求帧，窗口内没有匹配回包；10 秒页面计时器实际在约 26.7 秒后执行。报告没有清理异常，没有 Player1 登录或世界文档写入。

**此结果不证明通用回包失效。** getWorldStatus 虽保留为客户端静态接口，尚未证实其在当前已登录世界的服务端适用范围。核对实际初始化调用后，改用世界启动和周期同步真正使用的 `time` 只读事件；验证 serverTime/worldTime 的类型，不保留值、不修改时间。有活动场景时先等画布就绪，观察到期及被动等待后的回包，避免把客户端调度延迟直接归因为服务端失败。仍不重复 Actor／SRD 请求。

## 管理员提供的服务端证据

管理员在现有服务器只读核对了 2026-11-06 23:44～23:49（香港时间；UTC 15:44～15:49）的 Foundry 服务日志。摘要为：创建客户端会话、GM 认证成功、世界数据约 3 秒下发，随后正常登出；所给时段未出现文档、数据库或 WebSocket 异常。原始日志中的会话／用户标识不进入本报告。

这能确认登录、世界数据下发与登出到达 Foundry；没有相关异常日志不证明文档请求未到达，也不能定位数据库或代理。保留的 V14 客户端接口中，原生后台同样使用 modifyDocument 加 get 操作，现有请求结构与其一致。

新增 `inspect_transport=true` 独立诊断，检查当前客户端接口指纹、连接状态，以及一次原生 `time` 读取回包；在登录前监听自有页面控制请求的发送／匹配回包计数。有活动场景时等待画布就绪后才查询，并被动观察迟到回包；不调用推进／设置时间接口，也不保存时间值。它不重试文档读取，不调用 SRD／Actor 接口，不保存原始报文、商业客户端源码、URL 或标识。其绿色结果也不能记为文档／HUD 验收通过。

## v0.1.2 文档预检：版本已加载，RPC 超时（11月6日 23:48，北京时间）

管理员确认更新后，[只读预检 42245807208](https://github.com/DraculaCradle/bg3-video-hud/actions/runs/42245807208) 于 `2026-11-06T15:48:15.748Z` 输出 `failed`，停止原因 `srd-source-inspection-unavailable`。脱敏断言明确记录：**Installed module matches checkout v0.1.2**。本轮通过 GM 认证、世界／账号／版本／依赖守卫后，只进行只读诊断。

| 检查 | 结果 |
| --- | --- |
| 已安装版本 | 0.1.2，与 checkout 一致 |
| 本地缓存合集索引 | 337 条，3ms；只说明缓存可用 |
| Socket session 用户与 GM 匹配 | true |
| 实际合集索引 RPC | 35,902ms 超时 |
| 缓存中不存在的随机 Actor ID 查询 | 35,902ms 超时 |
| 直接 Socket get 回调 | 35,902ms 超时，无可记录的回调参数 |
| 原生 pack.getDocument | 38,531ms 超时 |
| 客户端错误类别 | 未捕获 |

没有登录 Player1、导入角色、创建 token／场景、修改角色资源或执行 HUD 验收。报告无 `cleanupReason`，流程完成了本次自有 GM 认证连接的原生登出与新匿名页面可选性检查；未对未知会话操作。启动前浏览器清单为空，不能代替结束后进程清单或今后的账号状态证明。

失败阶段是受支持浏览器中的原生文档请求等待回调；不能据此断言请求是否到达服务器或根因在数据库、Node、代理还是客户端。此轮走服务器上的 self-hosted runner，**不是早期 Codex CONNECT 代理 403 的重现**。已停止相同请求重试，也没有因预检失败而直接创建临时文档。

## 更新前的版本守卫（15:40 UTC）

[只测试运行 42244683796](https://github.com/DraculaCradle/bg3-video-hud/actions/runs/42244683796) 于 `2026-11-06T15:40:19.482Z` 输出脱敏报告，模式 `source-inspection`、状态 `failed`。停止原因：

```text
installed-module-version-mismatch:expected=0.1.2;installed=0.1.1
```

GM 认证、精确世界／账号／版本／依赖守卫完成后，测试读取的已安装模组版本仍是 **0.1.1**。发布成功不会自动升级现有 Foundry。为避免拿旧版结果冒充新版验收，流程在这个守卫停止，未进入 SRD／Actor RPC 诊断、Player1 登录、角色导入或 HUD 测试。本次没有调用世界文档写入，没有更改模组文件或配置。

流程结束未报告 `cleanupReason`：本次自有 GM 会话的原生登出及新匿名页面账号可选性检查没有报异常。启动前受限 runner 的浏览器清单为空；未另做结束后的进程清单检查，不把启动前清单作为结束后证明。此前恢复日志检查的历史结果见下文；本轮停在版本守卫，不能声称又检查了日志不存在。

这一轮未进入 RPC 诊断。管理员随后更新到 0.1.2，下一轮已确认版本一致，见上文最新结果。

## 发布与下载验证

- [v0.1.2 Release](https://github.com/DraculaCradle/bg3-video-hud/releases/tag/v0.1.2)，发布提交 `d3ba97f5068d778e1fe79ec240c4a814b2832f75`。
- [发布工作流 42244392838](https://github.com/DraculaCradle/bg3-video-hud/actions/runs/42244392838) 成功；255 项检查通过。
- 公开 `releases/latest/download/module.json` 已实际下载并确认版本 0.1.2；ZIP／manifest／独立安装器按公开 SHA256SUMS 校验通过。ZIP 37 个文件，12 个运行时 JS/CSS 与发布标签一致。
- main [构建 42244291552](https://github.com/DraculaCradle/bg3-video-hud/actions/runs/42244291552) 成功，`deploy-and-test` 明确 skipped。没有开启文件部署，没有停止／重启 Foundry、切换世界或创建第二实例。

## 下一步（仅现有实例）

版本更新、上述日志核查、人工浏览器 SRD 对照及完整 Chromium 对照已完成，**不再要求重新更新模组、重复同一时段的日志检查或重做人工打开操作**。当前下一步为匿名连接交接的只读对照；不要求发送截图、原始日志或账号信息。

人工浏览器能打开只能证明该次读取路径可用，条目仍可能已被缓存；不能据此宣称所有数据库请求正常。若人工浏览器也卡住，则扩大了问题的复现范围，但仍不直接定位根因。结合结果，再选择新的、能区分假设的只读检查；不重复已经失败的同一请求，不自动停用其他模组或改变服务器配置。

获得新的证据并修复障碍后，先确认原生时钟回调恢复，再运行一次 main 的 `ModsTest live tests only`、`world_id=modstest`、`inspect_sources=true`；使用本机路径时必须显式选择 `connection_route=server-loopback` 并再次通过凭据前端点校验。版本一致、无其他会话且真实文档读取正常，才运行 `create_fixtures=true` 完整测试。完整流程会在创建唯一标记临时角色前核对服务器实际 JS/CSS 的 SHA-256，并严格恢复／登出；恢复模式不因版本变化被禁止。

只读诊断或恢复绿色也不能代替 HUD 功能、真实资源消费和第三方组合验收。暂不发起相同 RPC 重试或完整验收。

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
