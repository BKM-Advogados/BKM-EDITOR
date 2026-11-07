# Fala: transcrição local e legendas

Versão 1, de 07/11/2026 (rodada 2, frente D). A fala da narração vira texto no próprio PC, com o tempo de cada palavra,
e o texto vira legendas no vídeo de cenas, com a palavra falada em destaque, estilos com as cores do kit de marca,
edição em lista e SRT/VTT de ida e volta. Nada sai da máquina.

## Transcrição local

**Motor:** [whisper.cpp](https://github.com/ggml-org/whisper.cpp) v1.9.5 (build b5454, 06/10/2026), decisão do responsável.
O processo principal (`src/main/transcricao.ts`) faz quatro coisas:

1. **Baixa no primeiro uso** o que falta para `%USERPROFILE%\Estudio\modelos\whisper\`, por um arquivo `.parcial`
   que só vira o arquivo final se o tamanho e o SHA-256 baterem. O zip do binário é aberto por um leitor próprio
   (guardado e deflate) e só ficam o `whisper-cli.exe`, as DLLs e a licença, em `bin\`. Andamento na tela.
2. **Tira o áudio** do arquivo do projeto em WAV PCM 16 kHz mono com o `ffmpeg.exe` do compositor do Remotion (o mesmo
   da exportação: `node_modules/@remotion/compositor-win32-x64-msvc/`, e `app.asar.unpacked` no app instalado). Aceita
   um trecho (`de_ms`, `dur_ms`).
3. **Roda o `whisper-cli`** em português, decodificação gulosa, com o JSON completo (`-ojf`: tempo de cada token) e um
   começo de conversa com o vocabulário do direito do trabalho (`PROMPT_PADRAO`; a pessoa ou o Claude troca pelo
   `vocabulario`). Threads: núcleos − 1, até 8.
4. **Junta os tokens em palavras** (token que começa com espaço abre palavra; pedaço e pontuação grudam na anterior; a
   pontuação solta não estica a palavra por cima da pausa) e grava `midia/<arquivo>.palavras.json`.

Um de cada vez; **Cancelar** mata o processo. Sem o binário, o modelo ou o ffmpeg, o resto do app funciona e a tela diz
o que falta. Fora do Windows x64 a função fica indisponível com aviso (não há binário pronto para os outros).

### O que baixa

| Arquivo | Origem (presa) | Tamanho | SHA-256 | Licença |
|---|---|---|---|---|
| `whisper-bin-x64.zip` (whisper-cli, whisper.dll, ggml*.dll, SDL2.dll) | github.com/ggml-org/whisper.cpp/releases/download/b5454 | 8.928.640 | `6ba69e34…816ccb` | MIT (whisper.cpp e ggml); SDL2 é zlib |
| `ggml-small-q5_1.bin` (padrão) | huggingface.co/ggerganov/whisper.cpp, commit 5359861 | 190.085.487 | `ae85e4a9…0411bb` | MIT (pesos do Whisper da OpenAI) |
| `ggml-base-q5_1.bin` (opcional, mais rápido) | idem | 59.707.625 | `422f1ae4…1f01a8898` | MIT |

Os SHA-256 inteiros estão em `transcricao.ts`. O do zip é o que o próprio GitHub publica no lançamento, conferido no
arquivo baixado; os dos modelos são o oid do LFS no Hugging Face. Nada disso entra no instalador.

### Medido (07/11/2026, i5-1135G7, 32 GB, 7 threads)

Narração do exemplo Cliente C2 (72 s, pt-BR), contra o `video/palavras.json` do exemplo (`scripts/transcrever-teste.mjs`):

| Configuração | Tempo | Pico de memória do whisper-cli | Palavras erradas | Começo da palavra (mediana / p90) |
|---|---|---|---|---|
| **small, guloso, com vocabulário (padrão)** | ~30 s | 465 MB | 3,6% | 120 / 300 ms |
| small, guloso, sem vocabulário | 29,8 s | 465 MB | 4,6% | 120 / 290 ms |
| small, feixe 5 | 73,8 s | 595 MB | 4,1% | 110 / 280 ms |
| base, guloso | 14,7 s | 271 MB | 8,2% | 140 / 280 ms |
| small, guloso, DTW | 53,7 s | 612 MB | 4,6% | 200 / 380 ms |

"Palavras erradas" conta "25 %" da referência contra "25%" como dois erros; sem isso o small fica perto de 2,6%. Os
erros que sobram são de ouvido ("exceções" → "sessões") e de registro ("para" → "pra", que é o que o narrador diz). O
DTW (tempos por token alinhados à atenção) desliga a flash attention, dobra o tempo e piorou o começo das palavras:
fica desligado. Numa máquina de 8 GB o pico de 465 MB cabe; o tempo deve ficar entre 0,4 e 0,8 da duração da fala,
conforme o processador (não medido em outra máquina).

### Formato do palavras.json

`[{"w": "Recebeu", "s": 280, "e": 500, "p": 0.857}, …]`: palavra, começo e fim **em ms do arquivo** e a probabilidade
média dos tokens. É o formato que o app já lê (o `video/palavras.json` do C2 e o tipo `Palavra` do resolvedor estão
em ms; o brief dizia segundos, mas o app nunca leu segundos). O arquivo fica ao lado do áudio e entra no git.

### Falantes

Primeira fatia, como no brief: cada clipe de voz é de um falante. O nome é o do clipe, se a pessoa deu um (nome de
arquivo não conta), ou o da faixa ("Narração", "Entrevista"). Diarização por modelo fica para depois.

### Plano B (não foi preciso)

O Bitdefender deste PC deixou baixar e rodar o `whisper-cli.exe` (07/11/2026). Se outro PC bloquear, a alternativa é o
Whisper em ONNX pelo `@huggingface/transformers` (Apache-2.0), sem executável à parte.

## Pelo Claude (MCP `estudio`)

| Ferramenta | Entrada | Faz |
|---|---|---|
| `transcrever` | `arquivo?`, `destino?`, `documento?`, `clipe?`, `faixa?`, `legendas?`, `estilo?`, `refazer?`, `modelo?`, `vocabulario?` | Uma ferramenta para os dois usos do plano. Com `arquivo` (qualquer áudio ou vídeo do projeto: a narração de um roteiro da Cliente, uma gravação para a pesquisa), grava as palavras ao lado ou em `destino` (ex.: `video/palavras.json`) e devolve o texto (até 4.000 caracteres). No vídeo de cenas, transcreve os clipes de voz que ainda não têm transcrição (ou todos, com `refazer`) e gera as legendas do documento (padrão), pelo `aplicar_patch` de sempre (diário e versão) |
| `exportar_legendas` | `documento?`, `formatos?`, `nome?`, `falantes_no_srt?` | `saidas/<título>.srt` e `.vtt`, nos tempos de saída |
| `importar_legendas` | `arquivo`, `documento?`, `estilo?` | lê um SRT ou VTT do projeto e troca as legendas |

O transcritor chega ao MCP pelo processo principal: no app, `ipc-fala.ts` entrega a `definirTranscritorMcp`
(`mcp-http.ts`); no MCP por stdio, `mcp/nucleo.ts` monta um `Transcritor` que acha o ffmpeg no `node_modules` do
repositório. Sem transcritor, a ferramenta diz que não tem, sem falhar calada.

## Legendas no vídeo de cenas

### No documento

`legendas` é opcional no fim do `DocCenas`. Sem ele, nada muda.

```json
"legendas": {
  "estilo": {"predefinicao": "karaoke", "posicao": "baixo", "tam": 0.05, "maiusculas": false, "falante": false,
             "cor": "#F4F0EA", "cor_destaque": "#C88155", "fundo": "#171A19"},
  "oculto": false,
  "segmentos": [
    {"id": "leg-1", "em": 500, "sai": 2750, "texto": "Recebeu proposta para mudar", "falante": "Narração", "clipe": "n1",
     "palavras": [{"w": "Recebeu", "s": 780, "e": 1000}, …]}
  ],
  "origens": [{"clipe": "n1", "arquivo": "midia/narracao.wav", "palavras": "midia/narracao.wav.palavras.json", "em": 500, "corte_ms": 0}]
}
```

Tempos em ms da linha do tempo do vídeo. Só `predefinicao` é obrigatória no estilo; o resto sobrescreve a
predefinição, e as cores e a fonte vêm do `tema` (o kit de marca). `palavras` é opcional: sem ela (SRT importado, texto
mudado à mão), o tempo de cada palavra é estimado pelo tamanho dela. `"\n"` no texto quebra a linha.

### Gerar a partir da fala (`src/nucleo/legendas.ts`)

As palavras do arquivo vão para o tempo do vídeo pelo clipe (`em + s − corte_ms`); entra a palavra cujo meio cai no
trecho que o clipe toca. A quebra fecha a legenda na pausa de 600 ms ou mais, no fim de frase, na vírgula quando já há
meia legenda, quando passaria da largura (caracteres por linha × linhas, calculados pelo tamanho da letra e pela área
segura do formato) ou das palavras por vez do estilo, e aos 6 s. O fim fica 250 ms depois da última palavra, sem
invadir a próxima, e nenhuma dura menos de 0,7 s se houver espaço. "25 %" e "seguro -desemprego" voltam a ser uma
palavra. Duas regras de acabamento: no corte por largura ou por número de palavras, a legenda não termina em artigo,
preposição ou conjunção ("Com o fim | da produção"); e a legenda curta que sobra no meio de uma frase ("concordância."
sozinha) divide o texto com a anterior, no corte mais equilibrado que caiba nas duas, de preferência depois de vírgula.

**As legendas andam com o clipe:** `origens` guarda onde o clipe estava quando elas nasceram. Se a pessoa arrasta o
clipe ou apara o começo, o resolvedor desloca as legendas dele pela diferença do "zero do arquivo" (`em − corte_ms`) e
tira as palavras que o clipe não toca mais. Clipe apagado: as legendas ficam onde estavam, com aviso.

### Estilos

| Predefinição | Posição | Letra (lado menor) | Caixa | Palavra falada | Por vez |
|---|---|---|---|---|---|
| Clássica | embaixo | 4,2% | caixa escura translúcida por linha | cor de destaque | 2 linhas |
| Palavra em caixa | no meio | 6,8%, maiúsculas, 800 | nenhuma, com contorno | dentro de uma caixa na cor de destaque | 3 palavras |
| Karaokê | embaixo | 5,6%, 700 | nenhuma, com sombra | cor de destaque; as que vêm depois apagadas (como o carrossel da Cliente) | 4 palavras |
| Faixa da marca | embaixo | 4% | faixa de lado a lado na cor de destaque, texto na cor do fundo | sublinhada | 2 linhas |
| Discreta | embaixo | 3,4%, 500 | nenhuma, com sombra | sem destaque | 2 linhas |

Trocar de estilo quebra as legendas de novo (largura e palavras por vez mudam), mantendo falante e clipe. Na tela:
posição, tamanho da letra em px do formato, maiúsculas, falante acima do texto, mostrar no vídeo e as três cores (o
ponto ao lado diz quando difere do padrão do estilo).

**Área segura:** a legenda fica entre o que a interface das redes cobre em cima e embaixo e longe da coluna de botões
(`src/nucleo/zonas-seguras.ts`): no 9:16, entre 250 px de cima e 484 px de baixo e a 140 px dos lados; no 16:9, fora
do décimo de baixo dos controles do YouTube; no 4:5, dentro da área de título de 90%.

### Composição

`src/composicoes/cenas/Legendas.tsx`, uma linha no `VideoCenas.tsx`, por cima dos efeitos. Mostra o segmento da hora
(mais de um, se duas vozes se sobrepõem), entra e sai em 120 ms e acende a palavra pelo tempo dela. A exportação usa o
mesmo `renderMedia`, então o MP4 sai com a legenda; `legendas.oculto` tira do vídeo e mantém a lista e o SRT.

### Na tela

- **Faixa "Legendas"** na linha do tempo, abaixo das faixas de áudio (`FaixaLegendas.tsx`): cada legenda é uma barra
  amarela com o texto. Clicar seleciona e leva a cabeça ao começo; arrastar move (as palavras andam junto); as alças da
  selecionada aparam o começo e o fim; Delete exclui; o olho esconde do vídeo. Sem legendas, a faixa convida a
  transcrever ou importar.
- **Painel das legendas** (`PainelLegendas.tsx`), no lugar das Propriedades quando a seleção é a faixa ou uma legenda:
  - *Transcrever a fala*: os clipes de voz com ✓ quando já têm transcrição, o botão (Transcrever e gerar legendas,
    Transcrever o que falta, Gerar legendas de novo, Transcrever de novo), o modelo (small ou base), o que ainda vai
    baixar e, durante, o andamento com **Cancelar**.
  - *Estilo*: as cinco predefinições e os ajustes acima.
  - *Localizar e substituir* (fechada de início): sem diferença de caixa e acento por padrão, ou com; palavra inteira;
    conta as legendas achadas, destaca na lista e substitui em todas de uma vez (o tempo das palavras fica).
  - *Lista*: tempo de entrada e saída (clicar leva a cabeça), texto editável (Enter grava, Shift+Enter quebra a linha,
    Esc desfaz), falante, juntar com a próxima, dividir (na cabeça, se ela está dentro da legenda; senão no meio, de
    preferência depois de pontuação) e excluir. A legenda que está tocando fica marcada. "+ No tempo atual" cria uma.
  - *SRT e VTT*: importar (diálogo de arquivo; troca as legendas, Ctrl+Z desfaz) e exportar para `saidas/<título>.srt`
    ou `.vtt`, com "Mostrar na pasta".

Toda mudança é JSON Patch: vai para o diário, o Ctrl+Z desfaz e o Claude vê.

### SRT e VTT

Exporta nos tempos de saída (o clipe no lugar em que está), com até duas linhas equilibradas de 42 caracteres. O VTT
leva o falante na marca de voz (`<v Nome>`) e escapa `&`, `<` e `>`. A leitura aceita BOM, CRLF, bloco sem número,
`MM:SS.mmm`, vírgula ou ponto nos milésimos, ajustes de cue, `NOTE`, `STYLE`, `REGION`, etiquetas (`<i>`, `<c.x>`,
`<font>`, `{\an8}`) e carimbos de palavra do VTT; o que não entende vira aviso. Ida e volta sem perder um milissegundo
(teste). Ao importar, o tempo de cada palavra é estimado.

## Arquivos

Da frente: `src/main/transcricao.ts` (sem Electron), `src/main/ipc-fala.ts`, `src/nucleo/legendas.ts`,
`src/composicoes/cenas/Legendas.tsx`, `src/renderer/modulos/video/{PainelLegendas,FaixaLegendas}.tsx`,
`acoes-legendas.ts`, `legendas.css`, `scripts/transcrever-teste.mjs`, `scripts/exportar-teste-legendas.mjs`,
`testes/legendas.test.ts`, `testes/fala-mcp.test.ts`, `testes/fixtures/fala/whisper-c2-small.json` (o JSON real do
whisper na narração do C2, sem o caminho da máquina).

Compartilhados, só no fim e com comentário "frente Fala": `cenas.ts` (campo `legendas` no documento, `legendas_cenas`
nas props e uma linha no resolvedor; o nome nas props não é `legendas` porque a linha do tempo lê esse do carrossel da
Cliente), `VideoCenas.tsx` (uma linha), `LinhaDoTempo.tsx` (uma linha), `InspectorVideo.tsx` (uma linha: a seleção
`/legendas…` mostra o painel), `ferramentas-mcp.ts` (sexto parâmetro `transcritor` e as três ferramentas no fim),
`mcp-http.ts` (`definirTranscritorMcp`), `mcp/nucleo.ts`, `api.ts`, `preload.ts`, `main.ts` (uma linha),
`scripts/previa-web/ponte.ts` (transcrição simulada) e `testes/mcp.test.ts` (a lista).

## Testes e verificação

- `npm test`: 172 testes (36 em `legendas.test.ts`, 5 em `fala-mcp.test.ts` e os 131 de antes, com a lista do MCP).
- `npx tsx scripts/transcrever-teste.mjs [base small]`: baixa o que falta, transcreve a narração do C2 e compara com a
  referência (palavras erradas, erro do começo, tempo e pico de memória).
- `npx tsx scripts/exportar-teste-legendas.mjs [estilo]`: 15 s da narração real → whisper → legendas → MP4 com som e
  legenda, uma foto de cada estilo, SRT e VTT, em `testes/saida/exportar-legendas/`.
  Medido em 07/11: os 15,5 s viraram 46 palavras em 9 a 12 s; o MP4 de 16 s (720×1280, H.264 com AAC) saiu com 12
  legendas no karaokê, e as cinco fotos mostram a palavra falada em destaque em cada estilo.
- Prévia web (`npx vite --config vite.renderer.config.ts --port 5205`): a ponte simula a transcrição (andamento de
  mentira, palavras no ritmo da narração sintética). Conferido nela: transcrever e gerar, a legenda no monitor com a
  palavra em destaque dentro da área segura, troca de estilo (requebra), localizar e substituir, juntar, dividir,
  editar o texto, arrastar na faixa e Delete. O Vite cai (EBUSY) se um render escreve em `testes/saida/` com ele aberto:
  rode os scripts de exportação com a prévia fechada.

## Não verificado

- O Electron de verdade: o IPC da fala, o download pelo `net.fetch` (proxy do escritório), o diálogo de importar e o
  "Mostrar na pasta". A transcrição, o download e o ffmpeg foram exercitados pelo mesmo código fora do Electron.
- O app instalado: o caminho do ffmpeg em `app.asar.unpacked` (o mesmo que a exportação já usa) e o antivírus de
  outro PC com o `whisper-cli.exe`.
- Tempo e memória numa máquina de 8 GB; vídeos longos (uma hora de fala) e o modelo base em pt-BR fora do C2.

## Para depois

- Diarização por modelo (falantes num clipe só); o `checar_texto` olhar também o texto das legendas; cortar silêncios
  e editar pelo texto (rodada 3, já com o `palavras.json`); transcrever clipe de vídeo do vídeo de cenas quando ele
  existir; legenda em mais de um idioma.
