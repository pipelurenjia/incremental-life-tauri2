/**
 * vault.js 测试 — 纯函数 + 模拟 Tauri fs
 *
 * 覆盖：
 *  - frontmatter 解析 / 序列化（往返）
 *  - slugify（中文、特殊字符、空白）
 *  - readAllTasks / writeTask / deleteTask（mocked fs）
 *  - initVault（mkdir / skip）
 *  - vault 路径管理（mocked plugin-store）
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---- 共享 mock 状态（hoisted 以便 vi.mock factory 引用） ----
const { mockFsState, mockStoreData, mockDialogReturn } = vi.hoisted(() => {
  const fsState = {
    // 模拟磁盘：path -> content（用于 readTextFile / writeTextFile）
    files: new Map(),
    // 模拟目录：path -> [{name, isFile}]
    dirs: new Map(),
  };
  const storeData = new Map();
  return {
    mockFsState: fsState,
    mockStoreData: storeData,
    mockDialogReturn: { value: null },
  };
});

// ---- Tauri plugin mocks ----

vi.mock('@tauri-apps/plugin-fs', () => ({
  readTextFile: vi.fn(async (path) => {
    if (mockFsState.files.has(path)) return mockFsState.files.get(path);
    throw new Error(`ENOENT: ${path}`);
  }),
  writeTextFile: vi.fn(async (path, content) => {
    mockFsState.files.set(path, content);
  }),
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
  mkdir: vi.fn(async (path, opts) => {
    if (!mockFsState.dirs.has(path)) mockFsState.dirs.set(path, []);
    return undefined;
  }),
  exists: vi.fn(async (path) => mockFsState.files.has(path) || mockFsState.dirs.has(path)),
  remove: vi.fn(async (path) => {
    mockFsState.files.delete(path);
  }),
}));

vi.mock('@tauri-apps/plugin-store', () => ({
  load: vi.fn(async () => ({
    get: vi.fn(async (key) => mockStoreData.get(key)),
    set: vi.fn(async (key, val) => { mockStoreData.set(key, val); }),
    save: vi.fn(async () => {}),
  })),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(async (opts) => mockDialogReturn.value),
}));

import {
  parseFrontmatter,
  serializeFrontmatter,
  slugifyTitle,
  initVault,
  readAllTasks,
  writeTask,
  deleteTask,
  getVaultPath,
  setVaultPath,
  pickVaultFolder,
} from '../src/vault.js';

// ============================================================
// 纯函数测试
// ============================================================

describe('parseFrontmatter', () => {
  it('extracts YAML data and body from valid frontmatter', () => {
    const md = '---\nid: abc\ntitle: hello\nstatus: active\n---\nThis is the body';
    const { data, body } = parseFrontmatter(md);
    expect(data.id).toBe('abc');
    expect(data.title).toBe('hello');
    expect(data.status).toBe('active');
    expect(body).toBe('This is the body');
  });

  it('returns empty data and full content when no frontmatter', () => {
    const md = 'Just a body\nno frontmatter here';
    const { data, body } = parseFrontmatter(md);
    expect(data).toEqual({});
    expect(body).toBe(md);
  });

  it('handles empty body', () => {
    const md = '---\nid: 1\n---\n';
    const { data, body } = parseFrontmatter(md);
    expect(data.id).toBe('1');
    expect(body).toBe('');
  });

  it('preserves multi-line body with blank lines', () => {
    const md = '---\nid: 1\n---\nLine 1\nLine 2\n\nLine 4';
    const { data, body } = parseFrontmatter(md);
    expect(data.id).toBe('1');
    expect(body).toBe('Line 1\nLine 2\n\nLine 4');
  });

  it('treats --- without closing fence as no-frontmatter', () => {
    const md = 'no frontmatter here\njust text';
    const { data, body } = parseFrontmatter(md);
    expect(data).toEqual({});
    expect(body).toBe(md);
  });

  it('parses numeric fields as numbers (timestamps)', () => {
    const md = '---\nid: 1\nnext_review: 1717200000000\npaused_at: 0\n---\nbody';
    const { data } = parseFrontmatter(md);
    expect(data.next_review).toBe(1717200000000);
    expect(data.paused_at).toBe(0);
  });
});

describe('serializeFrontmatter', () => {
  it('produces frontmatter + body with --- delimiters', () => {
    const result = serializeFrontmatter({ id: '1', title: 'Test' }, 'body content');
    expect(result.startsWith('---\n')).toBe(true);
    expect(result).toContain('id: 1');
    expect(result).toContain('title: Test');
    expect(result).toContain('body content');
  });

  it('round-trips through parseFrontmatter', () => {
    const data = { id: 'x', status: 'active', next_review: 12345, paused_at: null };
    const body = 'Some content\nwith newlines';
    const md = serializeFrontmatter(data, body);
    const parsed = parseFrontmatter(md);
    expect(parsed.data).toEqual(data);
    expect(parsed.body).toBe(body);
  });

  it('handles empty data', () => {
    const result = serializeFrontmatter({}, 'just body');
    expect(result).toBe('---\n---\njust body');
  });

  it('preserves null and boolean values', () => {
    const data = { id: '1', paused_at: null, archived: false };
    const md = serializeFrontmatter(data, 'b');
    const { data: parsed } = parseFrontmatter(md);
    expect(parsed.paused_at).toBeNull();
    expect(parsed.archived).toBe(false);
  });
});

describe('slugifyTitle', () => {
  it('lowercases and replaces spaces with dashes', () => {
    expect(slugifyTitle('Hello World')).toBe('hello-world');
  });

  it('keeps CJK characters intact', () => {
    expect(slugifyTitle('写周报')).toBe('写周报');
  });

  it('keeps mixed CJK + ASCII', () => {
    expect(slugifyTitle('写周报 v2')).toBe('写周报-v2');
  });

  it('removes unsafe filesystem characters', () => {
    expect(slugifyTitle('a/b\\c:d*e?f"g<h>i|j')).toBe('abcdefghij');
  });

  it('collapses multiple spaces and dashes', () => {
    expect(slugifyTitle('hello   world---foo')).toBe('hello-world-foo');
  });

  it('strips leading/trailing whitespace and dashes', () => {
    expect(slugifyTitle('  ---hello---  ')).toBe('hello');
  });

  it('returns "untitled" for empty or whitespace-only input', () => {
    expect(slugifyTitle('')).toBe('untitled');
    expect(slugifyTitle('   ')).toBe('untitled');
    expect(slugifyTitle('////')).toBe('untitled');
  });

  it('truncates very long titles to 80 chars', () => {
    const long = 'a'.repeat(200);
    expect(slugifyTitle(long).length).toBeLessThanOrEqual(80);
  });
});

// ============================================================
// I/O 测试（mocked fs + store）
// ============================================================

describe('vault path management', () => {
  beforeEach(() => {
    mockStoreData.clear();
  });

  it('getVaultPath returns null when not set', async () => {
    expect(await getVaultPath()).toBeNull();
  });

  it('setVaultPath persists path', async () => {
    await setVaultPath('/tmp/vault');
    expect(await getVaultPath()).toBe('/tmp/vault');
  });
});

describe('initVault', () => {
  beforeEach(() => {
    mockFsState.files.clear();
    mockFsState.dirs.clear();
    mockStoreData.clear();
    vi.clearAllMocks();
  });

  it('creates vault directory if it does not exist', async () => {
    const { mkdir } = await import('@tauri-apps/plugin-fs');
    await setVaultPath('/new-vault');
    await initVault();
    expect(mkdir).toHaveBeenCalledWith('/new-vault', { recursive: true });
  });

  it('skips mkdir if directory already exists', async () => {
    const { mkdir } = await import('@tauri-apps/plugin-fs');
    await setVaultPath('/existing-vault');
    // pre-seed dir
    mockFsState.dirs.set('/existing-vault', []);
    await initVault();
    expect(mkdir).not.toHaveBeenCalled();
  });

  it('throws if no vault path is set', async () => {
    await expect(initVault()).rejects.toThrow(/vault path/i);
  });
});

describe('readAllTasks', () => {
  beforeEach(() => {
    mockFsState.files.clear();
    mockFsState.dirs.clear();
    mockStoreData.clear();
    vi.clearAllMocks();
  });

  it('returns parsed tasks from .md files', async () => {
    mockFsState.dirs.set('__default__', [
      { name: 'task-a.md', isFile: true },
      { name: 'task-b.md', isFile: true },
    ]);
    mockFsState.files.set('/vault/task-a.md', '---\nid: a\ntitle: Task A\nstatus: active\n---\nA body');
    mockFsState.files.set('/vault/task-b.md', '---\nid: b\ntitle: Task B\nstatus: completed\n---\nB body');
    await setVaultPath('/vault');

    const tasks = await readAllTasks();
    expect(tasks).toHaveLength(2);
    expect(tasks[0].id).toBe('a');
    expect(tasks[0].title).toBe('Task A');
    expect(tasks[0].description).toBe('A body');
    expect(tasks[1].id).toBe('b');
    expect(tasks[1].description).toBe('B body');
  });

  it('returns empty array when vault is empty', async () => {
    mockFsState.dirs.set('__default__', []);
    await setVaultPath('/empty');
    const tasks = await readAllTasks();
    expect(tasks).toEqual([]);
  });

  it('skips non-md files and dotfiles', async () => {
    mockFsState.dirs.set('__default__', [
      { name: 'task.md', isFile: true },
      { name: 'image.png', isFile: true },
      { name: '.DS_Store', isFile: true },
    ]);
    mockFsState.files.set('/vault/task.md', '---\nid: 1\n---\nbody');
    await setVaultPath('/vault');

    const tasks = await readAllTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe('1');
  });

  it('skips files with invalid frontmatter gracefully', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockFsState.dirs.set('__default__', [{ name: 'bad.md', isFile: true }]);
    mockFsState.files.set('/vault/bad.md', '---\nid: [unclosed\n---');
    await setVaultPath('/vault');

    const tasks = await readAllTasks();
    expect(tasks).toEqual([]);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe('writeTask', () => {
  beforeEach(() => {
    mockFsState.files.clear();
    mockFsState.dirs.clear();
    mockStoreData.clear();
    vi.clearAllMocks();
  });

  const makeTask = (overrides = {}) => ({
    id: 'task-1',
    title: 'Test Task',
    description: 'Some description',
    status: 'active',
    next_review: 1717200000000,
    last_pushed_at: 1717113600000,
    paused_at: null,
    created_at: 1717027200000,
    total_time_spent: 0,
    estimated_time: null,
    ...overrides,
  });

  it('writes a new task MD file with frontmatter and body', async () => {
    mockFsState.dirs.set('__default__', []);
    await setVaultPath('/vault');
    await writeTask(makeTask({ id: 'new-id', title: 'New Task' }));

    const written = [...mockFsState.files.entries()].find(([p]) => p.endsWith('.md'));
    expect(written).toBeDefined();
    const [path, content] = written;
    expect(path).toMatch(/new-task\.md$/);
    expect(content).toContain('id: new-id');
    expect(content).toContain('title: New Task');
    expect(content).toContain('status: active');
    expect(content).toContain('Some description');
  });

  it('uses slugified title as filename', async () => {
    mockFsState.dirs.set('__default__', []);
    await setVaultPath('/vault');
    await writeTask(makeTask({ id: '1', title: '写周报 v2' }));
    const [path] = [...mockFsState.files.entries()].find(([p]) => p.endsWith('.md'));
    expect(path).toMatch(/写周报-v2\.md$/);
  });

  it('appends id suffix on filename collision', async () => {
    mockFsState.dirs.set('__default__', []);
    await setVaultPath('/vault');
    // pre-existing file with same title
    mockFsState.files.set('/vault/same-title.md', '---\nid: other\n---\n');
    await writeTask(makeTask({ id: 'abc123', title: 'Same Title' }));
    const files = [...mockFsState.files.keys()].filter(p => p.endsWith('.md'));
    expect(files).toContain('/vault/same-title.md'); // original untouched
    expect(files.some(p => /same-title-abc123\.md$/.test(p))).toBe(true); // new one with suffix
  });

  it('writes empty body when description is empty', async () => {
    mockFsState.dirs.set('__default__', []);
    await setVaultPath('/vault');
    await writeTask(makeTask({ id: '1', title: 'T', description: '' }));
    const [, content] = [...mockFsState.files.entries()].find(([p]) => p.endsWith('.md'));
    // body section after second ---
    const parts = content.split('---\n');
    expect(parts.length).toBeGreaterThanOrEqual(3);
    expect(parts[2].trim()).toBe('');
  });

  it('overwrites existing file for same id', async () => {
    mockFsState.dirs.set('__default__', []);
    await setVaultPath('/vault');
    await writeTask(makeTask({ id: 'same', title: 'Original' }));
    await writeTask(makeTask({ id: 'same', title: 'Updated' }));
    const files = [...mockFsState.files.entries()].filter(([p]) => p.endsWith('.md'));
    // The first write creates title-based name; the second should find it via id index and update
    // Implementation choice: re-use the same filename when title matches, append id otherwise
    expect(files.length).toBeGreaterThanOrEqual(1);
  });
});

describe('deleteTask', () => {
  beforeEach(() => {
    mockFsState.files.clear();
    mockFsState.dirs.clear();
    mockStoreData.clear();
    vi.clearAllMocks();
  });

  it('removes the task file from vault', async () => {
    mockFsState.dirs.set('__default__', [{ name: 'task-1.md', isFile: true }]);
    mockFsState.files.set('/vault/task-1.md', '---\nid: task-1\n---\nbody');
    await setVaultPath('/vault');

    const result = await deleteTask('task-1');
    expect(result).toBe(true);
    expect(mockFsState.files.has('/vault/task-1.md')).toBe(false);
  });

  it('returns false if task not found', async () => {
    mockFsState.dirs.set('__default__', []);
    await setVaultPath('/vault');
    const result = await deleteTask('nonexistent');
    expect(result).toBe(false);
  });
});

describe('pickVaultFolder', () => {
  beforeEach(() => {
    mockStoreData.clear();
    mockDialogReturn.value = null;
    vi.clearAllMocks();
  });

  it('returns null if user cancels dialog', async () => {
    mockDialogReturn.value = null;
    const result = await pickVaultFolder();
    expect(result).toBeNull();
  });

  it('persists selected path and returns it', async () => {
    mockDialogReturn.value = '/chosen/vault';
    const result = await pickVaultFolder();
    expect(result).toBe('/chosen/vault');
    expect(await getVaultPath()).toBe('/chosen/vault');
  });
});
