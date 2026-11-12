# Casca, projeto, mídia e regras (frente Casca, rodada 3)

O que a frente Casca cuida: a janela e o processo principal (instância, queda do renderer), a gravação do projeto, a barra, o
rodapé e a tela inicial, as regras de conteúdo, o `.gitignore` e o `CLAUDE.md` do projeto criado e o painel de mídia. Este
doc diz o que mudou na rodada 3, onde está e como se vê.

## Painel de mídia

Aba **Mídia** ao lado da Lista (em todos os arranjos; o menu do projeto tem "Mídia do projeto" para reabri-la se for fechada; o
layout padrão subiu para a versão 7). Mostra o que há em `midia/`:

- **Cartões** com miniatura (o próprio arquivo: a imagem, ou o primeiro quadro do vídeo; só carrega perto da tela), tipo, duração e
  tamanho. Os arquivos gerados a partir de outro (transcrição `.palavras.json`, loudness `.envelope.json`, voz limpa
  `.limpo[-leve|-forte].wav`, recorte `.<código>.sem-fundo.png`) ficam **dentro do original**, como linha de resumo e lista nos
  detalhes, e não como cartões soltos. O envelope da voz limpa sobe até o original.
- **Busca** por palavras, sem acento nem caixa, no nome, na pasta, na nota e nos derivados ("transcrito", "sem fundo", "voz
  limpa"); **filtros** de tipo, de marca (boas, descartadas, sem marca) e de pasta (com subpastas); ordem por nome, recentes ou maiores.
  Critério medido (`testes/midia.test.ts`): com 500 arquivos, montar o índice e buscar juntos cabem em 100 ms; a busca sozinha fica em
  poucos ms.
- **Tomadas**: "Boa", "Descartar" e uma nota por arquivo (teclas **B** e **X** com o cartão selecionado; setas andam entre os cartões).
  Fica em `midia/marcas.json` (não vira cartão), entra no diário como da pessoa (tem Histórico e Reverter) e o Claude lê pela
  `listar_midia`. Tomada descartada fica apagada na grade, nunca é apagada do disco.
- **Detalhes** do cartão: prévia (imagem, vídeo ou áudio com controles), duração, dimensões, tamanho, data, derivados e em que
  documentos o arquivo é usado.
- **Usar em…**: leva o arquivo ao documento aberto do outro módulo pelo mesmo caminho da mão: imagem → bloco de imagem na cena de
  trabalho do vídeo (`adicionarBloco` + `src`) ou camada nova na imagem (`novaImagem`); áudio → clipe de narração, música ou efeito
  na linha do tempo (`adicionarClipeAudio`). Cada destino só aparece quando o documento existe e serve ao tipo. Vídeo bruto ainda não
  entra nas cenas: serve para ver e marcar. Tudo entra por patch, com diário e Ctrl+Z. O destino da Música entra em
  `src/renderer/paineis/midia-uso.ts` (`destinosDaMidia`) quando o contrato `levar_para` / `concluir_transicao` dela existir; hoje
  o "voltar" é o Ctrl+Z e o Reverter do diário.
- **Trazer…** copia um arquivo de fora para `midia/` (o mesmo diálogo de "Escolher arquivo"); a lista relê sozinha quando algo de
  `midia/` muda no disco (a pessoa traz um arquivo, o Claude grava uma tomada, a limpeza de voz termina).

Código: núcleo puro em `src/nucleo/midia.ts` (a interface importa), cabeçalhos em `midia-cabecalho.ts` (dimensões de
PNG/JPEG/GIF/WebP e duração de WAV e MP4/MOV/M4A sem decodificar; MP3 usa o envelope medido), disco em `midia-disco.ts`, IPC em
`src/main/ipc-midia.ts` (`window.estudio.midia.indice` e `.marcar`), painel em `src/renderer/paineis/Midia.tsx`.

### Ferramentas MCP da mídia

| Ferramenta | Classe | O que faz |
|---|---|---|
| `listar_midia` {busca?, tipo?, pasta?, marca?, ordem?, limite?} | `livre` (só lê) | Arquivos de `midia/` com tipo, tamanho, duração, dimensões, marca, derivados sob o original e onde são usados. |
| `marcar_midia` {caminho, estado? (`boa`, `descartada`, `nenhuma`), nota?} | `livre` | Marca a tomada e/ou anota. Grava só `midia/marcas.json`, devolve o `seq` do diário (Ver e Reverter). Não apaga nem move mídia. |

### Para o guia da IA

Texto para a coordenação juntar no `claudeMd`: "`listar_midia` mostra o que há em `midia/` (duração, dimensões, marca da tomada,
derivados e onde cada arquivo é usado); `marcar_midia` marca a tomada como `boa` ou `descartada` e guarda uma nota. Prefira a
tomada marcada como boa e não use a descartada sem perguntar. Para usar um arquivo: bloco `imagem` no vídeo de cenas
(`add /cenas/N/blocos/-` com `tipo: "imagem"`, `src: "midia/x.png"`, `ajuste`, `em`, `sai`, posição), clipe em `/audio/faixas/F/clipes/-`
(`arquivo: "midia/x.wav"`, `em`, `duracao_ms`) ou camada de imagem em `/camadas/-` (`tipo: "imagem"`, `src`)."

