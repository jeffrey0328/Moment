# 原生应用构建说明

拾光记现在有三种交付形式，共用同一个 React 界面和同步协议：

| 平台 | 容器 | 工程/入口 | 可交付产物 |
| --- | --- | --- | --- |
| Windows / macOS / Linux | Electron 43 | `desktop/` | `.exe`、`.dmg`、`.AppImage` |
| Android | Capacitor 8 | `android/` | `.apk` / `.aab` |
| iPhone / iPad | Capacitor 8 | `ios/` | Xcode Archive / `.ipa` |
| 浏览器 | PWA | `public/` | 可安装站点 |

## 关键架构

应用界面、IndexedDB 离线数据和附件缓存打包在客户端内。百度 OAuth 和网盘 API 仍由 HTTPS 服务端处理，因为 `BAIDU_SECRET_KEY` 绝不能放进 APK、IPA 或桌面安装包。

```text
Android / iOS / Electron
        │
        ├── 本地打包的 React + IndexedDB
        │
        └── HTTPS → Moment Node API → 百度网盘开放平台
```

OAuth 使用短期、一次性 `native_code` 回跳，不会把百度 access token 放进 URL：

- Electron：`moment://oauth-complete`
- Android/iOS：`com.jeffrey.moment://oauth-complete`

服务端收到 `native_code` 后才为应用 WebView 设置加密 HttpOnly Cookie。一次性代码有效期为 2 分钟，兑换后立即删除。

## 配置同步后端

先把 Node 服务部署到 HTTPS 域名，例如 `https://api.example.com`。服务端使用 `.env.example`；原生前端构建使用：

```dotenv
VITE_API_BASE_URL=https://api.example.com
```

本地手动构建时，可将 `.env.native.example` 复制为 `.env.production`。不配置该值时，安装包仍可离线记录文字、图片、视频和语音，但百度网盘连接按钮会保持未配置状态。

百度开放平台中登记的 OAuth 回调仍然是服务端地址：

```text
https://api.example.com/api/auth/baidu/callback
```

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

Electron 壳启用了 `contextIsolation`、renderer sandbox、`nodeIntegration: false`、`webSecurity: true` 和导航/权限白名单。远程内容只能在独立百度授权窗口中打开。

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

在 Xcode 中选择开发者 Team、真机或 Archive。Info.plist 已包含麦克风、语音识别、相机、相册权限说明以及 OAuth URL Scheme。

## 原生语音输入

- Android/iOS 使用 `@capgo/capacitor-speech-recognition` 8.x，调用系统语音识别服务。
- 网页和 Electron 远程模式使用 Web Speech API。
- 中文语言固定为 `zh-CN`，支持实时转写和标点。

## GitHub Actions 自动产物

仓库的 `Build native apps` 工作流会生成：

- `Moment-Android-APK`：可安装调试 APK
- `Moment-Windows-Installer`：Windows NSIS 安装包

在 GitHub 仓库的 **Settings → Secrets and variables → Actions** 添加 `MOMENT_API_URL`，值为已部署的 HTTPS 后端地址。之后在 **Actions → Build native apps → Run workflow** 运行。发布 `v*` 标签时也会自动构建。
