# ScriptsManager 修改记录

## 2026-01-14 BUG 修复和 UI 优化

### 批量删除 BUG 修复

#### 问题 1: 批量删除没有确认
**状态**: ✅ 已修复

**原因**: 批量删除直接调用 API，没有确认对话框

**修改**:
- 前端添加 `batchDeleteConfirmOpen` 状态变量
- `handleBatchDelete()` 改为打开确认对话框
- 添加 `confirmBatchDelete()` 处理确认删除
- 添加 `cancelBatchDelete()` 处理取消操作
- 确认对话框显示待删除的脚本列表

**文件**: `frontend/src/App.tsx:84, 409-428, 849-890`

---

#### 问题 2: 删除只清除数据库，文件还在
**状态**: ✅ 已修复

**原因**: 后端只删除了数据库记录，没有删除 `/scripts` 中的脚本文件和日志文件

**修改**:
- 后端 `delete_script()` API 添加文件删除逻辑
- 删除脚本文件: `os.remove(db_script.path)`
- 删除日志文件: `os.remove(f"/app/data/logs/{script_id}.log")`
- 如果删除失败则抛出 500 异常，防止数据库记录被删除

**文件**: `backend/app/api.py:71-99`

---

#### 问题 3: 扫描后文件又回来
**状态**: ✅ 已修复

**原因**: 因为文件没有被真正删除（问题2），扫描时会重新发现这些文件并添加到数据库

**解决**: 修复问题2后自动解决

---

#### 问题 4: 运行脚本没反应但其实在运行
**状态**: ✅ 已修复

**原因**:
- 运行 API 返回的是 `{"message": "Script started"}` 而不是脚本对象
- 前端无法立即更新脚本状态，需要等待下一次 fetchScripts()
- 用户看不到脚本进入 'running' 状态

**修改**:
- 后端 `run_script_manually()` API:
  - 添加 `response_model=ScriptResponse`
  - 立即设置 `script.last_status = 'running'`
  - 返回完整的 `ScriptResponse` 对象而不是消息

- 后端 `stop_script_manually()` API:
  - 改为返回 `ScriptResponse` 对象
  - 立即设置 `script.last_status = 'stopped'`

- 前端 `handleRunToggle()`:
  - 处理返回的脚本对象
  - 立即更新本地脚本列表
  - 避免调用 `fetchScripts()` 减少延迟

- 前端 `handleBatchRun()` 和 `handleBatchStop()`:
  - 收集返回的脚本对象
  - 立即更新所有受影响的脚本

**文件**:
- `backend/app/api.py:148-177, 184-201`
- `frontend/src/App.tsx:334-354, 374-391, 398-416`

**效果**: 用户现在能看到脚本状态立即变为 "运行中" / "已停止"，不需要等待

---

### UI 对齐修复

#### 问题: 运行中的脚本卡片和未运行的脚本卡片下方按钮没对齐
**状态**: ✅ 已修复

**原因**:
- 网格视图中的脚本卡片高度不一致
- 有运行时长显示的卡片和没有显示的卡片高度不同
- 导致下方的 RUN/STOP 按钮位置不对齐

**修改**:
- 脚本卡片容器添加 `flex flex-col h-full` - 全高度的弹性容器
- 内容区域 (`space-y-3`) 添加 `flex-1` - 占据所有可用空间
- 按钮容器 (`.flex.items-center.gap-3`) 添加 `mt-auto` - 强制推到底部

**文件**: `frontend/src/App.tsx:973, 998, 1015`

**效果**: 所有卡片高度相同，按钮完全对齐

---

### 容器重启状态修复

#### 问题: Docker restart 后脚本显示仍在运行
**状态**: ✅ 已修复

**原因**:
- 容器重启后，进程都被杀死了
- 但数据库中的脚本仍显示 `last_status = 'running'`
- 前端显示脚本仍在运行，但实际进程已不存在

**修改**:
- 后端启动事件中添加状态重置逻辑
- 查询所有 `last_status == 'running'` 的脚本
- 重置为 'idle' 状态

**文件**: `backend/app/main.py:42-50`

**日志输出示例**:
```
Reset script 'monitor_port.sh' status from 'running' to 'idle' (container restart)
```

**效果**: 重启容器后，所有之前运行的脚本状态会被清理，不会出现幽灵进程状态

---

## 2026-01-14 快速批量删除功能

### 11. 批量删除功能
**文件**: `frontend/src/App.tsx`

