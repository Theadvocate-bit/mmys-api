# mmys_api — EdgeOne Makers 部署版

选片 → 选源选集 → 实时调 parse_api 换新鲜直链 → 播放器直连播放。
**存储统一走 Turso，API 出口只有苹果 CMS V10 一种。**

## 📦 项目结构

```
mmys_api/
├── edge-functions/
│   ├── health.js              # GET /health — 健康检查
│   ├── api/
│   │   ├── appcms.js          # GET /api/appcms — 苹果 CMS V10 API（唯一业务出口）
│   │   ├── play.js            # GET /api/play — 播放（m3u8 重写 + 代理 + 302）
│   │   ├── seg.js             # GET /api/seg — 媒体代理（Range 透传 + dart UA）
│   │   ├── catalog.js         # GET /api/catalog — 片库列表（运维用）
│   │   ├── search.js          # GET /api/search?q= — 搜索（运维用）
│   │   ├── token.js           # GET /api/token — 调试原始 token
│   │   ├── store.js           # GET /api/store — 存储自检
│   │   ├── add-movie.js       # POST /api/add-movie — 导入片目
│   │   ├── movie/[id].js      # GET/DELETE /api/movie/:id — 详情 / 删除
│   │   ├── delete/[id].js     # DELETE /api/delete/:id — 删除（别名）
│   │   └── cache/clear.js     # POST /api/cache/clear — 清空解析缓存
│   └── lib/
│       ├── db.js              # Turso 客户端（HANA pipeline）+ CRUD + 兜底 + 缓存
│       ├── appcms_format.js   # 苹果 CMS V10 格式化
│       └── catalog_data.js    # 内嵌片库（Turso 不可用时兜底）
├── tools/
│   ├── init_turso.mjs         # Turso 建表（HANA pipeline）
│   ├── build_catalog_data.py  # 从 data/catalog.json 生成内嵌片库
│   └── smoke_test.mjs         # Node 冒烟测试（104 项）
├── data/catalog.json          # 片库源数据（本地维护，git-ignored）
├── public/index.html          # 首页（部署后轮询 /health）
├── schema.sql                 # Turso 表结构
├── edgeone.json               # EdgeOne Makers 配置
├── mmys.md                    # 抓包分析原始结论（参考）
└── README.md
```

## 🗄️ 存储：Turso（不使用 EdgeOne KV）

**三级兜底 + 60s 退避**：

```
Turso（持久化） → 实例内存 overlay → 内嵌 catalog_data.js（代码兜底）
                    ↓ 60s backoff
                故障时不再重试，服务不中断
```

- **片库读取**：Turso → 运行时导入 → 内嵌 catalog_data.js
- **解析缓存**：Turso（TTL 1800s） → 实例内存
- **退避机制**：Turso 故障后 60s 内不再重试，自动降级

### 配置步骤

**1. 创建数据库并拿凭证**

```bash
npm install -g @tursodatabase/cli
turso auth signup
turso db create mmys-catalog          # → libsql://mmys-catalog-<org>.turso.io
turso db tokens create mmys-catalog   # → 数据库 token
```

**2. 初始化建表**

```bash
export TURSO_DATABASE_URL='libsql://mmys-catalog-<org>.turso.io'
export TURSO_AUTH_TOKEN='<token>'
node tools/init_turso.mjs
```

**3. EdgeOne Makers 控制台环境变量**（项目 → Settings → Environment Variables）

| 变量 | 值 |
|---|---|
| `TURSO_DATABASE_URL` | `libsql://mmys-catalog-<org>.turso.io`（自动转 https） |
| `TURSO_AUTH_TOKEN` | 数据库 token |
| `MYS_CACHE_TTL` | `1800`（解析缓存 TTL 秒，可选） |
| `MYS_PARSE_TIMEOUT` | `20000`（解析超时毫秒，可选） |
| `MYS_STREAM_TIMEOUT` | `30000`（拉流超时毫秒，可选） |
| `MYS_UA_APP` | `Dart/3.13 (dart:io)`（调解析接口 UA，可选） |
| `MYS_UA_PLAYER` | `dart`（拉直链流 UA，可选） |

> 只接受 `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` 两个变量名。

### 本地无账号自测

```bash
# 不设 TURSO 环境变量 → 自动使用内嵌 catalog_data.js 兜底
node tools/smoke_test.mjs             # 104 项冒烟测试
```

## 🚀 部署（EdgeOne Makers 三选一）

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
| **GET** | **`/api/appcms`** | **苹果 CMS V10 API**（片库 / 详情 / 搜索 / 分类） |
| GET | `/api/play?movie=&source=&episode=[&raw=1][&refresh=1]` | 播放 |
| GET | `/api/seg?url=<b64>` | 媒体代理（Range 透传 + dart UA） |
| GET | `/api/catalog` | 片库列表（运维） |
| GET | `/api/search?q=关键字` | 搜索（运维） |
| GET | `/api/token?movie=&source=&episode=` | 调试（返回原始 token） |
| POST | `/api/add-movie` | 导入 vod_info JSON |
| DELETE | `/api/delete/<id>` | 删除片目 |
| POST/GET | `/api/cache/clear` | 清空解析缓存 |
| GET | `/api/store` | 存储自检 |

