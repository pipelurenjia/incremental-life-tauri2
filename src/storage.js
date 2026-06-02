/**
 * 持久化封装 — Tauri 环境 + 浏览器/Node 降级
 *
 * 数据分层：
 *  - 任务（tasks） → vault.js（MD 文件，存放在用户选择的 vault 目录）
 *  - 日志（logs）  → plugin-store（"vault-settings.json"，应用数据目录）
 *  - 设置（vault_path） → plugin-store（"vault-settings.json"）
 *
 * 与旧版本差异：
 *  - 旧：所有数据走 plugin-store 'data.json'（含 tasks 和 logs）
 *  - 新：tasks 走 MD 文件；logs + settings 走新的 'vault-settings.json'；旧 data.json 忽略
 */

import { generateId } from './utils.js';
import {
  readAllTasks as vaultReadAll,
  writeTask as vaultWrite,
  deleteTask as vaultDelete,
  getVaultPath,
  setVaultPath,
  initVault as vaultInit,
  pickVaultFolder as vaultPickFolder,
  clearVaultPath,
} from './vault.js';

// ============================================================
// 任务（MD 文件，vault.js 负责实际 I/O）
// ============================================================

// 跟踪已写入的文件 id 集合，用于 saveTasks 时清理被删除的任务
let _knownIds = new Set();

export async function loadTasks() {
  const tasks = await vaultReadAll();
  _knownIds = new Set(tasks.map(t => t.id));
  return tasks;
}

/**
 * 写入全部任务：先写所有（新增/更新），再删除 _knownIds 中已不在新数组里的。
 * 顺序保证崩溃时只可能多出文件，不会丢文件。
 */
export async function saveTasks(tasks) {
  const newIds = new Set();
  for (const task of tasks) {
    if (!task || !task.id) continue;
    newIds.add(task.id);
    await vaultWrite(task);
  }
  for (const oldId of _knownIds) {
    if (!newIds.has(oldId)) {
      await vaultDelete(oldId);
    }
  }
  _knownIds = newIds;
}

// ============================================================
// 日志（plugin-store JSON 侧车）
// ============================================================

let _logStore = null;

async function getLogStore() {
  if (_logStore) return _logStore;
  try {
    const { load } = await import('@tauri-apps/plugin-store');
    _logStore = await load('vault-settings.json', { autoSave: true });
  } catch {
    const mem = new Map();
    _logStore = {
      get: async (key) => mem.get(key),
      set: async (key, val) => { mem.set(key, val); },
      save: async () => {},
    };
  }
  return _logStore;
}

export async function loadLogs() {
  const store = await getLogStore();
  const raw = await store.get('logs');
  return raw || [];
}

export async function saveLogs(logs) {
  const store = await getLogStore();
  await store.set('logs', logs);
}

/** 保留以兼容旧调用方。plugin-store 已 auto-save，这里 noop。 */
export async function backup() {
  // noop
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

// ============================================================
// Vault 路径（与日志同文件，单独 key）
// ============================================================

export {
  getVaultPath,
  setVaultPath,
  clearVaultPath,
  vaultInit as initVault,
  vaultPickFolder as pickVaultFolder,
};

// ============================================================
// 导入导出（与 vault 解耦，导出当前 task 数组为 JSON/CSV）
// ============================================================

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

// ============================================================
// 测试钩子
// ============================================================

/** 重置内部缓存（仅测试用） */
export function _resetForTests() {
  _knownIds = new Set();
  _logStore = null;
}
