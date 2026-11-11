# Arquitetura do Estúdio

Versão 1, de 05/11/2026. Junta a proposta A ("documento primeiro"), a proposta B ("módulos e desempenho primeiro") e a frente de desempenho (`docs/desempenho.md`). Este documento manda; onde ele diverge das três, vale o que está aqui. O que não tem fonte lida está marcado **[inferência]**. O que foi conferido nesta pasta em 05/11/2026 está marcado **[lido]**.

Fixo e fora de discussão: app desktop sem servidor (Windows primeiro, macOS depois), Electron + React + TypeScript, Remotion (Player na prévia, `renderMedia`/`renderStill` na exportação), terminais xterm.js + node-pty rodando o `claude` da própria pessoa, MCP próprio `nucleo`, documentos JSON editados por JSON Patch com lock otimista e diário, git na pasta do projeto, `comentarios.json` universal e motor Python portado para TS.

---

## 0. Conflitos resolvidos

| Tema | A | B | Desempenho | **Decisão** | Por quê |
|---|---|---|---|---|---|
| Onde mora o núcleo (docs, patch, diário, git, watcher) | main | utilityProcess `nucleo` | main | **main**, como classe atrás de um contrato de mensagens | Os documentos têm KB e um patch leva menos de 5 ms [inferência]. Um processo a menos economiza de 30 a 50 MB no notebook de 8 GB. O contrato por mensagens (`src/contratos`) permite levar o núcleo para um utilityProcess sem reescrever, e isso será feito se a medição mostrar *long task* acima de 50 ms no main |
| Transporte do MCP para as abas do app | stdio + ponte por pipe | stdio + ponte por pipe | HTTP local | **Streamable HTTP em 127.0.0.1, servido pelo main.** O stdio fica só para uso fora do app (CLI, pós-MVP) | Por HTTP, nenhuma aba sobe processo. Por stdio, cada aba ganha uma árvore de 80 a 150 MB, segundo relato citado no `desempenho.md`. Também some a ponte por pipe, e o `runAsNode` pode ficar desligado no MVP. **Isso revisa a decisão "stdio"**: o registro das ferramentas é o mesmo e só muda o transporte |
| Repositório | pnpm workspaces | npm workspaces, ~15 pacotes | — | **Pacote npm único, com camadas em pastas e fronteiras checadas por lint** | O protótipo já roda num pacote só com Forge + Vite [lido]. Workspaces trazem atrito com Forge, módulo nativo e hoisting sem ganho para um app só. O VS Code também é um pacote com camadas [inferência] |
| Versão do documento | hash do conteúdo | `rev` numérico em memória | — | **Hash do conteúdo** (`sha256:` + 12 hex) | É estável entre processos, sobrevive a reinício e a edição externa e não suja o git. A ordem global fica no `seq` do diário |
| Concorrência | estrito para a pessoa, tolerante para o agente | rebase semântico por prefixo de caminho | — | **Uma regra para todos:** passa se a base é a atual; senão, passa se os testes de id passam e nenhum alvo (`id/campo`) foi tocado desde a base | Dá a segurança da A com a fluidez da B. O alvo por id não quebra quando um array muda de índice |
| Endereçamento | `editar_objeto` por id | segmento `@id` no ponteiro | — | **As duas.** `@id` em `aplicar_patch` e as ferramentas de alto nível `editar_objeto`, `inserir_objeto`, `remover_objeto` e `mover_objeto`. O diário guarda RFC 6902 puro | O agente nunca conta índice |
| Biblioteca de patch | própria | Mutative | — | **Própria**, em `src/doc` (aplicar, inversa com `test`, `@id`, cópia só do caminho alterado) | É preciso inversa com testes, `@id` e compartilhamento estrutural para o `React.memo`. O `fast-json-patch` do protótipo sai |
| Envelope | `tipo`, `v`, `id`, `$schema` = caminho | `$tipo`, `$schema` = número, `$id` | — | **`$schema` (caminho do JSON Schema), `$tipo`, `$v`, `$id`** | O `$` separa envelope de conteúdo (blocos já têm `tipo`). O `$schema` como caminho dá validação grátis no VS Code |
| Pastas do projeto | `videos/carrossel/`, `imagens/`… | `docs/` + `midia/` + `diario/` | — | **`docs/` plano com sufixo por tipo, `midia/`, `diario/` versionado, `.estudio/` todo fora do git** | O `.gitignore` fica de uma linha, e o agente acha tudo por glob |
| Constantes do motor (1600/3500/1200/500, marca, final, dúvida) | viram campos do documento | ficam fora | — | **Campos do roteiro, com padrão no schema** | O agente não muda o que não vê |
| Narração na prévia | segmentos da fonte com `trimBefore` | `narracao.wav` pronto | — | **Segmentos da fonte**, já que o vídeo-fonte da narração está na `midia/` do exemplo [lido]. Projeto sem fonte usa o wav com o aviso "pausas travadas" | Mudar uma pausa vira só recálculo, sem ffmpeg |
| Motor de efeitos no MVP | `@remotion/effects` na mídia + CSS no DOM | idem, com catálogo | CSS no vídeo, WebGL2 compartilhado na imagem | **Um compilador só: CSS `filter` + filtro SVG + camada sobreposta, para todo alvo.** `@remotion/effects` fica para a fase 2, na mídia | Nenhum contexto WebGL a mais e o mesmo resultado em qualquer alvo (bloco, foto, camada, vídeo inteiro). O mesmo Chromium desenha a prévia e o render [inferência]. Isso também tira do caminho crítico a licença `UNLICENSED` do pacote |
| Schema dos efeitos | união discriminada tipada | `{efeito, params}` genérico | — | **União discriminada gerada de um catálogo** | O agente recebe um JSON Schema preciso, e um efeito novo é uma entrada no catálogo |
| PNG da Imagem | `renderStill` | `renderStill` | Worker com OffscreenCanvas | **`renderStill` no render-host** | Um motor de pixel só, com paridade. O Worker fica como otimização da fase 2, se o tempo medido incomodar |
| Desfazer | pilhas em memória | derivado do diário | — | **Derivado do diário** (`desfaz`/`desfeito_por`) | Sobrevive a reinício e é o mesmo para a pessoa e para o agente |
| Resolvedor no renderer | Web Worker | thread da UI | — | **Thread da UI, com memo por versão**; vai para Worker se passar de 8 ms medidos | Menos de 2 ms no carrossel de referência [inferência]. O Worker teria custo de cópia sem ganho |
| Arraste | valor provisório no resolvido | DOM imperativo | — | **DOM imperativo** para mover e redimensionar (vídeo e imagem). Sliders do painel usam valor provisório nas props, a no máximo um por quadro | 60 fps sem render do React durante o gesto |
| Git | checkpoint no `Stop`, ocioso 30 s, export, marcar versão | um autor por commit, 8 s | — | **Gatilhos da A + um autor por commit da B** (checkpoint forçado quando muda o autor) | Um `git revert` limpo desfaz um lote do agente |
| Versões | Electron 45 | Electron 45 | — | **Electron 45.x** (o protótipo está no 42, sem suporte desde 20/10/2026), Remotion 4.0.540 em todos os `@remotion/*`, Zod 4, MCP SDK v2, chokidar 4.0.3 (JS puro, já instalado), `@lydell/node-pty` 1.2.0-beta.18 (prebuild, já instalado) | — |

---

## 1. Visão em uma tela

```
┌─────────────────────────────── Electron · uma janela ────────────────────────────────────┐
│ RENDERER (sandbox, contextIsolation, sem Node)                                             │
│  Casca: barra de áreas · painéis · paleta de comandos · selo de RAM                         │
│  Área visível (chunk preguiçoso): Vídeo | Imagem | 3D | Efeitos                             │
│    Vídeo:  <Player> 0,5× + overlay de seleção + Timeline + Propriedades                     │
│    Imagem: <Thumbnail> + alças + Camadas + Propriedades                                     │
│    3D:     <Canvas frameloop="demand"> R3F + TransformControls + OrbitControls              │
│    Efeitos: pilha do alvo selecionado + prévia                                              │
│  Terminal: xterm.js 6, abas ──── MessagePort direto ─────────────────────┐                 │
│  Estado: cache dos docs (aplica EventoDoc), seleção, tempo               │                 │
│        ▲ window.estudio.invoke/on (canais tipados, Zod na borda)          │                 │
├────────┼──────────────────────────────────────────────────────────────────┼────────────────┤
│ MAIN   │                                                                  │                 │
│  NÚCLEO: Projeto · DocStore · aplicar() · Diário · Desfazer · Comentários │                 │
│          Watcher (chokidar) · Git (checkpoints) · Estado do editor        │                 │
│  HTTP 127.0.0.1:<porta aleatória>                                         │                 │
│     /m/<token>/<caminho>   mídia com Range (Player e render)              │                 │
│     /mcp                   MCP nucleo (Streamable HTTP, Bearer por aba)   │                 │
│     /h/<rota>              hooks do Claude Code (Bearer por aba)          │                 │
│  capturePage · diálogos · menu · supervisor dos utilityProcess            │                 │
├────────┬───────────────────────────────────┬──────────────────────────────┼────────────────┤
│        │ fork sob demanda                  │ fork no 1º terminal          │                 │
│  ┌─────▼──────────────┐            ┌───────▼───────────┐◄─────────────────┘                 │
│  │ utility "render"   │            │ utility "pty"     │                                    │
│  │ renderMedia/Still  │            │ node-pty (ConPTY) │                                    │
│  │ morre após 2 min   │            │ lotes + controle  │                                    │
│  └─────┬──────────────┘            └───────┬───────────┘                                    │
└────────┼───────────────────────────────────┼───────────────────────────────────────────────┘
         ▼                                   ▼ um por aba
  Chrome Headless Shell (Remotion)     claude (CLI da pessoa) ──HTTP──► /mcp e /h/* do main

Disco (pasta do projeto) = verdade:  docs/*.json · comentarios.json · diario/*.jsonl · midia/ · .git
Toda escrita (UI, MCP, arquivo editado por fora) → PedidoPatch → aplicar() → disco + diário + EventoDoc
Um bundle Remotion (Roteiro, Imagem, Cena3D) desenha a prévia, a camada de outro documento e a exportação
```

**As cinco regras que seguram o resto**

1. O arquivo JSON é a verdade. A interface e o agente são dois editores do mesmo arquivo.
2. Todo objeto tem `id` único no documento, e o endereço universal é `docs/<arquivo>.json#<id>`.
3. Toda escrita vira RFC 6902 com versão base, autor e origem, e gera uma linha no diário.
4. Um componente Remotion por tipo de documento serve à prévia, à composição dentro de outro documento e à exportação. Editores (alças, gizmo, alfinetes) nunca entram na árvore renderizada.
5. Um schema Zod por tipo gera os tipos TS, a validação, o JSON Schema que o agente lê e o formulário do painel de propriedades.

---

## 2. Modelo de processos

| Processo | Sobe | Faz | Não faz |
|---|---|---|---|
| **main** | na abertura | janela, menu, diálogos, IPC, **núcleo**, watcher, git, servidor HTTP (mídia, MCP, hooks), `capturePage`, supervisão dos utilities, métricas (`app.getAppMetrics`) | I/O síncrono; tarefa de CPU acima de 10 ms; render; PTY |
| **renderer** | na abertura | toda a interface, Player, Thumbnail, R3F, xterm.js, resolução do roteiro (memo por versão) | acesso a disco (só via `window.estudio`) |
| **utility "pty"** | no 1º terminal | todas as abas (node-pty/ConPTY), lotes de 8 a 16 ms, pausa e retomada por ACK | qualquer outra coisa |
| **utility "render"** | no 1º export, PNG ou `quadro` | `selectComposition`, `renderMedia`, `renderStill`, fila de um job, cancelamento | fica vivo 2 min depois do último job e encerra |
| **claude** (externo) | ao abrir aba `claude` | o CLI da pessoa, com o login dela | — |
| **Chrome Headless Shell** (externo) | dentro do render | páginas do Remotion | — |

