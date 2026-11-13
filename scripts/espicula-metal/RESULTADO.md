# Espícula de som do metal (M0, portão da A3)

Versão 1, de 12/11/2026. Espícula fora do app, pedida na onda M0 do `docs/musica-daw.md`. Ela responde a duas
perguntas antes de investir no motor por blocos. Uma guitarra de metal soa aceitável em TypeScript puro? Quanto custa
amp 8x mais IR de 200 ms em 4 guitarras de 5 min?

**Ninguém ouviu o áudio ainda.** Tudo o que está em "soou bem/mal" vem de medida espectral. O portão da M0 pede áudio
ouvido e aprovado pelo dono: falta ouvir `saida/riff.wav`.

## Como rodar

```bash
export PATH=$HOME/.local/share/mise/installs/node/latest/bin:$PATH
npx tsx scripts/espicula-metal/verificar.ts            # conferências (FFT, convolução, sobreamostrador, mat.ts)
npx tsx scripts/espicula-metal/espicula.ts             # riff de 30 s, WAV, espectrograma, metricas.json (~15 s)
npx tsx scripts/espicula-metal/espicula.ts --portao    # 4 guitarras x 5 min, só tempo (~1 min)
npx tsx scripts/espicula-metal/espicula.ts --hash      # só os SHA-256 do PCM (para comparar motores JS)
bun scripts/espicula-metal/espicula.ts --hash          # o mesmo no JavaScriptCore
```

A saída vai para `scripts/espicula-metal/saida/`, que fica fora do git: `riff.wav` (48 kHz, 24 bits, estéreo, 30 s),
`espectrograma.png`, `metricas.json` e `portao.json`.

## O que foi feito

Tudo é TypeScript puro, sem dependência e sem nada de terceiros (nem IR, nem amostra).

| Arquivo | O que faz |
|---|---|
| `guitarra.ts` | Karplus-Strong estendido, corda por corda. Linha de atraso, perda de polo único e passa-tudo de afinação, que desconta a fase do filtro na fundamental. Excitação: triângulo da corda puxada mais ruído com semente, pente da posição da palheta. Captador de ponte (pente lido na linha) e ressonância do humbucker. Duas vozes por corda: a nota nova corta a anterior. Afinações drop B (6 cordas) e B de 7 cordas. |
| `riff.ts` | 16 compassos a 128 BPM (30 s). Chugs em palm mute sincopados (inclusive 3+3+2), galope, power chords abertos de 3 cordas. Palhetada alternada com strum na direção da mão. A dobra L/R toca a mesma partitura com micro-variações da semente: tempo (~2,5 ms mais deriva), força, cents por nota e por tomada, posição da palheta. |
| `amp.ts` | Pré-EQ "tight" (corte em 85 Hz, +6 dB em 800 Hz, passa-baixa em 6,5 kHz). Pré-amp de 3 estágios de triodo estilizado, assimétrico com bias, com acoplamento e capacitor de Miller entre os estágios, todo a 8x. Tone stack de 3 biquads. Power amp a 2x com depth, presence e saturação simétrica macia. Sobreamostrador polifásico com FIR de Kaiser de 256 taps (β 8,6, corte em 22 kHz). |
| `gabinete.ts` | IR de 4x12 **sintetizado**: cascata de biquads com a curva típica, modos da caixa, eco da parede do fundo e cauda difusa, 200 ms. Variação de "microfone" por semente, um por lado. Convolução particionada uniforme (overlap-save, linha de atraso no domínio da frequência). |
| `gate.ts` | Gate no DI, antes do amp, com histerese (−52/−60 dBFS), hold de 25 ms e rampas. |
| `cadeia.ts` | A faixa como lista de estágios `processar(bloco, n)` em blocos de 128, com latência declarada (o modelo da A2) e o tempo de cada estágio. |
| `mat.ts` | sin, cos, exp, log, pow, atan e atan2 próprios, só com + − × ÷ (ver Determinismo). |
| `fft.ts` | FFT radix-2 e FFT real pela complexa de N/2. |
| `analise.ts`, `arquivos.ts` | Espectro de Welch, bandas, centroide, aliasing, afinação, espectrograma PNG e WAV 24 bits. |
| `verificar.ts` | FFT contra DFT, convolução contra a direta, resposta do sobreamostrador, precisão da `mat.ts`. Tudo passa. |

