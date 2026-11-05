# 自动部署续作报告 — 2026-11-05（香港时间）

本次交付 GitHub Actions 自动构建、ModsTest 独立实例部署事务、Playwright 实机测试代码和两侧配置步骤。**没有远程安装模组、停止服务器、修改世界、使用真实账号登录或执行实机验收。** 用户确认 Environment、runner 和 Secrets 尚未配置；开发与本地验证已继续完成。

## 远程提交核对

通过 GitHub connector 查询并通过随后成功的 git fetch 核验：

- `feat/issue-1-video-hud-mvp` 的分支头为 `43caea50e5b5b626563ce38fef51927df8aafa24`。
- `main` 为 `5b0bbf5f774d9d9fe0ed17c456dab59a50ac66ef`，不包含上述实现。
- 前次测试代码、`tools/deploy_linux.py`、CI/Release 工作流和 `docs/TEST_REPORT.md` 都在远程 feature 分支。本次以 `43caea5` 为父提交继续开发，没有以旧 `main` 覆盖已有实现。

## 当前网络配置与 curl 证据

当前任务实例状态为 connected/running，`observations_current=true`，spec revision 与 observed revision 均为 1，HTTP 策略为 **unrestricted / enforced**。执行器 `/etc/codex/network-policy.json` 同样显示 unrestricted，`vpn_configured=false`，无额外 TCP 目标授权；HTTP 出站沿用 `http://proxy:8080`。环境没有配置任何部署密码、运行时变量或出站身份。

最初在默认命令沙箱中的 curl 返回 7（连接代理失败），同时本地浏览器 fixture 监听也被 EPERM 拒绝，证明命令沙箱网络限制会干扰诊断。该结果不能代表代理或目标服务器的实际状态。按任务授权启用该执行命令的网络访问后，保留代理与 TLS 校验重新检测，结果如下；这不是绕过代理或重复已确认的 403。

| 请求与阶段 | 观察到的结果 | 判断 |
| --- | --- | --- |
| `curl -v https://redmagic.club/`，19:31:17 | `CONNECT redmagic.club:443` → `HTTP/1.1 200 OK`，`server: envoy` | 先前 CONNECT 403 未复现，代理准许隧道 |
| 同次请求 TLS | TLS 1.3；SAN 匹配 redmagic.club；SSL certificate verify ok；证书链显示 OpenAI 出站检查 | TLS 验证成功，未关闭证书校验 |
| 同次请求 GET `/`，19:31:22 | `HTTP/2 503`，`server: envoy`，`content-type: text/plain`，`content-length: 91` | 失败发生于 GET 发出之后，非 CONNECT 阶段 |
| 同次响应体 | `upstream connect error or disconnect/reset before headers. reset reason: connection timeout` | Envoy 报告上游连接超时；无法仅凭该头确定具体哪一层 Envoy，更不能声称目标返回了 403 |
| 后续检查 `curl -v https://redmagic.club/join`，19:32:03 | CONNECT 200、TLS 校验成功、`HTTP/2 200`；`x-powered-by: Express`、`cache-control: no-cache`、`content-type: text/html; charset=utf-8`、`content-length: 2609`、`x-frame-options: DENY`、`x-envoy-upstream-service-time: 1606`、`server: envoy` | 当前 Foundry 登录入口可达 |
| 登录页公开信息 | `<title>ModsTest</title>`，`Version 14 Build 369` | 可确认世界标题和 Foundry 构建；不能确认账号权限、D&D5e 版本或已启用模组 |

curl 两次实际网络探测的退出码均为 0，因为未使用 `--fail`；根路径仍收到了 HTTP 503，不能将退出码 0 解释为应用成功。认证 Cookie 与会话标识不纳入报告。没有重复请求已确认的代理拒绝，也没有更改路由、取消代理或关闭 TLS 校验。

## 已执行的本地验证

