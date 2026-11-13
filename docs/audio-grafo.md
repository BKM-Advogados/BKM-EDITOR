# Grafo de áudio

O motor da Música roda num grafo de processadores por bloco (M-01, decisão [A2](adr/A2-motor-em-grafo-por-bloco.md)).
O código fica em `src/nucleo/audio-grafo/`, em TypeScript puro: sem Node, DOM nem Web Audio. Ele roda igual no worker da
janela, no processo principal e no MCP por stdio, e vai rodar num AudioWorklet na onda M5. Este texto é para quem vai
mexer no motor. Ele mostra a API, como o documento vira grafo, como converter um efeito em processador nativo sem mudar
o som e como a memória do render fica limitada (M-04).

| Arquivo | O que tem |
|---|---|
| `tipos.ts` | `Processador`, `ProcessadorInteiro`, `ContextoBloco`, `CurvaParam`, `LigacaoParam` |
| `grafo.ts` | `Grafo`: nós, ligações com ganho, automações por endereço, ordem topológica estável |
| `executor.ts` | `executarOffline`: o laço por blocos (128 por padrão), PDC, estágios, cache por chave |
| `processadores.ts` | nativos: `Fonte`, `Passa`, `Ganho`, `VolumePan`, `Atraso`; e `panLei` e `ganhoDeDb` (a conta única do motor) |
| `eq3.ts`, `compressor.ts`, `freeverb.ts`, `delay.ts`, `limitador.ts` | os efeitos do mixer, nativos (M-04); o limitador é causal, com 1,5 ms de latência |
| `amostras.ts` | `FonteAmostras` (leitura por trecho), `fontePorTrechos` (carga preguiçosa), `ArmazemAudio`, `armazemDeMemoria` |
| `instrumentos.ts` | bateria, sintetizador, áudio, sidechain e automação renderizados por trecho |
| `musica.ts` | `grafoDaMusica` (documento → grafo) e `renderizarMusicaGrafo` (o render canônico) |

Fora da pasta, porque usam o disco (Node): `src/nucleo/cache-audio.ts` (`CacheAudioDisco`, o cache em disco com LRU) e
`src/nucleo/amostras-wav.ts` (`abrirWav`, um WAV lido por trecho).

`renderizarMusica`, exportado de `musica-som.ts`, é o `renderizarMusicaGrafo`. Ele tem a mesma assinatura e o mesmo
resultado de antes: mistura, stems por faixa, retornos, `limitador_db`, avisos, `faltando` e o cache por camada da prévia.
Quem chamava o motor (o worker, `musica-entrega.ts`, `musica-hash.ts`, `src/main/musica-render.ts`, a prévia web) não
mudou. O motor antigo, de buffer inteiro, continua em `musica-som.ts` com o nome `renderizarMusicaAntigo`, só como
oráculo dos testes. Não mude a conta dele.

## O processador

```ts
interface Processador {
  readonly tipo: string;                       // "ganho", "eq3"...
  readonly entradas: readonly number[];        // canais de cada porta de entrada: [2] estéreo; [2, 1] estéreo + sidechain mono
  readonly saidas: readonly number[];          // canais de cada porta de saída (multi-out: [2, 2, 2])
  readonly parametros?: readonly {nome: string; padrao: number}[];
  readonly latencia: number;                   // amostras; lida depois do preparar
  preparar(taxa: number, bloco: number): void; // aloque aqui; `bloco` é o maior n que virá
  processar(entradas, saidas, n: number, ctx: ContextoBloco): void;
  resetar(): void;                             // volta ao silêncio do começo
  estado(): EstadoProcessador;                 // JSON puro (nada de Float32Array)
  restaurar(e: EstadoProcessador): void;
}
```

- `entradas[porta][canal]` e `saidas[porta][canal]` são `Float32Array` do executor, com pelo menos `n` amostras. Não mude
  as entradas. Escreva as `n` amostras de todo canal de toda saída, porque o buffer chega com o bloco anterior.
