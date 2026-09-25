# mmys（猫猫影视）App 抓包分析结论

> 分析日期：2026-09-26 ｜ 依据：4 份 HAR 抓包文件（media/ 目录）
> 最新 HAR：`23.225.47.20_2026_09_26_03_54_26.har`（60 entries），发现密钥轮转 + 详情响应结构变更。

## 一、App 基本信息

- 客户端：Flutter/Dart 应用（UA `Dart/3.13 (dart:io)`，包名 `com.maomao.app`）
- 后端：`23.225.47.20:3211`（maomao.php，伪装成日志接口的内容 API）
- 解析服务器：`202.189.6.83:12991`（/xx/ 下 7 个解析接口）
- App 特征请求头：`pk-id: com.maomao.app`、`version: 1.0.1`、`version-number: 2`、`platform: android`

## 二、核心结论：App 只是壳，一切都是服务器下发

### 1. 片库列表 API（伪装成日志上报）

```
POST http://23.225.47.20:3211/maomao.php/v7/logs
Content-Type: text/plain
请求体：加密串（约 214 字符，base64url 样式）
响应：{"code":1,"msg":"视频列表","page":1,"pagecount":456,
      "data":[{"vod_id","vod_name","vod_pic","type_id","vod_remarks"},...]}
```

### 2. 视频详情 API（同端点，请求体不同密文）

```
响应 msg="视频详情"，data.vod_info 含全部元数据 +
vod_play_from（源列表）+ vod_url_with_player（★关键★）
```

### 3. ★ vod_url_with_player = 播放源配置单（本次最重要发现）

每集的播放 token（密文或明文）、对应的解析 API、mpv 播放参数**全部由服务器在详情响应里下发**。
App 本地不做任何加密生成，只负责转发调用。

```python
[{'name': '自建1', 'code': 'BBA',
  'url': '第01集$ETH-xxx#第02集$ETH-xxx#...',   # 每集$token，#分隔
  'parse_api': 'http://202.189.6.83:12991/xx/bt.php?url=',
  'parse_secret': False,
  'headers': 'User-Agent: dart',
  'core_params': ['cache: yes', 'cache-secs: 150', 'demuxer-max-bytes: 256M', ...]},
 ...]
```

## 三、解析 API 全家桶（7 条线路）

| 源代码 | token 形态 | 解析接口 | 解析结果 |
|---|---|---|---|
| BBA（自建1） | `ETH-` 密文（hex编码ID前缀+192B载荷） | `bt.php?url=` | mp4/m3u8 直链 |
| bytedance（自建2） | **明文抖音 VID**（`v0d5aag10002dan4...`） | `mtbytedance.php?url=` | 抖音 CDN 直链 |
| qq（纯享2） | **明文腾讯页面 URL** | `gf2.php?url=` | 腾讯视频解析 |
| mgtv（纯享1） | **明文芒果页面 URL** | `gf2.php?url=` | 芒果解析 |
| IMDB / qsvip | `IMDB-` / `qsvip-` 密文（base64url） | `xd.php?url=` | 直链 |
| Ksvideo | `Ksvideo-` 密文（hex） | `mmt.php?url=` | 直链 |
| Ace | `Ace_Net-` / `Ace_Top-` 密文（28B） | `ace.php?url=` | m3u8 |
| seven | `SMD...` 密文（base64url） | `za.php?url=` | 直链 |

解析响应统一格式：
```json
{"code":200,"msg":"获取成功","url":"<直链>","type":"mp4","time":0,"client_ip":"...","system":"自定义-API智能"}
```

## 四、直链源特征（解析结果的落点）

- `v16-vod.capcutvod.com` — CapCut VOD，mp4 直链，路径带时效签名
- `video-cn.douyin.com/storage/v1/...` — 抖音 CDN，`x-tos-authkey` 签名
- `lf26-imcloud-file-sign.bytetos.com` — 字节云存储（伪装 .jpg 实为 mp4），`x-tos-expires` 签名
- `img.nxjunyu.asia/temp/m3u8/...` — HLS 播放列表
- `storage.360buyimg.com/rosefinch/<UUID>` — **伪装成京东 CDN 的 TS 分片**（0x47 同步字节，无签名无鉴权）

所有直链播放器请求特征：`User-Agent: dart`，支持 Range 断点。

## 五、已实测验证 ✅

1. m3u8 播放列表存活（1351 分片完整影片），TS 分片可拉（206 + 0x47）✅
2. capcutvod mp4 直链 Range 续播正常 ✅
3. **bt.php 用存档密文换新鲜直链成功**（《为爱正名》第1集 → code 200 + bytetos 签名直链，有效期至 9/29）✅

