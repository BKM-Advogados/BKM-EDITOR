# Estúdio V4

App desktop que une edição de **vídeo**, **imagem**, **3D**, **efeitos** e **animação** (2D e arte em pixel) num lugar só. Tudo é JSON na pasta do
projeto: a pessoa edita na tela, o Claude edita conversando (com a conta da própria pessoa), e as duas mãos passam pelo
mesmo JSON Patch com versão, diário e desfazer. A tela acompanha o arquivo; o agente vê o que a pessoa mudou.

Nome provisório. Pasta: `%USERPROFILE%\projetos\estudio` (fora do OneDrive, por causa do `node_modules`).
Repositório: `BKM-Advogados/BKM-EDITOR` (público: nada de chave, token ou dado de cliente no código). Versões (tag do git → versão do pacote): V1 = `v1.0.0` (0.1.0),
V2 = `v2.0.0` (0.2.0), V3 = `v3.0.0` (1.0.0), V4 = `v4.0.0` (2.0.0), `v4.0.1` (2.0.1). No Linux a pasta é `~/Projects/estudio`.

## Na 2.0.1 (tag v4.0.1)

- **Claude Desktop (`docs/claude-desktop.md`):** o Estúdio passa a ser operado pelo Claude Desktop sem configurar nada à
  mão, pela extensão `Estudio-2.0.1.mcpb` da release ou pelo botão **Conectar ao Claude Desktop** em Configurações › IA.
  Detalhes na seção "Usar pelo Claude Desktop", abaixo.
- **Qualquer agente abre o projeto (`docs/harnesses.md`):** além do `CLAUDE.md`, cada projeto traz o mesmo guia em
  `AGENTS.md` (Codex, Cursor, VS Code, opencode, Antigravity) e `GEMINI.md` (Gemini CLI), e o MCP `estudio` já ligado no
  arquivo de cada harness, com o nome dele no Histórico. Quem clona o código acha as instruções no `AGENTS.md` da raiz.

## Novidades da V4 (pacote 2.0.0, 11/11/2026)

A V4 junta a reformulação (visual neutro, as três levas de UX e as correções auditadas do núcleo) com a rodada 4
(narração por IA, projetos prontos para IDE, portes para Windows e Mac e o CI).

**Atalhos das áreas mudaram:**

- A ordem das áreas segue o uso: **1 Vídeo, 2 Imagem, 3 Animação, 4 Música, 5 Efeitos, 6 3D**. As teclas **1 a 6** (fora
  de campo de texto) e **Alt+1 a 6** (até no terminal) seguem esta ordem; antes eram Vídeo, Imagem, 3D, Efeitos, Música,
  Animação.
- Novos: **Ctrl+\\** foca no monitor (esconde os outros painéis; de novo, volta), **Ctrl+F** põe o monitor em tela cheia
  (Vídeo, Imagem e Animação), **Shift+D** segurado mostra o antes dos efeitos.
- **No Mac, o Cmd (⌘) faz o papel do Ctrl** em todos os atalhos (⌘S, ⌘Z, ⇧⌘E, ⌘\\…), e os menus mostram os rótulos do
  Mac; o Ctrl fica para o terminal. A tecla "delete" do Mac apaga a seleção.

**Visual neutro e as três levas de UX (reformulação):**

- Grafite de croma zero, um acento azul (`#70B8FF`) para seleção, foco e a ação principal, e o violeta só para o que o
  Claude fez. Nenhuma cor de cliente na interface nem nos padrões. O único kit de fábrica é o **Neutro** (destaque branco,
  marcado pelo peso); kits que já estão na pasta da pessoa continuam funcionando.
- **Preferências › Aparência:** tema escuro (padrão), claro ou o do sistema, alto contraste, densidade, tamanho da
  interface (90 a 150%) e reduzir movimento. Os tokens ficam num arquivo só (`src/renderer/estilo/tokens.ts`), e os
  controles são da casa (caixa, segmentado, escolha, interruptor) no lugar dos nativos.
- **"O Claude mudou isto"** no lugar por 30 s: contorno violeta no monitor, barra na lista e na linha do tempo, "era X" no
  inspetor, aviso com Ver e Desfazer. O **Histórico** agrupa por rodada, com o antes → depois compacto de cada campo.
