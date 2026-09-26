// edge-functions/index.js — GET /
// 根路径处理器：把 public/index.html 作为首页返回。
//
// EdgeOne Pages 部署并不会自动把 public/*.html 映射到 URL 根路径；
// 需要在 edge-functions/ 下显式提供同名 handler。
// 为了让这个 handler 在任意 bundler 下都能工作（不依赖 workers-assets
// 或 sourceURL 之类的扩展），这里直接内联 HTML 字符串到 bundle 里。
//
// 构建时（npm run build）如果改了 public/index.html，需要同步刷新这里
// 的内嵌块，或者用 tools/gen_index_js.mjs 一键重新生成。

const INDEX_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Mmys-API · 苹果 CMS V10 解析 API</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#0b0f17;--panel:#131822;--panel2:#0f1420;--line:#232b3a;--fg:#e6edf3;--dim:#8b97a8;--acc:#7dd3fc;--acc2:#38bdf8;--ok:#34d399;--warn:#fbbf24;--err:#f87171;--code:#0d1117}
html,body{background:var(--bg);color:var(--fg);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;line-height:1.6}
.wrap{max-width:1180px;margin:0 auto;padding:28px 22px 80px}
header{padding:32px 0 20px;border-bottom:1px solid var(--line);margin-bottom:26px}
.brand{display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.logo{width:44px;height:44px;border-radius:11px;background:linear-gradient(135deg,#38bdf8,#818cf8);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:18px;color:#0b0f17}
h1{font-size:24px;font-weight:700;letter-spacing:.3px}
h1 .v{font-size:12px;color:var(--dim);font-weight:400;margin-left:10px;padding:3px 8px;border:1px solid var(--line);border-radius:20px;vertical-align:middle}
.sub{color:var(--dim);margin-top:6px;font-size:14px}
.pills{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px}
.pill{padding:6px 12px;border-radius:20px;background:var(--panel);border:1px solid var(--line);font-size:12px;color:var(--acc);text-decoration:none;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.pill:hover{border-color:var(--acc);color:#fff}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:14px 0 24px}
@media(max-width:820px){.grid{grid-template-columns:1fr}}
.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px 18px}
.card h3{font-size:13px;color:var(--acc);margin-bottom:10px;font-weight:600;text-transform:uppercase;letter-spacing:.6px;display:flex;align-items:center;gap:8px}
.card h3 .k{font-family:ui-monospace,monospace;font-size:11px;color:var(--dim);background:var(--panel2);padding:2px 6px;border-radius:4px;border:1px solid var(--line);text-transform:none}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--dim);font-weight:500;font-size:11px;text-transform:uppercase;letter-spacing:.5px}
code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.5px}
code{background:var(--code);padding:2px 6px;border-radius:4px;color:#7dd3fc;border:1px solid var(--line)}
pre{background:var(--code);border:1px solid var(--line);border-radius:8px;padding:12px 14px;overflow:auto;white-space:pre;color:#d1d5db}
pre .c{color:var(--dim)}
pre .k{color:#7dd3fc}
pre .s{color:#34d399}
pre .n{color:#fbbf24}
pre .e{color:#f87171}
details{background:var(--panel2);border:1px solid var(--line);border-radius:8px;margin:8px 0;overflow:hidden}
summary{padding:9px 14px;cursor:pointer;color:var(--dim);font-size:13px;list-style:none;user-select:none;display:flex;align-items:center;gap:8px}
summary::-webkit-details-marker{display:none}
summary:before{content:"▶";color:var(--acc);transition:transform .15s;font-size:10px}
details[open] summary:before{transform:rotate(90deg)}
summary:hover{color:var(--fg)}
.tag{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;font-family:ui-monospace,monospace}
.t-get{background:#0e2c4d;color:#7dd3fc;border:1px solid #1e4470}
.t-post{background:#0d3224;color:#34d399;border:1px solid #195a3f}
.t-del{background:#3d1414;color:#f87171;border:1px solid #6b2020}
.t-note{background:#2a2410;color:#fbbf24;border:1px solid #4a3f1a}
.mono{font-family:ui-monospace,monospace}
.endpoint{background:var(--panel2);border-left:3px solid var(--acc2);border-radius:6px;padding:10px 14px;margin:12px 0}
.endpoint .path{font-family:ui-monospace,monospace;color:var(--acc);font-size:14px;font-weight:600}
.endpoint .desc{color:var(--dim);font-size:12px;margin-top:4px}
.footer{margin-top:44px;padding:20px 0;border-top:1px solid var(--line);color:var(--dim);font-size:12px;text-align:center}
.footer a{color:var(--acc);text-decoration:none}
.copy{font-size:11px;color:var(--dim);margin-left:auto;cursor:pointer;border:1px solid var(--line);padding:2px 8px;border-radius:4px;background:transparent;font-family:ui-monospace,monospace}
.copy:hover{color:var(--acc);border-color:var(--acc)}
.kv{display:grid;grid-template-columns:130px 1fr;gap:6px 12px;font-size:13px}
.kv .k{color:var(--dim)}
.kv .v{color:var(--fg);font-family:ui-monospace,monospace;word-break:break-all}
.badge{display:inline-block;padding:1px 7px;border-radius:4px;font-size:11px;background:var(--panel2);border:1px solid var(--line);color:var(--dim);margin-right:4px}
hr{border:none;border-top:1px solid var(--line);margin:20px 0}
</style>
</head>
<body>
<div class="wrap">
<header>
  <div class="brand">
    <div class="logo">M</div>
    <div>
      <h1>Mmys-API <span class="v" id="ver">v-</span></h1>
      <div class="sub">苹果 CMS V10 兼容解析 API · 反代短剧聚合站播放接口 · 学习研究用途</div>
    </div>
  </div>
  <div class="pills">
    <a class="pill" href="/api/catalog">/api/catalog</a>
    <a class="pill" href="/api/appcms">/api/appcms</a>
    <a class="pill" href="/api/appcms?ac=detail&amp;ids=__FIRST_ID__">detail</a>
    <a class="pill" href="/health">/health</a>
  </div>
</header>

<section class="card">
<h3>一句话说明</h3>
<p>这是一个跑在 <span class="badge">EdgeOne Pages</span> 上的纯前端 Worker：把短剧平台的 <code>/parse_api</code> 接口反代过来，转换成苹果 CMS V10 标准 <code>ac=detail</code> 响应；同时提供 <code>/api/play</code> 做二次解析拿到直连 m3u8/mp4。</p>
<p style="margin-top:8px"><span class="tag t-note">用途</span> 仅供个人学习研究抓包 / 反代技术，遵守平台服务条款与版权边界。请勿商用。</p>
</section>

<section class="grid" style="margin-top:14px">
  <div class="card">
    <h3>服务状态 <span class="k" id="status">checking…</span></h3>
    <div class="kv" id="health-kv">
      <div class="k">-</div><div class="v">-</div>
    </div>
  </div>
  <div class="card">
    <h3>接入方式</h3>
    <p style="font-size:13px">
      苹果 CMS 客户端直接配置 baseURL = <code id="host">$HOST</code>，
      然后在资源站配置里把采集地址指向 <code>/api/appcms</code> 即可。
    </p>
    <details>
      <summary>苹果 CMS 后台配置示例</summary>
      <pre><span class="c"># 采集地址</span>
http://<span class="s">$HOST</span>/api/appcms<span class="c">?pg=1</span>
<span class="c"># 详情接口（可选）</span>
http://<span class="s">$HOST</span>/api/appcms?ac=detail&amp;ids=__FIRST_ID__</pre>
    </details>
  </div>
</section>

<section class="card" style="margin-top:14px">
<h3>API 端点一览</h3>
<table>
<thead><tr><th style="width:80px">方法</th><th style="width:220px">路径</th><th>用途</th></tr></thead>
<tbody>
<tr><td><span class="tag t-get">GET</span></td><td class="mono">/api/catalog</td><td>完整片库（含每集 token），供前端调试用</td></tr>
<tr><td><span class="tag t-get">GET</span></td><td class="mono">/api/appcms</td><td><b>苹果 CMS V10 采集接口</b>（list / detail / type / wd 查询）</td></tr>
<tr><td><span class="tag t-get">GET</span></td><td class="mono">/api/play</td><td>反代 <code>parse_api</code>，返回直连 m3u8/mp4（可代理 / 302 直连）</td></tr>
<tr><td><span class="tag t-post">POST</span></td><td class="mono">/api/import</td><td>从短剧平台导入一部剧（需要 token 与 UA）</td></tr>
<tr><td><span class="tag t-del">DEL</span></td><td class="mono">/api/delete/:id</td><td>从数据库删除某部剧</td></tr>
<tr><td><span class="tag t-get">GET</span></td><td class="mono">/api/reimport/:id</td><td>重新解析某部剧（token 过期时用）</td></tr>
<tr><td><span class="tag t-get">GET</span></td><td class="mono">/api/import-all</td><td>批量导入当前 catalog.json 里所有 id</td></tr>
<tr><td><span class="tag t-get">GET</span></td><td class="mono">/api/stats</td><td>解析缓存、Turso 用量统计</td></tr>
<tr><td><span class="tag t-get">GET</span></td><td class="mono">/health</td><td>健康检查（version / turso / 片数）</td></tr>
</tbody>
</table>
</section>

<section class="card" style="margin-top:14px">
<h3>苹果 CMS V10 完整文档</h3>
<p style="color:var(--dim);font-size:13px;margin-bottom:12px">分类字典与 <span class="badge">mmys.app</span> 官方客户端一致（8 类顶级导航）。list 用逗号分隔 8 字段，detail 用 <code>$$$</code> 分隔源、<code>#</code> 分隔集，每集格式 <code>集名$url</code>。</p>

<div class="endpoint">
  <div><span class="tag t-get">GET</span> <span class="path">/api/appcms</span></div>
  <div class="desc">苹果 CMS 采集主入口。默认返回 list 页。</div>
</div>

<h3 style="color:var(--dim);font-size:12px;margin:14px 0 8px">参数</h3>
<table>
<thead><tr><th style="width:120px">参数</th><th style="width:80px">类型</th><th>说明</th></tr></thead>
<tbody>
<tr><td class="mono">ac</td><td>string</td><td>动作。<code>detail</code> 返回详情；缺省返回 list；<code>list</code> 别名。</td></tr>
<tr><td class="mono">page / pg</td><td>int</td><td>页码（默认 1）</td></tr>
<tr><td class="mono">limit</td><td>int</td><td>每页数量（默认 20，最大 100）</td></tr>
<tr><td class="mono">type_id / class_id</td><td>int</td><td>分类 id（mmys.app 8 类）：<code>1</code>=电影，<code>2</code>=剧集，<code>3</code>=综艺，<code>4</code>=动漫，<code>58</code>=直播，<code>62</code>=少儿，<code>63</code>=短剧，<code>64</code>=漫剧。留空=全部。</td></tr>
<tr><td class="mono">wd</td><td>string</td><td>按片名模糊搜索（不区分大小写）</td></tr>
<tr><td class="mono">ids</td><td>string</td><td><b>仅 ac=detail 有效</b>。逗号分隔多个 vod id，例如 <code>19067,308179</code></td></tr>
</tbody>
</table>

<h3 style="color:var(--dim);font-size:12px;margin:14px 0 8px">list 响应</h3>
<pre>{
  <span class="k">"code"</span>: <span class="n">1</span>,
  <span class="k">"msg"</span>: <span class="s">"数据列表"</span>,
  <span class="k">"page"</span>: <span class="n">1</span>, <span class="k">"pagecount"</span>: <span class="n">1</span>, <span class="k">"limit"</span>: <span class="n">20</span>, <span class="k">"total"</span>: <span class="n">3</span>,
  <span class="k">"class"</span>: [{<span class="k">"type_id"</span>:<span class="n">1</span>,<span class="k">"type_pid"</span>:<span class="n">0</span>,<span class="k">"type_name"</span>:<span class="s">"电影"</span>},{<span class="k">"type_id"</span>:<span class="n">2</span>,<span class="k">"type_pid"</span>:<span class="n">0</span>,<span class="k">"type_name"</span>:<span class="s">"剧集"</span>},{<span class="k">"type_id"</span>:<span class="n">3</span>,<span class="k">"type_pid"</span>:<span class="n">0</span>,<span class="k">"type_name"</span>:<span class="s">"综艺"</span>},{<span class="k">"type_id"</span>:<span class="n">4</span>,<span class="k">"type_pid"</span>:<span class="n">0</span>,<span class="k">"type_name"</span>:<span class="s">"动漫"</span>},{<span class="k">"type_id"</span>:<span class="n">58</span>,<span class="k">"type_pid"</span>:<span class="n">0</span>,<span class="k">"type_name"</span>:<span class="s">"直播"</span>},{<span class="k">"type_id"</span>:<span class="n">62</span>,<span class="k">"type_pid"</span>:<span class="n">0</span>,<span class="k">"type_name"</span>:<span class="s">"少儿"</span>},{<span class="k">"type_id"</span>:<span class="n">63</span>,<span class="k">"type_pid"</span>:<span class="n">0</span>,<span class="k">"type_name"</span>:<span class="s">"短剧"</span>},{<span class="k">"type_id"</span>:<span class="n">64</span>,<span class="k">"type_pid"</span>:<span class="n">0</span>,<span class="k">"type_name"</span>:<span class="s">"漫剧"</span>}],
  <span class="k">"list"</span>: [
    <span class="c">// 精简 8 字段对象</span>
    {<span class="k">"vod_id"</span>:<span class="n">19067</span>,<span class="k">"vod_name"</span>:<span class="s">"师兄太稳健"</span>,<span class="k">"type_id"</span>:<span class="n">2</span>,<span class="k">"type_name"</span>:<span class="s">"剧集"</span>,<span class="k">"vod_remarks"</span>:<span class="s">"30集全"</span>,<span class="k">"vod_play_from"</span>:<span class="s">"BBA,bytedance,youku"</span>}
  ]
}</pre>

<h3 style="color:var(--dim);font-size:12px;margin:14px 0 8px">detail 响应</h3>
<pre>{
  <span class="k">"code"</span>: <span class="n">1</span>, <span class="k">"msg"</span>: <span class="s">"详细信息"</span>,
  <span class="k">"class"</span>: [...],
  <span class="k">"list"</span>: [{
    <span class="c">// 83 字段，常用几个：</span>
    <span class="k">"vod_id"</span>: <span class="n">19067</span>,
    <span class="k">"type_id"</span>: <span class="n">2</span>, <span class="k">"type_id_1"</span>: <span class="n">2</span>, <span class="k">"type_name"</span>: <span class="s">"剧集"</span>,
    <span class="k">"vod_name"</span>: <span class="s">"师兄太稳健"</span>,
    <span class="k">"vod_area"</span>: <span class="s">"大陆"</span>,
    <span class="k">"vod_year"</span>: <span class="s">"2026"</span>,
    <span class="k">"vod_class"</span>: <span class="s">"奇幻,古装,电视,连续"</span>,
    <span class="k">"vod_remarks"</span>: <span class="s">"30集全"</span>,
    <span class="k">"vod_play_from"</span>: <span class="s">"BBA$$$bytedance$$$youku"</span>,       <span class="c">// $$$ 分隔源</span>
    <span class="k">"vod_play_server"</span>: <span class="s">"no$$$no$$$no"</span>,
    <span class="k">"vod_play_url"</span>: <span class="s">"第01集$/api/play?...$$$第01集$/api/play?...$$$..."</span>
    <span class="c">// $$$ 分隔源；# 分隔集；每集 name$url</span>
  }]
}</pre>

<details>
<summary>分隔符约定</summary>
<div style="padding:0 14px 12px">
<table>
<thead><tr><th>位置</th><th>分隔符</th><th>备注</th></tr></thead>
<tbody>
<tr><td>list 行内</td><td><code>,</code> 逗号</td><td>8 字段</td></tr>
<tr><td>detail 字段间</td><td><code>$$$</code></td><td>源之间</td></tr>
<tr><td>detail 集内</td><td><code>#</code></td><td>集之间</td></tr>
<tr><td>每集内部</td><td><code>name$url</code></td><td>URL 前的部分是集名</td></tr>
</tbody>
</table>
</div>
</details>
</section>

<section class="card" style="margin-top:14px">
<h3>播放器使用</h3>
<p style="color:var(--dim);font-size:13px">拿到 detail 之后，把每一集的 token 交给 <code>/api/play</code> 换直连地址。支持三种模式：</p>
<div class="endpoint">
  <div><span class="tag t-get">GET</span> <span class="path">/api/play?movie=__FIRST_ID__&amp;source=BBA&amp;episode=1</span></div>
  <div class="desc">默认：反代 m3u8，把分段 URL 重写到 <code>/api/seg</code>。可直接丢给播放器。</div>
</div>
<table>
<thead><tr><th style="width:140px">参数</th><th>行为</th></tr></thead>
<tbody>
<tr><td class="mono">raw=1</td><td>302 直连原 URL（最省流量，但播放器需带 UA / Range）</td></tr>
<tr><td class="mono">redirect=1</td><td>同 raw=1</td></tr>
<tr><td class="mono">refresh=1</td><td>跳过缓存强制重新解析（token 过期时用）</td></tr>
</tbody>
</table>

<details>
<summary>MPV 命令行</summary>
<div style="padding:0 14px 12px">
<pre><span class="c"># 默认反代模式</span>
mpv <span class="s">"http://$HOST/api/play?movie=__FIRST_ID__&amp;source=BBA&amp;episode=1"</span>

<span class="c"># 直连原 URL（需手动带 UA）</span>
mpv --user-agent=<span class="s">"Dart/3.13 (dart:io)"</span> \
    <span class="s">"http://$HOST/api/play?movie=__FIRST_ID__&amp;source=BBA&amp;episode=1&amp;raw=1"</span></pre>
</div>
</details>

<details>
<summary>VLC（Windows/macOS/Linux）</summary>
<div style="padding:0 14px 12px">
<p style="font-size:13px;color:var(--dim)">菜单 → 工具 → 首选项 → 网络 → 用户代理，填 <code>Dart/3.13 (dart:io)</code>。然后用 raw 模式地址即可。</p>
<pre>vlc <span class="s">"http://$HOST/api/play?movie=__FIRST_ID__&amp;source=BBA&amp;episode=1&amp;raw=1"</span></pre>
</div>
</details>

<details>
<summary>TVBox / 电视家</summary>
<div style="padding:0 14px 12px">
<pre>{
  <span class="k">"app":</span> { <span class="k">"name"</span>: <span class="s">"MmysAPI"</span> },
  <span class="k">"spider"</span>: <span class="s">"http://$HOST/api/appcms"></span>
}</pre>
<p style="font-size:12px;color:var(--dim)">把 <code>spider</code> 指向采集接口即可，TVBox 会自动按苹果 CMS 协议拉片库与详情。</p>
</div>
</details>
</section>

<section class="card" style="margin-top:14px">
<h3>运维端点</h3>
<table>
<thead><tr><th>路径</th><th>用途</th><th>注意</th></tr></thead>
<tbody>
<tr><td class="mono">/health</td><td>版本、Turso 连通、片库规模、缓存大小</td><td>无鉴权</td></tr>
<tr><td class="mono">/api/stats</td><td>解析缓存命中率、backoff 状态</td><td>无鉴权</td></tr>
<tr><td class="mono">/api/import</td><td>导入一部剧（HAR 抓到什么就导什么）</td><td>POST + body JSON</td></tr>
<tr><td class="mono">/api/import-all</td><td>从 catalog.json 批量导入所有 id</td><td>会重刷 token</td></tr>
<tr><td class="mono">/api/reimport/:id</td><td>重新解析单部（token 过期时用）</td><td>-</td></tr>
<tr><td class="mono">/api/delete/:id</td><td>删除某部（数据库）</td><td>破坏性</td></tr>
</tbody>
</table>
<p style="font-size:12px;color:var(--dim);margin-top:8px">以上端点均无鉴权，请自行控制暴露面。生产环境建议套一层 Cloudflare WAF / 反向代理访问控制。</p>
</section>

<section class="card" style="margin-top:14px">
<h3>环境变量</h3>
<table>
<thead><tr><th>名称</th><th>必填</th><th>默认</th><th>说明</th></tr></thead>
<tbody>
<tr><td class="mono">TURSO_DATABASE_URL</td><td>是</td><td>-</td><td>Turso 数据库 URL（libsql://…）</td></tr>
<tr><td class="mono">TURSO_AUTH_TOKEN</td><td>是</td><td>-</td><td>Turso auth token</td></tr>
<tr><td class="mono">MYS_CACHE_TTL</td><td>否</td><td>1800</td><td>解析缓存 TTL（秒）</td></tr>
<tr><td class="mono">MYS_PARSE_TIMEOUT</td><td>否</td><td>20000</td><td>解析请求超时（毫秒）</td></tr>
<tr><td class="mono">MYS_STREAM_TIMEOUT</td><td>否</td><td>30000</td><td>分段代理超时（毫秒）</td></tr>
</tbody>
</table>
<p style="font-size:12px;color:var(--dim);margin-top:8px">未配置 Turso 时会自动 fallback 到 worker 内置的 <code>catalog_data.js</code>（3 部片 / 434 集），仍可正常测试。</p>
</section>

<div class="footer">
  Mmys-API · 学习研究用途，请勿商用 · <a href="https://github.com/Theadvocate-bit/mmys-api">GitHub</a> · <a href="https://www.tencentcloud.com/product/edgeone">EdgeOne</a>
</div>
</div>

<script>
// 客户端替换 $HOST 与 __FIRST_ID__
(function(){
  const host = location.hostname + (location.port ? ':' + location.port : '');
  document.querySelectorAll('[id="host"]').forEach(el => el.textContent = host);
  document.querySelectorAll('code').forEach(el => {
    if (el.textContent && el.textContent.includes('$HOST')) el.textContent = el.textContent.replace(/\$HOST/g, host);
  });
  // 抓 catalog 拿首片 id，替换所有 __FIRST_ID__
  fetch('/api/catalog').then(r => r.ok ? r.json() : null).then(d => {
    const firstId = d && d.movies && d.movies[0] ? d.movies[0].id : '';
    if (!firstId) return;
    document.querySelectorAll('a, code, span').forEach(el => {
      if (el.textContent && el.textContent.includes('__FIRST_ID__')) {
        el.innerHTML = el.innerHTML.replace(/__FIRST_ID__/g, firstId);
      }
      if (el.getAttribute && el.getAttribute('href') && el.getAttribute('href').includes('__FIRST_ID__')) {
        el.setAttribute('href', el.getAttribute('href').replace(/__FIRST_ID__/g, firstId));
      }
    });
  }).catch(() => {});
  // 抓 health
  fetch('/health').then(r => r.json()).then(d => {
    const el = document.getElementById('ver');
    if (el) el.textContent = 'v' + d.version;
    const st = document.getElementById('status');
    if (st) {
      st.textContent = d.turso ? 'Turso 已连接' : '内嵌片库模式';
      st.style.color = d.turso ? 'var(--ok)' : 'var(--warn)';
    }
    const kv = document.getElementById('health-kv');
    if (kv) {
      kv.innerHTML = '<div class="k">version</div><div class="v">v' + d.version + '</div>'
        + '<div class="k">movies</div><div class="v">' + (d.movies || 0) + (d.movies_in_db !== undefined ? ' (db:' + d.movies_in_db + ')' : '') + '</div>'
        + '<div class="k">turso</div><div class="v">' + (d.turso ? 'connected' : 'embedded') + '</div>'
        + '<div class="k">cache</div><div class="v">' + (d.cache_size || 0) + ' entries</div>';
    }
  }).catch(() => {});
})();
</script>
</body>
</html>`;

export async function onRequest(context) {
  const { request } = context;

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }
  if (request.method !== "GET") {
    return new Response("method not allowed", { status: 405 });
  }

  return new Response(INDEX_HTML, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}