### /api/play 返回模式

| 参数 | 行为 |
|---|---|
| 无参数 | m3u8 → 重写分片 URL 走 `/api/seg` 代理；mp4 → 302 到 `/api/seg` |
| `?raw=1` | 302 到原始直链（省函数流量，播放器需自备 dart UA） |
| `?refresh=1` | 跳过缓存，强制重新解析 |

## 🍎 苹果 CMS V10 API（严格对齐 /api.php/provide/vod 规范）

严格对齐 hongniuzy2 / bfzy / dyttzy 三家的标准格式，任意支持苹果 CMS V10 的资源采集器/播放器可直接消费。

### 端点

| 参数 | 说明 |
|---|---|
| `GET /api/appcms` | 精简列表（8 字段/项，默认） |
| `GET /api/appcms?ac=detail&ids=<vod_id>` | 详情（83 字段/项） |
| `GET /api/appcms?wd=<关键字>` | 按名称/简介/分类搜索 |
| `GET /api/appcms?class_id=<type_id>` | 按分类筛选（`type_id=` 别名同义） |
| `GET /api/appcms?ids=<id>` | 按 id 过滤（列表格式） |
| `GET /api/appcms?page=&limit=` | 分页（limit 上限 100） |
| `GET /api/appcms?text=<关键字>` | `wd=` 的别名 |

### 顶层结构

```json
{
  "code": 1,
  "msg": "数据列表",         // 详情模式返回 "数据详情"
  "page": 1,
  "pagecount": 1,
  "limit": 20,
  "total": 3,
  "list": [...],             // 8 或 83 字段，取决于 ac
  "class": [{"type_id": 2, "type_name": "连续剧"}, ...]   // 始终附带
}
```

### 列表项（8 字段）

```json
{
  "vod_id": 19067,
  "vod_name": "师兄太稳健",
  "type_id": 2,
  "type_name": "连续剧",
  "vod_en": "",
  "vod_time": "2026-09-25 20:00:15",
  "vod_remarks": "30集全",
  "vod_play_from": "BBA,bytedance,youku,qiyi,seven,Ace,qsvip,qingshan,IMDB,Ksvideo"
}
```

### 详情项（83 字段）

关键字段节选：
```json
{
  "vod_id": 19067,
  "type_id": 2,
  "type_id_1": 2,
  "vod_name": "师兄太稳健",
  "vod_sub": "",
  "vod_en": "",
  "vod_status": 1,
  "vod_letter": "S",           // 拼音首字母（兜底：首字符大写）
  "vod_tag": "",
  "vod_class": "奇幻,古装,电视,连续",
  "vod_pic": "https://...",
  "vod_actor": "王浩信,蔡思贝,袁伟豪...",
  "vod_director": "",
  "vod_blurb": "",
  "vod_remarks": "30集全",
  "vod_pubdate": "",
  "vod_area": "",
  "vod_lang": "",
  "vod_year": "",
  "vod_score": "",
  "vod_content": "前世是重症患者...",
  "vod_play_from": "BBA$$$bytedance$$$youku$$$...",
  "vod_play_url": "第01集$https://域名/api/play?...#第02集$https://域名/api/play?...$$$1$https://...",
  "type_name": "连续剧"
}
```

### 分隔符规范

| 字段 | 分隔符 | 示例 |
|---|---|---|
| `vod_play_from` (list) | `,` | `BBA,bytedance,youku` |
| `vod_play_from` (detail) | `$$$` | `BBA$$$bytedance$$$youku` |
| `vod_play_url` 源间 | `$$$` | `source1_urls$$$source2_urls` |
| `vod_play_url` 源内集 | `#` | `第01集$URL#第02集$URL` |
| `vod_play_url` 每集 | `name$url` | `第01集$https://...` |

### 分类字典

内置 46 类主分类（与 hongniu/bfzy/dytt 三家的 `class` 数组一致）：
电影 / 连续剧 / 综艺 / 动漫 / 动作片 / 喜剧片 / 爱情片 / 科幻片 / 恐怖片 / 剧情片 / 战争片 / 国产剧 / 港澳剧 / 日剧 / 欧美剧 / 台湾剧 / 泰剧 / 韩剧 / 纪录片 / 动漫电影 / 伦理片 / 体育赛事 / 短剧 / 预告片 / 足球 / 篮球 / 台球 / 其他赛事 / 中国动漫 / 日本动漫 / 欧美动漫 / 大陆综艺 / 日韩综艺 / 港台综艺 / 欧美综艺 / 古装仙侠 / 现代都市 / 穿越年代 / 言情总裁