**Detalhes**

- `utilityProcess.fork(modulo, [], {serviceName: 'estudio-pty'})` só depois do `ready`. Para ligar o renderer direto ao pty: o main cria `MessageChannelMain`, manda `port1` ao renderer (`webContents.postMessage('estudio:porta', {aba}, [port1])`, que o preload repassa com `window.postMessage`) e `port2` ao utility (`child.postMessage(msg, [port2])`). Depois disso, o main não fica no caminho dos bytes.
- **Plano B** (se node-pty ou `@remotion/renderer` falharem dentro de um utilityProcess): pty no main, render em `child_process.fork` com `ELECTRON_RUN_AS_NODE=1`. A decisão sai no passo 1 do MVP. A doc do utilityProcess não fala de módulo nativo; o VS Code usa esse arranjo para o pty host [inferência a partir do PR 178708].
- **O renderer é descartável.** O estado mora no main e no disco. Em `render-process-gone`, o main recarrega a janela e restaura área, documento e seleção a partir de `.estudio/estado-ui.json`.
- **Núcleo fora do main, se precisar.** Toda chamada ao núcleo passa por `Nucleo` (interface em `src/contratos/nucleo.ts`), com entradas e saídas serializáveis. Mover para um utilityProcess é trocar a implementação local por um cliente de MessagePort.

---

## 3. Repositório

Pacote npm único em `%USERPROFILE%\projetos\estudio`, desenvolvido localmente no PC (não no Mac). TypeScript estrito, Electron Forge 7.11 + Vite (do template oficial Remotion + Electron, em `referencia/template-electron` [lido]) e vitest. Os entrypoints extras do Forge (`hosts/pty-host.ts`, `hosts/render-host.ts`) entram em `plugins[0].build` com `target: 'main'`.

```
estudio/
  package.json  forge.config.ts  vite.main.config.ts  vite.preload.config.ts  vite.renderer.config.ts
  tsconfig.json  vitest.config.ts  eslint.config.js      # regras de fronteira entre camadas
  src/
    contratos/        # só tipos, zero dependências: Autor, Origem, Op, PedidoPatch, ResultadoPatch, EntradaDiario,
                      #   EventoDoc, CanaisInvoke/CanaisEvento, MensagensPty, MensagensRender, PerfilAba, Nucleo
    doc/              # sem Node: ponteiro.ts (RFC 6901 + @id), patch.ts (aplicar, inversa), diff.ts (arrays por id),
                      #   indice.ts (id → ponteiro), alvos.ts (ponteiro → "id/campo"), formatar.ts, versao.ts (hash)
    schemas/          # Zod 4: envelope, projeto, roteiro, imagem, cena3d, efeitos, comentarios; registro.ts (tipo →
                      #   schema, sufixo, ids, refs, migrações); meta-ui.ts; gerar-json-schema.ts
    motor/            # porta do preparar_carrossel.py: ancoras, narracao (cortes, mapa de tempo, segmentos),
                      #   resolver-roteiro, legendas, sons, encaixe na palavra (base: src/nucleo/roteiro/resolver.ts)
    efeitos/          # catalogo.ts (Zod + padrão + compilador por efeito), compilar.ts (pilha → filter/SVG/overlays),
                      #   ruido.ts (ladrilhos determinísticos)
    composicoes/      # Remotion, sem Node nem Electron: Raiz.tsx, entrada.ts, midia.ts (midiaUrl), fontes/ (woff2),
                      #   ComEfeitos.tsx, roteiro/ (CarrosselTema, CarrosselNarrado, anim, Caixa com data-estudio-id),
                      #   imagem/ImagemView.tsx, cena3d/Cena3DConteudo.tsx + Cena3DCamada.tsx
    nucleo/           # Node: projeto.ts, docstore.ts, aplicar.ts, diario.ts, desfazer.ts, comentarios.ts,
                      #   reancorar.ts, watcher.ts, git.ts, checkpoint.ts, estado-editor.ts
    mcp/              # ferramentas.ts: registro único das ferramentas sobre a interface Nucleo (HTTP agora, stdio depois)
    main/             # main.ts, janela.ts, ipc.ts (registrar + Zod + senderFrame), http.ts (rotas /m /mcp /h),
                      #   hooks.ts, terminais.ts (perfil de aba, arquivos de sessão), render.ts (fila, fork),
                      #   captura.ts, claude.ts (detectar), perfil-maquina.ts, metricas.ts, supervisor.ts,
                      #   compositor-package.ts e packaged-browser.ts (do protótipo)
    hosts/            # pty-host.ts, render-host.ts
    preload/          # preload.ts
    renderer/         # main.tsx, casca/, modulos.ts (manifesto + import()), areas/{video,imagem,cena3d,efeitos}/,
                      #   paineis/ (Propriedades gerado do schema, Timeline, Camadas, Comentarios, Diario),
                      #   overlay/ (seleção, alças, alfinetes), terminal/, estado/ (docs, editor, provisorio), comandos.ts
  testes/             # vitest: doc, schemas, motor (dourado), nucleo, mcp; e2e/ (Playwright em modo Electron)
  exemplos/teste/     # projeto de exemplo (seção 4)
  referencia/         # motor-mac e template-electron (somente leitura)
  docs/               # arquitetura.md (este), desempenho.md, estilo.md (frente de estilo)
```

**Regras de dependência** (ESLint `no-restricted-imports`, mais um teste que falha o build):

| Camada | Pode importar | Não pode importar |
|---|---|---|
| `contratos` | nada | — |
| `doc` | `contratos` | Node, React |
| `schemas` | `contratos`, `doc`, `zod` | Node, React |
| `motor`, `efeitos` | os anteriores | Node, Electron |
| `composicoes` | os anteriores, `remotion`, `@remotion/*`, `three` e R3F (por `import()`) | Node, Electron |
| `nucleo`, `mcp` | `contratos`, `doc`, `schemas`, `motor`, `node:*` | React, Electron, Remotion |
| `main`, `hosts` | tudo menos `renderer` | `renderer` |
| `renderer` | `contratos`, `doc`, `schemas`, `motor`, `efeitos`, `composicoes` | `nucleo`, `main`, Node |

**O que vem do protótipo** (≈ 3,2 mil linhas, sem commit [lido]):

- `src/nucleo/roteiro/resolver.ts` e `testes/resolver.test.ts`: porta com teste dourado e arredondamento par. Vai para `src/motor`.
- `src/nucleo/roteiro/ids.ts`: migração de ids. Vai para `src/schemas/migracoes`.
- `src/composicoes/carrossel/*`, `anim.ts`, `midia.ts`.
- `src/main/servidor-midia.ts`, `compositor-package.ts`, `packaged-browser.ts`, `exportar.ts` e `terminais.ts`.
- O `terminais.ts` passa a lançar o `claude` direto no PTY, sem PowerShell, e muda para o pty-host.
- **Sai:** `fast-json-patch`, `@remotion/google-fonts` (troca por woff2 local com `@remotion/fonts`), MCP SDK v1, Zod 3 e o `mcp/nucleo.ts` stdio, que vira `src/mcp/ferramentas.ts`.
- A escolha da biblioteca de painéis (o `dockview` do protótipo) é da frente de estilo. Esta arquitetura só exige que cada área seja um componente montável e desmontável.

---

## 4. Projeto em disco

```
teste/                                    # pasta aberta em "Abrir projeto"
  estudio.json                            # $tipo "projeto"
  CLAUDE.md                               # guia do projeto para o agente (gerado, editável)
  docs/
    carrossel.roteiro.json                # $tipo "roteiro"
    capa.imagem.json                      # $tipo "imagem"
    anel.cena3d.json                      # $tipo "cena3d"
    quente.efeitos.json                   # $tipo "efeitos" (predefinição reutilizável)
  comentarios.json                        # $tipo "comentarios"
  diario/2026-11.jsonl                    # diário (versionado, um arquivo por mês)
  midia/
    carrossel/fonte.mp4  carrossel/palavras.json  carrossel/narracao.wav (opcional)
    fotos/cidade.jpg  marca/logo.png  sfx/*.wav  3d/*.glb  fontes/*.woff2 (só as do projeto)
  saidas/                                 # renders (fora do git)
  .estudio/                               # fora do git: estado-ui.json, quadros/ (PNG dos comentários),
                                          #   cache/ (quadros do MCP, resolvidos), escritor.lock
  .gitignore                              # saidas/  .estudio/  *.tmp
  .gitattributes                          # *.json text eol=lf ; LFS opcional em midia/**
```

- **Descoberta:** `docs/**/*.{roteiro,imagem,cena3d,efeitos}.json`, sem lista de documentos no manifesto. O endereço de um documento é o caminho relativo.
- **`palavras.json`** é mídia derivada (transcrição `[{w, s, e, p}]`), só leitura, sem envelope.
- **Configs de sessão das abas** (com token) ficam em `<userData>/sessoes/<projeto-hash>/aba-N.*.json`, fora da pasta do projeto, longe do git e do OneDrive.
- **Importar do motor antigo** (`ferramentas/importar-motor.ts`):
  1. copia roteiro, palavras, fonte, sfx, foto e logo;
  2. reescreve os caminhos para `midia/...`;
  3. gera ids;
  4. explicita constantes e marca;
  5. grava com o formatador estável.
- **O projeto de exemplo** já existe no formato do protótipo (`video/`, `imagem/`, `3d/`) [lido]. A importação o converte para o formato acima no passo 2 do MVP.

---

## 5. Envelope e tipos-base (`src/contratos/tipos.ts`, `src/schemas/envelope.ts`)

```ts
export type TipoDoc = 'projeto' | 'roteiro' | 'imagem' | 'cena3d' | 'efeitos' | 'comentarios';
export type Id = string;                        // /^[a-z][a-z0-9-]{0,63}$/, único no documento inteiro (todos os níveis)
export type CaminhoDoc = string;                // relativo à raiz, com '/': "docs/carrossel.roteiro.json"
export type CaminhoMidia = `midia/${string}`;
export type Versao = `sha256:${string}`;        // 12 hex do texto formatado com LF; nunca gravada no arquivo
export type Ponteiro = string;                  // RFC 6901; na entrada aceita segmentos "@id"
export type Ref = `${CaminhoDoc}#${Id}`;        // "docs/carrossel.roteiro.json#parte2-numero"
export type Ancora = string;                    // palavra@ms | palavra$@ms (fim da palavra) | palavra@ms+120 | palavra@ms-150
export type Cor = `#${string}`;
export type Vec3 = [number, number, number];

export interface Envelope<T extends TipoDoc> {
  $schema: string;     // "../.estudio/schemas/roteiro.v1.json" (ver nota abaixo)
  $tipo: T;
  $v: number;          // versão do schema do tipo; o núcleo migra ao abrir (com entrada 'migracao' no diário)
  $id: string;         // "doc_" + 10 caracteres base32; estável se o arquivo mudar de nome
  nome?: string;
  notas?: string;      // texto livre para a pessoa e o agente
}
export interface Objeto { id: Id; nome?: string }

export type Curva = 'linear' | 'suave' | 'entrada' | 'saida' | 'mola';
export interface Chave<V> { t_ms: number; v: V; curva?: Curva }
export type Animavel<V> = V | {chaves: Chave<V>[]};   // tipo pronto; UI de chaves fica fora do MVP

export type Autor =
  | {tipo: 'pessoa'; id: string}                              // "ana"
  | {tipo: 'agente'; aba: string; sessao?: string}            // "aba-3", UUID do --session-id
  | {tipo: 'sistema'; motivo: 'migracao' | 'importacao' | 'reancoragem'}
  | {tipo: 'externo'; ferramenta?: string};                   // editor de texto, git checkout sem atribuição
export type Origem = 'ui:canvas' | 'ui:painel' | 'ui:timeline' | 'ui:camadas' | 'ui:gizmo' | 'ui:efeitos'
  | 'ui:comentario' | 'mcp' | 'arquivo' | 'desfazer' | 'refazer' | 'reverter' | 'migracao' | 'git';
