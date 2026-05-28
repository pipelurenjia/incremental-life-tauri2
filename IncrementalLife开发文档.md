# 渐进执行工具 — 开发文档 V2.0

## 一、产品定义

**名称**：渐进执行（暂定名）
**核心理念**：一次只推送一个任务，持续微推进，信任用户决策，工具不替人做主。
**当前阶段**：纯本地 Web 端，数据存 localStorage。
**未来扩展**：接入飞书多维表格和机器人，实现多端同步。

------

## 二、功能规格

### 2.1 任务调度

- 调度以天为精度，`next_review` 按日期排序
- 进入页面后为**首页**，显示「开始工作」按钮和今日待推进任务数
- 点击「开始工作」进入工作模式，逐一推送到期任务（`status==='active'` 且 `next_review <= now`）
- 多个到期任务时，取 `next_review` 最早的一个
- 处理完一个任务后，下一个到期任务自动出现，循环推进
- 点击「暂停工作」退出工作模式，回到首页
- 今日任务全部处理完后显示「今日任务全部完成」
- 无到期任务时，「开始工作」按钮禁用

### 2.2 核心操作栏（平铺按钮，仅工作模式显示）

按钮顺序和样式：

text

```
[ 稍后 ]  [ 明天 ]  [ 1w+ ]  [ 自定义 ]    [ ✓ 完成 ]
```



- `稍后`：将任务排到今天任务队列的末尾（`next_review = 今天其余任务中最晚的时间 + 1s`）
- `明天`：`next_review = 今天结束 + 1s`（即明天 00:00）
- `1w+`：`next_review = now + 7天`
- `自定义`：点击后按钮位置变为输入框（数字 + 单位下拉：天/小时/分钟），回车或点击外部确认，恢复为按钮，时间按输入更新
- `✓ 完成`：`status` 变更为 `completed`，任务从活跃队列消失

**行为**：

- 仅在工作模式下显示操作栏
- 点击任意按钮后，当前任务立即离开，下一个到期任务（若有）无缝出现
- 不弹窗，不要求备注，不二次确认
- 操作完全静默，仅后台生成日志

### 2.3 撤销机制

- 每次操作自动保存快照（逆操作信息），压入撤销栈（最多50条）
- 可撤销的操作：推进、完成、创建、更新、归档、暂停、继续
- 界面右下角浮现 `↩ 撤销` 按钮（仅当有可撤销操作时显示），点击或按 `Ctrl+Z` 执行撤销
- 撤销后，之前的任务卡片重新出现，字段和日志恢复到操作前状态
- 支持连续撤销

### 2.4 任务编辑与新建

**编辑**：

- 点击任务卡片上的 `✎ 编辑` 或快捷键 `E`
- 弹出编辑表单浮层，可修改：标题、备注、**到期日期**（date 输入框，精确到天）
- 修改到期日期可把未来任务提前到今天，或把今天任务推迟
- 底部有「归档」按钮（需确认）
- 保存后恢复卡片显示，若无此任务则刷新为下一任务

**新建**：

- 点击右下角悬浮 `+` 按钮或按 `N`
- 弹出编辑表单（浮层），仅标题必填，其他选填
- 创建后，新任务若到期则立刻出现在卡片区，否则存入任务池

### 2.5 侧边栏

- 从**左侧**滑出，默认宽度 420px，可拖拽右侧边缘调整（280px~700px）
- 有遮罩，点击遮罩或按 Esc 关闭
- 侧边栏头部有标题和关闭按钮（✕）
- 四个标签页，图标+文字：
  - **活跃**：所有 `active` 状态任务列表，按 `next_review` 排序
  - **全部**：所有状态任务，带搜索框筛选
  - **历史**：操作日志，按时间倒序，可按任务过滤
  - **搜索**：全局搜索任务标题
- 点击活跃列表中的任务 → 弹出编辑表单浮层，可手动调整
- 点击非活跃任务 → 同样弹出编辑表单
- 按 `Esc` 或点击遮罩关闭侧边栏

### 2.6 计时器

- 任务卡片显示实时计时 `00:04:23`，从 `last_pushed_at` 开始累加
- 计时器旁边有**暂停/继续**按钮（⏸/▶），或按空格键切换
- 暂停时计时器变为橙色斜体，停止累加
- 继续时从暂停时刻恢复累加（暂停期间不计入耗时）
- `paused_at` 字段记录暂停时刻，`null` 表示未暂停
- 刷新页面根据 `last_pushed_at` 恢复，计时不中断
- 视觉风格：正常字号，灰色，不显眼，不制造焦虑
- 操作后不显示本次耗时，仅在日志中存储

### 2.7 空状态

- 显示：暂无待推进任务
- 下方显示下一个即将出现的任务标题及倒计时（如：“「写周报」将在 2 小时 15 分钟后出现”）
- 倒计时实时更新

