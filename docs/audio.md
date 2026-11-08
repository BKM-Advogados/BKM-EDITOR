# Som no vídeo de cenas

Versão 1, de 06/11/2026 (grupo 1 da Ordem sugerida: sessão multipista, trilha com volume e fades por clipe, ducking
automático da música sob a voz e a pasta de trilhas). Versão 2, de 07/11/2026 (rodada 2): limpeza de voz, medidor de
loudness (LUFS e pico verdadeiro) e o arquivo exportado no alvo de −14 LUFS. Vale para o documento `"tipo": "cenas"`; o
carrossel narrado da Cliente continua com a narração em trechos e os efeitos sonoros do resolvedor de roteiro (e sai da
exportação como o render o faz, sem correção de loudness).

## O formato

`audio` é opcional no documento de cenas. Sem ele, o vídeo é mudo e continua válido.

```json
"audio": {
  "alvo_lufs": -14, "pico_dbtp": -1,
  "faixas": [
    {"id": "narracao", "nome": "Narração", "papel": "voz", "volume": 1,
     "clipes": [{"id": "clipe-1", "arquivo": "midia/narracao.wav.limpo.wav", "em": 500, "duracao_ms": 11500,
                 "original": "midia/narracao.wav",
                 "limpeza": {"intensidade": "media", "ruido_antes_db": -39.9, "ruido_depois_db": -55, "voz_antes_db": -21.2, "voz_depois_db": -22.1}}]},
    {"id": "musica", "nome": "Música", "papel": "musica", "volume": 0.8,
     "ducking": {"ativo": true, "alvo_lu": 20, "ataque_ms": 80, "soltura_ms": 500},
     "clipes": [{"id": "clipe-2", "arquivo": "midia/cama.mp3", "em": 0, "duracao_ms": 12000, "corte_ms": 4000,
                 "volume": 1, "fade_in_ms": 500, "fade_out_ms": 1500, "mudo": false}]},
    {"id": "efeitos", "nome": "Efeitos", "papel": "efeitos", "clipes": []}
  ]
}
```

**Faixa:** `id`, `nome`, `papel` (`voz`, `musica` ou `efeitos`; faltando, sai do nome: "Narração" é voz, "Trilha" é
música, o resto é efeito), `volume` (0 a 1, padrão 1), `mudo` e, na música, `ducking`.

**Clipe:** `id`, `arquivo` (caminho no projeto, normalmente em `midia/`), `nome` (opcional; o que a linha do tempo
mostra, padrão é o nome do arquivo), `em` (ms na linha do tempo do vídeo), `duracao_ms`, `corte_ms` (quanto do começo do
arquivo fica de fora, padrão 0), `volume` (0 a 1), `fade_in_ms`, `fade_out_ms` e `mudo`. Os tempos são em ms, como o
resto do documento, e a interface grava em passos de 50 ms.

**Ducking** (só na faixa de música): `ativo` (padrão ligado), `alvo_lu` (quanto a música fica abaixo da voz; padrão
20, aceita de 6 a 36), `ataque_ms` (padrão 80) e `soltura_ms` (padrão 500).

**Voz limpa** (no clipe, opcional): `original` é o arquivo da pessoa, intacto, e `arquivo` aponta para o limpo
(`midia/<arquivo>.limpo.wav`; leve e forte gravam `.limpo-leve.wav` e `.limpo-forte.wav`); `limpeza` guarda a intensidade
e o que foi medido (ruído nas pausas e nível da voz antes e depois, em dB com ponderação K). "Voltar ao original" põe
`original` de volta em `arquivo` e tira os dois campos. A linha do tempo mostra o nome do original com "(limpa)".

**Loudness do arquivo exportado** (no `audio`, opcional): `alvo_lufs` (padrão −14, aceita de −30 a −9) e `pico_dbtp`
(padrão −1, aceita de −6 a 0).

O que estiver fora do lugar vira aviso no inspector, não erro: clipe antes do zero vai para o zero; clipe que começa
depois do fim do vídeo não toca; clipe que passa do fim corta no fim; corte ou duração além do arquivo encolhem;
volume acima de 1 vira 1.

## Envelope: medir uma vez, usar em todo lugar

A interface mede cada arquivo de áudio uma vez (Web Audio decodifica; `src/nucleo/audio.ts` aplica a ponderação K da
ITU-R BS.1770 e tira a potência média por janela de 50 ms) e pede ao processo principal para gravar
`midia/<arquivo>.envelope.json`:

