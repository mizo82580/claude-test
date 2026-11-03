const { contextBridge, ipcRenderer } = require('electron');

const call = async (channel, ...args) => {
  const r = await ipcRenderer.invoke(channel, ...args);
  if (!r.ok) throw new Error(r.error);
  return r.data;
};

contextBridge.exposeInMainWorld('botApi', {
  info: () => call('app:info'),
  getSettings: () => call('settings:get'),
  saveSettings: (payload) => call('settings:save', payload),
  start: () => call('bot:start'),
  stop: () => call('bot:stop'),
  snapshot: () => call('bot:snapshot'),
  sell: (mint) => call('bot:sell', mint),
  sellAll: () => call('bot:sellAll'),
  trades: () => call('trades:list'),
  logHistory: () => call('logs:history'),
  resetPaper: () => call('paper:reset'),
  openUrl: (url) => call('shell:open', url),
  openDataFolder: () => call('shell:openData'),
  onLog: (cb) => {
    const h = (_e, batch) => cb(batch);
    ipcRenderer.on('log', h);
    return () => ipcRenderer.removeListener('log', h);
  },
});