## RTF

Máquina: notebook com Intel Core 5 120U, node 26.13.1 (V8 14.6), uma thread, blocos de 128 amostras. RTF é o tempo de
render dividido pela duração do áudio.

### Riff de 30 s, 2 guitarras, render quente

| Estágio | ms (2 guitarras) | RTF por guitarra |
|---|---:|---:|
| guitarra (KS, 6 cordas, captador) | 58 | 0,0010 |
| ruído do DI | 19 | 0,0003 |
| gate | 15 | 0,0003 |
| pré-EQ | 25 | 0,0004 |
| **pré-amp 8x** | **1.832** | **0,0305** |
| tone stack | 26 | 0,0004 |
| power amp 2x | 322 | 0,0054 |
| **gabinete (IR 200 ms, partição 128)** | **709** | **0,0118** |
| **total** | **3.030** | **0,050** |

O render frio (com o JIT esquentando) custou o mesmo: 3,03 s. O pré-amp 8x leva 60% do tempo; o gabinete, 23%. O resto
some.

### Portão da A3: 4 guitarras x 5 min, amp 8x, IR de 200 ms

- **61,0 s de parede para 300 s de áudio: RTF 0,20 no total, 0,051 por guitarra**, numa thread.
- Por estágio (4 guitarras): pré-amp 8x 37,0 s (RTF 0,123), gabinete 14,3 s (0,048), power amp 6,5 s (0,022), o resto
  3,9 s (0,013).
- Em tempo real, um bloco de 128 amostras dura 2,67 ms. As 4 guitarras gastam, em média, 0,54 ms dele (20% de um
  núcleo).

O documento pede "um alvo de RTF" sem dizer qual. **Proposta de alvo**, para o dono aprovar: no render canônico, o
cenário do portão com RTF ≤ 0,5 numa thread da máquina mais fraca suportada. Na prévia viva (M5), as 4 guitarras em
≤ 25% de um núcleo. A espícula passa nos dois com folga de 2,5x e 1,25x. A folga da prévia viva é curta, mas tem
otimização barata em TS (ver Recomendação).

### Variações (1 guitarra, 30 s)

| Variação | RTF da guitarra | Estágio que mudou | Diferença de pico para o padrão |
|---|---:|---|---:|
| padrão (pré-amp 8x, tanh racional, partição 128) | 0,050 | | |
| pré-amp a 1x | 0,022 | pré-amp 55 ms | −7,5 dB (outro som: aliasing) |
| pré-amp a 4x | 0,036 | pré-amp 484 ms | −24,9 dB |
| `Math.tanh` no lugar da tanh racional | 0,077 | pré-amp 1.725 ms (quase o dobro) | −24 dB (outra curva) |
| IR com partição de 1024 (latência de 1024) | 0,043 | gabinete 120 ms (−66%) | **idêntico bit a bit** depois de compensar a latência |

## Determinismo

- Dois renders seguidos no mesmo processo dão o mesmo SHA-256 do PCM.
- **Medido: Math.cos, Math.sin, Math.exp, Math.atan2 e Math.tanh diferem no último bit entre o V8 (node) e o
  JavaScriptCore (bun 1.4.4).** Math.pow e Math.sqrt bateram nos valores testados. Com Math.cos e Math.sin só nas
  tabelas da FFT (setup, nem no laço quente), o PCM do gabinete já mudava de hash entre os dois motores. Os estágios
  antes do gabinete batiam, por sorte dos argumentos.
- Com a `mat.ts` em todo o render, **o PCM é idêntico no V8 e no JavaScriptCore**. `L 07f07446…`, `R dbe346af…` no
  node 26.13.1, no node 26.12.0 e no bun. Com `--tanh-nativo`, os hashes voltam a divergir entre os motores.
