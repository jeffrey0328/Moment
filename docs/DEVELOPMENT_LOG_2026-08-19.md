# Moment 开发日志（2026-08-19）

## 对照上次记录

上次停工记录见 `docs/DEVELOPMENT_LOG_2026-08-18.md`。今天先核对仓库和 GitHub，再继续未完成项。

### 上次留下的事项

1. 查看 PR 1 的 Android / Windows CI 结果
2. 失败则修 CI
3. 下载安装包并在真机验证
4. 部署 HTTPS 后端，并设置仓库 Secret `MOMENT_API_URL`
5. 在百度开放平台登记 OAuth 回调
6. 用真实百度账号做端到端同步
7. PR 1 改 Ready 后合并
8. 原生 `native_code` 会话当时在进程内存里，多实例会丢

### 今天核对到的现状

- PR 1 已由仓库所有者合并到 `main`（`944f6f0`）。
- 修复 `gradlew` 权限后的构建已成功：
  - 运行：https://github.com/jeffrey0328/Moment/actions/runs/32134635963
  - `Android APK` 成功，产物 `Moment-Android-APK`
  - `Windows installer` 成功，产物 `Moment-Windows-Installer`
- 再后一次运行被取消，不影响已成功的产物。
- 仓库没有 GitHub Issues，也还没有 `MOMENT_API_URL` Secret。
- 开发日志里的 `BAIDU_API_KEY` / `SESSION_SECRET` 与代码不符；代码使用 `BAIDU_APP_KEY` / `APP_SECRET`。

## 今日继续完成

- 原生一次性授权会话改为写入 `DATA_DIR/native-sessions.json`，进程重启不再丢掉正在兑换的 `native_code`。
- 原生客户端增加加密 Session + `Authorization: Bearer`，避免 Android WebView 拦截跨站 Cookie 后无法同步。
- 修正 Capacitor Android（`https://localhost`）在未配置 `VITE_API_BASE_URL` 时被误判为“已有后端”。
- 增加 `/api/health`、Dockerfile、`docker-compose.yml`，方便部署 HTTPS 反向代理后的同步后端。
- GitHub Actions：`main` 推送也会构建；升级到 checkout/setup-node/setup-java/upload-artifact 的 v5；增加 typecheck + 测试门禁。
- 增加 `mergeNotes`、磁盘会话和 Bearer 读取的单元测试。

## 仍需你本机完成（云端无法代替）

这些依赖你的百度开放平台账号、域名证书和真机，所以没有在这次提交里“做完”：

1. 把后端部署到公网 HTTPS（可用 `docker compose up -d --build`，前面加 Caddy/Nginx 证书）。
2. 百度开放平台回调填：`https://<后端域名>/api/auth/baidu/callback`。
3. GitHub 仓库 Secrets 设置 `MOMENT_API_URL=https://<后端域名>`，然后手动或推送触发 **Build native apps**，再下载 APK / Windows 安装包。
4. 真机验证：启动、语音、图片、视频、离线保存，以及授权、自动上传、重新打开拉取。
5. Android 正式上架需要 release keystore 与 AAB；Windows 未签名会提示未知发布者；iOS 仍需 macOS + Xcode 签名。
6. 若后端会跑多个实例，请把 `DATA_DIR` 放到共享卷，或配置粘性会话。
