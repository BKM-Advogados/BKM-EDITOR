# Projetos prontos para IDE de agentes (T3 Code, Claude Code e os outros harnesses)

Frente IDE (branch `frente/integracao-ide`, 10/11/2026). Cada projeto do Estúdio pode ser aberto direto numa IDE de
agentes, principalmente o T3 Code, com o MCP `estudio` já ligado, e o agente pode **ver o vídeo** sem o app aberto.

**Desde a 2.0.1 (frente harnesses, 11/11/2026):** o mesmo vale para Codex, Gemini CLI, Antigravity, Cursor, VS Code e
opencode. O guia vai também para `AGENTS.md` e `GEMINI.md`, e o MCP para o arquivo de cada harness, com a origem de cada
um no diário. Arquivos, formatos, links das docs oficiais e o que foi provado em `docs/harnesses.md`; este documento
segue valendo para o Claude Code e o T3.

## O que o app escreve em cada projeto, e por quê

Ao **criar ou abrir** um projeto, junto do `CLAUDE.md`, o app escreve ou atualiza (`src/nucleo/ide.ts`, chamado em
`abrirProjeto` no `src/main/main.ts`, antes do primeiro commit do projeto novo):

| Arquivo | O que tem | Por quê | No git do projeto? |
|---|---|---|---|
| `.mcp.json` | o servidor `estudio`: o MCP por stdio deste app (`dist-mcp/nucleo.cjs`) apontado para a pasta | o Claude Code, as threads Claude do T3 (Claude Agent SDK) e o Cursor carregam o MCP do projeto por este arquivo | **não** |
| `.claude/settings.local.json` | `"enabledMcpjsonServers": ["estudio"]` | aprova o servidor do `.mcp.json`; no modo SDK do T3 não há diálogo de aprovação | não (é local por convenção do Claude Code) |
| `t3.json` | `$schema`, `iconPath: ".estudio/miniatura.jpg"`, `defaultThreadEnvMode: "local"` | threads do T3 na própria pasta (worktree não serve: a mídia pesada fica fora do git) e o ícone do projeto (a foto do monitor que o app tira ao fechar) | sim |
| `.gitignore` | `.mcp.json` e `.claude/settings.local.json`, com um comentário | os dois têm caminhos ou escolhas desta máquina | sim |
| `CLAUDE.md` | a seção "Trabalhando por uma IDE (T3 Code, Claude Code)" | como ver o vídeo (prévias), que a tela recarrega e que tudo entra no diário com Reverter | sim |
| `AGENTS.md`, `GEMINI.md` | o mesmo guia, com a seção do harness no fim (2.0.1) | Codex, Cursor, VS Code, opencode e Antigravity leem o `AGENTS.md`; o Gemini CLI, o `GEMINI.md` | sim |
| `.codex/config.toml`, `.gemini/settings.json`, `.agents/mcp_config.json`, `.cursor/mcp.json`, `.vscode/mcp.json`, `opencode.json` | o mesmo servidor `estudio`, no formato de cada harness e com `--origem` (2.0.1) | `docs/harnesses.md` | **não** |

O servidor do `.mcp.json`:

```json
{"mcpServers": {"estudio": {
  "type": "stdio",
  "command": "<executável do Estúdio>",
  "args": ["<recursos>/dist-mcp/nucleo.cjs", "--projeto", "<pasta absoluta>", "--autor", "agente", "--ide"],
  "env": {"ELECTRON_RUN_AS_NODE": "1"}
}}}
```

- **Comando:** o próprio executável do app em modo Node (`ELECTRON_RUN_AS_NODE=1`), como a ponte dos apps de fora. No app
  instalado não há `node` no sistema; o executável dele serve. Instalado: `~/.local/opt/Estudio/Estudio` com
  `resources/dist-mcp/nucleo.cjs`. Em desenvolvimento: o `electron` do `node_modules` com o `dist-mcp/nucleo.cjs` do
  repositório (`scriptDoMcp` e `servidorDoMcp`, testados nos dois casos).