```

- **`$schema`:** o app escreve os JSON Schemas gerados em `.estudio/schemas/<tipo>.v<n>.json`. O `$schema` aponta para lá por caminho relativo (`"../.estudio/schemas/roteiro.v1.json"`), e o VS Code valida o arquivo aberto à mão. O caminho é recriado ao abrir o projeto, porque `.estudio/` não vai para o git.
- **Envelope plano:** o conteúdo fica lado a lado com os campos `$`. Os ponteiros continuam curtos (`/cenas/2/blocos/1/y`).
- **Ids legíveis, gerados pela UI e pelo MCP:** `parte2-numero`, `parte3-cartao-1`, `cubo-2`. O padrão é `<pai>-<tipo>[-n]`.
- **Formatador estável** (`doc/formatar.ts`): indentação de 1 espaço e objeto-folha numa linha quando couber em 140 colunas, no estilo do `roteiro.json` atual [lido]. A versão é o hash dessa forma. O formatador é idempotente, e um teste garante `formatar(parse(formatar(x))) === formatar(x)`.

---

## 6. Schemas por módulo (`src/schemas`)

Os tipos abaixo são `z.infer` dos schemas Zod 4. O JSON Schema sai de `z.toJSONSchema()` (Draft 2020-12). A meta de UI vai por `.meta({rotulo, controle, min, max, passo, unidade, grupo})`, e o painel de propriedades é gerado dela.

### 6.1 Roteiro (`$tipo: 'roteiro'`)

Evolução direta do `roteiro.json` do carrossel de referência [lido]. Muda o envelope, entram ids em cena, linha, bloco, item, barra, marca e faixa, entram as constantes e a marca como campos, e chegam os blocos que trazem outros módulos.

```ts
export interface DocRoteiro extends Envelope<'roteiro'> {
  tema: 'carrossel-narrado';                              // componente que desenha (registro em composicoes/roteiro)
  variante?: string;                                 // "neutro" (era o campo "tema")
  formato: {largura: number; altura: number; fps: number};          // 1080 × 1920 × 30
  fonte?: CaminhoMidia;                              // "midia/carrossel/fonte.mp4" → narração por segmentos
  narracao?: CaminhoMidia;                           // wav já cortado; só sem `fonte` ("pausas travadas")
  palavras: CaminhoMidia;                            // "midia/carrossel/palavras.json"
  rotulo_partes: string;
  tempos?: {abertura_ms?: number; final_ms?: number; pausa_gancho_ms?: number; pausa_parte_ms?: number}; // 1600/3500/1200/500
  pausas?: (Objeto & {depois_de: Ancora; ms: number})[];
  marca: {nome: string; site: string; insta: string; logo?: CaminhoMidia};
  decisao?: {titulo: string; linha: string};
  final: {titulo: string; aviso: string};
  duvida: {pergunta: string; resposta: string};
  foto?: {src: CaminhoMidia; credito: string};
  audio?: {ganho_narracao_db?: number; alvo_lufs?: number; efeitos_abaixo_mediana_lu?: number}; // 0 / −14 / 23
  efeitos?: PilhaEfeitos;                            // no quadro inteiro
  cenas: Cena[];                                     // [gancho, ...parte, duvida], validado
}
interface CenaBase extends Objeto { modo?: 'claro' | 'escuro'; tag?: string }
export type Cena =
  | (CenaBase & {tipo: 'gancho'; linhas: Linha[]; y_linhas?: number; blocos: Bloco[]})
  | (CenaBase & {tipo: 'parte'; inicio: Ancora; pausa?: number; titulo: string; n?: number; blocos: Bloco[]})
  | (CenaBase & {tipo: 'duvida'; inicio: Ancora; pausa?: number});
export type Linha = Objeto & {t: string; em: Ancora; sai?: Ancora; cor?: 'cobre'};
type Item = Objeto & {texto: string; em: Ancora};
type Barra = Objeto & {rotulo: string; valor: number; em: Ancora; destaque?: boolean};
type MarcaRegua = Objeto & {v: number; rotulo: string; em: Ancora};
type Faixa = Objeto & {de: number; ate: number; rotulo?: string; em: Ancora; tom?: 'cobre' | 'profundo' | 'grafite'};

interface BlocoBase extends Objeto {
  em?: Ancora; sai?: Ancora;           // sem `em`: o menor `em` aninhado, ou início da cena + 300 (regra do Python)
  y: number; x?: number; largura?: number;           // padrão 70 e 940
  tam?: number; rot?: number; alinhar?: 'centro' | 'esquerda';
  efeitos?: PilhaEfeitos;
  som?: false | {src: CaminhoMidia; vol: number; desloc_ms?: number};    // sobrepõe a regra automática de som
}
export type Bloco =
  | (BlocoBase & {tipo: 'cartao' | 'nota' | 'frase' | 'carimbo'; texto: string})
  | (BlocoBase & {tipo: 'numero'; de: number; ate: number; prefixo?: string; sufixo?: string; rotulo?: string; nota?: string})
  | (BlocoBase & {tipo: 'grande'; texto: string; rotulo?: string; nota?: string})
  | (BlocoBase & {tipo: 'itens'; itens: Item[]; marcador?: 'check' | 'numero' | 'x' | 'ponto'})
  | (BlocoBase & {tipo: 'comparacao'; barras: Barra[]; unidade?: string})
  | (BlocoBase & {tipo: 'regua'; escala: [number, number]; marcas?: MarcaRegua[]; faixas?: Faixa[]})
  | (BlocoBase & {tipo: 'documento'; texto: string; nota?: string; carimbo?: {texto: string; em: Ancora}})
  | (BlocoBase & {tipo: 'selo'; titulo?: string; linha?: string})
  | (BlocoBase & {tipo: 'foto'; src?: CaminhoMidia; credito?: string})
  // outros módulos como camada do vídeo
  | (BlocoBase & {tipo: 'imagem'; doc: CaminhoDoc; altura?: number})
  | (BlocoBase & {tipo: 'cena3d'; doc: CaminhoDoc; altura: number; camera?: Id; inicio_cena_ms?: number; velocidade?: number})
  | (BlocoBase & {tipo: 'video'; src: CaminhoMidia; altura: number; corte_ms?: [number, number]; volume?: number}); // fase 2
```

O roteiro aceita só âncoras em `em`/`sai`, sem ms soltos. Isso mantém a paridade com o Python. Vídeo de montagem com tempo livre vira outro tipo de documento (seção 19).

**Regras semânticas** (validadas a cada patch, além do Zod):

- ids únicos em todos os níveis;
- `gancho` primeiro e `duvida` por último;
- todo `doc` referenciado existe e o grafo de referências não tem ciclo.

Âncora que não resolve vira **aviso** com a lista "Perto:", como no Python. Tempo fora da cena (±100 ms) e bloco sem `y` também são avisos. Avisos não bloqueiam a escrita.

**Saída do motor (`src/motor`)**: substitui o `props.json`, vive só em memória e no cache e nunca é gravada no projeto.

```ts
export interface Palavra { w: string; s: number; e: number; p?: number }
export interface MapaTempo { abertura_ms: number; cortes: {fonte_ms: number; pausa_ms: number}[] }  // ordenados
export interface SegmentoAudio { src: CaminhoMidia; de_fonte_ms: number; ate_fonte_ms: number; em_saida_ms: number; ganho_db: number }
export interface OrigemObj { id: Id; ponteiro: Ponteiro; em_saida?: number; sai_saida?: number; em_ancora?: Ancora; sai_ancora?: Ancora }
export interface RoteiroResolvido extends PropsCarrosselTema {   // as props atuais do CarrosselTema, mais:
  versao: Versao; duracao_ms: number;
  narracao: SegmentoAudio[];          // vazio quando usa `narracao` wav
  mapa: MapaTempo;
  origem: Record<Id, OrigemObj>;      // overlay, timeline, comentário e MCP usam isto
  anexos: Record<CaminhoDoc, {versao: Versao; doc: DocImagem | DocCena3D | DocEfeitos}>;
  avisos: {nivel: 'aviso' | 'erro'; id?: Id; ponteiro?: Ponteiro; texto: string}[];
}
export function resolverRoteiro(doc: DocRoteiro, palavras: Palavra[], anexos: RoteiroResolvido['anexos']): RoteiroResolvido;
export const fonteParaSaida = (m: MapaTempo, ms: number): number =>
  arredondarPar(m.abertura_ms + ms + m.cortes.filter((c) => c.fonte_ms <= ms).reduce((s, c) => s + c.pausa_ms, 0));
export function saidaParaFonte(m: MapaTempo, ms: number): {fonte_ms: number; em_pausa: boolean};
export function encaixarNaPalavra(p: Palavra[], fonte_ms: number, raio_ms?: number): Ancora;   // "Aceitar@60400" | "Aceitar$@60400"
export function frases(p: Palavra[], de_ms?: number, ate_ms?: number): string[];              // o --frases do Python
```

**Cuidados da porta** [lido no Python e no protótipo]:

- O `round()` do Python arredonda o meio para o par. O `arredondarPar()` do protótipo já cobre isso e tem teste.
- `norm()` é NFD, sem marcas, caixa ou pontuação.
- A resolução troca **qualquer** chave `em`/`sai` string em qualquer nível. Isso inclui `itens[].em`, `barras[].em`, `marcas[].em` e `carimbo.em`.

### 6.2 Imagem (`$tipo: 'imagem'`)

```ts
export interface DocImagem extends Envelope<'imagem'> {
  largura: number; altura: number;                   // 1080 × 1350
  fundo: Cor | null;                                 // null = transparente (PNG com alfa)
  camadas: Camada[];                                 // de baixo para cima
  efeitos?: PilhaEfeitos;                            // na imagem inteira: os "ajustes"
}
export type ModoMistura = 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten' | 'soft-light';
interface CamadaBase extends Objeto {
  visivel?: boolean; travada?: boolean;
  x: number; y: number; largura: number; altura: number;     // px do documento; plano, como os blocos do roteiro
  rotacao?: number; opacidade?: number; mistura?: ModoMistura;
  origem_transform?: [number, number];                        // 0..1, padrão [0.5, 0.5]
  espelhar?: {x?: boolean; y?: boolean};
  efeitos?: PilhaEfeitos;
}
export type Camada =
  | (CamadaBase & {tipo: 'imagem'; src: CaminhoMidia; ajuste: 'cobrir' | 'conter' | 'esticar';
                   recorte?: {x: number; y: number; w: number; h: number}})
  | (CamadaBase & {tipo: 'texto'; texto: string /* aceita **destaque** */; fonte: string; peso: number; tamanho: number;
                   cor: Cor; cor_destaque?: Cor; alinhar: 'esquerda' | 'centro' | 'direita';
                   entrelinha?: number; espacamento?: number; caixa_alta?: boolean})
  | (CamadaBase & {tipo: 'forma'; forma: 'retangulo' | 'elipse' | 'linha' | 'poligono'; preenchimento: Cor | null;
                   contorno?: {cor: Cor; largura: number}; raio?: number; pontos?: [number, number][]})
  | (CamadaBase & {tipo: 'grupo'; camadas: Camada[]})                         // fase 2
  | (CamadaBase & {tipo: 'doc'; doc: CaminhoDoc; t_ms?: number});            // fase 2: cena 3D ou imagem dentro da imagem
```

- **"Ajustes básicos" são efeitos da pilha** (`brilho`, `cor`). Não existe um segundo modelo de ajuste.
- **Pintura raster** (pincel, máscara) fica fora da composição. Na fase 4, vira um tipo `bitmap` processado num Worker que grava PNG em `midia/` [inferência].

### 6.3 Cena 3D (`$tipo: 'cena3d'`)

```ts
export interface DocCena3D extends Envelope<'cena3d'> {
  largura: number; altura: number; fps: number; duracao_ms: number;
  fundo: Cor | null;                                 // null = alfa (para virar camada do vídeo)
  ambiente: {cor: Cor; intensidade: number; exposicao?: number};
  objetos: Objeto3D[]; luzes: Luz[];
  cameras: Camera[]; camera_ativa: Id;
  animacao?: Faixa3D[];                              // tempo local da cena, em ms
}
export interface Transform { posicao: Vec3; rotacao: Vec3 /* graus, ordem XYZ */; escala: Vec3 }
export interface Material { cor: Cor; metalico: number; rugosidade: number; emissivo?: Cor; opacidade?: number }
interface Obj3DBase extends Objeto { visivel?: boolean; pai?: Id; transform: Transform; material?: Material;
                                     sombra?: {projeta: boolean; recebe: boolean} }
