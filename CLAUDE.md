# tokensyber

AI 工具消耗的算力驱动 3D 模型生成——你的算力就是燃料。

## 产品定位

玩家使用 AI 工具时产生算力代价，此代价作为游戏燃料驱动 3D 打印机生产模型。深度使用 AI 才能产生优质算力，轻度对话不足以驱动生产。游戏对冲了 AI 使用的成本——即使没有产出有价值结果，算力也不浪费。

## 启动

```bash
# 启动游戏页面（任意静态服务器）
python -m http.server 8080
# 访问 http://localhost:8080
# 调试模式: http://localhost:8080/?debug （5K tokens 即完成模型）
```

游戏页面会自动连接 `ws://127.0.0.1:3001` 接收算力数据。确保 TokenSyber Claude Code 插件已安装。

### 安装插件

在 Claude Code 对话框中粘贴游戏页面提供的提示词即可自动安装，或手动执行：

```bash
# 公网玩家：从 GitHub 远程仓库安装
claude plugins marketplace add yyb1988/tokensyber-plugin
claude plugins install tokensyber@tokensyber-marketplace

# 本地开发：用本机插件目录（开发时调试 hook/server）
claude plugins marketplace add D:/tokensyber/tokensyber-plugin
claude plugins install tokensyber@tokensyber-marketplace
```

在 `~/.claude/settings.json` 中启用：
```json
{ "enabledPlugins": { "tokensyber@tokensyber-marketplace": true } }
```

重启后状态栏显示 `🔥 TokenSyber: N tokens`，表示插件正在工作，token 正在注入游戏。

## 架构

```
Claude Code 会话
  │
  ├─ SessionStart hook → 启动 WebSocket 服务器 (server.cjs)
  │                      → 写入 ~/.tokensyber/server.json (port/pid/startedAt)
  ├─ Stop hook → 解析 transcript JSONL → 计算 token delta
  │              → HTTP /fuel-inject?tokens=N → 广播到游戏端
  └─ SessionEnd hook → 停止服务器 → 清理 server.json

Statusline hook → 读取 server.json (快速端口发现)
                → 读取 state.json + 实时 transcript
                → 查询 /fuel-stats 判断游戏端连接状态
                → 显示 🔥 TokenSyber: N tokens (已连接)
                   或 💨 TokenSyber: 等待连接 (未连接)

                    WebSocket Server (ws://127.0.0.1:3001)
                          │
                          ▼
                 游戏页面 (fuel-client.js)
            addTokens() → 储液罐累积 → 注入打印机 → 模型生成
```

## 项目结构

```
index.html           — 单页入口，所有 HTML 结构
css/style.css        — 全部样式，glitch 调色板（cyan/magenta/amber/gold） + 赛博朋克主题
js/
  main.js            — 启动入口，初始化所有模块
  game-state.js      — 核心状态管理（储液罐、token 注入、localStorage 持久化）
  fuel-client.js     — WebSocket 客户端，接收 token 推送 + 断线重连 + 诊断
  printer.js         — 3D 打印视觉效果（裁切面、粒子、光环、fuel-pulse 增强）
  scene.js           — Three.js 场景/相机/渲染器/控制器/转台旋转
  model-manager.js   — 模型清单加载、GLTF 加载/缓存/克隆、模型归一化
  coin-system.js     — Token 驱动的金币铸造（每 5M tokens 铸造 1 金币，全服池上限 12400）
  stock.js           — 模型库存稀缺系统（common 100 / rare 50 / epic 20 / legendary 5）
  ban-system.js      — Ban 系统：3 个槽位（1/5/10 解锁），ban 单模型或整个分类
  market.js          — 市场系统（阶段 1 MVP）：NPC 黑市求购台，API 形状对齐未来云端
  npc-data.js        — NPC 商人定义 + 价格计算规则
  lock-system.js     — 密码锁定/解锁（SHA-256，模型锁 + 展示柜锁）
  cabinet.js         — 展示柜：分类过滤/排序、网格/紧凑视图、3D 详情、锁定保护
  unique-code.js     — 唯一数字资产代码生成（TC-XXXXXXXX-YYYYMMDD-XXXX）
  ui.js              — UI 控制器：注入循环、按钮事件、键盘快捷键、弹窗管理
tokensyber-plugin/
  .claude-plugin/
    plugin.json      — 插件元数据
    marketplace.json — 本地市场定义
  hooks/
    hooks.json       — Hook 配置（SessionStart/Stop/SessionEnd）
    run-hook.cmd     — 跨平台 Hook 启动器
    session-start    — 启动 WebSocket 服务器，写入 server.json
    stop             — 解析 transcript → 注入 token → 更新 state.json
    session-end      — 停止服务器，清理 server.json
  server/
    server.cjs       — 独立 WebSocket + HTTP 服务器（无 ws 依赖，手写 RFC 6455）
  statusline/
    statusline.js    — 状态栏：读 server.json 快速发现端口 + state.json + 实时 transcript
    statusline       — Unix 启动脚本
    statusline.cmd   — Windows 启动脚本
models/
  manifest.json      — 模型定义（id, name, rarity, category, description, file, displayImage）
  characters/        — GLB 模型文件目录（按 category/id/ 组织）
```