- Não aloque no `processar`: no worklet, cada alocação vira risco de estalo.
- `ctx.inicio` é a amostra da música da primeira amostra do bloco, já descontada a latência que chega ao nó. `ctx.taxa`
  é a taxa. `ctx.param(nome)` devolve um número (constante no bloco) ou uma curva com um valor por amostra. A curva é
  emprestada: leia só dentro do `processar`.
- Estado só nos campos do objeto, nada de global. É o que permite `estado()` e `restaurar()` (freeze, M-08, e worklet,
  M-06) e rodar dois grafos ao mesmo tempo.

## O grafo

```ts
const g = new Grafo();
g.no('canal:bumbo', new Fonte(seco));
g.no('faixa:baixo/entrada', new Passa(2));
g.no('faixa:baixo/volume_pan', new VolumePan(), {params: {volume_db: {endereco: 'faixa:baixo/volume_db', valor: -3}, pan: 0.2}});
g.no('master', new Passa(2), {soma: 'zero'});
g.ligar('canal:bumbo', 'faixa:baixo/entrada');                 // porta 0 → porta 0
g.ligar('canal:bumbo', {no: 'faixa:baixo/duck', porta: 1});    // sidechain por áudio
g.ligar('retorno:reverb', 'master', {ganho: 0.5});             // ganho na ligação (envio, volume de retorno)
g.automatizar('faixa:baixo/volume_db', curva);                 // endereço da M-02 → curva
```

- **Ids**: use o endereço da M-02 (`src/nucleo/musica-param.ts`) do alvo mais o papel do nó: `faixa:<id>/eq`,
  `canal:<id>`, `master/limitador`. Ids repetidos são recusados. O `grafoDaMusica` põe `#2`, `#3` quando o documento
  repete um id, como o motor antigo aceitava.
- **Ordem**: topológica estável (Kahn), com empate desfeito pela ordem em que os nós entraram. Ciclo é erro: a
  realimentação mora dentro de um processador, como o laço do delay.
- **Soma**: as ligações de uma mesma entrada somam na ordem em que foram feitas, cada uma vezes o seu ganho
  (`y = y + x·ganho`, guardado em float32 a cada passo). No modo `soma: 'primeira'` (o padrão), a primeira ligação é
  copiada como chega, então uma ligação só passa o sinal intacto, −0 incluído. No modo `'zero'`, todas somam a partir de
  +0. É a conta do master e dos envios aos retornos no motor antigo (0 + −0 dá +0, e o hash é bit a bit).
- **Canais**: a ligação exige o mesmo número de canais dos dois lados. Para converter mono em estéreo, use um nó.
- **Parâmetros**: `LigacaoParam` é um número, ou `{endereco?, curva?, valor?}`. Vale, nesta ordem: a automação
  registrada para o endereço, a curva própria do nó (uma modulação interna, como o ganho do sidechain por notas), o
  valor, o padrão do processador. A curva é um `Float32Array` no tempo da música, em que antes do começo vale o primeiro
  valor e depois do fim o último. Também pode ser uma função `(inicio, n, out)`. Ela já vem na unidade do processador:
  quem monta o grafo converte (dB → linear, por exemplo).

## O executor

`executarOffline(grafo, {taxa, n, saida, bloco?, coletar?, cache?, armazem?, aoBloco?})` devolve `{canais, coletados,
chavesUsadas, latencia, estagios, armazem}`.

- **Blocos fixos** de `bloco` amostras (128 por padrão). O último bloco é menor. O tamanho do bloco não muda um bit da
  saída, e os testes conferem com blocos de 1 a maior que a música.
- **PDC**: a latência que chega a um nó é a maior das entradas, e a que sai é essa mais a do processador. Cada ligação
  que vem de um caminho mais curto passa por uma `Atraso` com a diferença. A saída e os coletados voltam alinhados no
  tempo da música: o executor roda `latência` amostras a mais e descarta o começo. Depois do fim, as fontes tocam
  silêncio.
- **Coletar**: `coletar: [id]` devolve a saída inteira (porta 0) desses nós. São os stems das faixas e dos retornos.
- **Cache**: com `cache` (um `Map`, o mesmo `CacheSom` da prévia), um nó com `chave` já guardada não roda, nem o que só
  ele usava. Um nó com chave nova tem a saída guardada. A chave tem que mudar sempre que muda algo que muda o som que sai
  dali, o que vem antes incluído. `chavesUsadas` diz o que este render usou, e o resto pode sair do cache.
