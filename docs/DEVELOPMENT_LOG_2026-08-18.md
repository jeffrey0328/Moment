# Moment 开发日志（2026-08-18）

## 今日目标

把现有响应式备忘录从“只能通过浏览器访问”升级为手机、电脑均可从应用图标打开的安装式应用。界面仍复用同一套 React 网页，但资源随安装包提供，不依赖浏览器入口。

## 当前代码与 Git 状态

- 仓库：`https://github.com/jeffrey0328/Moment`（公开）
- 默认分支：`main`
- 开发分支：`agent/native-apps`
- 草稿 PR：`https://github.com/jeffrey0328/Moment/pull/1`
- 当前最新提交：`bdd4529 fix Android CI script permissions`
- 前置提交：
  - `72f9697 build native apps on pull requests`
  - `4e850bd add native mobile and desktop apps`
- 2026-08-18 停工时，本地分支已与 `origin/agent/native-apps` 同步，工作区干净。

## 已完成

### 应用形态

- 手机：使用 Capacitor 8，已生成 Android 与 iOS 原生工程。
- 电脑：使用 Electron 43，支持 Windows、macOS、Linux 打包配置。
- 网页/PWA：继续保留，React 界面由三种形态共用。
- 桌面应用使用自定义 `moment-app://app` 安全协议读取安装包内的前端资源。

### 输入与内容

- 文字、图片、视频记录沿用现有功能。
- Android/iOS 应用接入 `@capgo/capacitor-speech-recognition` 原生语音识别。
- Web/Electron 保留 Web Speech API 语音输入分支。
- 已加入手机麦克风、语音识别、相机和相册权限描述。

### 百度网盘同步

- 客户端支持通过 `VITE_API_BASE_URL` 连接独立 HTTPS 后端。
- 百度应用密钥只保存在服务端，不能打进手机或桌面安装包。
- 已增加 Capacitor 与 Electron 的 OAuth 应用回跳。
- OAuth 回调使用两分钟有效、仅可兑换一次的临时码，避免把网盘令牌暴露在 URL 中。
- 服务端已加入应用协议 CORS 白名单、跨域 Cookie 和原生会话兑换接口。
- 新增环境变量示例：`.env.native.example` 与更新后的 `.env.example`。

### 安全与工程化

- Electron 已关闭 Node 集成并启用上下文隔离、沙箱与导航白名单。
- 增加 CSP、应用图标、Android/iOS 启动图。
- 增加 GitHub Actions：在 PR 中并行构建 Android 调试 APK 与 Windows NSIS 安装程序。
- 原生应用构建说明：`docs/NATIVE_APPS.md`。

## 已验证

- `npm run typecheck`：通过。
- `npm run build`：通过。
- `npx cap sync`：Android 与 iOS 同步成功，识别到 3 个原生插件。
- Electron 壳：本地解包启动冒烟测试通过。
- 浏览器界面：
  - 桌面尺寸 `1280 × 820`：保存文字成功，控制台无错误。
  - 手机尺寸 `390 × 844`：设置页和响应式布局正常，控制台无错误。
- 生产依赖审计曾通过，结果为 0 个漏洞；最后一次重跑因沙箱网络限制未能连接 npm registry，不是代码失败。
- 本机没有 Android SDK，因此本地 Gradle 构建未完成；已改由 GitHub Actions 构建。

## CI 当前状态与已知问题

第一次原生构建运行：

- 地址：`https://github.com/jeffrey0328/Moment/actions/runs/32132826939`
- Android 第一次失败：`./gradlew` 在 Linux 上退出码 126，属于执行权限问题。
- 已在提交 `bdd4529` 中修复：工作流先执行 `chmod +x ./gradlew`，并将 Git 文件模式设为可执行。
- 推送 `bdd4529` 会触发新的 PR 构建。今天停工前没有继续等待新构建结果。
- Windows 第一次构建在停止跟踪时仍在运行；明天直接查看 Actions 最新运行即可，不要假定已成功。

## 明天快速启动

在 `E:\Git_Clone\Moment` 打开终端后：

```powershell
git switch agent/native-apps
git status -sb
git pull --ff-only
gh run list --repo jeffrey0328/Moment --branch agent/native-apps --limit 5
```

然后按顺序处理：

1. 打开 PR 1 的最新 GitHub Actions 运行，确认 Android APK 与 Windows Installer 两个任务结果。
2. 若失败，使用下面命令读取失败日志：

   ```powershell
   gh run view <RUN_ID> --repo jeffrey0328/Moment --log-failed
   ```

3. 修复 CI 后提交并推送，PR 会自动重建。
4. 两个平台成功后，从 Actions 下载：
   - `Moment-Android-APK`
   - `Moment-Windows-Installer`
5. 在真机/真实电脑安装并验证：启动、语音输入、图片选择、视频选择、离线保存。
6. 部署 HTTPS 后端，并在 GitHub 仓库 Secrets 中设置 `MOMENT_API_URL`；否则安装包只能使用本地记录，百度网盘登录与同步会显示未配置。
7. 在百度开放平台把服务端 OAuth 回调地址设为：

   ```text
   https://<后端域名>/api/auth/baidu/callback
   ```

8. 用真实百度账号验证首次授权、自动上传、重新打开自动拉取和多端更新。
9. 全部通过后将 PR 从 Draft 改为 Ready，再合并到 `main`。

## 部署后端所需环境变量

```text
BAIDU_API_KEY=
BAIDU_SECRET_KEY=
BAIDU_REDIRECT_URI=https://<后端域名>/api/auth/baidu/callback
SESSION_SECRET=<至少 32 字节随机值>
APP_ORIGIN=https://<网页前端域名>
NATIVE_CORS_ORIGINS=moment-app://app,capacitor://localhost,https://localhost
```

GitHub Actions 仓库 Secret：

```text
MOMENT_API_URL=https://<后端域名>
```

## 尚未完成/不可省略

- 还没有部署可公网访问的 HTTPS 后端，因此百度网盘同步尚不能在安装包中进行端到端实测。
- Android 当前生成的是 debug APK；正式上架需要 release keystore 与 AAB。
- Windows 安装程序未签名，系统可能显示未知发布者提示。
- iOS 必须在 macOS/Xcode 上配置 Apple Developer 签名后构建和分发。
- 原生临时 OAuth 会话目前保存在单个 Node 进程内存中；若后端多实例部署，应迁移到 Redis 或配置粘性会话。

## 关键文件

- `capacitor.config.ts`：手机应用配置。
- `android/`、`ios/`：原生工程。
- `desktop/main.cjs`、`desktop/preload.cjs`：Electron 应用壳。
- `src/lib/native.ts`：原生 OAuth 回跳与会话兑换。
- `src/lib/api.ts`：应用后端地址处理。
- `src/components/Composer.tsx`：原生/Web 语音输入。
- `server/auth.ts`、`server/index.ts`：OAuth、Cookie、CORS 与原生会话接口。
- `.github/workflows/native-build.yml`：安装包自动构建。
- `docs/NATIVE_APPS.md`：日常构建和打包说明。
