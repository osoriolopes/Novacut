# Builds the Linux packages of NovaCut from the official Electron (linux-x64) zip and the app files:
#   novacut_<ver>_amd64.deb            (Ubuntu, Debian, Mint, Pop!_OS, Zorin, elementary...)
#   NovaCut-<ver>-linux-x64.tar.gz     (any distribution: ./instalar.sh)
import sys, os, io, json, gzip, tarfile, zipfile, time, glob, stat

root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
app_src = os.path.join(root, 'electron', 'app')
html = os.path.join(root, 'src', 'NovaCut.html')
libs = sorted(glob.glob(os.path.join(root, 'src', 'libs', '*.js')))
zip_path = os.path.join(root, 'electron', 'vendor', 'electron-v45.2.1-linux-x64.zip')
out_dir = os.path.expanduser(r'~\Documents\NovaCut\linux')
ver = json.load(open(os.path.join(app_src, 'package.json'), encoding='utf-8'))['version']
assert f"const APP_VERSION = '{ver}'" in open(html, encoding='utf-8').read(), 'NovaCut.html com outra versão'
os.makedirs(out_dir, exist_ok=True)
NOW = int(time.time())
KEEP_LOCALES = {'pt-BR.pak', 'en-US.pak'}

# ---- the program files: (relative path, bytes or None for dir, mode, symlink target)
files = []
with zipfile.ZipFile(zip_path) as z:
    for info in z.infolist():
        n = info.filename
        if n.endswith('/'): continue
        if n == 'resources/default_app.asar': continue
        if n.startswith('locales/') and os.path.basename(n) not in KEEP_LOCALES: continue
        mode = (info.external_attr >> 16) & 0o7777 or 0o644
        if n == 'electron': n = 'novacut'; mode = 0o755
        files.append((n, z.read(info), mode))
def add(rel, path=None, data=None, mode=0o644):
    files.append((rel, data if data is not None else open(path, 'rb').read(), mode))
for f in ['package.json', 'main.js', 'preload.js', 'novacut.png']: add('resources/app/' + f, os.path.join(app_src, f))
add('resources/app/NovaCut.html', html)
for l in libs: add('resources/app/libs/' + os.path.basename(l), l)
assert any(f[0] == 'novacut' for f in files), 'binário do Electron não encontrado no zip'

LAUNCHER = b'''#!/bin/sh
# NovaCut: opens the editor. With the sandbox helper installed by root (package or "sudo ./instalar.sh") the Chromium
# sandbox stays on; in an install without root it starts without it (as AppImages do).
D="$(dirname "$(readlink -f "$0")")"
S="$D/chrome-sandbox"
if [ -u "$S" ] && [ "$(stat -c %u "$S")" = "0" ]; then exec "$D/novacut" "$@"; fi
exec "$D/novacut" --no-sandbox "$@"
'''
add('novacut-launcher', data=LAUNCHER, mode=0o755)

MIME = 'video/mp4;video/quicktime;video/x-matroska;video/webm;video/x-msvideo;audio/mpeg;audio/wav;audio/x-wav;audio/mp4;audio/flac;audio/ogg;image/png;image/jpeg;'
def desktop(execp):
    return f'''[Desktop Entry]
Type=Application
Name=NovaCut
GenericName=Editor de vídeo
Comment=Edite vídeos com linha do tempo, efeitos, cor, áudio e legendas
Exec={execp} %F
Icon=novacut
Terminal=false
Categories=AudioVideo;Video;AudioVideoEditing;
MimeType={MIME}
StartupWMClass=NovaCut
Keywords=video;editor;edição;vídeo;filmora;
'''.encode('utf-8')

def tinfo(name, size=0, mode=0o644, kind=tarfile.REGTYPE, link=''):
    ti = tarfile.TarInfo(name); ti.size = size; ti.mode = mode; ti.type = kind; ti.linkname = link
    ti.uid = ti.gid = 0; ti.uname = ti.gname = 'root'; ti.mtime = NOW; return ti

def dirs_of(paths):
    out = set()
    for p in paths:
        parts = p.strip('/').split('/')[:-1]
        for i in range(1, len(parts) + 1): out.add('/'.join(parts[:i]))
    return sorted(out, key=lambda d: (d.count('/'), d))

