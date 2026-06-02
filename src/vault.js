/**
 * vault.js — MD 文件 vault 数据层
 *
 * 架构：
 *  - 每个任务 = 一个 .md 文件，包含 YAML frontmatter (元数据) + body (备注/描述)
 *  - 文件名 = slugified(title)，冲突时追加短 id 后缀
 *  - 文件名可变（仅展示用），frontmatter 中的 `id` 是唯一标识
 *  - 同一 id 多次写入会覆盖原文件（通过扫描 frontmatter 找 id 匹配的文件）
 *
 * 依赖：
 *  - Tauri: @tauri-apps/plugin-fs (读/写/列/建目录), @tauri-apps/plugin-store (vault 路径设置), @tauri-apps/plugin-dialog (选目录)
 *  - npm: js-yaml (YAML 解析/序列化), markdown-it (MD 渲染，业务层用)
 *
 * 浏览器/Node 降级：
 *  - 动态 import 失败时，使用 in-memory mock（便于 vite dev 无 Tauri 时仍可开发）
 */

import yaml from 'js-yaml';

// ============================================================
// Pure helpers — no I/O, safe to import anywhere
// ============================================================

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

/**
 * 解析 MD 文件的 YAML frontmatter 和 body。
 * 无 frontmatter 时 data={}，body=完整原文。
 * YAML 解析失败时抛出错误（调用方决定如何处理）。
 */
export function parseFrontmatter(md) {
  if (typeof md !== 'string') return { data: {}, body: '' };
  const match = md.match(FRONTMATTER_RE);
  if (!match) return { data: {}, body: md };
  const yamlText = match[1];
  const body = match[2];
  try {
    const data = yaml.load(yamlText) || {};
    if (typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('Frontmatter must be a YAML mapping');
    }
    // 强制 id 为字符串：YAML 里 `id: 1` 解析为 number，业务层统一为 string
    if (data.id != null) data.id = String(data.id);
    return { data, body };
  } catch (e) {
    throw new Error(`Frontmatter parse error: ${e.message}`);
  }
}

/**
 * 序列化为 MD 文本：---\nYAML\n---\nbody
 */
export function serializeFrontmatter(data, body) {
  const safeData = data && typeof data === 'object' ? { ...data } : {};
  // id 若为纯数字字符串，转回 number 写出（避免 `id: '1'` 这种带引号的丑陋输出），
  // parse 端会再强制为 string，业务层无感。
  if (typeof safeData.id === 'string' && /^-?\d+$/.test(safeData.id)) {
    safeData.id = parseInt(safeData.id, 10);
  }
  const bodyText = body == null ? '' : String(body);
  // 空 data：不写 YAML 内容，避免输出 `---\n{}\n---\n`
  if (Object.keys(safeData).length === 0) {
    return `---\n---\n${bodyText}`;
  }
  const yamlText = yaml.dump(safeData, {
    lineWidth: -1, // 不折行
    noRefs: true,
    sortKeys: false,
  });
  return `---\n${yamlText}---\n${bodyText}`;
}

/**
 * 把标题 slug 化为安全的文件名片段：
 *  - 小写
 *  - 空白 → -
 *  - 去除文件系统非法字符 \ / : * ? " < > |
 *  - 折叠连续 -，去掉首尾 -
 *  - 中文等 Unicode 字符保留
 *  - 空/全非法 → "untitled"
 *  - 截断到 80 字符
 */
export function slugifyTitle(title) {
  if (typeof title !== 'string') return 'untitled';
  let slug = title
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!slug) slug = 'untitled';
  if (slug.length > 80) {
    slug = slug.slice(0, 80).replace(/-+$/, '');
    if (!slug) slug = 'untitled';
  }
  return slug;
}

// ============================================================
// Tauri 绑定（懒加载 + 降级）
// ============================================================

let _fs = null;
let _store = null;
let _dialog = null;
let _initPromise = null;

