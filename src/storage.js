/**
 * 持久化封装 — 双环境适配
 *
 * - Tauri 环境: 使用 @tauri-apps/plugin-store（文件存储到 %APPDATA%）
 * - 浏览器环境: 使用 in-memory Map（用于 dev 调试）
 */

import { generateId } from './utils.js';

const TASK_DEFAULTS = {
  description: '',
  status: 'active',
  next_review: Date.now(),
  last_pushed_at: Date.now(),
  paused_at: null,
  created_at: Date.now(),
};

let _store = null;

async function getStore() {
  if (_store !== null) return _store;

  try {
    // Dynamic import — only resolves inside Tauri WebView
    const { load } = await import('@tauri-apps/plugin-store');
    _store = await load('data.json', { autoSave: true });
  } catch {
    // 浏览器/非 Tauri 环境：in-memory fallback
    const mem = new Map();
    _store = {
      get: async (key) => mem.get(key),
      set: async (key, val) => { mem.set(key, val); },
      save: async () => {},
    };
  }

  return _store;
}

export async function loadTasks() {
  const store = await getStore();
  const raw = await store.get('tasks');
  if (!raw) return [];
  return migrateTasks(raw);
}

export async function saveTasks(tasks) {
  const store = await getStore();
  await store.set('tasks', tasks);
}

export async function loadLogs() {
  const store = await getStore();
  const raw = await store.get('logs');
  return raw || [];
}

export async function saveLogs(logs) {
  const store = await getStore();
  await store.set('logs', logs);
}

/**
 * 备份：Tauri Store 已自动持久化（文件存储），保留 noop
 */
export async function backup() {
  // Tauri Store auto-save handles persistence
}

function migrateTasks(tasks) {
  for (const t of tasks) {
    for (const [key, def] of Object.entries(TASK_DEFAULTS)) {
      if (!(key in t)) {
        t[key] = typeof def === 'function' ? def() : def;
      }
    }
  }
  return tasks;
}

export function generateLog(task, action, changes, timeSpent) {
  return {
    id: generateId(),
    task_id: task.id,
    task_title: task.title,
    action,
    changes,
    time_spent: timeSpent,
    timestamp: Date.now(),
  };
}

// ---- 导入导出 ----

const EXPORT_FIELDS = ['title', 'status', 'next_review', 'estimated_time', 'total_time_spent', 'created_at', 'description'];

export function exportTasksToJSON(tasks) {
  const data = tasks.map(t => {
    const obj = { id: t.id };
    for (const f of EXPORT_FIELDS) obj[f] = t[f];
    obj.total_time_spent = t.total_time_spent || 0;
    obj.description = t.description || '';
    return obj;
  });
  return JSON.stringify(data, null, 2);
}

export function exportTasksToCSV(tasks) {
  const headers = ['标题', '状态', '到期时间', '预估耗时(分)', '总耗时(分钟)', '创建时间', '备注'];
  const rows = tasks.map(t => {
    const statusMap = { active: '活跃', completed: '已完成', archived: '已归档' };
    return [
      escapeCsvField(t.title),
      escapeCsvField(statusMap[t.status] || t.status),
      new Date(t.next_review).toISOString().slice(0, 10),
      t.estimated_time != null ? String(t.estimated_time) : '',
      String(Math.round((t.total_time_spent || 0) / 60000)),
      new Date(t.created_at).toISOString(),
      escapeCsvField(t.description || ''),
    ].join(',');
  });
  return '\uFEFF' + headers.join(',') + '\n' + rows.join('\n');
}

function escapeCsvField(val) {
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

export async function downloadFile(content, filename, mimeType) {
  try {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');
    const path = await save({ defaultPath: filename, filters: [{ name: filename.endsWith('.csv') ? 'CSV' : 'JSON', extensions: [filename.endsWith('.csv') ? 'csv' : 'json'] }] });
    if (path) {
      await writeTextFile(path, content);
      return true;
    }
    return false;
  } catch {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    return true;
  }
}

export async function openFile() {
  try {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const { readTextFile } = await import('@tauri-apps/plugin-fs');
    const path = await open({ multiple: false, filters: [{ name: '任务数据', extensions: ['json', 'csv'] }] });
    if (!path) return null;
    const content = await readTextFile(path);
    return { content, ext: path.endsWith('.csv') ? 'csv' : 'json' };
  } catch {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,.csv';
      input.onchange = () => {
        const file = input.files[0];
        if (!file) { resolve(null); return; }
        const reader = new FileReader();
        reader.onload = (e) => resolve({ content: e.target.result, ext: file.name.endsWith('.csv') ? 'csv' : 'json' });
        reader.readAsText(file);
      };
      input.click();
    });
  }
}

export function parseImportedTasks(content, ext) {
  if (ext === 'csv') {
    return parseCSVTasks(content);
  }
  try {
    const data = JSON.parse(content);
    if (!Array.isArray(data)) throw new Error('格式错误：需要数组');
    return data.map(t => migrateTaskImport(t));
  } catch (e) {
    throw new Error('JSON 解析失败: ' + e.message);
  }
}

function parseCSVTasks(content) {
  const lines = content.replace(/\r\n/g, '\n').split('\n').filter(Boolean);
  if (lines.length < 2) return [];
  const hasBom = lines[0].charCodeAt(0) === 0xFEFF;
  const headerLine = hasBom ? lines[0].slice(1) : lines[0];
  const headers = parseCSVLine(headerLine);
  const tasks = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = parseCSVLine(lines[i]);
    const map = {};
    headers.forEach((h, idx) => { map[h] = vals[idx] || ''; });
    const title = map['标题'] || map['title'] || '';
    if (!title.trim()) continue;
    const statusStr = map['状态'] || map['status'] || '';
    const statusRev = { '活跃': 'active', '已完成': 'completed', '已归档': 'archived' };
    const status = statusRev[statusStr] || statusStr || 'active';
    const nextReview = map['到期时间'] || map['next_review'];
    const estimated = parseInt(map['预估耗时(分)'] || map['estimated_time'], 10);
    const desc = map['备注'] || map['description'] || '';
    const created = parseInt(map['创建时间'] || map['created_at'], 10) || Date.now();
    tasks.push(migrateTaskImport({
      title: title.trim(),
      status,
      next_review: nextReview ? new Date(nextReview).getTime() : Date.now(),
      estimated_time: isNaN(estimated) ? null : estimated,
      description: desc,
      created_at: created,
    }));
  }
  return tasks;
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

function migrateTaskImport(data) {
  const now = Date.now();
  return {
    id: generateId(),
    title: data.title || '',
    description: data.description || '',
    status: data.status || 'active',
    next_review: data.next_review || now,
    last_pushed_at: data.last_pushed_at || now,
    paused_at: data.paused_at || null,
    created_at: data.created_at || now,
    total_time_spent: data.total_time_spent || 0,
    estimated_time: data.estimated_time != null ? data.estimated_time : null,
  };
}
