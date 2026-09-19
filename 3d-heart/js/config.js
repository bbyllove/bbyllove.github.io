/* ================================================================
 * 配置持久化（localStorage）：注册表模式
 * 各功能模块通过 registerConfig 注册自己的 save/load 切片，
 * config 本身不依赖任何功能模块，避免循环依赖与初始化顺序问题。
 * ================================================================ */
const CONFIG_KEY = 'heart3d-config-v1';
const handlers = [];

export { CONFIG_KEY };

export function registerConfig(handler) {
  handlers.push(handler);
}

// 汇总所有已注册模块的 save 切片为单个配置对象
export function currentConfigObject() {
  const data = {};
  for (const h of handlers) Object.assign(data, h.save());
  return data;
}

export function saveConfig() {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(currentConfigObject()));
  } catch (err) {
    /* 隐私模式等场景下忽略 */
  }
}

// 整体写入配置（导入 / 应用方案用），不做校验 —— 各模块 load 自行容错
export function writeRawConfig(obj) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(obj));
}

export function loadConfig() {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return;
    const cfg = JSON.parse(raw);
    for (const h of handlers) h.load(cfg);
  } catch (err) {
    /* 配置损坏时忽略 */
  }
}