- **Origem:** cada processo da IDE é uma conversa, com a origem `ide-<id>` no diário (o Histórico mostra "Claude na IDE"),
  com o app aberto ou fechado (`src/nucleo/mcp-app.ts`). `--autor agente`, como as outras IAs.
- **`--ide`:** se a pasta de trabalho da IDE é um projeto do Estúdio, ela vale no lugar de `--projeto`. Uma pasta copiada à
  mão leva o `.mcp.json` da original; sem isso, o agente da cópia editaria a original.

**Decisão: o `.mcp.json` fica fora do git.** Ele tem dois caminhos absolutos desta máquina (o app e a pasta) e é refeito a
cada abertura. No git, cada troca entre o app instalado e o de desenvolvimento viraria commit, e uma cópia do projeto em
outro PC traria caminhos errados. O `t3.json` não tem nada da máquina e fica no git.

**Regras da escrita:**

- **Mesclar sem apagar.** Outros servidores e chaves do `.mcp.json`, outras permissões e servidores do
  `settings.local.json`, `scripts` e escolhas do `t3.json` (por exemplo `defaultThreadEnvMode: "worktree"`) ficam.
- **O servidor `estudio` do app é refeito** quando o caminho muda: app movido, dev e instalado, ou projeto duplicado. Um
  `estudio` que a pessoa trocou à mão (sem `nucleo.cjs` nos args, como o HTTP dos apps de fora) fica, com aviso.
- Quem pôs `estudio` em `disabledMcpjsonServers` decidiu: o app não o aprova de novo.
- JSON ilegível não é tocado e vira aviso em Configurações › IA.
- **Nada é regravado se não mudou.** O app commita o git do projeto sozinho; reabrir não gera commit.
- Se o app instalado e o de desenvolvimento abrem o mesmo projeto, vale o `.mcp.json` do último que abriu.

## Ligar e desligar

Configurações › IA (no painel da IA, "+ Conversa" → "Provedores e chaves…"), seção **IDE de agentes**:

- **"Projetos prontos para agentes: Claude Code, T3 Code, Codex, Gemini CLI, Antigravity, Cursor, VS Code, opencode"**:
  padrão ligado (`projetos_ide` nas preferências). Ligar com um projeto aberto escreve os arquivos na hora.
- Abaixo, a lista harness → guia → arquivo de MCP, com "(escrito agora)" no que a abertura gravou, e a linha do projeto
  aberto com o que foi escrito, os avisos e o botão **Copiar comando do Codex** (`docs/harnesses.md`).
- **Desligar não apaga nada:** só deixa de escrever. Para tirar de um projeto:

```bash
cd "<pasta do projeto>"
rm -f .mcp.json t3.json AGENTS.md GEMINI.md
rm -f .codex/config.toml .gemini/settings.json .agents/mcp_config.json .cursor/mcp.json .vscode/mcp.json opencode.json
rm -f .claude/settings.local.json   # ou só tire "estudio" de enabledMcpjsonServers, se houver outras chaves
# (nos JSON e no TOML com outras escolhas suas, tire só a entrada "estudio")
# e, se quiser, apague do .gitignore as linhas debaixo de "# IDE de agentes (Estúdio…"
```

Com a opção ligada, abrir o projeto no app escreve tudo de novo. Desligue antes.

## Quais IDEs e provedores funcionam

