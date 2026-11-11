# Estúdio — Stack Tecnológica

> Projeto: **Estúdio** · app de edição de vídeo, imagem, 3D, efeitos/motion, áudio e música.
> Versão: **V4**, pacote 2.0.0 (11/11/2026; a V3, pacote 1.0.0, saiu em 10/11/2026) · Migração Windows → Linux (Omarchy/Arch) em 09/11/2026.
> Local no Linux: `~/Projects/estudio` (original: `%USERPROFILE%\projetos\estudio`)
> Portes para Windows e macOS (10/11/2026): auditoria, pacotes e o que falta testar em `docs/portes.md`.

---

## 1. Desktop / Runtime

| Tecnologia | Versão | Papel |
|---|---|---|
| **Electron** | 42.11.16 | Casca desktop (main + preload + renderer) |
| **Node.js** (embutido no Electron) | 24.19.0 | Runtime do processo principal |
| **Chromium** (embutido) | 148.0.7778.280 | Renderer / WebView |

---

## 2. Linguagem e UI

| Tecnologia | Versão | Papel |
|---|---|---|
| **TypeScript** | 5.9.3 | Linguagem principal (todo o código) |
| **React** | 19.3.1 | Interface (renderer) |
| **React DOM** | 19.3.1 | Renderer React |
| **Vite** | 6.4.5 | Dev server + build (main/preload/renderer) |
| **@vitejs/plugin-react** | 4.3.4 | Integração React no Vite |
| **scheduler** | 0.27.0 | Agendamento concorrente do React |

### Bibliotecas de UI

| Biblioteca | Versão | Uso |
|---|---|---|
| **dockview-react** | 8.8.3 | Painéis/janelas encaixáveis (layout do editor) |
| **@xterm/xterm** | 6.0.0 | Terminal embutido |
| **@xterm/addon-fit** | 0.11.0 | Ajuste de tamanho do terminal |
| **@xterm/addon-webgl** | 0.19.0 | Aceleração WebGL do terminal |
| **lucide-react** | 1.68.0 | Ícones |
| **@fontsource-variable/inter** | 5.3.0 | Fonte UI (Inter) |
| **@fontsource/jetbrains-mono** | 5.3.0 | Fonte monoespaçada (código/terminal) |

---

## 3. Vídeo e render

| Tecnologia | Versão | Papel |
|---|---|---|
| **Remotion** | 4.0.540 | Render de vídeo em React (composições) |
| **@remotion/renderer** | 4.0.540 | Motor de render (MP4/H.264/H.265/VP9) |
| **@remotion/bundler** | 4.0.540 | Empacota as composições |
| **@remotion/player** | 4.0.540 | Preview interativo |
| **@remotion/fonts** / **@remotion/google-fonts** | 4.0.540 | Carregamento de fontes |
| **@remotion/compositor-*** | 4.0.540 | Binário nativo (Chromium+FFmpeg) por SO/arch |

> O ffmpeg **não** é chamado como processo do sistema: os codecs vêm embutidos no
> binário do compositor do Remotion (`@remotion/compositor-linux-x64-gnu` no Linux).

---

## 4. Áudio

| Tecnologia | Papel |
|---|---|
| **Web Audio API** (Chromium) | Decodificação e envelope de áudio (loudness/ducking, ponderação K/BS.1770) |

> Sem dependência nativa de ffmpeg. A síntese de narração e o som de cenas usam o
> renderer (Web Audio) e o compositor do Remotion.

---

## 5. 3D

| Tecnologia | Versão | Papel |
|---|---|---|
| **three** | 0.187.0 | Cena 3D (módulo `tres`) |
| **@types/three** | 0.187.0 | Tipos |

---

## 6. MCP / IA

| Tecnologia | Versão | Papel |
|---|---|---|
| **@modelcontextprotocol/sdk** | 1.32.2 | Servidor MCP (stdio + HTTP) |
| **ws** | 8.21.0 | WebSocket |
| **Claude Code** (`claude` no PATH) | — | Abas de conversa/terminal com agente (opcional) |

> O MCP roda de duas formas: HTTP no processo principal do Electron (Streamable HTTP)
> e stdio via `dist-mcp/nucleo.cjs` (compilado com esbuild).
>
> Narração por IA (`docs/narracao.md`): Gemini TTS (Gemini API) e Google Cloud Text-to-Speech (Chirp 3: HD) por REST com
> `fetch`, sem SDK nem dependência nova.