- **Tela inicial** com o pedido ao Claude no alto e os tipos de peça no mesmo peso; **Exportar** com destinos em cartões;
  **Música** com cor por canal, mixer com fader e segunda música pelo menu; **Animação** com seletor de documento (como a
  Música), pré-ajustes de entrada e saída, modo animar e editor de pixel grande; **Efeitos** com amostra de cada
  pré-ajuste. Detalhes em `docs/tela.md` (seções 6 e 7).

**Núcleo e segurança (reformulação, auditado e verificado):**

- A janela só aceita a página do app (arquivo solto ou link não troca a página nem herdam o preload), o IPC confere o
  quadro de origem e só o microfone, a área de transferência e a tela cheia são liberados.
- **Trava de escrita** (`.estudio/escrita.lock`) em toda gravação do projeto, do app e do MCP; o diário fica fora do commit
  automático. Link simbólico em `midia/` para fora do projeto só é lido, nunca gravado.
- **O MCP da IDE passa pelo app quando ele está aberto** (`.estudio/mcp-app.json`): portão de permissão, aviso na tela e
  um escritor só; cada conversa da IDE grava com a própria origem (`ide-<id>`, "Claude na IDE" no Histórico). Com o app
  fechado vale a trava.
- Documento criado pelo Claude aparece na tela por padrão; imagens JPG aceitas nas ferramentas; validações das
  ferramentas MCP, da exportação e do render conferidas uma a uma (`docs/ia.md`).

**Rodada 4:**

- **Narração por IA (`docs/narracao.md`):** a fala de cada cena (`cenas[i].narracao.texto`) vira voz pelo Gemini TTS (a
  chave do Gemini das conversas) ou pelo Google Cloud TTS (Chirp 3: HD, chave própria no cofre). Painel no "+ Áudio" da
  linha do tempo e no inspetor da cena, dicionário de pronúncia, cache por cena em `midia/narracao/`, custo estimado antes
  de gerar, "Outra tomada", ducking da música e "ajustar as cenas à fala". MCP: `vozes_narracao`, `configurar_narracao`,
  `pronuncias_narracao`, `narrar` (cartão do portão; a prévia é livre) e `ajustar_cenas_a_fala`.
- **Projetos prontos para IDE (`docs/ide.md`):** cada projeto leva `.mcp.json`, `.claude/settings.local.json` e `t3.json`
  e abre no T3 Code, no Claude Code ou no Cursor com o MCP `estudio` ligado. O agente vê o vídeo por `ver_quadro`,
  `ver_cenas` e `ver_trecho`. A opção e o "Abrir no T3 Code" ficam em Configurações › IA.
- **Windows e Mac (`docs/portes.md`):** janela com os semáforos do Mac, menu do sistema, PATH, git e microfone por
  sistema, nomes de arquivo que o Windows aceita, whisper-cli no Mac, pasta solta no ícone do Dock abre o projeto,
  pacotes de Windows e Mac a partir do Linux.
- **CI (`.github/workflows/build.yml`):** typecheck, testes e pacotes de Linux, Windows, Mac Apple Silicon e Mac Intel
  (NSIS e DMG), à mão, por tag `v*` ou por branch `ci/*`. Não depende de `exemplos/`.

## Novidades da V3 (pacote 1.0.0, 10/11/2026)

- **Linux (Omarchy/Hyprland):** roda e se instala no lançador de aplicativos com `bash scripts/instalar-linux.sh`; em
  gerenciador em mosaico a janela vem sem os botões sobrepostos. Detalhes em `STACKS.md`.
- **Música (área 4, `docs/musica.md`):** bateria e sintetizadores da casa, passos e piano roll, arranjo com seções e
  acordes, mixer com delay, reverb, limitador e presets, sidechain, automação de volume desenhada no arranjo, pintar
  clipes, exportar WAV, M4A, Opus, MIDI e stems no alvo de loudness, e ida e volta com o vídeo de cenas.
- **Animação (área 3, `docs/animacao.md`):** formas, texto, imagem e camada de pixel com quadros-chave e curvas (a cor
  interpola em OKLab), revelações do pixel (aleatório, decodificar, varredura, do meio, chuva), editor de pixel,
  exportação MP4 e ferramentas para o Claude; modelo "Logo em pixels".