| Onde | Funciona? | Como |
|---|---|---|
| T3 Code, thread **Claude** | sim | o SDK roda sem `settingSources` e carrega o `.mcp.json` da pasta; o `settings.local.json` aprova |
| Claude Code (terminal ou extensão de editor) | sim | `.mcp.json` do projeto; aprovado pelo `settings.local.json` |
| Cursor | sim | desde a 2.0.1, `.cursor/mcp.json` (o que a doc do Cursor cita) e o `AGENTS.md`; `docs/harnesses.md` |
| Codex, Gemini CLI, Antigravity, VS Code e opencode **fora do T3** | sim (2.0.1) | o arquivo de cada um; `docs/harnesses.md` |
| T3 Code com **Codex**, **OpenCode** ou agente **ACP** (Gemini CLI, Qwen…) | **não** | exige mudança no T3 (abaixo) |
| A aba Claude **dentro do Estúdio** | sem mudança | continua no MCP HTTP do app, com o portão. O `--mcp-config` do app vence o `.mcp.json` do projeto: conferido em 10/11/2026, o `init` do `claude -p` lista um `estudio` só, com `source: "dynamic"` |

Conferido em 10/11/2026 no Claude Code: num projeto aberto pelo app de desenvolvimento, `claude -p` conecta o `estudio`
do `.mcp.json` (`source: "project"`, 83 ferramentas, `ver_quadro`, `ver_cenas` e `ver_trecho` entre elas).

**O que faltaria no T3 para Codex, OpenCode e ACP** (repositório `t3code`, não mexido nesta frente). Hoje cada sessão de
provedor recebe um MCP só, o do próprio T3:

- `McpProviderSessionConfig` em `packages/provider-core/src/server/mcpSession.ts` tem só o endpoint e o token do T3.
  Faltaria um campo `extraServers`: lista de servidores stdio e HTTP com nome, comando, args, env ou url.
- `ProviderSessionManager.prepareMcpSession` em `apps/server/src/orchestration-v2/ProviderSessionManager.ts`
  preencheria esse campo lendo o `.mcp.json` da pasta do projeto, com a aprovação do `.claude/settings.local.json` ou
  uma lista própria no `t3.json`.
- Cada adapter traduziria para o formato do provedor:
  - Codex: `mcp_servers` na configuração;
  - OpenCode: `mcp` no config, em `packages/provider-opencode`;
  - ACP: `mcpServers` no `session/new`, em `packages/provider-acp`;
  - Pi e Muse: na injeção que já existe.

**Com o app aberto ou fechado:** o `mcp/nucleo.ts` procura o `.estudio/mcp-app.json` que o app publica ao abrir o
projeto. Achou: cada chamada de ferramenta vai para o app (`src/nucleo/mcp-app.ts`), com o portão, o aviso na tela e um
escritor só. Não achou (app fechado): as ferramentas falam direto com os arquivos, com a trava `.estudio/escrita.lock`.

- **O cartão do portão.** Com o app aberto, as da classe "cartão" (`ler_fonte`, `transcrever`, `remover_fundo`, `narrar`
  etc.) perguntam na tela do app. Com o app fechado, quem pergunta é a IDE (a permissão do Claude Code ou o modo da
  thread no T3).
- **Diário e Reverter iguais.** Cada mudança entra em `.estudio/diario.jsonl` com a origem `ide-<id>` da conversa, e o
  Histórico do app ("Claude na IDE") reverte.
- **Recarga.** Com o app aberto, a tela recarrega sozinha quando o arquivo muda.
- **Duas mãos ao mesmo tempo.** O `aplicar_patch` com `versao_base` recusa a mudança feita sobre versão velha.

## Prévias para o agente ver o vídeo (`src/nucleo/mcp-previa.ts`)

| Ferramenta | Parâmetros | Grava em `saidas/previas/` | Na resposta |
|---|---|---|---|
| `ver_quadro` | `documento?`, `tempo_ms?` ou `cena?` (número, `"1"` é a primeira, ou id) + `fracao?` (0 a 1, padrão 0,75), `escala?` (padrão: lado maior em 960 px) | `quadro-<doc>-<ms>ms-<carimbo>.png` | caminho absoluto, `markdown`, a cena, tamanho, e a **imagem** (JPEG até 1024 px) |
| `ver_cenas` | `documento?`, `fracao?`, `cenas?` (lista de números ou ids) | `cenas-<doc>-<carimbo>.png`: folha de contato, um quadro por cena, células de 360 px, até 48 cenas | caminho, `markdown`, a linha e a coluna de cada cena, e a imagem |
| `ver_trecho` | `documento?`, `de_ms?` e `ate_ms?` (padrão: 10 s) ou `cena?`, `escala?` (padrão 0,5) | `trecho-<doc>-<de>-<ate>ms-<carimbo>.mp4`: H.264 com som, até 60 s | caminho e `markdown` |

