/**
 * localStorage 读写封装
 */

import { generateId } from './utils.js';

const SCHEMA_VERSION = 2;

const KEYS = {
  tasks: 'progressive_tasks',
  logs: 'progressive_action_logs',
  backup: 'progressive_backup',
  schemaVersion: 'progressive_schema_version',
};

const TASK_DEFAULTS = {
  description: '',
  status: 'active',
  next_review: Date.now(),
  last_pushed_at: Date.now(),
  paused_at: null,
  created_at: Date.now(),
};

function safeParse(json, key) {
  try {
    return JSON.parse(json);
  } catch {
    console.error(`数据损坏: ${key}`);
    return null;
  }
}

export function loadTasks() {
  const raw = localStorage.getItem(KEYS.tasks);
  if (!raw) return [];
  const data = safeParse(raw, KEYS.tasks);
  if (data === null) return [];
  return migrateTasks(data);
}

export function saveTasks(tasks) {
  try {
    localStorage.setItem(KEYS.tasks, JSON.stringify(tasks));
  } catch (e) {
    if (e.name === 'QuotaExceededError') {
      alert('存储空间不足，请导出数据后清理旧日志');
    }
    throw e;
  }
}

export function loadLogs() {
  const raw = localStorage.getItem(KEYS.logs);
  if (!raw) return [];
  const data = safeParse(raw, KEYS.logs);
  return data !== null ? data : [];
}

export function saveLogs(logs) {
  try {
    localStorage.setItem(KEYS.logs, JSON.stringify(logs));
  } catch (e) {
    if (e.name === 'QuotaExceededError') {
      alert('存储空间不足，请导出数据后清理旧日志');
    }
    throw e;
  }
}

export function backup(tasks, logs) {
  try {
    localStorage.setItem(KEYS.backup, JSON.stringify({ tasks, logs, ts: Date.now() }));
  } catch {
    // 备份失败静默处理
  }
}

export function getSchemaVersion() {
  return Number(localStorage.getItem(KEYS.schemaVersion) || 0);
}

export function setSchemaVersion(v) {
  localStorage.setItem(KEYS.schemaVersion, String(v));
}

function migrateTasks(tasks) {
  const version = getSchemaVersion();
  if (version >= SCHEMA_VERSION) return tasks;

  // 为缺少字段的旧数据补充默认值
  for (const t of tasks) {
    for (const [key, def] of Object.entries(TASK_DEFAULTS)) {
      if (!(key in t)) {
        t[key] = typeof def === 'function' ? def() : def;
      }
    }
  }

  setSchemaVersion(SCHEMA_VERSION);
  saveTasks(tasks);
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
