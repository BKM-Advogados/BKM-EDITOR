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
   `vocabulario`). Threads: núcleos − 1, até 8. Antes, o detector de voz acha os trechos com voz, e o que o whisper
   escrever fora deles sai (ver "Detector de voz").
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
| `ggml-silero-v6.2.0.bin` (detector de voz, rodada 3) | huggingface.co/ggml-org/whisper-vad, commit 9ffd54a | 885.098 | `2aa269b7…7fb6987` | MIT (Silero VAD; a conversão é do whisper.cpp) |

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

### Detector de voz (VAD, rodada 3)

Onde não há fala, o whisper inventa texto. No silêncio, na música e nos efeitos ele escreveu "[Som de fio]",
"[música]" e "[Som de futebol]". O detector de voz Silero VAD v6.2.0 (MIT, 0,9 MB, `MODELO_VAD`) diz onde há voz e
baixa junto com o modelo. Quem já tem o whisper baixa o detector na próxima transcrição.

**Como o app usa: o VAD é um filtro** (`ouvirWav`, `trechosDeVoz`, `soNaVoz` em `transcricao.ts`):

1. Uma passada do `whisper-cli` só com o VAD (`--vad -d 1`, que não decodifica nada; 2 a 3 s, quase tudo para
   carregar o modelo) dá os trechos de voz no relógio do arquivo.
2. O whisper ouve o arquivo inteiro, como antes.
3. Fica a **frase** que encosta num trecho de voz. A frase são palavras seguidas com vão de até 1 s; basta uma
   palavra dela encostar num trecho (300 ms de folga) para ela ficar inteira.

Palavra a palavra, o filtro tirava fala de verdade no conjunto da casa. Tirou "Amigo, você perdeu seu" do começo do
vídeo do WhatsApp: com música por baixo, o detector só achou voz em 2,9 s, e o whisper deixou 410 ms entre "seu" e
"emprego". Também tirou um "O" do C7. Pela frase, tira 0 das 1.678 palavras do conjunto. O que o whisper inventa no
silêncio fica isolado, segundos longe da fala.

Sem voz nenhuma, sai lista vazia. Se o registro do `whisper-cli` não disser os trechos (outra versão), nada é filtrado.

As anotações que o whisper escreve no lugar do que não é fala saem sempre: "[…]" de até seis palavras, "(risos)",
"(música)", "(aplausos)" e "♪". Um "(CLT)" dito na fala fica (`semAnotacoes`).

**Por que não o `--vad` numa passada só:** ele emenda os trechos de voz e o whisper ouve só eles. Dois problemas,
medidos:

- O tempo de cada token sai no relógio do áudio encurtado. A narração que começa em 14 s saiu começando em 0 s. O
  `whisper-cli` escreve no stderr a tabela de cada trecho (`vad_segment_info`), e `tempoNoArquivo` leva o tempo de
  volta ao arquivo. Essa parte ficou pronta e testada.
- Mesmo com o relógio certo, o começo das palavras piora. O whisper encosta o começo na borda do trecho que recebe.

A passada única é 1,5 vez mais rápida (47 a 50 s contra 73 a 75 s na mistura abaixo), mas a régua pede o começo da
palavra a até 100 ms.

Medido em 08/11 com `npx tsx scripts/vad-teste.mjs` (small, vocabulário da casa, 7 threads, com as oito frentes rodando
neste PC; os tempos variam com a carga). Os áudios:

- **silêncio**: 20 s de silêncio de sala, perto de −47 dB;
- **música**: 20 s de música sintética (acordes, baixo, batida e chimbal, sem voz cantada);
- **efeitos**: os seis efeitos do C2 em sequência;
- **antes da fala**: o começo da mistura, 6 s de silêncio e 8 s de música, antes da narração do C2 (72 s).

A coluna "antes da fala" conta as palavras escritas nesses 14 s. As últimas colunas medem a narração da mistura
contra o `palavras.json` do exemplo, que também é de máquina.

| Configuração | Silêncio | Música | Efeitos | Antes da fala | Palavras erradas | Começo até 100 ms | Mediana / p90 do começo |
|---|---|---|---|---|---|---|---|
| Sem VAD e sem tirar anotações (como era) | 3 | 1 | 3 | 1 | 4,1% | 52% | 100 / 240 ms |
| **VAD como filtro (o app)** | 0 | 0 | 0 | 0 | 4,1% | 52% | 100 / 240 ms |
| `--vad` numa passada, sem a tabela | 0 | 0 | 0 | 40 (a narração inteira foi para trás) | 26,3% | 0% | 16,7 s |
| `--vad` numa passada, ajustes do whisper | 0 | 0 | 0 | 0 | 6,2% | 35% | 170 / 360 ms |
| `--vad` numa passada, pausa de 1 s, folga de 300 ms | 0 | 0 | 0 | 0 | 4,6% | 40% | 140 / 440 ms |

