# HANDOFF: mmys.app 逆向工程与解析接口集成

> 本文件记录逆向进度。每次会话开始前先读此文件，完成后更新。

## 状态

| 阶段 | 状态 | 说明 |
|---|---|---|
| 抓包分析 | ✅ 完成 | 2 个 HAR 文件，15+ 请求，导航/搜索/详情/解析全链路 |
| 解析接口集成 | ✅ 完成 | `202.189.6.83:12991/xx/*.php` 已集成，Ace/BBA 源验证通过 |
| mmt.php 源支持 | ⏳ 待开始 | Ksvideo/Dong 源返回 base64 密文，非 JSON，需特殊处理 |
| libzxprotect.so 逆向 | ⏳ 待开始 | ARM64 机器码，JNI 混淆，AES 密钥生成逻辑未知 |
| 完整逆向 | ⏳ 待开始 | Dart SDK 加密复刻，需提取内核快照 |

---

## 阶段 1：抓包分析（完成）

### 数据源

| 文件 | 大小 | 请求数 |
|---|---|---|
| `media/cos.hxx2023.cc_*.har` | 22MB | 20 |
| `media/cnlogs.umeng.com_*.har` | 6.9MB | 61 |

### 关键发现

#### mmys.app 官方 API（加密）

- **端点**：`http://23.225.47.20:3211/maomao.php/v7/logs`
- **方法**：POST
- **请求体**：base64 编码的密文（107-363 字节，AES-128-CBC）
- **响应**：JSON（导航、搜索、详情）或 base64 密文（配置数据）
- **加密库**：`libzxprotect.so`（商业保护，JNI 混淆）

#### 解析接口（明文）

| 接口 | 响应格式 | 用途 |
|---|---|---|
| `/xx/ace.php?url=` | JSON `{code, url, type}` | Ace 源 → m3u8 直链 |
| `/xx/mmt.php?url=` | base64 密文 | Dong/Ksvideo 源 → MMT 流 |
| `/xx/xd.php?url=` | JSON | qingshan/IMDB 源 |

**响应示例（ace.php）**：
```json
{"code":200,"success":1,"msg":"解析成功","url":"http://img.nxjunyu.asia/.../m3u8","type":"m3u8"}
```

#### 播放数据格式

`vod_url_with_player` 数组，每项：
```json
{
  "name": "自建5",
  "code": "Dong",
  "url": "第01集$Dong-8a91bace...#第02集$Dong-8a91bace...",
  "parse_api": "http://202.189.6.83:12991/xx/mmt.php?url=",
  "headers": "User-Agent: dart",
  "core_params": ["cache: yes", "cache-secs: 150", ...]
}
```

#### 8 类顶级导航

| id | 名称 | 子筛选维度 |
|---|---|---|
| 1 | 电影 | class/area/lang/year/star/director/state/version |
| 2 | 剧集 | class/area/lang/year/star/director/state/version |
| 3 | 综艺 | class/area/lang/year/star |
| 4 | 动漫 | class/area/lang/year/version |
| 58 | 直播 | year |
| 62 | 少儿 | year |
| 63 | 短剧 | year |
| 64 | 漫剧 | year |

---

## 阶段 2：解析接口集成（完成）

### 现状

`parse_api` 已配置在 `data/catalog.json` 中，`/api/play` 端点已实现完整解析链路。

### 验证结果

| 源 | parse_api | 状态 | 说明 |
|---|---|---|---|
| Ace | `xx/ace.php` | ✅ | 302 → mp4 直链 |
| BBA | `xx/bt.php` | ✅ | 302 → mp4 直链 |
| Ksvideo | `xx/mmt.php` | ⚠️ | 返回 base64 密文，非 JSON |
| Dong | `xx/mmt.php` | ⚠️ | 返回 base64 密文，非 JSON |
| qingshan | `xx/xd.php` | ❓ | 未测试 |
| IMDB | `xx/xd.php` | ❓ | 未测试 |

### mmt.php 源问题

`mmt.php` 返回 base64 编码的加密数据（256 字节），不是 JSON 或明文 URL。