## 主界面布局

```
┌─ #header ────────────────────────────────────────────┐
│ tokensyber(glitch logo)  ⚡累计算力  ★金币  市场 展示柜 │
├─────────────────────────┬───────────────────────────┤
│                         │ #fuel-status (cyan 圆点)   │
│   #viewport-container   │ #fuel-quality-hint         │
│   (flex:2)              │ #fuel-setup (引导卡)        │
│                         │ #tank-section (储液罐)      │
│   ┌─.viewport-top-controls (左上)                    │
│   │  🔊 #btn-sound  🎵 #btn-bgm                      │
│   │                     │ .ban-section               │
│   │  <canvas#three-canvas>  (Three.js 渲染)          │
│   │                     │ .button-group              │
│   │  #click-hint (amber 脉冲)  #loading-overlay      │
│   │                     │   重新生成  锁定           │
│   └─.viewport-footer (底悬浮，半透明黑渐变)          │
│      #model-info (名/稀有度/库存/★pending)           │
│      .progress-section (cyan→magenta 进度条)         │
│                         │ #completion-section        │
├─────────────────────────┴───────────────────────────┤
│                                            (窄屏窗回退为上下分布)
```

- **左右分布**:`#main-content` flex:row,视区 flex:2 撑满左侧,控制栏 flex:1 固定右侧(min 300 / max 380px)
- **3D 视区背景**:由 Three.js 自身渲染,**未加 CSS 装饰层**(无透视网格/全息环/平台扫描线)
- **悬浮控件**:`.viewport-top-controls`(音效/BGM)和 `.viewport-footer`(模型信息+进度条)叠在画布上,`pointer-events: none` 防止吞掉点击事件
- **logo 故障重影**:`.logo::before/::after` 双层品红色 RGB 偏移 + `clip-path` 切片闪动 `@keyframes glitch`,赛博朋克错位效果
- **自动/手动注入按钮**:`.btn-flow/.btn-inject/.btn-stop-inject` 保留原设计风格(未参与 glitch 改造)
- **作用域按钮规则**:glitch 风格按钮仅作用于 `#header`/`#control-panel > .button-group`/`.viewport-footer`/`.viewport-top-controls`,展示柜/市场/弹窗按钮完全不受影响
- **fuel-rate 显示策略**:`#fuel-rate` 仅在 `rate > 0` 时显示,`0/min` 状态自动加 `.hidden` 隐藏
- **响应式**:`@media (max-width: 900px)` 回退为上下分布

## 核心机制

### 储液罐与注入

- AI 算力首先流入储液罐，再由玩家注入打印机
- 自动模式：有模型时持续注入
- 手动模式：玩家点击"注入"/"停止"控制
- 注入速率上限：10,000 tokens/秒

### Token 驱动进度

- `progress = accumulatedTokens / COMPLETION_TARGET`
- 按稀有度消耗算力：common 2000万 / rare 5000万 / epic 1亿 / legendary 2亿
- 调试模式 (`?debug`): 5,000 tokens = 100%（所有稀有度统一）

### 模型稀有度与抽取

