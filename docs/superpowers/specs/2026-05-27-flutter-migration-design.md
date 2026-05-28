# Flutter 全平台迁移 — 架构设计文档

## 项目背景

将「渐进执行」（IncrementalLife2）从 Vite + Petite-Vue 纯 Web 端迁移到 Flutter 全平台（iOS / Android / Web / Desktop）。现有 Web 版保持不变、独立运行。

## 架构选型

采用 Clean Architecture + Riverpod，理由：
- 符合 Flutter 生态主流实践，社区资源丰富
- 三层依赖反转（Presentation → Domain ← Data），Domain 层纯 Dart 无框架依赖，可复用现有 JS 测试用例
- Riverpod 编译时安全，比 ChangeNotifier 更适合派生状态链（`allTasks → currentTask → UI`）

## 分层设计

```
┌─────────────────────────────────────────────┐
│               Presentation                   │
│  Pages / Widgets                            │
│  Riverpod providers (状态派生、计时器、撤销) │
├─────────────────────────────────────────────┤
│                 Domain                       │
│  Entities (Task, ActionLog)                  │
│  Repository interfaces (抽象)               │
│  Use cases (CreateTask, ScheduleTask...)      │
├─────────────────────────────────────────────┤
│                  Data                        │
│  Repository implementations                  │
│  drift SQLite database                       │
│  DAO / mappers / DTOs                        │
└─────────────────────────────────────────────┘
```

依赖方向：Presentation ↔ Domain ← Data（Domain 层零外部依赖）

---

## 一、Domain 层

### 1.1 实体

```dart
// domain/entities/task.dart
class Task {
  final String id;           // Date.now().toString(36) + random
  final String title;
  final String description;  // 默认空字符串
  final TaskStatus status;   // active | completed | archived
  final DateTime nextReview;  // 调度以此字段为准
  final DateTime lastPushedAt;
  final DateTime? pausedAt;   // null = 未暂停
  final DateTime createdAt;
  final int? estimatedTime;  // 分钟, 未来扩展
}

enum TaskStatus { active, completed, archived }
```

```dart
// domain/entities/action_log.dart
class ActionLog {
  final String id;
  final String taskId;
  final String taskTitle;     // 冗余存储
  final LogAction action;     // advance|complete|create|update|archive
  final Map<String, List<dynamic>> changes; // {field: [old, new]}
  final int timeSpent;        // ms
  final DateTime timestamp;
}

enum LogAction { advance, complete, create, update, archive }
```

### 1.2 Repository 接口（抽象）

```dart
abstract class TaskRepository {
  Stream<List<Task>> watchAll();  // drift watch, 响应式
  Future<List<Task>> loadAll();
  Future<void> saveAll(List<Task> tasks);
  Future<void> backup(List<Task> tasks, List<ActionLog> logs);
}

abstract class ActionLogRepository {
  Stream<List<ActionLog>> watchAll();
  Future<List<ActionLog>> loadAll();
  Future<void> saveAll(List<ActionLog> logs);
}
```

### 1.3 Use Cases

每个 UseCase 是单一职责类，注入 Repository 接口，纯 Dart 无框架依赖。

| UseCase | 对应现有函数 | 输入 → 输出 |
|---------|------------|-------------|
| `CreateTask` | `actions.createTaskData()` | title, desc, due → Task |
| `ScheduleTask` | `actions.scheduleTask()` | task, nextReview → delta |
| `CompleteTask` | `actions.completeTask()` | task → delta, timeSpent |
| `PushToEndOfToday` | `actions.pushToEndOfToday()` | task, tasks → nextReview |
| `GetCurrentTask` | `actions.getCurrentTask()` | tasks → Task? (到期最早) |
| `GetNextUpcomingTask` | `actions.getNextUpcomingTask()` | tasks → Task? (下一个未来) |
| `GetActiveTasks` | `actions.getActiveTasks()` | tasks → List (按next_review排) |
| `GetAllTasks` | `actions.getAllTasks()` | tasks, filter → List |
| `SearchTasks` | `actions.searchTasks()` | tasks, query → List |
| `UpdateTask` | `actions.updateTaskFields()` | task, changes → delta |
| `ArchiveTask` | — | task → delta |
| `UndoLastAction` | — | undoEntry → restored task |

---

## 二、Data 层

### 2.1 持久化方案：drift (SQLite)

选择 drift 而非 hive：任务按 status/next_review 排序过滤，SQL 天然适合；`watch()` 返回 Stream 可直接驱动 Riverpod。

