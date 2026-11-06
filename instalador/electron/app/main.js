// NovaCut 2: o programa leva o próprio motor (Chromium via Electron) e não depende do Edge/WebView2 do Windows
const { app, BrowserWindow, Menu, ipcMain, session, shell, desktopCapturer, dialog, protocol } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { Readable } = require('stream');
// ncmedia://f/<path>: the editor reads imported files straight from their folder (by parts, with byte ranges), like Filmora,
// instead of keeping a copy of each one inside the app
protocol.registerSchemesAsPrivileged([{ scheme: 'ncmedia', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true, bypassCSP: true } }]);
const { execFile, execFileSync } = require('child_process');

const VERSION = require('./package.json').version;     // one version for everything: package.json
const IS_WIN = process.platform === 'win32';
const appDir = __dirname;                                   // resources/app (a página e os módulos)
// Windows: everything next to the program (installed in the user's own folder). Linux: the program is in /opt (read-only),
// so projects, settings and the log go to ~/.config/NovaCut
const dir = IS_WIN ? path.dirname(process.execPath) : path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'NovaCut');
try { fs.mkdirSync(dir, { recursive: true }); } catch {}
const dataDir = path.join(dir, 'dados-app');                // projetos e mídias guardados pelo app
const logPath = path.join(dir, 'novacut.log');
const cfgPath = path.join(dir, 'config.txt');
const testScript = process.env.NOVACUT_TEST_SCRIPT;

function log(msg) {
  try {
    if (fs.existsSync(logPath) && fs.statSync(logPath).size > 2e6) fs.unlinkSync(logPath);
    fs.appendFileSync(logPath, new Date().toTimeString().slice(0, 8) + ' ' + msg + '\n');
  } catch {}
}

function readConfig() {
  const c = { gpu: 'auto', hwRender: '1', hwDecode: '1' };
  try { for (const line of fs.readFileSync(cfgPath, 'utf8').split(/\r?\n/)) { const i = line.indexOf('='); if (i > 0) c[line.slice(0, i).trim()] = line.slice(i + 1).trim(); } } catch {}
  return c;
}
const cfg = readConfig();

// projetos e mídias da versão anterior (motor WebView2, ou a janela do Edge) passam para o motor novo uma única vez
function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name), b = path.join(to, e.name);
    if (e.isDirectory()) copyDir(a, b); else fs.copyFileSync(a, b);
  }
}
function migrate() {
  try {
    if (fs.existsSync(path.join(dataDir, 'IndexedDB'))) return;
    for (const src of [path.join(dir, 'dados', 'EBWebView', 'Default'), path.join(dir, 'perfil', 'Default')]) {
      if (!fs.existsSync(path.join(src, 'IndexedDB'))) continue;
      for (const sub of ['IndexedDB', 'Local Storage']) if (fs.existsSync(path.join(src, sub))) copyDir(path.join(src, sub), path.join(dataDir, sub));
      log('projetos migrados de ' + src);
      return;
    }
  } catch (e) { log('migração: ' + e.message); }
}

// placa de vídeo: preferência do Windows para o próprio NovaCut.exe + opções do motor
function applyGpuPreference() {
  if (!app.isPackaged || !IS_WIN) return;   // on Linux the engine switches below choose the card
  const key = 'HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences', exe = process.execPath;
  const pref = cfg.gpu === 'high' ? 'GpuPreference=2;' : cfg.gpu === 'low' ? 'GpuPreference=1;' : null;
  const args = pref ? ['add', key, '/v', exe, '/t', 'REG_SZ', '/d', pref, '/f'] : ['delete', key, '/v', exe, '/f'];
  execFile('reg.exe', args, { windowsHide: true }, () => {});
}
if (cfg.gpu === 'high') app.commandLine.appendSwitch('force_high_performance_gpu');
else if (cfg.gpu === 'low') app.commandLine.appendSwitch('force_low_power_gpu');
if (cfg.hwRender === '0') app.disableHardwareAcceleration();
if (cfg.hwDecode === '0') app.commandLine.appendSwitch('disable-accelerated-video-decode');
// exportar com a janela minimizada continua na velocidade normal
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// installer check (--novacut-check=<file>): opens the editor hidden, with empty data of its own (the user's projects are not touched),
// waits for it to start and writes "ok <version>" in <file>. The installer only replaces the old version after this passes.
const checkArg = process.argv.find(a => a.startsWith('--novacut-check='));
const checkFile = checkArg ? checkArg.slice('--novacut-check='.length) : '';
const checkData = checkFile ? fs.mkdtempSync(path.join(os.tmpdir(), 'novacut-check-')) : '';
app.setPath('userData', checkFile ? checkData : dataDir);
if (IS_WIN) app.setAppUserModelId('NovaCut.Editor');
function endCheck(ok, why) { try { fs.writeFileSync(checkFile, (ok ? 'ok ' : 'falhou ') + VERSION + (why ? ' ' + why : '')); } catch {} setTimeout(() => { try { fs.rmSync(checkData, { recursive: true, force: true }); } catch {} app.exit(ok ? 0 : 1); }, 300); }
// after the first normal start of a new version, the copy of the previous version kept by the installer is no longer needed
function dropPrevious() { const prev = path.join(path.dirname(dir), 'NovaCut-anterior'); if (!checkFile && fs.existsSync(prev)) fs.rm(prev, { recursive: true, force: true }, err => log(err ? 'cópia da versão anterior: ' + err.message : 'cópia da versão anterior removida (a ' + VERSION + ' abriu normalmente)')); }