- 按权重随机抽取：common 60% / rare 25% / epic 12% / legendary 3%
- 仅从库存 > 0 的模型中抽取

### 库存稀缺系统

- 每个模型有固定库存上限：common 100 / rare 50 / epic 20 / legendary 5
- 玩家收取模型时库存 -1（`consumeStock`）
- 从展示柜删除模型**不返还库存**——世上永久少一只
- 库存归零的模型不再被抽到
- 存储在 `timecyber_stock` localStorage

### 金币系统

- **Token 驱动铸造**：每消耗 5,000,000 tokens 铸造 1 金币（积攒到当前模型）
- **全服金币池**：上限 12,400 枚，池中无币时不再铸造
- **收取到账**：模型完成、玩家收取时金币一次性入账
- **放弃退还**：重新生成时，该模型积攒的金币归还到池
- **用途**：（待定，目前仅作为收藏指标）
- 存储在 `timecyber_coin_pool` localStorage

### 重新生成

- 放弃当前模型，重新随机生成
- 每日 3 次，用完后等待次日恢复（不可用金币购买额外次数）
- 放弃时金币归还到池

### 市场系统（阶段 1 MVP · NPC 黑市求购台）

> 这是金币交易系统的第一阶段。完整三阶段路线（云端化 / 真实玩家市场 / 多算力入口）见 [DEV_LOG.md](DEV_LOG.md)

- 5 个 NPC 商人（ZER0/HELIX/THUNDER/LEVIATHAN/ORACLE）各有偏好，挂出 1-3 张求购单
- 玩家从展示柜中匹配模型卖出 → 模型永久移除（不返还库存）+ 金币入账
- 价格 = 基础价（按稀有度：common 3 / rare 18 / epic 60 / legendary 250）× NPC 系数（0.7-1.4）× 偏好分类 1.2 倍 × ±10% 抖动
- 求购单每 30 分钟全部刷新（`market.js` 内 `REFRESH_INTERVAL_MS`）
- ORACLE 不收 common，只收 rare/epic/legendary 但出价最公道（1.4×）
- 历史记录最近 50 笔（`timecyber_market` localStorage）
- 顶部「市场 (M)」按钮 / M 快捷键打开

**API 形状**（均通过 `market.js` 公开，调用方不应直接读 localStorage）：
- `getNpcDemands()` ⇄ 未来 `GET /market/demands`
- `sellToNpc(demandId, uniqueCode)` ⇄ 未来 `POST /market/orders`
- `getMyHistory()` ⇄ 未来 `GET /market/history`
- `getNextRefreshIn()` / `forceRefresh()` — 客户端定时器，未来由服务端 push 替代

### 模型锁定

- 为当前打印中的模型设置密码保护（SHA-256 哈希）
- 锁定后无法重新生成，需先解锁

### Ban 系统

- 模型生成页面顶部 3 个 Ban 槽位，按展示柜中不同模型数量解锁
- 槽位 1：收集 1 个不同模型解锁，Ban 一个具体模型
- 槽位 2：收集 5 个不同模型解锁，Ban 一个具体模型
- 槽位 3：收集 10 个不同模型解锁，Ban 一个**整个分类**（该分类下所有模型）
- 被 Ban 的目标不再被随机生成；可随时点击重新选择 ban 什么，也可清空
- 两个模型槽位不能 ban 同一个模型
- 删除展示柜模型会减少"不同模型"计数；若使某槽位回到未解锁状态，已 ban 的目标会保留但不可再编辑
- 全部模型都被 Ban 时显示提示并要求清空一个槽位
- 存储在 `timecyber_bans` localStorage：`{ modelBans: [id1, id2], categoryBan: code }`

### 展示柜锁定

- 可为整个展示柜设置密码，锁定后禁止删除任何模型
- 与模型锁定共用密码输入弹窗，密码独立存储

### 唯一代码

- SHA-256(modelId + timestamp + salt)，格式 `TC-XXXXXXXX-YYYYMMDD-XXXX`
- 每个收取的模型生成唯一数字资产代码

### 状态持久化

- localStorage，每 30 秒自动保存 + 页面关闭保存
- 状态版本 v7，含 v1→v7 迁移链（`accumulatedMs→accumulatedTokens`、`+tank`、`+extraction`、`+totalInjected`、`+cabinetLock`、`+rarity`）