### 2.2 数据库表

```sql
CREATE TABLE tasks (
  id              TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'active',
  next_review     INTEGER NOT NULL,       -- Unix ms
  last_pushed_at  INTEGER NOT NULL,
  paused_at       INTEGER,               -- nullable
  created_at      INTEGER NOT NULL,
  estimated_time  INTEGER                -- nullable, 未来扩展
);

CREATE TABLE action_logs (
  id          TEXT PRIMARY KEY,
  task_id     TEXT NOT NULL,
  task_title  TEXT NOT NULL,
  action      TEXT NOT NULL,
  changes     TEXT NOT NULL,              -- JSON
  time_spent  INTEGER NOT NULL DEFAULT 0,
  timestamp   INTEGER NOT NULL
);
```

### 2.3 目录结构

```
data/
├── database/
│   ├── database.dart          # drift 数据库定义
│   └── dao/
│       ├── task_dao.dart      # 按status/next_review查询
│       └── log_dao.dart       # 按task_id/时间查询
├── repositories/
│   ├── task_repository_impl.dart
│   └── log_repository_impl.dart
└── mappers/
    ├── task_mapper.dart       # drift DataClass ↔ domain Task
    └── log_mapper.dart
```

### 2.4 Schema 迁移

- drift 原生支持版本化迁移
- 规则：只加不减字段，永远向后兼容（和 JS 版一致）
- v1→v2：添加 `paused_at`
- v2→v3：添加 `estimated_time`

### 2.5 错误处理

| 场景 | JS 做法 | Flutter 做法 |
|------|--------|-------------|
| 数据损坏 | try-catch JSON.parse, 提示用户 | catch `SqliteException`, 提示+重置 |
| 存储满 | catch QuotaExceededError | SQLite 文件满极少见, catch 通用异常 |
| 备份 | `progressive_backup` JSON 键 | 周期性复制 db 文件或 JSON 快照 |

---

## 三、Riverpod 状态层

### 3.1 Provider 体系

```
databaseProvider (单例)
     │
     ├─→ taskRepositoryProvider
     │        │
     │        └─→ allTasksProvider (Stream, drift watch 自动更新)
     │                │
     │       ┌────────┼─────────┐
     │       ▼        ▼         ▼
     │   currentTask  dueCount  nextUpcoming
     │   Provider      Provider   Provider
     │
     ├─→ logRepositoryProvider
     │
     ├─→ workModeProvider (StateNotifier)
     │      working, uiState, editingTaskId, customTime
     │
     ├─→ undoProvider (StateNotifier, max 50)
     │
     ├─→ sidebarProvider (StateNotifier)
     │      open, tab, width
     │
     └─→ timerProvider (Stream, 每秒 emit)
```

### 3.2 与现有 JS store 对照

| 现有 `store.js` | Flutter |
|----------------|---------|
| `store.tasks` | `ref.watch(allTasksProvider)` |
| `store.currentTask` | `ref.watch(currentTaskProvider)` |
| `store.working` | `ref.watch(workModeProvider).working` |
| `store.doSchedule(date)` | `ref.read(workModeProvider.notifier).schedule(date)` |
| `store.doComplete()` | `ref.read(workModeProvider.notifier).complete()` |
| `store.doUndo()` | `ref.read(undoProvider.notifier).pop()` |
| `setInterval(1000)` 计时器 | `timerProvider` (Stream.periodic) |
| `_persist()` 手动写盘 | drift `watch()` 自动传播，无需手动 |

### 3.3 Undo 系统

```dart
class UndoNotifier extends StateNotifier<List<UndoEntry>> {
  static const maxStack = 50;  // 和 JS 一致

  void push(UndoEntry entry) {
    state = [...state, entry];
    if (state.length > maxStack) state = state.sublist(1); // 丢弃最旧
  }

  UndoEntry pop() {
    final entry = state.last;
    state = state.sublist(0, state.length - 1);
    return entry;
  }
}
```

### 3.4 计时器

```dart
final timerProvider = StreamProvider<int>((ref) {
  return Stream.periodic(
    const Duration(seconds: 1),
    (_) => DateTime.now().millisecondsSinceEpoch,
  );
});
// UI 层: ref.watch(timerProvider).value - task.lastPushedAt → 显示时间
```

---

## 四、Widget 树

单路由应用，和现有 SPA 一致：

