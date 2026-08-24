# 原生应用构建说明

拾光记现在有三种交付形式，共用同一个 React 界面和同步协议：

| 平台 | 容器 | 工程/入口 | 可交付产物 |
| --- | --- | --- | --- |
| Windows / macOS / Linux | Electron 43 | `desktop/` | `.exe`、`.dmg`、`.AppImage` |
| Android | Capacitor 8 | `android/` | `.apk` / `.aab` |
| iPhone / iPad | Capacitor 8 | `ios/` | Xcode Archive / `.ipa` |
| 浏览器 | PWA | `public/` | 可安装站点 |

## 关键架构

应用界面、IndexedDB 离线数据和附件缓存打包在客户端内。账号登录和阿里云 OSS 访问仍由 HTTPS 服务端处理，因为 `OSS_ACCESS_KEY_SECRET` 绝不能放进 APK、IPA 或桌面安装包。

```text
Android / iOS / Electron
        │
        ├── 本地打包的 React + IndexedDB
        │
        └── HTTPS → Moment Node API → 阿里云 OSS
```

登录在应用内完成，不打开第三方 OAuth 窗口。服务端把会话加密后交给应用：优先尝试 HttpOnly Cookie；Android WebView 可能拦截跨站 Cookie，因此原生客户端还会保存加密 Session，并在请求中带 `Authorization: Bearer`。账号表写在 `DATA_DIR`（默认 `./data`）。多实例部署请把该目录放到共享卷。

## 配置同步后端

先把 Node 服务部署到 HTTPS 域名，例如 `https://api.example.com`。最快的方式是 Docker：

```bash
cp .env.example .env
# 填写 OSS_REGION、OSS_BUCKET、OSS_ACCESS_KEY_ID、OSS_ACCESS_KEY_SECRET、APP_SECRET
# 生产环境设置：
# NODE_ENV=production
# APP_ORIGIN=https://你的网页域名
# SYNC_INVITE_CODE=随机邀请码
docker compose up -d --build
```

前面需要一层 HTTPS 反向代理（Caddy、Nginx 或云平台自带证书）指向 `127.0.0.1:8787`。健康检查地址是 `/api/health`。

服务端使用 `.env.example`；原生前端构建使用：

```dotenv
VITE_API_BASE_URL=https://api.example.com
```

本地手动构建时，可将 `.env.native.example` 复制为 `.env.production`。不配置该值时，安装包仍可离线记录文字、图片、视频和语音，但同步登录会保持未配置状态。

Bucket 请设为私有。对象路径为 `{OSS_PREFIX}/{userId}/`，不同账号互相隔离。

## Windows / macOS / Linux

开发模式：

```bash
npm run desktop:dev
```

当前系统安装包：

```bash
npm run desktop:dist
```

仅生成未压缩应用目录：

```bash
npm run desktop:pack
```

Electron 壳启用了 `contextIsolation`、renderer sandbox、`nodeIntegration: false`、`webSecurity: true` 和导航/权限白名单。同步登录在应用窗口内完成。

跨系统产物需要在对应系统构建。对外分发前应配置 Windows Authenticode 和 Apple Developer ID 签名，否则系统会显示“未知发布者”。

## Android

要求 Android Studio、Android SDK 和 JDK 21：

```bash
npm run mobile:sync
cd android
./gradlew assembleDebug
```

APK 输出：

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

正式上架 Google Play 时需要生成并保管 release keystore，然后构建 `.aab`。推送代码后，可由 GitHub Actions 自动生成调试 APK，供直接安装测试。

## iPhone / iPad

iOS 只能在 macOS + Xcode 上编译和签名：

```bash
npm run mobile:sync
npm run ios:open
```

在 Xcode 中选择开发者 Team、真机或 Archive。Info.plist 已包含麦克风、语音识别、相机、相册权限说明。

## 原生语音输入

- Android/iOS 使用 `@capgo/capacitor-speech-recognition` 8.x，调用系统语音识别服务。
- 网页和 Electron 远程模式使用 Web Speech API。
- 中文语言固定为 `zh-CN`，支持实时转写和标点。

## GitHub Actions 自动产物

仓库的 `Build native apps` 工作流会生成：

- `Moment-Android-APK`：可安装调试 APK
- `Moment-Windows-Installer`：Windows NSIS 安装包

在 GitHub 仓库的 **Settings → Secrets and variables → Actions** 添加 `MOMENT_API_URL`，值为已部署的 HTTPS 后端地址。之后推送到 `main`、打开 PR、发布 `v*` 标签，或在 **Actions → Build native apps → Run workflow** 手动运行，都会构建安装包。