Com o filtro, a narração ficou idêntica à sem VAD: as mesmas 187 palavras com os mesmos tempos. No silêncio e na
música, o detector achou zero trechos de voz, então qualquer palavra ali sairia.

Pelo caminho do app (`Transcritor.transcrever` na mistura), saíram 193 palavras, nenhuma antes dos 14 s, com o
`palavras.json` versão 2 e as etapas "Procurando a voz" e "Transcrevendo" na tela.

Não medido:

- voz cantada (a música do teste é sintética);
- fala baixa sob música alta (o filtro pode tirar palavra dita baixo no meio de um trecho que o detector não pegou);
- o detector no app instalado.

### Conjunto da casa (rodada 3)

Para medir a régua da transcrição com fala da casa, conferida à mão: WER abaixo de 10%, glossário certo em 95% das
ocorrências e começo da palavra a até 100 ms em 90% das palavras. O conjunto está em `scripts/conjunto-casa.json`:
oito itens, 636 s (10,6 min).

| Item | O que é | Duração |
|---|---|---|
| `igor-reel` | voz humana: o Reel do Igor, gravado no celular, com música | 76 s |
| `whatsapp` | voz humana: o advogado no vídeo do WhatsApp (480p) | 106 s |
| `c3` a `c8` | narrações dos Curtas da Cliente (Notebook): saúde e PPP, o que a Justiça reconheceu, adicional noturno, feriado, banco de horas, portaria até o ponto | 454 s |

O C2 fica de fora, porque o vocabulário do whisper (`PROMPT_PADRAO`) foi afinado nele. As mídias ficam na pasta dos
shorts da Cliente (`tasks/shorts-2026-11-04`, fora do repositório). A conferência fica em
`tasks/estudio-acompanhamento/rodada-3/conjunto-casa/`. O glossário (siglas, nomes da casa e termos do direito do
trabalho) está no mesmo JSON.

**Roteiro de conferência** (a conferência à mão é do responsável):

1. `npx tsx scripts/conjunto-casa.mjs preparar` transcreve cada item com os ajustes do app (small, vocabulário e
   detector de voz) e grava na pasta da conferência:
   - `<id>.wav`, o áudio;
   - `<id>.texto.txt`, o texto da máquina, uma frase por linha;
   - `<id>.inicios.txt`, doze palavras espaçadas, em rótulos do Audacity;
   - `<id>.maquina.json`, as palavras com tempo.

   Não grava por cima de um texto ou de rótulos que já estão lá. Já rodado em 08/11.
2. **Texto.** Abra `<id>.texto.txt` e ouça `<id>.wav`. Corrija o texto para o que foi dito, palavra por palavra:
   - siglas em caixa alta;
   - números como a legenda escreveria (13º, 40%);
   - nomes como se escrevem (Empresa, Escritório Exemplo);
   - o que não dá para entender vira `[?]`, que sai da conta.

   Pontuação e quebra de linha não contam. No fim, troque `conferido: não` por `conferido: sim`. Conta uns 3 a 5 min
   por minuto de áudio.
3. **Começos.** No Audacity (grátis):
   1. Arquivo › Importar › Áudio, `<id>.wav`.
   2. Arquivo › Importar › Rótulos, `<id>.inicios.txt`.
   3. Em cada um dos doze rótulos, aproxime a onda e arraste a borda esquerda até o começo do som da palavra. Não mexa
      no texto do rótulo.
   4. Arquivo › Exportar › Exportar rótulos, por cima do mesmo `<id>.inicios.txt`.

   São 96 palavras no conjunto, cerca de meia hora.
4. `npx tsx scripts/conjunto-casa.mjs medir` mede o que já foi conferido e diz o que falta. Grava `resultado.json` na
   pasta, com o total, a régua e as ocorrências erradas do glossário. As medidas:
   - **WER**: sem acento, caixa e pontuação, como a medida do C2, e também com acento.
   - **Glossário**: o que o whisper escreveu e o que fica depois do dicionário da casa, como na legenda.
   - **Começo**: o rótulo movido contra a palavra igual mais perto (até 1 s).

   Com `--refazer`, transcreve de novo com o código de agora (para comparar modelo, vocabulário ou VAD) sem mexer na
   conferência. Também aceita `--modelo base` e `--sem-vad`.