**分析**：
- Base64 解码后：256 字节二进制数据
- 熵值：7.23 bits/byte（接近最大 8.0，高度随机）
- 唯一字节：168/256
- 无 URL 模式（无 http/https/.mp4/.m3u8/.ts）

**结论**：这是加密的播放数据，疑似 AES-128-CBC 或类似对称加密。密钥可能在：
- mmys.app 客户端硬编码
- 运行时从服务端获取
- 设备绑定生成

**待办**：需逆向 mmys.app 或 mmt.php 服务端获取解密密钥。

### 在线数据源（commit `f988c2c`）

内置 16 个苹果 CMS V10 采集源，开箱即用：

| Key | 名称 | API |
|-----|------|-----|
| mmys | 猫猫影视 | https://mmys.nalinali.qzz.io/api/appcms |
| ffzy | 非凡影视 | http://ffzy5.tv/api.php/provide/vod |
| dyttzy | 电影天堂资源 | http://caiji.dyttzyapi.com/api.php/provide/vod |
| ruyi | 如意资源 | http://cj.rycjapi.com/api.php/provide/vod |
| bfzy | 暴风资源 | https://bfzyapi.com/api.php/provide/vod |
| zy360 | 360资源 | https://360zy.com/api.php/provide/vod |
| jisu | 极速资源 | https://jszyapi.com/api.php/provide/vod |
| mdzy | 魔都资源 | https://www.mdzyapi.com/api.php/provide/vod |
| zuid | 最大资源 | https://api.zuidapi.com/api.php/provide/vod |
| ikun | iKun资源 | https://ikunzyapi.com/api.php/provide/vod |
| lzi | 量子资源站 | https://cj.lziapi.com/api.php/provide/vod |
| hhzy | 豪华资源 | https://hhzyapi.com/api.php/provide/vod |
| lzcj | 量子采集 | https://cj.lzcaiji.com/api.php/provide/vod |
| hongniu | 红牛资源 | https://www.hongniuzy2.com/api.php/provide/vod |
| fangzy | 非凡采集 | https://api.ffzyapi.com/api.php/provide/vod |

- 默认源：`mmys`（猫猫影视，mmys.app 兼容 8 类导航）
- 可选：`MYS_SEARCH_UPSTREAM` 环境变量覆盖内置源
- 透传全部请求到上游，失败静默回落本地

---

## 阶段 3：libzxprotect.so 逆向（进行中）

### 分析现状

| 组件 | 发现 |
|---|---|
| `libzxprotect.so` | 商业保护库，JNI 混淆（`Java_com_zx_a_I8b7_*`） |
| 加密算法 | AES-128-CBC（所有 body 是 16 字节块的倍数） |
| 密钥生成 | 运行时动态生成，可能与设备信息绑定 |
| `libNativeHelper.so` | `datadiv_decode` 函数，数据解密 |

### 逆向进度

**2026-09-26 启动逆向工程**

- **APK 文件：** `mmys.apk`（28MB，用户提供）
- **APK 结构分析：**
  - `classes.dex`（8.9MB）+ `classes2.dex`（6.6MB）- Java/Kotlin 字节码
  - `lib/arm64-v8a/libapp.so`（7.9MB）- Dart 内核快照
  - `lib/arm64-v8a/libflutter.so`（11.7MB）- Flutter 引擎
  - `lib/arm64-v8a/libdartjni.so`（131KB）- Dart JNI 桥接
  - `lib/arm64-v8a/libumeng-spy.so`（398KB）- 友盟统计
  - **重要发现：无 `libzxprotect.so`！** 加密逻辑在 Dart 代码中（编译进 `libapp.so`）
  
- **加密算法发现：**
  - `AES/CBC/PKCS5PADDING` - AES-128-CBC 加密
  - `Ljavax/crypto/Cipher` - Java Cipher 类
  - `Ljavax/crypto/spec/SecretKeySpec` - 密钥规范
  - `Ljavax/crypto/spec/IvParameterSpec` - IV 规范
  - `package:flutter_curl_task/brilliantapple.dart` - HTTP 请求库
  - `, buildSignature: ` - 签名构建函数
  - `Bearer` - Bearer token 认证
  
