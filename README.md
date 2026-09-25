# mmys_api

猫猫影视（maomao / mmys）App 抓包分析的中转 API。

对已收录片目（每部片抓一次详情包即可入库），实现 **选片 → 选源/选集 → 实时调 `parse_api` → JSON / 302 新鲜直链** 的中转能力。

零依赖，Python 3.8+ 标准库即可运行。

## 背景

猫猫影视 App 后端把「片库、每集播放 token、解析服务器配置」一次性在详情响应里下发：

- **后端**：`23.225.47.20:3211/maomao.php/v7/logs`（伪装成日志接口的内容 API）
- **解析服务器**：`202.189.6.83:12991/xx/`（7 条线路：`bt.php` / `mtbytedance.php` / `gf2.php` / `xd.php` / `mmt.php` / `ace.php` / `za.php`）
- **播放 token 由服务器下发**，App 本地不加密生成，长期有效
- 服务器对列表/详情请求体加密，重放失效；新增片目需要抓一次详情包

本项目做的事：把已抓到的 token 存起来，按需调 `parse_api` 换新鲜直链。**明文源**（抖音 VID / 腾讯页面 URL / 芒果页面 URL）导入即用，无需任何额外配置。

完整抓包分析见 [mmys.md](./mmys.md)。

## 快速开始

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

导入后 `data/catalog.json` 会新增一个 movie 记录，包含：

- `vod_id` / `vod_info` 元数据
- 每个 source 的 `parse_api` / `headers` / `core_params`
- 每集 token（`episodes` 对象，key 为集数编号）

## API 一览

| 方法   | 路径 | 说明 |
|---|---|---|
| GET    | `/`                                     | 服务信息 + 路由表 |
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
curl "http://127.0.0.1:8080/api/play?movie=vod-12345&source=BBA&episode=1"
# → { "code":200, "url":"http://...", "type":"mp4", "movie":"vod-12345",
#      "source":"BBA", "source_name":"自建1", "episode":1, "core_params":[...] }

# 302 直链（浏览器 / mpv / VLC 直接打开）
curl -L "http://127.0.0.1:8080/api/play?movie=vod-12345&source=BBA&episode=1&redirect=1"
```

明文源（bytedance / qq / mgtv）导入即用；密文源（BBA / IMDB / qsvip / Ksvideo / Ace / seven）直接用详情包下发的 token。

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `MMYS_HOST`      | `0.0.0.0`            | 监听地址 |
| `MMYS_PORT`      | `8080`               | 监听端口 |
| `MMYS_DATA`      | `./data/catalog.json`| 数据文件路径 |
| `MMYS_TIMEOUT`   | `10`                 | 上游 `parse_api` 超时（秒） |
| `MMYS_CACHE_TTL` | `60`                 | 解析结果缓存（秒，按 `(parse_api, token)` 为 key） |

## 项目结构

```
mmys_api/
├── app.py                    # 中转 API 主程序（单文件，标准库）
├── tools/
│   └── import_detail.py      # 详情包 → 入库 助手
├── data/
│   └── .gitkeep              # 数据目录占位（catalog.json 由 .gitignore 排除）
├── mmys.md                   # 上游抓包分析结论
├── README.md
├── LICENSE
└── .gitignore
```

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
    `https://<your-deployment>/api/play?movie=${ctx.data.movie}&source=${ctx.data.source}&episode=${ctx.data.episode}`
  );
  return { url: r.url, type: r.type === "mp4" ? 0 : 1 };
}
```

具体接入方式取决于 TVBox 版本，此处仅作思路说明。

## 部署建议

- **本地 / 家用**：`python3 app.py` 直跑，或用 systemd / launchd 拉起。
- **公网**：前置 nginx / caddy 反代 + HTTPS。上游 `parse_api` 走 http，出向连接需要白名单放行 `202.189.6.83:12991`。
- **Serverless**：本项目基于 Python 标准库 `http.server`，可包一层 gunicorn 或直接跑在 Fly.io / Railway / Render 的 Python runtime 上；`data/catalog.json` 需要挂持久卷（否则重启丢数据）。
- **⚠️ 本项目没有认证**。如果部署到公网，请自行加前置鉴权（nginx basic-auth、Cloudflare Access、reverse proxy + Bearer token 等）。

## 免责

仅供个人抓包分析学习使用。使用时请留意相关平台的服务条款与版权边界。

## License

MIT