```json
{"versao": 2, "janela_ms": 50, "duracao_ms": 12000, "db": [-100, -41.3, -22.7, ...],
 "fonte": {"tamanho": 1152044, "modificado_ms": 1762531200123.4, "sha256": "9f2c…"}}
```

`db` é o loudness de cada janela, no mesmo número do LUFS; `-100` é silêncio. O arquivo é pequeno (20 números por
segundo) e entra no git do projeto. Quem lê é o processo principal (`sessao-projeto.ts` passa os envelopes ao
`resolverCenas`), então a prévia, a exportação e o Claude (pelo `ler_documento`) veem a mesma forma de onda e o mesmo
ducking. Um clipe cujo arquivo ainda não tem envelope (projeto vindo de outro PC, arquivo trocado à mão) é medido em
segundo plano assim que o vídeo abre; até lá o ducking usa níveis típicos (narração a −20, música a −14) e avisa.

**Versão e carimbo.** `fonte` é o arquivo de áudio como estava quando foi medido: o processo principal carimba o tamanho,
a data e o sha256 ao gravar (e recusa se a interface mediu bytes que não são mais os do disco). Ao ler, o envelope vale
se o tamanho e a data conferem; com o mesmo tamanho e outra data (cópia, `git clone`), só o sha256 decide (lido uma vez
por sessão); com outro tamanho, ou sem carimbo, ou de outra `versao`, conta como não medido e a linha do tempo mede de
novo. A versão sobe quando a conta muda: a 2 veio com a ponderação K do libebur128, e os envelopes da 0.3.0 (versão 1)
são medidos de novo na primeira abertura. Tomada nova gravada com o mesmo nome com o app aberto (pelo terminal, pelo
Claude): a interface esquece a medida daquele arquivo, monta de novo os vídeos que o tocam e mede outra vez; o clipe não
fica preso à duração da tomada velha.

## Ducking: relativo e medido

A música cai enquanto há voz e volta nas pausas. A regra é a da casa: música e efeitos bem baixos, com a **mediana** da
música de 18 a 23 LU abaixo da **mediana** da voz. Nada é volume fixo:

1. **Referência da voz:** mediana das janelas com som de todos os clipes das faixas de voz (porta absoluta em −70 dB e
   relativa em 10 LU abaixo da média, como o BS.1770), já com o volume da faixa e do clipe.
2. **Referência da música:** a mesma mediana do trecho usado do clipe de música, com os volumes dele.
3. **Redução:** o que falta para a música ficar `alvo_lu` abaixo da voz: `redução = música − (voz − alvo)`, nunca
   negativa. Se a música já está abaixo do alvo, nada muda.
4. **Quando:** há voz numa janela quando ela está a menos de 18 LU da referência da voz. A presença vira uma rampa
   linear (sobe em `ataque_ms`, desce em `soltura_ms`) e o ganho da música é `−presença × redução`, em dB.

O resultado fica nas props de cada clipe de música (`ducking.ganho[]`, um número por janela desde o começo do clipe,
mais `reducao_db`, `voz_db` e `musica_db`). A composição aplica por quadro; a linha do tempo desenha a onda já
rebaixada (e o contorno original por trás) e a linha branca do volume, então o ducking aparece antes de tocar.

## Composição e exportação

`VideoCenas` põe cada clipe num `<Html5Audio>` dentro de uma `<Sequence>` no tempo do vídeo, com `trimBefore` para o
corte e `volume` como função do quadro: faixa × clipe × fades × ducking, entre 0 e 1 (`volumeDoClipe`). O quadro que a
função recebe conta desde o começo do clipe, mesmo com corte (conferido no código do Remotion 4.0.540). A exportação
usa o mesmo `renderMedia` de sempre, que mixa os `<Html5Audio>` no MP4. Na prévia um arquivo que não carrega vira aviso
no console; no render o Remotion para e avisa, melhor do que sair mudo.

`scripts/exportar-teste-som.mjs` (`npx tsx scripts/exportar-teste-som.mjs`) monta um projeto com narração e música sintéticas,
mede os envelopes, renderiza e confere com `getVideoMetadata` que o MP4 tem faixa de áudio. Saída em
`testes/saida/exportar-teste/`.

## Limpeza de voz

