# 拾光记 (Shiguang Notes)

跨手机与电脑、离线优先的备忘录。React + Vite 前端，Express 后端，可选百度网盘同步。

## Cursor Cloud specific instructions

### 服务概览

单一 Node.js 代码库，开发时并行运行两个进程（由 `npm run dev` 通过 `concurrently` 启动）：

- `web`：Vite 开发服务器，端口 `5173`（页面入口）。`/api` 请求经 `vite.config.ts` 代理到 `8787`。
- `api`：Express 后端，端口 `8787`（`tsx watch server/index.ts`，含热重载）。

### 运行 / 测试 / 构建

标准命令已定义在 `package.json` 的 `scripts` 中，直接使用：

- 开发：`npm run dev`（同时起 web + api）。打开 http://localhost:5173 。
- 测试：`npm test`（`node:test`，仅覆盖后端 `tests/*.test.ts`；无前端单测）。
- 类型检查（本仓无 ESLint，`typecheck` 即 lint 角色）：`npm run typecheck`。
- 构建：`npm run build`（前端产物到 `dist/`，后端编译到 `dist-server/`）。生产运行用 `npm start`（端口 `8787`，同时托管前端静态文件与 `/api`）。

### 非显而易见的注意事项

- 无需任何密钥即可完整开发与测试：不配置百度网盘时，`/api/status` 返回 `configured:false`，但文字/图片/视频记录、IndexedDB 离线存储、语音输入等核心功能均可用。仅“连接百度网盘同步”需要在 `.env` 中填 `BAIDU_APP_KEY` / `BAIDU_SECRET_KEY` / `APP_SECRET` 等。
- `.env` 为可选，被 git 忽略。需要百度同步时执行 `cp .env.example .env` 再填写；缺失 `.env` 不会导致后端报错。
- 端口固定（`5173` / `8787`）；`vite.config.ts` 的 `/api` 代理硬编码指向 `http://localhost:8787`。
- 原生壳（Android / iOS / Electron）在云环境无法运行/构建，仅面向本地打包与 CI；云端只需验证 web + api。
- CI（`.github/workflows/native-build.yml`）在 Node 24 上跑 `npm ci && npm test && npm run typecheck && npm run build`；本环境用 Node 22，上述命令均已验证通过。