async function getFs() {
  if (_fs) return _fs;
  try {
    _fs = await import('@tauri-apps/plugin-fs');
  } catch {
    _fs = createInMemoryFs();
  }
  return _fs;
}

async function getStore() {
  if (_store) return _store;
  try {
    const { load } = await import('@tauri-apps/plugin-store');
    _store = await load('vault-settings.json', { autoSave: true });
  } catch {
    _store = createInMemoryStore();
  }
  return _store;
}

async function getDialog() {
  if (_dialog) return _dialog;
  try {
    const mod = await import('@tauri-apps/plugin-dialog');
    _dialog = mod;
  } catch {
    _dialog = { open: async () => null, save: async () => null };
  }
  return _dialog;
}

// ---- In-memory fallback（浏览器/Node 降级用） ----

function createInMemoryStore() {
  const data = new Map();
  return {
    get: async (key) => data.get(key),
    set: async (key, val) => { data.set(key, val); },
    save: async () => {},
    delete: async (key) => { data.delete(key); },
  };
}

function createInMemoryFs() {
  const files = new Map();
  const dirs = new Map();
  return {
    readTextFile: async (path) => {
      if (files.has(path)) return files.get(path);
      throw new Error(`ENOENT: ${path}`);
    },
    writeTextFile: async (path, content) => { files.set(path, content); },
    readDir: async (path) => dirs.get(path) || [],
    mkdir: async (path, _opts) => {
      if (!dirs.has(path)) dirs.set(path, []);
    },
    exists: async (path) => files.has(path) || dirs.has(path),
    remove: async (path) => { files.delete(path); },
  };
}

// ============================================================
// Vault 路径管理
// ============================================================

const VAULT_PATH_KEY = 'vault_path';

export async function getVaultPath() {
  const store = await getStore();
  const p = await store.get(VAULT_PATH_KEY);
  return (typeof p === 'string' && p.length > 0) ? p : null;
}

export async function setVaultPath(path) {
  const store = await getStore();
  await store.set(VAULT_PATH_KEY, path);
  await store.save();
}

export async function clearVaultPath() {
  const store = await getStore();
  if (store.delete) await store.delete(VAULT_PATH_KEY);
  else await store.set(VAULT_PATH_KEY, null);
  await store.save();
}

// ============================================================
// Vault 初始化
// ============================================================

/**
 * 初始化 vault：确保目录存在。
 * 如果传了 path，先持久化到 store。
 * 幂等。
 */
export async function initVault(path) {
  if (path) await setVaultPath(path);
  const vaultPath = await getVaultPath();
  if (!vaultPath) throw new Error('No vault path set; call setVaultPath() or pass path to initVault()');

  const fs = await getFs();
  if (!(await fs.exists(vaultPath))) {
    await fs.mkdir(vaultPath, { recursive: true });
  }
}

// ============================================================
// 任务 CRUD
// ============================================================

/**
 * 任务 frontmatter schema 字段白名单。
 * 写入时只序列化这些字段，description 走 body。
 */
const TASK_FRONTMATTER_FIELDS = [
  'id', 'title', 'status', 'next_review', 'last_pushed_at',
  'paused_at', 'created_at', 'total_time_spent', 'estimated_time',
];

function taskToFrontmatter(task) {
  const data = {};
  for (const field of TASK_FRONTMATTER_FIELDS) {
    if (field in task) data[field] = task[field];
  }
  return data;
}

function frontmatterAndBodyToTask(data, body) {
  // 完整任务对象：frontmatter 字段 + description (来自 body)
  return { ...data, description: body || '' };
}

async function joinPath(...parts) {
  // 简单的 POSIX 风格路径拼接（Tauri 返回的路径已是正斜杠或反斜杠，取决于平台）
  return parts.filter(Boolean).join('/').replace(/\\/g, '/');
}

async function listVaultFiles() {
  const fs = await getFs();
  const vaultPath = await getVaultPath();
  if (!vaultPath) return [];
  const entries = await fs.readDir(vaultPath);
  return entries.filter(e => e && e.isFile && e.name && e.name.endsWith('.md') && !e.name.startsWith('.'));
}