- **Documento.** Sem `documento`, vale o primeiro vídeo do projeto ou, sem vídeo, a primeira animação.
  - `ver_quadro` e `ver_trecho` servem ao vídeo de cenas, ao carrossel narrado e à animação.
  - `ver_cenas` precisa de cenas.
  - Imagem e 3D ficam de fora.
- **Mostrar à pessoa.** O chat do T3 mostra imagem e vídeo quando o agente escreve `![alt](/caminho/absoluto)`. O campo
  `markdown` vem pronto. Caminho com espaço vai entre `< >`, como nas pastas "Sem título · …" que o app cria.
- **O agente vê o quadro.** A imagem vai como conteúdo `image` do MCP; o vídeo não tem esse tipo de conteúdo.
- **Mesmo render da exportação.**
  - Mesmas composições, `prepararRender`, `renderStill` e `renderMedia`, e as props de `propsDoVideo` (agora solta da
    sessão do app).
  - O som do trecho sai mixado e no alvo de loudness.
  - A marca d'água por destino não entra.
  - Trecho mudo sai sem faixa de áudio.
- **Classe "livre" no portão.** As prévias não mexem nos documentos nem no diário e não saem do PC. O que gravam é
  descartável, numa pasta fora do git que se limpa sozinha. As exportações (`exportar_legendas`, `exportar_musica`) são
  "cartão" porque geram entrega com nome escolhido.
- **Limpeza.** Depois de cada prévia, a pasta guarda as 40 mais novas, até 400 MB; as mais velhas saem. As imagens
  apagadas somem também das mensagens antigas do chat.
- **Andamento.** O MCP manda `notifications/progress` para o cliente que pedir (`progressToken`), no máximo um por segundo.

**Como renderiza sem o app** (`src/main/previa.ts` e `src/main/previa-stdio.ts`):

- **App instalado.** O `nucleo.cjs` fica em `resources/dist-mcp/`, ao lado do `app.asar` com as composições já empacotadas
  e do navegador de render, em `app.asar.unpacked`. Precisa rodar pelo executável do app (`ELECTRON_RUN_AS_NODE=1`), que
  lê o asar.
- **Desenvolvimento.** As composições são empacotadas uma vez por processo, com o pacote em cache pela vida dele (o
  `pacoteDev` do `exportar.ts`). O `@remotion/bundler` fica fora do `nucleo.cjs` e vem do `node_modules`.
  - A pasta de trabalho do processo passa para a raiz do repositório na primeira prévia, como no app.
  - Sem isso, o Remotion procuraria o `package.json` a partir do projeto e baixaria um Chrome para dentro dele.
- **Mídia e fontes.** `midia/` e as fontes do kit em `fontes/` chegam ao render por um servidor local (o mesmo
  `ServidorMidia` do app), aberto só durante cada prévia, com a pasta do projeto inteira. Dentro do app, vale o servidor
  de mídia dele.
- **Folha de contato.**
  - O ffmpeg do compositor só tem `scale` e `concat`, e não lê nem grava `rawvideo` como arquivo.
  - Cada quadro sai em pixels por `image2pipe`, a grade é montada em JavaScript e o PNG é gravado com o zlib do Node.
- **`mcp:build`.**
  - `--external:@remotion/bundler`.
  - Um `import.meta.url` que aponta para o próprio `nucleo.cjs`: o renderer em ESM usa `createRequire`.
  - O arquivo passou de 1,6 para 2,9 MB, e o renderer só carrega na primeira prévia.