**修改**:
- 在多选模式中添加 **🗑️ 删除** 按钮
- 按钮位置：启动按钮 → 停止按钮 → **删除按钮**
- 按钮颜色：玫红色 (rose-500/rose-600)，与启动(绿)、停止(红)区分
- 功能：一键删除所有已选脚本

**实现**:
- 新增函数 `handleBatchDelete()`:
  - 遍历所有已选脚本ID
  - 调用 `api.deleteScript()` 删除每个脚本
  - 删除完成后显示成功提示，清空选择并退出多选模式
  - 自动刷新脚本列表

**按钮状态**:
- 平时不显示（与启动/停止按钮一致）
- 仅在多选模式激活且有脚本被选中时显示
- 支持浅色/深色主题

---

## 2026-01-14 UI优化和UX改进

### 9. 脚本类型识别、删除确认和复选框位置优化
**文件**: `frontend/src/App.tsx`

#### 9.1 脚本类型识别修复
**问题**:
- 之前按脚本 `name` 字段识别图标（Python/Shell）
- 用户修改脚本名字后，图标显示就错了

**修改**:
- `getScriptIcon()` 函数改为接收 `path` 参数而非 `name`
- 所有调用 `getScriptIcon()` 的地方改为传递 `script.path`
- 现在图标识别完全基于文件后缀（.py / .sh），与脚本名称无关

#### 9.2 删除确认从弹窗改为卡片对话框
**问题**:
- 删除脚本时使用系统 `confirm()` 弹窗，不美观

**修改** - 新增删除确认Modal：
- 添加状态变量: `deleteConfirmId`, `deletingScriptName`
- 修改 `handleDelete()`: 打开确认对话框而不是调用 `confirm()`
- 新增 `confirmDelete()`: 确认删除操作
- 新增 `cancelDelete()`: 取消删除
- 删除确认Modal显示内容:
  - 红色圆形图标 + "确定要删除？" 标题
  - 脚本名称显示（让用户确认要删除哪个脚本）
  - "取消" 和 "确认删除" 两个按钮

**特点**:
- 支持浅色/深色主题
- 圆形图标和卡片设计保持视觉一致性

#### 9.3 复选框位置优化（解决重叠问题）
**问题**:
- 网格视图中，复选框在右上角与悬停时显示的删除按钮重叠

**修改** - 复选框位置调整：
- 网格视图: 复选框位于 **左上角** (从右上角改为左上角)
- 表格视图: 复选框位于 **左侧** (保持不变)
- 现在完全分离，不会有重叠问题

**ScriptCard 组件更新**:
```typescript
{/* 多选复选框 - 左上角 */}
{isMultiSelectMode && (
  <input
    type="checkbox"
    checked={isSelected}
    onChange={() => onSelect?.()}
    className="absolute top-4 left-4 w-5 h-5 z-10 cursor-pointer"
  />
)}
```

#### 9.4 删除确认Modal样式
- 背景：半透明黑色 + 模糊效果
- 圆形图标：红色背景，居中显示Trash图标
- 脚本名称显示框：与背景对比的浅色/深色卡片
- 按钮：
  - 取消按钮：灰色 (与背景主题适配)
  - 确认删除按钮：红色 (警告色，表示危险操作)

---

### 10. 多选模式优化和深色主题修复
**文件**: `frontend/src/App.tsx`

#### 9.1 多选按钮和模式切换
**修改**:
- 在视图切换按钮旁添加 **✓ 多选** 按钮
- 多选按钮状态: 平时为灰色，激活时为橙色
- 按钮文本清晰指示当前模式
- 仅在多选模式激活时显示复选框

#### 9.2 复选框位置优化
**修改** - 根据视图模式调整复选框位置：

**网格视图**:
- 复选框位于卡片 **右上角**（`absolute top-4 right-4`）
- 不再挡住左侧的脚本图标
- 点击脚本卡片即可选中（原有功能保留）

**表格视图**:
- 复选框位于行的 **左侧**（`flex-shrink-0`）
- 与其他信息保持对齐
- 保持紧凑的布局

#### 9.3 深色主题下拉菜单修复
**修改** - 修复Night模式下的option文字可见性：

**问题**:
- Night模式下，所有select元素的option文字为白色，与背景混淆

**解决**:
- 所有select元素添加 `[&>option]:bg-gray-900 [&>option]:text-white`
- 影响的下拉菜单:
  - 📁 全部类型
  - 🔄 全部状态
  - 📌 启用状态
  - 🔤 排序方式
- 现在Night模式下的option清晰可见，背景为深灰色(`bg-gray-900`)，文字为白色