---

## 7. Lógica de negócio / utilitários

| Biblioteca | Versão | Uso |
|---|---|---|
| **zod** | ^3.25.0 | Validação de dados/esquemas |
| **fast-json-patch** | 3.1.1 | Patch JSON (ferramentas MCP) |
| **pdf-lib** | 1.17.1 | Geração de PDF (carrossel de páginas) |
| **chokidar** | 4.0.3 | Observação de arquivos (watch) |
| **@lydell/node-pty** | 1.2.0-beta.18 | Terminal nativo (PTY) |

---

## 8. Build, empacotamento e instalação

| Ferramenta | Versão | Uso |
|---|---|---|
| **Electron Forge** | 7.11.1 | Build/dev/package/make (pacote de qualquer sistema a partir de qualquer um) |
| **@electron/packager** (do Forge) | 18.4.4 | Ícone e versão do `.exe` pelo `resedit` (sem Wine); `.app` com Info.plist próprio |
| **@electron-forge/maker-zip** | 7.11.1 | Zip portátil (`win32`, `linux` e `darwin`) |
| **@electron-forge/plugin-vite** | 7.11.1 | Integração Vite no Forge |
| **electron-builder** | 26.17.0 | Instalador NSIS do Windows (precisa de Windows ou Wine) e DMG do Mac (precisa de Mac) |
| **esbuild** | ^0.25.0 | Bundler do MCP (`mcp:build`) |
| **GitHub Actions** (`.github/workflows/build.yml`) | — | Pacotes e instaladores de Linux, Windows e Mac (arm64 e Intel), só à mão ou por tag `v*` |

### Scripts (`package.json`)

| Script | Comando | Onde roda |
|---|---|---|
| `dev` | `mcp:build` + `electron-forge start` | Linux ✅ · Windows · Mac |
| `mcp:build` | `esbuild mcp/nucleo.ts …` | todos |
| `typecheck` | `tsc --noEmit` | todos |
| `test` | `vitest run` | Linux ✅ (no Windows e no Mac, a conferir no CI) |
| `studio` | `remotion studio …` | todos |
| `package` | `electron-forge package` | o sistema atual: `out/pacote/Estudio-<sistema>-<arch>` |
| `make` | `electron-forge make` | zip portátil do sistema atual |
| `nativos:win`, `nativos:mac` | `scripts/nativos-alvo.mjs` | qualquer: baixa o compositor e o node-pty do alvo (integridade do lock) |
| `pacote:win` | `electron-forge package --platform win32 --arch x64` | qualquer (do Linux ✅, depois de `nativos:win`) |
| `portatil:win` | `electron-forge make --skip-package … win32` | qualquer: o `.zip` do Windows |
| `pacote:mac`, `pacote:mac-arm64`, `pacote:mac-x64` | package + zip do `.app` por arquitetura | qualquer (do Linux ✅, depois de `nativos:mac`); sem assinatura fora do Mac |
| `instalador:win` (e o antigo `instalador`) | pacote + `electron-builder --win nsis` | Windows (ou Linux com Wine) |
| `instalador:mac` | `scripts/instalador-mac.mjs`: pacote + DMG | só Mac |
| `scripts/instalar-linux.sh` | empacota e instala para o usuário | Linux ✅ `~/.local/opt/Estudio` + atalho no lançador |

> O `extract-zip` do empacotador usa o `yauzl` 2, que não lê zip no Node 24+ (o processo sai em silêncio no meio do
> "Finalizing package"). O `package.json` força o `yauzl` 3 em `overrides`.

> Assinatura e notarização do Mac ficam desligadas até haver as variáveis da Apple (`ESTUDIO_MAC_IDENTIDADE`,
> `APPLE_API_KEY*` ou `APPLE_ID*`, `build/mac.ts`); entitlements em `build/entitlements.*.plist`.

---

## 9. Testes e qualidade

| Ferramenta | Versão | Uso |
|---|---|---|
| **Vitest** | 3.2.7 | Testes unitários (888 testes, 82 arquivos) |
| **Playwright** | 1.64.1 | Testes E2E |
| **tsx** | 4.23.15 | Execução de scripts TS |

