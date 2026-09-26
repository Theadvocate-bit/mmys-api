// edge-functions/lib/appcms_format.js — 苹果 CMS V10 API 格式化
//
// 严格对齐 ffzy5.tv 官方规范（https://ffzy5.tv/api.php/provide/vod）：
//
//   顶层：{ code, msg, page, pagecount, limit, total, list, class }
//   class：[{ type_id, type_pid, type_name }, ...]，全量 31 类
//     • type_pid=0 表示顶级（1 电影片 / 2 连续剧 / 3 综艺片 / 4 动漫片）
//     • 子类 type_pid 指向父类 id
//
//   列表项（默认）：精简 8 字段
//     { vod_id, vod_name, type_id, type_name, vod_en, vod_time,
//       vod_remarks, vod_play_from }
//     vod_play_from = "BBA,bytedance"     ← 逗号分隔
//
//   详情项（?ac=detail&ids=...）：83 字段
//     type_id    = 具体子类 id（如 13 国产剧）
//     type_id_1  = 父类 id（如 2 连续剧；顶级=0）
//     vod_play_from = "BBA$$$bytedance"   ← $$$ 分隔
//     vod_play_server = "no$$$no"         ← 每源占位 "no"
//     vod_play_url  = "第01集$URL#第02集$URL$$$第01集$URL#第02集$URL"
//                       ↑集间↑ ↑集名$URL↑  ↑源间↑
//
// 与旧格式的破坏性变更：
//   • vod_play_from 分隔符 ###  → , / $$$
//   • vod_play_url  源 ###  → $$$；集 $$$  → #
//   • 详情结构 { data: {...} }  → { list: [{...}] }
//   • 新增顶层 class 数组
//   • 分类字典对齐 ffzy5.tv（31 类，含 type_pid 层级）
//   • 详情新增 type_id_1（父类 id）字段
//   • vod_play_server 占位从空串改为 "no"
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

// 苹果 CMS V10 分类字典 — 完全对齐 ffzy5.tv 官方 31 类
// 参见 https://ffzy5.tv/api.php/provide/vod 返回的 class 数组。
// 顶级：1 电影片 / 2 连续剧 / 3 综艺片 / 4 动漫片
// 子类通过 TYPE_PARENT 反向映射到顶级 ID（详情字段 type_id_1 由此派生）。
export const TYPE_MAP = {
  1: "电影片",
  2: "连续剧",
  3: "综艺片",
  4: "动漫片",
  6: "动作片",
  7: "喜剧片",
  8: "爱情片",
  9: "科幻片",
  10: "恐怖片",
  11: "剧情片",
  12: "战争片",
  13: "国产剧",
  14: "香港剧",
  15: "韩国剧",
  16: "欧美剧",
  20: "记录片",
  21: "台湾剧",
  22: "日本剧",
  23: "海外剧",
  24: "泰国剧",
  25: "大陆综艺",
  26: "港台综艺",
  27: "日韩综艺",
  28: "欧美综艺",
  29: "国产动漫",
  30: "日韩动漫",
  31: "欧美动漫",
  32: "港台动漫",
  33: "海外动漫",
  34: "伦理片",
  36: "短剧",
};

// 子分类 → 父分类（type_id → type_pid；顶级 pid=0）
export const TYPE_PARENT = {
  1: 0, 2: 0, 3: 0, 4: 0,
  6: 1, 7: 1, 8: 1, 9: 1, 10: 1, 11: 1, 12: 1, 20: 1, 34: 1,
  13: 2, 14: 2, 15: 2, 16: 2, 21: 2, 22: 2, 23: 2, 24: 2, 36: 2,
  25: 3, 26: 3, 27: 3, 28: 3,
  29: 4, 30: 4, 31: 4, 32: 4, 33: 4,
};

// 生成分类字典（对齐 ffzy5.tv 的 class 数组结构）：
//   • 全量返回 TYPE_MAP 中定义的所有分类（无论数据是否命中，保持与 ffzy5.tv 一致）
//   • 每项：{ type_id, type_pid, type_name }
//   • 顶级 type_pid=0，子类指向父类 id（电影片/连续剧/综艺片/动漫片）
export function getAllCategories(_vods) {
  return Object.entries(TYPE_MAP)
    .map(([tid, name]) => {
      const id = Number(tid);
      return {
        type_id: id,
        type_pid: TYPE_PARENT[id] ?? 0,
        type_name: name,
      };
    })
    .sort((a, b) => a.type_id - b.type_id);
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
// 返回 { type_id, type_pid, type_name } — 供 list/detail 共同使用
function typeOf(vod) {
  const tid = Number(vod.type_id);
  if (Number.isInteger(tid) && tid > 0) {
    return {
      type_id: tid,
      type_pid: TYPE_PARENT[tid] ?? 0,
      type_name: TYPE_MAP[tid] || (vod.vod_class || "").split(",")[0] || "",
    };
  }
  return {
    type_id: 0,
    type_pid: 0,
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
    type_id_1: t.type_pid,
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
    vod_play_server: codes.map(() => "no").join(SRC_SEP),
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