#### 9.4 多选模式下的批量操作
**修改**:
- 批量操作按钮 (全选/启动/停止) 仅在 `isMultiSelectMode === true` 时显示
- 非多选模式下，界面保持整洁
- 退出多选模式时自动清空已选脚本

**状态变量新增**:
- `isMultiSelectMode`: 多选模式开关状态 (boolean)

**函数改进**:
- `handleBatchRun()`: 完成后自动关闭多选模式
- `handleBatchStop()`: 完成后自动关闭多选模式

**ScriptCard 组件参数更新**:
```typescript
const ScriptCard = ({
  script, onRunToggle, onEdit, onDelete, onLog, onOpenEditor,
  panelClass, theme,
  viewMode = 'grid',        // 视图模式
  isMultiSelectMode = false, // 是否在多选模式
  isSelected = false,        // 是否选中
  onSelect                   // 选中回调
}) => {...}
```

---

## 2026-01-14 脚本管理页面大幅增强

### 所有脚本管理页面功能完整改革
**文件**: `frontend/src/App.tsx`

#### 8.1 实时搜索功能
**修改**:
- 添加搜索框用于按脚本名称进行实时搜索（不区分大小写）
- 搜索结果即时反映在脚本列表中
- 搜索与其他过滤条件配合工作

#### 8.2 多条件过滤系统
**修改** - 实现5个独立的过滤维度：

**1. 脚本类型过滤**:
- 选项: 全部类型 / 🐍 Python / 🔧 Shell
- 根据文件扩展名自动识别 (.py / .sh)

**2. 执行状态过滤**:
- 选项: 全部状态 / 🟢 运行中 / ✅ 成功 / ❌ 失败 / ⏸️ 已停止 / ⭕ 未运行
- `未运行` 对应 `last_status === null`

**3. 启用状态过滤**:
- 选项: 全部 / ✔️ 已启用 / ✖️ 已禁用
- 根据脚本 `enabled` 字段过滤

**4. 排序方式**:
- 选项: 🔤 按名称 / 📅 按运行时间 / ⚡ 按状态
- 名称: 按字母顺序排序
- 运行时间: 按 `last_run` 时间戳排序
- 状态: 运行中 → 成功 → 失败 → 已停止 → 未运行

**5. 排序顺序**:
- 切换按钮: ⬆️ 升序 / ⬇️ 降序

#### 8.3 视图模式切换
**修改** - 支持两种不同的布局模式：

**网格视图 (📊 网格)**:
- 3列网格布局（桌面端）
- 卡片式设计，展示完整的脚本信息
- 包含运行时长、Cron表达式、自启标记等详细信息

**表格视图 (📋 列表)**:
- 紧凑的行式布局
- 包含: 脚本名称/类型 | 执行状态 | 运行时长 | 最后运行时间 | 操作按钮
- 适合快速浏览和批量操作

#### 8.4 脚本选择与批量操作
**修改** - 完整的多选和批量操作系统：

**复选框选择**:
- 每个脚本卡片/行都有复选框
- 支持单个选择或多个选择
- 显示已选择的脚本数量

**全选功能**:
- 按钮自动在"全选"和"取消全选"之间切换
- 只对当前过滤结果进行全选/取消全选

**批量启动** (▶️ 启动):
- 同时启动所有已选脚本
- 完成后显示成功通知并清空选择

**批量停止** (⏹️ 停止):
- 同时停止所有已选脚本
- 完成后显示成功通知并清空选择

#### 8.5 选中状态视觉反馈
**修改** - ScriptCard 组件改进：

**选中样式**:
- 浅色主题: 蓝色 (ring-2 ring-blue-500)
- 深色主题: 浅蓝色 (ring-2 ring-blue-400) + 发光效果
- 提供明确的视觉反馈

#### 8.6 布局改进
**修改** - 完整的 ScriptCard 组件重构：

**网格视图**:
- 将复选框集成到卡片内部（左上角）
- 添加点击卡片即选中的快捷方式
- 保持原有的卡片信息展示和操作按钮

**表格视图**:
- 新增表格行式布局选项
- 左侧复选框用于选择
- 中间显示脚本名称、类型、状态、运行时长
- 右侧显示最后运行时间
- 操作按钮悬停时显示

#### 8.7 结果统计显示
**修改**:
- 实时显示"共 X / Y 个脚本"
- X = 过滤后的脚本数
- Y = 总脚本数
- 用户即时了解过滤效果