| 检查 | 结果与边界 |
| --- | --- |
| `npm run check` | 清单、前端路径和 JS 语法通过 |
| `npm test` | **23 通过**：原有 22 项，新增报告脱敏及空测试不误报通过的测试 |
| `npm run test:browser` | **31 通过**：真实本地 Chromium + Foundry API fixtures；不是服务器实机验收 |
| `npm run test:deploy` | **22 通过**：原有部署器临时目录与故障注入 |
| `npm run test:modstest-deploy` | **16 通过**：真实临时文件系统中的切换、服务/浏览器失败、信号、回滚失败、持久化恢复、备份损坏、并发锁、固定链接、初始化及拒绝覆盖基线 |
| e2e `npm ci` 与 `playwright test --list` | 固定依赖安装成功，发现 1 个同时覆盖两角色的实机场景；**仅加载与发现，不执行登录测试** |
| Python、shell 和 e2e JS 语法 | 通过 |
| actionlint 1.7.7 | 三个工作流通过；已声明专用 runner 的 `modstest` 标签 |
| `npm run package` 和 `dist/SHA256SUMS` | 通过；可安装 ZIP 不包含账号、测试数据或 node_modules |
| `git diff --check` | 通过 |
| GitHub 托管 CI | 提交 `60d287a` 的 [Validate module #5](https://github.com/DraculaCradle/bg3-video-hud/actions/runs/42021446537) 已完成且 success；包含测试、实机场景发现与打包，不包含服务器登录 |

执行过的本地自动化测试合计 **92 通过，0 失败**，其中 Playwright 的服务器场景不计入通过数。首次默认沙箱内的 Chromium 运行因 loopback EPERM 未执行；启用命令网络权限后完整运行得到上述 31 项通过。

提交后 push CI 已通过；随后一次 PR CI 在 Chromium DevTools 的原有 10 秒启动等待处超时，未执行浏览器断言。该次 runner 使用滚动的 Ubuntu 26.04 镜像，日志没有保留 Chrome 的退出信息，因此不能确定 Chrome 未就绪的具体原因。本次改为固定 Ubuntu 24.04、允许 30 秒启动时间、浏览器提前退出时立即报错并保留有界启动诊断，同时要求完整收到 DevTools 地址后才连接；没有通过自动重跑隐藏失败。

## 工作流及验收边界

自动部署只在 `main`、repository variable `MODS_TEST_ENABLED=true`、`modstest` Environment 和专用 runner 同时就绪后执行。构建 job 和部署 job 使用同次运行、同一提交的带校验产物；PR 代码不会送往服务器 runner。模组备份、服务停启、原子指针更新、两会话实机检查和失败回滚在一笔持锁事务中完成；中断恢复日志保留至旧版本重新通过健康检查。

Playwright 实机场景会登录 Gamemaster 和 Player1、验证世界及版本、切换角色、核对 HP/AC、验证真实 socket 资源同步、法术层级过滤、快捷栏持久性和排序、原 HUD 恢复，以及临时字段恢复。公开 `/join` 可达不等于这些项目通过。

| 实机项目 | 本次状态 |
| --- | --- |
| ModsTest 模组部署及回滚演练 | **未执行**：尚无独立实例部署配置和 runner |
| Gamemaster / Player1 登录与 HUD 验收 | **未执行**：尚无测试 Secrets；未索取或生成真实密码 |
| GitHub 托管构建和自动化 CI | **已通过**；见上面的运行链接 |
| GitHub Actions 服务器部署与实机工作流 | **未执行**：需先配置、合并与启用 |
| 官方施法扣槽、pact、专注、模板、休息和聊天卡 | **未执行**；仍在手工验收范围，资源同步断言不替代官方施法消耗验证 |

GitHub 和 Linux 分别需要执行的具体操作、账号权限、两个 Secret 名称、fixture 要求和恢复命令，见 [MODSTEST_SETUP.md](MODSTEST_SETUP.md)。
