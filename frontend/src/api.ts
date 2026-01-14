import axios from 'axios';

const api = axios.create({
  baseURL: `/api`,
});

export const getScripts = () => api.get('/scripts');
export const createScript = (data: any) => api.post('/scripts', data);
export const updateScript = (id: number, data: any) => api.put(`/scripts/${id}`, data);
export const deleteScript = (id: number) => api.delete(`/scripts/${id}`);
export const runScript = (id: number) => api.post(`/scripts/${id}/run`);
export const stopScript = (id: number) => api.post(`/scripts/${id}/stop`);
export const scanScripts = () => api.post('/scan');
export const getScriptContent = (id: number) => api.get(`/scripts/${id}/content`);
export const updateScriptContent = (id: number, content: string) => api.put(`/scripts/${id}/content`, { content });

export const uploadFile = (file: File) => {
  const formData = new FormData();
  formData.append('file', file);
  return api.post('/upload', formData);
};

export const testTgConnection = (token: string, chatId: string, proxy: string) => api.post('/test-tg', { token, chat_id: chatId, proxy });

export const saveSettings = (key: string, value: string) => api.post('/settings', { key, value });
export const applySettings = () => api.post('/settings/apply');
export const getSettings = () => api.get('/settings');

// 备份相关API
export const manualBackup = (scriptIds?: number[], backupType: 'local' | 'clouddrive' = 'local') => 
  api.post('/backup/manual', { script_ids: scriptIds, backup_type: backupType });
export const backupSingleScript = (scriptId: number) => api.post(`/backup/script/${scriptId}`);
export const getBackupConfig = () => api.get('/backup/config');
export const saveBackupConfig = (config: any) => api.post('/backup/config', config);
export const testCloudDrive = (webdavUrl: string, username: string, password: string) =>
  api.post('/backup/test-clouddrive', { webdav_url: webdavUrl, username, password });
export const applyBackupSchedule = () => api.post('/backup/apply-schedule');
export const getBackupHistory = () => api.get('/backup/history');
export const downloadBackup = (filename: string) => {
  window.open(`/api/backup/download/${filename}`, '_blank');
};
export const deleteBackup = (filename: string) => api.delete(`/backup/${filename}`);
export const deleteAllBackups = () => api.delete('/backup');
export const uploadAndRestore = (file: File) => {
  const formData = new FormData();
  formData.append('file', file);
  return api.post('/backup/upload-restore', formData);
};

export default api;