### 2.8 快捷键

| 快捷键            | 功能                         | 条件                       |
| :---------------- | :--------------------------- | :------------------------- |
| `1`               | 稍后（排到今天队尾）         | 工作模式 + 任务卡片可见    |
| `2`               | 推到明天                     | 同上                       |
| `3`               | 推迟1周                      | 同上                       |
| `4`               | 聚焦自定义时间输入           | 同上                       |
| `Space`           | 暂停/继续计时                | 工作模式 + 任务卡片可见    |
| `Enter`           | 完成任务                     | 工作模式 + 任务卡片可见    |
| `Ctrl+Z`          | 撤销                         | 始终可用                   |
| `N`               | 新建任务                     | 始终可用                   |
| `E`               | 编辑当前任务                 | 工作模式 + 任务卡片可见    |
| `Ctrl+K`          | 打开搜索（侧边栏搜索标签）   | 始终可用                   |
| `Esc`             | 关闭侧边栏/编辑表单/新建表单 | 浮层或侧边栏打开时         |



------

## 三、数据结构

### 3.1 任务表 `tasks`（localStorage key: `progressive_tasks`）

```ts
{
  id: string,            // 唯一ID，Date.now().toString(36) + Math.random().toString(36)
  title: string,         // 必填，任务标题
  description: string,   // 选填，备注，默认为空字符串
  status: 'active' | 'completed' | 'archived',
                         // active: 活跃任务池
                         // completed: 用户点击"完成"
                         // archived: 用户手动归档（软删除，不真删）
  next_review: number,   // Unix 时间戳(ms)，下次出现时间，调度时按此字段升序取最早，精确到天
  last_pushed_at: number,// Unix 时间戳(ms)，上次被推进/完成/继续操作的时间
  paused_at: number|null,// 暂停时刻的时间戳，null 表示未暂停。暂停期间计时不累加
  created_at: number,    // Unix 时间戳(ms)，创建时间
}
```

**设计决策**：
- 不设 `priority` 字段，调度仅按 `next_review` 升序，保持极简
- 无真删除，删除操作走 `archived` 状态，数据可追溯

### 3.2 操作日志表 `action_logs`（localStorage key: `progressive_action_logs`）

```ts
{
  id: string,
  task_id: string,       // 关联任务
  task_title: string,    // 冗余存标题，任务删除后日志仍可读
  action: 'advance' | 'complete' | 'create' | 'update' | 'archive',
  changes: Record<string, [any, any]>, // { field: [oldValue, newValue] }
  time_spent: number,    // 本次耗时(ms)，now - task.last_pushed_at
  timestamp: number,     // 操作时间戳(ms)
}
```

**设计决策**：
- `task_title` 冗余存储，防止任务归档/删除后日志无法辨认
- `changes` 格式为 `{ field: [oldValue, newValue] }`，同时服务撤销和日志展示
- 日志永久保留，不自动清理

------

## 四、状态管理与数据流

### 4.1 状态定义（Store）

使用 Petite-Vue 响应式对象：

javascript

```
const store = reactive({
  tasks: [],
  actionLogs: [],
  currentTask: null,
  working: false,      // 是否处于工作模式
  uiState: 'idle',     // 'idle' | 'editing' | 'creating' | 'custom-time'
  undoStack: [],
  sidebar: {
    open: false,
    tab: 'active',     // 'active' | 'all' | 'history' | 'search'
    width: 420,         // 侧边栏宽度(px)，可拖拽调整 280~700
  },
  searchQuery: '',
  customTime: { value: 1, unit: 'days' },
  validationErrors: {},
});
```



### 4.2 Store 方法（纯函数，操作 localStorage）

javascript

```
// 初始化
init()

// 工作模式
startWork()          // 进入工作模式，刷新 currentTask
stopWork()           // 退出工作模式
countDueToday()      // 统计今日到期任务数

// 任务查询
getCurrentTask()
getNextUpcomingTask()

// 任务操作
scheduleTask(taskId, nextReviewDate) // 统一推进/推迟（自动解除暂停）
completeTask(taskId)                 // 完成任务（自动解除暂停）
doPushLater()                        // 稍后：排到今天任务队尾
createTask(data)
updateTask(taskId, changes)
archiveTask(taskId)

// 暂停/继续
doPause()            // 暂停计时，记录 paused_at
doUnpause()          // 继续计时，调整 last_pushed_at
togglePause()        // 切换暂停状态

// 撤销
pushUndo(snapshot)
undo()

// 侧边栏数据
getActiveTasks()
getAllTasks(filter)
getLogs(taskId?)
searchTasks(query)
startResize(e)       // 侧边栏拖拽调整宽度

// 持久化
saveToStorage()
```



### 4.3 核心操作流程

