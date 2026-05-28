import { describe, it, expect, beforeEach } from 'vitest';
import {
  createTaskData,
  updateTaskFields,
  scheduleTask,
  completeTask,
  getCurrentTask,
  getNextUpcomingTask,
  getActiveTasks,
  getAllTasks,
  searchTasks,
} from '../src/actions.js';

function makeTask(overrides = {}) {
  return {
    id: 'test1',
    title: 'Test Task',
    description: '',
    status: 'active',
    next_review: Date.now() - 60000,
    last_pushed_at: Date.now() - 3600000,
    created_at: Date.now() - 86400000,
    ...overrides,
  };
}

describe('createTaskData', () => {
  it('should create task with required fields', () => {
    const task = createTaskData({ title: '  My Task  ', description: '  Notes  ' });
    expect(task.title).toBe('My Task');
    expect(task.description).toBe('Notes');
    expect(task.status).toBe('active');
    expect(task.id).toBeTypeOf('string');
    expect(task.next_review).toBeTypeOf('number');
  });

  it('should handle empty description', () => {
    const task = createTaskData({ title: 'Test' });
    expect(task.description).toBe('');
  });
});

describe('updateTaskFields', () => {
  it('should update allowed fields and return delta', () => {
    const task = makeTask();
    const delta = updateTaskFields(task, { title: 'New Title', next_review: 99999 });
    expect(task.title).toBe('New Title');
    expect(task.next_review).toBe(99999);
    expect(delta.title).toEqual(['Test Task', 'New Title']);
    expect(delta.next_review).toBeDefined();
  });

  it('should ignore disallowed fields', () => {
    const task = makeTask();
    const delta = updateTaskFields(task, { id: 'hacked', status: 'completed' });
    expect(task.id).toBe('test1');
    expect(task.status).toBe('completed');
    expect(delta.id).toBeUndefined();
  });

  it('should not record unchanged values', () => {
    const task = makeTask();
    const delta = updateTaskFields(task, { title: 'Test Task' });
    expect(delta.title).toBeUndefined();
  });
});

describe('scheduleTask', () => {
  it('should update next_review and last_pushed_at', () => {
    const task = makeTask({ last_pushed_at: Date.now() - 3600000 });
    const { delta, timeSpent } = scheduleTask(task, Date.now() + 7200000);
    expect(task.next_review).toBeGreaterThan(Date.now());
    expect(task.last_pushed_at).toBeGreaterThan(Date.now() - 1000);
    expect(timeSpent).toBeGreaterThan(0);
    expect(delta.next_review).toBeDefined();
    expect(delta.last_pushed_at).toBeDefined();
  });
});

describe('completeTask', () => {
  it('should set status to completed', () => {
    const task = makeTask();
    const { delta } = completeTask(task);
    expect(task.status).toBe('completed');
    expect(delta.status).toEqual(['active', 'completed']);
  });
});

describe('getCurrentTask', () => {
  it('should return null when no tasks', () => {
    expect(getCurrentTask([])).toBeNull();
  });

  it('should return null when no active tasks are due', () => {
    const tasks = [makeTask({ next_review: Date.now() + 3600000 })];
    expect(getCurrentTask(tasks)).toBeNull();
  });

  it('should return the earliest due active task', () => {
    const t1 = makeTask({ id: 't1', next_review: Date.now() - 5000 });
    const t2 = makeTask({ id: 't2', next_review: Date.now() - 10000 });
    const result = getCurrentTask([t1, t2]);
    expect(result.id).toBe('t2');
  });

  it('should ignore completed tasks', () => {
    const tasks = [makeTask({ status: 'completed', next_review: Date.now() - 60000 })];
    expect(getCurrentTask(tasks)).toBeNull();
  });
});

describe('getNextUpcomingTask', () => {
  it('should return the soonest future task', () => {
    const t1 = makeTask({ id: 't1', next_review: Date.now() + 7200000 });
    const t2 = makeTask({ id: 't2', next_review: Date.now() + 3600000 });
    const result = getNextUpcomingTask([t1, t2]);
    expect(result.id).toBe('t2');
  });

  it('should return null when no future tasks', () => {
    expect(getNextUpcomingTask([])).toBeNull();
  });
});

describe('getActiveTasks', () => {
  it('should return only active tasks sorted by next_review', () => {
    const tasks = [
      makeTask({ id: 'a', next_review: Date.now() + 5000 }),
      makeTask({ id: 'b', next_review: Date.now() + 1000, status: 'completed' }),
      makeTask({ id: 'c', next_review: Date.now() + 2000 }),
    ];
    const result = getActiveTasks(tasks);
    expect(result.map(t => t.id)).toEqual(['c', 'a']);
  });
});

describe('searchTasks', () => {
  it('should find tasks by title substring, case insensitive', () => {
    const tasks = [
      makeTask({ id: '1', title: '写周报' }),
      makeTask({ id: '2', title: '写月报' }),
      makeTask({ id: '3', title: '开会' }),
    ];
    const result = searchTasks(tasks, '周');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('1');
  });
});