### 示例

```bash
# 全部列表
curl https://<域名>/api/appcms

# 单片详情（83 字段）
curl "https://<域名>/api/appcms?ac=detail&ids=305048"

# 搜索
curl "https://<域名>/api/appcms?wd=法医"

# 按分类筛选
curl "https://<域名>/api/appcms?type_id=2"        # 连续剧
curl "https://<域名>/api/appcms?class_id=30"      # 短剧
```

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

配置了 Turso 后，`POST /api/add-movie` 直接写入 Turso —— **跨实例、跨重部署持久化**。

**方式二：本地导入 + 重建内嵌 + 部署**

```bash
# 编辑 data/catalog.json → 重新部署
edgeone makers deploy -n mmys-api
```

## ⚙️ Turso 协议细节

使用 **HANA pipeline 协议**（`POST /v2/pipeline`），非旧版 `POST /v2/turso/stmts`：

- **类型化参数**：int/float/str/null/blob 五种类型编码，全 SQL 参数化
- **批处理**：`executeMany` 一个 pipeline 发多条 SQL，减 HTTP 往返
- **持久化缓存**：`parse_cache` 表存储解析结果，TTL 1800s，跨实例保留
- **gzip 解压**：parse_api 响应有时 gzip，自动检测魔数 `\x1f\x8b` 解压

## 🧪 冒烟测试

```bash
node tools/smoke_test.mjs        # 87 项
```

## ⚠️ 注意事项

- **函数执行时长**：`/api/play` 经函数代理拉流，长视频如遇平台时长限制，用 `?raw=1`（302 直链，不经函数，需播放器 UA 设为 `dart`）
- **内嵌片库**：`edge-functions/lib/catalog_data.js` 是代码兜底；内含 3 部片目（305048 为爱正名、308179 法医秦明之龙番往事、19067 师兄太稳健）共 434 集
- **本项目无认证**：公网部署需自行加前置（nginx / Cloudflare Access / reverse proxy Bearer）
- 片库规模 = 已导入详情包的片目数；全库任意搜索/详情需逆向 App 请求加密（线索 `appsecretkey168` / `appsecretkey192`，见 mmys.md 路线 B）
- 本项目仅限个人学习研究抓包/反代技术，请遵守相关平台服务条款与版权边界

## 🆕 2026-09-26 抓包新发现

依据 `23.225.47.20_2026_09_26_03_54_26.har`（60 entries）：

**请求体加密密钥升级**：早期存档 `appsecretkey168`；本次在 `logs` 响应尾部抓到 `appsecretkey192`（`xddsappsecretkey192` 变体）。密钥随 App 版本轮转，逆向时要动态定位。

**详情响应结构变更**（旧 HAR 顶层 → 新 HAR 挪入 `vod_info` 内部）：
```js
// 旧（v0）：
data: { vod_info: {...}, vod_url_with_player: [...] }
// 新（v1，2026-09-26）：
data: { vod_info: { ..., vod_url_with_player: [...] }, vod_history, is_collect, comment_count }
```
`buildMovieFromDetail` 已兼容两种位置。

**新增片目 vod 19067 师兄太稳健**（10 源 × 30 集 = 299 集）：
- 新增源代码：`youku`（纯享3）、`qiyi`（纯享4）、`qingshan`（自建6）
- 全部 10 源：`BBA / bytedance / youku / qiyi / seven / Ace / qsvip / qingshan / IMDB / Ksvideo`

**集名格式因源而异**（新增保真）：
| 源 | 集名字面 |
|---|---|
| BBA | `第01集$…` |
| youku / qiyi / seven / IMDB | `1$…` |
| qsvip | `01$…` |

`parseEpisodeNames()` 保留原始字面，Apple CMS V10 `vod_play_url` 直出服务器格式。

**发现的其它 API**（本次 HAR 内出现，未做接口透出）：
| 端点消息 | 用途 | 数据结构 |
|---|---|---|
| `视频列表` | 分页列表 | `page / pagecount / total / limit / data[]` |
| `视频详情` | 详情 | `vod_info + vod_history + is_collect + comment_count` |
| `弹幕列表` | 弹幕 | 数组（本次为空） |
| `置顶公告` | 公告 | `title / intro / create_time / is_top` |
| `首页推荐` | Banner + 分区 | `banners[] + videos[].vlist[]` |
| `导航列表` | 分类筛选 | `type_id / type_name / type_extend{class,area,lang,year,star,director,state,version}` |

请求头（Flutter/Dart）：`pk-id: com.maomao.app / version: 1.0.1 / version-number: 2 / build-time: 1790064506061 / platform: android / platform-version: TKQ1.220829.002 test-keys`。