**工作模式流程**：

text

```
首页 → 用户点击 [开始工作]
  → store.startWork()
  → working = true，刷新 currentTask
  → UI 显示第一个到期任务卡片 + 操作栏

用户点击 [稍后] 或按 1
  → store.doPushLater()
  → 内部：
    1. 计算今日所有到期任务中最晚的 next_review
    2. 将当前任务 next_review 设为该值 + 1s
    3. 若暂停中则自动解除暂停
    4. 记录快照（用于撤销）
    5. 生成日志 action:'advance'
    6. 写入 localStorage
    7. 重新计算 currentTask = getCurrentTask()
  → UI 自动响应，下一个任务卡片出现

用户点击 [✓ 完成] 或按 Enter
  → store.doComplete()
  → 内部：
    1. 若暂停中则自动解除暂停
    2. 计算 time_spent = now - task.last_pushed_at
    3. 生成日志 action:'complete'
    4. 更新 task: status = 'completed'
    5. 压入撤销栈，写入 localStorage
    6. 重新计算 currentTask
  → UI 显示下一个到期任务或「今日任务全部完成」

用户点击 [暂停工作]
  → store.stopWork()
  → working = false
  → UI 回到首页，显示「开始工作」按钮
```

**暂停计时流程**：

```
用户点击 ⏸ 或按 Space（工作中 + 有任务）
  → store.doPause()
  → 记录快照
  → task.paused_at = Date.now()
  → 计时器停止累加，变为橙色斜体，显示暂停时刻的已用时间

用户点击 ▶ 或按 Space（暂停中）
  → store.doUnpause()
  → 记录快照
  → task.last_pushed_at += Date.now() - task.paused_at
  → task.paused_at = null
  → 计时器恢复累加
```



### 4.4 撤销流程

text

```
用户点击撤销或 Ctrl+Z
  → store.undo()
  → 从 undoStack 弹出最后一条快照
  → 恢复对应任务至快照状态
  → 移除对应的日志（或标记为已撤销）
  → 重新计算 currentTask
  → 写入 localStorage
```



------

## 五、组件结构（Petite-Vue 作用域）

text

```
<div id="app">
  <!-- 顶部导航栏（始终可见） -->
  <TopBar />

  <!-- 主视图 -->
  <main v-if="!sidebar.open">
    <!-- 首页（未工作） -->
    <HomeView v-if="!working">
      <StartWorkButton />
      <TaskSummary />
      <CreateButton />
    </HomeView>

    <!-- 工作模式 -->
    <template v-if="working">
      <WorkStatusBar />
      <div v-if="currentTask">
        <TaskCard :task="currentTask" />
        <ActionBar />
      </div>
      <WorkComplete v-else />
    </template>

    <UndoButton v-if="undoStack.length" />
    <FAB @click="openCreateForm" />
  </main>

  <!-- 左侧侧边栏（可拖拽调整宽度） -->
  <Sidebar v-if="sidebar.open" />
  
  <!-- 编辑/新建表单（浮层，编辑表单含到期日期字段） -->
  <EditForm v-if="uiState === 'editing'" />
  <CreateForm v-if="uiState === 'creating'" />
</div>
```



由于 Petite-Vue 无正式组件系统，使用函数返回 HTML 字符串或内联模板，通过 `v-if` 和 `v-scope` 嵌套控制。

------

## 六、样式方案

- 基础样式：Pico.css (classless, 使用 CDN)
- 自定义：少量 CSS 用于布局、侧边栏动画、任务卡片特殊样式
- 色调：极简黑白灰，完成按钮可用淡绿色突出
- 暗色模式：通过 `prefers-color-scheme` 媒体查询自动跟随系统，不设手动切换
- 浏览器兼容：支持 Chrome/Firefox/Safari/Edge 近两个大版本（需 `Proxy` 支持）

------

## 七、本地存储与数据持久化

- 两个 localStorage 键：`progressive_tasks`, `progressive_action_logs`
- 额外一个备份键：`progressive_backup`（每次初始化成功后自动备份 JSON）
- 维护 `progressive_schema_version` 键，用于数据格式升级
- 每次操作后立即同步写入
- 页面初始化时从 localStorage 读取

### 7.1 错误处理

**存储写入失败**：
- `try-catch` 包裹 `localStorage.setItem`
- 捕获 `QuotaExceededError` 时，提示用户「存储空间不足，请导出数据后清理旧日志」
- 不做静默失败

**数据损坏恢复**：
- `JSON.parse` 包裹在 `try-catch` 中
- 解析失败时，提示用户「数据已损坏」，提供「重置数据」按钮
- 不自动清空数据