#### 8.8 空状态处理
**修改**:
- 当没有脚本匹配过滤条件时显示 "🔍 没有找到匹配的脚本"
- 提示用户调整过滤条件

**状态变量新增** (共8个):
- `searchTerm`: 当前搜索词
- `filterType`: 脚本类型过滤 ('all' | 'py' | 'sh')
- `filterStatus`: 执行状态过滤 ('all' | 'running' | 'success' | 'failed' | 'stopped' | 'idle')
- `filterEnabled`: 启用状态过滤 ('all' | 'enabled' | 'disabled')
- `sortBy`: 排序方式 ('name' | 'lastRun' | 'status')
- `sortOrder`: 排序顺序 ('asc' | 'desc')
- `viewMode`: 视图模式 ('grid' | 'table')
- `selectedScripts`: 已选脚本集合 (Set<number>)

**函数新增**:
- `filteredAndSortedScripts`: 计算过滤和排序后的脚本列表
- `toggleScriptSelection(id)`: 切换单个脚本选中状态
- `selectAllFiltered()`: 全选/取消全选当前过滤结果
- `handleBatchRun()`: 批量启动已选脚本
- `handleBatchStop()`: 批量停止已选脚本

**ScriptCard 组件签名更新**:
```typescript
const ScriptCard = ({
  script, onRunToggle, onEdit, onDelete, onLog, onOpenEditor,
  panelClass, theme,
  // 新增参数
  viewMode = 'grid',      // 视图模式
  isSelected = false,      // 是否选中
  onSelect                 // 选中回调
}) => {...}
```

---

## 2026-01-13 修复和改进

### 1. 修复前端脚本运行卡 (ReferenceError: handleScan is not defined)
**文件**: `frontend/src/App.tsx`
**修改**:
- 添加缺失的 `handleScan()` 函数，调用 `api.scanScripts()` 扫描脚本目录
- 添加缺失的 `fetchScripts()` 函数，用于刷新脚本列表

### 2. 修复后端STOP按钮返回500错误
**文件**: `backend/app/api.py`
**修改**:
- 添加缺失的 `import logging` 和 `logger = logging.getLogger(__name__)`
- 改进 `stop_script_manually()` API，确保无论成功与否都更新数据库状态为 'stopped'
- 添加详细日志输出便于调试

**文件**: `backend/app/scheduler.py`
**修改**:
- 完善 `stop_script()` 函数的异常处理
- 检查进程是否已完成 (`returncode is not None`)
- 改进 SIGTERM/SIGKILL 的处理流程
- 添加详细日志记录每一步操作

### 3. 移除网页ALERT提示，使用Toast通知
**文件**: `frontend/src/App.tsx`
**修改**:
- 将所有 `alert("消息")` 替换为 `setNotification({ type: 'success/error', message: '消息' })`
- 新增通知状态: `const [notification, setNotification] = useState(null)`
- 在UI中添加 `<Notification>` 组件（右上角，2秒后自动消失）
- 覆盖的操作: 保存、删除、运行/停止、上传、扫描、获取代码、测试连通性、保存设置

### 4. 添加脚本运行时长显示
**文件**: `frontend/src/App.tsx`
**修改**:
- 新增 `formatDuration()` 函数计算运行时长
  - 格式: "1天22小时24分钟" / "2小时30分钟45秒" / "15分钟30秒" / "30秒"
  - 只在脚本运行中时显示
- 改写 `ScriptCard` 为完整的React函数组件
- 每秒更新一次运行时长（使用setInterval）
- 时长显示位置: 脚本卡片中间行，右侧与"运行中/已停止"文字对齐
- 保持所有卡片UI高度一致，RUN/STOP按钮不会因缺少计时而移动

### 5. 优化Dockerfile构建速度
**文件**: `Dockerfile`
**修改**:
- 在Python阶段添加国内镜像源替换
- 使用 `sed` 将 `deb.debian.org` 替换为 `mirrors.aliyun.com`
- 解决Docker build网络超时问题

### 6. 加强 Telegram BOT 代码的严谨性和安全性

#### 6.1 统一 Chat ID 类型为整数比较 (修复类型不一致bug)
**文件**: `backend/app/telegram_bot.py`
**修改** - `handle_update()` 方法:
- 将 Telegram API 返回的 chat_id (整数) 统一转换为 int
- 添加 TypeError/ValueError 异常处理
- 配置的 chat_id 也转换为 int 再比较，避免字符串/整数混淆导致的权限验证失败
- 添加日志记录invalid chat_id