Por clipe de voz, no inspetor (seção "Limpeza de voz"): intensidade (Leve, Média, Forte), "Limpar voz", andamento e
Cancelar; já limpo, o ruído e a voz antes e depois, "Limpar de novo" e "Voltar ao original". O processo principal
(`src/main/limpeza-voz.ts`) decodifica o original com o ffmpeg do compositor do Remotion, limpa com
`src/nucleo/limpeza-voz.ts` e grava o `.limpo.wav` (16 bits, a taxa e os canais do original) com o envelope ao lado. Limpar
de novo parte sempre do original. O tamanho e o alinhamento não mudam: corte e duração do clipe continuam valendo.

**Fora do git.** Cada versão limpa tem dezenas de MB (2 min estéreo a 44,1 kHz são 21 MB por intensidade), e o commit
automático do projeto faz `git add -A`. A primeira limpeza acrescenta ao `.gitignore` do projeto, antes de gravar o WAV,
as linhas `*.limpo.wav`, `*.limpo-leve.wav`, `*.limpo-forte.wav` e o envelope de cada uma (`*.limpo.wav.envelope.json`…),
com um comentário; vale para projeto novo e antigo, e o `GITIGNORE` de `criar-projeto.ts` não muda. A versão limpa se
refaz a partir do original ("Limpar de novo", que é determinístico). **Sobras:** na abertura do projeto, a versão limpa
(nome `<arquivo>.<ext>.limpo[-leve|-forte].wav`) que nem os documentos nem o diário (`.estudio/diario.jsonl`, nos patches
e nos inversos) citam é apagada com o envelope. O diário conta porque o Ctrl+Z o lê do disco e atravessa sessões: depois
de reabrir, desfazer "Limpar de novo" volta o clipe para a versão de antes, que tem de estar lá. Na prática, só some a
versão que nunca chegou a um documento (limpeza cuja troca no clipe falhou); as intensidades testadas ficam no disco,
fora do git. Só na abertura, nunca no meio da sessão, e só se todos os documentos e o diário abrirem. Um documento antigo
tirado do git que aponte para uma versão apagada faz o render parar com o nome do arquivo; "Limpar de novo" a refaz.

O ffmpeg do Remotion vem enxuto (só `aformat`, `atrim`, `adelay`, `apad`, `amix`, `aresample`, `loudnorm`, `volume`,
`silencedetect` e poucos outros de áudio; sem `afftdn`, `highpass`, `lowpass`, `deesser`, `arnndn` nem `ebur128`). Por isso
a limpeza é TypeScript puro, sem modelo nem download:

1. **Grave:** passa-altas Butterworth de 2ª ordem passado na ida e na volta (fase zero, queda de 4ª ordem): 70, 80 ou
   100 Hz conforme a intensidade. Tira rumor, vento e o fundamental do zumbido de 60 Hz.
2. **Ruído:** porta espectral. STFT de ~43 ms (2048 pontos a 44,1 e 48 kHz), 75 % de sobreposição; o espectro do ruído
   sai dos 10 % de quadros mais quietos (as pausas, sem zero digital). Cada faixa de frequência que não passa de
   `margem_db` (4, 6 ou 8) acima do ruído cai até `reducao_db` (10, 16 ou 24 dB), com joelho de 6 dB, a máscara
   suavizada em ±2 faixas e soltura de 80 ms (menos "ruído musical", sem comer o fim das palavras).
3. **De-esser leve:** quando a energia de 4,5 a 10 kHz passa de 35 % da do quadro (o "s", o "ch"), só essa faixa cai,
   até 3, 5 ou 6 dB a 75 %.
4. **Chiado:** passa-baixas na ida e na volta em 14, 12 ou 10 kHz.