## 六、已存档数据（工作区）

| 文件 | 内容 |
|---|---|
| `video_catalog.json` | 63 条片目元数据（3 分类×21条） |
| `episode_tokens.json` | 《为爱正名》5源100集 + 《法医秦明》7源58集 每集 token + parse_api |
| `maomao_replay_tokens.json` | 5 个加密请求体（3 列表 + 2 详情，可留档对照） |
| `video_sources.m3u` | 直链播放源（VLC/PotPlayer 可直接播） |

## 七、边界与卡点

1. **maomao.php 请求体重放失效**（实测）：带齐全部特征头重放，服务器统一回退
   "0x…"配置式响应（尾部含 **`appsecretkey168`** 字样 = 服务器下发的密钥线索）。
   → 想给任意 vod_id 发列表/详情请求，必须逆向 APK 拿请求加密算法。
   → **2026-09-26 补充**：新 HAR 抓到密钥升级为 **`appsecretkey192`**（`xddsappsecretkey192` 变体），
     证实密钥随 App 版本轮转，不能硬编码。
2. 密文 token 本身长期有效（服务器下发、非 App 生成），新增片目可"抓一次详情包收一部"。
3. 直链 CDN（bytetos/抖音）从分析服务器拉流 SSL 握手超时，属网络环境差异，不影响解析。
4. 其余流量均为埋点（友盟三件套 + App 自建 logs），无利用价值。

## 八、2026-09-26 新 HAR 关键发现（`23.225.47.20_2026_09_26_03_54_26.har`）

### 1. 详情响应结构变更（**关键**）

早期存档把 `vod_url_with_player` 放在 `data` 顶层；本次 HAR 挪入 `data.vod_info` 内部。
顶层 `data` 也新增了用户态字段：

```js
data: {
  vod_info: {
    vod_id, vod_name, ...元数据...,
    vod_url_with_player: [   // ← 挪进来了
      { name, code, url, parse_api, headers, core_params, parse_secret }, ...
    ]
  },
  vod_history: null,
  is_collect: 0,
  comment_count: 0,
}
```

`buildMovieFromDetail` 已同时支持两种位置（v0 顶层 / v1 vod_info 内）。

### 2. 新增片目 vod 19067 师兄太稳健（30 集 10 源）

新增源代码：`youku`、`qiyi`、`qingshan`。总 10 源：
```
BBA / bytedance / youku / qiyi / seven / Ace / qsvip / qingshan / IMDB / Ksvideo
```

集名字面因源而异（新代码保留字面到 `episode_names`，Apple CMS V10 直出）：

| 源 | 集名字面示例 |
|---|---|
| BBA / mgtv / Ksvideo / Ace | `第01集$…` |
| youku / qiyi / seven / IMDB | `1$…` |
| qsvip | `01$…` |

### 3. 请求加密密钥轮转

新 HAR 抓到 `appsecretkey192`（`xddsappsecretkey192` 变体）。之前分析存档的是 `appsecretkey168`。
→ 密钥随 App 版本轮转，反代时不能硬编码；`mmys.app` IOS 版上架后可能进一步升级。

### 4. 新发现的端点

除 `视频列表 / 视频详情 / 弹幕列表` 外，本次还抓到：

| 消息类型 | 内容 |
|---|---|
| `置顶公告` | `{title, intro, create_time, is_top, content}` |
| `首页推荐` | `{banners[], videos[{name, type_id, vlist[]}]}` |
| `导航列表` | `[{type_id, type_name, type_extend{class,area,lang,year,star,director,state,version}}]` |

`导航列表` 提供了每个 type_id 的筛选字典（地区 / 语言 / 年份 / 演员 / 导演 / 状态 / 版本），
可以直接用来构建前端分类筛选 UI。

### 5. 请求头补充

新增观察到的请求头：`build-time: 1790064506061`、`platform-version: TKQ1.220829.002 test-keys`
（Android 测试版）。之前已知的 `pk-id / version / version-number / platform` 均一致。

## 九、后续路线

- **路线 A（可用状态）**：中转 API —— 对已收录片目实现：选片 → 选源/选集 → 实时调 parse_api → 302 新鲜直链。明文源（抖音VID/腾讯/芒果）无需任何密文。每抓一次详情包可新增一部片。
- **路线 B（完全体）**：提供 APK → jadx 全局搜 `appsecretkey168` / `appsecretkey192` / `Ace_Top` / `bt.php` 定位请求加密逻辑 → 伪造任意列表/详情/搜索请求 → 全库任意播放 + 可封装成 TVBox 源。

> 仅供个人学习研究抓包分析技术，使用时请注意相关平台的服务条款与版权边界。
