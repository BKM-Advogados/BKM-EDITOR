# Aceitação sonora da música (F-13)

O hash do PCM (`docs/musica.md`, "Determinismo") diz se o som **mudou**. Esta suíte diz **o quanto e onde**, e o roteiro
de audição diz se **soa bem**. São duas partes: a automática (vitest) e a humana (ouvido, com fone e caixa).

## Parte automática

`testes/aceitacao-som/`: cada documento de `testes/fixtures/musica-referencia/` é renderizado pelo grafo
(`renderizarMusicaGrafo`, o render canônico) e analisado por `analise.ts`:

| Medida | Como sai |
|---|---|
| Espectro médio | Welch (Hann, FFT de 16384, hop de 8192, `src/nucleo/fft.ts`), média dos canais, em 28 bandas de 1/3 de oitava de 31 Hz a 16 kHz, em dB relativo à banda mais forte |
| Loudness integrado | LUFS da BS.1770-4, pelo `Medidor` de `src/nucleo/loudness.ts` |
| Pico | pico de amostra (dBFS) e pico verdadeiro (dBTP, sobreamostragem 4×, mesmo medidor) |
| Crest factor | pico de amostra menos RMS, em dB |
| Estéreo | correlação de Pearson L/R e energia do lado (L−R) contra a do meio (L+R) |

Os valores gravados estão em `testes/aceitacao-som/valores.json`. A comparação tem tolerância (`TOLERANCIA` no teste):
banda ±1,5 dB (bandas gravadas abaixo de −70 dB só precisam continuar quietas), LUFS ±0,5 LU, picos ±0,7 dB, crest ±1 dB,
correlação ±0,05, lado/meio ±1,5 dB, duração ±50 ms. Valem sempre, sem gravados: sem NaN, pico de amostra até 0 dBFS, há som.

```bash
npx vitest run testes/aceitacao-som                                        # confere
ESTUDIO_GRAVAR_ACEITACAO=1 npx vitest run testes/aceitacao-som            # regrava valores.json
```

**Quando regravar:** só depois de uma mudança de som **decidida e ouvida** (roteiro abaixo), junto com os hashes
(`ESTUDIO_GRAVAR_HASHES=1`). Se um hash mudar mas a aceitação continuar passando, a mudança está dentro da tolerância
(é o caso previsto do limitador causal com latência). O teste avisa no console quando o hash de um documento deixou de
ser o da M0. Não regrave para "fazer passar": leia qual banda ou medida saiu e por quê.

**O que a parte automática não pega:** timbre (um som mais áspero com o mesmo espectro médio), transiente (ataque do
bumbo mole), artefato curto (clique, zipper de automação), reverb que "soa errado" com o nível certo. Isso é do roteiro.

## Roteiro de audição humana

Antes de ouvir: renderize pela janela do app (ou `medir_musica` e exportar WAV pelo MCP) a mesma versão que passou na
parte automática. Ouça em **fone fechado** e em **caixa pequena** (ou celular), em volume moderado e igual entre as
referências. Para cada documento, ouça inteiro uma vez e depois os trechos indicados. Marque: aprovado, aprovado com
ressalva (anote) ou reprovado.

Perguntas gerais, em todos: há **clique ou estalo** (início de nota, fim de clipe, emendas)? Há **distorção** fora do
limitador (som rasgado em notas altas, no reverb)? O **estéreo** está equilibrado (nada puxado para um lado sem querer)?
O **grave** está limpo (sem uma nota que "estoura" e some)? O fim da música **termina** limpo (rabo de reverb sem corte)?

| Documento | O que ouvir |
|---|---|
| `batida` (19 s, mono na prática: correlação 1) | O bumbo e o baixo em oitavas **não brigam**: o baixo abaixa quando o bumbo bate (sidechain) e volta sem "bombear" demais. Caixa e chimbal claros, sem sibilância. Acordes presentes sem cobrir a bateria. Ouça os primeiros 4 compassos várias vezes: o groove é estável? |
| `trilha-video` (43 s, baixa: cerca de −25 LUFS) | A "cama sob a voz": pad e arpejo discretos, com espaço no meio para uma voz por cima (ponha uma narração por cima e ouça se a música atrapalha a inteligibilidade). O fade por automação no master é **suave**, sem degrau nem escada. Bateria calma sem ser tímida. |
| `efeito-sonoro` (4 s) | A subida de notas é nítida e sobe de verdade (sem nota fora). O rufar tem **dinâmica** (não vira uma massa). O impacto tem corpo no grave e um ataque que não clica. O delay pingue-pongue alterna entre os lados, e o reverb dá cauda sem borrar o impacto. |
| `sidechain-automacao` (7,5 s) | Os **dois sidechains** (bumbo e caixa) se ouvem como respiração, cada um na sua faixa, sem ceifar a nota inteira. A automação nas duas faixas é contínua (sem zipper, o chiado de degrau de volume). O clipe com `inicio` entra no ponto certo. O swing de 0,35 tem balanço, não parece erro de tempo. |
| `delay-limitador` (7,6 s, 3/4) | O compasso 3/4 é sentido. O delay de colcheia pontuada com realimentação 0,7 **repete até sumir** sem crescer nem sujar. O master a +9 dB no limitador (13 dB de redução) é o teste duro: ouça a **distorção do limitador** (bombeamento, "pumping" nos transientes, grave achatado). É onde a mudança para limitador causal com latência mais pode aparecer: compare A/B com a versão anterior nesta referência e escreva o que mudou. O pan é preservado. |
| `sintetizadores-audio` (6 s, estéreo largo: correlação negativa) | Os **quatro sintetizadores** são distintos entre si, com macros nos extremos sem estourar. A correlação negativa é de propósito (clipes de ruído e pan): confira em **mono** (some o fone: soma L+R) se algo **cancela** demais. Os clipes de áudio têm os fades sem clique e o corte no lugar. Os mudos estão mudos. |

**Comparação com referência comercial (F-05, depois):** quando a mix assistida existir, ouça também uma faixa comercial
do mesmo gênero no mesmo volume. Hoje a comparação é só entre as versões das nossas referências.

## Onde se encaixa

- `docs/musica-daw.md`, F-13: a parte automática está feita; o roteiro é o critério humano de "pronto" de cada onda
  (a M2 exige "A suíte F-13 passa" e que o dono ouça e aprove).
- Depende do oráculo da M-01 (`docs/audio-grafo.md`): mudou um processador, rode `audio-grafo-oraculo` (bit a bit) e,
  se o hash mudar de propósito, esta suíte (o quanto) e depois o roteiro (se soa bem).