**Schema 迁移**：
- `storage.js` 维护 `SCHEMA_VERSION` 常量（当前版本：2）
- v1→v2 迁移：为旧任务补充 `paused_at: null` 字段
- 初始化时比对版本，旧数据缺少新字段时自动补充默认值
- 规则：只加不减字段，永远向后兼容

**撤销栈溢出**：
- 栈上限 50 条，溢出时从栈底（最旧快照）丢弃，静默处理

**输入校验**：
- 任务标题：非空，最大 200 字符
- 自定义时间：正整数，最小值 1 分钟，最大值 365 天
- 校验失败时在对应输入框下方显示红色提示，不弹窗

------

### 7.2 安全

- 所有用户输入（标题、备注）渲染到 DOM 前，统一经 `utils.js` 的 `escapeHtml()` 转义
- 原则：视图函数中插入的字符串默认不信任，除非来自程序内部

---

### 7.3 性能

- localStorage 同步 IO 在百级数据量下无感知，不做节流/防抖
- 日志列表不做分页和虚拟滚动，Phase 1-2 直接全量渲染
- 原则：先保持简单，实际遇到瓶颈再优化

---

### 7.4 无障碍（a11y）

- 侧边栏打开时焦点移入第一个可聚焦元素，关闭时焦点回到触发元素
- 撤销按钮添加 `aria-label="撤销"`
- 计时器等灰色文字确保对比度 >= 4.5:1
- `<main>` 区域添加 `role="main"` 和 `aria-live="polite"`，任务切换时屏幕阅读器可感知

---

## 八、项目目录结构

```
progressive/
├── index.html              # 入口 HTML，<link> 引入 Pico.css CDN
├── package.json
├── vite.config.js
└── src/
    ├── main.js             # 入口：createApp + mount，挂载全局 store
    ├── store.js            # Petite-Vue reactive Store，状态与方法声明
    ├── storage.js          # localStorage 读写封装，序列化/反序列化
    ├── actions.js          # 核心逻辑：推进/完成/创建/编辑/归档/撤销
    ├── utils.js            # 工具函数：ID生成、时间格式化、倒计时计算
    ├── components/         # 视图函数，每个返回 HTML 字符串
    │   ├── task-card.js    # 任务卡片（标题、计时器、编辑入口）
    │   ├── action-bar.js   # 操作按钮栏（1h/1d/1w+/自定义/完成）
    │   ├── empty-state.js  # 空状态 + 下一任务倒计时
    │   ├── undo-button.js  # 撤销浮动按钮
    │   ├── sidebar.js      # 侧边栏容器（标签切换 + 列表渲染）
    │   ├── edit-form.js    # 编辑表单浮层
    │   └── create-form.js  # 新建表单浮层
    └── styles/
        └── custom.css      # 自定义样式（布局、侧边栏动画、卡片）
```

## 九、开发环境与启动

- Node.js >= 18
- 使用 Vite 创建 Vanilla 项目：`npm create vite@latest progressive -- --template vanilla`
- 安装 Petite-Vue：`npm install petite-vue`
- Pico.css 通过 CDN 在 `index.html` 中引入
- `npm run dev` 启动开发服务器
- `npm run build` 产出 `dist/` 静态文件，部署到任意静态托管服务

------

## 十、待确认与未来扩展

- **数据导出/导入**：计划在 Phase 3 添加，格式为 JSON（含 tasks 和 logs）
- **移动端适配**：暂不处理，界面针对桌面设计
- **快捷键自定义**：第一版硬编码，后续可在设置中修改
- **任务分类/标签**：当前不加，保持极简，未来可在任务字段中增加 `tag` 字段
- **飞书集成**：数据层替换为飞书 API，侧边栏部分功能可直接用飞书表格替代

------

## 十二、测试策略

- **框架**：Vitest（与 Vite 同生态，零配置）
- **范围**：仅单元测试，不覆盖 DOM 渲染、动画、样式
- **测试对象**：
  - `actions.js`：scheduleTask / completeTask / undo / createTask / updateTask
  - `utils.js`：ID 生成、时间格式化、倒计时计算
  - `store.js`：getCurrentTask（到期筛选+排序）、getNextUpcomingTask
- **不做**：组件/E2E 测试

---

## 十三、开发计划（Phase 概览）

### Phase 1：骨架与核心循环（1-2天）

- Vite + Petite-Vue + Pico.css 环境搭建
- Store 基础实现（读/写 localStorage，任务 CRUD，到期筛选）
- 任务卡片 + 操作按钮（推进/推迟/完成）
- 空状态显示
- 基本快捷键

### Phase 2：交互完善（2-3天）

- 撤销系统
- 编辑/新建表单
- 侧边栏（活跃/全部/历史/搜索）
- 自定义时间输入
- 计时器实时更新

### Phase 3：打磨与扩展（未来）

- 数据导出/导入
- 飞书多维表格集成
- 飞书机器人推送
- 移动端响应式