// lista das placas de vídeo para Preferências (guardada para abrir rápido)
const gpuCache = path.join(dir, 'gpus.json');
function gpuList() {
  try { return JSON.parse(fs.readFileSync(gpuCache, 'utf8')); } catch {}
  if (!IS_WIN) {   // Linux: the video cards listed by lspci (when available)
    try { const list = execFileSync('lspci', [], { timeout: 5000 }).toString().split('\n').filter(l => /VGA|3D controller|Display controller/i.test(l)).map(l => ({ name: l.replace(/^\S+\s+[^:]+:\s*/, ''), driver: '', ram: 0 })); fs.writeFileSync(gpuCache, JSON.stringify(list)); return list; } catch { return []; }
  }
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', 'Get-CimInstance Win32_VideoController | Select-Object Name,DriverVersion,AdapterRAM | ConvertTo-Json -Compress'], { windowsHide: true, timeout: 8000 }).toString();
    const list = [].concat(JSON.parse(out)).map(g => ({ name: g.Name, driver: g.DriverVersion, ram: Number(g.AdapterRAM) || 0 }));
    fs.writeFileSync(gpuCache, JSON.stringify(list)); return list;
  } catch { return []; }
}

if (!checkFile && !app.requestSingleInstanceLock()) { app.quit(); }
let win = null, restarting = false;
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