export type Objeto3D =
  | (Obj3DBase & {tipo: 'primitiva'; forma: 'cubo' | 'esfera' | 'plano' | 'cilindro' | 'cone' | 'toro';
                  dims?: {largura?: number; altura?: number; profundidade?: number; raio?: number; tubo?: number; segmentos?: number}})
  | (Obj3DBase & {tipo: 'gltf'; src: CaminhoMidia; no?: string})            // material ignorado salvo sobrescrever_material
  | (Obj3DBase & {tipo: 'texto3d'; texto: string; fonte: CaminhoMidia; tamanho: number; profundidade: number}); // fase 2
export type Luz = Objeto & {tipo: 'ambiente' | 'direcional' | 'ponto' | 'spot'; cor: Cor; intensidade: number;
                            posicao?: Vec3; alvo?: Vec3; sombra?: boolean};
export interface Camera extends Objeto { tipo: 'perspectiva'; fov: number; posicao: Vec3; alvo: Vec3; perto?: number; longe?: number }
export interface Faixa3D extends Objeto {
  alvo: Id;
  propriedade: 'transform.posicao' | 'transform.rotacao' | 'transform.escala' | 'material.cor' | 'material.opacidade'
             | 'camera.posicao' | 'camera.alvo' | 'camera.fov';
  chaves: Chave<number | Vec3 | Cor>[];
}
```

- A câmera de edição (órbita) é estado da interface e **não** vai para o documento. O comando "câmera atual → câmera da cena" grava a posição e o alvo num patch.
- As chaves 3D usam o tempo local da cena. Dentro do roteiro, o bloco `cena3d` dá o início pelo `em`. Isso mantém o documento 3D reutilizável fora de um roteiro. Âncora de palavra dentro da cena fica para depois.

### 6.4 Efeitos (`$tipo: 'efeitos'` e o campo `efeitos` de qualquer objeto)

```ts
interface EfeitoBase extends Objeto { ativo?: boolean; mistura?: number /* 0..1, padrão 1 */ }
export type Efeito =
  | (EfeitoBase & {tipo: 'desfoque';  raio: Animavel<number>})                                   // px do documento
  | (EfeitoBase & {tipo: 'brilho';    brilho: Animavel<number>; contraste: Animavel<number>; saturacao: Animavel<number>}) // −1..1
  | (EfeitoBase & {tipo: 'cor';       exposicao: number; temperatura: number; tonalidade: number;   // −1..1
                   lift: Vec3; gamma: Vec3; gain: Vec3})                                         // por canal RGB
  | (EfeitoBase & {tipo: 'vinheta';   quantidade: number; raio: number; suavidade: number; cor: Cor})
  | (EfeitoBase & {tipo: 'granulado'; quantidade: number; tamanho: number; semente: number; animado: boolean});
export type ItemPilha = Efeito | (Objeto & {tipo: 'predefinicao'; ref: CaminhoDoc});    // "docs/quente.efeitos.json"
export type PilhaEfeitos = ItemPilha[];                                                  // ordem do array = ordem de aplicação
export interface DocEfeitos extends Envelope<'efeitos'> { efeitos: Efeito[] }
```

"Brilho" aqui é brightness (com contraste e saturação, como no par Brilho/Contraste). O glow fica para a fase 2, como `brilho-difuso`.

**Catálogo** (`src/efeitos/catalogo.ts`): um efeito novo é uma entrada, e a união acima é gerada dele.

```ts
export interface DefinicaoEfeito<P> {
  tipo: string; nome: string; params: z.ZodType<P>; padrao: P;
  compilar(p: P, ctx: {frame: number; fps: number; w: number; h: number; escala: number}): {
    filtroCss?: string;                    // "blur(4px) brightness(1.1)"
    filtroSvg?: SvgFiltro;                 // feComponentTransfer / feColorMatrix, referenciado por url(#id)
    sobreposicao?: React.ReactNode;        // vinheta (radial-gradient), granulado (ladrilho de ruído)
  };
}
```

**Compilação no MVP** (`<ComEfeitos pilha>` envolve qualquer alvo: bloco, foto, camada, vídeo ou composição inteira):

| Efeito | Como |
|---|---|
| `desfoque` | `filter: blur(raio × escala px)` |
| `brilho` | `feComponentTransfer` (slope e intercept) para brilho e contraste + `feColorMatrix type="saturate"` |
| `cor` | `feComponentTransfer` por canal (gain = slope, lift = intercept, gamma = exponent) + `feColorMatrix` para temperatura e tonalidade |
| `vinheta` | camada sobreposta com `radial-gradient` |
| `granulado` | camada sobreposta com 8 ladrilhos de ruído gerados uma vez por `random(semente)` e escolhidos por quadro (`animado`). Determinístico, sem `feTurbulence` por quadro |

- **Animáveis:** um valor `{chaves}` é interpolado pelo `frame` dentro do compilador.
- **Paridade:** o mesmo Chromium desenha a prévia (Electron 45) e o render (Chrome Headless Shell). O teste de paridade do passo 11 compara os dois [inferência até medir].
- **Fase 2:** compilador `canvas` com `@remotion/effects` para mídia (`<Img>`, `<Video>`), com recuo WebGPU → WebGL2 → 2D, quando a qualidade exigir e a licença estiver confirmada.

### 6.5 Projeto (`estudio.json`)

```ts
export interface DocProjeto extends Envelope<'projeto'> {
  principal?: CaminhoDoc;                            // abre primeiro
  pessoa_padrao: string;                             // "ana"
  pessoas: {id: string; nome: string}[];
  padroes: {fps: number; video: {largura: number; altura: number}; imagem: {largura: number; altura: number}};
  git: {checkpoint_ocioso_s: number /* 30 */; lfs: boolean};
  remotion: {versao: '4.0.540'};
}
```

---

## 7. Composição entre módulos

**Um bundle Remotion fixo com três composições** (`src/composicoes/Raiz.tsx`). O projeto é só dado (`inputProps`), e o bundle não muda com ele. É o que a Remotion exige no app empacotado, onde não há `bundle()` em runtime.

```ts
export interface PropsComposicao<P> {
  ambiente: 'previa' | 'render';
  baseMidia: string;                                 // "http://127.0.0.1:<porta>/m/<token>/" (igual nos dois ambientes)
  principal: P;                                      // RoteiroResolvido | DocImagem | DocCena3D
  docs: Record<CaminhoDoc, {versao: Versao; doc: unknown}>;   // referenciados, já migrados e validados
}
// Roteiro: calculateMetadata pela duracao_ms · Imagem: 1 quadro, w/h do doc · Cena3D: w/h/duracao do doc
export const midiaUrl = (p: {baseMidia: string}, c: CaminhoMidia) => p.baseMidia + c.split('/').map(encodeURIComponent).join('/');
```

- **Imagem dentro do vídeo:** `{tipo:'imagem', doc:'docs/capa.imagem.json', em:'Antes@2400', y:560, altura:600}` vira `<Caixa b><ImagemView doc={docs[b.doc]} /></Caixa>`. A `Caixa` do tema cuida de posição, entrada e saída. A `ImagemView` é **o mesmo componente** da área Imagem e do PNG.
- **Cena 3D dentro do vídeo:** `Cena3DConteudo({doc, t_ms, camera})` não usa `useCurrentFrame`, recebe `t_ms`.
  - Na composição, o invólucro `Cena3DCamada` faz `<ThreeCanvas>` com `t_ms = (frame/fps×1000 − em_saida) × velocidade + inicio_cena_ms`.
  - Na área 3D, o mesmo componente roda num `<Canvas frameloop="demand">` com o tempo do controle local.
  - O gizmo nunca entra no render.
- **Carregamento sob demanda dentro da composição:** `Cena3DCamada` e o Three.js entram por `import()` com `delayRender`/`continueRender`. Roteiro sem bloco 3D não carrega o Three [inferência; testar no Player e no render].
- **Efeitos em qualquer alvo:** todo objeto visual tem `efeitos?: PilhaEfeitos`. Itens `predefinicao` são expandidos pelo resolvedor com o documento de `docs`. Editar a predefinição muda todos os usos.
- **Dependências:** o DocStore mantém o grafo `doc → refs` (o `refs()` do registro de tipos). Mudou `capa.imagem.json`, sai um `EventoDoc` também para quem depende dele. O renderer resolve de novo só aquele roteiro, e a `ImagemView` é memoizada por `versao`.

**Determinismo (prévia = exportação)**

1. A animação deriva só de `useCurrentFrame()` ou do `t_ms` recebido. Aleatoriedade, só com `random(semente)`.
2. Fontes locais (woff2 OFL de Archivo e IBM Plex em `src/composicoes/fontes/`, carregadas por `@remotion/fonts`). Nada é baixado em runtime.
3. Nenhum overlay de edição dentro da composição. O `data-estudio-id` na `Caixa` não muda pixel.
4. A mídia vem da mesma URL HTTP local na prévia e no render.
5. Um único `<Player>` montado. O `<Thumbnail>` serve a quadros estáticos.

---

## 8. Comandos, patches, diário e desfazer

### 8.1 Contrato (`src/contratos/patch.ts`)

```ts
export type Op =
  | {op: 'add' | 'replace' | 'test'; path: Ponteiro; value: unknown}
  | {op: 'remove'; path: Ponteiro}
  | {op: 'move' | 'copy'; from: Ponteiro; path: Ponteiro};
export interface PedidoPatch {
  opId: string;                       // ULID; reenvio com o mesmo opId não duplica
  doc: CaminhoDoc;
  versao_base: Versao;
  ops: Op[];                          // aceita segmentos "@id": "/cenas/@parte-2/blocos/@parte2-numero/y"
  autor: Autor;                       // preenchido pelo main (UI) ou pelo token da aba (MCP); nunca pelo chamador
  origem: Origem;
  rotulo: string;                     // "Mover parte2-numero (y 860→920)"
  comentario?: string;                // "cmt_0007"
  simular?: boolean;                  // valida e devolve sem gravar
}
export type ResultadoPatch =
  | {ok: true; seq: number; versao: Versao; rebase: boolean; avisos: Aviso[];
     tempos?: Record<Id, {em_saida?: number; sai_saida?: number}>}            // roteiro: tempos dos ids tocados
  | {ok: false; erro: 'conflito' | 'teste' | 'schema' | 'id-duplicado' | 'ref-quebrada' | 'caminho' | 'gesto' | 'invalido-no-disco';
     detalhe: string; versao_atual: Versao; erros?: ErroValidacao[]; desde_base?: EntradaDiarioCurta[]};
