/**
 * Petite-Vue 响应式 Store
 */

import { reactive } from 'petite-vue';
import {
  loadTasks, saveTasks, loadLogs, saveLogs, backup, generateLog,
} from './storage.js';
import {
  createTaskData, updateTaskFields, scheduleTask, completeTask,
  getCurrentTask, getNextUpcomingTask, getActiveTasks, getAllTasks,
  searchTasks, pushToEndOfToday, getTodayEnd,
} from './actions.js';

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
    sidebar: {
      open: false,
      tab: 'active',
      width: 420,
      editTaskId: null,
    },
    searchQuery: '',
    validationErrors: {},

    // ---- 初始化 ----
    init() {
      this.tasks = loadTasks();
      this.actionLogs = loadLogs();
      this.currentTask = getCurrentTask(this.tasks);
      backup(this.tasks, this.actionLogs);
      this._bindKeyboard();
    },

    // ---- 工作模式 ----
    startWork() {
      this.working = true;
      this.currentTask = getCurrentTask(this.tasks);
      if (this.currentTask) {
        this.currentTask.last_pushed_at = Date.now();
        this.currentTask.paused_at = null;
        this._persist();
      }
    },

    stopWork() {
      this.working = false;
      const task = this.currentTask;
      if (task && !task.paused_at) {
        task.paused_at = Date.now();
        this._persist();
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
    doSchedule(nextReview) {
      const task = this.currentTask;
      if (!task) return;
      const snapshot = { ...task, paused_at: task.paused_at };
      const { delta, timeSpent } = scheduleTask(task, nextReview);
      const log = generateLog(task, 'advance', delta, timeSpent);
      this.actionLogs.unshift(log);
      this._persist();
      this.pushUndo({ logId: log.id, taskId: task.id, prevState: snapshot });
      this.currentTask = getCurrentTask(this.tasks);
      this._resetCurrentTaskTimer();
      this._persist();
    },

    doPushLater() {
      const task = this.currentTask;
      if (!task) return;
      const nextReview = pushToEndOfToday(task, this.tasks);
      const snapshot = { ...task, paused_at: task.paused_at };
      const { delta, timeSpent } = scheduleTask(task, nextReview);
      const log = generateLog(task, 'advance', delta, timeSpent);
      this.actionLogs.unshift(log);
      this._persist();
      this.pushUndo({ logId: log.id, taskId: task.id, prevState: snapshot });
      this.currentTask = getCurrentTask(this.tasks);
      this._resetCurrentTaskTimer();
      this._persist();
    },

    doComplete() {
      const task = this.currentTask;
      if (!task) return;
      const snapshot = { ...task, paused_at: task.paused_at };
      const { delta, timeSpent } = completeTask(task);
      const log = generateLog(task, 'complete', delta, timeSpent);
      this.actionLogs.unshift(log);
      this._persist();
      this.pushUndo({ logId: log.id, taskId: task.id, prevState: snapshot });
      this.currentTask = getCurrentTask(this.tasks);
      this._resetCurrentTaskTimer();
      this._persist();
    },

    doPause() {
      const task = this.currentTask;
      if (!task || task.paused_at) return;
      const snapshot = { ...task };
      task.paused_at = Date.now();
      this._persist();
      this.pushUndo({ logId: null, taskId: task.id, prevState: snapshot });
    },

    doUnpause() {
      const task = this.currentTask;
      if (!task || !task.paused_at) return;
      const snapshot = { ...task };
      const now = Date.now();
      task.last_pushed_at += now - task.paused_at;
      task.paused_at = null;
      this._persist();
      this.pushUndo({ logId: null, taskId: task.id, prevState: snapshot });
    },

    doCreate(data) {
      const task = createTaskData(data);
      this.tasks.push(task);
      const log = generateLog(task, 'create', {}, 0);
      this.actionLogs.unshift(log);
      this._persist();
      this.uiState = 'idle';
      this.validationErrors = {};
      if (!this.currentTask) {
        this.currentTask = getCurrentTask(this.tasks);
      }
    },

    doUpdate(taskId, changes) {
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
      this._persist();
      this.pushUndo({ logId: log.id, taskId: task.id, prevState: snapshot });
      this.uiState = 'idle';
      this.editingTaskId = null;
      this.validationErrors = {};
      this.currentTask = getCurrentTask(this.tasks);
    },

    doArchive(taskId) {
      const task = this.tasks.find(t => t.id === taskId);
      if (!task) return;
      const snapshot = { ...task };
      const delta = updateTaskFields(task, { status: 'archived' });
      const log = generateLog(task, 'archive', delta, 0);
      this.actionLogs.unshift(log);
      this._persist();
      this.pushUndo({ logId: log.id, taskId: task.id, prevState: snapshot });
      this.uiState = 'idle';
      this.editingTaskId = null;
      this.currentTask = getCurrentTask(this.tasks);
    },

    // ---- 撤销 ----
    pushUndo(snapshot) {
      this.undoStack.push(snapshot);
      if (this.undoStack.length > MAX_UNDO) {
        this.undoStack.shift();
      }
    },

    doUndo() {
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
      this._persist();
      this.currentTask = getCurrentTask(this.tasks);
    },

    // ---- 侧边栏 ----
    toggleSidebar() {
      this.sidebar.open = !this.sidebar.open;
      if (this.sidebar.open) {
        this.sidebar.tab = 'active';
        this.searchQuery = '';
      }
    },

    closeSidebar() {
      this.sidebar.open = false;
    },

    switchTab(tab) {
      this.sidebar.tab = tab;
      this.searchQuery = '';
    },

    // 侧边栏宽度拖拽
    startResize(e) {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = this.sidebar.width;
      const onMove = (ev) => {
        const delta = ev.clientX - startX;
        const w = Math.max(280, Math.min(700, startWidth + delta));
        this.sidebar.width = w;
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },

    // ---- 编辑/新建表单 ----
    openSidebarEdit(taskId) {
      const task = this.tasks.find(t => t.id === taskId);
      if (!task) return;
      this.editingTaskId = taskId;
      this._editTitle = task.title;
      this._editDesc = task.description || '';
      this._editDate = toDateInput(task.next_review);
      this._editEstimatedTime = task.estimated_time != null ? String(task.estimated_time) : '';
      this.sidebar.editTaskId = taskId;
      this.validationErrors = {};
    },

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

    // ---- 卡片内联编辑 ----
    startInlineEdit(task) {
      this.inlineEditing = task.id;
      this._inlineTitle = task.title;
      this._inlineDesc = task.description || '';
      this._inlineDate = toDateInput(task.next_review);
    },

    saveInlineEdit(taskId) {
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
        this.doUpdate(taskId, changes);
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

    getActiveTasks() {
      return getActiveTasks(this.tasks);
    },

    getAllTasks(filter) {
      return getAllTasks(this.tasks, filter);
    },

    doSearch(query) {
      return searchTasks(this.tasks, query);
    },

    getActionLabel(action) {
      const map = {
        advance: '推进',
        complete: '完成',
        create: '创建',
        update: '更新',
        archive: '归档',
      };
      return map[action] || action;
    },

    paused(task) {
      return task && !!task.paused_at;
    },

    // ---- 内部 ----
    _persist() {
      saveTasks(this.tasks);
      saveLogs(this.actionLogs);
      backup(this.tasks, this.actionLogs);
    },

    _bindKeyboard() {
      document.addEventListener('keydown', (e) => {
        const tag = document.activeElement?.tagName;
        const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

        if (e.key === 'Escape') {
          if (this.inlineEditing) {
            this.cancelInlineEdit();
          } else if (this.sidebar.editTaskId) {
            this.sidebar.editTaskId = null;
            this.validationErrors = {};
          } else if (this.sidebar.open) {
            this.closeSidebar();
          } else if (this.uiState !== 'idle') {
            this.closeForms();
          }
          return;
        }

        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
          e.preventDefault();
          if (!this.sidebar.open) this.toggleSidebar();
          this.sidebar.tab = 'search';
          return;
        }

        if (isInput) return;

        if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
          e.preventDefault();
          this.doUndo();
          return;
        }

        if (e.key === 'n' || e.key === 'N') {
          e.preventDefault();
          this.openCreateForm();
          return;
        }

        // 非工作模式只响应以上快捷键
        if (!this.working) return;

        const hasTask = !!this.currentTask;
        if (!hasTask) return;

        switch (e.key) {
          case '1':
            e.preventDefault();
            this.doPushLater();
            break;
          case '2':
            e.preventDefault();
            this.doSchedule(getTodayEnd() + 1000);
            break;
          case '3':
            e.preventDefault();
            this.doSchedule(Date.now() + 604800000);
            break;
          case ' ':
            e.preventDefault();
            if (this.currentTask?.paused_at) {
              this.doUnpause();
            } else {
              this.doPause();
            }
            break;
          case 'Enter':
            e.preventDefault();
            this.doComplete();
            break;
          case 'e':
          case 'E':
            e.preventDefault();
            this.startInlineEdit(this.currentTask);
            break;
        }
      });
    },
  });

  return store;
}
