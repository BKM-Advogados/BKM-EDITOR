# Estúdio (V2)

App desktop que une edição de **vídeo**, **imagem**, **3D** e **efeitos** num lugar só. Tudo é JSON na pasta do
projeto: a pessoa edita na tela, o Claude edita conversando (com a conta da própria pessoa), e as duas mãos passam pelo
mesmo JSON Patch com versão, diário e desfazer. A tela acompanha o arquivo; o agente vê o que a pessoa mudou.

Nome provisório. Pasta: `C:\Users\usuario\projetos\estudio` (fora do OneDrive, por causa do `node_modules`).
Repositório: `BKM-Advogados/BKM-EDITOR` (privado). V1 = tag `v1.0.0`.

## Instalar e rodar

**Instalador:** `npm run instalador` gera `Estudio-Setup-<versão>.exe` na raiz do projeto (NSIS, por usuário, com
atalho na área de trabalho e no Iniciar). O guia para outro PC está em `INSTALAR.md`.

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
- **Ver um pronto:** cópia nova do carrossel C2 da Cliente a cada clique (o exemplo nunca é editado no lugar).
- Na primeira vez, a faixa "Antes de começar" mostra o estado do Claude, a pasta dos projetos, o perfil da máquina e
  avisa se falta o Git.

No editor, o menu do ícone tem Novo projeto (Ctrl+N), Novo neste projeto (vídeo, imagem, 3D), Abrir (Ctrl+O), Abrir
recente, Duplicar projeto, Mostrar na pasta, Marcar ponto de restauração (Ctrl+S), Marca, Preferências e Fechar projeto
(Ctrl+W, volta à tela inicial). O nome do projeto na barra renomeia com um clique; "Salvo" lembra que tudo grava na
hora. **Exportar** (Ctrl+Shift+E) abre o diálogo de exportação do documento da área (abaixo). O projeto reabre na área, no
documento, na seleção e no tempo em que a pessoa parou.

