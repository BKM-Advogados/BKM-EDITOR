# Projetos prontos para qualquer agente (harnesses)

Frente harnesses (branch `frente/harnesses`, 11/11/2026, entra na versão 2.0.1). Antes, só o Claude Code e o T3 Code
achavam no projeto as instruções do app (`CLAUDE.md`) e o MCP `estudio` (`.mcp.json`). Agora cada projeto traz na raiz o
guia e o MCP de cada harness: Codex, Gemini CLI, Antigravity, Cursor, VS Code (Copilot) e opencode, além dos dois de
antes. A opção de Configurações › IA ("Projetos prontos para agentes", `projetos_ide` nas preferências) cobre todos.

## Harness → instrução → MCP

Conferido nas docs oficiais em **11/11/2026**. "Provado aqui" quer dizer que o programa instalado neste PC (Linux)
listou o `estudio` a partir do arquivo que o app escreveu, sem gastar cota de modelo.

| Harness | Arquivo de instrução | Arquivo de MCP (no projeto) | Conferido em | Provado aqui |
|---|---|---|---|---|
| Claude Code e T3 Code (threads Claude) | `CLAUDE.md` | `.mcp.json` + `.claude/settings.local.json` | [memória do Claude Code](https://code.claude.com/docs/en/memory) (já provado em 10/11, `docs/ide.md`) | sim (10/11) |
| Codex (CLI, app e extensão) | `AGENTS.md` | `.codex/config.toml` (só com a pasta confiável) | [MCP no Codex](https://learn.chatgpt.com/docs/extend/mcp?surface=cli), [AGENTS.md no Codex](https://developers.openai.com/codex/guides/agents-md) | **sim**: `codex mcp list` (codex-cli 0.167.1) |
| Gemini CLI | `GEMINI.md` | `.gemini/settings.json` | [GEMINI.md](https://geminicli.com/docs/cli/gemini-md/), [MCP no Gemini CLI](https://geminicli.com/docs/tools/mcp-server/) | não (o `gemini` não está instalado aqui) |
| Antigravity (CLI `agy`, IDE e app) | `AGENTS.md` (lê também o `GEMINI.md`) | `.agents/mcp_config.json` | [regras](https://antigravity.google/docs/rules), [MCP](https://antigravity.google/docs/mcp) | não: o `agy mcp list` só mostra a configuração global |
| Cursor | `AGENTS.md` | `.cursor/mcp.json` | [regras](https://cursor.com/docs/context/rules), [MCP](https://cursor.com/docs/context/mcp) | não (o Cursor não está instalado aqui) |
| VS Code (Copilot) | `AGENTS.md` | `.vscode/mcp.json` (formato `servers`) | [instruções](https://code.visualstudio.com/docs/copilot/customization/custom-instructions), [configuração de MCP](https://code.visualstudio.com/docs/agents/reference/mcp-configuration) | não |
| opencode | `AGENTS.md` (o `CLAUDE.md` só sem `AGENTS.md`) | `opencode.json` (`mcp.servers`) | [regras](https://opencode.ai/docs/rules/), [MCP](https://opencode.ai/docs/mcp-servers/), [config](https://opencode.ai/docs/config/) | não: o formato é o que o `opencode mcp add` 2.2.7 grava, mas o `opencode mcp list` dessa versão não lista nem o servidor que ele mesmo acabou de pôr |

O que cada doc diz, em resumo:

- **Codex.** "you can also scope MCP servers to a project with `.codex/config.toml` (trusted projects only)"; o app do
  ChatGPT, o Codex CLI e a extensão dividem essa configuração. O Codex lê `AGENTS.md` da raiz do projeto até a pasta de
  trabalho (um por pasta; `AGENTS.override.md` vence).
- **Gemini CLI.** Lê `GEMINI.md` por padrão (outros nomes só por `context.fileName`); MCP em `mcpServers` no
  `settings.json`, com `command`, `args`, `env`, `cwd`, `timeout` e `trust`. Servidor stdio só é testado e mostrado como
  conectado em pasta confiável. A própria página avisa que, para parte dos usuários, o Gemini CLI foi substituído pelo
  Antigravity CLI em 18/06/2026.
- **Antigravity.** Regras de workspace em `AGENTS.md`, `GEMINI.md` ou `.agents/rules/*.md` na pasta em que o `agy`
  começa (CLI) ou na pasta do projeto (IDE). MCP em `mcpServers` no `.agents/mcp_config.json` do workspace ou no global
  `~/.gemini/config/mcp_config.json`, o mesmo esquema no app, na IDE e no CLI.
- **Cursor.** "Cursor supports AGENTS.md in the project root and subdirectories"; MCP do projeto em `.cursor/mcp.json`
  (`mcpServers`, `type: "stdio"`).
- **VS Code.** O Copilot lê `.github/copilot-instructions.md` ou `AGENTS.md`. O `.vscode/mcp.json` usa `servers` com
  `type`, `command`, `args`, `env`; a mesma página diz que esse formato é do "Local harness", mantido para configurações
  existentes, e que o Copilot novo prefere `~/.copilot/mcp-config.json` ou o `.mcp.json` da raiz (este com a opção
  experimental `chat.mcp.workspaceRootConfig.enabled`). O app escreve os dois: o `.mcp.json` já existia.
- **opencode.** Lê `AGENTS.md` e, sem ele, `CLAUDE.md` ("The first matching file wins"). A doc da V1 mostra `mcp.<nome>`;
  a da V2 e o esquema atual (`https://opencode.ai/config.json`) mostram `mcp.servers.<nome>` com `type: "local"`,
  `command` em lista e `environment`. O app segue a V2 (instalada aqui: 2.2.7).

## O que o app escreve

Ao criar ou abrir um projeto, com a opção ligada (`src/nucleo/ide.ts`, `src/nucleo/criar-projeto.ts`):

**Os guias** (no git do projeto). Uma fonte só, `guiaDoProjeto(modulos, arquivo)`: o texto que já ia para o `CLAUDE.md`
(os documentos, os campos, as ferramentas MCP, o diário e o Reverter, as prévias) vai igual para o `AGENTS.md` e o
`GEMINI.md`. Só a seção do fim muda, com o que é de cada harness:

| Arquivo | Seção do fim | Onde está o MCP | Como mostrar a imagem da prévia |
|---|---|---|---|
| `CLAUDE.md` | "Trabalhando por uma IDE (T3 Code, Claude Code)" | `.mcp.json` | `![o que é](caminho absoluto)`: o chat do T3 mostra |
| `AGENTS.md` | "Trabalhando por um agente (Codex, Cursor, VS Code, opencode, Antigravity)" | o arquivo de cada um, e o aviso da pasta confiável do Codex | a imagem chega ao modelo pela ferramenta; à pessoa, o caminho absoluto e, se a tela mostra Markdown com imagem, `![...](...)` |
| `GEMINI.md` | "Trabalhando pelo Gemini CLI" | `.gemini/settings.json` e a pasta confiável | a imagem chega ao modelo (`inlineData`); o terminal não mostra, então o caminho absoluto |

**Os arquivos de MCP** (fora do git: têm o caminho do app e da pasta nesta máquina). O mesmo comando do `.mcp.json`: o
executável do app em modo Node (`ELECTRON_RUN_AS_NODE=1`) com o `dist-mcp/nucleo.cjs`, `--projeto`, `--autor agente`,
`--ide` e, fora o do Claude, `--origem` com o nome do harness:

```jsonc
// .gemini/settings.json e .agents/mcp_config.json (sem "type")
{"mcpServers": {"estudio": {"command": "<executável>", "args": ["<recursos>/dist-mcp/nucleo.cjs", "--projeto", "<pasta>",
  "--autor", "agente", "--ide", "--origem", "Gemini CLI"], "env": {"ELECTRON_RUN_AS_NODE": "1"}}}}
// .cursor/mcp.json: o mesmo com "type": "stdio" e --origem Cursor
// .vscode/mcp.json: {"servers": {"estudio": {"type": "stdio", ...}}}, --origem "VS Code"
// opencode.json: {"mcp": {"servers": {"estudio": {"type": "local", "command": ["<executável>", "<nucleo.cjs>", ...],
//   "environment": {"ELECTRON_RUN_AS_NODE": "1"}}}}}, --origem opencode
```

```toml
# .codex/config.toml (o mesmo layout que o próprio `codex mcp add` grava)
[mcp_servers.estudio]
command = "<executável>"
args = ["<recursos>/dist-mcp/nucleo.cjs", "--projeto", "<pasta>", "--autor", "agente", "--ide", "--origem", "Codex"]

[mcp_servers.estudio.env]
ELECTRON_RUN_AS_NODE = "1"
```

## Decisões

- **Uma fonte, três arquivos, conteúdo inteiro em cada um.** O `GEMINI.md` poderia só importar o `AGENTS.md`, mas o
  import é recurso do Gemini CLI, e o Antigravity e outros leriam a linha crua. Custo: o Antigravity, que lê os dois,
  recebe o guia duas vezes. O `CLAUDE.md` continua sendo o que o Claude Code lê (com `CLAUDE.md` na pasta, ele não lê o
  `AGENTS.md`), então ali não há duplicação.
- **Preservação, como no `CLAUDE.md`.** O texto do app fica entre `<!-- estudio:inicio … -->` e `<!-- estudio:fim -->` e é
  refeito ao abrir o projeto; o que a pessoa escreveu fora das marcas fica. Um `AGENTS.md` ou `GEMINI.md` da pessoa, sem
  as marcas, ganha o guia **no fim**, uma vez (sem o guia, o harness não saberia do app). O `CLAUDE.md` escrito à mão
  segue a regra antiga (não é tocado). CRLF continua CRLF. O que não mudou não é regravado, e reabrir não gera commit.
- **O `AGENTS.md` e o `GEMINI.md` seguem a opção.** O `CLAUDE.md` é escrito sempre, como antes. Os outros dois só com a
  opção ligada; desligar não apaga nada.
- **Mesclar sem apagar.** Em cada arquivo de MCP, só os campos do app dentro da entrada `estudio` mudam (o comando, os
  argumentos e o `ELECTRON_RUN_AS_NODE` do ambiente); outros servidores, outras chaves e o que a pessoa pôs dentro do
  `estudio` ficam: uma `GEMINI_API_KEY` no `env` para a narração, o `enabled: false` do opencode, o `trust` e o
  `timeout` do Gemini, o `enabled` e o `tool_timeout_sec` do Codex. Vale também para o `.mcp.json`. Um `estudio` sem o
  `nucleo.cjs` (a pessoa trocou por outro) fica, com aviso em Configurações › IA. No TOML do Codex, só as linhas do app
  nas tabelas `[mcp_servers.estudio]` e `[mcp_servers.estudio.env]` são trocadas no lugar; os comentários (inclusive o
  que apresenta a tabela seguinte), o CRLF e o BOM ficam; o `estudio` escrito de outro jeito (chave pontilhada, tabela
  em linha) fica, com aviso. JSON ilegível não é tocado. A gravação é atômica e no lugar: um symlink continua symlink e o
  modo do arquivo fica.
- **Tudo que tem caminho absoluto vai para o `.gitignore`.** As linhas novas: `.codex/config.toml`,
  `.gemini/settings.json`, `.agents/mcp_config.json`, `.cursor/mcp.json`, `.vscode/mcp.json` e `opencode.json`. Ficam de
  fora do git o arquivo inteiro, mesmo com outras escolhas da pessoa dentro (a alternativa seria versionar caminho desta
  máquina). Um desses arquivos que já estivesse versionado continua versionado: o `.gitignore` não o tira.
- **opencode na raiz.** O `opencode mcp add` grava no `opencode.json` da raiz, e foi isso que o app seguiu. O
  `.opencode/opencode.json` também seria lido e venceria o da raiz, mas brigaria com uma configuração da pessoa ali.
- **Codex: a pasta confiável é decisão da pessoa.** O app não mexe no `~/.codex/config.toml`. Sem confiar na pasta, o
  Codex ignora o `.codex/config.toml` (provado: `codex mcp list` vazio; com `trust_level = "trusted"`, o `estudio`
  aparece). Para quem não quer confiar na pasta, Configurações › IA tem **Copiar comando do Codex** (no Windows, para
  colar no PowerShell: aspas simples, em que nada expande, e o `--` entre aspas, que o PowerShell engoliria), com o
  `codex mcp add estudio --env ELECTRON_RUN_AS_NODE=1 -- <executável> <nucleo.cjs> --projeto <pasta> … --origem Codex`
  do projeto aberto (liga na configuração global; com `--ide`, a pasta em que o Codex abrir vale se for um projeto).
- **A origem de cada harness no diário.** `--origem "Gemini CLI"` (novo no `mcp/nucleo.ts`) faz o diário gravar
  `ide-<id> Gemini CLI`; com o app aberto, o nome vai no cabeçalho `X-Estudio-Origem`. O Histórico mostra "Gemini CLI",
  "Codex", "Cursor"… no lugar de "Claude na IDE". O `.mcp.json` segue sem `--origem` ("Claude na IDE", como antes). O
  desfazer continua por conversa: cada processo tem o seu id.
- **Cursor e o `.mcp.json`.** A doc do Cursor só cita `.cursor/mcp.json`; o `docs/ide.md` de 10/11 dizia que ele lia o
  `.mcp.json`, sem prova. Com os dois, um Cursor que lesse ambos veria o `estudio` duas vezes, com o mesmo nome.

## Para quem não usa a pasta do projeto

Os comandos abaixo ligam o MCP na configuração da pessoa (vale em qualquer pasta). Troque `<executável>` e `<recursos>`
pelos do app instalado (Linux: `~/.local/opt/Estudio/Estudio` e `~/.local/opt/Estudio/resources`; Windows e Mac em
`docs/portes.md`) e `<pasta>` pelo projeto. Com `--ide`, se o agente abrir dentro de outro projeto do Estúdio, vale ele.

- **Codex (CLI, app e extensão, que dividem a configuração).** O botão "Copiar comando do Codex" já monta o comando.
  À mão:
  `codex mcp add estudio --env ELECTRON_RUN_AS_NODE=1 -- <executável> <recursos>/dist-mcp/nucleo.cjs --projeto <pasta> --autor agente --ide --origem Codex`.
  O resultado em `~/.codex/config.toml` é o bloco TOML acima (conferido com um `CODEX_HOME` temporário). O guia: o
  Codex lê o `AGENTS.md` da pasta em que abrir; fora dela, peça ao agente para chamar `guia_do_projeto`.
- **Gemini CLI.** O mesmo bloco `mcpServers` em `~/.gemini/settings.json` (o formato da tabela acima). O guia vem do
  `GEMINI.md` da pasta ou da ferramenta `guia_do_projeto`.
- **Antigravity (`agy`).**
  `agy mcp add --env ELECTRON_RUN_AS_NODE=1 estudio -- <executável> <recursos>/dist-mcp/nucleo.cjs --projeto <pasta> --autor agente --ide --origem Antigravity`
  (as opções vêm antes do nome). Grava em `~/.gemini/config/mcp_config.json`, conferido com um `HOME` temporário, e
  `agy mcp list` mostra o servidor.
- **ChatGPT no navegador (e no app desktop, nas conversas comuns).** Só aceita MCP **remoto**, por HTTPS público, no modo
  de desenvolvedor dos conectores (segundo docs de terceiros; não achei a página da OpenAI que confirme planos e menus).
  O MCP do Estúdio é local: stdio, ou HTTP em `127.0.0.1` com o app aberto. **Não dá** para ligar o ChatGPT web nele
  sem expor o PC na internet por um túnel, e isso não recomendamos: quem tiver o endereço mexe no projeto. O que dá:
  anexar o `AGENTS.md` e um documento JSON à conversa e aplicar à mão o que ele sugerir (sem diário de origem, sem
  Reverter pelo agente). O Codex do ChatGPT desktop é outra coisa e funciona, pela configuração do Codex acima.
- **Gemini no navegador (gemini.google.com).** Mesma situação: o que existe para servidor próprio são "apps conectados"
  por URL remota, com restrições de plano, idioma e país relatadas por terceiros (não confirmadas na ajuda do Google).
  Servidor local por stdio, não. O que dá: o mesmo anexo do ChatGPT.

## Testar de ponta a ponta

1. `npm run mcp:build`, `env -u ELECTRON_RUN_AS_NODE npm run dev`, crie ou abra um projeto numa pasta de teste.
2. Na pasta: `AGENTS.md`, `GEMINI.md`, `.codex/config.toml`, `.gemini/settings.json`, `.agents/mcp_config.json`,
   `.cursor/mcp.json`, `.vscode/mcp.json`, `opencode.json`, e as linhas novas do `.gitignore`. Reabrir não gera commit.
3. Codex: `cd "<pasta>" && codex mcp list` mostra o `estudio` depois de confiar na pasta. Gemini CLI: `gemini mcp list`
   (com a pasta confiável). Antigravity: abra o `agy` na pasta e veja os servidores da sessão.
4. Peça uma mudança pelo agente: o Histórico do app mostra o nome dele ("Codex", "Gemini CLI"…) com Reverter.

## Testes

| Arquivo | O quê |
|---|---|
| `testes/harnesses.test.ts` | os três guias da mesma fonte; o que a pessoa escreveu fora das marcas (e o arquivo dela sem marcas); CRLF; idempotência; a mesclagem de cada formato (Gemini, Antigravity, Cursor, VS Code, opencode, TOML do Codex) com o que a pessoa tinha; caminho do Windows no TOML; `codex mcp add` com as aspas do Linux e do Windows; `.gitignore` e git sem commit ao reabrir; desligar não apaga; com o `codex` no PATH, `codex mcp list --json` lista o `estudio` só com a pasta confiável (`CODEX_HOME` temporário) |
| `testes/mcp-app.test.ts` | `--origem`: a origem `ide-<id> Gemini CLI` pelo app (cabeçalho) e sem ele; os nomes aceitos |
| `testes/ide.test.ts` | os de 10/11, com a lista de arquivos e o `.gitignore` dos harnesses |

## O que ficou de fora

- **Provar Gemini CLI, Antigravity (no projeto), Cursor, VS Code e opencode.** O Gemini CLI e o Cursor não estão
  instalados aqui. O `agy mcp list` só lista a configuração global, e provar o `.agents/mcp_config.json` pediria abrir
  uma sessão (cota de modelo). O `opencode mcp list` 2.2.7 não lista servidor de projeto nenhum.
- **Confiar na pasta pelo app** (Codex e Gemini CLI). É decisão de segurança da pessoa, no programa dela.
- **Codex, OpenCode e ACP dentro do T3 Code.** Segue o que `docs/ide.md` descreve: precisa de mudança no T3.
- **Desligar por harness.** A opção é uma só para todos.
- **ChatGPT e Gemini no navegador ligados ao MCP.** Exigiriam um MCP remoto e público, fora do desenho do app.
