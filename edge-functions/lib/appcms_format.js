// edge-functions/lib/appcms_format.js — 苹果 CMS V10 API 格式化
//
// 严格对齐标准 /api.php/provide/vod 规范（参考：hongniuzy2 / bfzy / dyttzy）：
//
//   顶层：{ code, msg, page, pagecount, limit, total, list, class }
//   class：[{ type_id, type_name }, ...]，始终附带
//
//   列表项（默认）：精简 8 字段
//     { vod_id, vod_name, type_id, type_name, vod_en, vod_time,
//       vod_remarks, vod_play_from }
//     vod_play_from = "hnyun,hnm3u8"     ← 逗号分隔
//
//   详情项（?ac=detail&ids=...）：83 字段（含元数据、播放、下载）
//     vod_play_from = "hnyun$$$hnm3u8"   ← $$$ 分隔
//     vod_play_url  = "第01集$URL#第02集$URL$$$第01集$URL#第02集$URL"
//                       ↑集间↑ ↑集名$URL↑  ↑源间↑
//
// 与旧格式的破坏性变更：
//   • vod_play_from 分隔符 ###  → , / $$$
//   • vod_play_url  源 ###  → $$$；集 $$$  → #
//   • 详情结构 { data: {...} }  → { list: [{...}] }
//   • 新增顶层 class 数组
//   • 移除 categories=1 参数（class 数组已始终返回）
//   • type_id / class_id 均可用作分类过滤

// 集内部分隔符（集名$URL）
const EP_SEP = "#";
// 源间分隔符（详情 vod_play_from / vod_play_url）
const SRC_SEP = "$$$";
// 列表 vod_play_from 逗号分隔
const SRC_SEP_LIST = ",";

function pad2(n) {
  return String(n).padStart(2, "0");
}

// 拼音首字母表（用于 vod_letter 兜底）
const PinyinInitials = {
  "一": "Y", "二": "E", "三": "S", "四": "S", "五": "W", "六": "L",
  "七": "Q", "八": "B", "九": "J", "十": "S",
};

// 提取英文首字母或汉字拼音首字母（简化版）
function getLetter(name) {
  if (!name) return "";
  const c = name.trim().charAt(0);
  if (/[A-Za-z]/.test(c)) return c.toUpperCase();
  if (PinyinInitials[c]) return PinyinInitials[c];
  // 兜底：尝试提取第一个可 ASCII 化的字符
  const m = name.match(/[A-Za-z]/);
  return m ? m[0].toUpperCase() : "Z";
}

// 苹果 CMS V10 通用分类字典（源自 hongniu/bfzy/dytt 三家的 class 数组）
// type_id → type_name；仅包含主分类（1–46），不重复子分类。
export const TYPE_MAP = {
  1: "电影",
  2: "连续剧",
  3: "综艺",
  4: "动漫",
  5: "动作片",
  6: "喜剧片",
  7: "爱情片",
  8: "科幻片",
  9: "恐怖片",
  10: "剧情片",
  11: "战争片",
  12: "国产剧",
  13: "港澳剧",
  14: "日剧",
  15: "欧美剧",
  16: "台湾剧",
  17: "泰剧",
  18: "韩剧",
  19: "纪录片",
  20: "动漫电影",
  21: "伦理片",
  29: "体育赛事",
  30: "短剧",
  31: "预告片",
  32: "足球",
  33: "篮球",
  34: "台球",
  35: "其他赛事",
  36: "中国动漫",
  37: "日本动漫",
  38: "欧美动漫",
  39: "大陆综艺",
  40: "日韩综艺",
  41: "港台综艺",
  42: "欧美综艺",
  43: "古装仙侠",
  44: "现代都市",
  45: "穿越年代",
  46: "言情总裁",
};

// 生成 type_id 列表：
//   • 优先使用 TYPE_MAP 中的标准中文名（保证 type_name 与外部苹果 CMS 一致）
//   • 未知 type_id 从 vod_class 首段兜底
export function getAllCategories(vods) {
  const seen = new Map();
  for (const v of vods) {
    const tid = Number(v.type_id);
    if (!Number.isInteger(tid) || tid <= 0) continue;
    if (seen.has(tid)) continue;
    const stdName = TYPE_MAP[tid];
    const fallback = (v.vod_class || "").split(",")[0] || "";
    seen.set(tid, { type_id: tid, type_name: stdName || fallback });
  }
  return Array.from(seen.values()).sort((a, b) => a.type_id - b.type_id);
}

// 按 type_id 过滤（支持逗号分隔多 id）
export function filterByClass(vods, classId) {
  const ids = String(classId || "")
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!ids.length) return vods;
  return vods.filter((v) => ids.includes(String(v.type_id)));
}