- **Armazém** (M-04): com `armazem` (um `ArmazemAudio`, como o cache em disco), um nó com chave já guardada vira uma
  fonte lida por trecho, bloco a bloco, sem ficar inteira na memória. Um nó com chave nova é gravado enquanto roda,
  também por bloco. Se o render falhar, o que estava sendo gravado é descartado. `armazem.lidas` e `armazem.gravadas`
  no resultado dizem o que veio de lá e o que foi para lá. Com `cache` e `armazem` juntos, o Map vale primeiro.
- **Saída bloco a bloco**: com `aoBloco(canais, inicio, qtd)`, a saída vai em pedaços alinhados no tempo da música, em
  ordem, e `canais` volta vazio. É o caminho do WAV em streaming (M-10): a mistura nunca fica inteira na memória.
- **Estágios**: um `ProcessadorInteiro` (adaptador) só sabe processar a música inteira. O executor roda por bloco tudo
  que vem antes dele e junta a entrada inteira. No fim do estágio, chama `processarTudo` e usa a saída como fonte do
  estágio seguinte. Uma saída por bloco que um estágio posterior lê é gravada inteira. Sem adaptadores, há um estágio só
  e a memória fica no que se pede para coletar. `estagios` no resultado mostra quantos houve. Desde a M-04, nenhum nó
  da música é adaptador: o render dela roda num estágio só. O mecanismo fica para um efeito novo que ainda não tenha
  versão por bloco.

## O documento como grafo

`grafoDaMusica(doc, fontes, {taxa?, cache?, duracao_s?, trecho?})` monta, na ordem do motor antigo:

```
canal:<id> (Fonte: som seco)  →  faixa:<id>/entrada (Passa, soma dos canais na ordem dos canais)
  → faixa:<id>/eq (Eq3, se alguma banda ≠ 0) → faixa:<id>/compressor (Compressor, se ligado)
  → faixa:<id>/volume_pan (0 dB se há automação) → faixa:<id>/sidechain (Ganho, curva por notas)
  → faixa:<id>/automacao (Ganho ligado a faixa:<id>/volume_db)
  ─┬→ master (soma 'zero': faixas na ordem do mixer, depois o delay e o reverb com o volume de cada um)
   ├→ retorno:delay  (Delay,    soma 'zero' dos envios × envio)
   └→ retorno:reverb (Freeverb, soma 'zero' dos envios × envio)
master → master/automacao (Ganho ligado a master/volume_db) ou master/volume → master/limitador (Limitador)
```

- Os instrumentos (bateria, sintetizador e clipes de áudio) ainda não são processadores (isso vem na I-01): o som seco de
  cada canal entra como `Fonte`. Com `cache` (a prévia), ele é feito inteiro na montagem e guardado, como antes. Sem
  `cache` (o processo, o MCP, a entrega, o hash), ele é uma fonte preguiçosa (`fontePorTrechos` sobre
  `instrumentos.ts`), feita em trechos de `trecho` amostras (32768 por padrão) só quando o executor lê.
- O ganho do sidechain por notas e a automação de volume são curvas calculadas por bloco (`curvaDoSidechain`,
  `curvaDaAutomacao`), nunca a música inteira.
- A automação de volume de hoje é um ganho linear depois do fader, como no motor antigo: o nó `automacao`. Com ela, o
  `volume_pan` fica em 0 dB e sem endereço. A automação geral (X-08) vai ligar curvas nos endereços que os parâmetros
  já levam.
- As chaves do cache são as do motor antigo (`canal:`, `faixa:`, `delay:`, `reverb:`). A prévia continua refazendo só o
  que mudou, e o teste confere que o cache termina com as mesmas chaves do motor antigo.
