# NovaCut

Editor de vídeo gratuito para **Windows** e **Linux**, com linha do tempo, títulos animados, legendas, correção de cor, máscaras, multicâmera, mixer de áudio e exportação em MP4, MKV, WEBM e GIF.

## Baixar

Os instaladores ficam na página **[Releases](../../releases/latest)**:

| Sistema | Arquivo | Como instalar |
|---|---|---|
| Windows 10/11 (64 bits) | `NovaCut-Setup-<versão>.exe` | Dê dois cliques e siga o instalador. |
| Ubuntu, Debian, Mint, Pop!_OS | `novacut_<versão>_amd64.deb` | `sudo apt install ./novacut_<versão>_amd64.deb` |
| Outras distribuições Linux | `NovaCut-<versão>-linux-x64.tar.gz` | Descompacte e rode `./instalar.sh` (ou `sudo ./instalar.sh` para todos os usuários). |

O **Manual do NovaCut** (PDF, com imagens de cada função) também está na página de Releases.

> No Linux, o som AAC pode não estar disponível. Nesse caso, exporte em MP4 com som Opus, MKV ou WEBM.

## Principais funções

- **Linha do tempo** com várias trilhas de vídeo, áudio, texto e legendas, quadros-chave e encaixe magnético.
- **Títulos e legendas** com modelos animados.
- **Cor:** rodas de cor, curvas, LUTs, espaço de cor log/ACES, cor falsa e escopos.
- **Efeitos:** máscaras com rotoscopia, foco seletivo, transições e elementos.
- **Multicâmera:** sincroniza e troca de câmera ao vivo.
- **Áudio:** mixer com automação, de-esser, compressor multibanda e medição de loudness.
- **Cortador Instantâneo:** corta sem recodificar.
- **Segurança do projeto:** salvamento automático, autoteste e recuperação.

## Estrutura do código

```
instalador/
  src/NovaCut.html         o editor inteiro (HTML + JavaScript)
  src/install.ps1 ...      instalador e desinstalador do Windows
  electron/app/            janela do programa (Electron): main.js, preload.js, package.json, ícones
  build-installer.ps1      gera o NovaCut-Setup-<versão>.exe (Windows, IExpress)
  linux/build_linux.py     gera o .deb e o .tar.gz do Linux
  linux/verify_linux.py    confere os pacotes Linux
```

### Gerar os instaladores

1. Baixe o Electron 45.2.1 oficial (`electron-v45.2.1-win32-x64.zip`, `electron-v45.2.1-linux-x64.zip` e `SHASUMS256.txt`) em <https://github.com/electron/electron/releases/tag/v45.2.1> e coloque em `instalador/electron/vendor/`.
2. Windows: `powershell -ExecutionPolicy Bypass -File instalador\build-installer.ps1`
3. Linux: `python instalador/linux/build_linux.py`

## Apoie o projeto

O NovaCut é gratuito. Se ele for útil para você, use a opção **Ajuda → Ajude o nosso trabalho** dentro do programa para apoiar com Pix.
