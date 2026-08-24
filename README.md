# 拾光记

一个手机和电脑都能用的离线优先备忘录。文字、图片和视频会先安全保存在当前设备，登录同步账号后自动上传到阿里云 OSS；每次打开应用都会拉取云端清单并按更新时间合并。

除网页/PWA 外，项目现在还包含 Android、iOS 与 Electron 原生应用壳。应用安装后从桌面图标启动，内部复用同一套网页界面；详见[原生应用构建说明](docs/NATIVE_APPS.md)。

![响应式设计基准](docs/design/shiguang-responsive-concept.png)

## 已实现

- 响应式桌面端与手机端界面，支持安装为 PWA
- Android/iOS Capacitor 应用与 Windows/macOS/Linux Electron 应用
- 文字记录、图片附件、视频附件与本地预览
- 中文语音转文字（手机应用使用原生系统识别，网页/桌面使用 Web Speech API）
- IndexedDB 离线存储，断网可记、联网后补传
- 新内容自动同步，启动时自动检查更新
- 同步账号注册/登录，会话经 AES-256-GCM 加密后写入 HttpOnly Cookie（原生壳另带 Bearer）
- 阿里云 OSS 私有 Bucket 存储、按账号前缀隔离、云端清单合并和附件回读
- 同一条记录以 `updatedAt` 较新版本为准，删除也会同步为墓碑记录

## 本地运行

要求 Node.js 20 以上。

```bash
npm install
copy .env.example .env
npm run dev
```

打开 <http://localhost:5173>。不配置 OSS 也可以完整使用本地记录、附件和语音输入。

生产构建：

```bash
npm run build
npm start
```

生产服务默认运行在 <http://localhost:8787>，同时提供前端静态文件和 `/api` 接口。

## 原生应用

```bash
# Windows/macOS/Linux 开发壳
npm run desktop:dev

# 当前电脑平台安装包
npm run desktop:dist

# 同步 Android/iOS 原生工程
npm run mobile:sync
```

原生安装包必须通过 `VITE_API_BASE_URL` 指向已部署的 HTTPS 后端，才能登录并同步到 OSS。未配置时本地离线记录仍然可用。完整步骤见 [docs/NATIVE_APPS.md](docs/NATIVE_APPS.md)。

## 连接阿里云 OSS

1. 在阿里云创建私有 Bucket，并创建仅授予该 Bucket 读写权限的 RAM 用户 AccessKey（不要用主账号密钥）。
2. 复制 `.env.example` 为 `.env`，填写 `OSS_REGION`、`OSS_BUCKET`、`OSS_ACCESS_KEY_ID`、`OSS_ACCESS_KEY_SECRET` 和 `APP_SECRET`。
3. 生产环境建议设置 `SYNC_INVITE_CODE`，避免公网后端被随意注册。
4. 重启服务，在“设置”中注册或登录同步账号。手机和电脑使用同一账号即可共享记录。

对象实际写在 `{OSS_PREFIX}/{userId}/` 下。`OSS_PREFIX` 默认 `shiguang`。

### 生产环境变量

```dotenv
OSS_REGION=oss-cn-hangzhou
OSS_BUCKET=你的Bucket
OSS_ACCESS_KEY_ID=
OSS_ACCESS_KEY_SECRET=
OSS_PREFIX=shiguang
APP_SECRET=至少32字节的随机字符串
SYNC_INVITE_CODE=可选邀请码
APP_ORIGIN=
PORT=8787
MAX_UPLOAD_MB=512
NODE_ENV=production
```

生产环境必须启用 HTTPS，确保登录 Cookie 以 `Secure` 模式传输。Bucket 保持私有读，不要对公网开放。

本地开发若暂时没有 OSS，可在 `.env` 中设置 `SYNC_STORAGE=fs` 和 `APP_SECRET`，对象会写到 `DATA_DIR/objects`，便于验证登录与同步流程。上线前请删除该变量。

## 数据与同步结构

```text
浏览器 IndexedDB
├── notes             记录元数据与同步状态
├── blobs             图片/视频二进制
└── meta              最近同步时间

阿里云 OSS
└── {prefix}/{userId}/
    ├── .shiguang-manifest-v1.json
    └── shiguang-{noteId}-{attachmentId}.{ext}
```

本地保存永远先于网络同步。打开应用或网络恢复时，会拉取该账号的云端 manifest、按记录 ID 和更新时间合并、上传缺失附件，再覆盖写入新的 manifest。登录会话使用服务端 `APP_SECRET` 通过 AES-256-GCM 加密后存入 HttpOnly Cookie，前端 JavaScript 无法读取明文。

## 浏览器兼容性

- Chrome / Edge：支持语音输入、图片、视频和 PWA。
- Safari / iOS Safari：支持带 `webkitSpeechRecognition` 的系统版本；首次语音输入会请求麦克风权限。
- 不支持 Web Speech API 的浏览器仍可使用其他全部功能，并会显示明确提示。

## 验证

```bash
npm run typecheck
npm test
npm run build
```

项目已在 1440×1000 桌面视口和 390×844 手机视口完成真实浏览器验收，包括文字与图片记录、刷新后持久化、手机端编辑面板、设置状态和控制台错误检查。

## 部署同步后端

原生安装包要登录并同步 OSS，必须先有一个公网 HTTPS 后端。可用 Docker：

```bash
cp .env.example .env
# 填写 OSS 凭证、APP_SECRET，生产建议再填 SYNC_INVITE_CODE
docker compose up -d --build
```

然后在反向代理上启用 HTTPS，并在 GitHub Actions 仓库 Secrets 中设置 `MOMENT_API_URL`。完整步骤见 [docs/NATIVE_APPS.md](docs/NATIVE_APPS.md)。
