import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockFiles = new Map();
const mockDirs = new Map();
const mockStoreData = new Map();

vi.mock('@tauri-apps/plugin-fs', () => ({
  readTextFile: vi.fn(async (path) => {
    if (mockFiles.has(path)) return mockFiles.get(path);
    throw new Error(`ENOENT: ${path}`);
  }),
  writeTextFile: vi.fn(async (path, content) => {
    mockFiles.set(path, content);
    const sep = path.lastIndexOf('/');
    if (sep <= 0) return;
    const dir = path.slice(0, sep);
    const name = path.slice(sep + 1);
    const entries = mockDirs.get(dir) || [];
    if (!entries.find(e => e.name === name)) {
      entries.push({ name, isFile: true, isDirectory: false });
      mockDirs.set(dir, entries);
    }
  }),
  readDir: vi.fn(async (path) => mockDirs.get(path) || []),
  mkdir: vi.fn(async (path) => { if (!mockDirs.has(path)) mockDirs.set(path, []); }),
  exists: vi.fn(async (path) => mockFiles.has(path) || mockDirs.has(path)),
  remove: vi.fn(async (path) => {
    mockFiles.delete(path);
    const sep = path.lastIndexOf('/');
    if (sep <= 0) return;
    const dir = path.slice(0, sep);
    const name = path.slice(sep + 1);
    const entries = mockDirs.get(dir) || [];
    mockDirs.set(dir, entries.filter(e => e.name !== name));
  }),
}));

vi.mock('@tauri-apps/plugin-store', () => ({
  load: vi.fn(async () => ({
    get: async (k) => mockStoreData.get(k),
    set: async (k, v) => { mockStoreData.set(k, v); },
    save: async () => {},
    delete: async (k) => { mockStoreData.delete(k); },
  })),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(async () => null),
  save: vi.fn(async () => null),
}));

beforeEach(async () => {
  mockFiles.clear();
  mockDirs.clear();
  mockStoreData.clear();
  const vault = await import('../src/vault.js');
  vault._resetForTests();
  vi.clearAllMocks();
});

describe('integration: MD file round-trip', () => {
  it('writes a task and reads it back, preserving frontmatter + body', async () => {
    const { setVaultPath, initVault, writeTask, readAllTasks } = await import('../src/vault.js');
    await setVaultPath('/integration/vault-a');
    await initVault();

    const task = {
      id: 1,
      title: 'Read paper',
      status: 'active',
      next_review: 1730000000000,
      created_at: 1729000000000,
      description: '# Notes\n\n- key point 1\n- key point 2\n',
    };
    const result = await writeTask(task);

    expect(result.filename).toBe('read-paper.md');
    expect(mockFiles.has(result.path)).toBe(true);

    const content = mockFiles.get(result.path);
    expect(content.startsWith('---\n')).toBe(true);
    expect(content).toContain('id: 1');
    expect(content).toContain('title: Read paper');
    expect(content).toContain('status: active');
    expect(content).toContain('next_review: 1730000000000');
    expect(content).toContain('# Notes');
    expect(content).toContain('key point 1');

    const tasks = await readAllTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe('1');
    expect(tasks[0].title).toBe('Read paper');
    expect(tasks[0].description).toContain('key point 1');
  });

  it('overwrites same-id task in place (no filename change)', async () => {
    const { setVaultPath, initVault, writeTask, readAllTasks } = await import('../src/vault.js');
    await setVaultPath('/integration/vault-b');
    await initVault();

    await writeTask({ id: 42, title: 'Original', status: 'active', description: 'v1' });
    const r1 = await writeTask({ id: 42, title: 'Renamed', status: 'completed', description: 'v2' });

    expect(r1.filename).toBe('original.md');

    const tasks = await readAllTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe('Renamed');
    expect(tasks[0].status).toBe('completed');
    expect(tasks[0].description).toBe('v2');
    expect(mockFiles.size).toBe(1);
  });

  it('deletes a task by id and the file is gone', async () => {
    const { setVaultPath, initVault, writeTask, deleteTask, readAllTasks } = await import('../src/vault.js');
    await setVaultPath('/integration/vault-c');
    await initVault();

    await writeTask({ id: 1, title: 'Keep', status: 'active', description: '' });
    await writeTask({ id: 2, title: 'Delete me', status: 'active', description: '' });
    expect((await readAllTasks()).length).toBe(2);

    const deleted = await deleteTask(2);
    expect(deleted).toBe(true);

    const remaining = await readAllTasks();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].title).toBe('Keep');
    expect(mockFiles.size).toBe(1);
  });

  it('preserves multiline description (newlines, bullets, code fences)', async () => {
    const { setVaultPath, initVault, writeTask, readAllTasks } = await import('../src/vault.js');
    await setVaultPath('/integration/vault-d');
    await initVault();

    const desc = 'Line 1\n\nLine 2\n\n- bullet\n- bullet 2\n\n```js\nconst x = 1;\n```\n';
    await writeTask({ id: 7, title: 'Multiline', status: 'active', description: desc });

    const tasks = await readAllTasks();
    expect(tasks[0].description).toBe(desc);
  });

  it('resolves filename collision by appending short id suffix', async () => {
    const { setVaultPath, initVault, writeTask } = await import('../src/vault.js');
    await setVaultPath('/integration/vault-e');
    await initVault();

    const r1 = await writeTask({ id: 'abcdef123456', title: 'Same', status: 'active', description: '' });
    const r2 = await writeTask({ id: 'abcdef654321', title: 'Same', status: 'active', description: '' });

    expect(r1.filename).toBe('same.md');
    expect(r2.filename).toBe('same-abcdef.md');
  });

  it('survives a simulated reload: vault path persists in store', async () => {
    const { setVaultPath, _resetForTests } = await import('../src/vault.js');
    await setVaultPath('/my/persistent/vault');
    expect(mockStoreData.get('vault_path')).toBe('/my/persistent/vault');

    _resetForTests();
    const { getVaultPath } = await import('../src/vault.js');
    expect(await getVaultPath()).toBe('/my/persistent/vault');
  });

  it('round-trip: serializeFrontmatter(empty data) emits no YAML body', async () => {
    const { setVaultPath, initVault, writeTask, readAllTasks } = await import('../src/vault.js');
    await setVaultPath('/integration/vault-f');
    await initVault();

    await writeTask({ id: 99, title: 'NoBody', status: 'active', description: '' });
    const tasks = await readAllTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].description).toBe('');
  });

  it('storage layer round-trip: saveTasks → loadTasks preserves all fields', async () => {
    const { setVaultPath, initVault, clearVaultPath } = await import('../src/vault.js');
    const storage = await import('../src/storage.js');

    await setVaultPath('/integration/vault-g');
    await initVault();

    const tasks = [
      { id: 1, title: 'A', status: 'active', created_at: 100, next_review: 200, total_time_spent: 5000, estimated_time: 30, description: 'desc A' },
      { id: 2, title: 'B', status: 'completed', created_at: 101, next_review: 201, total_time_spent: 0, estimated_time: null, description: 'desc B' },
    ];
    await storage.saveTasks(tasks);

    const loaded = await storage.loadTasks();
    expect(loaded).toHaveLength(2);

    const a = loaded.find(t => t.id === '1');
    const b = loaded.find(t => t.id === '2');
    expect(a.title).toBe('A');
    expect(a.total_time_spent).toBe(5000);
    expect(a.estimated_time).toBe(30);
    expect(a.description).toBe('desc A');
    expect(b.title).toBe('B');
    expect(b.status).toBe('completed');
    expect(b.estimated_time).toBe(null);
    expect(b.description).toBe('desc B');
  });
});