**Kit de marca:** cores, fontes, logo e assinatura de cada escritório ficam em `%USERPROFILE%\Estudio\marcas\<id>\`
(`marca.json`, `logo.*`, `fontes/*.ttf|otf|woff|woff2`; a pasta troca no painel). Na primeira abertura nascem `cliente` (a
paleta do manual, a mesma do carrossel), `bkm` (provisório, para trocar) e `neutro`. O kit entra em "Mais opções →
Marca" ao criar o projeto e em menu → **Marca…** no editor: aplicar ao documento ativo (o `tema` do vídeo; fundo, fonte
e cor dos textos na imagem), criar, duplicar, editar, importar logo e **fontes próprias** (arquivo), e escolher a fonte
do vídeo. O logo vai para `midia/` e as fontes para `fontes/` do projeto; a prévia e a exportação carregam as fontes
pelo servidor local antes de desenhar.

Para o Claude: na aba **Claude**, a conversa usa o `claude` da própria pessoa (`/login` uma vez pelo terminal, que é
o login próprio do Claude Code). Depois é só pedir: "crie 5 cenas sobre férias proporcionais", "deixe o título maior".

## O que tem

| Área | Na tela | Pelo Claude (MCP `estudio`) |
|---|---|---|
| **Vídeo de cenas** (o que se começa do zero) | qualquer formato; cenas com duração própria e blocos de título, texto, lista, número e imagem; posição em % do quadro (trocar 9:16 por 16:9 não desmonta nada); criar, duplicar (Ctrl+D) e excluir (Delete) cena e bloco; arrastar bloco no quadro e na linha do tempo; alça da cena muda a duração; propriedades com formato, cores, tempo em segundos e letra em px | `ler_documento`, `aplicar_patch`, `criar_documento` |
| **Carrossel narrado da Cliente** | o C2 real, com blocos presos às palavras da narração (`palavra@ms`), linha do tempo com a fala, arrastar bloco = entrar em outra palavra; criar bloco, duplicar e excluir partes | o mesmo, no `video/roteiro.json` |
| **Imagem** | camadas (imagem, texto, forma), mover, redimensionar, ordem, visível, exportar PNG, JPG ou WebP com qualidade e escala; **carrossel** de várias páginas (barra de páginas, PageUp/PageDown, "Novo carrossel" com campos por página) e exportar PNG por página + PDF para o LinkedIn (`docs/carrossel.md`) | o mesmo (`paginas[]`, `estado_do_editor` diz a página) |
| **3D** | cena Three.js sob demanda, gizmo mover/girar/escala (W/E/R), luzes, câmera, animar | o mesmo |
| **Efeitos** | pilha de efeitos no vídeo ou na imagem, com prévia ao vivo e pré-ajustes | o campo `efeitos` |

Área sem documento mostra o que falta e cria com um clique no formato do destino.

**Exportar** (botão da barra ou Ctrl+Shift+E) abre o diálogo do documento da área, o único lugar por onde algo sai do
projeto:

- **Vídeo:** destinos (Reels e Shorts 9:16, Feed 4:5, Quadrado 1:1, YouTube 16:9 ou personalizado; o padrão é o formato
  do documento, e marcar vários gera um arquivo por proporção, `Nome-9x16.mp4`, `Nome-4x5.mp4`…; o vídeo de cenas é em
  frações do quadro, então o mesmo documento serve a todas), formato (MP4 H.264, MP4 H.265 ou WebM VP9), qualidade (alta,
  média, leve, como bitrate pelo tamanho e pelos quadros por segundo), escala (1×, 0,75×, 0,5×), trecho em segundos, nome
  e a **estimativa de tamanho** (bitrate × duração). Durante, o andamento de verdade (`onProgress` do `renderMedia`) e
  **Cancelar** (`makeCancelSignal`); no fim, os arquivos em `saidas/` com "Mostrar na pasta". O carrossel narrado da Cliente é
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

Em todas as áreas:

- **Comentar (M):** clique no quadro. O comentário fica ancorado no objeto (caminho JSON e id), no tempo e no ponto.
- **Histórico:** o diário de mudanças (`.estudio/diario.jsonl`) com quem mudou (pessoa ou agente).
- **Ctrl+Z** desfaz só as edições da pessoa; **Ctrl+S** marca um ponto de restauração no git do projeto.
- **Claude:** conversas e terminais em abas; a conversa pode hibernar e retomar (`--resume`). O limite de sessões
  vivas vem da RAM (2 com 8 GB, 4 com 16 GB, 8 acima).
- **Atalhos:** Alt+1…4 troca de área, Ctrl+' vai à conversa, Espaço/J/K/L e ←/→ no vídeo, M comenta, V seleciona.

O agente recebe: `projeto_info`, `estado_do_editor`, `ler_documento`, `aplicar_patch` (com `versao_base` e `test`),
`criar_documento`, `renomear_projeto`, `listar_comentarios`, `ler_comentario`, `responder_comentario`,
`resolver_comentario`, `listar_mudancas` e `aplicar_marca`. Cada projeto novo leva um `CLAUDE.md` com o formato dos
documentos dele e o que o kit de marca põe no `tema`.

## Como é feito

- **Electron 42 + React 19 + TypeScript**, a partir do template oficial de Electron da Remotion (Forge + Vite).
- **Processo principal** (`src/main`): projeto aberto, criar/fechar/duplicar/renomear, recentes e preferências
  (`memoria.ts`, na pasta de dados do app), observador da pasta, git com calma, servidor local em 127.0.0.1 (mídia com
  Range e o **MCP por HTTP**, um token por aba), conversa com o `claude -p` em stream-json, terminais com
  `@lydell/node-pty`, exportação MP4 com `renderMedia`.
- **Núcleo** (`src/nucleo`): documentos, JSON Patch com lock otimista e patch inverso, comentários, diário, formatos
  (`formatos.ts`), o vídeo de cenas (`cenas.ts`), criar projeto (`criar-projeto.ts`, com `modelos.ts` só de dados), o
  kit de marca (`marca.ts` só de dados e regras; `pasta-marcas.ts` lê e grava a pasta), o resolvedor do roteiro da Cliente
  (portado do Python, bate com o `preparar_carrossel.py` no C2) e as ferramentas MCP.
- **Composições** (`src/composicoes`): `VideoCenas` (tema neutro, formato pelas props) e o `CarrosselTema` da Cliente,
  escolhidos pelo registro (`registro.ts`) na prévia e na exportação; o registro embrulha cada um para carregar as
  fontes de arquivo que o tema cita antes de desenhar (`fontes.ts`: Google Fonts e `@remotion/fonts`).
- **Interface** (`src/renderer`): tela inicial (`inicio/`, sem carregar o editor), casca com dockview (arranjo por
  área, faixa de tela e orientação do vídeo), módulos de vídeo, imagem, 3D (sob demanda) e efeitos.

Os documentos de desenho estão em `docs/`. A pesquisa de uso que deu origem à V2 está em
`tasks/estudio-ux-inicio-2026-11-05/briefing.md` (Onda A).

## Testes

```bash
npm test            # TESTES_TOTAL testes: resolvedor × Python, MCP por stdio e HTTP, conversa (claude falso), criar projeto, vídeo de cenas, formatos, som e ducking, kit de marca e fontes, carrossel e PDF, lâmina, exportação, zonas seguras
npm run typecheck
npm run e2e         # com o app aberto via ESTUDIO_DEPURAR_PORTA=9471
```

`scripts/e2e-claude.mjs` faz o ciclo completo com o Claude de verdade (precisa do `/login`). `npx tsx scripts/exportar-teste.mjs`
renderiza um vídeo de cenas de teste em 9:16, 4:5 e 16:9 fora do Electron, em `testes/saida/exportar/`.

## Pendências conhecidas

- **Neste PC o Electron de desenvolvimento está bloqueado pelo Bitdefender** (GravityZone): o app instalado roda, mas
  `npm run dev` e o e2e precisam de exceção para a pasta do projeto. A prévia web cobre a interface.
- **Onda B** (briefing): transcrição local da narração (whisper.cpp), importar mídia e painel Mídia, o Carrossel Cliente como
  modelo do tipo cenas (a paleta e as fontes dele já vêm do kit `cliente`), o Claude que planeja (perguntas e Plano do vídeo
  antes de montar), chip de formato no monitor, primeiros passos e "Salvar como modelo".
- **Memória (app empacotado, 05/11/2026):** 307 MB parado no vídeo; 547 MB com as quatro áreas e o 3D. A tela inicial
  agora abre sem o editor (falta medir a linha "Início parado").
- **Fontes** do Google (Inter, Archivo, IBM Plex) baixam na primeira vez (precisa de internet); as de arquivo do kit não.
  O seletor de fonte da camada de texto da imagem ainda lista só as quatro fixas.
- **Licença do Remotion:** a BKM e a Cliente passam de 3 pessoas; uso fora da avaliação pede a Company License.

## Pastas

```
src/main          processo principal (projeto, recentes, servidor local, MCP HTTP, conversa, terminais, exportação)
src/preload       ponte mínima e tipada (window.estudio)
src/compartilhado contrato de IPC
src/nucleo        documentos, patch, diário, comentários, formatos, vídeo de cenas, criar projeto, roteiro da Cliente, MCP
src/composicoes   composições Remotion (VideoCenas, CarrosselTema) e o registro
src/renderer      interface: tela inicial, casca, estado, módulos (video, imagem, tres, efeitos), painéis
mcp/nucleo.ts     o mesmo MCP por stdio, para usar o projeto fora do app
exemplos/exemplo    projeto de exemplo (vídeo, capa, cena 3D, mídia), base dos modelos da Cliente
scripts/previa-web a interface no navegador com a ponte simulada
docs/             arquitetura, tela e desempenho
testes/           vitest e fixtures; testes/saida guarda fotos e projetos de teste (ignorado no git)
```