async function findFilenameById(id) {
  const fs = await getFs();
  const vaultPath = await getVaultPath();
  if (!vaultPath) return null;
  const files = await listVaultFiles();
  for (const entry of files) {
    const fullPath = await joinPath(vaultPath, entry.name);
    try {
      const content = await fs.readTextFile(fullPath);
      const { data } = parseFrontmatter(content);
      if (data && data.id != null && String(data.id) === String(id)) return entry.name;
    } catch {
      // skip unreadable / bad frontmatter
    }
  }
  return null;
}

async function computeNewFilename(task) {
  const fs = await getFs();
  const vaultPath = await getVaultPath();
  const baseSlug = slugifyTitle(task.title);
  const candidate = `${baseSlug}.md`;
  const candidatePath = await joinPath(vaultPath, candidate);
  if (!(await fs.exists(candidatePath))) {
    return candidate;
  }
  // 冲突：追加短 id 后缀
  const shortId = (task.id || '').slice(0, 6) || Math.random().toString(36).slice(2, 8);
  return `${baseSlug}-${shortId}.md`;
}

/**
 * 读取 vault 中所有任务。损坏的 MD 文件会跳过并 console.warn。
 */
export async function readAllTasks() {
  const fs = await getFs();
  const vaultPath = await getVaultPath();
  if (!vaultPath) return [];
  const files = await listVaultFiles();
  const tasks = [];
  for (const entry of files) {
    const fullPath = await joinPath(vaultPath, entry.name);
    try {
      const content = await fs.readTextFile(fullPath);
      const { data, body } = parseFrontmatter(content);
      if (data && data.id) {
        tasks.push(frontmatterAndBodyToTask(data, body));
      }
    } catch (e) {
      console.warn(`vault: failed to read ${fullPath}: ${e.message}`);
    }
  }
  return tasks;
}

/**
 * 写入一个任务。已存在同 id 的文件会被覆盖；否则创建新文件。
 */
export async function writeTask(task) {
  if (!task || !task.id) throw new Error('writeTask: task.id is required');
  const fs = await getFs();
  const vaultPath = await getVaultPath();
  if (!vaultPath) throw new Error('writeTask: vault path not set');

  // 1. 找现有文件（同 id）
  let filename = await findFilenameById(task.id);
  // 2. 没有则计算新文件名
  if (!filename) filename = await computeNewFilename(task);

  const fullPath = await joinPath(vaultPath, filename);
  const frontmatter = taskToFrontmatter(task);
  const body = task.description || '';
  const content = serializeFrontmatter(frontmatter, body);
  await fs.writeTextFile(fullPath, content);
  return { path: fullPath, filename };
}

/**
 * 删除一个任务。返回是否真的删除了某个文件。
 */
export async function deleteTask(id) {
  const fs = await getFs();
  const vaultPath = await getVaultPath();
  if (!vaultPath) return false;
  const filename = await findFilenameById(id);
  if (!filename) return false;
  const fullPath = await joinPath(vaultPath, filename);
  try {
    await fs.remove(fullPath);
    return true;
  } catch (e) {
    console.warn(`vault: failed to delete ${fullPath}: ${e.message}`);
    return false;
  }
}

// ============================================================
// Dialog: 选 vault 文件夹
// ============================================================

/**
 * 弹出系统文件夹选择器，让用户选 vault 目录。
 * 用户取消 → 返回 null。
 * 用户确认 → 持久化路径并返回。
 */
export async function pickVaultFolder() {
  const dialog = await getDialog();
  const selected = await dialog.open({
    directory: true,
    multiple: false,
    title: '选择 Vault 文件夹',
  });
  if (!selected || typeof selected !== 'string') return null;
  await setVaultPath(selected);
  return selected;
}

// ============================================================
// 用于测试/调试
// ============================================================

/** 重置内部缓存（仅测试用） */
export function _resetForTests() {
  _fs = null;
  _store = null;
  _dialog = null;
  _initPromise = null;
}