#### 6.2 修复数据库资源泄漏
**文件**: `backend/app/telegram_bot.py`
**修改** - 以下方法添加 try-finally 确保资源释放:
- `show_scripts_menu()`
- `show_script_actions()`
- `run_script_bg()`
- `start_bot()`

**为什么重要**:
- 防止数据库连接池耗尽
- 异常情况下也能正确关闭数据库连接

#### 6.3 完善 Callback 数据解析的错误处理
**文件**: `backend/app/telegram_bot.py`
**修改** - `handle_callback()` 方法:
- 为所有 script_id 解析添加 try-except
- 捕获 IndexError (分割错误) 和 ValueError (int转换失败)
- 向用户反馈错误信息
- 添加外层异常处理，覆盖未预期的错误
- 日志记录所有解析失败的数据便于调试

#### 6.4 添加网络请求超时设置
**文件**: `backend/app/telegram_bot.py`
**修改** 的方法:
- `send_message()`: timeout=10.0
- `set_my_commands()`: timeout=10.0
- 添加 asyncio.TimeoutError 的特殊日志处理

**为什么重要**:
- 防止网络卡顿时长时间挂起
- 避免资源耗尽

#### 6.5 完整的脚本存在性验证
**文件**: `backend/app/telegram_bot.py`
**修改**:
- `show_script_actions()`: 检查脚本是否存在，不存在时有日志和用户提示
- `run_script_bg()`:
  - 添加脚本存在性检查
  - 添加异常处理和错误信息反馈
  - 改进 try-finally 确保资源释放

#### 6.6 改进 Token 和 Chat_ID 格式验证
**文件**: `backend/app/telegram_bot.py`
**修改** - `start_bot()` 方法:
- 验证 chat_id 是否为有效的数字字符串
- 验证 token 格式是否为 `bot_id:token_string` (包含冒号)
- 发现无效配置时不启动Bot并详细日志记录

**为什么重要**:
- 启动时发现配置问题，而不是在运行时崩溃
- 提供清晰的错误诊断信息

#### 6.7 改进文件读取的错误处理和字符编码
**文件**: `backend/app/telegram_bot.py`
**修改** - `show_script_log()` 方法:
- 添加 encoding="utf-8", errors="replace" 处理乱码
- 分离 IOError 异常单独处理
- 处理空日志文件情况
- 改进截断逻辑：使用前3900字符 + 截断提示，而不是简单截取后4000字符
- 添加详细日志记录各个阶段

### 7. 前端UI和UX改进

#### 7.1 主题选择持久化到localStorage
**文件**: `frontend/src/App.tsx`
**修改**:
- 使用 `useState` 的初始化函数从 `localStorage` 读取主题
- 切换主题时保存到 `localStorage`
- 即使 Docker 重建或浏览器缓存清空，主题选择也会被记住

**为什么重要**:
- 改善用户体验，不需要每次都重新选择主题
- localStorage 是浏览器本地存储，不依赖后端

#### 7.2 集成 Monaco Editor 进行代码高亮
**文件**: `frontend/package.json`
**修改**:
- 添加依赖: `@monaco-editor/react: ^4.6.0`

**文件**: `frontend/src/App.tsx`
**修改**:
- 导入 `Editor` 组件
- 导入 `RotateCw` 图标用于"保存并重启"按钮
- 替换代码编辑器 Modal 中的 `<textarea>` 为 `<Editor>` 组件
- Editor 配置:
  - 支持 Python 语法高亮（自动检测 .py 和 .sh 文件）
  - 主题跟随应用主题（light/dark）
  - 禁用 minimap，启用行号、自动折行、粘贴格式化
  - 字体大小 14px，支持滚动超过文件末尾

#### 7.3 添加"保存并重启"功能
**文件**: `frontend/src/App.tsx`
**修改**:
- 新增状态: `isSavingAndRestarting`
- 新增方法: `handleSaveAndRestartScript()`
  - 先保存代码到文件
  - 检查脚本是否正在运行
  - 如果在运行则先停止，然后启动脚本
  - 刷新脚本列表
- 代码编辑器 Modal 中添加"保存并重启"按钮（橙色），与"保存"按钮并列

**为什么有两个按钮**:
- **保存**: 仅保存代码，脚本继续运行，适合只想修改不想立即运行的场景
- **保存并重启**: 保存代码后立即重启脚本，用于快速调试

---

## 部署步骤

```bash
cd /etc/docker/ScriptsManager

# 完整构建（包含前后端）
docker compose build --no-cache

# 启动容器
docker compose up -d

# 查看日志
docker compose logs -f
```

