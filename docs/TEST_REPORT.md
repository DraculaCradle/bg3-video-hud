# 自动检查报告 — 2026-11-06

范围：当前中文自适应 HUD 与视频功能补齐开发版本。测试在开发环境和本地 Chromium 中使用原创模拟文档执行，未连接线上 Foundry。稳定 Release 仍为 v0.1.1。

| 检查 | 结果 | 证据边界 |
| --- | --- | --- |
| npm run check | 通过，40 个 JS 文件及 manifest/资源路径 | 静态检查 |
| npm test | 97 通过 | 分组／权限／布局、原生调用配置、来源 schema、一次消费／顺序射线、暴击／取消／最终升环／上下文守卫，使用文档替身 |
| npm run test:browser | 91 通过，固定 Chrome 158；Chrome 155 验证见 CI／日志 | 真实 Chromium DOM/CSS/输入，模拟 Foundry API |
| npm run test:deploy | 22 通过 | 临时目录实际安装、备份／原子更新／失败回滚 |
| npm run test:modstest-deploy | 44 通过 | 共享实例配置、安全守卫与事务恢复 |
| npm run package | 通过 | ZIP 根 manifest、所有传递 JS 导入、独立安装器 |
| SHA256SUMS | 通过 | 本地 ZIP／manifest／安装器完整性 |
| Playwright discovery | 通过 | 仅列出用例，无服务器登录 |
| 五档截图／尺寸 | 通过，原创模拟素材 | 1280×720、1366×768、1920×1080、2560×1440、3840×2160；另有五张功能面板截图 |

共 **254 项自动检查**，不将静态／打包／发现计入用例数。Chromium 检查包含有效 CSS 视口／DPR 模型、真实键盘／鼠标／滚轮、少空间下可达性、焦点与滚动保留，以及搜索／草稿取消／重复排序、来源 UI、说明卡 XSS 与隐私、原生唯一调用、范围坐标、VFX 清理与 AA 避让。它们不等于操作真实硬件缩放或通过 Foundry 联机规则验收。

本次保持自动部署关闭；没有发布新 Release、访问线上账号、修改服务器文件、重启／停止 Foundry、切换世界或创建第二实例。实机读取的既有阻碍是测试客户端未收到原生文档 RPC 回调，不能将缓存索引成功或离线测试绿色记为已解决；历史证据和未完成项见[实机报告](MODSTEST_LIVE_REPORT.md)。

功能使用、预览和具体边界见[视频功能说明](COMPLETE_HUD.md)、[目标说明](TARGETING.md)及[人工验收](MANUAL_TESTS.md)。恢复实际测试时只使用现有 ModsTest、专用账号与唯一标记临时数据，按恢复日志还原并确认登出；不踢未知会话。
