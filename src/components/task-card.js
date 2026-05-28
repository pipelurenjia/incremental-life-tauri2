/**
 * 任务卡片辅助函数
 */

import { escapeHtml } from '../utils.js';

export function taskCardHtml(task) {
  return escapeHtml(task.title);
}

export function taskDescriptionHtml(desc) {
  if (!desc) return '';
  return escapeHtml(desc);
}
