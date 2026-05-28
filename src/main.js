import { createApp } from 'petite-vue';
import { createStore } from './store.js';
import { formatTime, formatCountdown, formatDateTime } from './utils.js';
import { validateTaskForm } from './components/edit-form.js';
import { getCurrentTask, getTodayEnd } from './actions.js';

const store = createStore();

// ---- 暂停/继续 ----
store.togglePause = () => {
  if (!store.currentTask) return;
  if (store.currentTask.paused_at) {
    store.doUnpause();
  } else {
    store.doPause();
  }
};

// ---- 编辑表单（侧边栏内嵌） ----
store._editTitle = '';
store._editDesc = '';
store._editDate = '';
store._editEstimatedTime = '';

store.onEditTitle = (e) => { store._editTitle = e.target.value; };
store.onEditDesc = (e) => { store._editDesc = e.target.value; };
store.onEditDate = (e) => { store._editDate = e.target.value; };
store.onEditEstimatedTime = (e) => { store._editEstimatedTime = e.target.value; };

store.saveEdit = () => {
  const errors = validateTaskForm(store._editTitle);
  if (Object.keys(errors).length) {
    store.validationErrors = errors;
    return;
  }
  const taskId = store.editingTaskId;
  const task = store.tasks.find(t => t.id === taskId);
  if (!task) {
    store.sidebar.editTaskId = null;
    store.validationErrors = {};
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
    store.sidebar.editTaskId = null;
    store.validationErrors = {};
    return;
  }
  store.doUpdate(taskId, changes);
  store.sidebar.editTaskId = null;
  store.validationErrors = {};
};

// ---- 卡片内联编辑 ----
store.onInlineTitle = (e) => { store._inlineTitle = e.target.value; };
store.onInlineDesc = (e) => { store._inlineDesc = e.target.value; };
store.onInlineDate = (e) => { store._inlineDate = e.target.value; };

store.confirmArchive = (taskId) => {
  if (confirm('确定归档此任务吗？')) {
    store.doArchive(taskId);
  }
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
};

// ---- 日期工具 ----
function toDateInput(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fromDateInput(str) {
  const d = new Date(str + 'T00:00:00');
  return d.getTime();
}

// ---- 模板辅助 ----
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
  const pad = (n) => String(n + 1 === n + 1 ? n : n).padStart(2, '0');
  const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  // today / tomorrow
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

// ---- 侧边栏 ----
store.sidebarTabs = [
  { id: 'active', label: '活跃' },
  { id: 'all', label: '全部' },
  { id: 'history', label: '历史' },
  { id: 'search', label: '搜索' },
];

// 侧边栏宽度样式（响应式）
store.sidebarStyle = () =>
  `width: ${store.sidebar.width}px`;

// ---- 初始化 ----
store._now = Date.now();
store.init();

setInterval(() => {
  store._now = Date.now();
}, 1000);

setInterval(() => {
  if (!store.currentTask) {
    store.currentTask = getCurrentTask(store.tasks);
  }
}, 10000);

createApp(store).mount('#app');