## O app que não perde trabalho

| Defeito | O que faz agora | Onde |
|---|---|---|
| transversal-D8 | Gravar um JSON com o arquivo preso (OneDrive, antivírus lendo) tenta o rename de novo após 20, 40, 80, 160 e 320 ms (menos de 1 s). Sem sucesso, apaga o `.tmp` e diz em português que o arquivo está em uso. | `src/nucleo/gravar-seguro.ts`, `Projeto.gravarTexto` |
| transversal-D5 | Um Estúdio por pasta de dados. A segunda abertura traz a primeira para a frente (restaura se minimizada) e sai. `ESTUDIO_VARIAS_INSTANCIAS=1` libera uma instância de desenvolvimento ao lado da instalada. | `src/main/janela-segura.ts`, `main.ts` |
| transversal-D6 | O renderer que cai (falta de memória) recarrega a janela; o projeto segue aberto no processo principal e a tela o relê. No máximo 3 recargas por minuto: depois disso um aviso diz que o trabalho já está gravado e pede para reabrir o app. | `src/main/janela-segura.ts`, `main.ts` |
| transversal-D7 | Vídeo (`mp4 mov mkv webm avi m4v mts mxf`) e áudio sem perda (`flac aif aiff`) em `midia/` ficam fora do git por extensão, no `.gitignore` do projeto novo. O resto de `midia/` sai do git acima de 25 MB: antes de cada commit automático a sessão acrescenta o caminho exato ao `.gitignore`. O que já entrou no histórico continua nele. Os JSON ao lado (transcrições, envelopes) seguem versionados. | `src/nucleo/midia-git.ts`, `SessaoProjeto.ignorarMidiaPesada` |

## Teclas, avisos e telas

- **transversal-D4.** Ctrl+O, Ctrl+N e Ctrl+W valem só fora do terminal: com o foco no terminal, o Ctrl+W apaga a palavra. O menu
  do projeto tem os três itens. Ctrl+S, Ctrl+Shift+E, Alt+1 a 4 e Ctrl+' seguem valendo em qualquer lugar. `casca/atalhos.ts`.
- **transversal-D10.** O erro fica 9 s no rodapé, o mesmo prazo da loja (antes o rodapé o escondia aos 4 s). `estado/gravacao.ts`.
- **transversal-D11.** O selo da barra mostra "Salvo", "Gravando…" ou "Não salvo" (com o motivo no título), até uma gravação dar
  certo. `casca/SeloSalvo.tsx`, `loja.gravacao`.
