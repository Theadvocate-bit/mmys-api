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

## Step 1 记录：本地存储扫描（2026-09-26）

**目标**：在 APK 静态资源里找客户端持久化/硬编码的 AES 密钥。

**检查项**：

| 检查 | 结果 |
|---|---|
| Java 层硬编码 32-char hex | 0 命中 |
| Java 层硬编码 16-byte ASCII key | 0 命中（Flutter SDK/第三方库除外） |
| SharedPreferences 调用点（业务层） | 0 命中（仅 Flutter 标准插件） |
| Java 层 `KEY|SECRET|PWD|PASSWORD` 常量 | 0 命中（业务层） |
| Flutter assets/*.config 明文密钥 | 0 命中（唯一 config 已加密） |
| supplierconfig.json | 只有厂商 appid，无密钥 |

**发现的加密资源**：
- `assets/flutter_assets/assets/6dc8be097856bd70.config`（2.5MB）— 二进制加密配置文件
  - `strings` 扫描仅 30646 条字符串，绝大部分是乱码
  - 唯一相关的字符串命中：`k192`（可能是 `appsecretkey192` 片段）
  - 文件内容看似随机字节（`9aa9 185a ac72 8b71...`），熵极高
  - 可能是服务器下发的加密配置包，包含密钥+其他配置

**结论**：
- 密钥**不在 APK 明文静态资源里**
- 唯一可能是加密的 6dc8be097856bd70.config 中包含密钥
- 需要动态分析（Frida）或反汇编 libapp.so 定位密钥获取逻辑

**下一步**：走 Step 2（试同套密钥解密 mmt.php）或 Step 4（装 radare2 反汇编 libapp.so）

---

## Step 2 记录：s.a.a() 复刻解密 mmt.php（2026-09-26）

**目标**：用 Java 层 `s.a.a()` 的完整逻辑，配合候选密钥/IV 解密 mmt.php 256B 密文。

**测试规模**：

| 类别 | 数量 |
|---|---|
| key_hex 候选（含 MD5/SHA256 派生、APK 签名派生、常量字符串） | 25 |
| IV 候选（zero / ct[:16] / key-name UTF-8 / hex 变体） | 6 |
| PBKDF2 派生（seed × salt × iter） | 12 seed × 5 salt × 3 iter = 180 |
| **合计** | **~330 组合** |

**结果**：**0 命中有效 PKCS7 padding**，无一产生可读明文。

**关键结论**：

1. **mmt.php 密文**与 `s.a.a()` 使用的密钥**不同源**
   - 或加密算法不是标准 AES-128-CBC（可能是自定义变体）
   - 或密钥不在能静态推导的地方

2. **key-name 不是密钥本身**
   - `xddappsecretkey192` 只是标识/索引
   - MD5(key-name)、SHA256(key-name)、UTF-8(key-name) 全部不是有效 AES-128 密钥
   - PBKDF2 派生（1/1000/10000 iter）也未命中

3. **APK 签名派生**（`META-INF/*.RSA`/`.SF` MD5/SHA256）也未命中

4. **响应体结构再确认**（entry 51/53/54）：
   - body 是 base64，解码后含三段：`0x hex 数值` | `binary 加密 blob` | `key-name`
   - 例 entry 54（2856 chars）→ 解码 155B：hex 数据 155 chars + key-name `xddappsecretkey208`
   - entry 53（676 chars）→ 解码 488B：hex + 332B blob + key-name
   - key-name 段（base64 编码）在 body 尾部

**结论**：
- 静态分析路线**已用尽**：APK 静态资源 + HAR + 常见派生方式都试过了
- 密钥要么在运行时生成（Dart 代码），要么在动态下发的加密 config 里
- **继续逆向必须走动态或反汇编路线**

**最终结论（2026-09-26 Step 2 结束）**：
- 静态分析路线**已完全走尽**（330+ 组合 + 最后一轮激进尝试 ~1000 组合，均 0 命中）
- 密钥**不在能静态推导的地方**：
  - 不在 APK 明文资源
  - 不在 HAR 明文
  - 不是 key-name 的直接变形/派生
  - 不是常见密码/PBKDF2/APK 签名派生
- **必须换路线**

**下一步决策（用户选择）**：

| 选项 | 说明 | 难度 |
|---|---|---|
| **A. 放弃 mmt.php** | 只走 Ace/BBA/ETH 明文源，直接可用 | 快，功能受限 |
| **B. 装 radare2 反汇编** | `apt install radare2` 反汇编 libapp.so 找 Dart 密钥常量 | 需管理员 + 数小时 |
| **C. Frida 动态调试** | Android 环境 + Frida hook 抓运行时密钥 | 需 Android 设备/模拟器 |
| **D. 尝试解 config.bin** | 2.5MB 加密配置可能含密钥，但自身加密方式未知 | 未知，可能走不通 |
| **E. 只保留逆向成果文档** | 归档现有发现，不再继续 | 已完成 |

---

## Step C 记录：尝试解 config.bin（2026-09-26）

**目标**：破解 `assets/flutter_assets/assets/6dc8be097856bd70.config`（2.5MB），看是否含密钥。

**文件特征**：

| 属性 | 值 |
|---|---|
| 大小 | 2,493,066 bytes |
| size mod 16 | 10 |
| 熵 | **7.9999 bits/byte**（近乎完美满熵） |
| 唯一字节 | 256/256 |
| 长 base64 序列 | 0 |
| Dart kernel magic (kBDF) | 不匹配 |
| Dart snapshot magic (BCDM) | 不匹配 |
| zlib/gzip/zstd magic | 不匹配 |

**结论：满熵加密数据**，可能是 AES-256/ChaCha20 等强加密，非简单 XOR。

**尝试方案（全部 0 命中）**：

| 尝试 | 数量 | 结果 |
|---|---|---|
| 单字节 XOR 扫描 | 256 keys | 最高可读比例 0.413（0x7b） |
| 10 字节循环 XOR（含 filename MD5/SHA1/SHA256 派生） | 7 seeds | 最高可读比例 0.440 |
| XOR with 前缀假设（appsecretkey192 / xdd / { JSON / MaomaoAppConfig / 等） | 12 前缀 | 全 <0.45 |
| 56 个 libapp.so 中的 32-char hex 作为密钥解 mmt.php | 55 keys × 3 IV | 0 命中 |

**关键发现**：`libapp.so` 的 strings 中确实包含 56 个 32-char hex 字符串，但**无一能解密 mmt.php**，且这些 hex 更可能是 Dart VM 内部常量（哈希表种子、SHA-256 K 常量等），不是应用密钥。

**结论**：
- config.bin **不是简单 XOR 加密**（若是 XOR 早就找到了）
- 可能是 AES-CTR/GCM 或 ChaCha20 强加密
- 没有密钥就无法解
- **Step C 走不通**

**下一步**：转向 **Step A**（放弃 mmt.php，只走 Ace/BBA 明文源）

---

## Step A 记录：走明文源 + 加密源友好提示（2026-09-26）

**目标**：让项目直接可用（BBA/Ace/IMDB/qsvip/seven 等明文源），加密源（Ksvideo/Dong → mmt.php）返回清晰错误。

**修改**：`edge-functions/api/play.js` 新增 `isEncryptedResponse()` 检测

**判断规则**：
1. 非 JSON 结构（不以 `{` 或 `[` 开头）
2. 纯 base64 字符（含 URL-safe 变体 `A-Za-z0-9+/=_-`）
3. 长度 100-500 chars
4. 长度接近 4 的倍数（base64 特性）
5. 无 URL 特征（不含 `://` / `.` / `#`）

**测试验证**：
```
mmt cipher      → true    ✓（344 chars base64）
json response   → false   ✓（"{\"code\":1,...")
empty           → false   ✓
direct url      → false   ✓（"https://..."）
```

**返回格式**（加密源被命中时）：
```json
{
  "movie": "308179",
  "source": "Ksvideo",
  "episode": 1,
  "error": "encrypted_source",
  "msg": "源 'Ksvideo' 使用客户端加密（mmt.php），当前无法解密。请切换到其他源（BBA/Ace/IMDB/qsvip 等）。",
  "hint": "该源需逆向 mmys.app 客户端 AES-128 密钥，见 HANDOFF.md"
}
```

**Git 提交**：`992a820 feat(play): 加密源响应检测与友好错误提示`

**当前项目状态**：
- ✅ BBA 源：可用（bt.php → JSON）
- ✅ Ace 源：可用（ace.php → JSON）
- ✅ IMDB/qsvip/qingshan 源：可用（xd.php → JSON）
- ✅ bytedance 源：可用（mtbytedance.php → JSON）
- ✅ mgtv/qq/youku/qiyi 源：可用（gf2.php → JSON）
- ✅ seven 源：可用（za.php → JSON）
- ⚠️ Ksvideo 源：加密，返回清晰错误（原 mmt.php → base64 密文）

**未测试**：项目未部署到 EdgeOne Pages，无法实测 `/api/play?source=Ksvideo` 端点。本地 Node.js 单测通过。

**下一步**：进入 Step B（装 radare2 反汇编 libapp.so）

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
| 2026-09-26 | Step 1: 扫描 APK 本地存储/硬编码密钥，0 命中；发现唯一加密 config.bin | Gloria |
| 2026-09-26 | Step 2: s.a.a() 复刻 + 330 组密钥候选试解密 mmt.php，0 命中；静态路线走尽 | Gloria |
| 2026-09-26 | Step C: 尝试解 config.bin（满熵加密，非简单 XOR），55 个 libapp.so hex 密钥候选全部 0 命中 | Gloria |
| 2026-09-26 | Step A: play.js 新增 isEncryptedResponse 检测，加密源返回友好错误；BBA/Ace/IMDB 等 6 类明文源可用 | Gloria |

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