```

### 8.2 `aplicar()`: um escritor, uma regra

O escritor único é o núcleo no main, sempre que o app está aberto.

1. **Gesto aberto.** Se a pessoa está arrastando um dos ids tocados (`docs.gesto`), o patch de outro autor espera até 2 s e, se o gesto não acabar, volta com `gesto`.
2. **Resolver `@id`** contra o documento atual. Cada segmento vira índice, precedido de `{op:'test', path:'…/id', value:id}`.
3. **Calcular os alvos** (`doc/alvos.ts`): cada ponteiro vira `id-do-objeto-mais-próximo/campo`, por exemplo `parte2-numero/em`.
4. **Concorrência:**
   - se `versao_base === versao_atual`, aplica;
   - senão, procura no índice do diário a entrada cujo `para === versao_base`. Se achar, junta os `alvos` das entradas posteriores daquele documento. **Passa** se (a) todo caminho com índice de array tem `test` de id antes, (b) todos os `test` passam no estado atual e (c) nenhum alvo do pedido é igual a, ancestral de ou descendente de um alvo alterado desde a base;
   - senão, devolve `conflito` com `desde_base`;
   - base desconhecida também é `conflito`.
5. **Aplicação atômica** numa cópia que só copia o caminho alterado (compartilhamento estrutural). Se uma operação falhar, o documento não muda. Junto, gera a **inversa**: `replace` → `replace` com o valor antigo; `add` → `remove`; `remove` → `add` com o valor antigo; `move` → `move` de volta. A inversa leva `test` dos valores novos.
6. **Validar** com o Zod do tipo e com as regras semânticas (6.1). Âncora que não resolve vira aviso.
7. **Gravar** com `formatar()` em `<arquivo>.tmp`, `fsync`, `rename`. O hash vai para `escritasProprias`, para o watcher ignorar o eco.
8. **Registrar no diário** e emitir `EventoDoc` ao renderer e aos dependentes. O projeto fica marcado como "sujo" para o checkpoint (seção 13).

**Alto nível para o agente** (`src/mcp`, traduzido para o mesmo pedido):

```ts
// editar_objeto({doc:'docs/carrossel.roteiro.json', id:'parte2-numero', campos:{em:'adicional$@43800'}})
[{op:'test',    path:'/cenas/2/blocos/1/id', value:'parte2-numero'},
 {op:'test',    path:'/cenas/2/blocos/1/em', value:'adicional@43800'},   // valor lido na versão base
 {op:'replace', path:'/cenas/2/blocos/1/em', value:'adicional$@43800'}]
```

O índice `id → ponteiro` é refeito a cada versão (O(n) num documento de KB).

### 8.3 Diário (`diario/AAAA-MM.jsonl`, uma linha por entrada)

```ts
export interface EntradaDiario {
  seq: number; em: string;                           // ISO com fuso (-03:00)
  doc: CaminhoDoc; de: Versao; para: Versao;
  autor: Autor; origem: Origem; rotulo: string; opId: string;
  ops: Op[];                                         // RFC 6902 puro (só índices)
  inversa: Op[];                                     // com test dos valores novos
  alvos: string[];                                   // ["parte2-numero/em"]
  comentario?: string;
  desfaz?: number; desfeito_por?: number;            // desfazer e refazer
  commit?: string;                                   // preenchido no checkpoint
}
```

O núcleo mantém em memória as 1.000 entradas mais recentes de cada documento, indexadas por `para`. `desfeito_por` não reescreve a linha antiga: o índice é montado a partir das entradas `desfaz`.

### 8.4 Desfazer por autor (derivado do diário)

- **Ctrl+Z da pessoa:** aplica a `inversa` da última entrada dela no documento ativo que ainda não foi desfeita. Grava uma entrada com `origem:'desfazer'` e `desfaz:<seq>`. **Ctrl+Shift+Z** desfaz o desfazer.
- **O agente mexeu no mesmo valor depois:** o `test` da inversa falha. A UI diz "o agente mudou isto depois" e oferece "desfazer mesmo assim" (inversa sem os `test`, com o autor da pessoa).
- **"Reverter" no painel Diário:** aplica a inversa de qualquer `seq`, inclusive do agente, com `origem:'reverter'`.
- **Ferramenta `desfazer` do MCP:** só entradas da própria aba.
- **Depois de reiniciar o app:** funciona, porque o diário está em disco.
- **Depois de `git checkout`:** as entradas anteriores dos documentos recarregados ficam marcadas como fora de alcance, e o desfazer não as aplica.

### 8.5 Gestos e comandos na UI

- **Mover e redimensionar** (vídeo e imagem): durante o arraste, o overlay muda `style.translate`/`width` do elemento `[data-estudio-id]` direto no DOM. No `pointerup` sai **um** patch, e só então o React redesenha.
- **Sliders e campos do painel:** valor provisório num store (`estado/provisorio.ts`), aplicado às `inputProps` no máximo uma vez por quadro. O patch sai no `pointerup`, no `blur`, no Enter ou depois de 600 ms sem digitar.
- **Timeline:** um patch com o `em` já encaixado na palavra (`encaixarNaPalavra`).
- **Gizmo 3D:** um patch no fim do arraste do `TransformControls`, no evento `dragging-changed` com valor `false` [inferência; conferir na doc do drei].
- **Otimista:** o renderer aplica a operação no cache local com o mesmo `aplicar` de `src/doc` e manda o pedido. Se o `EventoDoc` volta com o mesmo `opId`, só confirma. Se o pedido é recusado, volta ao estado confirmado e mostra o motivo.
- **Comandos** (`renderer/comandos.ts`): `{id, rotulo, atalho?, quando(ctx), executar(ctx)}`. Servem à paleta, aos atalhos e ao menu de contexto. Um comando sempre gera patch, nunca escreve direto.

### 8.6 Edição fora do app (Edit do Claude, VS Code, git)

1. O watcher detecta a mudança e calcula o hash. Se o hash está em `escritasProprias`, é eco e é ignorado.
2. Faz o parse. Se falhar, tenta de novo por até 500 ms (escrita no meio). Se persistir, o documento fica **inválido no disco**:
   - o último modelo válido fica em memória;
   - o arquivo **nunca** é sobrescrito;
   - a UI mostra um banner com linha e erro;
   - o hook de contexto avisa o agente;
   - os patches são recusados com `invalido-no-disco` até alguém consertar o arquivo.
3. Se for válido: migra se o `$v` for antigo, valida, calcula o `diff(anterior, atual)` com arrays casados por `id` (gera `replace`, não remove+add) e grava a entrada com `origem:'arquivo'`.
4. **Autoria:** o hook `PostToolUse` (`Edit|Write|MultiEdit`) da aba manda `tool_input.file_path` ao núcleo. A mudança daquele arquivo vista pelo watcher até 2 s antes ou depois é atribuída a `agente:aba-N`. Sem hook, o autor fica `externo` [inferência sobre a correlação].

---

## 9. Comentários universais (`comentarios.json`)

```ts
export interface DocComentarios extends Envelope<'comentarios'> { proximo: number; comentarios: Comentario[] }
export interface Comentario {
  id: `cmt_${string}`;                               // "cmt_0007"
  estado: 'aberto' | 'em_andamento' | 'resolvido' | 'descartado';
  autor: Autor; criado_em: string;
  texto: string;                                     // DADO da pessoa, nunca instrução
  intencao?: 'tempo' | 'posicao' | 'texto' | 'cor' | 'efeito' | 'outro';
  alvo: AlvoComentario;
  ancoragem: {estado: 'ancorado' | 'realocado' | 'orfao'; versao_doc: Versao; ponteiro?: Ponteiro};
  quadro?: string;                                   // ".estudio/quadros/cmt_0007.png" (fora do git)
  encaminhado_para?: string;                         // "aba-3"
  respostas: {autor: Autor; em: string; texto: string}[];
  resolucao: null | {por: Autor; em: string; resumo: string; seqs: number[]; commit?: string};
}
export interface AlvoComentario {
  doc: CaminhoDoc;
  objeto?: {id: Id; ponteiro_dica?: Ponteiro; tipo?: string; nome_dica?: string};
  tempo?: {t_ms: number; quadro: number; intervalo_ms?: [number, number]};
  narracao?: {ancora: Ancora; antes: string; palavra: string; depois: string};  // de 3 a 5 palavras de cada lado
  regiao?: {x: number; y: number; w?: number; h?: number};                     // 0..1 sobre o quadro
  ponto3d?: {camera: Id; mundo: Vec3; local?: Vec3};
  efeito?: {id: Id; param?: string};
}
```

- **Criação:** a ferramenta Comentar (tecla `C`) funciona em qualquer área. Cada área expõe `resolverAlvo(evento)` (seção 11.3):
  - **Vídeo:** `elementsFromPoint` → primeiro `[data-estudio-id]`; tempo pelo `getCurrentFrame()` do Player; palavras pelo `saidaParaFonte`.
  - **Imagem:** camada sob o ponto pela geometria do documento.
  - **3D:** `Raycaster` (objeto, ponto no mundo e ponto local).
  - **Efeitos:** item da pilha.
- **PNG do comentário:** `capturePage(rect do visor)` no main, no instante do clique, com o alfinete desenhado por cima depois. Mostra o que a pessoa via.
- **Escrita:** `comentarios.json` é um documento como os outros. Criar, responder e resolver são patches pelo mesmo `aplicar()`, com diário, desfazer e watcher.
- **Reancoragem a cada versão de um documento:** se o `objeto.id` existe, o comentário fica `ancorado` (com o ponteiro novo). Se não existe, fica `orfao` e vai para a pessoa; o agente não adivinha. A escada por narração, depois tempo, depois região, fica para a fase 2. O arquivo só é regravado quando muda o estado.
- **"Mandar para a aba":** cola na aba escolhida, com *bracketed paste*, a linha `Veja o comentário cmt_0007 (use a ferramenta comentario).` O texto do comentário não vai para o prompt. O agente o lê pela ferramenta, num campo marcado `texto_da_pessoa`.
- **Resolução:** `resolver_comentario` liga o comentário às `seqs` do diário. O commit do próximo checkpoint preenche `resolucao.commit`.

---

## 10. MCP `nucleo`

**SDK:** v2 (`@modelcontextprotocol/server`, `McpServer` + transporte Streamable HTTP; Zod 4). A assinatura exata de `registerTool` é conferida no passo 6. Se o v2 não instalar limpo com Zod 4, fica o v1 1.32.2 do protótipo com Zod 4 [inferência].

**Transporte no app:** rota `POST/GET /mcp` do servidor HTTP do main. Cada aba recebe um **token próprio**, e o token identifica a aba. O autor de toda escrita é `{tipo:'agente', aba, sessao}`, tirado do token e nunca de um parâmetro. O arquivo por aba fica em `<userData>/sessoes/<hash>/aba-3.mcp.json`:

```json
{"mcpServers": {"nucleo": {"type": "http", "url": "http://127.0.0.1:53817/mcp",
  "headers": {"Authorization": "Bearer 6f1c…"}}}}