```
MaterialApp(theme: progressiveTheme)
  └── HomePage
        ├── TopBar
        │     ├── ☰ 菜单按钮 → toggleSidebar()
        │     └── 标题 "渐进执行"
        │
        ├── MainView [sidebar.open == false]
        │     ├── HomeView [working == false]
        │     │     ├── HomeCard (任务数统计 + 开始工作按钮)
        │     │     └── CreateButton
        │     │
        │     ├── WorkView [working == true]
        │     │     ├── WorkStatusBar ("工作中" + 暂停)
        │     │     ├── TaskCard [currentTask != null]
        │     │     │     ├── 标题 (点击 → inline edit)
        │     │     │     ├── TimerDisplay (灰色, 实时)
        │     │     │     └── ⏸/▶ 暂停按钮
        │     │     ├── ActionBar
        │     │     │     └── [稍后] [明天] [1w+] [自定义] [✓ 完成]
        │     │     └── WorkComplete [currentTask == null]
        │     │
        │     └── UndoButton [undoStack.length > 0]
        │
        ├── Sidebar [sidebar.open == true, slide from left]
        │     ├── Header (标题 + ✕)
        │     ├── TabBar (活跃 | 全部 | 历史 | 搜索)
        │     └── content per tab
        │
        ├── EditFormOverlay [uiState == editing]
        └── CreateFormOverlay [uiState == creating]
```

### 侧边栏

- 左侧滑出, 默认宽度 420px, 可拖拽 280~700px
- 四个标签页: 活跃(active任务按next_review排序) / 全部(带搜索) / 历史(操作日志) / 搜索(全局标题搜索)
- 遮罩层, 点击或 Esc 关闭

### 快捷键

用 `CallbackShortcuts` 实现，和现有完全一致：

| 键 | 功能 | 条件 |
|---|------|------|
| `1` | 稍后 | 工作模式+有任务 |
| `2` | 明天 | 同上 |
| `3` | 1w+ | 同上 |
| `4` | 自定义时间 | 同上 |
| `Space` | 暂停/继续 | 同上 |
| `Enter` | 完成 | 同上 |
| `E` | 编辑 | 同上 |
| `Ctrl+Z` | 撤销 | 始终 |
| `N` | 新建 | 始终 |
| `Ctrl+K` | 打开搜索 | 始终 |
| `Esc` | 关闭浮层 | 浮层开启时 |

---

## 五、样式方案

- 色调：极简黑白灰，完成按钮淡绿色突出
- 暗色模式：`MediaQuery.platformBrightness` 自动跟随系统
- 字体：系统默认中文字体（不引入 Google Fonts）
- 计时器：正常字号，灰色，不制造焦虑。暂停时橙色斜体
- 平台适配：Web/Desktop 保持桌面布局，移动端后续 Phase 3 处理

---

## 六、测试策略

| 层级 | 框架 | 覆盖 |
|------|------|------|
| Use Cases | 纯 Dart `test` | 所有业务逻辑（和现有 actions.test.js 一致） |
| Repositories | drift mock | 读写、排序、过滤、迁移 |
| Providers | `riverpod_test` | 状态派生正确性、undo 栈上限 |
| Widgets | `flutter_test` | 关键交互流程 |

不做：E2E、动画测试、视觉回归

---

## 七、开发阶段

### Phase 1：核心骨架（首个里程碑）
- Flutter 脚手架 + drift + Riverpod
- 三个实体 + 数据库表 + Repository 实现
- `GetCurrentTask` + `ScheduleTask` + `CompleteTask` + `CreateTask` 四个 UseCase
- 最简 UI：首页 → 开始工作 → 任务卡片 → 推进/完成
- **目标**：跑通一个完整的工作循环

### Phase 2：功能对齐
- 撤销系统
- 侧边栏（活跃/全部/历史/搜索）
- 编辑/新建表单浮层
- 自定义时间输入
- 计时器实时刷新
- 全部快捷键
- **目标**：和现有 Web 版功能完全对齐

### Phase 3：平台打磨
- Web/Desktop 窗口适配
- 移动端响应式布局
- 无障碍（a11y）
- 飞书集成接口预留
- 数据导出/导入

---

## 八、现有项目保护

- Flutter 项目独立目录（如 `IncrementalLife2_flutter/`），和现有项目同级
- 两个项目互不引用，各自独立开发部署
- 现有 Web 版继续使用，不做任何修改
- 共享的只有：开发文档（数据模型、行为规格）、测试用例逻辑
