# Estúdio — Stack Tecnológica

> Projeto: **Estúdio** · app de edição de vídeo, imagem, 3D, efeitos/motion, áudio e música.
> Versão: **1.0.0** (10/11/2026) · Migração Windows → Linux (Omarchy/Arch) em 09/11/2026.
> Local no Linux: `~/Projects/estudio` (original: `C:\Users\usuario\projetos\estudio`)

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
| **Electron Forge** | 7.11.1 | Build/dev/package/make |
| **@electron-forge/maker-zip** | 7.11.1 | Zip portátil (`win32` e `linux`) |
| **@electron-forge/plugin-vite** | 7.11.1 | Integração Vite no Forge |
| **electron-builder** | 26.17.0 | Instalador NSIS do Windows |
| **esbuild** | ^0.25.0 | Bundler do MCP (`mcp:build`) |

### Scripts (`package.json`)

| Script | Comando | Linux? |
|---|---|---|
| `dev` | `mcp:build` + `electron-forge start` | ✅ |
| `mcp:build` | `esbuild mcp/nucleo.ts …` | ✅ |
| `typecheck` | `tsc --noEmit` | ✅ |
| `test` | `vitest run` | ✅ |
| `studio` | `remotion studio …` | ✅ |
| `package` | `electron-forge package` | ✅ gera `out/pacote/Estudio-linux-x64` |
| `make` | `electron-forge make` | ✅ zip portátil |
| `instalador` | `electron-builder --win nsis` | ❌ Windows-only |
| `scripts/instalar-linux.sh` | empacota e instala para o usuário | ✅ `~/.local/opt/Estudio` + atalho no lançador |

> O `extract-zip` do empacotador usa o `yauzl` 2, que não lê zip no Node 24+ (o processo sai em silêncio no meio do
> "Finalizing package"). O `package.json` força o `yauzl` 3 em `overrides`.

---

## 9. Testes e qualidade

| Ferramenta | Versão | Uso |
|---|---|---|
| **Vitest** | 3.2.7 | Testes unitários (888 testes, 82 arquivos) |
| **Playwright** | 1.64.1 | Testes E2E |
| **tsx** | 4.23.15 | Execução de scripts TS |

---

## 10. Dependências nativas por plataforma

| Pacote | Linux (x64) | Windows | macOS |
|---|---|---|---|
| `@remotion/compositor-*` | `-linux-x64-gnu` ✅ | `-win32-x64-msvc` | `-darwin-x64` / `-darwin-arm64` |
| `@lydell/node-pty-*` | `-linux-x64` ✅ | `-win32-x64` | `-darwin-*` |
| `@esbuild/linux-x64` | ✅ | `-win32-x64` | `-darwin-*` |
| `@rollup/rollup-linux-x64-gnu` | ✅ | `-win32-x64-msvc` | `-darwin-*` |

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
| `npm test` (Vitest) | ✅ **888** (3 pulados), na 1.0 |
| Electron abre janela no Hyprland | ✅ (sem `ELECTRON_RUN_AS_NODE`) |
| Bloqueadores de código Windows-específico | ✅ **0** |
| Empacotamento Linux | ✅ pacote + `scripts/instalar-linux.sh` (deb/rpm não servem ao Arch) |
