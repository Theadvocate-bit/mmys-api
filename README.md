# mmys_api

猫猫影视（maomao / mmys）App 抓包分析的中转 API。

对已收录片目（每部片抓一次详情包即可入库），实现 **选片 → 选源/选集 → 实时调 `parse_api` → JSON / 302 新鲜直链** 的中转能力。

**双形态**：Python 本地开发版（`app.py`，JSON 文件存储）+ EdgeOne Makers 部署版（`edge-functions/`，Turso SQLite 持久化）。两者 API 契约完全一致。

## 背景

猫猫影视 App 后端把「片库、每集播放 token、解析服务器配置」一次性在详情响应里下发：

- **后端**：`23.225.47.20:3211/maomao.php/v7/logs`（伪装成日志接口的内容 API）
- **解析服务器**：`202.189.6.83:12991/xx/`（7 条线路：`bt.php` / `mtbytedance.php` / `gf2.php` / `xd.php` / `mmt.php` / `ace.php` / `za.php`）
- **播放 token 由服务器下发**，App 本地不加密生成，长期有效
- 服务器对列表/详情请求体加密，重放失效；新增片目需要抓一次详情包

本项目做的事：把已抓到的 token 存起来，按需调 `parse_api` 换新鲜直链。**明文源**（抖音 VID / 腾讯页面 URL / 芒果页面 URL）导入即用，无需任何额外配置。

完整抓包分析见 [mmys.md](./mmys.md)。

---

## 🟢 快速开始（本地 Python 版）

```bash
git clone https://github.com/Theadvocate-bit/mmys_api.git
cd mmys_api
python3 app.py                # 默认 0.0.0.0:8080
```

启动后 `data/catalog.json` 会被自动创建为空壳（`{"movies": []}`），`/api/catalog` 返回空列表。

### 导入片目

抓一次 App 详情包（Charles / mitmproxy / Fiddler），把详情响应整段 JSON 保存为 `detail.json`，然后：

```bash
python3 tools/import_detail.py detail.json                # 直接入库
python3 tools/import_detail.py detail.json --dry-run      # 先看会怎么入库
python3 tools/import_detail.py detail.json --as aiwei     # 指定自定义 slug
```

或走 HTTP：

```bash
curl -X POST http://127.0.0.1:8080/api/add-movie \
  -H "Content-Type: application/json" \
  --data-binary @detail.json
```

---

## 🔵 EdgeOne Makers 部署（Turso 存储）

部署到 EdgeOne Makers 平台，使用 Turso（libSQL/SQLite）做持久化存储，替代本地 JSON 文件。

### 架构

```
edge-functions/                    ← 路由层（文件即路由）
├── health.js                       GET /health
└── api/
    ├── catalog.js                  GET /api/catalog
    ├── movie/[id].js               GET/DELETE /api/movie/:id
    ├── play.js                     GET /api/play      ← 中转核心
    ├── token.js                    GET /api/token
    └── add-movie.js                POST /api/add-movie

lib/
└── db.js                           ← Turso HTTP 客户端 + 查询 + 详情转换（零 npm 依赖）

public/
└── index.html                      ← 服务信息页（含实时 /health 状态）

edgeone.json                        ← {"outputDirectory": "./public"}
schema.sql                          ← SQL schema
tools/
├── init_turso.mjs                  ← CLI：对 Turso 实例跑 schema
├── smoke_test.mjs                  ← Node 单测（纯函数）
└── import_detail.py                ← Python CLI（同本地版）
```

### 前置条件

