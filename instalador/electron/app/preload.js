// Ponte entre a página do NovaCut e o programa (processo principal)
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const info = ipcRenderer.sendSync('novacut:info');
contextBridge.exposeInMainWorld('NOVACUT_HOST', info.host);
contextBridge.exposeInMainWorld('NOVACUT_SYS', info.sys);
if (info.test) contextBridge.exposeInMainWorld('NOVACUT_TEST', true);
contextBridge.exposeInMainWorld('novacutHost', {
  postMessage: msg => ipcRenderer.send('novacut:msg', msg),
  memory: () => ipcRenderer.invoke('novacut:memory'),      // RAM used by all NovaCut processes
  pathOf: file => { try { return webUtils.getPathForFile(file) || ''; } catch { return ''; } },   // where an imported file is on disk
  reveal: p => ipcRenderer.send('novacut:reveal', String(p)),   // "Revelar no Explorer"
  exportDir: (op, p) => ipcRenderer.invoke('novacut:exportdir', op || 'get', p),   // export folder: get / pick / reset / open
  saveMedia: (kind, name, data) => ipcRenderer.invoke('novacut:savemedia', kind, name, data),   // captures and recordings into Imagens/Vídeos/Música\NovaCut
  // media relink: check paths, pick a folder, search it, read a found file in parts
  fs: {
    stat: list => ipcRenderer.invoke('novacut:fs-stat', list),
    pickDir: () => ipcRenderer.invoke('novacut:fs-pickdir'),
    scan: (dir, names, sizes) => ipcRenderer.invoke('novacut:fs-scan', dir, names, sizes),
    read: (p, off, len) => ipcRenderer.invoke('novacut:fs-read', p, off, len),
    hash: p => ipcRenderer.invoke('novacut:fs-hash', p)
  }
});