- **transversal-D16.** As edições da pessoa saem uma por vez em cada documento: cada uma lê a versão que a anterior deixou. Se
  mesmo assim uma não entrar e havia edição da própria pessoa na frente, o aviso diz "duas edições seguidas se cruzaram" em vez
  de culpar o agente. `estado/loja.ts` (`aplicar`), `estado/gravacao.ts`.
- **transversal-D17.** Tamanho personalizado de 16 a 7680 px: o campo da tela inicial fica vermelho com o limite enquanto o valor é
  inválido e volta ao limite mais perto ao sair dele; `limitarTamanho` (formatos.ts) também vale na criação do documento, pelo MCP
  e pelo app.
- **transversal-D21.** `scripts/e2e-boas-vindas.mjs` procura "Ver um exemplo".

## Regras de conteúdo no texto do vídeo

- **transversal-D18.** A frase de fecho que as regras pedem ("Ficou com alguma dúvida? Procure um advogado trabalhista.", também sem o
  ponto final) não recebe o aviso de "advogado". O resto do texto continua sendo checado.
- **transversal-D19.** Termo que termina em símbolo (`r$`, `100%`) não exige fronteira depois: "R$500" avisa como "R$ 500".
- **transversal-N5.** `checar_texto` de um vídeo de cenas passa as legendas pelas regras (`onde: "legenda <id>"`, com a quebra de
  linha tratada como espaço) e a frase de fecho vale se vier no último bloco **ou** na última legenda (por `sai`).

## CLAUDE.md do projeto

- **imagem-N3.** O `CLAUDE.md` escrito à mão (o do projeto de exemplo) leva, entre `<!-- estudio:imagem:inicio -->` e
  `<!-- estudio:imagem:fim -->`, a lista de imagem do app (camadas, páginas, sombra, contorno, degradê, máscara, `remover_fundo`).
  O bloco é refeito ao abrir; o texto à mão fora dele não é tocado; projeto antigo criado do exemplo ganha o bloco no fim; projeto sem módulo
  de imagem não o recebe.
- **imagem-N5.** Ao trocar o texto sem marcas da 0.2.0 ou 0.3.0 pelo novo, as linhas que o app nunca escreveu vão para a seção
  "Anotações do texto anterior" em vez de sumir. A lista do que o app escreveu está em `src/nucleo/claude-md-antigo.ts` (gerada
  do `claudeMd` dos commits `c0407e5`, `63416c0` e `580050c`).

## Ferramentas MCP e permissão

As ferramentas novas da frente são `listar_midia` e `marcar_midia`, as duas `livre` (tabela na seção do painel de mídia). Além delas,
muda a saída de uma que existe: `checar_texto` (classe `livre`, só lê) agora devolve avisos das legendas e `ultima_frase.termina`
considera a última legenda.

## Para o guia da IA

Texto para a coordenação juntar no `claudeMd` (item 6 da seção "Pesquisa"): "`checar_texto` também confere as legendas do vídeo de
cenas; a frase de fecho vale dita na última cena ou na última legenda."

## Não verificado

Nada disto rodou no Electron de verdade (o de desenvolvimento não abre neste PC): a instância única, a recarga do renderer, o
selo e os campos de tamanho foram testados na lógica pura (vitest) e pelo typecheck. O que o responsável confere no app: abrir o Estúdio
duas vezes (a segunda só traz a primeira para a frente); digitar 9000 no tamanho livre; Ctrl+W dentro do terminal; segurar
Alt+seta na pilha de efeitos (sem aviso de "outra mão"); um erro de gravação deixa o selo em "Não salvo". Do painel de mídia: abrir
a aba Mídia, buscar "transcrito", marcar uma tomada com B e conferir no Histórico, usar uma foto em "Usar em…". O painel foi visto
na prévia web (arquivos de exemplo), não no Electron; as miniaturas são o próprio arquivo (sem cache de miniatura) e o áudio
não tem forma de onda nelas.

## Tela inicial (Onda B, frente 1: `onda-b/inicio`)