ipcMain.on('novacut:info', e => {
  e.returnValue = { host: { version: VERSION, engine: 'Chromium ' + process.versions.chrome, shell: 'electron' }, sys: { gpus: gpuList(), cfg }, test: !!(testScript && fs.existsSync(testScript)) };
});
// memory monitor: working set of every NovaCut process (window, GPU, audio...) and the computer's total RAM
ipcMain.handle('novacut:memory', () => {
  const used = app.getAppMetrics().reduce((s, p) => s + (p.memory ? p.memory.workingSetSize : 0), 0) * 1024;
  return { used, total: os.totalmem(), free: os.freemem() };
});
// frame captures go to Imagens\NovaCut, screen/webcam recordings to Vídeos\NovaCut, voiceovers to Música\NovaCut (like Filmora's own folders)
ipcMain.handle('novacut:savemedia', (e, kind, name, data) => {
  const where = { pictures: 'pictures', videos: 'videos', music: 'music' }[kind]; if (!where || !(data instanceof ArrayBuffer || ArrayBuffer.isView(data))) return '';
  const dir = path.join(app.getPath(where), 'NovaCut'); fs.mkdirSync(dir, { recursive: true });
  const clean = path.basename(String(name || 'arquivo')).replace(/[\\/:*?"<>|]/g, '_').slice(0, 150) || 'arquivo', ext = path.extname(clean), base = clean.slice(0, clean.length - ext.length);
  let p = path.join(dir, clean), n = 1; while (fs.existsSync(p)) p = path.join(dir, `${base} (${n++})${ext}`);
  fs.writeFileSync(p, Buffer.from(data instanceof ArrayBuffer ? data : data.buffer)); log('salvo em ' + p); return p;
});
// exported files go to the chosen export folder (default: the user's Videos folder); kept in config.txt with the other settings
function writeConfig() { try { fs.writeFileSync(cfgPath, Object.entries(cfg).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}=${v}`).join('\n') + '\n'); } catch (err) { log('config: ' + err.message); } }
function exportDir() { const d = cfg.exportDir; try { if (d && fs.statSync(d).isDirectory()) return d; } catch {} return app.getPath('videos'); }
ipcMain.handle('novacut:exportdir', async (e, op, p) => {
  if (op === 'pick') { const r = await dialog.showOpenDialog(win, { title: 'Pasta de exportação', defaultPath: exportDir(), properties: ['openDirectory', 'createDirectory'] }); if (r.canceled || !r.filePaths[0]) return exportDir(); cfg.exportDir = r.filePaths[0]; writeConfig(); log('pasta de exportação: ' + cfg.exportDir); }
  else if (op === 'reset') { delete cfg.exportDir; writeConfig(); }
  else if (op === 'open') { shell.openPath(exportDir()); }
  return exportDir();
});
// media relink: only media files (by extension) can be looked at or read, and only as parts of up to 64 MB
const MEDIA_EXT = /\.(mp4|mov|m4v|mkv|webm|avi|wmv|flv|mts|m2ts|ts|3gp|mp3|wav|m4a|aac|flac|ogg|opus|wma|png|jpe?g|gif|bmp|webp|tiff?|heic)$/i;
const okMedia = p => typeof p === 'string' && path.isAbsolute(p) && MEDIA_EXT.test(p);
ipcMain.handle('novacut:fs-stat', (e, list) => (Array.isArray(list) ? list.slice(0, 5000) : []).map(p => { try { if (!okMedia(p)) return { exists: false }; const s = fs.statSync(p); return { exists: s.isFile(), size: s.size, mtime: s.mtimeMs }; } catch { return { exists: false }; } }));
ipcMain.handle('novacut:fs-pickdir', async () => { const r = await dialog.showOpenDialog(win, { title: 'Onde procurar as mídias (pasta ou unidade)', properties: ['openDirectory'] }); return r.canceled || !r.filePaths[0] ? '' : r.filePaths[0]; });
// walks the folder and all subfolders (skipping Windows' own folders) and returns the media files whose name or size match
ipcMain.handle('novacut:fs-scan', async (e, root, names, sizes) => {
  const want = new Set((names || []).map(n => String(n).toLowerCase())), sz = new Set((sizes || []).map(Number)), files = [], t0 = Date.now();
  const SKIP = /^(windows|\$recycle\.bin|system volume information|programdata|appdata|node_modules|\.git|program files( \(x86\))?|proc|sys|dev|run|snap|lost\+found|\.cache|\.local|\.npm|\.cargo|\.rustup|flatpak)$/i;   // system folders of Windows and Linux
  let seen = 0, stopped = false; const stack = [String(root || '')];
  if (!stack[0] || !path.isAbsolute(stack[0])) return { files, seen, stopped };
  while (stack.length) {
    if (Date.now() - t0 > 90000 || seen > 2e6) { stopped = true; break; }
    const d = stack.pop(); let ents; try { ents = await fs.promises.readdir(d, { withFileTypes: true }); } catch { continue; }
    for (const en of ents) {
      const p = path.join(d, en.name);
      if (en.isDirectory()) { if (!SKIP.test(en.name)) stack.push(p); continue; }
      if (!en.isFile() || !MEDIA_EXT.test(en.name)) continue; seen++;
      const nm = want.has(en.name.toLowerCase()); let size = -1;
      if (nm || sz.size) { try { size = (await fs.promises.stat(p)).size; } catch { continue; } }
      if (nm || sz.has(size)) files.push({ path: p, size });
      if (files.length > 20000) { stopped = true; break; }
    }
  }
  log(`busca de mídias em ${root}: ${seen} arquivos, ${files.length} candidatos${stopped ? ' (parou no limite)' : ''}`);
  return { files, seen, stopped };
});
// SHA-256 of a whole media file, read as a stream (strong check for the relink; a few seconds per GB)
ipcMain.handle('novacut:fs-hash', (e, p) => new Promise((res, rej) => {
  if (!okMedia(p)) return rej(new Error('arquivo não permitido'));
  const h = require('crypto').createHash('sha256'), s = fs.createReadStream(p, { highWaterMark: 4 << 20 });
  s.on('data', d => h.update(d)); s.on('error', rej); s.on('end', () => res('h:' + h.digest('hex').slice(0, 40)));
}));
ipcMain.handle('novacut:fs-read', async (e, p, off, len) => {
  if (!okMedia(p)) throw new Error('arquivo não permitido'); len = Math.max(0, Math.min(Number(len) || 0, 64 << 20)); off = Math.max(0, Number(off) || 0);
  const fh = await fs.promises.open(p, 'r'); try { const b = Buffer.alloc(len); const { bytesRead } = await fh.read(b, 0, len, off); return b.buffer.slice(b.byteOffset, b.byteOffset + bytesRead); } finally { await fh.close(); }
});
// show an imported file selected in Windows Explorer (only real, existing files)
ipcMain.on('novacut:reveal', (e, p) => { try { if (typeof p === 'string' && path.isAbsolute(p) && fs.existsSync(p) && fs.statSync(p).isFile()) shell.showItemInFolder(p); } catch {} });
ipcMain.on('novacut:msg', (e, m) => {
  if (!m || typeof m !== 'object') return;
  if (m.type === 'log') log(String(m.msg));
  else if (m.type === 'booted') { if (checkFile) endCheck(true); else { log('NovaCut ' + VERSION + ' aberto'); dropPrevious(); } }
  else if (m.type === 'mute') { win.webContents.setAudioMuted(!!m.on); log('som do app ' + (m.on ? 'desligado (exportando)' : 'ligado')); }
  else if (m.type === 'config') {
    cfg.gpu = ['auto', 'high', 'low'].includes(m.gpu) ? m.gpu : 'auto'; cfg.hwRender = m.hwRender === '0' ? '0' : '1'; cfg.hwDecode = m.hwDecode === '0' ? '0' : '1'; writeConfig();
  }
  else if (m.type === 'restart') { restarting = true; app.relaunch(); app.exit(0); }
  else if (m.type === 'quit') win.close();
});

app.whenReady().then(() => {
  if (!checkFile) {
    migrate(); applyGpuPreference();
    // leftovers of installer checks (their files were still in use when the check closed)
    try { for (const n of fs.readdirSync(os.tmpdir())) if (n.startsWith('novacut-check-')) fs.rm(path.join(os.tmpdir(), n), { recursive: true, force: true }, () => {}); } catch {}
  }
  Menu.setApplicationMenu(null);
  const ses = session.defaultSession;
  // serves media files (only media extensions) with byte ranges, so video players and the export read just what they need
  const MIME = { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', mkv: 'video/x-matroska', webm: 'video/webm', avi: 'video/x-msvideo', wmv: 'video/x-ms-wmv', ts: 'video/mp2t', mts: 'video/mp2t', m2ts: 'video/mp2t', '3gp': 'video/3gpp', flv: 'video/x-flv', mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', ogg: 'audio/ogg', opus: 'audio/ogg', wma: 'audio/x-ms-wma', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp', tif: 'image/tiff', tiff: 'image/tiff', heic: 'image/heic' };
  const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Range', 'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges' };
  protocol.handle('ncmedia', async req => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    let p; try { p = decodeURIComponent(new URL(req.url).pathname.slice(1)); } catch { return new Response('', { status: 400, headers: CORS }); }
    if (!okMedia(p)) return new Response('', { status: 403, headers: CORS });
    let st; try { st = await fs.promises.stat(p); if (!st.isFile()) throw 0; } catch { return new Response('', { status: 404, headers: CORS }); }
    const size = st.size, type = MIME[path.extname(p).slice(1).toLowerCase()] || 'application/octet-stream', rg = /bytes=(\d*)-(\d*)/.exec(req.headers.get('range') || '');
    let a = 0, b = size - 1, status = 200;
    if (rg) { status = 206; if (rg[1] === '') a = Math.max(0, size - Number(rg[2] || 0)); else { a = Number(rg[1]); if (rg[2] !== '') b = Math.min(size - 1, Number(rg[2])); } }
    if (size === 0 || a > b || a >= size) return new Response(size === 0 && !rg ? new Uint8Array(0) : null, { status: size === 0 && !rg ? 200 : 416, headers: { ...CORS, 'Content-Range': `bytes */${size}` } });
    const body = Readable.toWeb(fs.createReadStream(p, { start: a, end: b }));
    return new Response(body, { status, headers: { ...CORS, 'Content-Type': type, 'Content-Length': String(b - a + 1), 'Accept-Ranges': 'bytes', ...(status === 206 ? { 'Content-Range': `bytes ${a}-${b}/${size}` } : {}) } });
  });

  // cada exportação vai direto para a pasta Downloads, sem perguntar, com nome único
  ses.on('will-download', (e, item) => {
    const dl = exportDir(), ext = path.extname(item.getFilename()), base = path.basename(item.getFilename(), ext);
    let p = path.join(dl, base + ext), n = 1; while (fs.existsSync(p)) p = path.join(dl, `${base} (${n++})${ext}`);
    item.setSavePath(p); log('salvando ' + p);
    item.once('done', (ev, state) => log('download ' + path.basename(p) + ': ' + state));
  });
  // gravar a tela: tela inteira com o som do computador
  ses.setDisplayMediaRequestHandler((req, cb) => {
    desktopCapturer.getSources({ types: ['screen'] }).then(s => cb(s.length ? { video: s[0], audio: 'loopback' } : {})).catch(() => cb({}));
  });

  win = new BrowserWindow({
    width: 1440, height: 900, show: false, backgroundColor: '#121418', title: 'NovaCut', icon: path.join(appDir, IS_WIN ? 'novacut.ico' : 'novacut.png'),
    webPreferences: { preload: path.join(appDir, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, spellcheck: false }
  });
  // closing the window: the editor first finishes the saves in progress (and saves pending changes), at most 4 s
  // the window closes only after the editor confirms everything was written; if not, you decide (try again, close anyway, or stay)
  let allowClose = false, closing = false;
  const ask = (message, detail, buttons) => dialog.showMessageBoxSync(win, { type: 'warning', title: 'NovaCut', message, detail, buttons, defaultId: 0, cancelId: buttons.length - 1, noLink: true });
  const flush = force => Promise.race([win.webContents.executeJavaScript(`window.__ncFlush ? window.__ncFlush(${force ? 'true' : 'false'}) : ({ ok: true })`).catch(e => ({ ok: false, reason: 'save', msg: e.message })), new Promise(r => setTimeout(() => r({ ok: false, reason: 'slow' }), 8000))]);
  const finish = () => { allowClose = true; try { win.close(); } catch {} };
  async function tryClose(force) {
    const r = await flush(force);
    if (r && r.ok) return finish();
    if (r && r.reason === 'unsaved') { const b = ask('Salvar as alterações do projeto antes de fechar?', 'O salvamento automático está desligado.', ['Salvar', 'Não salvar', 'Cancelar']); if (b === 0) return tryClose(true); if (b === 1) { await win.webContents.executeJavaScript('window.__ncClean && window.__ncClean()').catch(() => {}); log('fechar: sem salvar (escolha do usuário)'); return finish(); } closing = false; return; }
    const slow = r && r.reason === 'slow'; log('fechar: ' + (slow ? 'salvamento ainda em andamento após 8 s' : 'falha ao salvar ' + ((r && r.msg) || '')));
    const b = ask(slow ? 'O projeto ainda está sendo salvo.' : 'Não foi possível salvar o projeto.', slow ? 'Pode esperar mais um pouco ou fechar assim mesmo (a próxima abertura oferece a recuperação).' : 'Tente de novo. Se fechar assim mesmo, a próxima abertura oferece o último salvamento bom.', [slow ? 'Esperar' : 'Tentar de novo', 'Fechar assim mesmo', 'Cancelar']);
    if (b === 0) return tryClose(true);
    if (b === 1) return finish();
    closing = false;
  }
  win.on('close', e => {
    if (allowClose || checkFile || win.webContents.isCrashed()) return;
    e.preventDefault(); if (closing) return; closing = true; tryClose(false);
  });
  if (checkFile) { setTimeout(() => endCheck(false, 'tempo esgotado'), 60000); win.webContents.on('render-process-gone', (e, d) => endCheck(false, d.reason)); }
  else { win.maximize(); win.show(); }
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); } });
  win.webContents.on('will-prevent-unload', e => e.preventDefault());   // o projeto já é salvo sozinho
  win.webContents.on('render-process-gone', (e, d) => log('processo da página parou: ' + d.reason));
  if (!checkFile && testScript && fs.existsSync(testScript)) {
    const code = fs.readFileSync(testScript, 'utf8');
    win.webContents.on('did-finish-load', () => setTimeout(() => win.webContents.executeJavaScript(code).catch(err => log('teste: ' + err.message)), 2500));
  }
  win.loadFile(path.join(appDir, 'NovaCut.html'), { query: { gpu: cfg.gpu, hwr: cfg.hwRender, hwd: cfg.hwDecode } });
});
app.on('window-all-closed', () => app.quit());