# ================= .deb =================
deb_entries = [('opt/novacut/' + n, d, m) for n, d, m in files]
deb_entries.append(('usr/share/applications/novacut.desktop', desktop('/opt/novacut/novacut-launcher'), 0o644))
deb_entries.append(('usr/share/icons/hicolor/256x256/apps/novacut.png', open(os.path.join(app_src, 'novacut.png'), 'rb').read(), 0o644))
deb_entries = [(n, d, (0o4755 if n.endswith('/chrome-sandbox') else m)) for n, d, m in deb_entries]
data_buf = io.BytesIO()
with tarfile.open(fileobj=data_buf, mode='w:gz', format=tarfile.GNU_FORMAT) as t:
    for d in dirs_of([e[0] for e in deb_entries] + ['usr/bin/novacut']): t.addfile(tinfo('./' + d + '/', mode=0o755, kind=tarfile.DIRTYPE))
    for n, d, m in deb_entries: t.addfile(tinfo('./' + n, len(d), m), io.BytesIO(d))
    t.addfile(tinfo('./usr/bin/novacut', kind=tarfile.SYMTYPE, mode=0o777, link='/opt/novacut/novacut-launcher'))
inst_kb = sum(len(d) for _, d, _ in deb_entries) // 1024 + 1
control = f'''Package: novacut
Version: {ver}
Architecture: amd64
Maintainer: NovaCut <novacut@localhost>
Installed-Size: {inst_kb}
Depends: libgtk-3-0 | libgtk-3-0t64, libnss3, libasound2 | libasound2t64, libgbm1, libxss1, libxtst6, libnotify4, libsecret-1-0, libdrm2, libxkbcommon0, xdg-utils
Section: video
Priority: optional
Description: NovaCut - editor de vídeo
 Editor de vídeo com linha do tempo, clipes compostos, multicâmera, máscaras com
 rotoscopia, correção de cor (rodas, curvas, HSL, LUT, log da câmera para Rec.709),
 áudio profissional (loudness LUFS, de-esser, multibanda), legendas animadas e
 exportação em MP4, MKV, WEBM, GIF, MP3 e WAV.
'''.encode('utf-8')
postinst = b'''#!/bin/sh
set -e
chown root:root /opt/novacut/chrome-sandbox 2>/dev/null || true
chmod 4755 /opt/novacut/chrome-sandbox 2>/dev/null || true
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database -q /usr/share/applications || true
command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor || true
exit 0
'''
postrm = b'''#!/bin/sh
set -e
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database -q /usr/share/applications || true
exit 0
'''
ctl_buf = io.BytesIO()
with tarfile.open(fileobj=ctl_buf, mode='w:gz', format=tarfile.GNU_FORMAT) as t:
    t.addfile(tinfo('./', mode=0o755, kind=tarfile.DIRTYPE))
    for n, d, m in [('control', control, 0o644), ('postinst', postinst, 0o755), ('postrm', postrm, 0o755)]: t.addfile(tinfo('./' + n, len(d), m), io.BytesIO(d))
def ar_member(name, data):
    h = name.ljust(16).encode() + str(NOW).ljust(12).encode() + b'0'.ljust(6) + b'0'.ljust(6) + b'100644'.ljust(8) + str(len(data)).ljust(10).encode() + b'`\n'
    assert len(h) == 60
    return h + data + (b'\n' if len(data) % 2 else b'')
deb_path = os.path.join(out_dir, f'novacut_{ver}_amd64.deb')
with open(deb_path, 'wb') as f:
    f.write(b'!<arch>\n' + ar_member('debian-binary', b'2.0\n') + ar_member('control.tar.gz', ctl_buf.getvalue()) + ar_member('data.tar.gz', data_buf.getvalue()))

