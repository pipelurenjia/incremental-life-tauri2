/**
 * storage.js 测试 — task 持久化 + log 持久化
 *
 * 覆盖：
 *  - loadTasks 读取并填充 _knownIds
 *  - saveTasks 写所有新任务
 *  - saveTasks 删除 _knownIds 中已不在新数组里的任务
 *  - loadLogs / saveLogs 走 plugin-store 侧车
 *  - 导入 / 导出函数（纯函数 / 文件对话框 mock）
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---- 共享 mock 状态 ----
const { mockFsState, mockStoreData, mockDialogReturn } = vi.hoisted(() => {
  const fsState = { files: new Map(), dirs: new Map() };
  const storeData = new Map();
  return {
    mockFsState: fsState,
    mockStoreData: storeData,
    mockDialogReturn: { value: null },
  };
});

vi.mock('@tauri-apps/plugin-fs', () => ({
  readTextFile: vi.fn(async (path) => {
    if (mockFsState.files.has(path)) return mockFsState.files.get(path);
    throw new Error(`ENOENT: ${path}`);
  }),
  writeTextFile: vi.fn(async (path, content) => { mockFsState.files.set(path, content); }),
  readDir: vi.fn(async (path) => {
    const entries = [];
    const seen = new Set();
    const add = (e) => {
      if (e && e.name && !seen.has(e.name)) {
        entries.push(e);
        seen.add(e.name);
      }
    };
    if (mockFsState.dirs.has(path)) mockFsState.dirs.get(path).forEach(add);
    if (mockFsState.dirs.has('__default__') && path !== '__default__') {
      mockFsState.dirs.get('__default__').forEach(add);
    }
    const prefix = path.replace(/[/\\]+$/, '') + '/';
    for (const filePath of mockFsState.files.keys()) {
      if (filePath.startsWith(prefix)) {
        const rest = filePath.slice(prefix.length);
        if (rest && !rest.includes('/') && !rest.includes('\\')) {
          add({ name: rest, isFile: true });
        }
      }
    }
    return entries;
  }),
  mkdir: vi.fn(async (path) => { if (!mockFsState.dirs.has(path)) mockFsState.dirs.set(path, []); }),
  exists: vi.fn(async (path) => mockFsState.files.has(path) || mockFsState.dirs.has(path)),
  remove: vi.fn(async (path) => { mockFsState.files.delete(path); }),
}));

vi.mock('@tauri-apps/plugin-store', () => ({
  load: vi.fn(async () => ({
    get: vi.fn(async (key) => mockStoreData.get(key)),
    set: vi.fn(async (key, val) => { mockStoreData.set(key, val); }),
    save: vi.fn(async () => {}),
    delete: vi.fn(async (key) => { mockStoreData.delete(key); }),
  })),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(async (opts) => mockDialogReturn.value),
  save: vi.fn(async (opts) => mockDialogReturn.value),
}));

import {
  loadTasks,
  saveTasks,
  loadLogs,
  saveLogs,
  generateLog,
  getVaultPath,
  setVaultPath,
  initVault,
  pickVaultFolder,
  exportTasksToJSON,
  exportTasksToCSV,
  parseImportedTasks,
  _resetForTests,
} from '../src/storage.js';

const makeTask = (overrides = {}) => ({
  id: `t-${Math.random().toString(36).slice(2, 8)}`,
  title: 'Test',
  description: '',
  status: 'active',
  next_review: Date.now() + 3600000,
  last_pushed_at: Date.now(),
  paused_at: null,
  created_at: Date.now(),
  total_time_spent: 0,
  estimated_time: null,
  ...overrides,
});

describe('loadTasks / saveTasks (vault-backed)', () => {
  beforeEach(() => {
    mockFsState.files.clear();
    mockFsState.dirs.clear();
    mockStoreData.clear();
    vi.clearAllMocks();
    _resetForTests();
  });

  it('loadTasks returns empty array when no vault set', async () => {
    const tasks = await loadTasks();
    expect(tasks).toEqual([]);
  });

  it('saveTasks + loadTasks round-trips all task fields', async () => {
    mockFsState.dirs.set('__default__', []);
    await setVaultPath('/vault');
    const original = makeTask({
      id: 'rt-1',
      title: 'Round Trip',
      description: 'A note',
      status: 'active',
      next_review: 12345,
      last_pushed_at: 12000,
      paused_at: null,
      created_at: 10000,
      total_time_spent: 5000,
      estimated_time: 30,
    });

    await saveTasks([original]);
    const loaded = await loadTasks();

    expect(loaded).toHaveLength(1);
    const t = loaded[0];
    expect(t.id).toBe('rt-1');
    expect(t.title).toBe('Round Trip');
    expect(t.description).toBe('A note');
    expect(t.status).toBe('active');
    expect(t.next_review).toBe(12345);
    expect(t.paused_at).toBeNull();
    expect(t.total_time_spent).toBe(5000);
    expect(t.estimated_time).toBe(30);
  });

  it('saveTasks deletes files for tasks removed from array', async () => {
    mockFsState.dirs.set('__default__', []);
    await setVaultPath('/vault');

    const t1 = makeTask({ id: 'keep', title: 'Keep' });
    const t2 = makeTask({ id: 'remove', title: 'Remove' });
    await saveTasks([t1, t2]);

    // Both files on disk
    expect([...mockFsState.files.keys()].some(p => p.includes('keep'))).toBe(true);
    expect([...mockFsState.files.keys()].some(p => p.includes('remove'))).toBe(true);

    // Remove t2 from array
    await saveTasks([t1]);

    const remaining = [...mockFsState.files.keys()].filter(p => p.endsWith('.md'));
    expect(remaining.some(p => p.includes('keep'))).toBe(true);
    expect(remaining.some(p => p.includes('remove'))).toBe(false);
  });

  it('saveTasks overwrites file when same id present (title changed)', async () => {
    mockFsState.dirs.set('__default__', []);
    await setVaultPath('/vault');

    const t = makeTask({ id: 'same', title: 'Original' });
    await saveTasks([t]);

    const filesBefore = [...mockFsState.files.entries()].filter(([p]) => p.endsWith('.md'));
    const filePath = filesBefore[0][0];

    const updated = { ...t, title: 'Updated Title' };
    await saveTasks([updated]);

    // Should still be exactly one file with that id
    const filesAfter = [...mockFsState.files.entries()].filter(([p]) => p.endsWith('.md'));
    expect(filesAfter).toHaveLength(1);
    expect(filesAfter[0][0]).toBe(filePath);
    expect(filesAfter[0][1]).toContain('title: Updated Title');
  });

  it('saveTasks skips tasks with missing id', async () => {
    mockFsState.dirs.set('__default__', []);
    await setVaultPath('/vault');
    await saveTasks([
      { title: 'No ID' }, // no id → skipped
      makeTask({ id: 'valid' }),
    ]);
    const files = [...mockFsState.files.keys()].filter(p => p.endsWith('.md'));
    expect(files).toHaveLength(1);
  });
});

describe('loadLogs / saveLogs (plugin-store sidecar)', () => {
  beforeEach(() => {
    mockStoreData.clear();
    vi.clearAllMocks();
    _resetForTests();
  });

  it('loadLogs returns empty array when nothing stored', async () => {
    const logs = await loadLogs();
    expect(logs).toEqual([]);
  });

  it('saveLogs persists logs', async () => {
    const logs = [
      { id: 'l1', task_id: 't1', action: 'create', timestamp: 1 },
      { id: 'l2', task_id: 't1', action: 'complete', timestamp: 2 },
    ];
    await saveLogs(logs);
    const loaded = await loadLogs();
    expect(loaded).toEqual(logs);
  });

  it('generateLog builds a valid log entry', () => {
    const task = { id: 'abc', title: 'Hello' };
    const log = generateLog(task, 'advance', { next_review: [100, 200] }, 5000);
    expect(log.id).toBeTypeOf('string');
    expect(log.task_id).toBe('abc');
    expect(log.task_title).toBe('Hello');
    expect(log.action).toBe('advance');
    expect(log.changes).toEqual({ next_review: [100, 200] });
    expect(log.time_spent).toBe(5000);
    expect(log.timestamp).toBeTypeOf('number');
  });
});

describe('Vault path management', () => {
  beforeEach(() => {
    mockStoreData.clear();
    _resetForTests();
  });

  it('initVault persists path and creates dir', async () => {
    await initVault('/my-vault');
    expect(await getVaultPath()).toBe('/my-vault');
    const { mkdir } = await import('@tauri-apps/plugin-fs');
    expect(mkdir).toHaveBeenCalledWith('/my-vault', { recursive: true });
  });

  it('pickVaultFolder persists user choice', async () => {
    mockDialogReturn.value = '/user-picked';
    const result = await pickVaultFolder();
    expect(result).toBe('/user-picked');
    expect(await getVaultPath()).toBe('/user-picked');
  });
});

describe('Export / Import (pure)', () => {
  it('exportTasksToJSON produces valid JSON array with all fields', () => {
    const json = exportTasksToJSON([
      makeTask({ id: 'a', title: 'A', description: 'note' }),
      makeTask({ id: 'b', title: 'B', status: 'completed' }),
    ]);
    const parsed = JSON.parse(json);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].id).toBe('a');
    expect(parsed[1].status).toBe('completed');
  });

  it('exportTasksToCSV produces header + rows with BOM', () => {
    const csv = exportTasksToCSV([
      makeTask({ id: 'a', title: 'A', description: 'note' }),
    ]);
    expect(csv.charCodeAt(0)).toBe(0xFEFF); // BOM
    expect(csv).toContain('标题');
    expect(csv).toContain('A');
  });

  it('parseImportedTasks handles JSON', () => {
    const data = JSON.stringify([{ id: 'x', title: 'X', status: 'active' }]);
    const tasks = parseImportedTasks(data, 'json');
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe('X');
    // new id assigned during migration
    expect(tasks[0].id).not.toBe('x');
  });

  it('parseImportedTasks throws on invalid JSON', () => {
    expect(() => parseImportedTasks('not json', 'json')).toThrow();
  });

  it('parseImportedTasks handles CSV with header', () => {
    const csv = '\uFEFF标题,状态\nFoo,活跃\nBar,已完成';
    const tasks = parseImportedTasks(csv, 'csv');
    expect(tasks).toHaveLength(2);
    expect(tasks[0].title).toBe('Foo');
    expect(tasks[0].status).toBe('active');
    expect(tasks[1].status).toBe('completed');
  });

  it('parseImportedTasks skips rows with empty title', () => {
    const csv = '\uFEFF标题,状态\n,活跃\nFoo,活跃';
    const tasks = parseImportedTasks(csv, 'csv');
    expect(tasks).toHaveLength(1);
  });
});
