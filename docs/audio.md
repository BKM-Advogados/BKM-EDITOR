# Som no vídeo de cenas

Versão 1, de 06/11/2026 (grupo 1 da Ordem sugerida: sessão multipista, trilha com volume e fades por clipe, ducking
automático da música sob a voz e a pasta de trilhas). Vale para o documento `"tipo": "cenas"`; o carrossel narrado da Cliente
continua com a narração em trechos e os efeitos sonoros do resolvedor de roteiro.

## O formato

`audio` é opcional no documento de cenas. Sem ele, o vídeo é mudo e continua válido.

```json
"audio": {
  "faixas": [
    {"id": "narracao", "nome": "Narração", "papel": "voz", "volume": 1,
     "clipes": [{"id": "clipe-1", "arquivo": "midia/narracao.wav", "em": 500, "duracao_ms": 11500}]},
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

`scripts/exportar-teste.mjs` (`npx tsx scripts/exportar-teste.mjs`) monta um projeto com narração e música sintéticas,
mede os envelopes, renderiza e confere com `getVideoMetadata` que o MP4 tem faixa de áudio. Saída em
`testes/saida/exportar-teste/`.

## Na tela

- **Linha do tempo:** abaixo das cenas e dos blocos, uma linha verde por faixa, com o nome e o mudo presos à esquerda.
  O clipe é uma barra com a forma de onda; arrastar move no tempo, a alça da esquerda apara o começo (muda `corte_ms`,
  o fim fica no lugar), a da direita apara o fim. Clicar seleciona; duplo clique leva a cabeça ao começo do clipe.
  Delete exclui e Ctrl+D duplica o clipe ou a faixa selecionada.
- **"+ Áudio"** na barra da linha do tempo: Narração…, Música…, Efeito sonoro… (o diálogo copia o arquivo para
  `midia/`, mede e cria o clipe; a narração e o efeito entram no tempo atual, a música entra no zero até o fim do vídeo
  com fade de saída de 1,5 s) e Música da biblioteca… (a pasta de trilhas).
- **Inspector:** faixa (nome, papel, volume, mudo e, na música, o ducking com o que foi medido) e clipe (arquivo,
  trocar arquivo, nome, começa em, duração, corte, volume, fades, mudo e a redução sob a voz).

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
- `src/main/ipc-audio.ts`: grava o envelope, lista a pasta de trilhas, importa trilha; `lerEnvelopes` para as props.
- `src/renderer/modulos/video/`: `envelope.ts` (mede com Web Audio), `acoes-audio.ts` (patches), `FaixasAudio.tsx`
  (linha do tempo), `BibliotecaTrilhas.tsx`, e as partes de áudio em `LinhaDoTempo.tsx` e `InspectorCenas.tsx`.
- `testes/audio.test.ts`; `scripts/audio-sintetico.ts` (WAV de teste da prévia web e do script de exportação).
