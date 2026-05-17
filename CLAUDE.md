# tokensyber

AI 工具消耗的 token 驱动3D模型生成——你的算力就是燃料。

## 启动

```bash
# 启动游戏页面（任意静态服务器）
python -m http.server 8080
# 访问 http://localhost:8080
# 调试模式: http://localhost:8080/?debug （5K tokens 即完成模型）
```

游戏页面会自动连接 `ws://localhost:3001` 接收 token 数据。确保 TokenSyber VS Code 扩展已安装并激活。

## 架构

```
VS Code 进程（Extension Host）
  │
  ├── TokenSyber 扩展
  │   ├── monkey-patch http/https.request
  │   ├── 拦截 AI API 响应 → 提取 usage tokens
  │   └── WebSocket Server (ws://localhost:3001)
  │       └── 广播 { type: "token-consumed", tokens, totalTokens, timestamp }
  │
  ├── Cline / Continue / Trae / Cursor 等AI扩展
  │   └── 发出 http/https 请求 → 被 patch 拦截 → 透明放行
  │
  ▼
游戏页面 (fuel-client.js)
  └── addTokens() → 进度增长 + 打印机视觉加速
```

## 项目结构

```
index.html           — 单页入口，所有 HTML 结构
css/style.css        — 全部样式，CSS 变量 + 赛博朋克主题
js/
  main.js            — 启动入口，初始化所有模块
  game-state.js      — 核心状态管理（token 驱动进度、localStorage 持久化）
  fuel-client.js     — WebSocket 客户端，接收 token 推送
  printer.js         — 3D 打印视觉效果（裁切面、粒子、光环、fuel-pulse 增强）
  scene.js           — Three.js 场景/相机/渲染器/控制器
  model-manager.js   — 模型清单加载、程序化模型生成、GLTF 加载
  coin-system.js     — 金币掉落、收集动画
  lock-system.js     — 密码锁定/解锁（SHA-256）
  cabinet.js         — 展示柜网格、详情视图、缩略图
  unique-code.js     — 唯一数字资产代码生成
  ui.js              — UI 更新、键盘快捷键、弹窗管理
extension/
  package.json       — VS Code 扩展清单
  tsconfig.json      — TypeScript 配置
  src/
    extension.ts     — 扩展入口，激活/停用 + 状态栏
    interceptor.ts   — monkey-patch http/https，拦截 AI API 响应
    ws-server.ts     — WebSocket 服务端，广播 token 消耗
    token-parser.ts  — 解析 AI 响应中的 usage 字段
models/
  manifest.json      — 模型定义（id, name, rarity）
  characters/        — GLB 模型文件目录
assets/icons/        — 图标
assets/textures/     — 贴图
```

## 核心机制

- **Token 驱动进度**: `progress = accumulatedTokens / COMPLETION_TARGET`
  - 普通模式: 500,000 tokens = 100%
  - 调试模式 (`?debug`): 5,000 tokens = 100%
- **状态持久化**: localStorage，每30秒自动保存 + 页面关闭保存
- **存档版本迁移**: v1 (accumulatedMs) → v2 (accumulatedTokens)，自动迁移
- **模型稀有度**: common 60%, rare 25%, epic 12%, legendary 3%
- **唯一代码**: SHA-256(modelId + timestamp + salt)，格式 `TC-XXXXXXXX-YYYYMMDD-XXXX`

## 关键数据流

1. VS Code 扩展 monkey-patch 拦截 AI API 响应 → 提取 `usage` 字段 → WebSocket 广播
2. fuel-client.js 收到 `token-consumed` → `gameState.addTokens(count)`
3. `printer.js` 每帧读 `getProgress()` (0-1) → 更新裁切面高度
4. token 注入瞬间: 浮动文字 `+N 算力` + 进度条绿色脉冲 + 打印机光环增强

## 开发约定

- **零构建步骤**: 纯 ES modules + CDN (Three.js)，无 npm/bundler（游戏部分）
- **所有状态走 game-state.js**: 不在其他模块直接操作 localStorage
- **CSS 变量**: 颜色/字体/间距统一在 `:root` 中定义
- **事件通信**: 模块间通过 `CustomEvent` 解耦（`fuel-pulse`, `token-consumed`, `print-complete`）

## 扩展开发

```bash
cd extension
npm install
npm run build      # 构建
npm run watch      # 开发模式
```

调试: 在 VS Code 中按 F5 启动扩展开发宿主。

## 待实现

- 多模型 GLB 文件（目前仅程序化几何体）
- 金币购买/交易系统
- 模型稀有度
- 玩家自定义功能：自定义模型和所需token消耗