- Os laços quentes usam só + − × ÷, comparação, `Math.abs`, `Math.imul` e `Math.round`. Os denormais são zerados no
  código ao fim de cada bloco: estado abaixo de 1e-25 vira 0.
- Não testado: o V8 do Electron (o binário não está no `node_modules` deste ambiente) e o Windows/Mac. A aritmética
  básica do IEEE-754 é a mesma; o risco era a libm, e ela saiu do caminho.

### Onde há transcendental

| Onde | Função | Quando | Fonte |
|---|---|---|---|
| biquads RBJ (`comum.ts`) | sin, cos, pow, Math.sqrt | criar o filtro | `mat.ts` |
| polo único, gate (`comum.ts`, `gate.ts`) | exp, pow | criar | `mat.ts` |
| FIR de Kaiser (`comum.ts`) | sin, Math.sqrt (I0 por série) | criar o sobreamostrador | `mat.ts` |
| tabelas da FFT (`fft.ts`) | sin, cos | criar a FFT | `mat.ts` |
| corda KS (`guitarra.ts`) | pow (T60, afinação), cos, sin, atan2, Math.sqrt | cada nota e cada abafar | `mat.ts` |
| IR sintetizado (`gabinete.ts`) | pow, cos, sin, exp | uma vez por IR | `mat.ts` |
| oscilador do zumbido (`cadeia.ts`) | cos, sin | criar; depois rotação e Math.sqrt por bloco | `mat.ts` |
| waveshaper (`amp.ts`) | nenhuma: tanh racional (Padé), erro máx. 0,024 | cada amostra a 8x | só + − × ÷ |
| waveshaper com `tanhNativo` | `Math.tanh` | cada amostra a 8x | **libm do motor**: só para medir |
| análise (`analise.ts`, `espicula.ts`) | log10, log2, cos, sin | medida, fora do render | Math |

## O que soou bem e o que soou mal (pela análise)

**Bem:**
- **Afinação:** cordas soltas a 0,0 ± 0,1 cent. O palm mute sai 0,8 a 1,6 cent agudo, como na corda real abafada. A
  compensação da fase do filtro de perda funciona até com o filtro escuro do palm mute.
- **Anti-aliasing:** um seno passado pelo amp dá aliasing de −20 dB a 1x e de −69 dB a 8x em 1031 Hz. Em 2489 Hz,
  −17 dB contra −58 dB; em 3951 Hz, −16 dB contra −52 dB. A 1x o amp é inaceitável (inarmônico audível em notas
  agudas). O 4x fica a −25 dB do 8x no riff; vale um teste de ouvido para ver se o 4x basta, porque custa metade.
- **Equilíbrio de bandas do mix** (energia relativa ao total): sub < 60 Hz −36 dB, grave −8,5, médio-grave −9,6,
  médio −3,4, presença −5,4, agudo 5-10 kHz −28, acima de 10 kHz −65. Centroide em 1,77 kHz. É a curva "médio na
  frente, médio-grave cavado, sem chiado em cima" de uma guitarra de metal microfonada num 4x12. Não tem lama abaixo
  de 60 Hz nem fizz acima de 8 kHz.
- **Gate:** sem gate, o chiado do DI (−78 dBFS) vira −41 dBFS depois do ganho. Com gate, as pausas ficam em silêncio
  digital e as paradas secas do riff aparecem no espectrograma.
- **Palm mute contra aberto:** o chug é mais escuro (centroide 1,24 kHz contra 1,55 kHz) e mais grave (−5,3 contra
  −6,6 dB no grave; −8,5 contra −6,1 dB na presença). É o sentido certo.
- **Convolução:** partição de 128 e de 1024 dão o mesmo PCM bit a bit, e a direta confere com erro de 1e-7.
- **Nível:** pico em −1 dBFS, RMS em −15,4 dBFS, fator de crista de 12,8 dB.

