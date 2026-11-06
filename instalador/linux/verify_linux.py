import io, tarfile, sys, os
d = os.path.expanduser(r'~\Documents\NovaCut\linux')
deb = open(os.path.join(d, 'novacut_3.0.2_amd64.deb'), 'rb').read()
assert deb[:8] == b'!<arch>\n'; p = 8; mem = {}
while p < len(deb):
    h = deb[p:p + 60]; name = h[:16].decode().strip(); size = int(h[48:58]); assert h[58:60] == b'`\n'
    mem[name] = deb[p + 60:p + 60 + size]; p += 60 + size + (size % 2)
print('deb membros (ordem):', list(mem))
assert list(mem) == ['debian-binary', 'control.tar.gz', 'data.tar.gz'] and mem['debian-binary'] == b'2.0\n'
ct = tarfile.open(fileobj=io.BytesIO(mem['control.tar.gz']))
print(ct.extractfile('./control').read().decode().split('\nDescription')[0])
for n in ('./postinst', './postrm'): m = ct.getmember(n); s = ct.extractfile(m).read(); assert oct(m.mode) == '0o755' and b'\r' not in s and s.startswith(b'#!/bin/sh'); print(n, 'ok', oct(m.mode))
dt = tarfile.open(fileobj=io.BytesIO(mem['data.tar.gz'])); M = {m.name: m for m in dt.getmembers()}
b = M['./opt/novacut/novacut']; elf = dt.extractfile(b).read(20); print('binário:', oct(b.mode), 'ELF' if elf[:4] == b'\x7fELF' else 'NÃO ELF', '64 bits' if elf[4] == 2 else '?', 'x86-64' if elf[18] == 0x3e else hex(elf[18]))
print('chrome-sandbox:', oct(M['./opt/novacut/chrome-sandbox'].mode), M['./opt/novacut/chrome-sandbox'].uid)
print('launcher:', oct(M['./opt/novacut/novacut-launcher'].mode), b'\r' not in dt.extractfile('./opt/novacut/novacut-launcher').read())
print('atalho /usr/bin/novacut ->', M['./usr/bin/novacut'].linkname)
print(dt.extractfile('./usr/share/applications/novacut.desktop').read().decode().splitlines()[:6])
for need in ['./opt/novacut/resources/app/NovaCut.html', './opt/novacut/resources/app/main.js', './opt/novacut/resources/app/preload.js', './opt/novacut/resources/app/package.json', './opt/novacut/resources/app/novacut.png', './opt/novacut/libffmpeg.so', './opt/novacut/icudtl.dat', './opt/novacut/resources.pak', './opt/novacut/v8_context_snapshot.bin', './opt/novacut/locales/pt-BR.pak', './usr/share/icons/hicolor/256x256/apps/novacut.png']: assert need in M, need
print('libs:', sorted(n.split('/')[-1] for n in M if '/libs/' in n))
assert not any('default_app' in n for n in M)
html = dt.extractfile('./opt/novacut/resources/app/NovaCut.html').read().decode('utf-8'); print('página:', "APP_VERSION = '3.0.2'" in html, '| caminhos Linux aceitos:', html.count('|^\\\\\\\\|^\\//i'))
main = dt.extractfile('./opt/novacut/resources/app/main.js').read().decode('utf-8'); print('main.js: IS_WIN', 'IS_WIN' in main, '| ~/.config', '.config' in main)
tg = tarfile.open(os.path.join(d, 'NovaCut-3.0.2-linux-x64.tar.gz')); T = {m.name: m for m in tg.getmembers()}
top = 'NovaCut-3.0.2-linux-x64'
for n in ['instalar.sh', 'desinstalar.sh', 'programa/novacut', 'programa/novacut-launcher']: m = T[top + '/' + n]; print('tar.gz', n, oct(m.mode))
s = tg.extractfile(top + '/instalar.sh').read(); assert b'\r' not in s
print('tar.gz: membros', len(T), '| sem CRLF nos scripts: ok')
