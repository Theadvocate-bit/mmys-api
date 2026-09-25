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
│   └── smoke_test.mjs         # Node 冒烟测试（87 项）
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
node tools/smoke_test.mjs             # 87 项冒烟测试
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

## 🍎 苹果 CMS V10 API（唯一业务出口）

完全兼容苹果 CMS V10 标准资源搜索 API，任意支持该格式的 CMS / 播放器都能直连。

### 端点

| 参数 | 说明 |
|---|---|
| `GET /api/appcms` | 片库列表（分页，默认 page=1, limit=20） |
| `GET /api/appcms?ids=<vod_id>` | 单片详情 |
| `GET /api/appcms?wd=<关键字>` | 搜索 |
| `GET /api/appcms?class_id=<id>` | 按分类筛选 |
| `GET /api/appcms?categories=1` | 分类列表 |
| `GET /api/appcms?page=&limit=` | 分页参数 |

### 格式说明

**vod_play_from**：播放源名称，多个用 `###` 分隔

**vod_play_url**：播放地址
- 多源用 `###` 分隔
- 源内多集用 `$$$` 分隔
- 每集格式：`名称$URL`

示例：
```
播放源1第01集$http://example.com/1.m3u8$$$播放源1第02集$http://example.com/2.m3u8###播放源2第01集$http://example.com/3.m3u8
```

### 示例

```bash
# 获取片库列表
curl https://<域名>/api/appcms

# 获取详情
curl https://<域名>/api/appcms?ids=305048

# 搜索
curl "https://<域名>/api/appcms?wd=法医"

# 获取分类
curl "https://<域名>/api/appcms?categories=1"
```

### 响应示例

```json
{
  "code": 1,
  "msg": "success",
  "page": 1,
  "pagecount": 2,
  "limit": 20,
  "total": 2,
  "list": [
    {
      "vod_id": "305048",
      "vod_name": "为爱正名",
      "vod_pic": "",
      "vod_remarks": "",
      "vod_class": "",
      "vod_content": "",
      "vod_play_from": "BBA###bytedance###qq###IMDB###Ksvideo",
      "vod_play_url": "第01集$https://域名/api/play?...$$$第02集$https://域名/api/play?...###..."
    }
  ]
}
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
- **内嵌片库**：`edge-functions/lib/catalog_data.js` 是代码兜底；内含 2 部片目（305048 为爱正名、308179 法医秦明之龙番往事）共 135 集
- **本项目无认证**：公网部署需自行加前置（nginx / Cloudflare Access / reverse proxy Bearer）
- 片库规模 = 已导入详情包的片目数；全库任意搜索/详情需逆向 App 请求加密（线索 `appsecretkey168`，见 mmys.md 路线 B）
- 本项目仅限个人学习研究抓包/反代技术，请遵守相关平台服务条款与版权边界
