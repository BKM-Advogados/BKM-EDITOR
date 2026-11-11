# Estúdio: instruções para agentes

Lido pelo Codex, Cursor, opencode, Antigravity, VS Code e outros; o `CLAUDE.md` da raiz importa este arquivo, então o
Claude Code lê o mesmo texto. Código, comentários, commits e docs em português do Brasil. O que o app escreve **dentro de
cada projeto** do Estúdio (o guia `CLAUDE.md`/`AGENTS.md`/`GEMINI.md` e o MCP de cada harness) está em `docs/harnesses.md`.

## Rodar, testar e empacotar

```bash
npm ci                                   # Node 20 ou mais novo; o binário do Electron vem no postinstall dele
npm run typecheck                        # tsc --noEmit
npm test                                 # vitest run: cerca de 1.400 testes, também no Windows e no Mac (CI)
npm run mcp:build                        # dist-mcp/nucleo.cjs (MCP por stdio), desktop.cjs (Claude Desktop) e ponte.cjs
npm run mcpb                             # out/mcpb/Estudio-<versão>.mcpb, a extensão do Claude Desktop (depois do mcp:build)
env -u ELECTRON_RUN_AS_NODE npm run dev  # o app em desenvolvimento (já roda o mcp:build)
npm run package                          # pacote do sistema atual; pacote:win, pacote:mac, instalador:win, instalador:mac
bash scripts/instalar-linux.sh           # Linux: instala em ~/.local/opt/Estudio com atalho no lançador
```

## Arquitetura em 10 linhas

1. Electron + React + TypeScript; Remotion faz a prévia (Player) e a exportação (`renderMedia`, `renderStill`).
2. `src/main/`: processo principal (janela, IPC, exportação, git do projeto, terminais, MCP por HTTP para as abas).
3. `src/renderer/`: a interface, sem Node (contextIsolation); `src/preload/` expõe `window.estudio`.
4. `src/nucleo/`: regras puras e testáveis (documentos, JSON Patch com versão, diário, ferramentas MCP, guia do projeto).
5. `src/compartilhado/api.ts`: o contrato do IPC entre a interface e o main.
6. `src/composicoes/`: as composições do Remotion (vídeo de cenas, carrossel, animação).
7. `mcp/nucleo.ts`: o MCP `estudio` por stdio para IDEs e agentes de fora (`--projeto`, `--ide`, `--origem`);
   `mcp/desktop.ts` e `mcpb/`: o do Claude Desktop (pelo app aberto ou no projeto escolhido; `docs/claude-desktop.md`).
8. Um projeto é uma pasta com `estudio.json`, documentos JSON, `midia/`, `.estudio/diario.jsonl` e git próprio.
9. A pessoa (tela) e o agente (MCP) passam pelo mesmo `aplicar_patch` com `versao_base`; tudo cai no diário com Reverter.
10. Detalhes: `docs/arquitetura.md`, `docs/ia.md` (MCP e portão), `docs/ide.md`, `docs/harnesses.md`,
    `docs/claude-desktop.md`, `docs/portes.md`, `STACKS.md`.

## Armadilhas

- **`ELECTRON_RUN_AS_NODE`**: terminais de agentes (T3 Code, VS Code) herdam essa variável, e o Electron vira Node e sai
  sem janela. Rode o app com `env -u ELECTRON_RUN_AS_NODE`. O MCP por stdio usa o mesmo binário de propósito **com** ela.
- O `electron-forge start` fecha sem terminal na entrada; em segundo plano: `tail -f /dev/null | npm run dev`.
- **Nunca `pkill -f` nem `pgrep -f | xargs kill`**: o padrão casa com a linha de comando do próprio shell e o mata. Mate
  pelo PID (no Hyprland, o da janela em `hyprctl clients -j`).
- **`/tmp`**: não escreva `/tmp` fixo em código nem em teste. Use `os.tmpdir()` com `mkdtempSync` (no Windows é
  `%TEMP%`; no Mac, `/var/folders/...`, que é link para `/private/var`, então compare caminhos com `realpath`). Não toque
  em `~/Estudio/` (projetos reais) nem em `~/.local/opt/Estudio` (app instalado): teste em pasta temporária.
- **Testes portáveis**: o CI roda Linux, Windows e Mac. Caminho do sistema pedido com `path.win32`/`path.posix`;
  caminho esperado com `path.join`/`path.resolve` de quem roda; atalhos dizem o sistema (no Mac o Ctrl é o Cmd);
  arquivos em LF (`.gitattributes`); nada de `*` e `?` em nome de arquivo no Windows.
- `npm ci` com os scripts de instalação bloqueados não baixa o binário do Electron (`node_modules/electron/dist`): os
  testes passam, mas o app e o MCP pelo executável do app não rodam.
- Repositório **público**: nada de chave, token, dado de cliente ou caminho pessoal em código, teste ou doc.