- **Rodada 3 integrada:** painel Mídia, instância única e gravação segura (Casca); três vias de conversa, cofre de chaves
  no chaveiro do sistema e portão de permissão (IA); seleção múltipla, grupos, travas, guias, texto que cabe, PDF A4 e
  carrossel em partes (Imagem); kit por referência, fontes sem internet, ícones, setas e listas (Marca); dividir,
  crossfade, gravar narração e biblioteca de músicas (Som); detector de voz, cortes pela fala e legendas por destino
  (Fala); exportar por destino, marca d'água por rede e limite de erro por painel (Vídeo).
- 888 testes. Conferido no app, área por área, no Linux.
- **Ainda não conferido:** a transcrição de verdade (falta o `whisper-cli` nesta máquina; o painel diz como compilar),
  uma conversa real com o Claude e o cartão de permissão de `destravar_camadas` no app, e o som ouvido de ouvido
  (medido pelos medidores e pelos arquivos).


## Instalar e rodar

**Instalador:** `npm run instalador` gera `Estudio-Setup-<versão>.exe` na raiz do projeto (NSIS, por usuário, com
atalho na área de trabalho e no Iniciar). O guia para outro PC está em `INSTALAR.md`.
**Windows e Mac a partir de qualquer sistema:** `npm run pacote:win` e `npm run pacote:mac` (depois de `npm run
nativos:win` / `nativos:mac`); o DMG e o NSIS saem num Mac e num Windows, ou no CI (`.github/workflows/build.yml`).
Auditoria, o que já foi testado em cada sistema e a lista de verificação: `docs/portes.md`.

Desenvolvimento:

```bash
npm install
node node_modules/electron/install.js   # o npm 11 bloqueia o script que baixa o Electron
npm run dev
```

Para abrir uma pasta direto: `ESTUDIO_PROJETO=<pasta> npm run dev`.

**Prévia web (sem Electron):** quando o Electron não pode rodar (o antivírus deste PC bloqueia o de desenvolvimento),
`npx vite --config vite.renderer.config.ts --port 5199` e abra `http://localhost:5199/scripts/previa-web/index.html`.
A ponte `window.estudio` é simulada em memória (`scripts/previa-web/ponte.ts`): dá para ver a tela inicial, criar um
vídeo de cenas e editar, sem disco e sem o Claude de verdade; a exportação é simulada (o diálogo mostra um andamento de
mentira e nada é gravado).

## Usar pelo Claude Desktop (2.0.1)

O Estúdio também é operado pelo **Claude Desktop**, sem configurar nada à mão. Instale o Estúdio e depois faça uma de
duas coisas: instale a extensão `Estudio-<versão>.mcpb` da release no Claude Desktop (Configurações › Extensões), ou
clique em **Conectar ao Claude Desktop** em Configurações › IA do Estúdio. Em seguida, reinicie o Claude Desktop.

Com o app aberto num projeto, o Claude Desktop trabalha nele: a tela acompanha, tudo entra no Histórico como "Claude
Desktop" com Reverter, e as ações sensíveis pedem permissão na tela do app. Com o app fechado, o Claude lista os
projetos (os recentes e a pasta `Estudio`) e trabalha no que for escolhido.

A extensão é um lançador fino, que roda o MCP do próprio Estúdio instalado e por isso se atualiza junto com o app. Um
`.mcpb` só serve a Windows, Mac e Linux. Ele sai do `npm run mcpb` e do CI (artifact `estudio-claude-desktop`).
Detalhes, limites e como remover: `docs/claude-desktop.md`.

## Começar

O app abre na **tela inicial**:

- **Novo:** escolha Vídeo, Imagem ou 3D, o formato pelo destino (Reels e Shorts 9:16, Feed 4:5, Quadrado 1:1, YouTube
  16:9 ou Personalizado) e o modelo. Clicar no formato marca; clicar no modelo cria; **Enter** cria em branco. Nome,
  pasta e quadros por segundo têm padrão e ficam em "Mais opções". Os projetos vão para `%USERPROFILE%\Estudio`
  (troca em Preferências; o app avisa quando a pasta é do OneDrive).
- **Começar conversando:** descreva o vídeo; Enter cria o projeto em branco e abre a conversa com o Claude já com o
  pedido. Sem o Claude Code instalado, o campo fica desligado e o resto funciona.