```

**Fora do app (pós-MVP):** a CLI `estudio mcp` sobe o mesmo `src/mcp/ferramentas.ts` em stdio, em **modo arquivo**. Ela pega `.estudio/escritor.lock` (pid + heartbeat) e usa `src/nucleo` direto, com as mesmas regras e o mesmo diário. Se o app abrir com o lock vivo, ele espera ou entra só para leitura. Sem o app, `quadro` e `exportar` respondem "abra o app".

| Ferramenta | Entrada | Saída |
|---|---|---|
| `projeto_info` | — | documentos (tipo, versão, válido), abas, `app_aberto`, comentários abertos |
| `estado_editor` | — | área, documento, ids selecionados, tempo/quadro, zoom |
| `esboco` | `doc` | árvore compacta: `parte2 "Segunda regra" 32,1–48,1 s · itens parte2-itens [transporte@36600, salário@39400] · numero parte2-numero em=adicional@43800 y=860` |
| `ler_doc` | `doc`, `ponteiro?` (aceita `@id`), `resolvido?` | `{versao, valor, valido, erros}`; com `resolvido`, `em_saida`/`sai_saida` por id |
| `esquema` | `tipo`, `subtipo?` (`bloco.numero`, `efeito.vinheta`) | JSON Schema + exemplo mínimo |
| `palavras` | `doc`, `de_ms`, `ate_ms`, `base: 'fonte' \| 'saida'` | linhas `palavra@ms` (o `--frases`) |
| `resolver_ancora` | `doc`, `ancora` | `{fonte_ms, saida_ms, palavra, contexto}` ou erro com "Perto:" |
| `editar_objeto` | `doc`, `id`, `campos`, `versao_base?` | `ResultadoPatch` |
| `inserir_objeto` | `doc`, `pai: Id \| '/'`, `colecao`, `objeto`, `antes_de? \| depois_de?` | `ResultadoPatch` + id gerado |
| `remover_objeto` | `doc`, `id` | `ResultadoPatch` |
| `mover_objeto` | `doc`, `id`, `novo_pai?`, `antes_de? \| depois_de?` | `ResultadoPatch` |
| `aplicar_patch` | `doc`, `versao_base`, `ops` (com `@id`), `rotulo`, `comentario?`, `simular?` | `ResultadoPatch` |
| `criar_doc` | `tipo`, `nome`, `modelo?` | `{doc, versao}` |
| `desfazer` | `n?` (só da própria aba) | `ResultadoPatch[]` |
| `mudancas` | `desde_seq?`, `doc?`, `autor?`, `limite?` (50) | entradas curtas do diário (sem `inversa`) |
| `comentarios` | `estado?`, `doc?` | lista curta |
| `comentario` | `id` | JSON + trecho do documento no alvo + palavras em volta + **imagem** PNG com alfinete |
| `responder_comentario` | `id`, `texto` | ok |
| `resolver_comentario` | `id`, `resumo`, `seqs?` | ok |
| `quadro` | `doc`, `t_ms?` ou `quadro?`, `fonte: 'tela' \| 'render'` | imagem: `tela` = `capturePage` do visor agora (instantâneo); `render` = `renderStill` JPEG em 0,5×, em cache por `(doc, versao, quadro)` |
| `exportar` | `doc`, `formato: 'mp4' \| 'png'`, `quadro?` | `{job}`; progresso por `mudancas` (entrada `exportou`) |
| `marcar_versao` | `mensagem` | hash do commit |

- **Recursos:** `estudio://doc/{caminho}`, `estudio://comentarios` e `estudio://diario`, só para leitura. O desenho **não depende** de `resources/subscribe`, porque a doc do Claude Code não fala dele. O agente puxa (`mudancas`, `comentarios`), e o hook `UserPromptSubmit` empurra o resumo a cada prompt.
- **Orçamento de contexto:** descrições de uma linha. `ler_doc` sem ponteiro num documento acima de 8 mil tokens devolve o `esboco` e pede ponteiro. `mudancas` pagina. O Claude Code avisa a partir de 10 mil tokens de saída de MCP [citado na proposta B].
- **Escopo:** o MCP só escreve em `docs/*.json` e `comentarios.json` do projeto aberto e nunca executa código nem comandos.

---

## 11. Contratos

### 11.1 IPC renderer ↔ main (`src/contratos/ipc.ts`)

```ts
export interface CanaisInvoke {
  'projeto.escolher':      {req: void; res: InfoProjeto | null};                    // diálogo de pasta
  'projeto.abrir':         {req: {raiz: string}; res: InfoProjeto};
  'projeto.recentes':      {req: void; res: {raiz: string; nome: string; aberto_em: string}[]};
  'projeto.importarAntigo':    {req: {origem: string; destino: string}; res: InfoProjeto};
  'docs.listar':           {req: void; res: ResumoDoc[]};
  'docs.ler':              {req: {doc: CaminhoDoc}; res: {valor: unknown; versao: Versao; valido: boolean; erros: ErroValidacao[]}};
  'docs.lerPalavras':      {req: {caminho: CaminhoMidia}; res: Palavra[]};
  'docs.aplicar':          {req: Omit<PedidoPatch, 'autor'>; res: ResultadoPatch};   // autor = pessoa do app
  'docs.gesto':            {req: {doc: CaminhoDoc; ids: Id[]; aberto: boolean}; res: void};
  'docs.desfazer':         {req: {doc: CaminhoDoc; forcar?: boolean}; res: ResultadoPatch | null};
  'docs.refazer':          {req: {doc: CaminhoDoc}; res: ResultadoPatch | null};
  'docs.criar':            {req: {tipo: TipoDoc; nome: string; modelo?: string}; res: {doc: CaminhoDoc; versao: Versao}};
  'diario.listar':         {req: {desde_seq?: number; doc?: CaminhoDoc; limite?: number}; res: EntradaDiario[]};
  'diario.reverter':       {req: {seq: number}; res: ResultadoPatch};
  'comentarios.criar':     {req: {alvo: AlvoComentario; texto: string; intencao?: Comentario['intencao']; rect: Retangulo}; res: Comentario};
  'comentarios.mudar':     {req: {id: string; estado?: Comentario['estado']; resposta?: string; encaminhar_para?: string}; res: Comentario};
  'midia.base':            {req: void; res: {url: string}};
  'midia.importar':        {req: {destino: 'fotos' | 'sfx' | 'fonte' | '3d' | 'marca'}; res: CaminhoMidia[]};
  'render.iniciar':        {req: PedidoRender; res: {job: string}};
  'render.cancelar':       {req: {job: string}; res: void};
  'terminal.abrir':        {req: Omit<PerfilAba, 'id'>; res: InfoAba};              // a porta chega por 'estudio:porta'
  'terminal.fechar':       {req: {aba: string}; res: void};
  'terminal.hibernar':     {req: {aba: string}; res: void};
  'terminal.colar':        {req: {aba: string; texto: string}; res: void};          // bracketed paste
  'estado.editor':         {req: EstadoEditor; res: void};                          // throttle de 200 ms no renderer
  'sistema.capturar':      {req: Retangulo; res: ArrayBuffer};
  'sistema.metricas':      {req: void; res: {processo: string; memoriaMB: number; cpu: number}[]};
  'sistema.perfil':        {req: void; res: PerfilMaquina};                         // leve | padrao | forte (desempenho.md §1)
  'claude.detectar':       {req: void; res: {instalado: boolean; caminho?: string; versao?: string}};
}
export interface CanaisEvento {
  'docs.mudou': EventoDoc;
  'render.progresso': {job: string; etapa: 'bundle' | 'navegador' | 'render' | 'codificando' | 'pronto' | 'erro'; pct: number; saida?: string; erro?: string};
  'terminal.estado': {aba: string; estado: 'trabalhando' | 'esperando' | 'pronto' | 'precisa' | 'hibernada' | 'saiu'; aviso?: string};
  'terminal.contexto': {aba: string; texto: string};                                // o que o hook mandou (chip)
  'projeto.aviso': {nivel: 'info' | 'erro'; texto: string; doc?: CaminhoDoc};
}
export type EventoDoc =
  | {tipo: 'patch'; doc: CaminhoDoc; seq: number; de: Versao; para: Versao; ops: Op[]; autor: Autor; origem: Origem; opId: string; rotulo: string}
  | {tipo: 'recarga'; doc: CaminhoDoc; versao: Versao; motivo: 'externo' | 'git' | 'migracao'}
  | {tipo: 'invalido'; doc: CaminhoDoc; erros: ErroValidacao[]}
  | {tipo: 'criado' | 'removido'; doc: CaminhoDoc};
export interface EstudioAPI {
  invoke<K extends keyof CanaisInvoke>(canal: K, req: CanaisInvoke[K]['req']): Promise<CanaisInvoke[K]['res']>;
  on<K extends keyof CanaisEvento>(canal: K, cb: (e: CanaisEvento[K]) => void): () => void;
  plataforma: 'win32' | 'darwin' | 'linux';
}
```

- **Preload:** só `invoke` e `on`, com uma lista de canais permitidos (`CANAIS_INVOKE`, `CANAIS_EVENTO`), mais o repasse da porta do terminal (`ipcRenderer.on('estudio:porta', e => window.postMessage({estudioPorta: meta}, location.origin, e.ports))`).
- **Main:** `registrar(canal, esquemaZod, fn)` faz `parse` na borda e recusa `senderFrame.url` que não seja a do app.
- **Canal novo** é uma linha no contrato e um handler.

### 11.2 Mensagens main/renderer ↔ hosts

```ts
// pty-host (dados vão por MessagePort direto com o renderer; controle vem do main)
export type MsgPtyControle =
  | {t: 'criar'; aba: string; exe: string; args: string[]; cwd: string; env: Record<string, string>; cols: number; rows: number}
  | {t: 'tamanho'; aba: string; cols: number; rows: number} | {t: 'fechar'; aba: string};
export type MsgPtyPorta = {t: 'dados'; bytes: Uint8Array} | {t: 'ack'; n: number} | {t: 'entrada'; dados: string} | {t: 'saiu'; codigo: number};
// render-host
export type MsgRender =
  | {t: 'job'; pedido: PedidoRender; props: PropsComposicao<unknown>; serveUrl: string; binariesDirectory: string; perfil: PerfilMaquina}
  | {t: 'cancelar'; job: string};
export interface PedidoRender {
  doc: CaminhoDoc; composicao: 'Roteiro' | 'Imagem' | 'Cena3D';
  formato: 'mp4-h264' | 'png' | 'jpeg';
  saida: string;                                    // "saidas/carrossel-2026-11-05-1012.mp4"
  escala?: number; quadro?: number; faixa_quadros?: [number, number];
}
```

### 11.3 Contrato de área (`src/renderer/modulos.ts`)

```ts
export interface ManifestoArea {                    // estático, vai no bundle inicial
  id: 'video' | 'imagem' | 'cena3d' | 'efeitos'; nome: string; icone: string; tipos: TipoDoc[]; atalho: string;
  carregar: () => Promise<{default: ModuloArea}>;   // import() do chunk
}
export interface ModuloArea {                       // preguiçoso
  Area: React.ComponentType<{doc: CaminhoDoc}>;
  comandos?: Comando[];
  resolverAlvo?(e: PointerEvent): AlvoComentario | null;
  aoSair?(): void;                                  // libera GPU, workers e listeners
}
```

No perfil leve, só a área visível fica montada (`desempenho.md`). A disposição dos painéis vem da frente de estilo.

---

## 12. Observação de arquivos e recarga

```ts
chokidar.watch(raiz, {
  ignoreInitial: true, atomic: true, awaitWriteFinish: {stabilityThreshold: 120, pollInterval: 30},
  ignored: (p) => /[\\/](\.git[\\/](?!HEAD$|refs)|node_modules|saidas|\.estudio)([\\/]|$)/.test(p),
});
```

| O que mudou | Reação |
|---|---|
| `docs/*.json`, `comentarios.json`, `estudio.json` | fluxo 8.6 (eco por hash, inválido, diff, diário) |
| `midia/**/palavras.json` | resolve de novo os roteiros que usam o arquivo |
| `midia/**` | evento de mídia com hash novo; o renderer troca a URL (`?v=<hash>`); o cache daquele arquivo é invalidado |
| `.git/HEAD` ou refs | depois de checkout ou revert: `recarga` (`motivo:'git'`) de todo documento cujo hash mudou; o desfazer anterior fica fora de alcance |
| `diario/` | ignorado (só o núcleo escreve) |

**No renderer:**

1. `EventoDoc{tipo:'patch'}` aplica as `ops` no cache local com o mesmo `aplicar`.
2. O roteiro afetado é resolvido de novo, com memo por `versao`.
3. O `<Player inputProps>` recebe o objeto novo e redesenha o quadro atual sem remontar.
4. A seleção persiste, porque é por `id`.

**Código do tema:** em desenvolvimento, o HMR do Vite cuida da prévia, e o render refaz o `bundle()` quando o hash de `src/composicoes` muda. Empacotado, o bundle é fixo.

---

## 13. Git

- **Git do sistema** por `execFile('git', …)` assíncrono no núcleo, com `GIT_OPTIONAL_LOCKS=0` no `status`, atrás de `PortaGit {status, commit, log, revert}`. Sem git no PATH, uma faixa de aviso aparece e o histórico fica só no diário. `dugite` ou `isomorphic-git` ficam para a fase 3.
- **Ao abrir o projeto:** `git init` se não houver repositório (com aviso), `.gitignore` e `.gitattributes`.
- **O diário é o histórico fino; o git guarda checkpoints.** Gatilhos:
  1. hook `Stop` de uma aba (fim do turno do agente);
  2. a pessoa ociosa por 30 s com entradas dela pendentes;
  3. "Marcar versão" / Ctrl+S / ferramenta `marcar_versao`;
  4. início de exportação.