### 断线不计数

- 游戏页面断开时，服务端不累加 token，状态栏停止增长

### 网络连接

- 所有连接使用 `127.0.0.1`（避免 Windows 上 `localhost` 解析为 IPv6 导致连接失败）
- 服务端监听 `0.0.0.0`，端口自动选择 3001-3010

## 关键数据流

1. Claude Code 对话产生 token → Stop hook 解析 transcript JSONL
2. 计算 delta（本次新增 token）→ HTTP `/fuel-inject?tokens=N`
3. 服务器仅在**有游戏客户端连接时**累加 `totalTokens`
4. WebSocket 广播 `token-consumed` → fuel-client.js → `gameState.addTokens(count)`
5. `addTokens()` 写入储液罐 + 累计 `totalInjected`
6. 注入循环以 10K/s 速率将储液罐余额注入 `accumulatedTokens`
7. 注入循环每帧调用 `coin-system.tickAccumulated()` 铸造金币
8. `printer.js` 每帧读 `getProgress()` (0-1) → 更新裁切面高度 + 粒子效果
9. 模型完成 → 自动停止注入 → 储液罐继续存储 → 玩家收取 → 库存 -1 → 金币入账 → 自动重新生成

## WebSocket 协议

### 服务端 → 客户端

| 类型 | 字段 | 触发 |
|------|------|------|
| `connected` | `message`, `stats: {totalTokens, totalRequests}` | 客户端连接时 |
| `token-consumed` | `tokens`, `totalTokens`, `timestamp` | Stop hook 注入 token |
| `pong` | (无) | 心跳响应 |

### 客户端 → 服务端

| 类型 | 用途 |
|------|------|
| `ping` | 心跳（每30秒） |

## HTTP 端点

| 路径 | 响应 |
|------|------|
| `GET /fuel-stats` | `{totalTokens, totalRequests, clients, port}` |
| `GET /fuel-port` | `{port, server: 'tokensyber'}` |
| `GET /fuel-inject?tokens=N` | `{ok, tokens, totalTokens, clients}` |

## localStorage 结构

**`timecyber_state` (v7):**
```json
{
  "version": 7,
  "currentPrint": {
    "modelId": "string | null",
    "rarity": "common|rare|epic|legendary | null",
    "accumulatedTokens": 0,
    "isLocked": false,
    "lockPasswordHash": "SHA-256 hex | null"
  },
  "tank": { "balance": 0, "flowMode": "auto" },
  "totalInjected": 0,
  "coins": { "balance": 0, "totalEarned": 0 },
  "cabinetLock": { "isLocked": false, "passwordHash": "SHA-256 hex | null" },
  "regeneration": { "dailyCount": 0, "lastResetDate": null },
  "extraction": { "dailyCount": 0, "lastResetDate": null },
  "settings": { "soundEnabled": true, "quality": "high" }
}
```

**`timecyber_cabinet`** (最多20条，最新在前):
```json
[{
  "modelId": "string",
  "uniqueCode": "TC-XXXXXXXX-YYYYMMDD-XXXX",
  "completedAt": 0,
  "thumbnail": "data:image/jpeg;base64,...",
  "printDuration": 0,
  "name": "string",
  "rarity": "common|rare|epic|legendary",
  "description": "string",
  "serialNumber": 1,
  "seriesCap": 100,
  "displayImage": "models/characters/.../display image-xxx.jpg"
}]
```

**`timecyber_coin_pool`**: 整数字符串，剩余可铸造金币数（上限 12400）

**`timecyber_stock`**: `{ [modelId]: remainingCount }`，每模型剩余库存

**`timecyber_bans`**: `{ modelBans: [id|null, id|null], categoryBan: code|null }`，Ban 槽位状态

**`timecyber_market`**: `{ version, npc_demands: [{id, npcId, modelId, price, expiresAt}], history: [{id, type, npcId, modelId, modelName, rarity, uniqueCode, price, timestamp}], last_refresh, next_id }`，市场（阶段 1 MVP）

**`timecyber_cabinet_prefs`**: `{ category: "all", view: "grid", sort: "desc" }`，展示柜偏好