- **Ver um exemplo.** O exemplo é neutro e sintético: um vídeo de cenas vertical de 23 s (abertura, blocos, número,
  imagem com aproximação e fecho), tema neutro, duas imagens SVG desenhadas no código, sem logo, foto, áudio ou nome de
  ninguém. O conteúdo mora em `src/nucleo/exemplo-conteudo.ts`; `npm run exemplo` (`scripts/gerar-exemplo.ts`) grava
  `exemplos/exemplo`, que o `forge.config.ts` empacota. O `CLAUDE.md` não vai junto: o app o escreve ao abrir a cópia,
  com o texto da versão instalada. `testes/exemplo.test.ts` falha se a pasta versionada não for a do gerador, se o vídeo
  tiver aviso, se uma imagem citada faltar, se aparecer marca, ou se dois cliques não derem duas pastas.
- **Salvar como modelo.** Menu do ícone do editor: "Salvar como modelo…" (o projeto) e, com mais de um documento,
  "Salvar este documento como modelo…". O modelo vai para `%USERPROFILE%\Estudio\meus-modelos\<id>\` (Preferências ›
  "Pasta dos seus modelos"; `ESTUDIO_MODELOS` fora do app). Não é `Estudio\modelos`, que guarda o whisper e o MODNet. A
  pasta tem `modelo.json` (nome, tipo, tamanho, documentos), `miniatura.jpg` (a do projeto, se houver) e `projeto/` com o
  `estudio.json`, os documentos e só a mídia que eles citam (`midia/` e `fontes/`). Diário, `.git`, conversas,
  `saidas/`, pesquisa e comentários ficam no projeto. `src/nucleo/pasta-modelos.ts`, IPC em `src/main/ipc-modelos.ts`.
- **Seus modelos em Novo.** A tela inicial lista os modelos da pessoa nos Modelos do tipo deles, depois dos de fábrica,
  com "Seu modelo · tamanho". Clicar cria o projeto (`criarPastaDoModelo`, `src/nucleo/novo-projeto.ts`): documentos e
  mídia do modelo, `CLAUDE.md` e `.gitignore` novos, pasta livre ("Nome", "Nome (2)"). O kit escolhido na ficha troca o
  tema; Neutro mantém o do modelo. O menu do cartão tem Renomear (o id e a pasta ficam), Mostrar na pasta e Remover
  (apaga a pasta do modelo depois de confirmar; os projetos criados dele não mudam). Os de fábrica (`modelos.ts`) não
  moram na pasta, então não se renomeiam nem se removem.
- **Carrossel narrado.** Modelo de fábrica do vídeo, 9:16 fixo (`src/nucleo/modelo-carrossel-narrado.ts`; a decisão
  está em `docs/carrossel-narrado.md`).
- **MCP.** `salvar_como_modelo {nome, descricao?, documento?}`, classe cartão (grava fora do projeto, sem Reverter),
  citada no passo das marcas do guia do projeto. `src/nucleo/mcp-modelos.ts`.
- **Prévia web.** `scripts/previa-web/ponte.ts` abre o exemplo de verdade (mídia servida de `exemplos/exemplo`), cria o
  carrossel narrado e guarda os modelos da pessoa em memória.

O que só se confere com o app aberto: "Ver um exemplo" duas vezes no Electron (duas pastas em `~/Estudio`, a prévia toca e
as imagens SVG aparecem; `scripts/e2e-boas-vindas.mjs` faz isso); "Salvar como modelo" num projeto com mídia, o cartão com a
miniatura na tela inicial, criar a partir dele, Renomear, Mostrar na pasta e Remover; a pasta trocada nas Preferências; o
carrossel narrado com a narração gerada de verdade e "Ajustar as cenas à fala". Na prévia web foram vistos o diálogo de
salvar, o cartão com o menu, o exemplo (as cinco cenas, a lista, o SVG de blocos e a paisagem) e o carrossel narrado.