- **Um autor por commit.** Se chega um patch de autor diferente com entradas pendentes de outro autor, o núcleo faz o checkpoint do anterior **antes** de gravar. Isso custa de 100 a 200 ms ao patch que chegou, fora da thread da UI [inferência]. Se o commit falhar (`index.lock`), o patch é gravado assim mesmo, e o próximo commit sai misto, com os dois trailers.
- **Mensagem:**

```
estudio: carrossel · Mover parte2-numero (y 860→920) (+2)

Estudio-Autor: agente:aba-3
Estudio-Seq: 128-130
Comentario: cmt_0007
```

- **Arbitragem com o agente:** o app só faz commit quando nenhuma aba está "trabalhando" (estado vindo dos hooks) e tenta de novo, com espera crescente, se encontrar `index.lock`. O `CLAUDE.md` gerado diz: não faça commit de `docs/`, `comentarios.json` nem `diario/`; o app faz checkpoint.
- **Reverter um lote do agente:** `git revert <checkpoint>`. O watcher vê a mudança e registra as entradas com `origem:'git'`.

---

## 14. Exportação

**Utility "render"**, criado sob demanda e encerrado 2 min depois do último job:

1. **Bundle:** em desenvolvimento, `bundle()` de `src/composicoes/entrada.ts` uma vez por sessão, refeito só se o hash do código mudar. Empacotado, `remotion-bundle` pré-gerado no `packageAfterCopy`, como no template [lido].
2. **Navegador:** `ensureBrowser()` com progresso na primeira vez (`packaged-browser.ts` do protótipo). O navegador não vai no instalador.
3. **Props:** montadas no main pelo mesmo `resolverRoteiro` que o renderer usa. `baseMidia` aponta para o servidor HTTP local.
4. **Vídeo:**

```ts
await renderMedia({composition, serveUrl, inputProps, codec: 'h264', outputLocation,
  concurrency: perfil.concurrency,                  // leve 2 (1 se houver WebGL na composição); padrão "50%"
  disallowParallelEncoding: perfil.nome === 'leve', // desempenho.md §4.8
  chromiumOptions: {gl: 'angle'},                   // obrigatório com Three.js
  binariesDirectory, cancelSignal, onProgress});
```

5. **PNG/JPEG:** `renderStill({composition, serveUrl, inputProps, frame, imageFormat, scale})`. O PNG da Imagem sai com alfa quando `fundo: null`.
6. **Fila:** um job por vez, cancelável (`makeCancelSignal`). Matar o processo é o último recurso. A prévia pausa durante o export.
7. **Áudio no MVP:** narração por segmentos `<Audio trimBefore>` da fonte, com `ganho_narracao_db`, mais os sons. O Remotion mixa no render.
8. **Áudio na fase 2:** loudness BS.1770 em TS, metas do `mix.py` (−14 LUFS, efeitos com mediana 23 LU abaixo da voz) e duas passadas (voz e efeitos) se precisar.
9. **Paridade:** `testes/e2e/paridade.ts` compara `capturePage` do Player com `renderStill` nos quadros `em_saida` de cada bloco do carrossel de referência, com limiar de diferença por pixel.

---

## 15. Terminais

```ts
export interface PerfilAba {
  id: string;                         // "aba-3"
  titulo: string;                     // "carrossel · tempo"
  projeto: string;                    // raiz absoluta
  cwd: string;                        // = projeto (worktree para frente de código: fase 3)
  comando: 'claude' | 'shell';
  sessao: string;                     // UUID gerado pelo app → --session-id; reabrir = --resume
  mcp_estrito?: boolean;              // --strict-mcp-config: só o nucleo (opcional; economiza RAM)
  cor?: string;
}
```

**Lançamento** (main prepara, pty-host executa):

```ts
const dir = path.join(app.getPath('userData'), 'sessoes', hashProjeto);
await escrever(`${dir}/${aba.id}.mcp.json`, {mcpServers: {nucleo: {type: 'http', url: `${base}/mcp`,
  headers: {Authorization: `Bearer ${tokenAba}`}}}});
const h = (rota: string) => [{type: 'http', url: `${base}/h/${rota}`, timeout: 2,
  headers: {Authorization: 'Bearer $ESTUDIO_TOKEN'}, allowedEnvVars: ['ESTUDIO_TOKEN']}];
await escrever(`${dir}/${aba.id}.settings.json`, {hooks: {
  UserPromptSubmit: [{hooks: h('contexto')}],
  PostToolUse: [{matcher: 'Edit|Write|MultiEdit', hooks: h('arquivo')}],
  Stop: [{hooks: h('fim-turno')}],
  Notification: [{hooks: h('aviso')}],
}});
pty.criar({aba: aba.id, exe: claudeExe, cwd: aba.cwd, cols, rows,
  args: [...(retomar ? ['--resume', aba.sessao] : ['--session-id', aba.sessao]), '-n', aba.titulo,
         '--mcp-config', mcpCfg, ...(aba.mcp_estrito ? ['--strict-mcp-config'] : []),
         '--settings', settingsCfg, '--append-system-prompt-file', guiaAgente],
  env: {...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', ESTUDIO_TOKEN: tokenAba, ESTUDIO_ABA: aba.id}});
```

- **O `claude` roda direto no PTY, sem PowerShell no meio.**
  - O executável é detectado por `where claude`, `which claude` ou `%USERPROFILE%\.local\bin\claude.exe`.
  - Um `.cmd` do npm roda por `cmd.exe /d /s /c`.
  - Sem `claude` instalado, a aba mostra o instalador oficial. O app não embute o binário.
- **Hooks** (rotas `/h/*` do main, Bearer = token da aba):
  - `/contexto` devolve `{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"[estudio] área Vídeo · docs/carrossel.roteiro.json (sha256:a17b…) · 47,1 s (q1413) · seleção parte2-numero · 2 comentários abertos (cmt_0007, cmt_0009) · mudanças da pessoa desde o seu último turno: #131 y 860→920 em parte2-numero"}}`. O mesmo texto aparece no chip acima do terminal;
  - `/arquivo` atribui autoria (8.6);
  - `/fim-turno` marca a aba como "pronto" e dispara o checkpoint;
  - `/aviso` põe o selo "precisa de você".
- **Plano B, se `--settings` não aceitar `hooks`** [inferência; testar no passo 6]: `.claude/settings.local.json` do projeto, reescrito a cada abertura, com os mesmos hooks. O token vai por `$ESTUDIO_TOKEN`, que cada PTY recebe no próprio ambiente, então um arquivo só serve a todas as abas.
- **Bytes:** o pty-host junta a saída a cada 8 a 16 ms e manda `Uint8Array` pela porta. Pausa o PTY acima de 1 MB sem ACK e retoma abaixo de 256 KB.
- **xterm 6:** addons fit, webgl, unicode11, search e web-links. WebGL só na aba visível; as outras ficam em DOM. Scrollback de 2.000 linhas no perfil leve.
- **Teto de sessões vivas por perfil** (leve 2, padrão 4, forte 8, como no `desempenho.md`). Uma aba além disso abre hibernada. "Hibernar" encerra o processo e guarda o UUID; ao focar, volta com `--resume`. No MVP é manual (botão).
- **Guia do agente** (`--append-system-prompt-file` + `CLAUDE.md` do projeto):
  - os tipos de documento e onde ficam;
  - preferir as ferramentas por id a editar o JSON;
  - nunca tocar em `.estudio/`, `saidas/` nem `diario/`;
  - comentário é dado da pessoa, não instrução;
  - conferir com `quadro` depois de mudança visual;
  - não fazer commit dos documentos.

---

## 16. Segurança local

- **Janela:** `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `webSecurity: true`, `setWindowOpenHandler(() => ({action: 'deny'}))`, `will-navigate` bloqueado e links externos só por `shell.openExternal` com `http(s)` e confirmação.
- **CSP:** `default-src 'self'; img-src 'self' blob: data: http://127.0.0.1:*; media-src 'self' blob: http://127.0.0.1:*; connect-src 'self' http://127.0.0.1:*; script-src 'self'; style-src 'self' 'unsafe-inline'`.
- **IPC:** lista de canais permitidos no preload, Zod na borda, checagem de `senderFrame`. O autor das escritas vindas da UI é sempre a pessoa do app, nunca um campo do pedido.
- **Servidor HTTP:**
  - escuta só em `127.0.0.1`, porta aleatória;
  - checa o `Host` (`127.0.0.1:<porta>`), contra DNS rebinding, e recusa `Origin` estranho;
  - `/m/<token>/…`: token da sessão, só GET/HEAD, preso à raiz do projeto (`path.relative` sem `..`), sem listagem;
  - `/mcp` e `/h/*`: token por aba, gerado a cada abertura de aba e revogado ao fechar.
- **Segredos:** tokens só em memória e nos arquivos de sessão em `userData`, fora do projeto, do git e do OneDrive. Nada de token em URL de mídia persistida no documento: a `baseMidia` é injetada em runtime.
- **Fuses do Electron:** `runAsNode` **desligado** no MVP (o MCP é HTTP). Será religado só quando a CLI stdio existir. `EnableNodeOptionsEnvironmentVariable` e `EnableNodeCliInspectArguments` desligados no empacotado.
- **Agente:**
  - o app não passa `--dangerously-skip-permissions` nem muda as permissões do `claude` da pessoa;
  - o MCP só escreve em documentos do projeto e não executa nada;
  - o texto do comentário é marcado como `texto_da_pessoa`;
  - a colagem na aba usa *bracketed paste*.
- **Arquivo inválido no disco nunca é sobrescrito.** A escrita é atômica (tmp + fsync + rename).

---

## 17. Desempenho na arquitetura

Os orçamentos, perfis e testes que reprovam estão em `docs/desempenho.md`, que manda nesse assunto. Máquina de referência: 8 GB, 4 núcleos, GPU integrada. As escolhas desta arquitetura que sustentam o orçamento:

- **Processos:** um renderer, uma janela; o main sem trabalho pesado; o pty num utility; o render só durante o trabalho.
- **MCP por HTTP:** zero processos por aba além do `claude`.
- **Áreas:** em chunks, e só a visível montada no perfil leve. Um contexto WebGL pesado por vez (a área 3D, ou o bloco `cena3d` no Player). Efeitos do MVP sem WebGL.
- **Player:** escala 0,5 no leve, `inputProps` memoizado por versão, controles irmãos que escutam `frameupdate` pela ref, um único Player.
- **R3F:** `frameloop="demand"`, teto de dpr por perfil, `dispose` ao sair da área.
- **Prévia sem ffmpeg:** narração por segmentos.
- **Documentos:** de KB, diário só cresce no fim, índice em memória limitado a 1.000 entradas por documento.
- **Medição desde o passo 1:** selo de RAM (`app.getAppMetrics`), `performance.mark` na abertura e no patch→quadro, e o teste Playwright do `desempenho.md` no fim do MVP.

---

## 18. Corte do MVP

**Entra**

- Abrir pasta, com importação do formato do protótipo e do motor antigo para o projeto de exemplo.
- As quatro áreas.
- **Vídeo:**
  - o carrossel de referência real no Player a partir do roteiro resolvido em TS;
  - seleção por clique;
  - alças para `y`, `x`, `largura` e `tam`;
  - painel de propriedades gerado do schema;
  - timeline de blocos por cena sobre a faixa de palavras, com encaixe.
- **Imagem:** camadas imagem, texto e forma; mover, redimensionar e girar; lista de camadas (ordem, visível, travada, opacidade, mistura); ajustes pela pilha; PNG.
- **3D:** primitivas, luzes, câmeras; `TransformControls` → patch; `OrbitControls`; "câmera atual → documento"; bloco `cena3d` no roteiro. glTF se sobrar tempo.
- **Efeitos:** os 5 tipos, aplicáveis a bloco, foto, camada, imagem inteira e roteiro inteiro; predefinição em `docs/*.efeitos.json`.
- **Comentários** por clique em qualquer área, com PNG e "mandar para a aba".
- **Terminal:** abas `claude` e `shell`, teto de sessões e hibernação manual.
- **MCP `nucleo` por HTTP** com as ferramentas da seção 10.
- **Núcleo completo:** patch com `@id` e regra de concorrência, diário, desfazer por autor, edição externa com diff, eco por hash, arquivo inválido.
- **Exportação:** PNG (`renderStill`) e MP4 (`renderMedia`) com a narração por segmentos.
- **Git:** checkpoints com um autor por commit.

