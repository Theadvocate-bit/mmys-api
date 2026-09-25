# mmys_api — EdgeOne Makers 部署版

把 mmys_api 适配到 **EdgeOne Makers（原 EdgeOne Pages）** 的云函数：
选片 → 选源选集 → 实时调 parse_api 换新鲜直链 → 任意播放器直连播放。

## 📦 项目结构

```
mmys_api/
├── edge-functions/
│   ├── health.js              # GET /health — 健康检查
│   └── api/
│       ├── catalog.js         # GET /api/catalog — 片库列表
│       ├── movie/[id].js      # GET/DELETE /api/movie/:id — 详情
│       ├── play.js            # GET /api/play — 播放（m3u8 重写 + 代理 + 302）
│       ├── seg.js             # GET /api/seg — 媒体代理（Range 透传 + dart UA）
│       ├── search.js          # GET /api/search?q= — 搜索
│       ├── token.js           # GET /api/token — 调试（返回原始 token）
│       ├── add-movie.js       # POST /api/add-movie — 导入片目
│       ├── delete/[id].js     # DELETE/POST /api/delete/:id — 删除片目
│       ├── cache/clear.js     # POST/GET /api/cache/clear — 清空解析缓存
│       └── store.js           # GET /api/store — 存储自检
├── lib/
│   ├── db.js                  # Turso 客户端（HANA pipeline）+ CRUD + 兜底 + 缓存
│   └── catalog_data.js        # 内嵌片库（自动生成，Turso 不可用时兜底）
├── app.py                     # Python 本地开发版（单文件，仅标准库）
├── tools/
│   ├── init_turso.mjs         # Turso 建表（HANA pipeline）
│   ├── smoke_test.mjs         # Node 冒烟测试（44 项）
│   ├── smoke_test.sh          # Python 冒烟测试
│   ├── build_catalog_data.py  # 从 data/catalog.json 生成内嵌片库
│   └── import_detail.py       # 导入详情 JSON 到 catalog.json
├── data/catalog.json          # 片库源数据（git-ignored，本地维护）
├── public/index.html          # 首页（部署后轮询 /health）
├── schema.sql                 # Turso 表结构
├── edgeone.json               # EdgeOne Makers 配置
└── README.md
```

## 🗄️ 存储：Turso（不用 EdgeOne KV）

**存储统一用 Turso**（libSQL Serverless，有免费额度），不使用 EdgeOne KV。

### 核心设计：三级兜底 + 60s 退避

```
Turso（持久化） → 实例内存 overlay → 内嵌 catalog_data.js（代码兜底）
                    ↓ 60s backoff
                故障时不再重试，服务不中断
```

- **片库读取**：Turso → 运行时导入 → 内嵌 catalog_data.js
- **解析缓存**：Turso（持久化，TTL 1800s） → 实例内存
- **退避机制**：Turso 故障后 60s 内不再重试，自动降级

### 配置步骤

**1. 创建数据库并拿凭证**

```bash
# 方式一：CLI
npm install -g @tursodatabase/cli
turso auth signup
turso db create mmys-catalog          # 得到 libsql://mmys-catalog-<org>.turso.io
turso db tokens create mmys-catalog   # 得到数据库专用 token

# 方式二：控制台 https://console.turso.tech 建库 → Database → 取 URL 和 Token
```

**2. 初始化建表 + 播种片库**

```bash
export TURSO_DATABASE_URL='libsql://mmys-catalog-<org>.turso.io'
export TURSO_AUTH_TOKEN='<token>'
node tools/init_turso.mjs             # 建 movies + parse_cache 表
```

**3. EdgeOne Makers 控制台配置环境变量**（项目 → Settings → Environment Variables）

| 变量 | 值 |
|---|---|
| `TURSO_DATABASE_URL` | `libsql://mmys-catalog-<org>.turso.io`（自动转 https） |
| `TURSO_AUTH_TOKEN` | 数据库 token |
| `MYS_CACHE_TTL` | `1800`（解析缓存 TTL，秒，可选） |
| `MYS_PARSE_TIMEOUT` | `20000`（解析超时，毫秒，可选） |
| `MYS_STREAM_TIMEOUT` | `30000`（拉流超时，毫秒，可选） |
| `MYS_UA_APP` | `Dart/3.13 (dart:io)`（调解析接口的 UA，可选） |
| `MYS_UA_PLAYER` | `dart`（拉直链流的 UA，可选） |

> 也支持旧变量名 `TURSO_URL` / `TURSO_TOKEN`（向后兼容）。

### 本地无账号自测

```bash
python3 tools/build_catalog_data.py   # 从 data/catalog.json 生成内嵌片库
# 不设 TURSO 环境变量 → 自动使用内嵌 catalog_data.js 兜底
node tools/smoke_test.mjs             # 44 项冒烟测试
```

