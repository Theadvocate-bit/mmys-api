# mmys_api — EdgeOne Makers 部署版

选片 → 选源选集 → 实时调 parse_api 换新鲜直链 → 播放器直连播放。
**存储统一走 Turso，API 出口只有苹果 CMS V10 一种。**

## 🗄️ 存储：Turso（不使用 EdgeOne KV）

### 配置步骤

1. **创建数据库**：[Turso 控制台](https://turso.tech/) → Create Database → 记下 `DATABASE_URL`
2. **建立 Token**：Database Settings → Add Database Token → 保存 token
3. **本地初始化**：

```bash
cd mmys_api

# 1. 设置环境变量
export TURSO_DATABASE_URL="libsql://<你的域名>.turso.io"
export TURSO_AUTH_TOKEN="<你的token>"
export NODE_TLS_REJECT_UNAUTHORIZED=0    # Turso 用自签证书

# 2. 建表
node tools/init_turso.mjs

# 3. 导入片目（可选；不导入则用内嵌兜底 3 部）
curl -X POST https://<部署域名>/api/add-movie -d @detail.json
```

### 配置表

| 表 | 用途 |
|---|---|
| `movies` | 片目主表（sources JSON 存多源多集） |
| `parse_cache` | 解析结果缓存（TTL 1800s，跨实例保留） |

### 本地无账号自测

```bash
# 不设 TURSO 环境变量 → 自动使用内嵌 catalog_data.js 兜底（3 部片，434 集）
node tools/smoke_test.mjs
```

## 🚀 部署（EdgeOne Makers 三选一）

### 方式 A：CLI 直传

```bash
edgeone makers deploy -n mmys-api
# 成功后控制台会打印分配的域名
```

### 方式 B：控制台上传

1. 登录 [EdgeOne Makers](https://edgeone.ai/makers) → Create Site
2. 上传 `mmys_api.zip`（项目根目录打包）
3. Framework 选 **Other**，Build Command 留空
4. 部署完成后在 Settings → Environment Variables 添加 `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN`

### 方式 C：Git 仓库导入

Console → Create Site → 选 Git 仓库 → 关联本仓库 → 每次 push 自动部署。

部署后访问首页 `<域名>/` 会轮询 `/health` 显示状态。

## 📡 端点

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | 健康检查（版本、Turso 状态、片目数、缓存大小） |
| **GET** | **`/api/appcms`** | **苹果 CMS V10 API**（片库 / 详情 / 搜索 / 分类，唯一业务出口） |
| GET | `/api/play?movie=&source=&episode=[&raw=1][&refresh=1]` | 播放 |
| GET | `/api/seg?url=<b64>` | 媒体代理（Range 透传 + dart UA） |
| GET | `/api/catalog` | 片库列表（运维） |
| GET | `/api/search?q=关键字` | 搜索（运维） |
| GET | `/api/token?movie=&source=&episode=` | 调试（返回原始 token） |
| POST | `/api/add-movie` | 导入 vod_info JSON（配置 Turso 后跨实例持久化） |
| DELETE | `/api/delete/<id>` | 删除片目 |
| POST/GET | `/api/cache/clear` | 清空解析缓存 |
| GET | `/api/store` | 存储自检 |

### /api/play 返回模式

| 参数 | 行为 |
|---|---|
| 无参数 | m3u8 → 重写分片 URL 走 `/api/seg` 代理；mp4 → 302 到 `/api/seg` |
| `?raw=1` | 302 到原始直链（省函数流量，播放器需自备 dart UA） |
| `?refresh=1` | 跳过缓存，强制重新解析 |

### 播放器用法

```bash
curl https://<域名>/api/catalog
curl "https://<域名>/api/play?movie=vod-305048&source=BBA&episode=1"

# m3u8 直接播放（分片自动重写走代理）：
vlc "https://<域名>/api/play?movie=vod-305048&source=BBA&episode=1"

# 或 302 直链（播放器 UA 设为 dart）：
vlc "https://<域名>/api/play?movie=vod-305048&source=BBA&episode=1&raw=1"
```

## 🍎 苹果 CMS V10 API（严格对齐 [mmys.app](https://mmys.app) 官方客户端规范）

抓包来源：`cos.hxx2023.cc/maomao.php/v7/logs` → `"导航列表"` 响应。任意支持苹果 CMS V10 的资源采集器/播放器可直接消费。

### 端点

```
GET /api/appcms?page=&limit=&wd=&class_id=&ids=&ac=detail&text=
```

| 参数 | 说明 |
|---|---|
| `page` | 页码（默认 1） |
| `limit` | 每页条数（默认 20） |
| `wd` / `text` | 搜索关键字（按片名优先，其次演员/地区/分类；不含 `vod_content` 长文本以避免单字误伤） |
| `class_id` / `type_id` | 按分类 id 过滤（两者等价） |
| `ids` | 按片目 id 查（单个或逗号分隔） |
| `ac` | `list`（默认精简）/ `detail`（83 字段详情） |

### 顶层结构

```json
{
  "code": 1,                          // 1=成功，-1=失败
  "msg": "数据列表" | "数据详情",
  "page": 1,
  "pagecount": 1,
  "limit": 20,
  "total": 3,
  "class": [{"type_id": 1, "type_pid": 0, "type_name": "电影"}, {"type_id": 2, "type_pid": 0, "type_name": "剧集"}, ...],  // 全量 8 类顶级导航
  "list": [ ... ]                     // 精简 8 字段 或 详情 83 字段
}
```

### 列表项（8 字段）

```json
{
  "vod_id": 19067,
  "vod_name": "师兄太稳健",
  "type_id": 2,
  "type_name": "剧集",
  "vod_en": "",
  "vod_time": "2026-09-25 20:00:15",
  "vod_remarks": "30集全",
  "vod_play_from": "BBA,bytedance,youku,qiyi,seven,Ace,qsvip,qingshan,IMDB,Ksvideo"
}
```

### 详情项（83 字段）

关键字段：

```json
{
  "vod_id": 19067,
  "type_id": 2,          // 顶级 id（mmys.app 单级导航）
  "type_id_1": 2,        // = type_id（mmys.app 无二级分类编号）
  "vod_name": "师兄太稳健",
  "vod_class": "奇幻,古装,电视,连续",
  "vod_pic": "https://...",
  "vod_actor": "王浩信,蔡思贝,袁伟豪...",
  "vod_remarks": "30集全",
  "vod_content": "前世是重症患者...",
  "vod_play_from": "BBA$$$bytedance$$$youku$$$...",
  "vod_play_server": "no$$$no$$$no$$$...",
  "vod_play_url": "第01集$https://域名/api/play?...#第02集$https://域名/api/play?...$$$1$https://...",
  "type_name": "剧集"
}
```

### 分隔符规范

| 字段 | 分隔符 | 含义 |
|---|---|---|
| `vod_play_from`（列表） | `,` | 源间 |
| `vod_play_from`（详情） | `$$$` | 源间 |
| `vod_play_url` | `$$$` → `#` → `$` | 源间 → 集间 → 集名\|URL |

`vod_play_server` 每源占位 `"no"`（与 mmys.app 一致）。

### 分类字典

内置 **8 类顶级导航**，与 mmys.app 官方 `导航列表` 响应完全一致，单级结构（无二级分类编号，全部 `type_pid=0`）：

| id | 名称 | 子筛选维度（通过查询参数过滤） |
|---|---|---|
| 1 | 电影 | class / area / lang / year / star / director / state / version |
| 2 | 剧集 | class / area / lang / year / star / director / state / version |
| 3 | 综艺 | class / area / lang / year / star |
| 4 | 动漫 | class / area / lang / year / version |
| 58 | 直播 | year |
| 62 | 少儿 | year |
| 63 | 短剧 | year |
| 64 | 漫剧 | year |

子筛选（如"古装""科幻""国产""美国"）不是独立 `type_id`，而是官方客户端通过独立参数（`class=`/`area=`/`lang=`/`year=`）传给后端的标签，本 API 通过 `wd` 参数按 `vod_class` 模糊匹配实现等价过滤。

### 示例

```bash
# 全部列表
curl https://<域名>/api/appcms

# 单片详情（83 字段）
curl "https://<域名>/api/appcms?ac=detail&ids=305048"

# 搜索
curl "https://<域名>/api/appcms?wd=法医"           # 按片名匹配
curl "https://<域名>/api/appcms?wd=19067"          # 按 vod_id 精确查
curl "https://<域名>/api/appcms?wd=奇幻"           # 按 vod_class 分类词

# 按分类筛选（8 类顶级导航 id）
curl "https://<域名>/api/appcms?type_id=2"         # 剧集
curl "https://<域名>/api/appcms?class_id=4"        # 动漫
curl "https://<域名>/api/appcms?type_id=63"        # 短剧
curl "https://<域名>/api/appcms?type_id=64"        # 漫剧
```

## ⚠️ 注意事项

- **函数执行时长**：`/api/play` 经函数代理拉流，长视频如遇平台时长限制，用 `?raw=1`（302 直链，需播放器 UA 设为 `dart`）
- **内嵌片库**：`edge-functions/lib/catalog_data.js` 是代码兜底；内含 3 部片目（305048 为爱正名、308179 法医秦明之龙番往事、19067 师兄太稳健）共 434 集
- **本项目无认证**：公网部署需自行加前置（nginx / Cloudflare Access / reverse proxy Bearer）
- 本项目仅限个人学习研究抓包/反代技术，请遵守相关平台服务条款与版权边界