### Formato do palavras.json

Ao lado do áudio, na **versão 2**: `{"versao": 2, "fonte": {"tamanho", "modificado_ms", "sha256"}, "modelo": "small",
"palavras": [{"w": "Recebeu", "s": 280, "e": 500, "p": 0.857}, …]}`: palavra, começo e fim **em ms do arquivo** e a
probabilidade média dos tokens (o app sempre leu ms; o brief dizia segundos). `fonte` é o carimbo do áudio transcrito,
o mesmo do envelope do som: tamanho e data iguais, a transcrição vale; mesmo tamanho e outra data (cópia, git clone), o
sha256 decide; outro tamanho, ou a lista sem carimbo da versão 1, conta como **velha** e é transcrita de novo. Assim a
tomada regravada com o mesmo nome não fica com o texto da antiga. Com `destino` (o `video/palavras.json` do roteiro da
Cliente) grava só a lista, o formato do roteiro; quem lê o roteiro aceita os dois. O arquivo entra no git.

**Voz limpa:** a fala do clipe é a do arquivo da pessoa (`original`) quando o clipe toca a versão limpa, que tem os
mesmos tempos (`arquivoDaFala`). Limpar a voz, ou voltar ao original, não pede outra transcrição nem tira o ✓.

### Falantes

Primeira fatia, como no brief: cada clipe de voz é de um falante. O nome é o do clipe, se a pessoa deu um (nome de
arquivo não conta), ou o da faixa ("Narração", "Entrevista"). Diarização por modelo fica para depois.

### Plano B (não foi preciso)

O Bitdefender deste PC deixou baixar e rodar o `whisper-cli.exe` (07/11/2026). Se outro PC bloquear, a alternativa é o
Whisper em ONNX pelo `@huggingface/transformers` (Apache-2.0), sem executável à parte.

## Pelo Claude (MCP `estudio`)

Classe de permissão (regras da rodada 3): `livre` grava no diário e tem Reverter; `cartao` baixa modelo, lê a web, traz
arquivo de fora do projeto, exporta, apaga ou reverte mudança de outro autor.

| Ferramenta | Classe | Entrada | Faz |
|---|---|---|---|
| `transcrever` | `cartao` (na primeira vez baixa o whisper.cpp e o modelo, 200 MB) | `arquivo?`, `destino?`, `documento?`, `clipe?`, `faixa?`, `legendas?`, `estilo?`, `refazer?`, `refazer_legendas?`, `modelo?`, `vocabulario?` | Uma ferramenta para os dois usos do plano. Com `arquivo` (qualquer áudio ou vídeo do projeto: a narração de um roteiro da Cliente, uma gravação para a pesquisa), grava as palavras ao lado ou em `destino` (ex.: `video/palavras.json`; nunca o manifesto, um documento, `comentarios.json`, a pesquisa, `.estudio/` ou um .json que não seja lista de palavras, porque grava por cima e fora do diário) e devolve o texto (até 4.000 caracteres). No vídeo de cenas, transcreve a fala que ainda não tem transcrição ou cuja tomada mudou (ou toda, com `refazer`) e gera as legendas **dos clipes que ainda não têm** (padrão), pelo `aplicar_patch` de sempre (diário e versão). Clipe com legendas fica como está e volta em `ja_tinham_legendas` (e em `legendas_de_audio_antigo`, se a tomada mudou); `refazer_legendas` refaz, levando as palavras corrigidas à mão |
| `ler_legendas` | `livre` (só lê) | `documento?`, `de?`, `ate?` | as legendas nos tempos da tela (id, em, sai, texto, falante), já com o clipe de voz no lugar em que está |
| `editar_legenda` | `livre` | `documento?`, `id`, `texto?`, `em?`, `sai?` | corrige o texto (cada palavra guarda o tempo da que estava no lugar, como na lista do app) e o tempo, dado como na tela: o app desconta o quanto o clipe andou desde que a legenda nasceu. Entrar e sair o mesmo tanto leva as palavras junto (sem sair do trecho do clipe: recusa e diz quanto dá); mudar uma ponta apara |
| `exportar_legendas` | `cartao` (exporta) | `documento?`, `formatos?` (`srt`, `vtt`, `srt_pt_br`), `nome?`, `falantes_no_srt?`, `sobrescrever?`, `trecho?` | `saidas/<título>.srt` e `.vtt` (padrão), ou `.pt_BR.srt` (o nome que o Facebook pede), nos tempos de saída; com `trecho` {de_ms, ate_ms}, só as legendas dele, cortadas nas pontas e contadas do zero (para o vídeo exportado com o mesmo trecho); trecho sem legenda é erro claro; com o nome tomado, `<título> (2).srt` (só grava por cima com `sobrescrever`) |
| `propor_cortes_fala` | `livre` (só lê) | `documento?`, `clipe?`, `silencio_min_ms?`, `pausa_ms?`, `preenchimento?`, `pontas?` | os cortes que a fala do clipe sugere (ms do arquivo), com o motivo, o "ãh" tirado, o contexto (três palavras antes e depois) e quanto encurta |
| `aplicar_cortes_fala` | `livre` (grava um WAV novo em `midia/` e o patch no diário; Reverter desfaz) | `documento?`, `clipe?`, `cortes?`, `voltar?` | emenda a narração sem os cortes (os pedidos ou os sugeridos), troca o arquivo do clipe e leva as legendas; recusa corte a menos de 80 ms de palavra; `voltar: true` volta ao arquivo de antes |
| `importar_legendas` | `livre` | `arquivo`, `documento?`, `estilo?` | lê um SRT ou VTT do projeto (UTF-8, UTF-16 ou Windows-1252, pelos bytes) e troca as legendas |