## 🚀 部署（三选一）

### 方式 A：CLI 直传

```bash
npm install -g edgeone
edgeone login
cd mmys_api
edgeone makers deploy -n mmys-api
```

### 方式 B：控制台上传

Makers 控制台 → 项目 → **Direct Upload** → 选择整个文件夹。

### 方式 C：Git 仓库导入

推到 GitHub → Makers 控制台 **Importing a Git Repository** → 导入。
之后每次 push 自动重新部署。

> 无需构建配置：平台自动识别 `edge-functions/` 目录、自动扫描 import。

## 📡 端点

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | 健康检查（版本、Turso 状态、片目数、缓存大小） |
| GET | `/api/catalog` | 片库列表 |
| GET | `/api/movie/<id>` | 详情（含每集绝对 play_url） |
| DELETE | `/api/movie/<id>` | 删除片目 |
| GET | `/api/play?movie=&source=&episode=[&raw=1][&refresh=1]` | **播放** |
| GET | `/api/seg?url=<b64>` | 媒体代理（Range 透传 + dart UA） |
| GET | `/api/search?q=关键字` | 搜索片目 |
| GET | `/api/token?movie=&source=&episode=` | 调试（返回原始 token，不调 parse_api） |
| POST | `/api/add-movie` | 导入 vod_info JSON |
| DELETE/POST | `/api/delete/<id>` | 删除片目 |
| POST/GET | `/api/cache/clear` | 清空解析缓存（Turso + 内存） |
| GET | `/api/store` | 存储自检（Turso 连通性、库内片目数） |

### /api/play 返回模式

| 参数 | 行为 |
|---|---|
| 无参数 | m3u8 → 重写分片 URL 走 `/api/seg` 代理；mp4 → 302 到 `/api/seg` |
| `?raw=1` | 302 到原始直链（省函数流量，播放器需自备 dart UA） |
| `?refresh=1` | 跳过缓存，强制重新解析 |

## 📺 播放器用法

```bash
curl https://<域名>/api/catalog
curl "https://<域名>/api/play?movie=vod-305048&source=BBA&episode=1"
# m3u8 直接播放（分片自动重写走代理）：
vlc "https://<域名>/api/play?movie=vod-305048&source=BBA&episode=1"
# 或 302 直链（播放器 UA 设为 dart）：
vlc "https://<域名>/api/play?movie=vod-305048&source=BBA&episode=1&raw=1"
```

## ➕ 新增片目

**方式一：运行时导入（推荐，免重新部署）**

```bash
curl -X POST https://<域名>/api/add-movie \
  -H "Content-Type: application/json" \
  -d @detail.json
```

配置了 Turso 环境变量后，`POST /api/add-movie` 直接写入 Turso——**跨实例、跨重部署持久化**。

**方式二：本地导入 + 重建内嵌 + 部署**

```bash
python3 tools/import_detail.py detail.json       # 更新 data/catalog.json
python3 tools/build_catalog_data.py              # 重建 lib/catalog_data.js
node tools/init_turso.mjs                        # 同步 Turso（如果配置了）
edgeone makers deploy -n mmys-api                # 重新部署
```

## ⚙️ Turso 协议细节

本版使用 **HANA pipeline 协议**（`POST /v2/pipeline`），而非旧版 `POST /v2/turso/stmts`：

- **类型化参数**：int/float/str/null/blob 五种类型编码，全 SQL 参数化
- **批处理**：`executeMany` 一个 pipeline 发多条 SQL，减 HTTP 往返
- **持久化缓存**：`parse_cache` 表存储解析结果，TTL 1800s，跨实例保留
- **gzip 解压**：parse_api 响应有时 gzip，自动检测魔数 `\x1f\x8b` 解压

## 🧪 冒烟测试

```bash
# Node 端（44 项）
node tools/smoke_test.mjs

# Python 端
bash tools/smoke_test.sh
```

## ⚠️ 注意事项

- **函数执行时长**：默认 `/api/play` 经函数代理拉流，长视频如遇平台时长限制，用 `?raw=1`（302 直链，不经函数，需播放器 UA 设为 `dart`）
- **内嵌片库**：`lib/catalog_data.js` 由 `tools/build_catalog_data.py` 自动生成，Turso 不可用时作为兜底；内含 2 部片目（305048 为爱正名、308179 法医秦明之龙番往事）共 135 集
- **本项目无认证**：公网部署需自行加前置（nginx / Cloudflare Access / reverse proxy Bearer）
- 片库规模 = 已导入详情包的片目数；要"全库任意搜索/详情"需逆向 App 请求加密（线索 `appsecretkey168`，见 mmys.md 路线 B）
- 本项目仅限个人学习研究抓包/反代技术，请遵守相关平台服务条款与版权边界