É redução de ruído **estacionário** (zumbido, ar-condicionado, chiado de cabo, sala). Ruído que muda o tempo todo (rua,
gente falando ao fundo) pede um modelo (RNNoise, BSD-3; DeepFilterNet, MIT/Apache-2.0), que fica para uma fatia
seguinte: baixaria no primeiro uso para `%USERPROFILE%\Estudio\modelos\` com SHA-256 conferido, como as regras pedem.

**Medido** (`npx tsx scripts/limpeza-teste.mjs`, 07/11/2026): a narração do exemplo da Cliente (40 s, mono, 44,1 kHz) com
zumbido de 60 Hz e harmônicos (−45 dBFS), ruído largo (−42) e chiado (−50) somados. Ruído nas pausas (média de potência das
10 % janelas de 50 ms mais quietas, ponderação K), antes → depois; voz (mediana com as portas do BS.1770):

| Intensidade | Ruído nas pausas | Voz | Tempo |
|---|---|---|---|
| Leve | −39,9 → −49,4 dB (−9,5) | −21,2 → −21,7 dB | 1,5 s por minuto de áudio |
| Média | −39,9 → −55,0 dB (−15,1) | −21,2 → −22,1 dB | 1,6 s por minuto |
| Forte | −39,9 → −60,4 dB (−20,5) | −21,2 → −22,5 dB | 1,7 s por minuto |

A voz original, sem o ruído somado, tem −63,4 dB nessas mesmas pausas. Um minuto mono a 48 kHz: 2,2 s e pico de 55 MB
de memória acima da base (medidos; a entrada sozinha ocupa 11 MB). Os WAV ficam em `testes/saida/limpeza/` para ouvir.

## Medidor de loudness

`src/nucleo/loudness.ts`, ITU-R BS.1770-4 puro: ponderação K com os coeficientes da norma (as constantes do libebur128,
que a 48 kHz dão a tabela do BS.1770 até a 9ª casa), integrado em LUFS com as portas de −70 LUFS e de 10 LU abaixo (blocos
de 400 ms com 75 % de sobreposição), curto prazo (3 s, um valor a cada 100 ms), momentâneo (400 ms) e pico verdadeiro em
dBTP (sobreamostragem 4× com filtro de 48 coeficientes). Confere com os casos 1, 3 e 5 da EBU Tech 3341 (−23,0 ±0,1).

A mistura (`medirMistura`) refaz o que o render do Remotion faz: cada clipe no quadro dele, o volume do quadro
(`volumeDoClipe`) lido no começo de cada **pacote** do arquivo (o Remotion passa o volume ao filtro `volume` do ffmpeg, que
o avalia uma vez por pacote de áudio: 2048 amostras num WAV mono de 16 bits, 1024 no AAC, 1152 no MP3), mono aberto em
estéreo a −3 dB por lado e tudo somado sem normalizar (`amix` com `normalize=0`). O processo principal
(`src/main/loudness.ts`, IPC `audio:medir-loudness`) decodifica cada arquivo a 48 kHz em estéreo com o ffmpeg do
Remotion, guarda até ~64 MB de amostras entre medições e só mede de novo quando o som do vídeo muda.

Na tela, `MedidorLoudness.tsx`: no resumo do vídeo (nada selecionado), a seção "Loudness" com o alvo e o pico máximo
editáveis e os medidores da **Narração** (as faixas de voz somadas) e da **Mistura**, com o ganho que a exportação vai
aplicar; no inspetor de cada faixa, o medidor dela e, em música e efeitos, quantos LU ela fica **abaixo da narração
enquanto a voz fala** (a mediana, bloco a bloco, de voz − faixa: a conta da regra da casa; o integrado da música não
serve, porque vem das pausas, onde o ducking solta). Cada medidor mostra o integrado (verde a ±1 LU do alvo), a barra de
−40 a 0 LUFS com o alvo marcado, o curto prazo na cabeça de reprodução (anda enquanto toca) e o máximo dele, e o pico
verdadeiro (laranja acima do pico máximo).

**Medido contra o ffmpeg** (o loudnorm do ffmpeg do Remotion, que usa a mesma biblioteca do filtro `ebur128`, ausente
nesse build), 07/11/2026:

| Sinal | Integrado: medidor × ffmpeg | Pico: medidor × ffmpeg |
|---|---|---|
| Voz da Cliente com ruído (40 s) | −20,3 × −20,34 LUFS | −1,8 × −1,75 dBTP |
| A mesma, limpa (média) | −20,8 × −20,83 LUFS | −1,7 × −1,74 dBTP |
| Mistura do MP4 de teste, sintético | −20,4 × −20,45 LUFS | −8,3 × −9,13 dBTP |
| Mistura do MP4 de teste, voz da Cliente | −20,5 × −20,57 LUFS | −5,1 × −5,11 dBTP |

O pico da mistura sintética fica 0,8 dB abaixo do real: é no começo de cada frase, onde a música ainda não caiu e o
alinhamento exato dos pacotes manda; o arquivo exportado é medido de novo, então o pico final não depende dessa previsão.

## Loudness na exportação

Depois do `renderMedia`, `src/main/exportar.ts` chama `igualarLoudness` (`src/main/loudness.ts`; uma linha): só o vídeo de
cenas com algum clipe tocando. O loudnorm do ffmpeg do Remotion mede o arquivo; se ele já está a 0,5 LU do alvo e com o
pico abaixo do máximo, nada muda. Senão, a 2ª passada aplica as medidas (`linear=true`: só ganho quando o pico deixa;
senão o loudnorm usa o limitador dele) com o pico pedido 0,5 dB abaixo do máximo (o codificador sobe um pouco o pico),
`LRA` nunca abaixo do medido (não comprime a dinâmica) e `-shortest` (no modo dinâmico ele completa o último pedaço de
100 ms). O vídeo é copiado sem recodificar; o áudio sai em AAC 320 kb/s (`libfdk_aac`, como o Remotion) no MP4 e Opus no
WebM. O arquivo corrigido é medido de novo; se ainda estiver fora, refaz do original compensando o erro, até três vezes.
O ganho é o mesmo para todas as faixas: o ducking e os LU entre voz e música não mudam. O andamento aparece no diálogo de
exportação ("Igualando o loudness a −14 LUFS…" e a medida final).

**Medido** (`npx tsx scripts/exportar-teste-som.mjs [--voz-real]`, 07/11/2026): sintético −20,45 → −14,0 LUFS, pico
−9,13 → −2,69 dBTP (modo linear); com a voz da Cliente −20,57 → −14,21 LUFS, pico −5,11 → −1,49 dBTP (modo dinâmico, o
limitador segurou o pico); vídeo intacto e áudio sem atraso (a forma de onda casa com a mistura sem deslocamento).

## Licenças

Nada novo no instalador e nenhum download: a limpeza e o medidor são código do Estúdio, e o ffmpeg é o binário que o
pacote `@remotion/compositor-*` já traz para o render (build do Remotion, com `--enable-gpl`). As constantes da ponderação K
são as do BS.1770, na forma em que o libebur128 (MIT) as escreve.

## Na tela

- **Linha do tempo:** abaixo das cenas e dos blocos, uma linha verde por faixa, com o nome e o mudo presos à esquerda.
  O clipe é uma barra com a forma de onda; arrastar move no tempo, a alça da esquerda apara o começo (muda `corte_ms`,
  o fim fica no lugar), a da direita apara o fim. Clicar seleciona; duplo clique leva a cabeça ao começo do clipe.
  Delete exclui e Ctrl+D duplica o clipe ou a faixa selecionada.
- **"+ Áudio"** na barra da linha do tempo: Narração…, Música…, Efeito sonoro… (o diálogo copia o arquivo para
  `midia/`, mede e cria o clipe; a narração e o efeito entram no tempo atual, a música entra no zero até o fim do vídeo
  com fade de saída de 1,5 s) e Música da biblioteca… (a pasta de trilhas).
- **Inspector:** faixa (nome, papel, volume, mudo, na música o ducking com o que foi medido, e o loudness da faixa) e
  clipe (arquivo, trocar arquivo, nome, começa em, duração, corte, volume, fades, mudo, a redução sob a voz e, na voz, a
  limpeza). Sem nada selecionado, o resumo do vídeo traz a seção "Loudness" (alvo, pico máximo e os medidores).

## Dividir, copiar e crossfade (rodada 3)

A conta é de `src/nucleo/clipes-audio.ts`: a interface (`acoes-audio.ts`) e o MCP (`mcp-som.ts`) chamam as mesmas
funções, então a pessoa e a IA obtêm o mesmo documento. Tudo sai como JSON Patch (diário, Ctrl+Z, "Ver" e "Reverter").

**Dividir na cabeça** (clipe selecionado + Ctrl+K, o botão "Dividir na cabeça" do inspetor ou `dividir_clipe`). O corte
cai num **número inteiro de quadros contado do começo do clipe**: o Remotion põe o clipe no quadro mais perto de `em` e
pula `corte_ms` em quadros, e só com o corte em quadros inteiros as duas metades tocam, juntas, exatamente o que o clipe
inteiro tocava (a cabeça do monitor anda em quadros e o corte pode ficar até meio quadro de onde ela estava). A
segunda metade nasce com id novo (`n1` → `n1-1`) e leva o resto do clipe: arquivo, volume, mudo, nome e a voz limpa
(`original` e `limpeza`). O fade de entrada fica na primeira metade e o de saída na segunda; fade mais longo que a
metade em que está avisa e fica só nessa metade. Cada metade tem pelo menos 100 ms.

**Legendas.** O segmento que fica inteiro de um lado vai com aquele clipe; o que o corte atravessa é partido na
primeira palavra depois do corte (`dividirSegmento`), e o clipe novo ganha a `origem` do clipe de onde veio. Assim a
tela mostra as mesmas palavras nos mesmos tempos, e mover a segunda metade leva só as legendas dela.
Duplicar (Ctrl+D, `copiar_clipe`) faz o mesmo: a cópia traz as legendas, deslocadas para onde a cópia começa, e anda
com ela. Duplicar a *faixa* inteira ainda não leva as legendas dos clipes.

**Crossfade** (inspetor → "Crossfade com o seguinte", ou `crossfade`). O fim do primeiro clipe desce e o começo do
segundo sobe durante `duracao_ms`, com os dois tocando juntos. A forma vem de `fade_in_curva` e `fade_out_curva` no clipe:

| curva | ganho depois de `u` do fade | quando usar |
|---|---|---|
| `linear` | `u` | a mesma tomada dos dois lados (voz): a soma dos ganhos é 1 |
| `suave` | `(1 − cos πu) / 2` | começa e termina devagar; soma dos ganhos 1 |
| `potencia` | `sin(πu/2)` | músicas e efeitos diferentes: a soma das potências é 1, e **no meio o nível fica o de antes** (a linear cairia 3 dB) |

O padrão é `potencia` em faixa de música e efeitos, e `linear` em voz. Para os dois se sobreporem por `duracao_ms`
há dois modos: `estender` usa o som que sobra nos arquivos (primeiro a cauda do primeiro clipe, depois o começo do
segundo; nada muda de lugar, então a narração presa a eles segue no tempo) e `sobrepor` puxa o segundo clipe para trás
(ele acaba antes). `auto` (padrão) estende o que der e sobrepõe o resto, dizendo o que fez. Se os dois já se
sobrepõem mais do que o pedido, o primeiro encurta.

**Medido** (`MEDIR=1 npx vitest run testes/clipes-audio.test.ts`, mistura simulada com o posicionamento por quadro do
`VideoCenas`, 48 kHz): metades somadas menos o clipe inteiro = −222 dB (zero, no limite do ponto flutuante; o critério
é −60 dB), contra +1,7 dB com o corte em milissegundos fora da grade. Crossfade de potência igual entre dois ruídos
diferentes, com 2 s: +0,01, +0,07 e +0,08 dB em relação ao nível de antes a 25, 50 e 75 % da sobreposição; o linear cai
2,9 dB no meio. **Não medido:** o render real do Remotion (a mistura é a simulação, não o MP4) e o ducking de uma
música dividida (cada metade calcula a redução pela mediana do seu trecho).

## Efeito sonoro na medida da casa (som-D4)

Um efeito novo (Efeito sonoro…) entra com o volume do clipe calculado para a mediana dele ficar **20 LU abaixo da voz**
(a casa mixa de 18 a 23): `volumeDoEfeito` usa a mediana da voz medida, com o volume de faixa e de clipe (`nivelDaVoz`);
sem voz medida, a voz típica de −20 dB. Um efeito que já é mais baixo que o alvo fica a 100 %: não se sobe o volume.
Medido: whoosh a −3 dB sobre voz a −22,9 dB entra a 1 % e fica 20,08 LU abaixo dela.

## Música sobre música (som-D7)

Escolher uma segunda música quando a faixa já vai até o fim do vídeo não a põe mais no zero por cima da primeira: ela
entra na cabeça (se a cabeça está a mais de 0,5 s do começo e a 1 s do fim), e a que toca ali desce em crossfade de 1,5 s;
sem lugar na cabeça, vai para uma faixa de música nova ("Música 2"), com aviso. Em qualquer caso, duas músicas da
mesma faixa que tocam juntas sem um crossfade que cubra a sobreposição geram o aviso "tocam juntas por N s" no
resolvedor (e o Claude o vê nos avisos do documento).

## Ferramentas MCP do som (`src/nucleo/mcp-som.ts`)

| ferramenta | o que faz | classe |
|---|---|---|
| `dividir_clipe` | divide o clipe em `em_ms` (ou onde está a cabeça) na grade de quadros, levando as legendas | livre |
| `copiar_clipe` | copia o clipe na mesma faixa (depois do original ou em `em_ms`), com as legendas | livre |
| `crossfade` | crossfade entre dois clipes da mesma faixa: `duracao_ms`, `curva`, `modo` | livre |
| `preparar_teleprompter` | grava o texto (ou o das cenas) em `teleprompter`, com a velocidade, e estima a duração da leitura; quem grava é a pessoa | livre |
| `adicionar_clipe_audio` | põe um arquivo de áudio do projeto numa faixa (narração, música ou efeito), com o volume do efeito na medida da casa | livre |

Classe **livre**: grava no diário como o agente e tem Reverter. Nenhuma lê a web, baixa modelo ou toca em arquivo de
fora do projeto. Como chegar vindo de outro módulo: a seleção de um clipe de áudio (`estado_do_editor`) diz o `clipe`; o
`em_ms` omitido usa a cabeça gravada em `estado.json`. Como voltar: `listar_mudancas` + Reverter, ou Ctrl+Z na tela.

## Gravar a narração com teleprompter (rodada 3)

"+ Áudio" › "Gravar narração…" abre o gravador (`GravadorNarracao.tsx`). **Texto:** vem do campo `teleprompter` do vídeo
(`{texto, palavras_por_minuto?, tamanho?, espelhar?}`, que a IA também escreve) ou do botão "Texto das cenas" (títulos, textos
e listas, uma cena por parágrafo). **Teleprompter:** depois de uma contagem de 3 s o texto rola na velocidade pedida
(padrão 150 palavras por minuto, de 60 a 260), com a palavra da vez em destaque e as lidas esmaecidas; a conta de tempo é de
`src/nucleo/gravacao.ts`: 60 000/ppm ms por palavra, mais 250 ms depois de vírgula, 500 ms depois de ponto e 600 ms por
parágrafo. "Espelhar" inverte o texto para um espelho de teleprompter. **Monitoramento:** "Ouvir a mim mesmo (fones)" liga um
ganho à parte do microfone para o destino; vem desligado, porque sem fones o microfone pega o alto-falante. **Medidor:** pico em
dBFS ao vivo; passou de −0,5 dB a barra fica vermelha e, ao parar, a tomada avisa que pode ter cortado.

**Captura.** `getUserMedia` com `echoCancellation`, `noiseSuppression` e `autoGainControl` **desligados**, mono, 48 kHz; o
`AudioContext` abre a 48 kHz e, se o sistema não conceder, a gravação não começa. As amostras vêm de um `ScriptProcessorNode`
(o `AudioWorklet` pediria um módulo que o `script-src 'self'` da janela só aceita empacotado). Ao parar, o WAV é PCM de
**24 bits**, 48 kHz (`codificarWavPcm`), o processo principal confere o cabeçalho (`salvarTomada`, canal `audio:salvar-tomada`) e grava
`midia/narracao-gravada.wav` (`-2`, `-3`… sem nunca sobrescrever), e `adicionarClipeAudio` põe o clipe na narração **medindo o
envelope** na hora. A limpeza de voz é um passo à parte, a pedido, e o original fica.

**Medido (testes):** o WAV de 24 bits volta com erro < 1e-6; o ffmpeg do Remotion o decodifica (erro < 1e-5) e o envelope de um
seno de 0,5 a 300 Hz sai a −9,7 dB. **Não medido:** o microfone de verdade, a latência do monitoramento e a rolagem do
teleprompter na tela (o Electron não roda neste PC; a prévia web não tem microfone). Se o Windows bloquear o microfone, a
mensagem manda para Configurações › Privacidade › Microfone.

## Pasta de trilhas

Preferência `pasta_trilhas` (padrão `%USERPROFILE%\Estudio\trilhas`). "Música da biblioteca…" lista os mp3, wav,
m4a, ogg e aac dela (até dois níveis de subpasta), com filtro, "Abrir" no Explorador e "Trocar pasta…". Escolher uma
trilha copia para `midia/` e cria o clipe na faixa de música. A curadoria de músicas livres com licença conferida fica
para depois: por ora a pasta é da pessoa.

## Onde está

- `src/nucleo/audio.ts`: tipos, envelope (ponderação K), referência por mediana, `calcularDucking`, `resolverAudio`,
  `volumeDoClipe`. Puro, sem disco.
- `src/nucleo/cenas.ts`: `audio` no documento e nas props; `resolverCenas(doc, {envelopes})`.
- `src/nucleo/gravacao.ts`: WAV PCM, medidor e teleprompter. `src/main/ipc-gravacao.ts`: salva a tomada. `src/renderer/modulos/video/gravador.ts` e `GravadorNarracao.tsx`: a captura e o painel.
- `src/nucleo/clipes-audio.ts`: `dividirClipe`, `copiarClipe`, `crossfadeEntre`, `volumeDoEfeito` (puros, em JSON Patch).
  `src/nucleo/mcp-som.ts`: as ferramentas MCP do som (`registrarSom`, uma linha em `ferramentas-mcp.ts`).
- `src/composicoes/cenas/VideoCenas.tsx`: `<Som>` com um `<Html5Audio>` por clipe.
- `src/nucleo/loudness.ts`: medidor BS.1770 aos pedaços e `medirMistura`. `src/nucleo/limpeza-voz.ts`: a limpeza.
- `src/main/ipc-audio.ts`: grava o envelope com o carimbo (`gravarEnvelope`), lista a pasta de trilhas, importa trilha;
  `lerEnvelopes` para as props (só o envelope em dia).
- `src/main/ffmpeg-som.ts`: acha e roda o ffmpeg do Remotion, decodifica para amostras, lê e grava WAV.
- `src/main/limpeza-voz.ts` (IPC `audio:limpar-voz`, `audio:limpeza-cancelar`, evento `audio:limpeza-progresso`; as
  regras do `.gitignore` e `apagarLimposSemUso`, chamado na abertura do projeto) e
  `src/main/loudness.ts` (`igualarLoudness` da exportação e o IPC `audio:medir-loudness`), registrados no `main.ts`.
- `src/renderer/modulos/video/`: `envelope.ts` (mede com Web Audio), `acoes-audio.ts` (patches, limpar e voltar ao
  original), `FaixasAudio.tsx` (linha do tempo), `BibliotecaTrilhas.tsx`, `MedidorLoudness.tsx`, e as partes de áudio em
  `LinhaDoTempo.tsx` e `InspectorCenas.tsx`.
- `testes/audio.test.ts`, `testes/loudness.test.ts`, `testes/limpeza-voz.test.ts`, `testes/clipes-audio.test.ts`, `testes/mcp-som.test.ts`, `testes/gravacao.test.ts`; `scripts/audio-sintetico.ts` (WAV de
  teste da prévia web e do script de exportação), `scripts/limpeza-teste.mjs` e `scripts/exportar-teste-som.mjs`.
- Prévia web: a ponte limpa e mede de verdade (o mesmo núcleo) sobre os WAV sintéticos.

## Para o Claude (trecho para o claudeMd)

O formato acima vale para o `aplicar_patch`: `audio.alvo_lufs` e `audio.pico_dbtp` mudam o alvo da exportação; num clipe
limpo, trocar `arquivo` à mão deixa `original` e `limpeza` desatualizados (apague os dois, ou use "Voltar ao original").
Os `*.limpo*.wav` ficam fora do git (estão no `.gitignore`) e se refazem do original; não os versione. Gravar uma tomada
nova por cima de um áudio de `midia/` é seguro: o envelope dele deixa de valer e a interface mede de novo.
A limpeza de voz e a medição são da interface (precisam do ffmpeg do processo principal); o Claude não as dispara pelo MCP.

Dividir, copiar e fazer crossfade de clipes tem ferramenta própria (`dividir_clipe`, `copiar_clipe`, `crossfade`): use-as
no lugar de montar o patch, porque elas cuidam da grade de quadros, do fade, da voz limpa e das legendas do clipe. Para
um efeito sonoro novo por `aplicar_patch`, ponha `volume` no clipe para a mediana dele ficar 20 LU abaixo da voz (a
interface faz essa conta; um efeito a 100 % passa por cima da narração). Duas músicas na mesma faixa só se sobrepõem
com `fade_out_ms` e `fade_in_ms` iguais ao tempo da sobreposição (e `fade_*_curva: "potencia"`): senão o documento avisa
que tocam juntas.

Para a pessoa gravar a narração: `preparar_teleprompter` (ou o campo `teleprompter` por patch) deixa o texto pronto; peça a ela para abrir
"+ Áudio" › "Gravar narração…" (o microfone é dela). Depois da gravação, o clipe já está na faixa de narração; `adicionar_clipe_audio`
serve para pôr outro arquivo de `midia/` (a tomada de outra pessoa, uma música, um efeito).
