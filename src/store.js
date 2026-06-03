/**
 * Petite-Vue 响应式 Store
 * 所有持久化操作改造为 async（Tauri Store Plugin）
 */

import { reactive } from 'petite-vue';
import {
  loadTasks, saveTasks, loadLogs, saveLogs, backup, generateLog,
} from './storage.js';
import {
  createTaskData, updateTaskFields, scheduleTask, completeTask,
  getCurrentTask, getNextUpcomingTask, pushToEndOfToday, getTodayEnd,
} from './actions.js';
import { autoResizeTextarea } from './utils.js';

const MAX_UNDO = 50;

function toDateInput(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fromDateInput(str) {
  return new Date(str + 'T00:00:00').getTime();
}

export function createStore() {
  const store = reactive({
    tasks: [],
    actionLogs: [],
    currentTask: null,
    working: false,
    uiState: 'idle',
    undoStack: [],
    editingTaskId: null,
    // inline editing on task card
    inlineEditing: null,
    _inlineTitle: '',
    _inlineDesc: '',
    _inlineDate: '',
    validationErrors: {},
    browser: {
      open: false,
      sortBy: 'next_review',
      sortDir: 'asc',
      searchQuery: '',
      statusFilter: 'all',
      selectedTaskId: null,
      detailOpen: false,
    },

    // ---- 初始化 ----
    async init() {
      this.tasks = await loadTasks();
      this.actionLogs = await loadLogs();
      this.undoStack = [];
      this.currentTask = getCurrentTask(this.tasks);
      backup(this.tasks, this.actionLogs);
      this._bindKeyboard();
    },

    async reloadFromVault() {
      this.tasks = [];
      this.actionLogs = [];
      this.undoStack = [];
      this.currentTask = null;
      this.browser.open = false;
      this.browser.detailOpen = false;
      this.browser.selectedTaskId = null;
      this.working = false;
      await this.init();
    },

    // ---- 工作模式 ----
    async startWork(task = null) {
      this.working = true;
      this.currentTask = task || getCurrentTask(this.tasks);
      if (this.currentTask) {
        this.currentTask.last_pushed_at = Date.now();
        this.currentTask.paused_at = null;
        await this._persist();
      }
    },

    async stopWork() {
      this.working = false;
      const task = this.currentTask;
      if (task && !task.paused_at) {
        task.paused_at = Date.now();
        await this._persist();
      }
    },

    _resetCurrentTaskTimer() {
      if (this.currentTask) {
        this.currentTask.last_pushed_at = Date.now();
        this.currentTask.paused_at = null;
      }
    },

    countDueToday() {
      const now = Date.now();
      return this.tasks.filter(
        t => t.status === 'active' && t.next_review <= new Date().setHours(23, 59, 59, 999),
      ).length;
    },

    // ---- 任务操作 ----
    async doSchedule(nextReview) {
      const task = this.currentTask;
      if (!task) return;
      const snapshot = { ...task, paused_at: task.paused_at };
      const { delta, timeSpent } = scheduleTask(task, nextReview);
      const log = generateLog(task, 'advance', delta, timeSpent);
      this.actionLogs.unshift(log);
      await this._persist();
      this.pushUndo({ logId: log.id, taskId: task.id, prevState: snapshot });
      this.currentTask = getCurrentTask(this.tasks);
      this._resetCurrentTaskTimer();
      await this._persist();
    },

    async doPushLater() {
      const task = this.currentTask;
      if (!task) return;
      const nextReview = pushToEndOfToday(task, this.tasks);
      const snapshot = { ...task, paused_at: task.paused_at };
      const { delta, timeSpent } = scheduleTask(task, nextReview);
      const log = generateLog(task, 'advance', delta, timeSpent);
      this.actionLogs.unshift(log);
      await this._persist();
      this.pushUndo({ logId: log.id, taskId: task.id, prevState: snapshot });
      this.currentTask = getCurrentTask(this.tasks);
      this._resetCurrentTaskTimer();
      await this._persist();
    },

    async doComplete() {
      const task = this.currentTask;
      if (!task) return;
      const snapshot = { ...task, paused_at: task.paused_at };
      const { delta, timeSpent } = completeTask(task);
      const log = generateLog(task, 'complete', delta, timeSpent);
      this.actionLogs.unshift(log);
      await this._persist();
      this.pushUndo({ logId: log.id, taskId: task.id, prevState: snapshot });
      this.currentTask = getCurrentTask(this.tasks);
      this._resetCurrentTaskTimer();
      await this._persist();
    },

    async doPause() {
      const task = this.currentTask;
      if (!task || task.paused_at) return;
      const snapshot = { ...task };
      task.paused_at = Date.now();
      await this._persist();
      this.pushUndo({ logId: null, taskId: task.id, prevState: snapshot });
    },

    async doUnpause() {
      const task = this.currentTask;
      if (!task || !task.paused_at) return;
      const snapshot = { ...task };
      const now = Date.now();
      task.last_pushed_at += now - task.paused_at;
      task.paused_at = null;
      await this._persist();
      this.pushUndo({ logId: null, taskId: task.id, prevState: snapshot });
    },

    async doCreate(data) {
      const task = createTaskData(data);
      this.tasks.push(task);
      const log = generateLog(task, 'create', {}, 0);
      this.actionLogs.unshift(log);
      await this._persist();
      this.uiState = 'idle';
      this.validationErrors = {};
      if (!this.currentTask) {
        this.currentTask = getCurrentTask(this.tasks);
      }
    },

    async doUpdate(taskId, changes) {
      const task = this.tasks.find(t => t.id === taskId);
      if (!task) return;
      const snapshot = { ...task };
      const delta = updateTaskFields(task, changes);
      if (Object.keys(delta).length === 0) {
        this.uiState = 'idle';
        this.editingTaskId = null;
        return;
      }
      const log = generateLog(task, 'update', delta, 0);
      this.actionLogs.unshift(log);
      await this._persist();
      this.pushUndo({ logId: log.id, taskId: task.id, prevState: snapshot });
      this.uiState = 'idle';
      this.editingTaskId = null;
      this.validationErrors = {};
      this.currentTask = getCurrentTask(this.tasks);
    },

    async doArchive(taskId) {
      const task = this.tasks.find(t => t.id === taskId);
      if (!task) return;
      const snapshot = { ...task };
      const delta = updateTaskFields(task, { status: 'archived' });
      const log = generateLog(task, 'archive', delta, 0);
      this.actionLogs.unshift(log);
      await this._persist();
      this.pushUndo({ logId: log.id, taskId: task.id, prevState: snapshot });
      this.uiState = 'idle';
      this.editingTaskId = null;
      this.currentTask = getCurrentTask(this.tasks);
    },

    async doDelete(taskId) {
      const task = this.tasks.find(t => t.id === taskId);
      if (!task) return;
      this.tasks = this.tasks.filter(t => t.id !== taskId);
      this.actionLogs = this.actionLogs.filter(l => l.task_id !== taskId);
      if (this.currentTask?.id === taskId) {
        this.currentTask = getCurrentTask(this.tasks);
      }
      if (this.browser.selectedTaskId === taskId) {
        this.browser.selectedTaskId = null;
        this.browser.detailOpen = false;
      }
      await this._persist();
    },

    // ---- 撤销 ----
    pushUndo(snapshot) {
      this.undoStack.push(snapshot);
      if (this.undoStack.length > MAX_UNDO) {
        this.undoStack.shift();
      }
    },

    async doUndo() {
      if (!this.undoStack.length) return;
      const entry = this.undoStack.pop();
      const task = this.tasks.find(t => t.id === entry.taskId);
      if (task) {
        Object.assign(task, entry.prevState);
      }
      if (entry.logId) {
        const logIdx = this.actionLogs.findIndex(l => l.id === entry.logId);
        if (logIdx !== -1) this.actionLogs.splice(logIdx, 1);
      }
      await this._persist();
      this.currentTask = getCurrentTask(this.tasks);
    },

    // ---- 新建表单 ----
    openCreateForm() {
      this.uiState = 'creating';
      this._createFormData = { title: '', description: '', dueDate: toDateInput(Date.now()) };
      this.validationErrors = {};
    },

    closeForms() {
      this.uiState = 'idle';
      this.editingTaskId = null;
      this.validationErrors = {};
    },

    // ---- 卡片浏览器 ----
    toggleBrowser() {
      this.browser.open = !this.browser.open;
      if (this.browser.open) {
        this.browser.detailOpen = false;
        this.browser.selectedTaskId = null;
        this.browser.searchQuery = '';
        this.browser.statusFilter = 'all';
      }
    },

    closeBrowser() {
      this.browser.open = false;
      this.browser.detailOpen = false;
      this.browser.selectedTaskId = null;
    },

    browserSetSort(column) {
      if (this.browser.sortBy === column) {
        this.browser.sortDir = this.browser.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        this.browser.sortBy = column;
        this.browser.sortDir = 'asc';
      }
    },

    getBrowserTasks() {
      let result = [...this.tasks];
      const q = this.browser.searchQuery.trim().toLowerCase();
      if (q) {
        result = result.filter(t =>
          t.title.toLowerCase().includes(q) ||
          (t.description || '').toLowerCase().includes(q)
        );
      }
      const sf = this.browser.statusFilter;
      if (sf && sf !== 'all') {
        result = result.filter(t => t.status === sf);
      }
      const sortBy = this.browser.sortBy;
      const dir = this.browser.sortDir === 'asc' ? 1 : -1;
      result.sort((a, b) => {
        let va = a[sortBy];
        let vb = b[sortBy];
        if (sortBy === 'title') {
          va = (va || '').toLowerCase();
          vb = (vb || '').toLowerCase();
          return va < vb ? -dir : va > vb ? dir : 0;
        }
        if (sortBy === 'status') {
          const order = { active: 0, completed: 1, archived: 2 };
          return (order[va] || 0) < (order[vb] || 0) ? -dir : dir;
        }
        va = va ?? 0;
        vb = vb ?? 0;
        return (va - vb) * dir;
      });
      return result;
    },

    selectBrowserTask(taskId) {
      this.browser.selectedTaskId = taskId;
      this.browser.detailOpen = true;
      const task = this.tasks.find(t => t.id === taskId);
      if (task) {
        this._editTitle = task.title;
        this._editDesc = task.description || '';
        this._editDate = toDateInput(task.next_review);
        this._editEstimatedTime = task.estimated_time != null ? String(task.estimated_time) : '';
      }
      this.validationErrors = {};
      requestAnimationFrame(() => {
        autoResizeTextarea(document.querySelector('.browser-detail-body textarea'));
      });
    },

    closeBrowserDetail() {
      this.browser.detailOpen = false;
      this.browser.selectedTaskId = null;
      this.validationErrors = {};
    },

    async startFromBrowser(taskId) {
      const task = this.tasks.find(t => t.id === taskId);
      if (!task) return;
      await this.startWork(task);
      this.browser.open = false;
      this.browser.detailOpen = false;
      this.browser.selectedTaskId = null;
    },

    // ---- 卡片内联编辑 ----
    startInlineEdit(task) {
      this.inlineEditing = task.id;
      this._inlineTitle = task.title;
      this._inlineDesc = task.description || '';
      this._inlineDate = toDateInput(task.next_review);
      requestAnimationFrame(() => {
        autoResizeTextarea(document.querySelector('.task-desc-input'));
      });
    },

    async saveInlineEdit(taskId) {
      const task = this.tasks.find(t => t.id === taskId);
      if (!task) { this.inlineEditing = null; return; }
      const changes = {};
      const newTitle = this._inlineTitle.trim();
      const newDesc = this._inlineDesc.trim();
      if (newTitle && newTitle !== task.title) changes.title = newTitle;
      if (newDesc !== (task.description || '')) changes.description = newDesc;
      if (this._inlineDate) {
        const newDate = fromDateInput(this._inlineDate);
        if (newDate !== task.next_review) changes.next_review = newDate;
      }
      if (Object.keys(changes).length > 0) {
        await this.doUpdate(taskId, changes);
      }
      this.inlineEditing = null;
    },

    cancelInlineEdit() {
      this.inlineEditing = null;
    },

    // ---- 帮助方法 ----
    getTaskById(id) {
      return this.tasks.find(t => t.id === id) || null;
    },

    getNextUpcoming() {
      return getNextUpcomingTask(this.tasks);
    },

    paused(task) {
      return task && !!task.paused_at;
    },

    // ---- 内部 ----
    async _persist() {
      await saveTasks(this.tasks);
      await saveLogs(this.actionLogs);
      await backup(this.tasks, this.actionLogs);
    },

    _bindKeyboard() {
      if (this._keyboardBound) return;
      this._keyboardBound = true;
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          if (this.inlineEditing) {
            this.cancelInlineEdit();
          } else if (this.browser.detailOpen) {
            this.closeBrowserDetail();
          } else if (this.browser.open) {
            this.closeBrowser();
          } else if (this.uiState !== 'idle') {
            this.closeForms();
          }
        }
      });
    },
  });

  return store;
}