- **Tempo, medido em 10/11/2026 neste PC (dev):**
  - primeiro quadro: de 3 a 15 s (empacota as composições; menos com o cache do webpack);
  - quadros seguintes: menos de 1 s;
  - folha de 3 cenas: cerca de 3 s;
  - trecho de 3 s: cerca de 2 a 4 s.

## Abrir no T3 Code

O botão **Abrir no T3 Code**, ao lado da opção:

- Com o `t3` no PATH, roda `t3 project add <pasta> --title <nome>`. Se o projeto já está no T3, ele avisa.
- Sem o `t3`, explica como adicionar à mão: no T3, adicionar a pasta como projeto, ou pedir numa thread "adicione o
  projeto <pasta>" (`t3_project_create`).
- O comando roda sem `ELECTRON_RUN_AS_NODE`. No Windows, o `t3.cmd` vai pelo shell (não testado lá).

## Testar de ponta a ponta

1. `npm run mcp:build` e `env -u ELECTRON_RUN_AS_NODE npm run dev`, ou o app instalado depois de
   `bash scripts/instalar-linux.sh`.
2. Crie um projeto de vídeo numa pasta de teste (Novo → Vídeo, "Mais opções" → pasta) ou abra um que já existe.
3. Confira na pasta: `.mcp.json`, `.claude/settings.local.json`, `t3.json` e as duas linhas novas do `.gitignore`. O
   `git log` do projeto não ganha commit ao reabrir.
4. Em Configurações › IA, a seção "IDE de agentes" mostra o que foi escrito. Clique em "Abrir no T3 Code", ou adicione a
   pasta no T3 à mão.
5. No T3, abra uma thread **Claude** no projeto (local, não worktree) e peça: "mostre a folha de contato do vídeo e depois
   o quadro da cena 2". A resposta deve ter a imagem no chat.
6. Peça uma mudança ("deixe o título em amarelo"). Com o app aberto, a tela recarrega, e o Histórico mostra "Claude na IDE",
   com Reverter.
7. Peça "um trecho de 0 a 5 s": o MP4 aparece no chat.
8. Pelo terminal, sem o T3: `cd "<pasta>" && env -u ELECTRON_RUN_AS_NODE claude`, depois `/mcp`. O `estudio` aparece
   conectado.

## Testes

| Arquivo | O quê |
|---|---|
| `testes/ide.test.ts` | comando em dev e empacotado, mesclagem dos três arquivos (preserva, idempotente, aviso), `.gitignore`, git sem commit vazio, desligar, `CLAUDE.md`, `--ide` no `nucleo.cjs`, `t3 project add` com um `t3` falso |
| `testes/previa-mcp.test.ts` | contas (documento, cena, fração, grade, limpeza, nomes, markdown, PNG), as três ferramentas contra um render falso; prova opcional com o render de verdade: `ESTUDIO_PROVA_RENDER=1 npx vitest run testes/previa-mcp.test.ts` |
| `testes/mcp.test.ts` | a lista de ferramentas com as três novas |

## O que ficou de fora

- **Codex, OpenCode e ACP no T3:** exigem mudança no T3, descrita acima. Fora do T3, desde a 2.0.1, cada um tem o seu
  arquivo no projeto (`docs/harnesses.md`).
- **`scripts` no `t3.json`:** por exemplo, "Abrir no Estúdio". A segunda instância do app só traz a primeira para a frente
  e não troca de projeto, então o script não abriria a pasta certa com o app já aberto.
- **Prévia de imagem e de 3D.** Elas desenham na janela, não no Remotion.
- **Permissões prontas.** O `.claude/settings.local.json` não libera as ferramentas do `estudio` em
  `permissions.allow`; a IDE pergunta do jeito dela. Para liberar só as prévias, acrescente à mão
  `"permissions": {"allow": ["mcp__estudio__ver_quadro", "mcp__estudio__ver_cenas", "mcp__estudio__ver_trecho"]}`.
- **Windows:** o caminho com `\` no markdown e o `t3.cmd` não foram testados.
