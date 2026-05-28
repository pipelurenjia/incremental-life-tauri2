/**
 * 核心业务逻辑
 */

import { generateId } from './utils.js';

export function createTaskData(data) {
  const now = Date.now();
  return {
    id: generateId(),
    title: data.title.trim(),
    description: (data.description || '').trim(),
    status: 'active',
    next_review: data.next_review || now,
    last_pushed_at: now,
    paused_at: null,
    created_at: now,
    total_time_spent: 0,
    estimated_time: data.estimated_time || null,
  };
}

export function updateTaskFields(task, changes) {
  const allowed = [
    'title', 'description', 'status',
    'next_review', 'last_pushed_at', 'paused_at',
    'total_time_spent', 'estimated_time',
  ];
  const delta = {};
  for (const [field, value] of Object.entries(changes)) {
    if (allowed.includes(field) && task[field] !== value) {
      delta[field] = [task[field], value];
      task[field] = value;
    }
  }
  return delta;
}

export function scheduleTask(task, nextReview) {
  const now = Date.now();
  // 如果暂停中，先取消暂停再推进
  if (task.paused_at) {
    task.last_pushed_at += now - task.paused_at;
    task.paused_at = null;
  }
  const timeSpent = now - task.last_pushed_at;
  task.total_time_spent = (task.total_time_spent || 0) + timeSpent;
  const changes = {
    next_review: nextReview,
    last_pushed_at: now,
  };
  const delta = updateTaskFields(task, changes);
  return { delta, timeSpent };
}

export function completeTask(task) {
  const now = Date.now();
  if (task.paused_at) {
    task.last_pushed_at += now - task.paused_at;
    task.paused_at = null;
  }
  const timeSpent = now - task.last_pushed_at;
  task.total_time_spent = (task.total_time_spent || 0) + timeSpent;
  const changes = {
    status: 'completed',
    last_pushed_at: now,
  };
  const delta = updateTaskFields(task, changes);
  return { delta, timeSpent };
}

export function pushToEndOfToday(task, allTasks) {
  const now = Date.now();
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  const todayEnd = endOfToday.getTime();

  const todayTasks = allTasks.filter(
    t => t.status === 'active' && t.next_review >= now && t.next_review <= todayEnd && t.id !== task.id,
  );
  const maxNext = todayTasks.reduce(
    (max, t) => Math.max(max, t.next_review), now,
  );
  return maxNext + 1000;
}

export function getTodayEnd() {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

export function getCurrentTask(tasks) {
  const now = Date.now();
  const active = tasks
    .filter(t => t.status === 'active' && t.next_review <= now)
    .sort((a, b) => a.next_review - b.next_review);
  return active[0] || null;
}

export function getNextUpcomingTask(tasks) {
  const now = Date.now();
  const upcoming = tasks
    .filter(t => t.status === 'active' && t.next_review > now)
    .sort((a, b) => a.next_review - b.next_review);
  return upcoming[0] || null;
}

export function getActiveTasks(tasks) {
  return tasks
    .filter(t => t.status === 'active')
    .sort((a, b) => a.next_review - b.next_review);
}

export function getAllTasks(tasks, filter) {
  const q = (filter || '').toLowerCase();
  let result = [...tasks];
  if (q) {
    result = result.filter(t => t.title.toLowerCase().includes(q));
  }
  return result.sort((a, b) => b.created_at - a.created_at);
}

export function searchTasks(tasks, query) {
  const q = query.toLowerCase();
  return tasks
    .filter(t => t.title.toLowerCase().includes(q))
    .sort((a, b) => b.created_at - a.created_at);
}