- **Continuar e Recentes:** o último projeto com miniatura (a foto do monitor ao fechar) e a grade dos outros, com
  Duplicar, Mostrar na pasta e Remover da lista (nunca apaga a pasta).
- **Ver um exemplo:** cópia nova do projeto de exemplo a cada clique (o exemplo nunca é editado no lugar). Só aparece
  quando a instalação traz o exemplo (`exemplos/<pasta>`, com o nome em `src/nucleo/exemplo.ts`).
- Na primeira vez, a faixa "Antes de começar" mostra o estado do Claude, a pasta dos projetos, o perfil da máquina e
  avisa se falta o Git.

No editor, o menu do ícone tem Novo projeto (Ctrl+N), Novo neste projeto (vídeo, imagem, animação, música, 3D), Abrir (Ctrl+O), Abrir
recente, Duplicar projeto, Mostrar na pasta, Marcar ponto de restauração (Ctrl+S), Marca, Preferências e Fechar projeto
(Ctrl+W, volta à tela inicial). O nome do projeto na barra renomeia com um clique; "Salvo" lembra que tudo grava na
hora. **Exportar** (Ctrl+Shift+E) abre o diálogo de exportação do documento da área (abaixo). O projeto reabre na área, no
documento, na seleção e no tempo em que a pessoa parou.

