# HANDOFF: mmys.app 逆向工程与解析接口集成

> 本文件记录逆向进度。每次会话开始前先读此文件，完成后更新。

## 状态

| 阶段 | 状态 | 说明 |
|---|---|---|
| 抓包分析 | ✅ 完成 | 2 个 HAR 文件，15+ 请求，导航/搜索/详情/解析全链路 |
| 解析接口集成 | ✅ 完成 | `202.189.6.83:12991/xx/*.php` 已集成，Ace/BBA 源验证通过 |
| mmt.php 源支持 | ⏳ 阻塞 | 256B base64 密文，AES-128-CBC 已确认，密钥未知 |
| libzxprotect.so 逆向 | ✅ 澄清 | **不存在此 .so**，加密在 Dart 代码里（libapp.so） |
| Java 层加密工具定位 | ✅ 完成 | `s.a.a()` 完整实现见下 |
| 官方 API 密钥获取 | ⚠️ 部分 | 服务端下发 key-name（`xddappsecretkey168/192/208/232`），key-value 未知 |
| 完整逆向 | ⏳ 待开始 | 需 Ghidra/IDA/radare2 反汇编 ARM64 |

---

## 阶段 1：抓包分析（完成）

### 数据源

| 文件 | 大小 | 请求数 |
|---|---|---|
| `media/23.225.47.20_2026_09_26_03_54_26.har` | 5.1MB | 60 |
| `media/cnlogs.umeng.com_*.har` | 6.9MB | 61 |

### 关键发现

#### mmys.app 官方 API（加密）

- **端点**：`http://23.225.47.20:3211/maomao.php/v7/logs`
- **方法**：POST
- **请求体**：base64url 编码的密文（mod 16 = 0，AES-128-CBC）
- **响应**：JSON 或 base64 编码的多段密文（配置+加密数据+key-name 三段式）
- **加密库**：Dart 代码（编译进 `libapp.so`），非 `libzxprotect.so`

#### 解析接口（明文）

| 接口 | 响应格式 | 用途 |
|---|---|---|
| `/xx/ace.php?url=` | JSON `{code, url, type}` | Ace 源 → m3u8 直链 |
| `/xx/bt.php?url=` | JSON | BBA/ETH 源 → mp4/m3u8 直链 |
| `/xx/xd.php?url=` | JSON | IMDB/qsvip 源 |
| `/xx/mmt.php?url=` | base64 密文 256B | Dong/Ksvideo 源 |

#### 请求体长度（固定）

| 类型 | 长度 | 密文块数 |
|---|---|---|
| 视频列表 | 214 chars → 160B | 10 |
| 视频详情 | 363 chars → 272B | 17 |
| 弹幕列表 | 171 chars → 128B | 8 |
| 公告/推荐/导航 | 107-128 chars → 80-96B | 5-6 |

#### 请求头特征

```
user-agent: Dart/3.13 (dart:io)
version: 1.0.1
version-number: 2
pk-id: com.maomao.app
platform: android
platform-version: TKQ1.220829.002 test-keys
build-time: 1790064506061
content-type: text/plain
```

---

## 阶段 2：解析接口集成（完成）

`parse_api` 已配置在 `data/catalog.json` 中，`/api/play` 端点已实现完整解析链路。Ace/BBA 源已验证通过。

---

## 阶段 3：加密核心函数逆向（本轮新增，完成）

### Java 层核心：`s.a.a()`（sources/s/a.java）

**位置**：`/tmp/jadx_mmys/out/sources/s/a.java`（jadx 反编译 classes2.dex）

```java
public static byte[] a(byte[] bArr, String str, String str2) {
    if (TextUtils.isEmpty(str)) return bArr;              // key 为空直接返回
    byte[] bArr2;
    if (TextUtils.isEmpty(str2)) {
        bArr2 = new byte[16];                              // IV 默认 0x00*16
    } else {
        bArr2 = str2.startsWith("0x")
            ? c(str2.substring(2))                          // "0x" 前缀 → hex decode
            : str2.getBytes();                              // 否则按 UTF-8 字节
        if (bArr2.length != 16) bArr2 = new byte[16];       // 强制 16 字节
    }
    Cipher cipher = Cipher.getInstance("AES/CBC/PKCS5PADDING");
    byte[] c2 = c(str);                                     // key 必须 hex
    cipher.init(2,                                          // 2 = DECRYPT_MODE
        new SecretKeySpec(c2, "AES"),
        new IvParameterSpec(bArr2));
    return cipher.doFinal(bArr);
}

// b(byte[]) → 大写 hex string
// c(String) → hex string decode to bytes（str.length/2 长度）
```

**要点**：
- 算法：**AES-128-CBC + PKCS5Padding**
- `mode=2` = `Cipher.DECRYPT_MODE`（Java 常量）
- `key` 参数必须是 hex 字符串（长度须 32 = 16 bytes）
- `IV` 可以是 hex（带或不带 "0x"）或 UTF-8 字符串，都会强制到 16 字节
- **这个函数在 Java 层**，但调用点可能在 Dart 通过 MethodChannel