---

## 10. Dependências nativas por plataforma

| Pacote / binário | Linux (x64) | Windows (x64) | macOS (arm64 · x64) | Como entra no app |
|---|---|---|---|---|
| `@remotion/compositor-*` (render, ffmpeg, ffprobe) | `-linux-x64-gnu` ✅ | `-win32-x64-msvc` (no pacote ✅) | `-darwin-arm64` · `-darwin-x64` (no pacote ✅) | `forge.config.ts` copia o do alvo para `app.asar.unpacked`; no Mac o ffmpeg acha as dylibs pelo `DYLD_LIBRARY_PATH` |
| `@lydell/node-pty-*` (terminais) | `-linux-x64` ✅ | `-win32-x64` (conpty, no pacote ✅) | `-darwin-arm64` · `-darwin-x64` (no pacote ✅) | o mesmo, N-API sem recompilar |
| Chrome Headless Shell (navegador de render) | `linux64` (remotion.media) ✅ | `win64` (remotion.media, no pacote ✅) | `mac-arm64` (remotion.media) · `mac-x64` (Chrome for Testing), no pacote ✅ | `forge.config.ts`: o do sistema pelo `ensureBrowser`, o de outro alvo por `src/main/navegador-alvo.ts` |
| whisper-cli (transcrição) | compilado pela pessoa | baixado no 1º uso (whisper.cpp b5454, SHA-256) | embutido pelo CI (v1.9.5 estático) ou Homebrew | `ESTUDIO_WHISPER_EMBUTIDO` → `resources/whisper` |
| `@esbuild/*`, `@rollup/*` | `linux-x64` ✅ | `win32-x64` | `darwin-*` | só no build; o `npm ci` de cada sistema instala |

Empacotar outro sistema a partir do Linux: `npm run nativos:win` / `npm run nativos:mac` antes do `pacote:*`
(`scripts/nativos-alvo.mjs`, sem mexer no `package.json` nem no lock).

---

## 11. Ambiente Linux (Omarchy)

| Componente | Versão |
|---|---|
| **Omarchy** (base Arch) | kernel 7.2.15-1-omarchy |
| **Display** | Wayland · Hyprland |
| **GPU** | Intel Iris Xe (TigerLake) |
| **Node.js** (sistema, via mise) | 26.13.0 |
| **npm** | 11.20.0 |
| **ffmpeg / ffprobe** | n9.0.2 (instalado, mas não exigido pelo app) |

### Rodar em desenvolvimento

```bash
env -u ELECTRON_RUN_AS_NODE npm run dev
```

- `ELECTRON_RUN_AS_NODE`, herdada de terminais de agentes (T3 Code, VS Code), faz o Electron rodar como Node puro e
  sair sem janela. Num terminal comum ela não existe.
- O `electron-forge start` fecha o Electron (código 0, sem erro) quando roda sem terminal na entrada padrão. Para rodar
  em segundo plano: `tail -f /dev/null | npm run dev`.
- A GPU funciona: WebGL2 acelerado por ANGLE sobre o Mesa (Iris Xe). O aviso do Ozone sobre Vulkan no log é inofensivo.
  O diagnóstico anterior de "crash de GPU" estava errado: os crashes vinham de scripts de teste encerrados à força.
- No Hyprland (e em outros gerenciadores em mosaico) a janela abre sem os botões de minimizar/maximizar/fechar
  (fecha com Super+W); nos demais sistemas continua com os do sistema.

### Instalar no lançador de aplicativos

```bash
bash scripts/instalar-linux.sh
```

---

## 12. Resumo da verificação Linux (09/11/2026)

| Verificação | Resultado |
|---|---|
| Compilação (Vite main/preload/renderer) | ✅ |
| `npm run typecheck` | ✅ zero erros |
| `npm run mcp:build` | ✅ |
| `npm test` (Vitest) | ✅ **888** (3 pulados), na V3 |
| Electron abre janela no Hyprland | ✅ (sem `ELECTRON_RUN_AS_NODE`) |
| Bloqueadores de código Windows-específico | ✅ **0** |
| Empacotamento Linux | ✅ pacote + `scripts/instalar-linux.sh` (deb/rpm não servem ao Arch) |