1. **Turso 数据库**：在 [turso.tech](https://turso.tech) 创建一个数据库（免费层够用），获取：
   - `TURSO_URL`（形如 `https://xxx.turso.io`）
   - `TURSO_TOKEN`（形如 `turso_xxx`）

2. **初始化 schema**：

   ```bash
   TURSO_URL=https://xxx.turso.io \
   TURSO_TOKEN=turso_xxx \
   node tools/init_turso.mjs
   ```

3. **EdgeOne Makers 项目**：在 EdgeOne 控制台创建新项目，关联 GitHub 仓库 `Theadvocate-bit/mmys_api`。

4. **设置环境变量**（EdgeOne Makers → 项目设置 → 环境变量）：
   - `TURSO_URL`
   - `TURSO_TOKEN`

### 部署

推送代码到 GitHub，EdgeOne Makers 会自动拉取并部署。

### 导入片目（部署后）

```bash
curl -X POST https://YOUR_HOST/api/add-movie \
  -H "Content-Type: application/json" \
  --data-binary @detail.json
```

### 验证

```bash
curl https://YOUR_HOST/health
# → {"status":"ok","version":"0.2.0","movies":0,"cache_size":0}

curl https://YOUR_HOST/api/catalog
# → {"count":0,"movies":[]}
```

### 注意事项

- **无 npm 依赖**：`lib/db.js` 直接调用 Turso HTTP API（`POST /v2/turso/stmts`），不需要 `@libsql/client`，避免 Workers 打包问题。
- **无共享模块**：`edge-functions/` 下每个路由文件自包含（仅从 `lib/db.js` 导入业务函数），符合 EdgeOne Makers 目录扫描规则。
- **无 `context.next()`**：`edgeone.json` 指定 `outputDirectory: ./public`，平台自动优先路由静态资源。
- **parse_api 结果缓存**：每个 EdgeOne 实例内 60 秒缓存（`lib/db.js` 的 `_cache` Map），实例长驻所以缓存有效。
- **schema 自动初始化**：每个路由首次请求会 `CREATE TABLE IF NOT EXISTS`，即使忘了跑 `init_turso.mjs` 也不会报错。

---

## API 一览

| 方法   | 路径 | 说明 |
|---|---|---|
| GET    | `/`                                     | 服务信息 + 路由表（本地版）/ 静态首页（部署版） |
| GET    | `/health`                               | 存活检查（movie 数、缓存大小） |
| GET    | `/api/catalog`                          | 列出所有片目（含每源集数） |
| GET    | `/api/movie/{id}`                       | 某片详情（sources + 每集 token） |
| GET    | `/api/play?movie=&source=&episode=[&redirect=1]` | **中转核心**：调 `parse_api` 换新鲜直链 |
| GET    | `/api/token?movie=&source=&episode=`    | 调试：只看当前 token |
| POST   | `/api/add-movie`                        | 导入 maomao.php 详情 dump |
| DELETE | `/api/movie/{id}`                       | 从存储中移除某片 |

**所有端点自动带 CORS**（`Access-Control-Allow-Origin: *`），可直接从浏览器 / TVBox 集成。

### 中转调用示例

```bash
# JSON 返回（TVBox / 播放器集成用）
curl "https://YOUR_HOST/api/play?movie=vod-12345&source=BBA&episode=1"
# → { "code":200, "url":"http://...", "type":"mp4", "movie":"vod-12345",
#      "source":"BBA", "source_name":"自建1", "episode":1, "core_params":[...] }

# 302 直链（浏览器 / mpv / VLC 直接打开）
curl -L "https://YOUR_HOST/api/play?movie=vod-12345&source=BBA&episode=1&redirect=1"
```

明文源（bytedance / qq / mgtv）导入即用；密文源（BBA / IMDB / qsvip / Ksvideo / Ace / seven）直接用详情包下发的 token。

---

## 测试

### 本地单测（Node，无需 Turso）

```bash
node tools/smoke_test.mjs
```

覆盖 `buildMovieFromDetail`（详情转换）、`buildParseUrl`（URL 拼接）、`safeJsonParse`（非 JSON 兜底）。

### 冒烟测试（本地 Python 版）

```bash
bash tools/smoke_test.sh
```

启动 mock upstream + mock mmys_api，跑 34 条断言。

### Turso 连通性验证

```bash
TURSO_URL=... TURSO_TOKEN=... node tools/init_turso.mjs
# 输出 schema 执行结果 + 验证 SQL
```

---

## 环境变量

### 本地 Python 版

| 变量 | 默认 | 说明 |
|---|---|---|
| `MMYS_HOST`      | `0.0.0.0`            | 监听地址 |
| `MMYS_PORT`      | `8080`               | 监听端口 |
| `MMYS_DATA`      | `./data/catalog.json`| 数据文件路径 |
| `MMYS_TIMEOUT`   | `10`                 | 上游 `parse_api` 超时（秒） |
| `MMYS_CACHE_TTL` | `60`                 | 解析结果缓存（秒，按 `(parse_api, token)` 为 key） |

### EdgeOne Makers 部署版

| 变量 | 说明 |
|---|---|
| `TURSO_URL`   | Turso 数据库 URL（形如 `https://xxx.turso.io`） |
| `TURSO_TOKEN` | Turso 认证 token（形如 `turso_xxx`） |

---

## 数据来源与限制

- **明文源**（bytedance / qq / mgtv）：详情响应里就是明文，导入即用。
- **密文源**（BBA / IMDB / qsvip / Ksvideo / Ace / seven）：详情响应下发加密 token，长期有效、可直接调 `parse_api`。
- **列表 / 搜索请求体加密**：服务器对 `maomao.php/v7/logs` 请求体做了加密，重放失效。所以**新增片目必须靠抓一次详情包**。想搜任意片、列任意分类需要逆向 APK 拿加密算法（详见 mmys.md）。
- **上游网络**：`202.189.6.83:12991` 需可达；部分 CDN（bytetos / 抖音）从分析服务器拉流 SSL 握手可能超时，属网络环境差异，不影响解析本身。

## TVBox 集成

TVBox 需要 `{"url":"<直链>", "type":"mp4"}` 格式的中转接口。本项目的 `/api/play` 返回结构包含 `url` 与 `type` 字段，可通过一个薄薄 wrapper 转发为 TVBox 认可的 `parseUrl`：

```javascript
// TVBox source-script 里这样写（示意）
async function parse(ctx) {
  const r = await ctx.request.getJson(
    `https://YOUR_HOST/api/play?movie=${ctx.data.movie}&source=${ctx.data.source}&episode=${ctx.data.episode}`
  );
  return { url: r.url, type: r.type === "mp4" ? 0 : 1 };
}
```

## 部署建议

- **本地 / 家用**：`python3 app.py` 直跑，或用 systemd / launchd 拉起。
- **EdgeOne Makers**：推荐生产部署方式。Turso 免费层（9 GB 数据库 + 每月无限读）对中转 API 场景完全够用。
- **公网**：EdgeOne Makers 自带 HTTPS；如需鉴权，前置 Cloudflare Access 或 reverse proxy + Bearer token。
- **⚠️ 本项目没有认证**。如果部署到公网，请自行加前置鉴权。

## 免责

仅供个人抓包分析学习使用。使用时请留意相关平台的服务条款与版权边界。

## License

MIT