### `s.c.a()`：MD5 工具
```java
MessageDigest.getInstance("MD5") → hex 输出
```
用于 HLS/key 下载校验，非主加密。

### `s.b.c()`：HLS 处理（含 key 下载）
```
"key下载失败" 日志
HttpURLConnection 下载 m3u8 相关 key
```
说明 Java 层还有 HLS/AES-128 播放链路（ExoPlayer 相关），不是 maomao API 通信层。

### Dart 层线索（libapp.so / dart_snapshot.bin）

**已定位字符串**：
- `AESMode.` （`0x279bb`）
- `AES/CBC/PKCS5PADDING`（Java 层已用）
- `Cipher.getInstance` 相关
- `package:flutter_curl_task/brilliantapple.dart`
- `, buildSignature: ` @ `0x3d38e`
- `Bearer` @ `0x2c21c`
- `Invalid or corrupted pad block` @ `0x3422c`
- `decryption error` @ `0x64bc2`

**未找到**：
- `maomao.php`、`23.225.47.20`、`pk-id`、`appsecretkey`
- `com.maomao.app`（可能通过 Flutter assets 或系统配置）

**说明**：Dart 代码是 AOT 编译的 ARM64，字符串常量表被压入 snapshot 但没有明文，需要 `ghidra` 或 `radare2` 反汇编才能定位调用关系。

### 响应体结构（entry 51/53/54 分析）

三个 entry 均为 base64 编码的多段拼接，格式：

```
[base64(hex-numeric-config)] [base64(encrypted-blob)] [base64(key-name)]
       = padding at pos X                    = last '=='
```

**尾部 key-name 解码**：
- entry 51 → `xddappsecretkey192`
- entry 53 → `xddappsecretkey232`
- entry 54 → `xddappsecretkey208`
- 历史 HAR 见过 `xddappsecretkey168`（旧版本）

**观察**：
- 所有 key-name 都是 `xddappsecretkey + 数字` 格式
- 数字递增（168 → 192 → 208 → 232），可能表示密钥版本轮转
- 每个响应末尾的 key-name 表示"用这个 key 解密上面的 blob"
- key-name 本身不是密钥，是密钥标识/索引

**HAR 中未见到 `appsecretkey` 明文**（在 libapp.so 和 dex 里都是 0 hits），说明 key 值运行时获取或本地存储。

---

## 阶段 4：mmt.php 分析（进行中）

### 实测（2026-09-26）

```bash
curl "http://202.189.6.83:12991/xx/mmt.php?url=Dong-8a91bace..."
```

返回 base64 密文（344 chars），解码 = **256 字节**：
```
hex: 3c21e817ab9cba2b7c6ef030c38227dd...6785ef413949fdc62c94461a36d6769f
```

### 结构特征

| 指标 | 值 |
|---|---|
| 解码长度 | 256B |
| AES 块数 | 16 |
| 熵 | 7.216 bits/byte（≈ 满熵） |
| 唯一字节 | 167/256 |
| mod 16 | 0 |
| mod 32 | 0 |
| mod 64 | 0 |
| mod 128 | 0 |

### 候选结构

1. **AES-128-CBC (IV 前置)**：`IV(16B) + Ciphertext(240B)`，密文 240B 解密出 ≤ 240B 明文
2. **AES-128-CBC (IV 独立)**：`Ciphertext(256B)`，IV 从请求头或参数传递
3. **AES-128-GCM**：`IV(16B) + Ciphertext(224B) + Tag(16B)`，256B 恰好符合

### 已尝试的密钥候选（0 命中）

```python
candidates = {
    'xddappsecretkey168/192/208/232' (raw ASCII),
    'appsecretkey168/192' (raw ASCII),
    'xddsappsecretkey192' (raw ASCII),
    'md5(xddappsecretkey192)', 'md5(xddappsecretkey168)',
    'sha1(xddappsecretkey192)[:16]', 'sha256(xddappsecretkey192)[:16]',
    'com.maomao.app', 'MaomaoAppKey1688/1920',
    'MMYS@2024xxxxxx', '0123456789abcdef', ...
}
```
全部用 CBC (IV=ct[:16])、CBC (IV=zero)、ECB 三种模式测试 → 无一命中有效 PKCS7 padding。

### 结论

mmt.php 的加密密钥**不在响应中直接给出**，需：
1. 在客户端本地存储中找到（SharedPreferences / file / native）
2. 通过设备首次绑定从服务器下发
3. 由 Dart 代码运行时生成（需 Ghidra 反汇编）

---

## 阶段 5：完整逆向（待开始）

### 目标

在 Edge Runtime 中复刻 mmys.app 客户端的加密算法，直接调用官方 API。

### 前置条件

- [ ] 反汇编 `libapp.so`（ARM64 AOT）定位加密函数
- [ ] 找到 AES key 生成/获取逻辑
- [ ] 复刻到 JS
- [ ] 集成到 `appcms.js`

### 可用工具