---

## 测试清单

- [ ] 前端能正常加载，无JavaScript错误
- [ ] 点击"扫描文件"按钮能正常扫描脚本
- [ ] 创建脚本后能保存，右上角显示"保存成功"通知
- [ ] 运行脚本后右上角显示"操作成功"通知
- [ ] 脚本卡片显示运行时长（每秒更新）
- [ ] 点击STOP按钮能停止运行的脚本，右上角显示"操作成功"通知
- [ ] 所有卡片高度对齐，RUN/STOP按钮位置一致
- [ ] Toast通知2秒后自动消失
- [ ] 切换日间/夜间主题，通知和时长显示样式正确
- [ ] **主题持久化测试**:
  - [ ] 选择 Night 主题，刷新页面，主题保持为 Night
  - [ ] 选择 Day 主题，关闭浏览器重新打开，主题保持为 Day
  - [ ] 清空 localStorage，刷新页面，主题恢复为默认 Day
- [ ] **Monaco Editor 测试**:
  - [ ] 打开代码编辑器，能看到代码高亮（函数、字符串、注释等）
  - [ ] 切换主题，编辑器主题也随之改变
  - [ ] 编辑代码，能看到实时语法检查（红色波浪线）
  - [ ] 按 Ctrl+Z 能撤销，Ctrl+Y 能重做
  - [ ] 按 Ctrl+/ 能快速注释
- [ ] **保存并重启测试**:
  - [ ] 修改正在运行的脚本代码，点"保存并重启"，脚本重启成功
  - [ ] 修改已停止的脚本代码，点"保存并重启"，脚本启动
  - [ ] 修改脚本代码，只点"保存"，脚本继续原状态不变
- [ ] **Telegram BOT测试**:
  - [ ] 配置错误的 token 时，Bot 不启动，日志显示"Invalid token format"
  - [ ] 配置错误的 chat_id 时，Bot 不启动，日志显示"Invalid chat_id format"
  - [ ] 发送 /menu 命令能打开脚本菜单
  - [ ] 从不同的 chat_id 发送命令能被拒绝（无权限提示无）
  - [ ] 查看日志功能能正确截断超长日志
  - [ ] 异常 callback 数据能被正确处理，显示错误提示而不是崩溃
  - [ ] 启动/停止脚本能正确反馈操作结果
  - [ ] Bot 异常断线后能自动重启

---

## 已知问题/TODO

- 无

---

## 技术细节

### 通知系统
- 类型: success (绿色) 或 error (红色)
- 位置: 右上角固定
- 自动消失: 2000ms
- 图标: CheckCircle2 (成功) 或 XCircle (错误)

### 运行时长计算
- 基于 `script.last_run` 时间戳和当前时间计算差值
- 只在 `last_status === 'running'` 时显示
- 每秒通过 setInterval 强制重新渲染以更新显示时间

### 脚本停止流程
1. 前端调用 `api.stopScript(id)` (POST /scripts/{id}/stop)
2. 后端 `stop_script_manually()` 调用 `scheduler.stop_script()`
3. `stop_script()` 向进程发送 SIGTERM，等待5秒
4. 如果5秒内未结束，发送 SIGKILL
5. 无论成功与否，更新数据库状态为 'stopped'
6. 前端收到响应后调用 `fetchScripts()` 刷新列表

### Telegram BOT 安全性改进
- **Chat ID 验证**: 转换为整数后再比较，防止类型混淆攻击
- **数据库资源**: 所有 DB 操作都用 try-finally 保证关闭
- **数据验证**: 启动时验证 token 和 chat_id 格式
- **错误处理**: 所有可能的解析错误都被捕获，不会导致 Bot 崩溃
- **超时保护**: 所有网络请求都有超时设置
- **权限检查**: 只处理来自配置 chat_id 的消息

### 主题系统
- 基于 localStorage 的 `theme` 键
- 支持 `light` 和 `dark` 两种主题
- 所有 UI 组件通过 `theme` 状态动态切换样式
- Monaco Editor 自动跟随主题变化

### Monaco Editor 配置
- **语言**: Python（自动检测脚本类型）
- **主题**: VS Light (light) 或 VS Dark (dark)
- **特性**:
  - 行号显示
  - 自动折行
  - 粘贴自动格式化
  - 禁用 minimap（节省空间）
  - Ctrl+Z/Y 撤销重做
  - Ctrl+/ 快速注释
  - 实时语法检查


