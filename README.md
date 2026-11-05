# Estúdio (MVP)

App desktop que une edição de **vídeo**, **imagem**, **3D** e **efeitos** num lugar só. Tudo é JSON na pasta do
projeto: a pessoa edita na tela, o Claude edita pelo terminal embutido (com a conta da própria pessoa), e as duas mãos
passam pelo mesmo JSON Patch com versão, diário e desfazer. A tela acompanha o arquivo; o agente vê o que a pessoa mudou.

Nome provisório. Pasta: `C:\Users\usuario\projetos\estudio` (fora do OneDrive, por causa do `node_modules`).

## Rodar

```bash
npm install
node node_modules/electron/install.js   # o npm 11 bloqueia o script que baixa o Electron
npm run dev
```

Na primeira vez, clique em **Abrir o exemplo (Cliente · C2)**: ele copia `exemplos/exemplo` para `%USERPROFILE%\Estudio\exemplo`
(fora de Documentos, que o OneDrive pode mover). Para abrir uma pasta direto: `ESTUDIO_PROJETO=<pasta> npm run dev`.

**Executável:** `npm run package` gera `out\Estudio-win32-x64\Estudio.exe` (a pasta inteira, ~450 MB, é o app; ainda sem
instalador, o `forge.config.ts` não tem makers).

Na aba **Claude** do terminal, rode `/login` uma vez (o Claude Code CLI desta máquina tem login próprio, separado do
app desktop) e confie na pasta. Depois é só pedir: "resolva o comentário cmt_0001", "deixe o título da capa maior",
"gire o anel 3D mais devagar".

## O que tem

| Área | Na tela | Pelo terminal (MCP `estudio`) |
|---|---|---|
| **Vídeo** | o carrossel C2 real (composição da Cliente no Remotion Player), seleção de bloco no quadro, arrastar e redimensionar, propriedades com conferência das âncoras `palavra@ms`, linha do tempo com cenas, blocos e fala, arrastar bloco = entrar em outra palavra | `ler_documento`, `aplicar_patch` no `video/roteiro.json` |
| **Imagem** | capa em camadas (imagem, texto, forma), mover, redimensionar, ordem, visível, exportar PNG | o mesmo, no `imagem/capa.json` |
| **3D** | cena Three.js sob demanda, gizmo mover/girar/escala (W/E/R), luzes, câmera, animar | o mesmo, no `3d/cena.json` |
| **Efeitos** | pilha de efeitos (desfoque, brilho, contraste, saturação, matiz, sépia, vinheta, granulado, tom) no vídeo ou na imagem, com prévia ao vivo e pré-ajustes | o campo `efeitos` de cada documento |

Em todas as áreas:

- **Comentar (M):** clique no quadro. O comentário fica ancorado no objeto (caminho JSON e id), no tempo e no ponto.
  O agente lê com `listar_comentarios` / `ler_comentario`, responde e resolve. "Pedir ao Claude" manda o pedido para a aba.
- **Histórico:** o diário de mudanças (`.estudio/diario.jsonl`) com quem mudou (pessoa ou agente, e de qual aba).
- **Ctrl+Z** desfaz só as edições da pessoa; o que o agente fez não é desfeito por engano.
- **Terminal:** várias abas do Claude e de shell em paralelo. A aba pode **hibernar** (libera a memória) e **retomar**
  a mesma conversa (`--resume`). O limite de sessões vivas vem da RAM da máquina (2 com 8 GB, 4 com 16 GB, 8 acima).
- **Atalhos:** Alt+1…4 troca de área (vale com o terminal em foco), Ctrl+' vai ao terminal, Espaço/J/K/L e ←/→ no
  vídeo, M comenta, V seleciona, Esc cancela.

O agente recebe as ferramentas: `projeto_info`, `estado_do_editor` (o que a pessoa está vendo e selecionou),
`ler_documento`, `aplicar_patch` (com `versao_base` e `test`; recusa se o documento mudou por baixo),
`listar_comentarios`, `ler_comentario`, `responder_comentario`, `resolver_comentario`, `listar_mudancas`.
Cada projeto leva um `CLAUDE.md` explicando os arquivos e o jeito de trabalhar.

## Como é feito