function toInt(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

// 从 vod 提取标准分类名（优先 TYPE_MAP，兜底 vod_class 首段）
function typeOf(vod) {
  const tid = Number(vod.type_id);
  if (Number.isInteger(tid) && tid > 0) {
    return {
      type_id: tid,
      type_name: TYPE_MAP[tid] || (vod.vod_class || "").split(",")[0] || "",
    };
  }
  return {
    type_id: 0,
    type_name: (vod.vod_class || "").split(",")[0] || "",
  };
}

// 列表项：精简 8 字段
export function vodToListItem(vod) {
  const sources = vod.sources || {};
  const codes = Object.keys(sources);
  const t = typeOf(vod);
  return {
    vod_id: toInt(vod.vod_id) ?? String(vod.id),
    vod_name: vod.name || "",
    type_id: t.type_id,
    type_name: t.type_name,
    vod_en: vod.vod_en || "",
    vod_time: vod.vod_time || vod.imported_at || "",
    vod_remarks: vod.vod_remarks || "",
    vod_play_from: codes.join(SRC_SEP_LIST),
  };
}

// 详情项：83 字段
export function vodToDetail(vod, origin) {
  const sources = vod.sources || {};
  const codes = Object.keys(sources);
  const vodInfo = vod.vod_info || {};
  const t = typeOf(vod);

  const playFrom = codes.join(SRC_SEP);

  // 每个源：集内用 # 分隔，每集格式 name$url
  const playUrls = codes.map((code) => {
    const s = sources[code];
    const episodes = s.episodes || {};
    const epNames = s.episode_names || {};
    const epKeys = Object.keys(episodes).sort((a, b) => Number(a) - Number(b));
    return epKeys
      .map((ep) => {
        const epName = epNames[ep] || `第${pad2(ep)}集`;
        const playUrl = `${origin}/api/play?movie=${encodeURIComponent(vod.id)}&source=${encodeURIComponent(code)}&episode=${ep}`;
        return `${epName}$${playUrl}`;
      })
      .join(EP_SEP);
  });
  const playUrl = playUrls.join(SRC_SEP);

  return {
    vod_id: toInt(vod.vod_id) ?? String(vod.id),
    type_id: t.type_id,
    type_id_1: t.type_id,
    group_id: 0,
    vod_name: vod.name || "",
    vod_sub: vod.vod_sub || "",
    vod_en: vod.vod_en || "",
    vod_status: 1,
    vod_letter: getLetter(vod.name || ""),
    vod_color: "",
    vod_tag: vod.vod_tag || "",
    vod_class: vod.vod_class || "",
    vod_pic: vod.vod_pic || "",
    vod_pic_thumb: "",
    vod_pic_slide: "",
    vod_pic_screenshot: null,
    vod_actor: vod.vod_actor || vodInfo.vod_actor || "",
    vod_director: vod.vod_director || vodInfo.vod_director || "",
    vod_writer: "",
    vod_behind: "",
    vod_blurb: vod.vod_blurb || "",
    vod_remarks: vod.vod_remarks || "",
    vod_pubdate: vod.vod_pubdate || vodInfo.vod_pubdate || "",
    vod_total: 1,
    vod_serial: "0",
    vod_tv: "",
    vod_weekday: "",
    vod_area: vod.vod_area || vodInfo.vod_area || "",
    vod_lang: vodInfo.vod_lang || "",
    vod_year: vod.vod_year || vodInfo.vod_year || "",
    vod_version: "",
    vod_state: "",
    vod_author: "",
    vod_jumpurl: "",
    vod_tpl: "",
    vod_tpl_play: "",
    vod_tpl_down: "",
    vod_isend: 0,
    vod_lock: 0,
    vod_level: 0,
    vod_copyright: 0,
    vod_points: 0,
    vod_points_play: 0,
    vod_points_down: 0,
    vod_hits: 0,
    vod_hits_day: 0,
    vod_hits_week: 0,
    vod_hits_month: 0,
    vod_duration: "",
    vod_up: 0,
    vod_down: 0,
    vod_score: vodInfo.vod_score || "",
    vod_score_all: 0,
    vod_score_num: 0,
    vod_time: vod.vod_time || vod.imported_at || "",
    vod_time_add: 0,
    vod_time_hits: 0,
    vod_time_make: 0,
    vod_trysee: 0,
    vod_douban_id: vod.vod_douban_id || vodInfo.vod_douban_id || "",
    vod_douban_score: vod.vod_douban_score || vodInfo.vod_douban_score || "",
    vod_reurl: "",
    vod_rel_vod: "",
    vod_rel_art: "",
    vod_pwd: "",
    vod_pwd_url: "",
    vod_pwd_play: "",
    vod_pwd_play_url: "",
    vod_pwd_down: "",
    vod_pwd_down_url: "",
    vod_content: vod.vod_content || vodInfo.vod_content || "",
    vod_play_from: playFrom,
    vod_play_server: codes.map(() => "").join(SRC_SEP),
    vod_play_note: codes.map(() => "").join(SRC_SEP),
    vod_play_url: playUrl,
    vod_down_from: "",
    vod_down_server: "",
    vod_down_note: "",
    vod_down_url: "",
    vod_plot: 0,
    vod_plot_name: "",
    vod_plot_detail: "",
    type_name: t.type_name,
  };
}
