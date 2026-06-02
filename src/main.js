/**
 * main.js — 应用入口
 *
 * 启动流程（bootstrap）：
 *  1. 创建 store（内存中，tasks=[]）
 *  2. 检查 vault 路径（plugin-store）
 *  3a. 未设置 → 挂载应用 + 显示首启向导（showWizard=true）
 *  3b. 已设置 → 初始化 vault → 加载任务 → 挂载应用
 *  4. 用户在向导中选 vault → 持久化 + 初始化 + 加载 + 隐藏向导
 *  5. 用户在 topbar 更换 vault → 清空内存 + 重新加载
 *
 * 设计要点：
 *  - Mount 只发生一次（无论走哪条分支）
 *  - 向导用 v-if 控制可见性，状态保存在 store 上
 *  - MD 渲染集中暴露 store.renderedDescription(task)
 */

import { createApp } from 'petite-vue';
import { createStore } from './store.js';
import { formatTime, formatCountdown, formatDateTime, autoResizeTextarea } from './utils.js';
import { validateTaskForm } from './components/edit-form.js';
import { getCurrentTask, getTodayEnd } from './actions.js';
import { renderMarkdown, renderMarkdownInline } from './markdown.js';
import {
  exportTasksToJSON, exportTasksToCSV, downloadFile, openFile, parseImportedTasks,
} from './storage.js';
import {
  getVaultPath, setVaultPath, initVault, pickVaultFolder,
} from './vault.js';

const store = createStore();

// ============================================================
// 启动状态（wizard / appReady）
// ============================================================

store.showWizard = false;
store.wizardError = '';
store.appReady = false;
store.vaultPath = null;

// ============================================================
// 向导 / 更换 vault
// ============================================================

store.onPickVault = async () => {
  store.wizardError = '';
  try {
    const path = await pickVaultFolder();
    if (!path) return;
    await initVault(path);
    store.vaultPath = path;
    await store.init();
    store.showWizard = false;
    store.appReady = true;
  } catch (e) {
    store.wizardError = `选择失败：${e.message || e}`;
  }
};

store.onChangeVault = async () => {
  store.wizardError = '';
  try {
    const path = await pickVaultFolder();
    if (!path) return;
    if (confirm('更换 Vault 后，当前所有任务将从内存清空并从新 Vault 重新加载。继续？')) {
      await setVaultPath(path);
      await initVault();
      store.vaultPath = path;
      await store.reloadFromVault();
    }
  } catch (e) {
    store.wizardError = `更换失败：${e.message || e}`;
  }
};

// ============================================================
// 暂停/继续
// ============================================================

store.togglePause = () => {
  if (!store.currentTask) return;
  if (store.currentTask.paused_at) {
    store.doUnpause();
  } else {
    store.doPause();
  }
};

store._editTitle = '';
store._editDesc = '';
store._editDate = '';
store._editEstimatedTime = '';

store._inlineTitle = '';
store._inlineDesc = '';
store._inlineDate = '';
store.inlineEditing = null;

store._createFormData = { title: '', description: '', dueDate: '' };
store.validationErrors = {};

store.onEditTitle = (e) => { store._editTitle = e.target.value; };
store.onEditDesc = (e) => { store._editDesc = e.target.value; autoResizeTextarea(e.target); };
store.onEditDate = (e) => { store._editDate = e.target.value; };
store.onEditEstimatedTime = (e) => { store._editEstimatedTime = e.target.value; };

store.onInlineTitle = (e) => { store._inlineTitle = e.target.value; };
store.onInlineDesc = (e) => { store._inlineDesc = e.target.value; autoResizeTextarea(e.target); };
store.onInlineDate = (e) => { store._inlineDate = e.target.value; };

store.onCreateTitle = (e) => { store._createFormData.title = e.target.value; };
store.onCreateDesc = (e) => { store._createFormData.description = e.target.value; autoResizeTextarea(e.target); };
store.onCreateDate = (e) => { store._createFormData.dueDate = e.target.value; };

store.startInlineEdit = (task) => {
  store.inlineEditing = task.id;
  store._inlineTitle = task.title;
  store._inlineDesc = task.description || '';
  store._inlineDate = task.next_review ? toDateInput(task.next_review) : '';
  store.validationErrors = {};
};