- **Electron 42 + React 19 + TypeScript**, a partir do template oficial de Electron da Remotion (Forge + Vite).
- **Processo principal** (`src/main`): projeto aberto, observador da pasta, git com calma, servidor local em
  127.0.0.1 (mídia com Range para a prévia e o render, e o **MCP por HTTP**, um token por aba), terminais com
  `@lydell/node-pty` rodando o `claude` direto (sem shell no meio), exportação MP4 com `renderMedia`.
- **Núcleo** (`src/nucleo`): documentos, JSON Patch com lock otimista e patch inverso, comentários, diário, o
  resolvedor do roteiro **portado do Python para TypeScript** (bate com o `preparar_carrossel.py` no C2) e as ferramentas MCP.
- **Composições** (`src/composicoes`): o CarrosselTema do motor do Mac, com a narração tocada em trechos do vídeo-fonte
  (mudar pausa não exige regravar áudio), mídia pelo servidor local e a camada de efeitos.
- **Interface** (`src/renderer`): casca com dockview (arranjo por área e por faixa de tela), módulos de vídeo, imagem,
  3D (carregado só quando abre) e efeitos, terminais fora do React (sobrevivem à troca de área).

Os documentos de desenho estão em `docs/`: `arquitetura.md`, `tela.md` e `desempenho.md` (pesquisa em grafo de
agentes, 04/11/2026). O MVP adota deles: terminal na coluna da direita, faixas C/P, atalhos, cores, MCP por HTTP,
`claude` direto no PTY, hibernação e perfis por RAM. O que ficou para os próximos passos está abaixo.

## Testes

```bash
npm test            # resolvedor × Python, MCP por stdio e por HTTP (10 testes)
npm run e2e         # com o app aberto via ESTUDIO_DEPURAR_PORTA=9471: seleção, edição, comentário, mudança de fora, áreas
```

`scripts/e2e-claude.mjs` faz o ciclo completo com o Claude de verdade (precisa do `/login` na aba).

## Pendências conhecidas

- **Memória (app empacotado, 05/11/2026, memória privada de todos os processos, sem o `claude`):** 307 MB parado no
  vídeo; 547 MB depois de passar pelas quatro áreas com o 3D aberto. Orçamento do `desempenho.md`: 300 MB parado e
  500–650 MB editando. O maior é o processo da GPU (117 → 286 MB com o 3D): soltar o contexto WebGL ao sair do 3D é o
  próximo corte. Cada aba viva do Claude soma ~240 MB (é o próprio Claude Code).
- **Instalador:** `npm run package` funciona e passa no e2e; falta configurar um maker (`npm run make`) para gerar
  instalador.
- **Áudio:** a prévia toca a narração sem a normalização a −16 LUFS e sem o `mix.py`; a mixagem por medida em TS e a
  transcrição (Whisper) ficam para depois.
- **Fontes** do tema vêm do Google Fonts na primeira vez (precisa de internet).
- **Licença do Remotion:** a BKM e a Cliente passam de 3 pessoas; uso fora da avaliação pede a Company License.
- Do `arquitetura.md`, ficam para depois: endereçamento por `@id`, schemas Zod com propriedades geradas, utility
  processes para PTY e render, hooks do Claude com o chip de contexto, git com um autor por commit, cena 3D e imagem
  como blocos dentro do vídeo, cortar/aparar na linha do tempo.
- Os hooks globais do Claude da pessoa também rodam nas abas (aparecem como "hook error" se dependerem de outro shell).

## Pastas

```
src/main          processo principal (projeto, servidor local, MCP HTTP, terminais, exportação)
src/preload       ponte mínima e tipada (window.estudio)
src/compartilhado contrato de IPC
src/nucleo        documentos, patch, diário, comentários, resolvedor do roteiro, ferramentas MCP, efeitos
src/composicoes   composições Remotion (prévia e exportação)
src/renderer      interface: casca, estado, módulos (video, imagem, tres, efeitos), painéis
mcp/nucleo.ts     o mesmo MCP por stdio, para usar o projeto fora do app
exemplos/exemplo    projeto de exemplo (vídeo, capa, cena 3D, mídia)
docs/             arquitetura, tela e desempenho
testes/           vitest e fixtures; testes/saida guarda fotos e projetos de teste (ignorado no git)
```