O `transcrever` pedido pela IA mostra o andamento e o Cancelar no painel das legendas ("A IA pediu: …"), como o do
botão. O pedido leva o sinal do MCP: Esc na conversa, ou a conexão que cai, para o whisper e o ffmpeg sem gravar nada;
fechar o projeto também para (`cancelarFala` no `fecharSessao`).

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
  "origens": [{"clipe": "n1", "arquivo": "midia/narracao.wav", "palavras": "midia/narracao.wav.palavras.json", "em": 500, "corte_ms": 0, "sha256": "9f2c…"}]
}
```

Tempos em ms da linha do tempo do vídeo **de quando a legenda nasceu**: a legenda de um clipe anda com ele, e a tela
mostra o tempo guardado mais o quanto o clipe andou (por isso o Claude lê e corrige por `ler_legendas` e
`editar_legenda`, e o CLAUDE.md do projeto diz isso). Só `predefinicao` é obrigatória no estilo; o resto sobrescreve a
predefinição, e as cores e a fonte vêm do `tema` (o kit de marca). `palavras` é opcional: sem ela (SRT importado), o
tempo de cada palavra é estimado pelo tamanho dela. Texto mudado sem mexer em `palavras` (um patch) guarda o tempo:
com o mesmo número de palavras, cada uma fica com o tempo da que estava no lugar; com outro, elas se espalham no tempo
que as gravadas ocupavam (`palavrasDe`, a mesma regra do `comTexto` da lista). `"\n"` no texto quebra a linha.

### Gerar a partir da fala (`src/nucleo/legendas.ts`)

As palavras do arquivo vão para o tempo do vídeo pelo clipe (`em + s − corte_ms`); entra a palavra cujo meio cai no
trecho que o clipe toca. A quebra segue a régua (Netflix pt-BR e o `@remotion/captions`): fecha a legenda no silêncio de
**300 ms**, no fim de frase, na vírgula quando já há meia legenda, quando não caberia nas linhas do estilo ou passaria
das palavras por vez, e aos **7 s**. O fim fica 250 ms depois da última palavra e avança no vão até a próxima para dar
tempo de ler: pelo menos **833 ms** e no máximo **17 caracteres por segundo** (`cpsDe`, que conta letras, espaços e
pontuação), sem invadir a próxima. A legenda que mesmo assim passa de 17 car/s ganha "N car/s" na lista e sai em
`rapidas_para_ler` no `ler_legendas`. "25 %" e "seguro -desemprego" voltam a ser uma palavra. A legenda não termina em
artigo, preposição, conjunção, verbo auxiliar nem "não" (`fracaNoFim`: "Com o fim | da produção", "vai | pagar"); e a
legenda curta que sobra no meio de uma frase ("concordância." sozinha) divide o texto com a anterior, no corte mais
equilibrado que caiba nas duas, de preferência depois de vírgula.

**O que cabe é medido na fonte** (fala-D6). `capacidadeDaLegenda` dá a largura útil da linha (a área segura menos o
respiro da caixa), o medidor da fonte do tema e o teto de **42 caracteres por linha**; `quebrarEmLinhas` corta o texto
em uma ou duas linhas pela largura medida, no corte mais equilibrado, preferindo depois de pontuação e sem palavra fraca
no fim da primeira. A mesma regra decide se uma legenda cabe (na geração, na troca de estilo e no destino da exportação),
desenha as linhas na composição e quebra o SRT e o VTT (aí contando caracteres). A medida vem de
`src/nucleo/medida-texto.ts`: o avanço de cada letra das quatro fontes das composições (Inter, Archivo, IBM Plex Sans e
Mono), por peso, medido em 08/11/2026 no Chromium com os mesmos `.woff2` do subconjunto latino que o
`@remotion/google-fonts` usa (carregados por `FontFace`, medidos letra a letra pelo canvas). A soma letra a letra fica a
menos de 0,7% da medida da frase inteira (o kerning, que a tabela não tem); letra acentuada vale a base (conferido nas
quatro). Fonte própria de um kit mede como a Inter. No navegador (prévia e render), a composição mede com o canvas e a
fonte carregada, então a linha desenhada é a medida.

**As legendas andam com o clipe:** `origens` guarda onde o clipe estava quando elas nasceram. Se a pessoa arrasta o
clipe ou apara o começo, o resolvedor desloca as legendas dele pela diferença do "zero do arquivo" (`em − corte_ms`) e
tira as palavras que o clipe não toca mais. Clipe apagado: as legendas ficam onde estavam, com aviso.

### Estilos

| Predefinição | Posição | Letra (lado menor) | Caixa | Palavra falada | Por vez |
|---|---|---|---|---|---|
| Clássica | embaixo | 4,2% | caixa escura translúcida por linha | cor de destaque e um fundo leve (pista além da cor) | 2 linhas |
| Palavra em caixa | no meio | 6,8%, maiúsculas, 800 | nenhuma, com contorno | dentro de uma caixa na cor de destaque | 3 palavras |
| Karaokê | embaixo | 5,6%, 700 | nenhuma, com sombra | cor de destaque; as que vêm depois apagadas (como o carrossel da Cliente) | 4 palavras |
| Faixa da marca | embaixo | 4% | faixa de lado a lado na cor de destaque, texto na cor do fundo | sublinhada | 2 linhas |
| Discreta | embaixo | 3,4%, 500 | nenhuma, com sombra | sem destaque | 2 linhas |

Trocar de estilo quebra as legendas de novo (largura e palavras por vez mudam), mantendo falante e clipe. Na tela:
posição, tamanho da letra em px do formato, maiúsculas, falante acima do texto, mostrar no vídeo e as três cores (o
ponto ao lado diz quando difere do padrão do estilo).

**Área segura:** a legenda fica entre o que a interface das redes cobre em cima e embaixo e longe da coluna de botões
(`src/nucleo/zonas-seguras.ts`): no 9:16, entre 250 px de cima e 484 px de baixo e a 140 px dos lados; no 16:9, fora
do décimo de baixo dos controles do YouTube; no 4:5, dentro do corte 1:1 da prévia quadrada (WhatsApp, LinkedIn, a
grade antiga), ou na área de título de 90% com `estilo.no_quadrado: false` ("No quadrado" no painel do vídeo 4:5)
(fala-D8). Com `legendas_youtube`, a área do 16:9 fica acima da faixa das legendas automáticas do YouTube, para quando o
SRT sobe junto (a exportação liga isso por destino).

**Em cada destino da exportação** (`legendasNoDestino`, no laço do `main.ts`): o vídeo 16:9 exportado também em 9:16
leva a legenda para a área do 9:16, e a legenda que não cabe nas linhas do estilo nesse tamanho é dividida em pedaços
que cabem, pela mesma regra da quebra e dentro dela (nada se junta com a vizinha; o que a pessoa dividiu, juntou ou
corrigiu fica). No caminho contrário, só a área muda. Na mesma proporção do documento o arquivo sai igual à prévia. A
área de cada destino fica em `props.legendas_cenas.area`, no formato de sempre, para quem precisar desviar dela (a marca
d'água).

### Composição

`src/composicoes/cenas/Legendas.tsx`, uma linha no `VideoCenas.tsx`, por cima dos efeitos. Mostra **uma legenda por
quadro** (`legendaNoAr`): a da fala da hora (com duas vozes ao mesmo tempo, a que começou por último). Na fala corrida,
em que uma legenda sai no mesmo ms em que a próxima entra, a troca é no quadro, sem as duas empilhadas. No silêncio entre
duas, a que sai apaga na primeira metade do vão e a que entra acende na segunda, cada uma em até 120 ms. A palavra
acende pelo tempo dela. A exportação usa o
mesmo `renderMedia`, então o MP4 sai com a legenda; `legendas.oculto` tira do vídeo e mantém a lista e o SRT.

### Na tela

- **Faixa "Legendas"** na linha do tempo, abaixo das faixas de áudio (`FaixaLegendas.tsx`): cada legenda é uma barra
  amarela com o texto. Clicar seleciona e leva a cabeça ao começo; arrastar move (as palavras andam junto); as alças da
  selecionada aparam o começo e o fim; Delete exclui; o olho esconde do vídeo. Sem legendas, a faixa convida a
  transcrever ou importar.
- **Painel das legendas** (`PainelLegendas.tsx`), no lugar das Propriedades quando a seleção é a faixa ou uma legenda:
  - *Transcrever a fala*: os clipes de voz com ✓ quando a transcrição é do áudio como ele está, ↻ quando a tomada
    mudou depois dela e "sem legendas" quando o clipe ainda não tem; o botão (Transcrever e gerar legendas, Transcrever
    o que falta, Gerar o que falta, Refazer as legendas…, Transcrever de novo…), o modelo (small ou base), o que ainda
    vai baixar e, durante, o andamento com **Cancelar**. **Gerar faz só o que falta:** transcreve a fala que falta ou
    mudou e gera as legendas dos clipes que não têm; o clipe que já tem legendas fica como está. Refazer pede
    confirmação e leva as palavras corrigidas à mão que ainda caem no tempo da fala (a mesma tomada, pelo sha256 da
    origem); divisões, junções e tempos ajustados voltam ao automático. Se a tomada de um clipe com legendas mudou, o
    app transcreve de novo e pergunta antes de refazer as legendas dele. Legendas importadas ou criadas à mão ficam.
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
(teste). Ao importar, o tempo de cada palavra é estimado pelo tamanho dentro da legenda e fica marcado
(`palavras_estimadas: true` no segmento), para a lista e a IA saberem que não veio da fala.

### Na exportação (rodada 3)

O diálogo Exportar ganha a linha **Legendas** quando o vídeo tem legenda, com uma escolha por destino
(`src/nucleo/legendas-exportacao.ts`):

| Escolha | Vídeo | Ao lado |
|---|---|---|
| No vídeo (padrão) | legenda queimada | nada |
| Só o SRT | sem legenda (a miniatura e a marca d'água também a ignoram) | `<nome do vídeo>.srt`, `.pt_BR.srt` e `.vtt` |
| Os dois | legenda queimada; no 16:9, acima da faixa onde o YouTube mostra as legendas automáticas | `<nome do vídeo>.srt`, `.pt_BR.srt` e `.vtt` |

O SRT (e o VTT, que leva o falante) leva o mesmo nome do arquivo de vídeo (com o sufixo do destino, como "Mudar - 9x16.srt"), sai nos tempos do
arquivo (com trecho, contado do zero do trecho) e não grava por cima: se o nome existe, "(2)". O `.pt_BR.srt` é o
nome que o Facebook usa para reconhecer o idioma; o YouTube e o LinkedIn aceitam qualquer um dos dois. A escolha vai
em `OpcoesExportarVideo.legendas` (id do destino → `video` | `srt` | `ambos`); sem ela, tudo sai como antes.

## Lista e dicionário (rodada 3)

- **Confiança.** O `p` de cada palavra (a certeza do whisper) vai do `palavras.json` até a legenda; abaixo de 0,6 a
  palavra aparece em "confira: …" na lista e em `duvidosas` no `ler_legendas`. A palavra corrigida perde o `p`.
- **Trocar uma palavra por duas** (fala-D5): `realinharPalavras` alinha o texto novo ao antigo pelo começo e pelo fim
  iguais e reparte só o trecho que mudou, no tempo das palavras trocadas ("FGTS" → "Fundo de Garantia" reparte só o
  tempo do "FGTS"); inserir sem vão divide o tempo da vizinha. Vale na lista, no substituir em lote e no patch do texto.
- **Dicionário.** O da casa (`DICIONARIO_CASA`: CLT, FGTS, INSS, TST, TRT, STF, STJ, CTPS, PIS, CPF, CNPJ, MTE, OAB, PLR,
  NR em caixa alta) e o do vídeo (`legendas.dicionario`: [{de, para, palavra_inteira?, caixa?}], que o "guardar no
  dicionário" do localizar e substituir preenche) valem em toda legenda gerada, então a troca guardada sobrevive a gerar
  de novo; os termos do dicionário do vídeo entram no fim do vocabulário do whisper.
- **Teclado.** Com uma legenda selecionada, `[` e `]` mudam o começo e `{` e `}` o fim, um quadro por vez, encaixando na
  grade de quadros (`passoDeQuadro`). O atalho lê o caractere, então vale em qualquer teclado (ABNT2 também).

## Cortes pela fala

`src/nucleo/cortes-fala.ts` (a conta, pura), `src/main/cortes-fala.ts` (o WAV), `src/nucleo/mcp-fala.ts` (as duas
ferramentas) e a seção "Cortes pela fala" do painel das legendas.

- **O que sai.** Cada pausa acima de 700 ms fica com 300 ms (a mesma pausa que abre legenda nova); as palavras de
  preenchimento que o whisper escreve ("ãh", "hum", "éé", "ahn") saem com a pausa em volta; o silêncio antes da primeira
  palavra e depois da última do trecho que o clipe toca fica com meia pausa. "é", "né", "tipo" e "então" ficam: têm
  sentido na fala jurídica.
- **As regras.** Nenhuma borda de corte a menos de 80 ms de uma palavra que fica, então o corte nunca pega um pedaço de
  palavra (`conferirCortes` recusa o pedido que pega); o "ãh" colado numa palavra fica. Cada emenda tem crossfade de
  potência igual de 8 ms, centrado nela e tirado do silêncio dos dois lados; a ponta cortada do arquivo ganha uma rampa
  curta. O render do Remotion muda o volume por pacote e não emenda áudio, então a emenda é um WAV novo.
- **O arquivo.** `midia/<fonte>.cortes-<código>.wav` (o código vem dos cortes: os mesmos cortes dão o mesmo arquivo), em
  PCM de 16 bits na taxa e nos canais da fonte, ao lado do `palavras.json` dele (as palavras que ficam, no tempo novo,
  com o carimbo do WAV novo: a transcrição continua em dia sem rodar o whisper). A fonte é o que o clipe toca: a voz
  limpa, se houver. O arquivo entra no git (é o que o clipe toca).
- **O documento.** O clipe passa a tocar o WAV emendado, com `corte_ms` e `duracao_ms` no tempo novo, e guarda em
  `cortes_fala` {`fonte`, `cortes`, `corte_ms`, `duracao_ms`, `original`, `limpeza`} o que era antes; o `original` e a
  `limpeza` da voz limpa vão para dentro dele, porque a fala do clipe passa a ser a do arquivo emendado. As legendas do
  clipe andam para o tempo novo e a palavra cortada sai delas; a origem passa a ser o arquivo emendado. Tudo num patch
  só: Ctrl+Z e Reverter desfazem, e "Voltar ao áudio sem cortes" (ou `aplicar_cortes_fala` com `voltar`) volta ao
  arquivo de antes mesmo depois de outras mudanças.
- **Medido** (`testes/cortes-fala.test.ts` e `testes/cortes-fala-mcp.test.ts`): zumbido de 47 Hz contínuo com rajadas
  de 440 Hz nas palavras; com o crossfade, o maior passo entre amostras perto de cada emenda fica na ordem do próprio
  zumbido, e o controle sem crossfade estala (passo mais de 20 vezes maior); o WAV sai com o tamanho de antes menos os
  cortes, amostra a amostra; cada palavra começa no tempo remapeado. De ponta a ponta com o ffmpeg do Remotion, num
  projeto temporário: WAV, `palavras.json` em dia, legendas no tempo novo sem o "ãh", recusa e volta.
- **Caminho.** Vídeo → faixa "Legendas" → painel → "Cortes pela fala" → "Propor cortes" → marcar → "Aplicar". Pela IA:
  `propor_cortes_fala` e `aplicar_cortes_fala`. A cena não encurta junto: se a narração ficou mais curta que as cenas, a
  pessoa ajusta as cenas.

## Para o guia da IA

Texto para a coordenação juntar no `claudeMd` (seção do vídeo de cenas):

> **Legendas, régua.** `ler_legendas` devolve `cps` (caracteres por segundo) de cada legenda e `rapidas_para_ler` (acima
> de 17); a correção é esticar o `sai` no vão (`editar_legenda`), dividir ou encurtar o texto. A quebra é pela largura
> medida da fonte, até 42 caracteres por linha, em duas linhas, e não deixa artigo, preposição, auxiliar ou "não" no fim
> da linha. No 4:5 a legenda fica no corte 1:1 (`estilo.no_quadrado: false` usa a altura toda).
> **Dicionário.** `legendas.dicionario` [{de, para, palavra_inteira?, caixa?}] guarda trocas que voltam a valer em toda
> legenda gerada (as siglas da casa, como CLT e FGTS, já valem sempre); acrescente por patch quando a pessoa corrigir o
> mesmo termo mais de uma vez. `ler_legendas` traz `duvidosas` (palavras em que o whisper teve pouca certeza): proponha
> conferir essas.
> **Cortes pela fala.** `propor_cortes_fala` {clipe?} sugere tirar pausas longas (ficam 300 ms) e "ãh"/"hum", em ms do
> arquivo, com o contexto de cada corte; mostre à pessoa e aplique com `aplicar_cortes_fala` {clipe?, cortes?} (todos ou
> os escolhidos; nunca a menos de 80 ms de uma palavra). O clipe passa a tocar um WAV novo e guarda o de antes em
> `cortes_fala`: não escreva `cortes_fala` à mão; para desfazer, `aplicar_cortes_fala` com `voltar: true`.
> **SRT para as redes.** `exportar_legendas` {formatos: ['srt', 'srt_pt_br']} grava também o nome que o Facebook pede;
> com `trecho` {de_ms, ate_ms}, o SRT acompanha o vídeo exportado com o mesmo trecho (conta do zero).

## Rodada 3 (08/11/2026)

Correções da área:

- **SRT em ANSI** (video-N6): `textoDeLegenda` decide pelos bytes: UTF-8 válido, UTF-16 com BOM, senão Windows-1252.
- **Legenda no monitor** (transversal-N7): o segmento leva `data-origem` e recebe o clique; clicar seleciona, M comenta.
- **Tomada trocada** (som-N2): a origem guarda o arquivo transcrito; `mesmaTomada` aceita o arquivo do clipe ou o
  original da voz limpa. Clipe que trocou de arquivo deixa as legendas onde nasceram, com aviso; o painel marca
  "legendas de outro arquivo" e "Atualizar as legendas…" pergunta antes de refazer.
- **Legenda fora do clipe** (som-N6): sem palavra no trecho do clipe vira aviso; só o clipe aparado corta a ponta da
  legenda. Arrastar para na borda do clipe (`limitesDoArrasto`) e o `editar_legenda` recusa dizendo quanto dá.
- **SRT sem gravar por cima** (fala-D11): `nomeLivreDaLegenda` dá "Título (2).srt".
- **IA transcrevendo** (transversal-N4): andamento e Cancelar na tela, Esc e fechar o projeto param o whisper.

Para o Som (fala-D12 é dele): `legendasAoDividirClipe(legendas, {clipe, novo, em_ms, clipes})` e
`legendasAoDuplicarClipe(legendas, {clipe, novo})` devolvem as legendas novas, para gravar no mesmo patch que divide ou
duplica o clipe. No dividir, `em_ms` é o tempo da tela do corte e `clipes` são os clipes antes da divisão; o clipe novo
começa em `em_ms` com `corte_ms + (em_ms − em)`.

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
- `npx tsx scripts/vad-teste.mjs`: silêncio, música sintética, os efeitos do C2 e a narração depois de 14 s sem fala,
  sem VAD, com o VAD como filtro e com o `--vad` numa passada (ver "Detector de voz").
- `npx tsx scripts/conjunto-casa.mjs preparar|medir`: o conjunto da casa e a medida contra a conferência à mão (ver
  "Conjunto da casa").
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

- Diarização por modelo (falantes num clipe só); o `checar_texto` olhar também o texto das legendas; editar pelo texto
  (rodada 4); transcrever clipe de vídeo do vídeo de cenas quando ele existir; legenda em mais de um idioma.
- Transcrição desligável por projeto: pede um campo no `estudio.json` (da Casca), lido pelo `transcrever` e pelo painel.
- O começo das palavras: contra a referência de máquina, 52% ficam a até 100 ms (a régua pede 90%). O DTW piorou
  (medido em 07/11); o próximo passo é medir no conjunto da casa conferido e, se não cumprir, alinhar as palavras ao
  áudio depois do whisper (alinhamento forçado com um modelo de fonemas de licença comercial).