store.cancelInlineEdit = () => {
  store.inlineEditing = null;
  store._inlineTitle = '';
  store._inlineDesc = '';
  store._inlineDate = '';
};

store.saveInlineEdit = () => {
  const errors = validateTaskForm(store._inlineTitle);
  if (Object.keys(errors).length) {
    store.validationErrors = errors;
    return;
  }
  const taskId = store.inlineEditing;
  const task = store.tasks.find(t => t.id === taskId);
  if (!task) { store.cancelInlineEdit(); return; }
  const changes = {};
  const newTitle = store._inlineTitle.trim();
  const newDesc = (store._inlineDesc || '').trim();
  if (newTitle !== task.title) changes.title = newTitle;
  if (newDesc !== (task.description || '')) changes.description = newDesc;
  if (store._inlineDate) {
    const newDate = fromDateInput(store._inlineDate);
    if (newDate !== task.next_review) changes.next_review = newDate;
  }
  if (Object.keys(changes).length) {
    store.doUpdate(taskId, changes);
  }
  store.cancelInlineEdit();
  store.validationErrors = {};
};

// ============================================================
// 创建表单（browser 中）
// ============================================================

store.openCreateForm = () => {
  store.browser.showCreateForm = true;
  store._createFormData = { title: '', description: '', dueDate: toDateInput(Date.now()) };
  store.validationErrors = {};
  setTimeout(() => {
    autoResizeTextarea(document.querySelector('.modal textarea'));
  }, 0);
};

store.cancelCreateForm = () => {
  store.browser.showCreateForm = false;
  store._createFormData = { title: '', description: '', dueDate: '' };
  store.validationErrors = {};
};

store.confirmArchive = (taskId) => {
  if (confirm('确定归档此任务吗？')) {
    store.doArchive(taskId);
  }
};

// ============================================================
// 卡片浏览器
// ============================================================

store.saveBrowserEdit = () => {
  const taskId = store.browser.selectedTaskId;
  if (!taskId) return;
  const task = store.tasks.find(t => t.id === taskId);
  if (!task) { store.closeBrowserDetail(); return; }
  const errors = validateTaskForm(store._editTitle);
  if (Object.keys(errors).length) {
    store.validationErrors = errors;
    return;
  }
  const changes = {};
  const newTitle = store._editTitle.trim();
  const newDesc = (store._editDesc || '').trim();
  if (newTitle !== task.title) changes.title = newTitle;
  if (newDesc !== (task.description || '')) changes.description = newDesc;
  if (store._editDate) {
    const newDate = fromDateInput(store._editDate);
    if (newDate !== task.next_review) changes.next_review = newDate;
  }
  const estVal = store._editEstimatedTime.trim();
  if (estVal !== '') {
    const estNum = parseInt(estVal, 10);
    if (!isNaN(estNum) && estNum >= 0 && estNum !== task.estimated_time) {
      changes.estimated_time = estNum;
    }
  } else if (task.estimated_time !== null && task.estimated_time !== undefined) {
    changes.estimated_time = null;
  }
  if (Object.keys(changes).length === 0) {
    store.closeBrowserDetail();
    store.validationErrors = {};
    return;
  }
  store.doUpdate(taskId, changes);
  store.closeBrowserDetail();
  store.validationErrors = {};
};

store.cancelBrowserEdit = () => {
  store.closeBrowserDetail();
  store.validationErrors = {};
};

store.browserArchive = (taskId) => {
  if (confirm('确定归档此任务吗？')) {
    store.doArchive(taskId);
    store.closeBrowserDetail();
  }
};

store.browserDelete = (taskId) => {
  if (confirm('确定永久删除此任务吗？操作不可撤销。')) {
    store.doDelete(taskId);
  }
};

store.browserSortIcon = (column) => {
  if (store.browser.sortBy !== column) return ' ⇅';
  return store.browser.sortDir === 'asc' ? ' ↑' : ' ↓';
};

store.formatBrowserStatus = (status) =>
  ({ active: '活跃', completed: '已完成', archived: '已归档' }[status] || status);

store.browserStatusChange = (e) => {
  const taskId = store.browser.selectedTaskId;
  if (!taskId) return;
  const task = store.tasks.find(t => t.id === taskId);
  if (!task) return;
  const newStatus = e.target.value;
  if (newStatus !== task.status) {
    store.doUpdate(taskId, { status: newStatus });
  }
};

