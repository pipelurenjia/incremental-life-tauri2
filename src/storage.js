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