- **Dart 内核快照提取：**
  - `_kDartSnapshotData` 偏移：0x2c0
  - `_kDartSnapshotText` 偏移：0x200000
  - 快照大小：2,096,448 字节
  - 已提取到 `dart_snapshot.bin`
  
- **发现的十六进制字符串（可能的密钥/哈希）：**
  - `16328ec745228189cbccd25b99c2e3a8d6`（40 字符，SHA-1？）
  - `30e4ca17ccb2f93fa9dcbc524efc8ad9eff1101c6849f39378bc4b94183c4bd72b5d64d2b07803680070b08ee8c973128e3ccb0ec8bcf856a88e8b5d4cf48abcfcf2610b6970fd9b50d8449b1b3074bf240931d2a1770b3d047cb19be8cf7a3e2a390fd3c51c09485c7191f4e3c856`（64 字符，SHA-256？）
  - `a4fa1a9f4072c40c6afe4712b7ae6b9c7142f08f2a0827c24069daefa1`（48 字符）
  - `ffffffffffffffffffffffffffffffff6c611070995ad10045841b09b761b893`（64 字符）
  - 还有大量 16 字节 hex 字符串（AES-128 密钥候选）

- **DEX 文件分析：**
  - 类名已混淆（单字母命名）
  - 包含标准 Android 加密库（`javax.crypto`）
  - 无硬编码密钥（可能在 Dart 代码中）

- **工具限制：**
  - 无 Dart 反编译工具（`flutter_dart_decompiler` 不可用）
  - 无 Ghidra/IDA Pro/radare2
  - 仅有 `objdump`、`strings`、`readelf`
  
- **下一步：**
  1. 安装 Dart 反编译工具（需要网络连接）
  2. 反汇编 `libapp.so` 定位加密函数
  3. 提取 AES 密钥和 IV
  4. 在 Node.js 中复刻加密逻辑
  5. 集成到 `appcms.js` 实现官方 API 直连

### 逆向路径

1. **反汇编 `libzxprotect.so`**（ARM64）
   - 工具：Ghidra / IDA Pro / radare2
   - 目标：找到 JNI 函数实现，追踪密钥生成逻辑

2. **提取 Dart 内核快照**
   - `libapp.so` 中 `_kDartSnapshotData` 标记
   - 工具：`flutter_dart_decompiler` / 自定义解析器

3. **复刻加密算法**
   - Node.js / Edge Runtime 无 `libzxprotect.so`
   - 需用纯 JS 实现 AES-128-CBC
   - 密钥生成逻辑需完全复刻

### 风险评估

- **时间**：3-7 天（取决于保护强度）
- **合规**：可能违反 mmys.app 服务条款
- **稳定性**：商业保护库可能有多层加密/混淆

---

## 阶段 4：完整逆向（待开始）

### 目标

在 Edge Runtime 中复刻 mmys.app 客户端的加密算法，直接调用官方 API。

### 前置条件

- [ ] 提取 Dart 内核快照
- [ ] 反编译 Dart 代码
- [ ] 找到加密函数和密钥
- [ ] 复刻到 JS
- [ ] 集成到 appcms.js

---

## 变更记录

| 日期 | 变更 | 操作者 |
|---|---|---|
| 2026-09-26 | 创建 HANDOFF.md，记录抓包分析结果 | Gloria |
| 2026-09-26 | 解析接口集成完成，Ace/BBA 源验证通过，mmt.php 源待处理 | Gloria |

---

## 快速参考

### 解析接口测试命令

```bash
# Ace 源（JSON 响应）
curl "http://202.189.6.83:12991/xx/ace.php?url=Ace_Top-bd803f9a53b6907d83e6dd8bf3716bb50e0ab52c55bc696b9d26f433"

# Dong 源（base64 密文响应）
curl "http://202.189.6.83:12991/xx/mmt.php?url=Dong-8a91bacec721efb33ce1d06f6966b9897c8ef253c66b121f49be4c978d56568e949f5add6837004543a160e4546"
```

### 逆向工具链

```bash
# 安装 Ghidra（反汇编）
# 安装 radare2（命令行反汇编）
apt install radare2

# Flutter Dart 反编译
pip install flutter_dart_decompiler

# ARM64 反汇编
r2 -A libzxprotect.so  # radare2
```