- **已可用**：`jadx 1.5.1`（`/opt/jadx/bin/jadx`）、`objdump`、`readelf`、`strings`、`pycryptodome`、`cryptography`
- **不可用**：`ghidra`、`ida`、`radare2`、`rabin2`、`apktool`、`flutter_dart_decompiler`
- **建议**：如要继续逆向，需安装 `radare2` 或 Ghidra 便携版

### 工具限制说明

- APK 是纯 Flutter：dex 层几乎不含业务逻辑
- libapp.so 是 AOT 编译的 ARM64，无调试符号
- Dart 快照 `dart_snapshot.bin`（2.09MB）中所有标识符都是混淆名（`_Ru@18353248`、`_MHa@1023178418` 等）
- 需要 ARM64 disassembler 才能定位密钥相关常量

---

## 变更记录

| 日期 | 变更 | 操作者 |
|---|---|---|
| 2026-09-26 | 创建 HANDOFF.md，记录抓包分析结果 | Gloria |
| 2026-09-26 | 解析接口集成完成，Ace/BBA 源验证通过，mmt.php 源待处理 | Gloria |
| 2026-09-26 | 澄清 libzxprotect.so 不存在，加密在 Dart 代码 | Gloria |
| 2026-09-26 | **jadx 反编译完成**，定位 s.a.a() = AES-128-CBC 核心 | Gloria |
| 2026-09-26 | 发现响应尾部 key-name 机制：`xddappsecretkey168/192/208/232` | Gloria |
| 2026-09-26 | mmt.php 256B 密文结构分析完成，密钥未破解 | Gloria |

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
# 已完成：jadx 反编译 dex
/opt/jadx/bin/jadx --no-res --no-imports --threads-count 1 --deobf-min 0 \
  --output-dir /tmp/jadx_mmys/out mmys.apk

# 加密核心：sources/s/a.java（AES-128-CBC）
# HLS 处理：sources/s/b.java（HttpURLConnection + key 下载）
# MD5 工具：sources/s/c.java

# 待完成（需安装）：
# apt install radare2
# r2 -A lib/arm64-v8a/libapp.so
# 或用 Ghidra 打开 libapp.so
```

### 关键文件索引

- `media/23.225.47.20_2026_09_26_03_54_26.har` — 最新抓包，60 entries，含所有端点
- `mmys.apk` — 28MB，Flutter 应用
- `dart_snapshot.bin` — 从 libapp.so 提取的 Dart 快照（2.09MB）
- `mmys.md` — 早期抓包分析报告
- `/tmp/jadx_mmys/out/sources/` — jadx 反编译输出（7646 java files）
  - `sources/s/a.java` — 核心 AES 加解密
  - `sources/s/b.java` — HLS/key 处理
  - `sources/s/c.java` — MD5

### 下一步建议

1. **短期可推进**（不需反汇编）：
   - 检查 mmys.app 是否用同一 key 解密 mmt.php 与 maomao.php（可试同套 key 试解密）
   - 用 `s.a.a()` 反编译代码，构造完整 JS 等价实现，等拿到密钥即可使用
   - 从 mmt.php 响应体结构推测是否用 AES-GCM（256B = 16 IV + 224 CT + 16 Tag）

2. **中期**（需 ghidra/radare2）：
   - 反汇编 `libapp.so` 定位 AES 相关函数
   - 找 Dart snapshot 中 key 常量表
   - 提取实际 AES-128 密钥和 IV 生成算法

3. **替代路线**：
   - 用 Frida hook 客户端运行时抓 key（需 Android 环境）
   - 只走明文源（Ace/BBA/ETH），跳过 mmt.php 的 Dong/Ksvideo

---

## 风险评估

- **时间**：完整逆向 3-7 天（需安装工具 + 反汇编经验）
- **合规**：可能违反 mmys.app 服务条款
- **稳定性**：Dart AOT 保护 + 密钥轮转（168→192→208→232）意味着即使破解也要维护版本

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
# 已完成：jadx 反编译
/opt/jadx/bin/jadx --no-res --no-imports --threads-count 1 --deobf-min 0 \
  --output-dir /tmp/jadx_mmys/out mmys.apk

# 加密核心：sources/s/a.java（AES-128-CBC）

# 待完成（需安装）：
apt install radare2
r2 -A lib/arm64-v8a/libapp.so
```

### 下一步建议

1. **短期可推进**（不需反汇编）：
   - 检查 mmys.app 是否用同一 key 解密 mmt.php 与 maomao.php
   - 构造 JS 等价 AES-128-CBC 实现，等密钥到位即可使用
   - 推测 mmt.php 256B = IV(16) + CT(224) + Tag(16) → AES-GCM 假设

2. **中期**（需 ghidra/radare2）：
   - 反汇编 `libapp.so` 定位 AES 相关函数
   - 提取实际密钥和 IV 生成算法

3. **替代路线**：
   - Frida hook 客户端运行时抓 key
   - 只走明文源（Ace/BBA/ETH），跳过 mmt.php 的 Dong/Ksvideo
