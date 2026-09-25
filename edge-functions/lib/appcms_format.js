// lib/appcms_format.js — 苹果 CMS V10 API 格式化函数
// 将内部 movie 对象转换为苹果 CMS V10 标准格式

/**
 * 将 movie 对象转换为苹果 CMS V10 格式
 * @param {Object} vod - movie 对象（来自 catalog_data.js 或 Turso）
 * @param {string} origin - 请求的 origin（用于构建播放 URL）
 * @returns {Object} 苹果 CMS V10 格式的 vod 对象
 */
export function vodToAppCms(vod, origin) {
  const sources = vod.sources || {};
  const sourceCodes = Object.keys(sources);

  // vod_play_from: 源名称用 ### 分隔
  const playFrom = sourceCodes
    .map((code) => sources[code].name || code)
    .join("###");

  // vod_play_url: 源用 ### 分隔，源内集用 $$$ 分隔，每集格式 名称$URL
  //
  // 优先使用服务器下发的原始集名（BBA: "第01集"，youku: "1"，
  // qsvip: "01"），缺失时回退到统一 "第XX集"。
  const playUrls = sourceCodes.map((code) => {
    const s = sources[code];
    const episodes = s.episodes || {};
    const epNames = s.episode_names || {};
    const epKeys = Object.keys(episodes).sort((a, b) => Number(a) - Number(b));
    return epKeys
      .map((ep) => {
        const epName = epNames[ep] || `第${pad2(ep)}集`;
        const playUrl = `${origin}/api/play?movie=${encodeURIComponent(vod.id)}&source=${encodeURIComponent(code)}&episode=${ep}`;
        return epName + '$' + playUrl;
      })
      .join("$$$");
  });
  const playUrl = playUrls.join("###");

  const vodInfo = vod.vod_info || {};

  return {
    vod_id: vod.vod_id,
    vod_name: vod.name || "",
    vod_pic: vod.vod_pic || "",
    type: String(vod.type_id || vod.vod_class || ""),
    remarks: vod.vod_remarks || "",
    vod_remarks: vod.vod_remarks || "",
    vod_class: vod.vod_class || "",
    vod_actor: vod.vod_actor || vodInfo.vod_actor || "",
    vod_director: vod.vod_director || vodInfo.vod_director || "",
    vod_area: vod.vod_area || vodInfo.vod_area || "",
    vod_lang: vodInfo.vod_lang || "",
    vod_year: vod.vod_year || vodInfo.vod_year || "",
    vod_time: vodInfo.vod_time || vod.imported_at || "",
    vod_pubdate: vod.vod_pubdate || vodInfo.vod_pubdate || "",
    vod_douban_id: vod.vod_douban_id || vodInfo.vod_douban_id || "",
    vod_douban_score: vod.vod_douban_score || vodInfo.vod_douban_score || "",
    vod_score: vodInfo.vod_score || "",
    vod_content: vod.vod_content || vodInfo.vod_content || "",
    vod_play_from: playFrom,
    vod_play_url: playUrl,
  };
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

/**
 * 从 vod_class 字符串中提取分类列表
 * 格式: "剧情,动作,冒险" → ["剧情", "动作", "冒险"]
 */
export function parseVodClass(classStr) {
  if (!classStr) return [];
  return classStr.split(/[,，]/).map(s => s.trim()).filter(Boolean);
}

/**
 * 根据 class_id 筛选片目
 * class_id 可以是数字（对应 vod_class 的第 N 个分类）或字符串（直接匹配分类名）
 */
export function filterByClass(movies, classId) {
  if (!classId) return movies;

  // 如果是数字，按索引筛选
  if (/^\d+$/.test(classId)) {
    const idx = parseInt(classId, 10);
    return movies.filter((m) => {
      const classes = parseVodClass(m.vod_class);
      return idx < classes.length;
    });
  }

  // 如果是字符串，直接匹配分类名
  return movies.filter((m) => {
    const classes = parseVodClass(m.vod_class);
    return classes.includes(classId);
  });
}

/**
 * 获取所有分类列表（去重）
 * @param {Array} movies - movie 数组
 * @returns {Array} [{class_id, class_name, count}]
 */
export function getAllCategories(movies) {
  const categories = new Set();
  for (const m of movies) {
    const classes = parseVodClass(m.vod_class);
    for (const c of classes) {
      categories.add(c);
    }
  }
  const sorted = Array.from(categories).sort();
  return sorted.map((c, i) => ({
    class_id: String(i),
    class_name: c,
    count: movies.filter((m) => parseVodClass(m.vod_class).includes(c)).length,
  }));
}

/**
 * 验证 vod_play_url 格式是否正确
 * 格式: 源1第01集$URL$$$源1第02集$URL###源2第01集$URL
 * @param {string} playUrl - vod_play_url 字符串
 * @returns {boolean} 格式是否正确
 */
export function validatePlayUrlFormat(playUrl) {
  if (!playUrl || typeof playUrl !== "string") return false;

  // 检查是否有 $$$ 分隔符（多集）或 ### 分隔符（多源）
  const hasPlaySeparator = playUrl.includes("$$$") || playUrl.includes("###");
  if (!hasPlaySeparator) {
    // 单集单源，检查是否有 $ 分隔符
    return playUrl.includes("$");
  }

  // 多源：检查每个源
  const sources = playUrl.split("###");
  for (const source of sources) {
    if (!source) continue; // 空字符串可能是末尾分隔符
    // 多集：检查每集
    const episodes = source.split("$$$");
    for (const ep of episodes) {
      if (!ep) continue;
      // 每集应该有 $ 分隔符（名称$URL）
      if (!ep.includes("$")) return false;
    }
  }
  return true;
}

/**
 * 验证苹果 CMS 响应格式是否完整
 * @param {Object} response - 苹果 CMS 响应对象
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateAppCmsResponse(response) {
  const errors = [];

  // 检查必需字段
  if (response.code === undefined) errors.push("missing code");
  if (response.msg === undefined) errors.push("missing msg");

  if (response.code === 1) {
    // 列表响应
    if (response.list === undefined) {
      // 可能是详情响应
      if (!response.data) errors.push("missing list or data");
    } else {
      if (!Array.isArray(response.list)) errors.push("list is not array");
      if (response.page === undefined) errors.push("missing page");
      if (response.pagecount === undefined) errors.push("missing pagecount");
      if (response.limit === undefined) errors.push("missing limit");
      if (response.total === undefined) errors.push("missing total");

      // 验证 list 中的每个 vod
      for (const vod of response.list || []) {
        if (!vod.vod_id) errors.push(`vod missing vod_id`);
        if (!vod.vod_name) errors.push(`vod ${vod.vod_id} missing vod_name`);
        if (!vod.vod_play_from) errors.push(`vod ${vod.vod_id} missing vod_play_from`);
        if (!vod.vod_play_url) errors.push(`vod ${vod.vod_id} missing vod_play_url`);

        // 验证播放 URL 格式
        if (vod.vod_play_url && !validatePlayUrlFormat(vod.vod_play_url)) {
          errors.push(`vod ${vod.vod_id} invalid vod_play_url format`);
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