store.importTaskFile = async () => {
  try {
    const result = await openFile();
    if (!result) return;
    const imported = parseImportedTasks(result.content, result.ext);
    if (imported.length === 0) {
      alert('文件中没有可导入的任务');
      return;
    }
    for (const t of imported) {
      store.tasks.push(t);
    }
    await store._persist();
    alert(`成功导入 ${imported.length} 个任务`);
  } catch (e) {
    alert('导入失败: ' + e.message);
  }
};

store.exportJSON = async () => {
  const tasks = store.getBrowserTasks();
  if (tasks.length === 0) { alert('没有可导出的任务'); return; }
  const content = exportTasksToJSON(tasks);
  await downloadFile(content, 'progressive-tasks.json', 'application/json');
};

store.exportCSV = async () => {
  const tasks = store.getBrowserTasks();
  if (tasks.length === 0) { alert('没有可导出的任务'); return; }
  const content = exportTasksToCSV(tasks);
  await downloadFile(content, 'progressive-tasks.csv', 'text/csv; charset=utf-8');
};

store.submitCreate = () => {
  const errors = validateTaskForm(store._createFormData.title);
  if (Object.keys(errors).length) {
    store.validationErrors = errors;
    return;
  }
  store.doCreate({
    title: store._createFormData.title,
    description: store._createFormData.description,
    next_review: store._createFormData.dueDate ? fromDateInput(store._createFormData.dueDate) : undefined,
  });
  store.cancelCreateForm();
};

// ============================================================
// 日期工具
// ============================================================

function toDateInput(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fromDateInput(str) {
  const d = new Date(str + 'T00:00:00');
  return d.getTime();
}

// ============================================================
// 模板辅助
// ============================================================

store.formatTimer = (task) => {
  if (!task) return '00:00:00';
  if (task.paused_at) {
    return formatTime(task.paused_at - task.last_pushed_at);
  }
  return formatTime(store._now - task.last_pushed_at);
};

store.formatTotalTime = (ms) => {
  if (!ms || ms <= 0) return '暂无记录';
  const totalMin = Math.floor(ms / 60000);
  if (totalMin < 60) return `${totalMin} 分钟`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m > 0 ? `${h} 小时 ${m} 分钟` : `${h} 小时`;
};

store.formatCountdown = (ts) => formatCountdown(ts);
store.formatDateTime = (ts) => formatDateTime(ts);

store.statusLabel = (s) =>
  ({ active: '活跃', completed: '已完成', archived: '已归档' }[s] || s);

store.formatNextReview = (ts) => {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const taskDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((taskDay - today) / 86400000);

  if (diffDays === 0) return '今天';
  if (diffDays === 1) return '明天';
  if (diffDays === -1) return '昨天';
  if (diffDays < -1) return `${Math.abs(diffDays)} 天前`;
  if (diffDays < 7) return `${diffDays} 天后`;
  return dateStr;
};

store.formatDueDate = (ts) => toDateInput(ts);
store.getTodayEnd = getTodayEnd;

store.renderedDescription = (task) => {
  if (!task) return '';
  return renderMarkdown(task.description || '');
};

store.livePreview = (text) => text && text.trim() ? renderMarkdown(text) : '<span class="md-empty">暂无备注</span>';

store.renderedTitle = (task) => {
  if (!task) return '';
  return renderMarkdownInline(task.title || '');
};

store._now = Date.now();

// ============================================================
// Bootstrap
// ============================================================

async function bootstrap() {
  try {
    const path = await getVaultPath();
    store.vaultPath = path;
    if (!path) {
      store.showWizard = true;
    } else {
      try {
        await initVault();
        await store.init();
        store.appReady = true;
      } catch (e) {
        store.showWizard = true;
        store.wizardError = `原 Vault 目录不可访问：${e.message || e}。请重新选择。`;
      }
    }
  } catch (e) {
    store.showWizard = true;
    store.wizardError = `初始化失败：${e.message || e}`;
  }
  createApp(store).mount('#app');
}

bootstrap();

// ============================================================
// 后台 ticker
// ============================================================

setInterval(() => {
  store._now = Date.now();
}, 1000);

setInterval(() => {
  if (store.appReady && !store.currentTask) {
    store.currentTask = getCurrentTask(store.tasks);
  }
}, 10000);
