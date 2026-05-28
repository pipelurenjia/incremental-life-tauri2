# Graph Report - .  (2026-05-26)

## Corpus Check
- Corpus is ~5,564 words - fits in a single context window. You may not need a graph.

## Summary
- 122 nodes · 186 edges · 16 communities (9 shown, 7 thin omitted)
- Extraction: 94% EXTRACTED · 6% INFERRED · 0% AMBIGUOUS · INFERRED: 12 edges (avg confidence: 0.91)
- Token cost: 65,000 input · 9,297 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Core Task Logic & Actions|Core Task Logic & Actions]]
- [[_COMMUNITY_Main App & Form Handling|Main App & Form Handling]]
- [[_COMMUNITY_Task Rendering & Utilities|Task Rendering & Utilities]]
- [[_COMMUNITY_Package Configuration|Package Configuration]]
- [[_COMMUNITY_Data Persistence & Storage|Data Persistence & Storage]]
- [[_COMMUNITY_Task Schema & Undo|Task Schema & Undo]]
- [[_COMMUNITY_Claude Settings|Claude Settings]]
- [[_COMMUNITY_Local Permissions|Local Permissions]]
- [[_COMMUNITY_Startup Script|Startup Script]]
- [[_COMMUNITY_Action Bar Component|Action Bar Component]]
- [[_COMMUNITY_Sidebar Component|Sidebar Component]]
- [[_COMMUNITY_Quick Actions|Quick Actions]]
- [[_COMMUNITY_Sidebar Tabs|Sidebar Tabs]]

## God Nodes (most connected - your core abstractions)
1. `createStore()` - 16 edges
2. `getCurrentTask()` - 8 edges
3. `createTaskData()` - 7 edges
4. `scheduleTask()` - 7 edges
5. `generateId()` - 7 edges
6. `escapeHtml()` - 7 edges
7. `scripts` - 6 edges
8. `loadTasks()` - 6 edges
9. `updateTaskFields()` - 6 edges
10. `migrateTasks()` - 5 edges

## Surprising Connections (you probably didn't know these)
- `Task Data Schema (7 fields)` --conceptually_related_to--> `createTaskData()`  [INFERRED]
  IncrementalLife开发文档.md → src/actions.js
- `One Task At A Time Philosophy` --rationale_for--> `createStore()`  [INFERRED]
  IncrementalLife开发文档.md → src/store.js
- `Silent Ops Principle (No Modal/Confirm)` --rationale_for--> `createStore()`  [INFERRED]
  IncrementalLife开发文档.md → src/store.js
- `localStorage Persistence Strategy` --rationale_for--> `loadTasks()`  [INFERRED]
  IncrementalLife开发文档.md → src/storage.js
- `Action Log Schema (7 fields)` --conceptually_related_to--> `generateLog()`  [INFERRED]
  IncrementalLife开发文档.md → src/storage.js

## Hyperedges (group relationships)
- **Core Data Flow Architecture** — src_main_entry, src_store_createstore, src_actions_getcurrenttask, src_actions_createtaskdata, src_actions_scheduletask, src_actions_completetask, src_storage_loadtasks, src_storage_savetasks, src_storage_generatelog [EXTRACTED 1.00]
- **Task Lifecycle Management** — src_actions_createtaskdata, src_actions_updatetaskfields, src_actions_scheduletask, src_actions_completetask, src_actions_pushtoendoftoday, src_actions_getcurrenttask, doc_incrementallife_task_schema, doc_incrementallife_scheduling_model [EXTRACTED 1.00]
- **Safety and Recovery Subsystem** — src_store_undostack, src_utils_escapehtml, src_components_edit_form_validatetaskform, src_storage_backup, src_storage_migratetasks, doc_incrementallife_undo_mechanism, doc_incrementallife_local_storage [INFERRED 0.85]

## Communities (16 total, 7 thin omitted)

### Community 0 - "Core Task Logic & Actions"
Cohesion: 0.14
Nodes (25): One Task At A Time Philosophy, next_review Scheduling (No Priority), Silent Ops Principle (No Modal/Confirm), completeTask(), createTaskData(), getActiveTasks(), getAllTasks(), getCurrentTask() (+17 more)

### Community 1 - "Main App & Form Handling"
Cohesion: 0.11
Nodes (17): validateTaskForm(), changes, d, diffDays, errors, newDate, newDesc, newTitle (+9 more)

### Community 2 - "Task Rendering & Utilities"
Cohesion: 0.18
Nodes (13): taskCardHtml(), taskDescriptionHtml(), taskCardHtml, ESC_MAP, escapeHtml(), formatCountdown(), formatTime(), generateId() (+5 more)

### Community 3 - "Package Configuration"
Cohesion: 0.12
Nodes (15): dependencies, petite-vue, devDependencies, vite, vitest, name, private, scripts (+7 more)

### Community 4 - "Data Persistence & Storage"
Cohesion: 0.20
Nodes (14): localStorage Persistence Strategy, Action Log Schema (7 fields), backup(), generateLog(), getSchemaVersion(), KEYS, loadLogs(), loadTasks() (+6 more)

### Community 5 - "Task Schema & Undo"
Cohesion: 0.33
Nodes (4): Task Data Schema (7 fields), Undo Stack Mechanism (50-entry cap), TASK_DEFAULTS (Shared Schema), Undo Stack (MAX_UNDO=50)

## Knowledge Gaps
- **49 isolated node(s):** `start.sh script`, `name`, `private`, `version`, `type` (+44 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **7 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `createStore()` connect `Core Task Logic & Actions` to `Main App & Form Handling`, `Data Persistence & Storage`, `Task Schema & Undo`?**
  _High betweenness centrality (0.083) - this node is a cross-community bridge._
- **Why does `getCurrentTask()` connect `Core Task Logic & Actions` to `Main App & Form Handling`?**
  _High betweenness centrality (0.040) - this node is a cross-community bridge._
- **Why does `createTaskData()` connect `Core Task Logic & Actions` to `Task Rendering & Utilities`, `Task Schema & Undo`?**
  _High betweenness centrality (0.036) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `createStore()` (e.g. with `One Task At A Time Philosophy` and `Silent Ops Principle (No Modal/Confirm)`) actually correct?**
  _`createStore()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `start.sh script`, `name`, `private` to the rest of the system?**
  _52 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Core Task Logic & Actions` be split into smaller, more focused modules?**
  _Cohesion score 0.14022988505747128 - nodes in this community are weakly interconnected._
- **Should `Main App & Form Handling` be split into smaller, more focused modules?**
  _Cohesion score 0.11428571428571428 - nodes in this community are weakly interconnected._