- Medido (este PC, Node 26, sem cache): `trilha-video` (43 s) em 1,4 s no grafo e 1,3 a 1,6 s no antigo; `batida`
  (19 s) em 0,8 s nos dois. Mexer num volume com o cache: 0,2 a 0,4 s nos dois. Com 24 faixas, a memória e o tempo
  estão em [`docs/desempenho.md`, seção 4.10](desempenho.md#410-música-memória-do-render-m-04).

## Converter um efeito em processador nativo

Os cinco efeitos de hoje (EQ, compressor, Freeverb, delay e limitador) já foram convertidos na M-04, deste jeito, e o
`testes/audio-grafo-efeitos.test.ts` compara cada um com a função de buffer inteiro de `musica-som.ts`. O roteiro fica
para o próximo efeito que nascer de buffer inteiro: escrever o mesmo efeito como `Processador`, pôr no lugar do
adaptador e provar com o oráculo que o PCM não mudou.

1. **Escreva o processador** em `src/nucleo/audio-grafo/` (um arquivo por efeito, por exemplo `eq3.ts`). Passe para
   campos o que a função guardava em variáveis locais entre amostras: os `x1 x2 y1 y2` de cada biquad por canal, o
   envelope do compressor, as linhas e índices dos pentes do Freeverb. Para o PCM sair igual, cada conta tem que ser a
   mesma, na mesma ordem e com o mesmo arredondamento:
   - Onde a função antiga guardava num `Float32Array` (o `x[i] = y0` do `filtrarNoLugar`, o `out[i] += y` dos pentes),
     guarde num `Float32Array` ou use `Math.fround`. Onde ela guardava num `number` (o `y1 = y0` do biquad, o `filtro`
     do pente, o `env` do compressor), mantenha `number`: arredondar a mais também muda o hash.
   - Mantenha a ordem das operações (`L[i] * (g * gl)` não é `L[i] * g * gl`) e a ordem das somas. Nos pentes do
     Freeverb, por exemplo, some os oito na ordem dos tamanhos, amostra a amostra, num acumulador float32.
   - Coeficientes que não mudam no tempo vão para o `preparar`. Os que mudam (EQ automatizado, X-08) são recalculados no
     `processar`, e um coeficiente constante tem que sair igual ao do motor antigo.
2. **Declare a latência** se o efeito olha para a frente. O limitador lê 1,5 ms adiante (`la = round(0,0015·taxa)`
   amostras). Por bloco, ele virou um processador causal com `latencia = la` (`limitador.ts`): guarda a entrada numa
   linha de `la + 1` amostras, calcula o pedido de cada amostra que entra e devolve a de `la` amostras atrás. O executor
   compensa e descarta o atraso, e o hash bateu. Duas armadilhas da cauda: o antigo tomava, no fim, o mínimo só do pedido
   que restava, o que é o mesmo que completar a janela com 1; e, depois do fim, o executor ainda manda ao limitador o
   que vem antes dele (a cauda do reverb), que o antigo não via. Por isso o `Limitador` recebe `fim` (as amostras da
   música) e trata como "pede 1" tudo que entra depois. O `if (!algum) return 0` sai igual sem nada especial: sem
   redução, o ganho é 1 exato. Se algum efeito não puder dar o mesmo hash (por exemplo, um compressor com lookahead
   novo), pare e leve ao dono: a M1 prevê uma tolerância só para compressor e limitador, a aprovar.
3. **Parâmetros**: declare em `parametros` os que a automação geral vai mexer (com o nome do segmento da M-02:
   `graves_db`, `limiar_db`). Ligue-os em `musica.ts` com `{endereco, valor}`, usando o endereço do `musica-param.ts`.
4. **Estado**: `estado()` devolve as linhas e envelopes em listas de números, e `restaurar()` os põe de volta. Teste a
   ida e volta: parar no meio, serializar em JSON, restaurar noutro objeto e continuar tem que dar o mesmo que rodar
   direto (veja o teste do `Atraso` em `testes/audio-grafo.test.ts`).
5. **Troque em `musica.ts`** o `new AdaptadorX(...)` pelo processador. A chave do nó (cache) não muda.
6. **Prove com o oráculo** (a seção abaixo). Se ficou igual, apague o adaptador e a função antiga continua em
   `musica-som.ts`, porque o `renderizarMusicaAntigo` a usa.

## Testar com o oráculo

- `npx vitest run testes/audio-grafo-oraculo.test.ts` compara o grafo com o `renderizarMusicaAntigo` nos seis
  documentos de referência da M0 e em variações das bordas: pan nos extremos (o lado calado é −0), solo, mudo, ids
  repetidos, áudio faltando, duração curta e longa, master acima do limitador, blocos de 1 a maior que a música e a
  prévia com cache mexendo e voltando. Confere bit a bit a mistura, cada stem de faixa, cada retorno, o `limitador_db`,
  os avisos e o `faltando`. Na falha, diz o stem e a primeira amostra diferente.
- `npx vitest run testes/musica-determinismo.test.ts` confere os hashes de referência da M0
  (`testes/fixtures/musica-referencia/hashes.json`), que agora saem do grafo. Não regrave o `hashes.json` para fazer
  um teste passar: mudar o som de um documento antigo pede aprovação do dono (A4).
- `npx vitest run testes/audio-grafo.test.ts` cobre o núcleo: ordem estável, soma com ganho, portas múltiplas
  (sidechain e multi-saída), PDC com impulso, automação amostra a amostra depois de latência, estágios, cache e estado.
- `npx vitest run testes/audio-grafo-efeitos.test.ts` compara cada efeito por bloco com a função de buffer inteiro, em
  blocos de 1 amostra a maior que o sinal e com o estado salvo em JSON no meio; o limitador, com a latência descontada.
- `npx vitest run testes/audio-memoria.test.ts` cobre a memória: fontes por trecho, instrumentos e curvas por trecho
  contra os de buffer inteiro, o tamanho do trecho que não muda o hash, o armazém, a saída bloco a bloco, o cache em
  disco (hash de referência, LRU, teto) e o WAV lido por trecho.
- Depois do `npm run mcp:build`, `node scripts/hashes-musica.mjs --sem-vitest` confere os mesmos hashes pelo MCP por
  stdio.
- Para um efeito novo (não convertido), que não tem oráculo, teste o processador isolado: impulso, resposta conhecida,
  tamanho de bloco que não muda nada, estado em JSON. Ele entra no grafo de um documento só quando o documento pedir,
  para os antigos continuarem iguais.

## Memória

O render canônico não guarda nada da música inteira além do que devolve (M-04, medido em [`docs/desempenho.md`,
seção 4.10](desempenho.md#410-música-memória-do-render-m-04)):

- **Streaming**: os efeitos rodam por bloco, os canais são lidos por trecho e as curvas são calculadas por bloco. Na
  memória ficam a mistura do master (o resultado) e, se pedidos, os stems e os retornos (`porFaixa`).
- **Carga preguiçosa** (`amostras.ts`): `FonteAmostras` é qualquer som lido por trecho: `ler(inicio, qtd, dest, off)`,
  com silêncio fora de `[0, n)`. `fonteDeMemoria` envolve buffers prontos; `fontePorTrechos({canais, n, trecho,
  fazer})` faz o som por trechos só quando alguém lê e segura no máximo dois; `abrirWav(caminho)` (Node) lê um WAV do
  disco por trecho, com os mesmos valores do `lerWav`. É a base do sampler da M2: uma amostra grande entra como fonte e
  só o trecho tocado vem para a memória. A `Fonte` aceita buffers ou uma `FonteAmostras`.
- **Instrumentos por trecho** (`instrumentos.ts`): `bateriaPorTrecho`, `sintetizadorPorTrecho` e `audioPorTrecho`
  preparam a lista de vozes, notas e clipes uma vez e somam só o trecho pedido. A ordem das somas é a das funções de
  buffer inteiro (que ficam como estão, para o motor antigo), então cada amostra sai igual em qualquer tamanho de trecho.
  Uma nota do sintetizador que cruza a borda é feita uma vez e guardada até acabar.
- **Cache em disco** (`src/nucleo/cache-audio.ts`): `CacheAudioDisco` é o `ArmazemAudio` do Node. Cada saída de nó com
  chave (as faixas processadas e os retornos) vira um arquivo `.f32` em `.estudio/cache-audio/` do projeto, com o
  SHA-256 da versão e da chave no nome: cabeçalho de 16 bytes e cada canal em float32, lido de volta em trechos de 32768
  amostras. Grava num `.tmp` e renomeia no fim (dois processos não se atrapalham; render que falhou não deixa nada). O
  teto é de 2 GB, ou `ESTUDIO_CACHE_AUDIO_MB` (0 desliga). Passou do teto, sai o arquivo usado há mais tempo (a data de
  modificação, que cada leitura renova); um item maior que metade do teto não é guardado. `VERSAO_CACHE_AUDIO` muda
  quando muda a conta de algum processador. O processo principal e o MCP por stdio usam o cache em `renderizar`, `medir`
  e `exportar` (`src/main/musica-render.ts`), e `.estudio/cache-audio/` entra no `.gitignore` do projeto com as outras
  regras da música.
- **A prévia** (worker da janela) continua com o cache em Map, de buffers inteiros por camada: o navegador não tem o
  disco do projeto, e a prévia precisa refazer só o que mudou em décimos de segundo. Levar esse cache para o OPFS fica
  para quando a memória da prévia apertar.

## EQ, compressor e limitador: parâmetros e limitador causal

Os três saem com **o mesmo PCM, bit a bit**, do motor antigo, inclusive o `limitador_db`. Nenhuma tolerância foi
precisa, e o limitador por bloco não muda o hash (conferido pelo oráculo, pelos hashes da M0 e por
`testes/audio-grafo-efeitos.test.ts`, que compara com `filtrarNoLugar`, `comprimir` e `limitarNoLugar` em blocos de 1
amostra a maiores que o sinal, sinal mais curto que o lookahead, pico na primeira e na última amostra, −0 e estado em JSON).

- **`Eq3`**: parâmetros `graves_db`, `medios_db`, `agudos_db` (`faixa:<id>/eq/<banda>_db`). Um biquad por banda e canal
  com `x1 x2 y1 y2` em `number`; a saída de cada banda é float32 e entra na banda seguinte. Banda em 0 dB fica fora do
  caminho, como antes. O coeficiente é refeito quando o valor muda; com curva de automação ele usa o valor do começo do
  bloco (a interpolação por amostra do EQ é decisão da X-08).
- **`Compressor`**: parâmetros `limiar_db`, `razao`, `ataque_ms`, `soltura_ms`, `ganho_db`. O envelope é `number` e
  atravessa os blocos. Sem lookahead: latência 0. Parâmetros com curva valem o do começo do bloco (X-08).
- **`Limitador`**: parâmetros `teto_db` e `soltura_ms`. Causal, com `latencia = max(1, round(0,0015·taxa))` (72
  amostras a 48 kHz). O pedido de cada amostra entra numa fila monotônica (mínimo da janela `[i, i + la]`, float32 como o
  motor antigo) e a entrada espera numa linha de `la` amostras. O executor desconta a latência (PDC). O limitador
  recebe `fim` (as amostras da música): o que entra depois dele (a cauda do reverb, ou o silêncio que completa a janela)
  pede 1, como no motor antigo, que completava a janela da cauda sem olhar além do fim; e a redução só conta em
  `[0, fim)`. Diferença medida contra o motor antigo: **0 dB**
  (zero amostras diferentes), então não há tolerância a aprovar pelo dono. Se uma versão futura do limitador mudar a
  conta (mais lookahead, true peak), aí sim a tolerância da M1 volta à mesa. `reducao_db` (o `limitador_db` do resultado)
  é lido do processador depois do render.

## O que ainda não é

- Os instrumentos são fontes (lidas por trecho), não processadores (I-01).
- O worklet (M-06) vai usar o mesmo `Processador`. O executor de tempo real ainda não existe.
- O WAV em streaming até o disco (M-10) tem o caminho pronto (`aoBloco`), mas quem chama o render ainda pede a mistura
  inteira: a medida de loudness e o hash leem tudo.
- O track delay manual e o PDC visível na tela são da M-07. O PDC automático do executor já existe.