## 插件状态文件 (~/.tokensyber/)

**`state.json`:**
```json
{
  "injectedTokens": 0,
  "lastTokens": 0,
  "lastTranscript": "path/to/transcript.jsonl"
}
```

**`server.json`** (服务器运行时):
```json
{
  "port": 3001,
  "pid": 12345,
  "startedAt": 1700000000000
}
```

**`server.pid`**: 服务器进程 PID

**`server.log`**: 服务器 stdout/stderr

## 状态栏连接检测

状态栏通过以下策略判断游戏端是否连接：

1. **快速路径**：读取 `~/.tokensyber/server.json` 获取端口号，验证 PID 存活，直接查询该端口的 `/fuel-stats`
2. **扫描回退**：若 `server.json` 不存在或 PID 已死，逐端口查询 `/fuel-stats`，对响应端口用 `/fuel-port` 验证 `server === 'tokensyber'`
3. **显示逻辑**：`clients > 0` 显示 `🔥 TokenSyber: N tokens` 或 `🔥 TokenSyber: 等待对话`；否则显示 `💨 TokenSyber: 等待连接`

## CustomEvent 通信

| 事件名 | 发出方 | 接收方 | detail |
|--------|--------|--------|--------|
| `fuel-pulse` | `ui.js` (注入循环) | `printer.js` | `{ tokens: number }` |
| `print-complete` | `printer.js` | `ui.js` | 无 |

## 开发约定

- **零构建步骤**: 纯 ES modules + CDN (Three.js r169)，无 npm/bundler（游戏部分）
- **所有状态走 game-state.js**: 不在其他模块直接操作 localStorage（stock.js、coin-system.js 例外，因它们管理独立的 localStorage 键）
- **CSS 变量**: 颜色/字体/间距统一在 `:root` 中定义
- **事件通信**: 模块间通过 `CustomEvent` 解耦（`fuel-pulse`, `print-complete`）
- **IPv4 强制**: 所有 HTTP/WebSocket 连接使用 `127.0.0.1`，不用 `localhost`

## 快捷键

| 按键 | 功能 |
|------|------|
| R | 重新生成 |
| L | 锁定/解锁模型 |
| C | 展示柜 |
| M | 市场（NPC 黑市求购台） |
| Space | 显示当前模型已积攒的金币（金币随模型收取自动到账） |
| F | 重置视角 |
| WASD | 旋转视角 |
| QE | 缩放 |

## 模型清单 (29 个，7 分类)

| 分类 | 代码 | 模型数 | 稀有度分布 |
|------|------|--------|-----------|
| 人形兵装 | hm | 7 | common×4, rare×2, epic×1 |
| 节肢机兽 | art | 5 | common×3, rare×1, epic×1 |
| 蛇形机体 | ser | 2 | common×2 |
| 飞行器 | aer | 5 | common×3, rare×2 |
| 水生机体 | aq | 3 | common×2, rare×1 |
| 生化融合体 | bio | 4 | common×2, rare×1, epic×1 |
| 巨构体 | mega | 3 | common×2, rare×1 |

## 待实现

> 完整的多阶段路线（云端化、账号系统、真实玩家市场、Codex/Cursor 接入）见 [DEV_LOG.md](DEV_LOG.md)

- **模型统一制作要点**
  - 格式：`.glb` (glTF 2.0)
  - 面数：common≤3K / rare≤5K / epic≤8K / legendary≤12K
  - 材质：PBR Metallic-Roughness，纹理尺寸 common 512 / rare+epic 1024 / legendary 2048
  - 原点：底部中心，Y 轴向上，正面朝 +Z
  - 风格：赛博朋克废土，低饱和主色 + 高饱和点缀，稀有度越高磨损越少发光越多
  - 打印揭示：视觉复杂度从底到顶递增，epic/legendary 最震撼元素在最高点
  - 模型下半部 1/3 避免大面积绿色（打印粒子区域色冲突）
  - 禁止：骨骼动画、相机灯光节点、纯色无细节平面、重叠面
  - 命名：`models/characters/{category}/{id}/{id}.glb`
- 金币购买/交易系统
- 玩家自定义功能：自定义模型和所需 token 消耗
