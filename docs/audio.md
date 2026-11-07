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
{"versao": 1, "janela_ms": 50, "duracao_ms": 12000, "db": [-100, -41.3, -22.7, ...]}
```

`db` é o loudness de cada janela, no mesmo número do LUFS; `-100` é silêncio. O arquivo é pequeno (20 números por
segundo) e entra no git do projeto. Quem lê é o processo principal (`sessao-projeto.ts` passa os envelopes ao
`resolverCenas`), então a prévia, a exportação e o Claude (pelo `ler_documento`) veem a mesma forma de onda e o mesmo
ducking. Um clipe cujo arquivo ainda não tem envelope (projeto vindo de outro PC, arquivo trocado à mão) é medido em
segundo plano assim que o vídeo abre; até lá o ducking usa níveis típicos (narração a −20, música a −14) e avisa.

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

## Pasta de trilhas

Preferência `pasta_trilhas` (padrão `%USERPROFILE%\Estudio\trilhas`). "Música da biblioteca…" lista os mp3, wav,
m4a, ogg e aac dela (até dois níveis de subpasta), com filtro, "Abrir" no Explorador e "Trocar pasta…". Escolher uma
trilha copia para `midia/` e cria o clipe na faixa de música. A curadoria de músicas livres com licença conferida fica
para depois: por ora a pasta é da pessoa.

## Onde está

- `src/nucleo/audio.ts`: tipos, envelope (ponderação K), referência por mediana, `calcularDucking`, `resolverAudio`,
  `volumeDoClipe`. Puro, sem disco.
- `src/nucleo/cenas.ts`: `audio` no documento e nas props; `resolverCenas(doc, {envelopes})`.
- `src/composicoes/cenas/VideoCenas.tsx`: `<Som>` com um `<Html5Audio>` por clipe.
- `src/nucleo/loudness.ts`: medidor BS.1770 aos pedaços e `medirMistura`. `src/nucleo/limpeza-voz.ts`: a limpeza.
- `src/main/ipc-audio.ts`: grava o envelope, lista a pasta de trilhas, importa trilha; `lerEnvelopes` para as props.
- `src/main/ffmpeg-som.ts`: acha e roda o ffmpeg do Remotion, decodifica para amostras, lê e grava WAV.
- `src/main/limpeza-voz.ts` (IPC `audio:limpar-voz`, `audio:limpeza-cancelar`, evento `audio:limpeza-progresso`) e
  `src/main/loudness.ts` (`igualarLoudness` da exportação e o IPC `audio:medir-loudness`), registrados no `main.ts`.
- `src/renderer/modulos/video/`: `envelope.ts` (mede com Web Audio), `acoes-audio.ts` (patches, limpar e voltar ao
  original), `FaixasAudio.tsx` (linha do tempo), `BibliotecaTrilhas.tsx`, `MedidorLoudness.tsx`, e as partes de áudio em
  `LinhaDoTempo.tsx` e `InspectorCenas.tsx`.
- `testes/audio.test.ts`, `testes/loudness.test.ts`, `testes/limpeza-voz.test.ts`; `scripts/audio-sintetico.ts` (WAV de
  teste da prévia web e do script de exportação), `scripts/limpeza-teste.mjs` e `scripts/exportar-teste-som.mjs`.
- Prévia web: a ponte limpa e mede de verdade (o mesmo núcleo) sobre os WAV sintéticos.

## Para o Claude (trecho para o claudeMd)

O formato acima vale para o `aplicar_patch`: `audio.alvo_lufs` e `audio.pico_dbtp` mudam o alvo da exportação; num clipe
limpo, trocar `arquivo` à mão deixa `original` e `limpeza` desatualizados (apague os dois, ou use "Voltar ao original").
A limpeza de voz e a medição são da interface (precisam do ffmpeg do processo principal); o Claude não as dispara pelo MCP.