# ================= .tar.gz with installer script =================
top = f'NovaCut-{ver}-linux-x64'
INSTALL = f'''#!/bin/sh
# Instala o NovaCut {ver}.
#   ./instalar.sh        só para você (em ~/.local, sem senha)
#   sudo ./instalar.sh   para todos os usuários (em /opt/novacut, com a proteção sandbox do Chromium ligada)
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
if [ "$(id -u)" = "0" ]; then
  DEST=/opt/novacut; BIN=/usr/local/bin; APPS=/usr/share/applications; ICONS=/usr/share/icons/hicolor/256x256/apps
else
  DEST="$HOME/.local/share/novacut"; BIN="$HOME/.local/bin"; APPS="$HOME/.local/share/applications"; ICONS="$HOME/.local/share/icons/hicolor/256x256/apps"
fi
echo "Instalando o NovaCut {ver} em $DEST ..."
rm -rf "$DEST"; mkdir -p "$DEST" "$BIN" "$APPS" "$ICONS"
cp -a "$HERE/programa/." "$DEST/"
cp "$HERE/programa/resources/app/novacut.png" "$ICONS/novacut.png"
if [ "$(id -u)" = "0" ]; then chown root:root "$DEST/chrome-sandbox"; chmod 4755 "$DEST/chrome-sandbox"; fi
ln -sf "$DEST/novacut-launcher" "$BIN/novacut"
sed "s#@EXEC@#$DEST/novacut-launcher#" "$HERE/novacut.desktop.in" > "$APPS/novacut.desktop"
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database -q "$APPS" || true
command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -q -t -f "$(dirname "$(dirname "$ICONS")")" || true
echo "Pronto. Abra o NovaCut pelo menu de aplicativos ou com o comando: novacut"
echo "Seus projetos ficam em ~/.config/NovaCut"
'''.encode('utf-8')
UNINSTALL = b'''#!/bin/sh
# Remove o NovaCut (os projetos em ~/.config/NovaCut ficam; apague essa pasta se quiser)
if [ "$(id -u)" = "0" ]; then DEST=/opt/novacut; BIN=/usr/local/bin; APPS=/usr/share/applications; ICONS=/usr/share/icons/hicolor/256x256/apps
else DEST="$HOME/.local/share/novacut"; BIN="$HOME/.local/bin"; APPS="$HOME/.local/share/applications"; ICONS="$HOME/.local/share/icons/hicolor/256x256/apps"; fi
rm -rf "$DEST"; rm -f "$BIN/novacut" "$APPS/novacut.desktop" "$ICONS/novacut.png"
echo "NovaCut removido. Seus projetos continuam em ~/.config/NovaCut"
'''
README = f'''NovaCut {ver} para Linux (64 bits)

Instalar:
  1. Descompacte:          tar xzf {top}.tar.gz
  2. Entre na pasta:        cd {top}
  3. Instale para você:     ./instalar.sh
     ou para todos:         sudo ./instalar.sh   (recomendado: mantém a proteção sandbox do Chromium)
  4. Abra pelo menu de aplicativos (NovaCut) ou com o comando: novacut

Ubuntu/Debian/Mint: prefira o pacote novacut_{ver}_amd64.deb
  sudo apt install ./novacut_{ver}_amd64.deb

Desinstalar: ./desinstalar.sh (ou sudo ./desinstalar.sh, ou sudo apt remove novacut)
Projetos, preferências e o registro (novacut.log) ficam em ~/.config/NovaCut.

Observação: no Linux, o motor Chromium nem sempre oferece o codificador de áudio AAC; o NovaCut mostra
na exportação só os formatos que o seu sistema consegue gravar (por exemplo MP4 com som Opus, MKV ou WEBM).
'''.encode('utf-8')
tgz_path = os.path.join(out_dir, f'{top}.tar.gz')
with tarfile.open(tgz_path, 'w:gz', format=tarfile.GNU_FORMAT) as t:
    ent = [(f'{top}/programa/{n}', d, m) for n, d, m in files]
    ent += [(f'{top}/instalar.sh', INSTALL, 0o755), (f'{top}/desinstalar.sh', UNINSTALL, 0o755), (f'{top}/LEIA-ME.txt', README, 0o644), (f'{top}/novacut.desktop.in', desktop('@EXEC@'), 0o644)]
    for d in dirs_of([e[0] for e in ent]): ti = tinfo(d + '/', mode=0o755, kind=tarfile.DIRTYPE); ti.uname = ti.gname = ''; t.addfile(ti)
    for n, d, m in ent: ti = tinfo(n, len(d), m); ti.uname = ti.gname = ''; t.addfile(ti, io.BytesIO(d))
for p in (deb_path, tgz_path): print(os.path.basename(p), round(os.path.getsize(p) / 1e6, 1), 'MB')
print('arquivos do programa:', len(files), '| binário:', [oct(m) for n, d, m in files if n == 'novacut'])