**Kit de marca:** cores, fontes, logo e assinatura de cada escritório ficam em `%USERPROFILE%\Estudio\marcas\<id>\`
(`marca.json`, `logo.*`, `fontes/*.ttf|otf|woff|woff2`; a pasta troca no painel). Na primeira abertura nasce o `neutro`
(o único kit de fábrica; destaque branco, marcado pelo peso); kits que já estão na pasta ficam como estão. O kit entra em "Mais opções →
Marca" ao criar o projeto e em menu → **Marca…** no editor: aplicar ao documento ativo (o `tema` do vídeo; fundo, fonte
e cor dos textos na imagem), criar, duplicar, editar, importar logo e **fontes próprias** (arquivo), e escolher a fonte
do vídeo. O logo vai para `midia/` e as fontes para `fontes/` do projeto; a prévia e a exportação carregam as fontes
pelo servidor local antes de desenhar.

Para o Claude: na aba **Claude**, a conversa usa o `claude` da própria pessoa (`/login` uma vez pelo terminal, que é
o login próprio do Claude Code). Depois é só pedir: "crie 5 cenas sobre férias proporcionais", "deixe o título maior".

## O que tem

| Área | Na tela | Pelo Claude (MCP `estudio`) |
|---|---|---|
| **Vídeo de cenas** (o que se começa do zero) | qualquer formato; cenas com duração própria e blocos de título, texto, lista, número e imagem; posição em % do quadro (trocar 9:16 por 16:9 não desmonta nada); criar, duplicar (Ctrl+D) e excluir (Delete) cena e bloco; arrastar bloco no quadro e na linha do tempo; alça da cena muda a duração; propriedades com formato, cores, tempo em segundos e letra em px; faixas de som, limpeza de voz e medidor de loudness; legendas da fala; movimento nas imagens | `ler_documento`, `aplicar_patch`, `criar_documento`, `transcrever`, `exportar_legendas`, `importar_legendas` |
| **Carrossel narrado** | cenas com blocos presos às palavras da narração (`palavra@ms`), tema neutro, linha do tempo com a fala, arrastar bloco = entrar em outra palavra; criar bloco, duplicar e excluir partes (`docs/carrossel-narrado.md`) | o mesmo, no `video/roteiro.json` |
| **Imagem** | camadas (imagem, texto, forma), mover, redimensionar, ordem, visível, exportar PNG, JPG ou WebP com qualidade e escala; **carrossel** de várias páginas (barra de páginas, PageUp/PageDown, "Novo carrossel" com campos por página) e exportar PNG por página + PDF para o LinkedIn (`docs/carrossel.md`); sombra, contorno, degradê, foto dentro de forma ou texto e remover fundo (`docs/imagem.md`) | o mesmo (`paginas[]`, `estado_do_editor` diz a página) e `remover_fundo` |
| **3D** | cena Three.js sob demanda, gizmo mover/girar/escala (W/E/R), luzes, câmera, animar | o mesmo |
| **Efeitos** | pilha de efeitos no vídeo ou na imagem, com prévia ao vivo e pré-ajustes | o campo `efeitos` |
| **Pesquisa** (só visualizador: fato é fato, nada se aprova nem bloqueia, nada da fonte é censurado) | painel no grupo do inspetor com as fontes (órgão, nível, data, vigência, observação, abrir e ver o texto) e os fatos (trecho literal, selo exato/parecido/não encontrado, dígitos que faltam, "trecho confere" ou "a revisar"); no vídeo de cenas, os fatos que o bloco cita (`refs`) aparecem como etiquetas no inspetor (`docs/pesquisa.md`) | `ler_fonte`, `anotar_fonte`, `registrar_fato`, `listar_pesquisa`, `texto_da_fonte`, `checar_texto` |

Área sem documento mostra o que falta e cria com um clique no formato do destino.

**Exportar** (botão da barra ou Ctrl+Shift+E) abre o diálogo do documento da área, o único lugar por onde algo sai do
projeto:

- **Vídeo:** destinos (Reels e Shorts 9:16, Feed 4:5, Quadrado 1:1, YouTube 16:9 ou personalizado; o padrão é o formato
  do documento, e marcar vários gera um arquivo por proporção, `Nome-9x16.mp4`, `Nome-4x5.mp4`…; o vídeo de cenas é em
  frações do quadro, então o mesmo documento serve a todas), formato (MP4 H.264, MP4 H.265 ou WebM VP9), qualidade (alta,
  média, leve, como bitrate pelo tamanho e pelos quadros por segundo), escala (1×, 0,75×, 0,5×), trecho em segundos, nome
  e a **estimativa de tamanho** (bitrate × duração). Durante, o andamento de verdade (`onProgress` do `renderMedia`) e
  **Cancelar** (`makeCancelSignal`); no fim, os arquivos em `saidas/` com "Mostrar na pasta". O carrossel narrado é
  fixo em 1080×1920 e só sai em 9:16.
- **Imagem:** PNG, JPG ou WebP, qualidade (JPG e WebP), escala (0,5×, 1×, 2×) e nome, desenhada em resolução cheia com a
  pilha de efeitos. O botão "Exportar PNG" do monitor da imagem continua exportando direto, sem diálogo.

No monitor do vídeo, o botão de **zona segura** (ícone de moldura no transporte) sobrepõe o que a interface de cada rede
cobre: Reels, TikTok e Shorts (faixas de cima e de baixo, coluna de ícones à direita e o corte 3:4 da grade), Feed 4:5
(miolos 1:1 e 3:4 da grade) e YouTube 16:9 (controles, legendas e a área segura de título). Os valores, com a fonte de
cada um, estão em `src/nucleo/zonas-seguras.ts`; a escolha é da interface, não do documento, e não sai na exportação.

**Lâmina** (Ctrl+K ou o botão de tesoura na lista de cenas): divide a cena do vídeo de cenas no tempo da cabeça. Os
blocos ficam na metade em que começam e os que atravessam o corte vão para as duas, aparados; a segunda cena nasce com
ids novos. Ctrl+Z desfaz.

Rodada 2 (07/11/2026), tudo no próprio PC:

- **Som** (`docs/audio.md`): limpeza de voz por clipe em três intensidades, sem tocar no arquivo da pessoa ("Voltar ao
  original"); medidor de loudness BS.1770 da narração, da mistura e da faixa; a exportação mede o arquivo final e corrige
  até o alvo (padrão −14 LUFS e pico de −1 dBTP).
- **Legendas** (`docs/legendas.md`): transcrição local com o whisper.cpp, palavra falada em destaque, cinco estilos com as
  cores do tema, lista para corrigir e localizar e substituir, faixa na linha do tempo, SRT e VTT de ida e volta. As
  legendas andam com o clipe de voz.
- **Movimento** (`docs/exportacao.md`): zoom e deslize suaves nas imagens do vídeo de cenas; "Movimento em todas as
  imagens" passa as que estão em Inteira para Preencher no mesmo Ctrl+Z.
- **Marca d'água por rede** (`docs/exportacao.md`): logo ou assinatura do kit em cada destino, fora das zonas cobertas,
  lembrada no projeto e desenhada só na exportação.
- **Acabamento da imagem** (`docs/imagem.md`): sombra, contorno, degradê (inclusive no fundo), foto recortada por forma
  ou texto e remover fundo com o MODNet, iguais na tela, no PNG e no PDF.

Os modelos não vêm no instalador: baixam no primeiro uso para `%USERPROFILE%\Estudio\modelos` (whisper.cpp 9 MB e
modelo small 190 MB; MODNet 26 MB), com SHA-256 conferido. Licenças: whisper.cpp, modelos Whisper e onnxruntime-web MIT;
MODNet Apache-2.0.

Em todas as áreas:

- **Comentar (M):** clique no quadro. O comentário fica ancorado no objeto (caminho JSON e id), no tempo e no ponto.
- **Histórico:** o diário de mudanças (`.estudio/diario.jsonl`) com quem mudou (pessoa ou agente).
- **Ctrl+Z** desfaz só as edições da pessoa; **Ctrl+S** marca um ponto de restauração no git do projeto.
- **Claude:** conversas e terminais em abas; a conversa pode hibernar e retomar (`--resume`). O limite de sessões
  vivas vem da RAM (2 com 8 GB, 4 com 16 GB, 8 acima).
- **Atalhos:** 1…6 ou Alt+1…6 troca de área (Vídeo, Imagem, Animação, Música, Efeitos, 3D), Ctrl+' vai à conversa,
  Ctrl+\\ foca no monitor, Espaço/J/K/L e ←/→ no vídeo, M comenta, V seleciona.

O agente recebe: `projeto_info`, `estado_do_editor`, `ler_documento`, `aplicar_patch` (com `versao_base` e `test`),
`criar_documento`, `renomear_projeto`, `listar_comentarios`, `ler_comentario`, `responder_comentario`,
`resolver_comentario`, `listar_mudancas`, `aplicar_marca`, `transcrever`, `exportar_legendas`, `importar_legendas`,
`remover_fundo` e, para a pesquisa, `ler_fonte`, `anotar_fonte`, `registrar_fato`, `listar_pesquisa`, `texto_da_fonte` e
`checar_texto`. Cada projeto leva um `CLAUDE.md` com o formato dos documentos dele, o que o kit de marca põe no `tema` e a
seção "Pesquisa" (fontes, fatos e `refs`). A parte escrita pelo app fica entre as marcas `estudio:inicio` e `estudio:fim`
e é refeita ao abrir o projeto, para valer também nos projetos criados antes; o que estiver fora das marcas fica.

**IDE de agentes** (`docs/ide.md`): cada projeto também leva `.mcp.json`, `.claude/settings.local.json` e `t3.json`, e
abre direto no T3 Code, no Claude Code ou no Cursor com o MCP `estudio` ligado. Com o app aberto no projeto, as
gravações passam por ele (portão e aviso na tela); fechado, o MCP grava sozinho com a trava de escrita. O agente vê o
vídeo por `ver_quadro`, `ver_cenas` e `ver_trecho`, que gravam em `saidas/previas/`. A opção fica em Configurações › IA.

## Como é feito

- **Electron 42 + React 19 + TypeScript**, a partir do template oficial de Electron da Remotion (Forge + Vite).
- **Processo principal** (`src/main`): projeto aberto, criar/fechar/duplicar/renomear, recentes e preferências
  (`memoria.ts`, na pasta de dados do app), observador da pasta, git com calma, servidor local em 127.0.0.1 (mídia com
  Range e o **MCP por HTTP**, um token por aba), conversa com o `claude -p` em stream-json, terminais com
  `@lydell/node-pty`, exportação MP4 com `renderMedia`.
- **Núcleo** (`src/nucleo`): documentos, JSON Patch com lock otimista e patch inverso, comentários, diário, formatos
  (`formatos.ts`), o vídeo de cenas (`cenas.ts`), criar projeto (`criar-projeto.ts`, com `modelos.ts` só de dados), o
  kit de marca (`marca.ts` só de dados e regras; `pasta-marcas.ts` lê e grava a pasta), o resolvedor do roteiro do
  carrossel narrado (portado do Python `preparar_carrossel.py`) e as ferramentas MCP.
- **Composições** (`src/composicoes`): `VideoCenas` (tema neutro, formato pelas props) e o `CarrosselTema` do carrossel narrado,
  escolhidos pelo registro (`registro.ts`) na prévia e na exportação; o registro embrulha cada um para carregar as
  fontes de arquivo que o tema cita antes de desenhar (`fontes.ts`: Google Fonts e `@remotion/fonts`).
- **Interface** (`src/renderer`): tela inicial (`inicio/`, sem carregar o editor), casca com dockview (arranjo por
  área, faixa de tela e orientação do vídeo), módulos de vídeo, imagem, 3D (sob demanda) e efeitos.

Os documentos de desenho estão em `docs/`. A pesquisa de uso que deu origem à V2 está em
`tasks/estudio-ux-inicio-2026-11-05/briefing.md` (Onda A).

## Testes

```bash
npm test            # resolvedor do roteiro, MCP por stdio e HTTP, conversa (claude falso), criar projeto e CLAUDE.md, vídeo de cenas, formatos, som e ducking, limpeza de voz e loudness, legendas e transcrição, movimento, marca d'água, kit de marca e fontes, carrossel e PDF, acabamento e remover fundo, lâmina, exportação, zonas seguras, pesquisa (fontes, fatos e leitor de números)
npm run typecheck
npm run e2e         # com o app aberto via ESTUDIO_DEPURAR_PORTA=9471
```

`scripts/e2e-claude.mjs` faz o ciclo completo com o Claude de verdade (precisa do `/login`). `npx tsx scripts/exportar-teste.mjs`
renderiza um vídeo de cenas de teste em 9:16, 4:5 e 16:9 fora do Electron, em `testes/saida/exportar/`.

## Pendências conhecidas

- **Neste PC o Electron de desenvolvimento está bloqueado pelo Bitdefender** (GravityZone): o app instalado roda, mas
  `npm run dev` e o e2e precisam de exceção para a pasta do projeto. A prévia web cobre a interface.
- **Rodada 2 sem teste no app real:** o remover fundo só rodou com um modelo falso, a limpeza de voz foi medida e não
  ouvida, e o IPC da limpeza, do medidor, da transcrição e da marca d'água nunca rodou no Electron.
- **Pesquisa de qualidade** (`tasks/estudio-qualidade-2026-11-07`): defeitos conferidos no código e a barra do que falta.
- **Onda B** (briefing): importar mídia e painel Mídia, o carrossel narrado como
  modelo do tipo cenas, um projeto de exemplo neutro para o "Ver um exemplo", o Claude que planeja (perguntas e Plano do vídeo
  antes de montar), chip de formato no monitor, primeiros passos e "Salvar como modelo".
- **Memória (app empacotado, 05/11/2026):** 307 MB parado no vídeo; 547 MB com as quatro áreas e o 3D. A tela inicial
  agora abre sem o editor (falta medir a linha "Início parado").
- **Fontes** do Google (Inter, Archivo, IBM Plex) baixam na primeira vez (precisa de internet); as de arquivo do kit não.
  O seletor de fonte da camada de texto da imagem ainda lista só as quatro fixas.
- **Licença do Remotion:** a BKM passa de 3 pessoas; uso fora da avaliação pede a Company License.

## Pastas

```
src/main          processo principal (projeto, recentes, servidor local, MCP HTTP, conversa, terminais, exportação)
src/preload       ponte mínima e tipada (window.estudio)
src/compartilhado contrato de IPC
src/nucleo        documentos, patch, diário, comentários, formatos, vídeo de cenas, criar projeto, roteiro do carrossel, MCP
src/composicoes   composições Remotion (VideoCenas, CarrosselTema) e o registro
src/renderer      interface: tela inicial, casca, estado, módulos (video, imagem, tres, efeitos), painéis
mcp/nucleo.ts     o mesmo MCP por stdio, para usar o projeto fora do app
exemplos/        projeto de exemplo do "Ver um exemplo" (opcional; src/nucleo/exemplo.ts)
testes/fixtures  projeto, roteiro e narração sintéticos dos testes
scripts/previa-web a interface no navegador com a ponte simulada
docs/             arquitetura, tela e desempenho
testes/           vitest e fixtures; testes/saida guarda fotos e projetos de teste (ignorado no git)
```
