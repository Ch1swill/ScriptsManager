import React, { useState, useEffect, useRef } from 'react'
import {
  Plus, Settings, Play, Edit2, Trash2, Clock,
  FileText, CheckCircle2, XCircle, Loader2, X,
  LayoutDashboard, Terminal, Activity, Search,
  ChevronRight, Command, UploadCloud, Send, Save,
  Sun, Moon, RefreshCw, Square, Code2, FileCode, HeartPulse, RotateCw,
  Database, Download, Cloud, HardDrive
} from 'lucide-react'
import Editor from '@monaco-editor/react'
import * as api from './api'

interface Script {
  id: number;
  name: string;
  path: string;
  cron: string;
  enabled: boolean;
  last_status: 'success' | 'failed' | 'running' | 'stopped' | null;
  last_run: string | null;
  last_output: string | null;
  run_on_startup: boolean;
  arguments: string;
}

function App() {
  const [scripts, setScripts] = useState<Script[]>([]);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isModalOpen, setIsModalOpen] = useState(false);

  // 主题状态：从localStorage读取，默认为'light'
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('theme');
    return (saved as 'light' | 'dark') || 'light';
  });
  
  // 日志 Modal 状态
  const [logContent, setLogContent] = useState<string>('');
  const [isLogOpen, setIsLogOpen] = useState(false);
  const [viewingLogId, setViewingLogId] = useState<number | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  // 代码编辑器状态
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editorCode, setEditorCode] = useState('');
  const [editingCodeId, setEditingCodeId] = useState<number | null>(null);
  const [isSavingCode, setIsSavingCode] = useState(false);
  const [isSavingAndRestarting, setIsSavingAndRestarting] = useState(false);

  // 新建/编辑脚本状态
  const [editingId, setEditingId] = useState<number | null>(null);
  const [newScript, setNewScript] = useState({ name: '', path: '', cron: '', enabled: true, run_on_startup: false, arguments: '' });
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 设置状态
  const [tgConfig, setTgConfig] = useState({
    token: api.getSettings('tg_token') || '',
    chatId: api.getSettings('tg_chat_id') || '',
    proxy: api.getSettings('tg_proxy') || ''
  });
  const [enableHealthCheck, setEnableHealthCheck] = useState(false);
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success'>('idle');

  // 通知状态
  const [notification, setNotification] = useState<{ type: 'success' | 'error', message: string } | null>(null);

  // 脚本列表管理状态
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'py' | 'sh'>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'running' | 'success' | 'failed' | 'stopped' | 'idle'>('all');
  const [filterEnabled, setFilterEnabled] = useState<'all' | 'enabled' | 'disabled'>('all');
  const [sortBy, setSortBy] = useState<'name' | 'lastRun' | 'status'>('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);
  const [selectedScripts, setSelectedScripts] = useState<Set<number>>(new Set());

  // 删除确认对话框状态
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [deletingScriptName, setDeletingScriptName] = useState<string>('');

  // 备份删除确认状态
  const [backupToDelete, setBackupToDelete] = useState<string | null>(null);
  const [isDeletingAllBackups, setIsDeletingAllBackups] = useState(false);

  // 批量删除确认状态
  const [batchDeleteConfirmOpen, setBatchDeleteConfirmOpen] = useState(false);

  // 备份相关状态
  const [backupConfig, setBackupConfig] = useState({
    local_backup_enabled: false,
    local_backup_cron: '0 2 * * *',
    cd2_backup_enabled: false,
    cd2_backup_cron: '0 2 * * *',
    cd2_webdav_url: '',
    cd2_username: '',
    cd2_password: '',
    cd2_backup_path: '/ScriptBackups'
  });
  const [backupHistory, setBackupHistory] = useState<any[]>([]);
  const [isBackingUpLocal, setIsBackingUpLocal] = useState(false);
  const [isBackingUpCD2, setIsBackingUpCD2] = useState(false);
  const [testingCloudDrive, setTestingCloudDrive] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const restoreFileInputRef = useRef<HTMLInputElement>(null);


  // 初始化加载
  const fetchAllData = async () => {
    try {
      const [scriptsRes, settingsRes] = await Promise.all([
        api.getScripts(),
        api.getSettings()
      ]);

      setScripts(scriptsRes.data);

      // 填充设置
      const settings = settingsRes.data;
      setTgConfig({
        token: settings.tg_bot_token || '',
        chatId: settings.tg_chat_id || '',
        proxy: settings.tg_proxy || ''
      });
      setEnableHealthCheck(settings.enable_health_check === 'true');
    } catch (err) {
      console.error("Failed to fetch data", err);
    }
  };

  const fetchScripts = async () => {
    try {
      const res = await api.getScripts();
      setScripts(res.data);
    } catch (err) {
      console.error("Failed to fetch scripts", err);
    }
  };

  useEffect(() => { 
    fetchAllData(); 
    const interval = setInterval(async () => {
       try {
         const res = await api.getScripts();
         setScripts(res.data);
       } catch (e) {}
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  // 过滤和排序脚本列表
  const filteredAndSortedScripts = scripts
    .filter(script => {
      // 搜索过滤
      if (searchTerm && !script.name.toLowerCase().includes(searchTerm.toLowerCase())) {
        return false;
      }
      // 类型过滤
      if (filterType !== 'all') {
        const ext = script.path.endsWith('.py') ? 'py' : 'sh';
        if (ext !== filterType) return false;
      }
      // 状态过滤
      if (filterStatus !== 'all') {
        if (filterStatus === 'idle' && script.last_status !== null) {
          return false;
        } else if (filterStatus !== 'idle' && script.last_status !== filterStatus) {
          return false;
        }
      }
      // 启用状态过滤
      if (filterEnabled !== 'all') {
        if (filterEnabled === 'enabled' && !script.enabled) return false;
        if (filterEnabled === 'disabled' && script.enabled) return false;
      }
      return true;
    })
    .sort((a, b) => {
      // 首先：运行中的脚本始终排在最前面
      const aRunning = a.last_status === 'running' ? 0 : 1;
      const bRunning = b.last_status === 'running' ? 0 : 1;
      if (aRunning !== bRunning) {
        return aRunning - bRunning;
      }

      // 其次：按用户选择的排序方式
      let compareValue = 0;
      if (sortBy === 'name') {
        compareValue = a.name.localeCompare(b.name);
      } else if (sortBy === 'lastRun') {
        const aTime = a.last_run ? new Date(a.last_run).getTime() : 0;
        const bTime = b.last_run ? new Date(b.last_run).getTime() : 0;
        compareValue = aTime - bTime;
      } else if (sortBy === 'status') {
        const statusOrder: Record<string, number> = {
          'running': 0,
          'success': 1,
          'failed': 2,
          'stopped': 3,
          null: 4
        };
        compareValue = (statusOrder[a.last_status] || 4) - (statusOrder[b.last_status] || 4);
      }
      return sortOrder === 'asc' ? compareValue : -compareValue;
    });

  // WebSocket Log Streaming
  useEffect(() => {
    let socket: WebSocket | null = null;
    if (isLogOpen && viewingLogId) {
        setLogContent('Connecting to log stream...\n');
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host; 
        const wsUrl = `${protocol}//${host}/api/logs/${viewingLogId}/stream`;
        socket = new WebSocket(wsUrl);
        socket.onopen = () => setLogContent(''); 
        socket.onmessage = (event) => setLogContent(prev => prev + event.data);
        socket.onerror = () => setLogContent(prev => prev + '\n[Error] Connection failed.\n');
    }
    return () => { if (socket) socket.close(); };
  }, [isLogOpen, viewingLogId]);

  useEffect(() => {
      logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logContent]);


  const handleSaveScript = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const scriptToSave = { ...newScript, enabled: true };
      if (editingId) {
        await api.updateScript(editingId, scriptToSave);
      } else {
        await api.createScript(scriptToSave);
      }
      setNotification({ type: 'success', message: '保存成功' });
      closeModal();
      // 单独刷新脚本列表
      const res = await api.getScripts();
      setScripts(res.data);
    } catch (err) {
      setNotification({ type: 'error', message: '保存失败，请检查网络或日志' });
    }
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingId(null);
    setNewScript({ name: '', path: '', cron: '', enabled: true, run_on_startup: false, arguments: '' });
  };

  const handleEdit = (script: Script) => {
    setNewScript({
      name: script.name,
      path: script.path,
      cron: script.cron || '',
      enabled: script.enabled,
      run_on_startup: script.run_on_startup,
      arguments: script.arguments || ''
    });
    setEditingId(script.id);
    setIsModalOpen(true);
  };

  const handleDelete = async (id: number) => {
    const script = scripts.find(s => s.id === id);
    if (script) {
      setDeleteConfirmId(id);
      setDeletingScriptName(script.name);
    }
  };

  const confirmDelete = async () => {
    if (!deleteConfirmId) return;
    try {
      await api.deleteScript(deleteConfirmId);
      const res = await api.getScripts();
      setScripts(res.data);
      setNotification({ type: 'success', message: '删除成功' });
    } catch (err) {
      setNotification({ type: 'error', message: '删除失败，请检查网络或日志' });
    } finally {
      setDeleteConfirmId(null);
      setDeletingScriptName('');
    }
  };

  const cancelDelete = () => {
    setDeleteConfirmId(null);
    setDeletingScriptName('');
  };

  const handleShowLog = (id: number) => {
    setViewingLogId(id);
    setIsLogOpen(true);
  };

  const handleOpenEditor = async (id: number) => {
    try {
      const res = await api.getScriptContent(id);
      setEditorCode(res.data.content);
      setEditingCodeId(id);
      setIsEditorOpen(true);
    } catch (err) {
      setNotification({ type: 'error', message: '获取代码失败，请检查网络或日志' });
    }
  };

  const handleSaveCode = async () => {
    if (!editingCodeId) return;
    setIsSavingCode(true);
    try {
      await api.updateScriptContent(editingCodeId, editorCode);
      setIsEditorOpen(false);
      setEditingCodeId(null);
      setNotification({ type: 'success', message: '代码已保存' });
    } catch (err) {
      setNotification({ type: 'error', message: '保存代码失败，请检查网络或日志' });
    }
    finally { setIsSavingCode(false); }
  };

  const handleSaveAndRestartScript = async () => {
    if (!editingCodeId) return;
    setIsSavingAndRestarting(true);
    try {
      // 先保存代码
      await api.updateScriptContent(editingCodeId, editorCode);

      // 然后立即重启脚本（先停止后启动）
      const script = scripts.find(s => s.id === editingCodeId);
      if (script) {
        if (script.last_status === 'running') {
          await api.stopScript(editingCodeId);
        }
        await api.runScript(editingCodeId);
      }

      setIsEditorOpen(false);
      setEditingCodeId(null);
      setNotification({ type: 'success', message: '代码已保存，脚本已重启' });
      fetchScripts();
    } catch (err: any) {
      setNotification({ type: 'error', message: `操作失败: ${err.response?.data?.detail || err.message}` });
    }
    finally { setIsSavingAndRestarting(false); }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0];
    setIsUploading(true);
    try {
      const res = await api.uploadFile(file);
      setNewScript(prev => ({ ...prev, path: res.data.path, name: prev.name || file.name.split('.')[0] }));
      setNotification({ type: 'success', message: '文件已上传' });
    } catch (err) {
      setNotification({ type: 'error', message: '上传失败，请检查网络或日志' });
    }
    finally { setIsUploading(false); }
  };

  const handleRunToggle = async (script: Script) => {
    try {
        if (script.last_status === 'running') {
          const res = await api.stopScript(script.id);
          if (res.data) {
            setScripts(scripts.map(s => s.id === script.id ? res.data : s));
            setNotification({ type: 'success', message: '脚本已停止' });
            return;
          }
        } else {
          const res = await api.runScript(script.id);
          if (res.data) {
            setScripts(scripts.map(s => s.id === script.id ? res.data : s));
            setNotification({ type: 'success', message: '脚本已启动' });
            return;
          }
        }
        fetchScripts();
    } catch (err: any) {
        console.error("RunToggle error", err);
        setNotification({ type: 'error', message: `操作失败: ${err.response?.data?.detail || err.message}` });
    }
  };

  // 批量操作
  const toggleScriptSelection = (id: number) => {
    const newSelected = new Set(selectedScripts);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedScripts(newSelected);
  };

  const selectAllFiltered = () => {
    if (selectedScripts.size === filteredAndSortedScripts.length) {
      setSelectedScripts(new Set());
    } else {
      setSelectedScripts(new Set(filteredAndSortedScripts.map(s => s.id)));
    }
  };

  const handleBatchRun = async () => {
    if (selectedScripts.size === 0) return;
    const updatedScripts = { ...Object.fromEntries(scripts.map(s => [s.id, s])) };

    for (const id of selectedScripts) {
      try {
        const res = await api.runScript(id);
        if (res.data) {
          updatedScripts[id] = res.data;
        }
      } catch (err) {
        console.error(`Failed to run script ${id}`, err);
      }
    }

    setScripts(Object.values(updatedScripts));
    setNotification({ type: 'success', message: `已启动 ${selectedScripts.size} 个脚本` });
    setSelectedScripts(new Set());
    setIsMultiSelectMode(false);
  };

  const handleBatchStop = async () => {
    if (selectedScripts.size === 0) return;
    const updatedScripts = { ...Object.fromEntries(scripts.map(s => [s.id, s])) };

    for (const id of selectedScripts) {
      try {
        const res = await api.stopScript(id);
        if (res.data) {
          updatedScripts[id] = res.data;
        }
      } catch (err) {
        console.error(`Failed to stop script ${id}`, err);
      }
    }

    setScripts(Object.values(updatedScripts));
    setNotification({ type: 'success', message: `已停止 ${selectedScripts.size} 个脚本` });
    setSelectedScripts(new Set());
    setIsMultiSelectMode(false);
  };

  const handleBatchDelete = async () => {
    if (selectedScripts.size === 0) return;
    setBatchDeleteConfirmOpen(true);
  };

  const confirmBatchDelete = async () => {
    if (selectedScripts.size === 0) return;
    try {
      // 顺序删除每个脚本
      for (const id of selectedScripts) {
        await api.deleteScript(id);
      }
      setNotification({ type: 'success', message: `已删除 ${selectedScripts.size} 个脚本` });
      setSelectedScripts(new Set());
      setIsMultiSelectMode(false);
      setBatchDeleteConfirmOpen(false);
      fetchScripts();
    } catch (err) {
      setNotification({ type: 'error', message: '批量删除失败，请检查网络或日志' });
    }
  };

  const cancelBatchDelete = () => {
    setBatchDeleteConfirmOpen(false);
  };

  const handleSaveSettings = async () => {
    try {
        // 改为顺序执行，防止后端数据库死锁或 Bot 多次重启冲突
        await api.saveSettings('tg_bot_token', tgConfig.token);
        await api.saveSettings('tg_chat_id', tgConfig.chatId);
        await api.saveSettings('tg_proxy', tgConfig.proxy);
        await api.saveSettings('enable_health_check', String(enableHealthCheck));

        // 最后统一应用并重启 Bot
        await api.applySettings();

        setSaveStatus('success');
        setNotification({ type: 'success', message: '设置已保存' });
        setTimeout(() => setSaveStatus('idle'), 2000);
    } catch (err) {
        setNotification({ type: 'error', message: '保存设置失败，请检查网络或日志' });
    }
  };


  const handleTestTg = async () => {
    setTestStatus('testing');
    try {
      await api.testTgConnection(tgConfig.token, tgConfig.chatId, tgConfig.proxy);
      setTestStatus('success');
      setTimeout(() => setTestStatus('idle'), 3000);
    } catch (err) {
      setTestStatus('error');
      setTimeout(() => setTestStatus('idle'), 3000);
    }
  };

  const handleScan = async () => {
    try {
      await api.scanScripts();
      fetchAllData();
      setNotification({ type: 'success', message: '扫描完成' });
    } catch (err) {
      setNotification({ type: 'error', message: '扫描失败，请检查网络或日志' });
    }
  };

  // 备份相关处理函数
  const fetchBackupConfig = async () => {
    try {
      const res = await api.getBackupConfig();
      setBackupConfig({
        local_backup_enabled: res.data.local_backup_enabled === 'true',
        local_backup_cron: res.data.local_backup_cron || '0 2 * * *',
        cd2_backup_enabled: res.data.cd2_backup_enabled === 'true',
        cd2_backup_cron: res.data.cd2_backup_cron || '0 2 * * *',
        cd2_webdav_url: res.data.cd2_webdav_url || '',
        cd2_username: res.data.cd2_username || '',
        cd2_password: res.data.cd2_password || '',
        cd2_backup_path: res.data.cd2_backup_path || '/ScriptBackups'
      });
    } catch (err) {
      console.error('Failed to fetch backup config:', err);
    }
  };

  const fetchBackupHistory = async () => {
    try {
      const res = await api.getBackupHistory();
      setBackupHistory(res.data.backups || []);
    } catch (err) {
      console.error('Failed to fetch backup history:', err);
    }
  };

  const handleManualBackup = async (type: 'local' | 'clouddrive') => {
    if (type === 'local') setIsBackingUpLocal(true);
    else setIsBackingUpCD2(true);
    
    try {
      const res = await api.manualBackup(undefined, type);
      
      setNotification({ type: 'success', message: `备份成功: ${res.data.filename}` });
      if (type === 'local') await fetchBackupHistory(); // Only refresh history for local backup
    } catch (err: any) {
      setNotification({ type: 'error', message: err.response?.data?.detail || '备份失败' });
    } finally {
      if (type === 'local') setIsBackingUpLocal(false);
      else setIsBackingUpCD2(false);
    }
  };

  const handleSaveBackupConfig = async () => {
    try {
      // 保存备份配置
      await api.saveBackupConfig(backupConfig);
      // 立即应用定时备份设置（无需重启）
      await api.applyBackupSchedule();
      setNotification({ type: 'success', message: '备份配置已保存并生效' });
    } catch (err: any) {
      setNotification({ type: 'error', message: err.response?.data?.detail || '保存配置失败' });
    }
  };

  const handleRestoreUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.zip')) {
      setNotification({ type: 'error', message: '只支持ZIP格式的备份文件' });
      return;
    }

    setIsRestoring(true);
    try {
      const res = await api.uploadAndRestore(file);
      setNotification({
        type: 'success',
        message: `${res.data.message}\n恢复: ${res.data.restored_count} 个, 跳过: ${res.data.skipped_count} 个`
      });
      await fetchScripts(); // 刷新脚本列表
    } catch (err: any) {
      setNotification({ type: 'error', message: err.response?.data?.detail || '恢复失败' });
    } finally {
      setIsRestoring(false);
      if (restoreFileInputRef.current) {
        restoreFileInputRef.current.value = '';
      }
    }
  };

  const handleTestCloudDrive = async () => {
    if (!backupConfig.cd2_webdav_url || !backupConfig.cd2_username || !backupConfig.cd2_password) {
      setNotification({ type: 'error', message: '请填写WebDAV地址、用户名和密码' });
      return;
    }

    setTestingCloudDrive(true);
    try {
      await api.testCloudDrive(backupConfig.cd2_webdav_url, backupConfig.cd2_username, backupConfig.cd2_password);
      setNotification({ type: 'success', message: 'CloudDrive2连接成功' });
    } catch (err: any) {
      setNotification({ type: 'error', message: err.response?.data?.detail || '连接失败' });
    } finally {
      setTestingCloudDrive(false);
    }
  };

  // 初始化备份数据
  useEffect(() => {
    if (activeTab === 'backup') {
      fetchBackupConfig();
      fetchBackupHistory();
    }
  }, [activeTab]);

  const stats = {
    total: scripts.length,
    running: scripts.filter(s => s.last_status === 'running').length,
    failed: scripts.filter(s => s.last_status === 'failed').length,
  };

  const panelClass = theme === 'light' ? 'glass-panel' : 'glass-panel-dark';
  const textSecondary = theme === 'light' ? 'text-gray-500' : 'text-gray-400';
  const isDaemon = newScript.cron === '@daemon';

  return (
    <div className={`flex h-screen w-full overflow-hidden relative transition-colors duration-500 ${theme === 'light' ? 'bg-[#fbfbfd] text-[#1D1D1F]' : 'bg-[#000000] text-[#F5F5F7]'}`}>

      {/* 通知提示 */}
      {notification && (
        <Notification
          type={notification.type}
          message={notification.message}
          onClose={() => setNotification(null)}
        />
      )}

      <div className={`fixed top-[-10%] left-[-10%] w-[500px] h-[500px] rounded-full blur-[100px] animate-float pointer-events-none transition-colors duration-500 ${theme === 'light' ? 'bg-blue-400/20' : 'bg-blue-600/10'}`} />
      <div className={`fixed bottom-[-10%] right-[-10%] w-[600px] h-[600px] rounded-full blur-[120px] animate-float-delayed pointer-events-none transition-colors duration-500 ${theme === 'light' ? 'bg-purple-400/20' : 'bg-purple-600/10'}`} />

      <aside className={`w-64 flex-shrink-0 flex flex-col h-full z-20 relative transition-all duration-300 ${theme === 'light' ? 'glass-sidebar' : 'glass-sidebar-dark'}`}>
        <div className="p-8 pb-4 flex-1">
          <div className="flex items-center gap-3 mb-8">
            <img src="/icon.png" alt="Logo" className="w-10 h-10 rounded-xl shadow-md bg-orange-500 p-2 shrink-0" />
            <span className="font-bold text-xl tracking-tight whitespace-nowrap">ScriptsManager</span>
          </div>
          
          <div className="space-y-1">
            <SidebarItem icon={LayoutDashboard} label="仪表盘" active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} theme={theme} />
            <SidebarItem icon={Terminal} label="所有脚本" active={activeTab === 'scripts'} onClick={() => setActiveTab('scripts')} theme={theme} />
            <SidebarItem icon={Database} label="备份管理" active={activeTab === 'backup'} onClick={() => setActiveTab('backup')} theme={theme} />
            <SidebarItem icon={Settings} label="系统设置" active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} theme={theme} />
          </div>
        </div>

        <div className={`p-4 mx-4 mb-4 rounded-2xl ${theme === 'light' ? 'bg-white/50' : 'bg-white/5'}`}>
          <div className="flex items-center justify-between p-1 bg-gray-200/50 rounded-lg relative overflow-hidden">
             <div className={`absolute top-1 bottom-1 w-[calc(50%-4px)] bg-white shadow-sm rounded-md transition-all duration-300 ${theme === 'dark' ? 'translate-x-[calc(100%+4px)]' : 'translate-x-0'}`} />
             <button onClick={() => { setTheme('light'); localStorage.setItem('theme', 'light'); }} className={`flex-1 flex items-center justify-center gap-2 py-1.5 z-10 transition-colors text-xs font-medium ${theme === 'light' ? 'text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}> <Sun size={14} /> <span>Day</span> </button>
             <button onClick={() => { setTheme('dark'); localStorage.setItem('theme', 'dark'); }} className={`flex-1 flex items-center justify-center gap-2 py-1.5 z-10 transition-colors text-xs font-medium ${theme === 'dark' ? 'text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}> <Moon size={14} /> <span>Night</span> </button>
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto no-scrollbar relative z-10 p-8 pt-10">
        <div className="max-w-7xl mx-auto">
          <div className="flex justify-between items-end mb-10">
            <div>
              <h1 className="text-3xl font-bold tracking-tight mb-2">
                {activeTab === 'dashboard' ? '仪表盘' : activeTab === 'scripts' ? '脚本管理' : activeTab === 'backup' ? '备份管理' : '系统设置'}
              </h1>
              <p className={`${textSecondary} font-medium`}>
                {activeTab === 'settings' ? '配置通知与系统参数' : activeTab === 'backup' ? '管理脚本备份和恢复' : `系统运行平稳，${stats.running} 个任务正在执行中。`}
              </p>
            </div>
            {activeTab !== 'settings' && (
              <div className="flex gap-3">
                <button onClick={handleScan} className={`px-4 py-2.5 rounded-full font-medium transition-all active:scale-95 flex items-center gap-2 ${theme === 'light' ? 'bg-white text-gray-700 hover:bg-gray-50 shadow-sm' : 'bg-white/10 text-white hover:bg-white/20'}`}><RefreshCw size={18} /><span>扫描文件</span></button>
                <button onClick={() => setIsModalOpen(true)} className="bg-[#0071E3] hover:bg-[#0077ED] text-white px-5 py-2.5 rounded-full font-medium shadow-lg shadow-blue-500/30 transition-all active:scale-95 flex items-center gap-2"><Plus size={18} /><span>新建脚本</span></button>
              </div>
            )}
          </div>

          {(activeTab === 'dashboard' || activeTab === 'scripts') && (
            <>
              {activeTab === 'dashboard' && (
                <div className="grid grid-cols-3 gap-6 mb-10">
                  <StatCard label="总脚本数" value={stats.total} icon={FileText} color="bg-blue-500" panelClass={panelClass} theme={theme} />
                  <StatCard label="运行中" value={stats.running} icon={Loader2} color="bg-amber-500" panelClass={panelClass} theme={theme} />
                  <StatCard label="最近失败" value={stats.failed} icon={XCircle} color="bg-red-500" panelClass={panelClass} theme={theme} />
                </div>
              )}

              {activeTab === 'scripts' && (
                <>
                  {/* 搜索和过滤面板 */}
                  <div className={`${panelClass} p-6 rounded-[24px] mb-6`}>
                    <div className="space-y-4">
                      {/* 搜索框 */}
                      <div>
                        <input
                          type="text"
                          placeholder="🔍 搜索脚本名称..."
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                          className={`w-full p-3 rounded-xl border-none ring-1 focus:ring-2 focus:ring-blue-500 outline-none transition-all ${theme === 'light' ? 'bg-gray-50 ring-gray-200' : 'bg-white/5 ring-white/10 text-white'}`}
                        />
                      </div>

                      {/* 过滤和排序行 */}
                      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                        {/* 类型过滤 */}
                        <select
                          value={filterType}
                          onChange={(e) => setFilterType(e.target.value as any)}
                          className={`p-2 rounded-lg border-none ring-1 focus:ring-2 focus:ring-blue-500 outline-none text-sm ${theme === 'light' ? 'bg-gray-50 ring-gray-200' : 'bg-white/5 ring-white/10 text-white [&>option]:bg-gray-900 [&>option]:text-white'}`}
                        >
                          <option value="all">📁 全部类型</option>
                          <option value="py">🐍 Python</option>
                          <option value="sh">🔧 Shell</option>
                        </select>

                        {/* 状态过滤 */}
                        <select
                          value={filterStatus}
                          onChange={(e) => setFilterStatus(e.target.value as any)}
                          className={`p-2 rounded-lg border-none ring-1 focus:ring-2 focus:ring-blue-500 outline-none text-sm ${theme === 'light' ? 'bg-gray-50 ring-gray-200' : 'bg-white/5 ring-white/10 text-white [&>option]:bg-gray-900 [&>option]:text-white'}`}
                        >
                          <option value="all">🔄 全部状态</option>
                          <option value="running">🟢 运行中</option>
                          <option value="success">✅ 成功</option>
                          <option value="failed">❌ 失败</option>
                          <option value="stopped">⏸️ 已停止</option>
                          <option value="idle">⭕ 未运行</option>
                        </select>

                        {/* 启用状态过滤 */}
                        <select
                          value={filterEnabled}
                          onChange={(e) => setFilterEnabled(e.target.value as any)}
                          className={`p-2 rounded-lg border-none ring-1 focus:ring-2 focus:ring-blue-500 outline-none text-sm ${theme === 'light' ? 'bg-gray-50 ring-gray-200' : 'bg-white/5 ring-white/10 text-white [&>option]:bg-gray-900 [&>option]:text-white'}`}
                        >
                          <option value="all">📌 全部</option>
                          <option value="enabled">✔️ 已启用</option>
                          <option value="disabled">✖️ 已禁用</option>
                        </select>

                        {/* 排序方式 */}
                        <select
                          value={sortBy}
                          onChange={(e) => setSortBy(e.target.value as any)}
                          className={`p-2 rounded-lg border-none ring-1 focus:ring-2 focus:ring-blue-500 outline-none text-sm ${theme === 'light' ? 'bg-gray-50 ring-gray-200' : 'bg-white/5 ring-white/10 text-white [&>option]:bg-gray-900 [&>option]:text-white'}`}
                        >
                          <option value="name">🔤 按名称</option>
                          <option value="lastRun">📅 按运行时间</option>
                          <option value="status">⚡ 按状态</option>
                        </select>

                        {/* 排序顺序 */}
                        <button
                          onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
                          className={`p-2 rounded-lg border-none ring-1 focus:ring-2 focus:ring-blue-500 outline-none text-sm font-medium ${theme === 'light' ? 'bg-gray-50 ring-gray-200 hover:bg-gray-100' : 'bg-white/5 ring-white/10 hover:bg-white/10 text-white'}`}
                        >
                          {sortOrder === 'asc' ? '⬆️ 升序' : '⬇️ 降序'}
                        </button>
                      </div>

                      {/* 视图切换和批量操作 */}
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex gap-2">
                          <button
                            onClick={() => setViewMode('grid')}
                            className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${viewMode === 'grid' ? 'bg-blue-500 text-white' : theme === 'light' ? 'bg-gray-100 text-gray-700 hover:bg-gray-200' : 'bg-white/10 text-gray-300 hover:bg-white/20'}`}
                          >
                            📊 网格
                          </button>
                          <button
                            onClick={() => setViewMode('table')}
                            className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${viewMode === 'table' ? 'bg-blue-500 text-white' : theme === 'light' ? 'bg-gray-100 text-gray-700 hover:bg-gray-200' : 'bg-white/10 text-gray-300 hover:bg-white/20'}`}
                          >
                            📋 列表
                          </button>
                          <button
                            onClick={() => {
                              setIsMultiSelectMode(!isMultiSelectMode);
                              if (isMultiSelectMode) {
                                setSelectedScripts(new Set());
                              }
                            }}
                            className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${isMultiSelectMode ? 'bg-orange-500 text-white' : theme === 'light' ? 'bg-gray-100 text-gray-700 hover:bg-gray-200' : 'bg-white/10 text-gray-300 hover:bg-white/20'}`}
                          >
                            ✓ 多选
                          </button>
                        </div>

                        {/* 结果统计 */}
                        <p className={`text-sm font-medium whitespace-nowrap ${theme === 'light' ? 'text-gray-600' : 'text-gray-400'}`}>
                          共 {filteredAndSortedScripts.length} / {scripts.length} 个脚本
                        </p>

                        {/* 批量操作按钮 */}
                        {isMultiSelectMode && selectedScripts.size > 0 && (
                          <div className="flex gap-2">
                            <button
                              onClick={selectAllFiltered}
                              className={`px-3 py-2 rounded-lg text-sm font-medium ${theme === 'light' ? 'bg-gray-100 text-gray-700 hover:bg-gray-200' : 'bg-white/10 text-gray-300 hover:bg-white/20'}`}
                            >
                              {selectedScripts.size === filteredAndSortedScripts.length ? '取消全选' : '全选'} ({selectedScripts.size})
                            </button>
                            <button
                              onClick={handleBatchRun}
                              className="px-3 py-2 rounded-lg text-sm font-medium bg-green-500 hover:bg-green-600 text-white"
                            >
                              ▶️ 启动
                            </button>
                            <button
                              onClick={handleBatchStop}
                              className="px-3 py-2 rounded-lg text-sm font-medium bg-red-500 hover:bg-red-600 text-white"
                            >
                              ⏹️ 停止
                            </button>
                            <button
                              onClick={handleBatchDelete}
                              className="px-3 py-2 rounded-lg text-sm font-medium bg-rose-500 hover:bg-rose-600 text-white"
                            >
                              🗑️ 删除
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* 脚本列表 */}
                  <div className={viewMode === 'grid' ? 'grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6' : 'space-y-3'}>
                    {filteredAndSortedScripts.map(script => (
                      <ScriptCard
                        key={script.id}
                        script={script}
                        onRunToggle={() => handleRunToggle(script)}
                        onEdit={() => handleEdit(script)}
                        onDelete={() => handleDelete(script.id)}
                        onLog={() => handleShowLog(script.id)}
                        onOpenEditor={() => handleOpenEditor(script.id)}
                        panelClass={panelClass}
                        theme={theme}
                        viewMode={viewMode}
                        isMultiSelectMode={isMultiSelectMode}
                        isSelected={selectedScripts.has(script.id)}
                        onSelect={() => toggleScriptSelection(script.id)}
                      />
                    ))}
                  </div>

                  {filteredAndSortedScripts.length === 0 && (
                    <div className={`text-center py-12 ${panelClass} rounded-[24px]`}>
                      <p className={`text-lg font-medium ${theme === 'light' ? 'text-gray-500' : 'text-gray-400'}`}>
                        🔍 没有找到匹配的脚本
                      </p>
                    </div>
                  )}
                </>
              )}

              {activeTab === 'dashboard' && (
                <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
                  {[...scripts].sort((a, b) => {
                    // 运行中的脚本排在最前面
                    const aRunning = a.last_status === 'running' ? 0 : 1;
                    const bRunning = b.last_status === 'running' ? 0 : 1;
                    if (aRunning !== bRunning) return aRunning - bRunning;
                    // 其次按名称排序
                    return a.name.localeCompare(b.name);
                  }).map(script => (
                    <ScriptCard key={script.id} script={script} onRunToggle={() => handleRunToggle(script)} onEdit={() => handleEdit(script)} onDelete={() => handleDelete(script.id)} onLog={() => handleShowLog(script.id)} onOpenEditor={() => handleOpenEditor(script.id)} panelClass={panelClass} theme={theme} />
                  ))}
                </div>
              )}
            </>
          )}

          {activeTab === 'settings' && (
            <div className="max-w-2xl">
              <div className={`${panelClass} p-8 rounded-[32px]`}>
                <h2 className="text-xl font-bold mb-6 flex items-center gap-2"><Send size={20} className="text-blue-500" />Telegram 通知</h2>
                <div className="space-y-6">
                  <InputGroup label="Bot Token" value={tgConfig.token} onChange={v => setTgConfig({...tgConfig, token: v})} type="password" placeholder="123456:ABC-DEF..." theme={theme} />
                  <InputGroup label="Chat ID" value={tgConfig.chatId} onChange={v => setTgConfig({...tgConfig, chatId: v})} placeholder="-100123456789" theme={theme} />
                  <InputGroup label="HTTP Proxy (可选)" value={tgConfig.proxy} onChange={v => setTgConfig({...tgConfig, proxy: v})} placeholder="http://192.168.1.5:7890" theme={theme} />

                  <div className="pt-4 border-t border-gray-100 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <HeartPulse size={20} className="text-red-500" />
                        <span className={`font-semibold ${theme === 'light' ? 'text-gray-700' : 'text-gray-300'}`}>开启脚本健康检查</span>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                        <input type="checkbox" className="sr-only peer" checked={enableHealthCheck} onChange={e => setEnableHealthCheck(e.target.checked)} />
                        <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                    </label>
                  </div>

                  <div className="flex gap-4 pt-2">
                    <button onClick={handleSaveSettings} className={`flex-1 py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition-colors duration-300 ${saveStatus === 'success' ? 'bg-green-500 text-white' : (theme === 'light' ? 'bg-black text-white hover:bg-gray-800' : 'bg-white text-black hover:bg-gray-200')}`}>
                      {saveStatus === 'success' ? <CheckCircle2 size={18} /> : <Save size={18} />}
                      {saveStatus === 'success' ? '已保存' : '保存设置'}
                    </button>
                    <button onClick={handleTestTg} disabled={testStatus === 'testing'} className={`flex-1 py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition-colors border ${testStatus === 'success' ? 'bg-green-500 text-white border-green-500' : testStatus === 'error' ? 'bg-red-500 text-white border-red-500' : theme === 'light' ? 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50' : 'bg-white/10 text-gray-200 border-white/10 hover:bg-white/20'}`}>{testStatus === 'testing' ? <Loader2 size={18} className="animate-spin" /> : testStatus === 'success' ? <CheckCircle2 size={18} /> : testStatus === 'error' ? <XCircle size={18} /> : <Send size={18} />} {testStatus === 'testing' ? '测试中...' : testStatus === 'success' ? '发送成功' : testStatus === 'error' ? '发送失败' : '测试连通性'}</button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'backup' && (
            <div className="max-w-5xl">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                
                {/* 1. 本地备份配置 */}
                <div className={`${panelClass} p-8 rounded-[32px] flex flex-col h-full`}>
                  <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
                    <HardDrive size={20} className="text-blue-500" />
                    本地备份策略
                  </h2>
                  <div className="space-y-6 flex-1">
                    <div className="p-4 rounded-xl bg-blue-500/10 border border-blue-500/20">
                      <p className={`text-sm ${theme === 'light' ? 'text-gray-700' : 'text-gray-300'}`}>
                        备份所有脚本到本地服务器目录 <code>/app/data/backups</code>，保留最近记录。
                      </p>
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Clock size={20} className="text-blue-500" />
                        <span className={`font-semibold ${theme === 'light' ? 'text-gray-700' : 'text-gray-300'}`}>定时自动备份</span>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          className="sr-only peer"
                          checked={backupConfig.local_backup_enabled}
                          onChange={e => setBackupConfig({...backupConfig, local_backup_enabled: e.target.checked})}
                        />
                        <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                      </label>
                    </div>

                    {backupConfig.local_backup_enabled && (
                      <InputGroup
                        label="Cron 表达式"
                        value={backupConfig.local_backup_cron}
                        onChange={v => setBackupConfig({...backupConfig, local_backup_cron: v})}
                        placeholder="0 2 * * * (每天凌晨2点)"
                        theme={theme}
                      />
                    )}
                  </div>
                  
                  <div className="flex gap-3 mt-8">
                     <button
                      onClick={handleSaveBackupConfig}
                      className={`flex-1 py-3 rounded-xl font-bold flex items-center justify-center gap-2 ${
                        theme === 'light' ? 'bg-gray-100 text-gray-700 hover:bg-gray-200' : 'bg-white/10 text-white hover:bg-white/20'
                      }`}
                    >
                      <Save size={18} /> 保存配置
                    </button>
                    <button
                      onClick={() => handleManualBackup('local')}
                      disabled={isBackingUpLocal}
                      className="flex-1 py-3 bg-blue-500 hover:bg-blue-600 text-white rounded-xl font-bold flex items-center justify-center gap-2 shadow-lg shadow-blue-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isBackingUpLocal ? <Loader2 size={18} className="animate-spin" /> : <Play size={18} fill="currentColor" />}
                      立即运行
                    </button>
                  </div>
                </div>

                {/* 2. CloudDrive2 备份配置 */}
                <div className={`${panelClass} p-8 rounded-[32px] flex flex-col h-full`}>
                  <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
                    <Cloud size={20} className="text-purple-500" />
                    CloudDrive2 备份策略
                  </h2>
                  <div className="space-y-4 flex-1">
                     <div className="p-4 rounded-xl bg-purple-500/10 border border-purple-500/20 mb-4">
                      <p className={`text-sm ${theme === 'light' ? 'text-gray-700' : 'text-gray-300'}`}>
                        备份后自动上传到 CD2 存储。
                      </p>
                    </div>

                    <InputGroup
                        label="WebDAV 地址"
                        value={backupConfig.cd2_webdav_url}
                        onChange={v => setBackupConfig({...backupConfig, cd2_webdav_url: v})}
                        placeholder="http://192.168.1.100:19798/dav"
                        theme={theme}
                      />
                    <div className="grid grid-cols-2 gap-4">
                        <InputGroup
                            label="用户名"
                            value={backupConfig.cd2_username}
                            onChange={v => setBackupConfig({...backupConfig, cd2_username: v})}
                            placeholder="User"
                            theme={theme}
                        />
                         <InputGroup
                            label="密码"
                            value={backupConfig.cd2_password}
                            onChange={v => setBackupConfig({...backupConfig, cd2_password: v})}
                            type="password"
                            placeholder="Pass"
                            theme={theme}
                        />
                    </div>
                     <InputGroup
                        label="备份路径"
                        value={backupConfig.cd2_backup_path}
                        onChange={v => setBackupConfig({...backupConfig, cd2_backup_path: v})}
                        placeholder="/ScriptBackups"
                        theme={theme}
                      />

                     <div className="pt-4 border-t border-gray-200 dark:border-white/10 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Clock size={20} className="text-purple-500" />
                        <span className={`font-semibold ${theme === 'light' ? 'text-gray-700' : 'text-gray-300'}`}>定时自动备份</span>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          className="sr-only peer"
                          checked={backupConfig.cd2_backup_enabled}
                          onChange={e => setBackupConfig({...backupConfig, cd2_backup_enabled: e.target.checked})}
                        />
                        <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-purple-300 dark:peer-focus:ring-purple-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600"></div>
                      </label>
                    </div>

                    {backupConfig.cd2_backup_enabled && (
                      <InputGroup
                        value={backupConfig.cd2_backup_cron}
                        onChange={v => setBackupConfig({...backupConfig, cd2_backup_cron: v})}
                        placeholder="0 2 * * * (每天凌晨2点)"
                        theme={theme}
                      />
                    )}
                  </div>
                  
                   <div className="flex gap-3 mt-8">
                     <button
                        onClick={handleTestCloudDrive}
                        disabled={testingCloudDrive}
                        className={`px-4 py-3 rounded-xl font-bold flex items-center justify-center gap-2 border ${
                          theme === 'light'
                            ? 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                            : 'bg-white/10 text-gray-200 border-white/10 hover:bg-white/20'
                        }`}
                      >
                        {testingCloudDrive ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
                      </button>
                     <button
                      onClick={handleSaveBackupConfig}
                      className={`flex-1 py-3 rounded-xl font-bold flex items-center justify-center gap-2 ${
                        theme === 'light' ? 'bg-gray-100 text-gray-700 hover:bg-gray-200' : 'bg-white/10 text-white hover:bg-white/20'
                      }`}
                    >
                      <Save size={18} /> 保存配置
                    </button>
                    <button
                      onClick={() => handleManualBackup('clouddrive')}
                      disabled={isBackingUpCD2}
                      className="flex-1 py-3 bg-purple-500 hover:bg-purple-600 text-white rounded-xl font-bold flex items-center justify-center gap-2 shadow-lg shadow-purple-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isBackingUpCD2 ? <Loader2 size={18} className="animate-spin" /> : <Cloud size={18} />}
                      立即运行
                    </button>
                  </div>
                </div>
              </div>

              {/* 恢复与历史 */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                 {/* 恢复备份 */}
                <div className={`${panelClass} p-8 rounded-[32px] lg:col-span-1 self-start`}>
                    <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                    <RotateCw size={20} className="text-green-500" />
                    恢复备份
                    </h2>
                    <p className={`text-sm mb-6 ${theme === 'light' ? 'text-gray-600' : 'text-gray-400'}`}>
                    上传 ZIP 文件，自动恢复脚本和配置。
                    </p>
                    <input
                    ref={restoreFileInputRef}
                    type="file"
                    className="hidden"
                    accept=".zip"
                    onChange={handleRestoreUpload}
                    />
                    <button
                    onClick={() => restoreFileInputRef.current?.click()}
                    disabled={isRestoring}
                    className={`w-full py-4 rounded-2xl font-bold flex items-center justify-center gap-2 transition-all ${
                        isRestoring
                        ? 'bg-gray-400 text-white cursor-not-allowed'
                        : 'bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 text-white shadow-lg'
                    }`}
                    >
                    {isRestoring ? <Loader2 size={20} className="animate-spin" /> : <UploadCloud size={20} />}
                    {isRestoring ? '恢复中...' : '上传并恢复'}
                    </button>
                </div>

                {/* 备份历史 */}
                <div className={`${panelClass} p-8 rounded-[32px] lg:col-span-2`}>
                    <div className="flex items-center justify-between mb-6">
                    <h2 className="text-xl font-bold flex items-center gap-2">
                        <Clock size={20} className="text-blue-500" />
                        本地历史
                    </h2>
                    {backupHistory.length > 0 && (
                        <button
                        onClick={() => setIsDeletingAllBackups(true)}
                        className={`px-4 py-2 rounded-xl font-semibold text-sm flex items-center gap-2 transition-colors ${
                            theme === 'light'
                            ? 'bg-red-50 text-red-600 hover:bg-red-100'
                            : 'bg-red-900/20 text-red-400 hover:bg-red-900/30'
                        }`}
                        >
                        <Trash2 size={16} />
                        清空
                        </button>
                    )}
                    </div>
                    <div className="space-y-3 max-h-[280px] overflow-y-auto pr-2 custom-scrollbar">
                    {backupHistory.length === 0 ? (
                        <div className={`text-center py-8 ${theme === 'light' ? 'text-gray-500' : 'text-gray-400'}`}>
                        暂无本地备份记录
                        </div>
                    ) : (
                        backupHistory.map((backup, idx) => (
                        <div
                            key={idx}
                            className={`p-4 rounded-xl flex items-center justify-between ${
                            theme === 'light' ? 'bg-gray-50 hover:bg-gray-100' : 'bg-white/5 hover:bg-white/10'
                            } transition-colors`}
                        >
                            <div className="flex items-center gap-3 min-w-0">
                            <FileText size={20} className="text-blue-500 flex-shrink-0" />
                            <div className="min-w-0">
                                <div className="font-semibold truncate">{backup.filename}</div>
                                <div className={`text-xs ${theme === 'light' ? 'text-gray-500' : 'text-gray-400'}`}>
                                {new Date(backup.created_at).toLocaleString('zh-CN')} · {(backup.size / 1024).toFixed(2)} KB
                                </div>
                            </div>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                            <button
                                onClick={() => api.downloadBackup(backup.filename)}
                                className={`p-2 rounded-lg transition-colors ${
                                theme === 'light' ? 'hover:bg-gray-200' : 'hover:bg-white/20'
                                }`}
                                title="下载"
                            >
                                <Download size={18} />
                            </button>
                            <button
                                onClick={() => setBackupToDelete(backup.filename)}
                                className={`p-2 rounded-lg transition-colors ${
                                theme === 'light' ? 'hover:bg-red-100 text-red-500' : 'hover:bg-red-900/30 text-red-400'
                                }`}
                                title="删除"
                            >
                                <Trash2 size={18} />
                            </button>
                            </div>
                        </div>
                        ))
                    )}
                    </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Log Modal */} 
      {isLogOpen && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className={`${theme === 'light' ? 'bg-white' : 'bg-[#1c1c1e] text-white'} rounded-[32px] p-8 w-full max-w-3xl shadow-2xl scale-100 animate-in zoom-in-95 duration-200 h-[80vh] flex flex-col`}>
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold flex items-center gap-2"><FileText size={24}/> 运行日志</h2>
              <button onClick={() => setIsLogOpen(false)} className={`p-2 rounded-full transition-colors ${theme === 'light' ? 'hover:bg-gray-100' : 'hover:bg-white/10'}`}><X size={24} /></button>
            </div>
            <div className={`flex-1 rounded-2xl p-4 overflow-auto font-mono text-sm whitespace-pre-wrap ${theme === 'light' ? 'bg-gray-50 text-gray-800' : 'bg-black/30 text-gray-300'}`}>{logContent}<div ref={logEndRef} /></div>
          </div>
        </div>
      )}

      {/* Code Editor Modal */}
      {isEditorOpen && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className={`${theme === 'light' ? 'bg-white' : 'bg-[#1c1c1e] text-white'} rounded-[32px] p-8 w-full max-w-5xl shadow-2xl scale-100 animate-in zoom-in-95 duration-200 h-[90vh] flex flex-col`}>
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold flex items-center gap-2"><Code2 size={24}/> 在线编辑代码</h2>
              <div className="flex gap-3">
                <button onClick={handleSaveCode} disabled={isSavingCode || isSavingAndRestarting} className="bg-[#0071E3] hover:bg-[#0077ED] text-white px-6 py-2 rounded-full font-bold flex items-center gap-2 disabled:opacity-50">{isSavingCode ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}<span>保存</span></button>
                <button onClick={handleSaveAndRestartScript} disabled={isSavingCode || isSavingAndRestarting} className="bg-orange-500 hover:bg-orange-600 text-white px-6 py-2 rounded-full font-bold flex items-center gap-2 disabled:opacity-50">{isSavingAndRestarting ? <Loader2 size={18} className="animate-spin" /> : <RotateCw size={18} />}<span>保存并重启</span></button>
                <button onClick={() => setIsEditorOpen(false)} className={`p-2 rounded-full transition-colors ${theme === 'light' ? 'hover:bg-gray-100' : 'hover:bg-white/10'}`}><X size={24} /></button>
              </div>
            </div>
            <Editor
              height="100%"
              defaultLanguage="python"
              value={editorCode}
              onChange={(value) => setEditorCode(value || '')}
              theme={theme === 'dark' ? 'vs-dark' : 'vs-light'}
              options={{
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                fontSize: 14,
                lineNumbers: 'on',
                wordWrap: 'on',
                formatOnPaste: true,
              }}
              className="rounded-2xl overflow-hidden"
            />
          </div>
        </div>
      )}

      {isModalOpen && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className={`${theme === 'light' ? 'bg-white' : 'bg-[#1c1c1e] text-white'} rounded-[32px] p-8 w-full max-w-lg shadow-2xl scale-100 animate-in zoom-in-95 duration-200 overflow-y-auto max-h-[90vh]`}>
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold">{editingId ? '编辑脚本' : '新建脚本'}</h2>
              <button onClick={closeModal} className={`p-2 rounded-full transition-colors ${theme === 'light' ? 'hover:bg-gray-100' : 'hover:bg-white/10'}`}><X size={24} /></button>
            </div>
            <form onSubmit={handleSaveScript} className="space-y-5">
              <div onClick={() => fileInputRef.current?.click()} className={`border-2 border-dashed rounded-2xl p-6 flex flex-col items-center justify-center cursor-pointer transition-colors group ${theme === 'light' ? 'border-gray-200 hover:border-blue-400 hover:bg-blue-50' : 'border-white/10 hover:border-blue-500/50 hover:bg-blue-500/10'}`}><input ref={fileInputRef} type="file" className="hidden" onChange={handleFileUpload} accept=".py,.sh" /><div className="w-12 h-12 bg-blue-100 text-blue-500 rounded-full flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">{isUploading ? <Loader2 size={24} className="animate-spin" /> : <UploadCloud size={24} />}</div><p className={`text-sm font-medium ${theme === 'light' ? 'text-gray-600' : 'text-gray-300'}`}>点击上传脚本文件 (.py / .sh)</p></div>
              <InputGroup label="名称" value={newScript.name} onChange={v => setNewScript({...newScript, name: v})} placeholder="例如: 每日备份" theme={theme} />
              <InputGroup label="路径" value={newScript.path} onChange={v => setNewScript({...newScript, path: v})} placeholder="/scripts/myscript.py" theme={theme} />
              <InputGroup label="参数" value={newScript.arguments} onChange={v => setNewScript({...newScript, arguments: v})} placeholder='例如: "--dry-run"' theme={theme} />
              <div className="flex flex-col gap-2"><div className="flex justify-between items-center px-1"><label className={`text-sm font-semibold ${theme === 'light' ? 'text-gray-700' : 'text-gray-300'}`}>定时设置</label><label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={isDaemon} onChange={e => setNewScript({...newScript, cron: e.target.checked ? '@daemon' : ''})} className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500" /><span className={`text-xs font-medium ${theme === 'light' ? 'text-gray-500' : 'text-gray-400'}`}>常驻服务</span></label></div><InputGroup value={newScript.cron} onChange={v => !isDaemon && setNewScript({...newScript, cron: v})} placeholder={isDaemon ? "常驻服务" : "0 8 * * *"} theme={theme} disabled={isDaemon} /></div>
                                        <div className="flex gap-4"> 
                                          <label title="定时脚本无需勾选，常驻后台脚本（如@daemon）建议开启" className={`flex-1 flex items-center justify-center gap-3 p-4 rounded-xl cursor-pointer transition-colors ${theme === 'light' ? 'bg-gray-50 hover:bg-gray-100' : 'bg-white/5 hover:bg-white/10'}`}> 
                                            <input type="checkbox" checked={newScript.run_on_startup} onChange={e => setNewScript({...newScript, run_on_startup: e.target.checked})} className="w-5 h-5 rounded text-blue-600 focus:ring-blue-500" /> 
                                            <span className="font-medium">开机自启</span> 
                                          </label> 
                                        </div>
              
              <button type="submit" className="w-full py-4 bg-[#0071E3] hover:bg-[#0077ED] text-white rounded-2xl font-bold text-lg shadow-xl shadow-blue-500/20 transition-all active:scale-[0.98]">
                {editingId ? '保存修改' : '确认创建'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirm Modal */}
      {deleteConfirmId !== null && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className={`${theme === 'light' ? 'bg-white' : 'bg-[#1c1c1e] text-white'} rounded-[32px] p-8 w-full max-w-md shadow-2xl scale-100 animate-in zoom-in-95 duration-200`}>
            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 bg-red-100 text-red-500 rounded-full flex items-center justify-center">
                <Trash2 size={24} />
              </div>
              <div>
                <h2 className="text-xl font-bold">确定要删除？</h2>
                <p className={`text-sm ${theme === 'light' ? 'text-gray-500' : 'text-gray-400'}`}>此操作无法撤销</p>
              </div>
            </div>

            <div className={`p-4 rounded-2xl mb-6 ${theme === 'light' ? 'bg-gray-50' : 'bg-white/5'}`}>
              <p className="text-sm"><span className={`font-semibold ${theme === 'light' ? 'text-gray-700' : 'text-gray-200'}`}>脚本名称:</span> <span className={theme === 'light' ? 'text-gray-900' : 'text-white'}>{deletingScriptName}</span></p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={cancelDelete}
                className={`flex-1 py-3 rounded-xl font-bold transition-all ${theme === 'light' ? 'bg-gray-100 text-gray-700 hover:bg-gray-200' : 'bg-white/10 text-gray-300 hover:bg-white/20'}`}
              >
                取消
              </button>
              <button
                onClick={confirmDelete}
                className="flex-1 py-3 rounded-xl font-bold bg-red-500 hover:bg-red-600 text-white transition-all"
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Batch Delete Confirm Modal */}
      {batchDeleteConfirmOpen && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className={`${theme === 'light' ? 'bg-white' : 'bg-[#1c1c1e] text-white'} rounded-[32px] p-8 w-full max-w-md shadow-2xl scale-100 animate-in zoom-in-95 duration-200`}>
            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 bg-red-100 text-red-500 rounded-full flex items-center justify-center">
                <Trash2 size={24} />
              </div>
              <div>
                <h2 className="text-xl font-bold">确定要批量删除？</h2>
                <p className={`text-sm ${theme === 'light' ? 'text-gray-500' : 'text-gray-400'}`}>此操作无法撤销</p>
              </div>
            </div>

            <div className={`p-4 rounded-2xl mb-6 ${theme === 'light' ? 'bg-gray-50' : 'bg-white/5'}`}>
              <p className="text-sm"><span className={`font-semibold ${theme === 'light' ? 'text-gray-700' : 'text-gray-200'}`}>将删除脚本:</span></p>
              <div className="mt-3 max-h-48 overflow-y-auto space-y-1">
                {Array.from(selectedScripts).map(id => {
                  const script = scripts.find(s => s.id === id);
                  return (
                    <p key={id} className={`text-sm ${theme === 'light' ? 'text-gray-700' : 'text-gray-300'}`}>
                      • {script?.name || `脚本 ${id}`}
                    </p>
                  );
                })}
              </div>
              <p className={`text-sm font-semibold mt-3 ${theme === 'light' ? 'text-red-600' : 'text-red-400'}`}>共 {selectedScripts.size} 个脚本</p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={cancelBatchDelete}
                className={`flex-1 py-3 rounded-xl font-bold transition-all ${theme === 'light' ? 'bg-gray-100 text-gray-700 hover:bg-gray-200' : 'bg-white/10 text-gray-300 hover:bg-white/20'}`}
              >
                取消
              </button>
              <button
                onClick={confirmBatchDelete}
                className="flex-1 py-3 rounded-xl font-bold bg-red-500 hover:bg-red-600 text-white transition-all"
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Backup Single Delete Confirm Modal */}
      {backupToDelete && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className={`${theme === 'light' ? 'bg-white' : 'bg-[#1c1c1e] text-white'} rounded-[32px] p-8 w-full max-w-md shadow-2xl scale-100 animate-in zoom-in-95 duration-200`}>
            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 bg-red-100 text-red-500 rounded-full flex items-center justify-center">
                <Trash2 size={24} />
              </div>
              <div>
                <h2 className="text-xl font-bold">删除备份文件？</h2>
                <p className={`text-sm ${theme === 'light' ? 'text-gray-500' : 'text-gray-400'}`}>此操作将从磁盘永久删除该文件</p>
              </div>
            </div>

            <div className={`p-4 rounded-2xl mb-6 ${theme === 'light' ? 'bg-gray-50' : 'bg-white/5'}`}>
              <p className="text-sm truncate"><span className={`font-semibold ${theme === 'light' ? 'text-gray-700' : 'text-gray-200'}`}>文件:</span> {backupToDelete}</p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setBackupToDelete(null)}
                className={`flex-1 py-3 rounded-xl font-bold transition-all ${theme === 'light' ? 'bg-gray-100 text-gray-700 hover:bg-gray-200' : 'bg-white/10 text-gray-300 hover:bg-white/20'}`}
              >
                取消
              </button>
              <button
                onClick={async () => {
                  try {
                    await api.deleteBackup(backupToDelete);
                    setNotification({ type: 'success', message: '备份已删除' });
                    fetchBackupHistory();
                  } catch (err: any) {
                    setNotification({ type: 'error', message: err.response?.data?.detail || '删除失败' });
                  } finally {
                    setBackupToDelete(null);
                  }
                }}
                className="flex-1 py-3 rounded-xl font-bold bg-red-500 hover:bg-red-600 text-white transition-all"
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Backup Delete All Confirm Modal */}
      {isDeletingAllBackups && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className={`${theme === 'light' ? 'bg-white' : 'bg-[#1c1c1e] text-white'} rounded-[32px] p-8 w-full max-w-md shadow-2xl scale-100 animate-in zoom-in-95 duration-200`}>
            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 bg-red-600 text-white rounded-full flex items-center justify-center shadow-lg shadow-red-500/30">
                <Trash2 size={24} />
              </div>
              <div>
                <h2 className="text-xl font-bold">清空所有备份？</h2>
                <p className={`text-sm ${theme === 'light' ? 'text-gray-500' : 'text-gray-400'}`}>这将删除本地存储的所有 {backupHistory.length} 个备份文件</p>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setIsDeletingAllBackups(false)}
                className={`flex-1 py-3 rounded-xl font-bold transition-all ${theme === 'light' ? 'bg-gray-100 text-gray-700 hover:bg-gray-200' : 'bg-white/10 text-gray-300 hover:bg-white/20'}`}
              >
                取消
              </button>
              <button
                onClick={async () => {
                  try {
                    await api.deleteAllBackups();
                    setNotification({ type: 'success', message: '所有备份已删除' });
                    fetchBackupHistory();
                  } catch (err: any) {
                    setNotification({ type: 'error', message: err.response?.data?.detail || '删除失败' });
                  } finally {
                    setIsDeletingAllBackups(false);
                  }
                }}
                className="flex-1 py-3 rounded-xl font-bold bg-red-600 hover:bg-red-700 text-white transition-all shadow-lg shadow-red-500/20"
              >
                确认全部删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const SidebarItem = ({ icon: Icon, label, active, onClick, theme }: any) => (
  <button onClick={onClick} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 font-medium text-sm ${active ? (theme === 'light' ? 'bg-white shadow-sm text-blue-600' : 'bg-white/10 shadow-sm text-blue-400') : (theme === 'light' ? 'text-gray-500 hover:bg-black/5 hover:text-gray-900' : 'text-gray-400 hover:bg-white/10 hover:text-white')}`}> 
    <Icon size={20} strokeWidth={active ? 2.5 : 2} /> 
    <span>{label}</span> 
    {active && <ChevronRight size={14} className="ml-auto opacity-50" />} 
  </button>
)

const StatCard = ({ label, value, icon: Icon, color, panelClass, theme }: any) => (
  <div className={`${panelClass} p-6 rounded-2xl flex items-center gap-4`}>
    <div className={`w-12 h-12 rounded-2xl ${color} flex items-center justify-center text-white shadow-lg`}><Icon size={24} /></div>
    <div> 
      <p className={`text-sm font-medium ${theme === 'light' ? 'text-gray-500' : 'text-gray-400'}`}>{label}</p> 
      <p className="text-2xl font-bold">{value}</p> 
    </div>
  </div>
)

const getScriptIcon = (path: string) => {
  if (path.endsWith('.py')) return <FileCode size={24} />;
  return <Terminal size={24} />;
}

const ScriptCard = ({ script, onRunToggle, onEdit, onDelete, onLog, onOpenEditor, panelClass, theme, viewMode = 'grid', isMultiSelectMode = false, isSelected = false, onSelect }: any) => {
  const [, setTick] = useState(0);

  // 每秒更新一次以刷新运行时长
  React.useEffect(() => {
    if (script.last_status !== 'running') return;

    const timer = setInterval(() => {
      setTick(t => t + 1);
    }, 1000);

    return () => clearInterval(timer);
  }, [script.last_status]);

  const duration = formatDuration(script.last_run, script.last_status === 'running');
  const scriptType = script.path.endsWith('.py') ? 'Python' : 'Shell';

  // 网格视图
  if (viewMode === 'grid') {
    return (
      <div className={`${panelClass} rounded-[24px] p-6 group transition-all duration-300 hover:-translate-y-1 hover:shadow-xl relative flex flex-col h-full ${isMultiSelectMode && isSelected ? (theme === 'light' ? 'ring-2 ring-blue-500 shadow-lg' : 'ring-2 ring-blue-400 shadow-lg shadow-blue-500/30') : ''}`}>
        {/* 多选复选框 - 左上角 */}
        {isMultiSelectMode && (
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => onSelect?.()}
            className="absolute top-4 left-4 w-5 h-5 z-10 cursor-pointer"
          />
        )}
        <div className="flex justify-between items-start mb-6">
          <div className="flex items-start gap-4 min-w-0 flex-1">
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-white shadow-lg flex-shrink-0 ${getIconColor(script.name)}`}>{getScriptIcon(script.path)}</div>
            <div className="min-w-0 flex-1">
              <h3 className="font-bold text-lg leading-tight mb-1 break-all line-clamp-2 h-[3rem]" title={script.name}>{script.name}</h3>
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">{script.cron === '@daemon' ? '常驻服务' : script.cron ? '定时任务' : '手动触发'}</p>
            </div>
          </div>
          <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-2">
            <button onClick={(e) => { e.stopPropagation(); onLog(); }} title="View Log" className={`p-2 rounded-full transition-colors ${theme === 'light' ? 'bg-blue-50 hover:bg-blue-100 text-blue-600' : 'bg-blue-500/10 hover:bg-blue-500/20 text-blue-400'}`}><FileText size={16} /></button>
            <button onClick={(e) => { e.stopPropagation(); onOpenEditor(); }} title="Edit Code" className={`p-2 rounded-full transition-colors ${theme === 'light' ? 'bg-indigo-50 hover:bg-indigo-100 text-indigo-600' : 'bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400'}`}><Code2 size={16} /></button>
            <button onClick={(e) => { e.stopPropagation(); onEdit(); }} title="Settings" className={`p-2 rounded-full transition-colors ${theme === 'light' ? 'bg-gray-100 hover:bg-gray-200 text-gray-600' : 'bg-white/10 hover:bg-white/20 text-gray-300'}`}><Edit2 size={16} /></button>
            <button onClick={(e) => { e.stopPropagation(); onDelete(); }} title="Delete" className={`p-2 rounded-full transition-colors ${theme === 'light' ? 'bg-red-50 hover:bg-red-100 text-red-500' : 'bg-red-500/10 hover:bg-red-500/20 text-red-400'}`}><Trash2 size={16} /></button>
          </div>
        </div>
        <div className="space-y-3 mb-6 flex-1">
          <div className={`flex items-center justify-between text-sm p-3 rounded-xl ${theme === 'light' ? 'bg-white/50' : 'bg-white/5'}`}>
            <div className="flex items-center gap-2 text-gray-500"><Clock size={16} /><span className="font-mono text-xs">{script.cron === '@daemon' ? 'Daemon' : (script.cron || 'N/A')}</span></div>
            {script.run_on_startup && <span title="定时脚本无需勾选，常驻后台脚本（如@daemon）建议开启" className="text-[10px] font-bold bg-purple-100 text-purple-600 px-2 py-0.5 rounded-full cursor-help">自启</span>}
          </div>
          <div className="flex items-center justify-between text-sm px-1">
            <div className="flex items-center gap-1.5">
              <div className={`w-2.5 h-2.5 rounded-full ${script.last_status === 'running' ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)] animate-pulse' : 'bg-gray-300'}`} />
              <span className={`font-medium ${getStatusColor(script.last_status)}`}>{script.last_status === 'success' ? '执行成功' : script.last_status === 'failed' ? '执行失败' : script.last_status === 'running' ? '运行中' : script.last_status === 'stopped' ? '已停止' : '未运行'}</span>
            </div>
            {duration && (
              <div className={`text-xs font-semibold px-3 py-1 rounded-full ${theme === 'light' ? 'bg-blue-50 text-blue-600' : 'bg-blue-500/20 text-blue-300'}`}>
                ⏱ {duration}
              </div>
            )}
          </div>
        </div>
        <div className={`flex items-center gap-3 pt-4 border-t mt-auto ${theme === 'light' ? 'border-gray-100' : 'border-white/5'}`}>
          <button onClick={(e) => { e.stopPropagation(); onRunToggle(); }} className={`w-full flex items-center justify-center gap-1.5 px-4 py-3 text-sm font-bold rounded-xl transition-all active:scale-95 ${theme === 'light' ? (script.last_status === 'running' ? 'bg-red-500 hover:bg-red-600 text-white' : 'bg-black text-white hover:bg-gray-800') : (script.last_status === 'running' ? 'bg-red-500 hover:bg-red-600 text-white' : 'bg-white text-black hover:bg-gray-200')}`}>
            {script.last_status === 'running' ? <Square size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
            <span>{script.last_status === 'running' ? 'STOP' : 'RUN'}</span>
          </button>
        </div>
      </div>
    );
  }

  // 表格视图
  return (
    <div className={`${panelClass} rounded-lg p-4 flex items-center gap-4 group transition-all duration-300 ${isMultiSelectMode && isSelected ? (theme === 'light' ? 'ring-2 ring-blue-500 shadow-lg' : 'ring-2 ring-blue-400 shadow-lg shadow-blue-500/30') : ''}`}>
      {/* 多选复选框 - 左侧 */}
      {isMultiSelectMode && (
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => onSelect?.()}
          className="w-5 h-5 flex-shrink-0 cursor-pointer"
        />
      )}

      {/* 脚本名称和类型 */}
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-white shadow-lg flex-shrink-0 ${getIconColor(script.name)}`}>{getScriptIcon(script.path)}</div>
        <div className="min-w-0 flex-1">
          <h3 className="font-bold break-all line-clamp-2 leading-tight" title={script.name}>{script.name}</h3>
          <p className="text-xs text-gray-500 truncate">{scriptType}</p>
        </div>
      </div>

      {/* 状态 */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <div className={`w-2.5 h-2.5 rounded-full ${script.last_status === 'running' ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)] animate-pulse' : 'bg-gray-300'}`} />
        <span className={`text-sm font-medium ${getStatusColor(script.last_status)}`}>{script.last_status === 'success' ? '成功' : script.last_status === 'failed' ? '失败' : script.last_status === 'running' ? '运行' : script.last_status === 'stopped' ? '停止' : '未运行'}</span>
      </div>

      {/* 运行时长 */}
      {duration && (
        <div className={`text-xs font-semibold px-2 py-1 rounded flex-shrink-0 ${theme === 'light' ? 'bg-blue-50 text-blue-600' : 'bg-blue-500/20 text-blue-300'}`}>
          ⏱ {duration}
        </div>
      )}

      {/* 最后运行时间 */}
      <div className={`text-xs whitespace-nowrap flex-shrink-0 ${theme === 'light' ? 'text-gray-500' : 'text-gray-400'}`}>
        {script.last_run ? new Date(script.last_run).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-'}
      </div>

      {/* 操作按钮 */}
      <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-1 flex-shrink-0">
        <button onClick={(e) => { e.stopPropagation(); onLog(); }} title="View Log" className={`p-1.5 rounded transition-colors ${theme === 'light' ? 'bg-blue-50 hover:bg-blue-100 text-blue-600' : 'bg-blue-500/10 hover:bg-blue-500/20 text-blue-400'}`}><FileText size={14} /></button>
        <button onClick={(e) => { e.stopPropagation(); onOpenEditor(); }} title="Edit Code" className={`p-1.5 rounded transition-colors ${theme === 'light' ? 'bg-indigo-50 hover:bg-indigo-100 text-indigo-600' : 'bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400'}`}><Code2 size={14} /></button>
        <button onClick={(e) => { e.stopPropagation(); onEdit(); }} title="Settings" className={`p-1.5 rounded transition-colors ${theme === 'light' ? 'bg-gray-100 hover:bg-gray-200 text-gray-600' : 'bg-white/10 hover:bg-white/20 text-gray-300'}`}><Edit2 size={14} /></button>
        <button onClick={(e) => { e.stopPropagation(); onRunToggle(); }} className={`p-1.5 rounded transition-colors font-bold text-sm ${theme === 'light' ? (script.last_status === 'running' ? 'bg-red-50 hover:bg-red-100 text-red-500' : 'bg-green-50 hover:bg-green-100 text-green-600') : (script.last_status === 'running' ? 'bg-red-500/10 hover:bg-red-500/20 text-red-400' : 'bg-green-500/10 hover:bg-green-500/20 text-green-400')}`}>{script.last_status === 'running' ? <Square size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}</button>
        <button onClick={(e) => { e.stopPropagation(); onDelete(); }} title="Delete" className={`p-1.5 rounded transition-colors ${theme === 'light' ? 'bg-red-50 hover:bg-red-100 text-red-500' : 'bg-red-500/10 hover:bg-red-500/20 text-red-400'}`}><Trash2 size={14} /></button>
      </div>
    </div>
  );
}

const InputGroup = ({ label, value, onChange, placeholder, type = 'text', theme, disabled }: any) => (
  <div className="w-full">
    {label && <label className={`block text-sm font-semibold mb-2 ml-1 ${theme === 'light' ? 'text-gray-700' : 'text-gray-300'}`}>{label}</label>}
    <input type={type} value={value} onChange={e => onChange(e.target.value)} disabled={disabled} className={`w-full p-4 rounded-2xl border-none ring-1 focus:ring-2 focus:ring-blue-500 outline-none transition-all font-medium ${theme === 'light' ? (disabled ? 'bg-gray-100 text-gray-400 ring-gray-200' : 'bg-gray-50 ring-gray-200') : (disabled ? 'bg-white/5 text-gray-500 ring-white/5' : 'bg-white/5 ring-white/10 text-white')}`} placeholder={placeholder} />
  </div>
)

const getIconColor = (name: string) => {
  const colors = ['bg-blue-500', 'bg-purple-500', 'bg-indigo-500', 'bg-pink-500', 'bg-teal-500', 'bg-orange-500'];
  return colors[(name?.length || 0) % colors.length];
}

const formatDuration = (startTime: string | null, isRunning: boolean) => {
  if (!startTime || !isRunning) return null;

  const start = new Date(startTime).getTime();
  const now = new Date().getTime();
  const diff = Math.floor((now - start) / 1000); // 秒数

  if (diff < 0) return null;

  const days = Math.floor(diff / 86400);
  const hours = Math.floor((diff % 86400) / 3600);
  const minutes = Math.floor((diff % 3600) / 60);
  const seconds = diff % 60;

  if (days > 0) {
    return `${days}天${hours}小时${minutes}分钟`;
  } else if (hours > 0) {
    return `${hours}小时${minutes}分钟${seconds}秒`;
  } else if (minutes > 0) {
    return `${minutes}分钟${seconds}秒`;
  } else {
    return `${seconds}秒`;
  }
}

const getStatusColor = (status: string | null) => {
  if (status === 'success') return 'text-green-600';
  if (status === 'failed') return 'text-red-600';
  if (status === 'running') return 'text-green-600';
  return 'text-gray-400';
}

const Notification = ({ type, message, onClose }: { type: 'success' | 'error', message: string, onClose: () => void }) => {
  React.useEffect(() => {
    const timer = setTimeout(() => {
      onClose();
    }, 2000);
    return () => clearTimeout(timer);
  }, []);

  const bgColor = type === 'success' ? 'bg-green-500' : 'bg-red-500';
  const icon = type === 'success' ? <CheckCircle2 size={18} /> : <XCircle size={18} />;

  return (
    <div className={`fixed top-6 right-6 ${bgColor} text-white px-4 py-3 rounded-lg shadow-lg flex items-center gap-2 z-50 animate-in slide-in-from-top-4 fade-in duration-300`}>
      {icon}
      <span className="font-medium">{message}</span>
    </div>
  );
}

export default App