**Fica fora**

- Mix final e loudness em TS.
- Reancoragem de comentário por narração.
- Transcrição local.
- CLI `estudio` e MCP stdio em modo arquivo.
- `@remotion/effects` e `<HtmlInCanvas>`.
- Chaves animadas na interface (o tipo `Animavel` já aceita).
- Blocos `video`, camadas `grupo`/`doc`, `texto3d`.
- Proxies, miniaturas na timeline e forma de onda.
- Hibernação automática.
- Leases entre abas e worktrees.
- Instalador assinado e atualização automática.
- dugite/isomorphic-git, CRDT, ACP.
- Satélites (Blender, ArtCraft).

### Ordem de construção e critério de pronto

Cada passo termina rodando, com `npm run typecheck` e `npm test` verdes, e com um commit.

| # | Passo | Pronto quando |
|---|---|---|
| 1 | **Fundação.** Reorganizar o protótipo nas camadas da seção 3; Electron 45, Zod 4, regras de fronteira no ESLint; casca com as 4 áreas em chunks; perfil da máquina; selo de RAM; pty-host e render-host vazios via utilityProcess (decide o plano B) | `npm run dev` abre a casca em menos de 2 s; trocar de área carrega o chunk; o selo mostra main, renderer e pty; primeiro commit no repositório |
| 2 | **`doc` + `schemas`.** Ponteiro com `@id`, `aplicar`, inversa, `diff` por id, `alvos`, `formatar`, hash; Zod dos 6 tipos; geração do JSON Schema; importação do projeto de exemplo para o formato da seção 4 | Suíte de testes do RFC 6902 (json-patch-tests) verde; inversa de cada op volta ao original; carrossel de referência importado sem id duplicado (`parte3-cartao-1/2`); `formatar` idempotente |
| 3 | **`motor`.** Mover a porta do protótipo; somar `MapaTempo`, segmentos de narração, `origem` por id, `encaixarNaPalavra`, `frases` | Teste dourado contra `referencia/.../props.json` do exemplo (cenas, `em`/`sai`, legendas, sons e `duracao_ms` exatos); segmentos cobrem a fonte sem buraco |
| 4 | **Núcleo + IPC.** DocStore, `aplicar()` com a regra de concorrência, diário, desfazer, watcher (eco, inválido, diff), comentários como documento, `CanaisInvoke`/`CanaisEvento`, servidor HTTP `/m` | Testes de conflito, rebase por alvo, desfazer cruzado (pessoa × agente), reinício com desfazer e arquivo inválido verdes; uma edição feita no VS Code aparece no app em menos de 300 ms |
| 5 | **Vídeo.** Composição `Roteiro` (tema com `Bloco.id` e `data-estudio-id` na `Caixa`, `midiaUrl`, fontes locais, narração por segmentos); Player 0,5×; overlay de seleção e alças; Propriedades geradas do schema; Timeline com encaixe | Arrastar o 25% grava `y` no disco, o diário ganha uma linha e o Ctrl+Z volta; mudar o `em` pela timeline encaixa na palavra; patch → quadro redesenhado em menos de 100 ms |
| 6 | **Terminal + MCP + hooks.** xterm com abas pelo pty-host e porta direta; perfil de aba; `/mcp` com as ferramentas de leitura e escrita; hooks `/h/*`; chip de contexto | Duas abas `claude` em paralelo; "faça o 25% entrar no fim de 'adicional'" vira `editar_objeto`, o Player atualiza em menos de 1 s, o diário mostra `agente:aba-N` e o Ctrl+Z da pessoa não desfaz a mudança do agente |
| 7 | **Comentários.** Ferramenta `C` no Vídeo (as outras áreas ganham `resolverAlvo` nos passos 8 a 10), PNG por `capturePage`, painel, "mandar para a aba", ferramentas `comentarios`/`comentario`/`responder`/`resolver` | **Marco 1:** clicar no bloco cria `cmt_0001` com PNG; o agente o lê, aplica a mudança e o resolve com as `seqs`; o comentário aparece resolvido na tela |
| 8 | **Efeitos.** Catálogo + compilador; `<ComEfeitos>` no tema, na foto e na raiz; área Efeitos com pilha do alvo selecionado; predefinição | Vinheta + granulado no carrossel de referência inteiro e `cor` na foto, na prévia; a mesma predefinição em dois alvos muda junto quando editada; o agente adiciona um desfoque por `inserir_objeto` |
| 9 | **Imagem.** Composição `Imagem`/`ImagemView`; `<Thumbnail>` + alças imperativas; Camadas; render-host com `renderStill` | Capa 1080×1350 com 3 camadas montada à mão e pelo terminal; PNG com alfa em `saidas/`; bloco `imagem` com a capa aparece no carrossel de referência |
| 10 | **3D.** Área com R3F `demand`, primitivas, luzes, `TransformControls`, `OrbitControls`, câmera → documento; composição `Cena3D`; bloco `cena3d` | Cubo e esfera; o gizmo gera um patch por arraste; o agente muda `transform.rotacao` e a viewport segue; o bloco `cena3d` aparece no Player do carrossel de referência |
| 11 | **Exportação + git.** `renderMedia` com fila, progresso, cancelamento e perfil; checkpoints (Stop, ocioso, marcar versão, export) com um autor por commit; `quadro`/`exportar`/`marcar_versao` no MCP; teste de paridade | MP4 do carrossel de referência em `saidas/`, com áudio; `git log` com commits de `ana` e de `agente:aba-N` separados e com trailers; paridade abaixo do limiar nos quadros de entrada |
| 12 | **Orçamento.** Teste Playwright em modo Electron do `desempenho.md` (partida, E1, E2, export curto, rajada no terminal) | E1 e E2 dentro do teto no PC de desenvolvimento, com o perfil leve forçado |

**Se o tempo apertar, sai nesta ordem:**

1. glTF (ficam só primitivas);
2. `quadro` com `fonte:'render'` (fica `tela`);
3. rotação nas alças da imagem;
4. MP4 (fica só PNG);
5. checkpoint automático (fica só "Marcar versão");
6. passo 12 (vira checklist manual).

**Estimativa** [inferência]: de 16 a 20 horas de trabalho com o Claude Code. Os passos 1 a 7 (cerca de 10 h) já dão o marco demonstrável.

---

## 19. Longo prazo (o mesmo desenho, sem refazer)

| Fase | Entra | Onde encaixa |
|---|---|---|
| 2 | Loudness e ganhos em TS; utility "midia" (proxies Mediabunny, forma de onda, miniaturas); chaves animadas na UI; `@remotion/effects` na mídia; `<HtmlInCanvas>` quando o Electron trouxer um Chromium que o aceite sem flag; reancoragem por narração | `src/audio`, `hosts/midia-host.ts`, compilador `canvas` no catálogo |
| 3 | CLI `estudio` (`validar`, `patch`, `exportar`, `mcp` stdio em modo arquivo); worktrees para frente de código; dugite | `src/mcp` + `src/nucleo` empacotados por esbuild; fuse `runAsNode` reavaliado |
| 3 | Documento `montagem` (trilhas e clipes em ms, sem narração) | Novo tipo no registro + área + composição `Montagem` |
| 4 | Tipos de bloco, camada e efeito como plugins (schema + componente + meta + regra de som) | Registro de tipos e catálogo; no empacotado, plugin novo exige rebuild do bundle |
| 4 | Satélites (Blender, ArtCraft) como adaptadores que geram `PedidoPatch` sobre os mesmos documentos | Mesmo núcleo, diário e comentários |
| 4 | `bitmap` editável (pincel, máscara) em Worker com OffscreenCanvas | Gera PNG em `midia/`; a composição só exibe |
| 5 | Coedição ao vivo (Yjs/Automerge com Y.Map por objeto) | Os ids e o diário continuam; o formato em disco não muda |
| — | Núcleo num utilityProcess, se o main mostrar *long tasks* | Trocar a implementação de `Nucleo` por um cliente de porta |

---

## 20. Riscos (checklist, não portão)

- [ ] node-pty (`@lydell/node-pty`) e `@remotion/renderer` dentro de utilityProcess: testar no passo 1; plano B na seção 2.
- [ ] `--settings` aceitando `hooks` e `--mcp-config` com `type: http` sem prompt de aprovação: testar no passo 6; plano B na seção 15.
- [ ] MCP SDK v2 com Zod 4 e Streamable HTTP: conferir `registerTool` no passo 6.
- [ ] Narração por segmentos (`<Audio trimBefore>`): sem estalo nas emendas e com o volume perto do wav normalizado; ajustar `ganho_narracao_db`.
- [ ] Filtros SVG (`feComponentTransfer`, `feColorMatrix`) no Player a 0,5× sem queda de quadro; iguais no render.
- [ ] `<Thumbnail>` e Player com `delayRender` na camada 3D preguiçosa.
- [ ] Paridade Electron 45 × Chrome Headless Shell da 4.0.540 (`testes/e2e/paridade.ts`).
- [ ] Fontes woff2 locais no lugar de `@remotion/google-fonts` antes do primeiro render offline.
- [ ] Checkpoint forçado na troca de autor sem travar o patch do agente (medir).
- [ ] `index.lock` disputado com o agente: espera crescente + regra no `CLAUDE.md`.
- [ ] Licença Remotion (Company License) cobrindo Player e renderer no app interno; `@remotion/effects` só na fase 2.
- [ ] Cota da assinatura: N abas = N sessões `claude`.
- [ ] Comentário é dado: campo marcado no MCP, *bracketed paste* e regra no guia.
- [ ] Electron 45 no lugar do 42 do template: compositor e `binariesDirectory` em `app.asar.unpacked`.

---

## Fontes

Internas, lidas em 05/11/2026:

- `%USERPROFILE%\projetos\estudio\referencia\motor-mac\scripts\preparar_carrossel.py` (constantes, `round`, cortes)
- `...\referencia\motor-mac\dados\trabalho\<exemplo>\roteiro.json`, `props.json` (chaves de topo) e `pub/narracao.wav`
- `...\referencia\template-electron\package.json` (Electron 42.11.16, Forge 7.11.1)
- `%USERPROFILE%\projetos\estudio\package.json`, `src/**` e `testes/resolver.test.ts` (protótipo)
- o projeto de exemplo (estrutura e presença do vídeo-fonte da narração)
- `%USERPROFILE%\projetos\estudio\docs\desempenho.md` (processos, MCP por HTTP, perfis, orçamentos)
- Proposta A e proposta B (05/11/2026), com as fontes externas que elas citam.

Externas citadas pelas propostas (não reabertas aqui):

- Electron: utilityProcess, MessagePorts, Performance, protocol, variáveis de ambiente e fuses, releases (45.2.1, Chromium 156) — electronjs.org.
- Remotion: Electron, Player, Thumbnail, `@remotion/three`, effects, `colorCorrection`, `vignette`, `preferred-effect-backend`, HtmlInCanvas, `renderMedia`, Html5Audio (`trimBefore`), release 4.0.540 — remotion.dev e github.com/remotion-dev.
- Claude Code: CLI reference, MCP (`.mcp.json`, `type: http`, `headers`), hooks (`http`, `additionalContext`, `allowedEnvVars`) — code.claude.com/docs.
- MCP TypeScript SDK v2 — github.com/modelcontextprotocol/typescript-sdk.
- Zod 4, JSON Schema — zod.dev/json-schema.
- RFC 6901 e RFC 6902 — rfc-editor.org.
- node-pty — github.com/microsoft/node-pty; VS Code PR 178708 (pty host).
- chokidar — github.com/paulmillr/chokidar.
- React Three Fiber (scaling performance) e drei (TransformControls) — pmnd.rs.