**Mal ou duvidoso:**
- **O palm mute quase não decai dentro da semicolcheia:** queda mediana de −2,2 dB entre a 1ª e a 2ª metade do passo,
  contra −2,0 dB no aberto. O DI decai rápido (T60 de 0,13 a 0,17 s), mas o ganho comprime o envelope. Pode faltar o
  "tchk" seco. É o primeiro ponto a ouvir. Se faltar, há 3 remédios: T60 ainda menor, um transiente da palheta na
  excitação, ou um envelope de abafamento.
- **Dobra larga demais?** A correlação L/R é 0,01: são duas tomadas independentes, com IR e microfone diferentes. Em
  mono não some nada, mas pode soar "desgrudado". Uma dobra real costuma ficar mais correlacionada no grave.
- **Grave de 40-60 Hz do gabinete** cai só ~12 dB em relação ao médio. Um 4x12 real cai mais. No mix sai −36 dB de
  sub, então não aparece, mas o IR pode apertar mais.
- **Simplificações que o ouvido pode notar:** sem rigidez da corda (inarmonicidade) nem ruído de traste ou de corda.
  O tone stack é de 3 biquads, não o modelo do circuito de Yeh, então os knobs não interagem como num amp real. Sem
  sag nem realimentação no power amp. O "triodo" é uma curva estilizada, não um modelo de válvula.
- **O IR é genérico:** a curva é de livro (ressonância em ~105 Hz, presença em 2-4 kHz, queda acima de 5 kHz), não
  medida de um gabinete. Se o ouvido reprovar, o plano B da A7 é medir IRs próprios (CC0) e não sintetizar.

## Recomendação: TS ou WASM

**TS passa o portão da A3. WASM não é preciso para a M1.**

1. **Desempenho:** o cenário do portão roda com RTF 0,20 numa thread. O render canônico (vídeo, exportação, MCP)
   sobra. O bun (JavaScriptCore) rodou o mesmo código 25% mais rápido que o V8 (RTF 0,070 contra 0,092 nas 2
   guitarras). Então o gargalo é o algoritmo, não o motor JS.
2. **Determinismo**, que era o argumento mais forte para WASM: a matemática própria resolve em TS. Os laços quentes já
   não tinham transcendental, e o setup passou a dar bits iguais no V8 e no JavaScriptCore. A regra para o motor:
   proibir `Math.sin/cos/exp/pow/tanh/atan2/log` no caminho do render canônico (uma regra de lint basta) e usar a
   `mat.ts`.
3. **Antes de pensar em WASM, há otimização barata em TS** nos dois nós quentes:
   - Pré-amp: 3 meias-bandas 2x em cascata no lugar do FIR de 256 taps a 8x. As meias-bandas têm metade dos
     coeficientes nulos e custam menos nos estágios baixos: estimo 3 a 4x menos no sobreamostrador. Rodar o filtro de
     Miller e o acoplamento a 4x também ajuda.
   - Gabinete: partição não uniforme (128 na cabeça, 1024 na cauda). A partição de 1024 sozinha já cortou 66% do
     estágio. Em offline dá para usar 1024 direto e declarar a latência (PDC, M-07).
   - Duas guitarras numa FFT complexa só (L na parte real, R na imaginária).
4. **Quando reabrir o WASM:** na M5 (prévia viva), se a medida de 24 faixas em tempo real não couber no orçamento.
   Comece pelo nó do pré-amp (o laço é pequeno e fácil de portar). Com a `mat.ts` portada igual, o hash continua
   igual entre TS e WASM. NAM em WASM continua sendo o plano B de **timbre**, não de desempenho.
5. Para a M3 (X-03 e X-04): o pré-amp, o sobreamostrador, o gate e a convolução já têm a forma
   `processar(bloco, n)` com estado e latência declarada. Viram processadores da A2 quase sem mudança.

## Limites desta medida

- Uma máquina só (notebook de baixo consumo), uma thread, node 26. Falta medir no Windows e no Mac e no V8 do Electron.
- A RAM não foi medida. O render guarda o PCM inteiro de cada faixa em Float32 (57 MB por faixa de 5 min); o motor da
  M1 não deve fazer isso (M-04).
- Só guitarra: sem baixo, bateria nem master. O julgamento de mix fica para a M4.
