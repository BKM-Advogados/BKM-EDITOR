# Música

Versão 1, de 08/11/2026 (rodada 3, frente Música, onda 1: marcos A e B do plano
`tasks/estudio-musica-2026-11-07/fork/00-plano.md`). Versão 2, do mesmo dia: o som num Web Worker, a ponte com a janela,
os sintetizadores da casa, tom, escala, acordes e o baixo, o arpejo e os acordes gerados (itens 14, 18 e 19). Versão
3: o piano roll com mouse, carimbo e teclado (item 17), o medidor ao vivo, a variação de padrão (16), repetir e seções
(20). Versão 4: o mixer completo, com delay, dois retornos, presets e limitador (item 21), a música em arquivo (23), o
encaixe no vídeo com o monitor do vídeo dentro da Música (25) e o MIDI (26). Versão 5, que fecha a onda 1: sidechain e
automação de volume por pontos (22), licenças, créditos e comprovante (24) e os modelos Batida, Trilha para vídeo e
Efeito sonoro (27), só com som gerado. Versão 6, de 10/11/2026 (retomada: a Música usada de verdade no app, no Electron do Linux): o
roteiro abaixo rodou no app, os defeitos achados foram corrigidos (medidores, transporte, ida e volta da IA, exportar) e
entraram a automação desenhada no arranjo e o "pintar" clipes; a seção "Verificado no app" tem as medidas. A música é uma vista do mesmo projeto: um documento
`musica/<id>.json` que a pessoa e a IA editam pelo mesmo JSON Patch com diário, ligado a um clipe de áudio do vídeo de
cenas. A ida e volta entre o vídeo e a Música é a primeira coisa que funciona, e o clipe do vídeo acompanha cada mudança
da música sem exportar arquivo.

## Como se chega e como se volta

| De onde | Gesto | O que acontece |
|---|---|---|
| Vídeo, clipe de música ou de efeito selecionado | Inspetor › Música › **Editar em Música** | Abre a Música com aquele áudio num canal e o clipe selecionado. Se o clipe já toca uma música, abre a dela. |
| Vídeo, faixa de música ou de efeitos selecionada | Inspetor › Música › **Criar em Música** | Abre uma música nova com uma bateria pronta: na faixa de música, do ponto da cabeça ao fim do vídeo; na de efeitos, 2 s. |
| Qualquer área | **5** ou **Alt+5** | Vai à Música sem transição (a música ativa). |
| Música, transição aberta | Faixa no topo › **Concluir e voltar** | Volta ao vídeo, com o mesmo clipe selecionado e a cabeça onde estava; o clipe passa a tocar a música. |
| Música, transição aberta | Faixa no topo › **Cancelar** | Volta sem mudar o vídeo. **Cancelar e desfazer o que fiz na música** desfaz também as mudanças feitas na Música durante a transição. |
| Outra área com transição aberta | Faixa no topo › **Voltar à Música** ou **Concluir** | Trocar de área no meio não fecha a transição. |
| Música, sem transição | Inspetor (sem seleção) › **Pôr no vídeo** | Cria no vídeo um clipe ligado à música, na faixa de música, no começo dela no vídeo. |
| Vídeo, clipe ligado | Inspetor › Música › **Abrir na Música** / **Voltar ao original** | Abre a música do clipe; ou o clipe volta ao áudio de antes e deixa de seguir a música (o documento fica). |

A IA faz o mesmo pelas ferramentas `levar_para`, `concluir_transicao` e `cancelar_transicao`, e a tela segue: quando
uma transição abre ou fecha por fora (IA no painel, no terminal ou outro app pelo MCP), a área troca sozinha e o rodapé
avisa. O painel do Claude é o mesmo das outras áreas. A seleção da Música é guardada à parte da do vídeo: ir e voltar
não perde nenhuma das duas.

**Teclas na Música:** Espaço toca e pausa, S divide o clipe selecionado na cabeça, Delete apaga, L repete o clipe
selecionado (ou a música inteira), Home volta ao começo, Ctrl+Z desfaz a última edição da pessoa. No arranjo, Ctrl +
roda do mouse muda o zoom e Alt ao arrastar solta da grade.

**Piano roll** (canal de sintetizador, aba Passos): arrastar no vazio desenha a nota (o comprimento segue o mouse; um
clique usa o último comprimento); arrastar a nota move no tempo e na altura; a borda direita estica; duplo clique ou
botão direito apaga. Com notas selecionadas (clique, Shift+clique, Ctrl+A): ↑↓ transpõem (Shift: oitava), ←→ andam um
passo, Delete apaga, Ctrl+D duplica, Q quantiza, Esc tira a seleção; essas teclas são do piano roll enquanto há seleção
(o arranjo cede). **Carimbo:** com ele ligado, o clique põe o acorde inteiro (maior, menor, 7, 7M, m7, sus4, sus2,
dim, add9) com a fundamental na altura clicada. **Teclado:** A W S E D F T G Y H U J K tocam do Dó ao Dó, Z e X mudam a
oitava; com **Gravar**, cada tecla escreve a nota no cursor (amarelo) e anda um passo, e um clique na grade muda o
cursor. A grade vai do Dó1 ao Dó7, rola até as notas do padrão ao abrir e mostra apagadas as notas fora da escala.

**Mixer:** cada faixa e o master têm um medidor ao vivo (o pico a cada 50 ms, depois do volume e do pan, medido pelo
worker no mesmo render que se ouve), de −48 a 0 dBFS, em laranja acima de −3.

**Arranjo:** no inspetor do clipe, Repetir e Repetir 3× põem cópias logo depois (o padrão continua de onde parou). No
inspetor da música, Seções lista e renomeia as seções e "Seção na cabeça" cria uma de quatro compassos; no arranjo, a
faixa de seções fica acima da de acordes, e arrastar uma seção a move com os clipes que começam nela (em compassos
inteiros). Em Passos, "Variação" cria uma cópia do padrão com mudanças pequenas pela semente.

**Pintar clipes:** arrastar no vazio da linha de um canal de bateria ou de sintetizador põe um clipe do padrão em
compassos inteiros (o do clipe selecionado ou, sem seleção, o último usado no canal; para na frente do próximo clipe). Um
clique no vazio continua só tirando a seleção. Canal sem padrão avisa para criar um em Passos.

**Automação desenhada:** no pé do arranjo, a linha **Volume** (aberta pela seta) mostra a curva do master ou da faixa
escolhida. Clicar no vazio põe um ponto (1/4 de batida; Alt, livre; o primeiro ponto longe do começo leva um parceiro no
começo, no volume do fader: um clique no fim já faz um fade); arrastar o ponto muda o instante e o volume; duplo clique ou
botão direito tira. A lista do inspetor continua valendo. **Zoom:** os botões de lupa na régua (ou Ctrl + roda do mouse);
os clipes de áudio mostram a forma de onda do arquivo.

**Mixer completo** (item 21): cada faixa manda para dois retornos, o reverb e o delay (o "Delay" na tira e no inspetor
da faixa). No inspetor da música, a seção **Delay (retorno 2)** tem o tempo em figura (preso ao BPM), as repetições, o
brilho, o pingue-pongue e o volume; a seção **Master** liga o **Limitador** e o teto (a tira do master mostra quanto ele
tirou dos picos no último render). No inspetor da faixa, **Preset** escreve EQ, compressor e envios de uma vez (Limpo,
Bateria, Baixo, Pad, Lead, Cama sob a voz, Voz), sem mexer em volume e pan.

**Exportar** (item 23): o botão **Exportar** do transporte (WAV, WAV com stems, M4A, Opus ou MIDI), o **Exportar** da
barra do topo e Ctrl+Shift+E (WAV), ou a seção **Exportar** do inspetor da música (formato, stems): WAV de 24 bits, M4A ou
Opus, no alvo de loudness do documento (padrão −14 LUFS, pico até −1 dBTP), com **Stems** (um WAV por faixa e por retorno)
ou MIDI. Grava em `saidas/<título>.<formato>` (o título sem a extensão do áudio de onde veio) e os stems em
`saidas/<título> - stems/`. Como o vídeo e as legendas, nunca por cima: com o nome tomado, sai `<título> (2)` (o
comprovante e os stems com o mesmo sufixo). O rodapé diz o arquivo e o loudness medido; os avisos de licença vêm antes dele.

**MIDI** (item 26): "+ MIDI…" na lista importa um .mid (um canal por trilha, com o padrão e o clipe); o MIDI da música sai
pelo Exportar.

**Encaixe no vídeo** (item 25): com a música ligada a um vídeo (o "Pôr no vídeo" liga a música sem vídeo ao vídeo
dela), a seção **Vídeo** tem **Fechar no fim do vídeo** (compassos inteiros até o último quadro), **Seções nas cenas**
(uma seção por cena, no compasso de cada corte) e **Encaixar tudo**; com **Viradas**, a bateria abre dois tempos antes de
cada corte para uma virada e põe um prato nele. O ícone da claquete no transporte mostra o quadro do vídeo na posição da
cabeça, sem som, ao lado dos passos e do mixer.

**Sidechain e automação** (item 22): no inspetor da faixa, **Sidechain** escolhe o canal que abaixa a faixa ("Abaixa
com"), a peça (bumbo, por padrão), quanto e em quanto tempo volta. **Automação de volume** (na faixa e, no inspetor da
música, no master) põe pontos com **Ponto na cabeça** e muda o dB de cada um; a curva aparece em cima, com a cabeça (e,
desenhada com pontos que se arrastam, na linha **Volume** do arranjo). Enquanto houver pontos, eles valem no lugar do fader.

**Licenças e créditos** (item 24): no inspetor de um clipe de áudio, **Licença do áudio** diz de onde ele vem (própria,
CC0, MIT, CC BY 4.0, uso próprio declarado ou não informada); para CC BY, título, autor, endereço e o crédito exigido, e
o campo "Sai assim" mostra a linha de crédito. No inspetor da música, **Licenças e créditos** lista cada som com a
classe e diz se pode publicar. A exportação grava o comprovante e, se algum som pede, o arquivo de créditos.

**Modelos** (item 27): sem música no projeto, o monitor mostra cartões com **Batida**, **Trilha para vídeo** e **Efeito
sonoro** (cada um com o que traz) e a **Música vazia**. No vídeo, o **Criar em Música** de uma faixa de música abre a Trilha para vídeo do tamanho
do que falta do vídeo, e o de uma faixa de efeitos abre o Efeito sonoro; **Vazia** abre a bateria vazia de antes.

## O contrato da transição

É o da seção 4 de `estudio-ia-provedores-2026-11-07/05-ferramentas-novas.md`, com os seis ajustes do plano, todos
aditivos (`src/nucleo/transicoes.ts`):

1. O registro guarda o alvo por id: `/audio/faixas/@musica/clipes/@clipe-2` (posições também valem no pedido).
2. `levar_para` aceita `tempo: {em_ms?, dur_ms?}` para o "criar".
3. `levar_para` devolve `{transicao, destino: {documento, selecao}, criado}`.
4. Toda entrada do diário feita no destino durante a transição leva `transicao: <id>`; `concluir_transicao` devolve
   as `seqs` (é o que agrupa no Histórico e o que o "desfazer" do cancelar usa).
5. `cancelar_transicao` aceita `descartar: true`.
6. `concluir_transicao.resultado` aceita `documento` de música sem `midia`; transição aberta a partir do destino de
   outra vira pilha (`pai`).

O registro fica em `.estudio/transicoes.json`, fora do git (a primeira transição põe a linha no `.gitignore`), com as
abertas e as 60 últimas fechadas. Hoje o único destino é a Música, vinda de um clipe ou de uma faixa de áudio do vídeo
de cenas. As outras frentes usam o mesmo registro e as mesmas três ferramentas quando tiverem destino (a mídia, por
exemplo): o destino novo entra como um caso em `levarPara` e em `concluirTransicao`.

A voz não vai à Música (decisão D6 A): a limpeza, o medidor e as legendas leem o arquivo dela no vídeo. Na Música ela
toca como guia, fora da música.

## O documento

```json
{
  "formato": 1, "tipo": "musica", "titulo": "Cama do vídeo de férias",
  "bpm": 120, "compasso": [4, 4], "tom": "C", "escala": "maior", "swing": 0, "semente": 1,
  "canais": [
    {"id": "audio", "nome": "Cama", "tipo": "audio", "faixa_mixer": "audio"},
    {"id": "bateria", "nome": "Bateria", "tipo": "bateria", "faixa_mixer": "bateria", "kit": "eletronico",
     "pecas": {"bumbo": {"volume_db": -2}, "chimbal_fechado": {"afinacao": 2}}}
  ],
  "padroes": [{"id": "p1", "nome": "Básico", "canal": "bateria", "dur": 4, "passos": 16,
               "notas": [{"peca": "bumbo", "em": 0, "forca": 110}, {"peca": "caixa", "em": 1}]}],
  "arranjo": {"clipes": [
    {"id": "c1", "canal": "audio", "em": 0, "dur": 24, "audio": "midia/cama.mp3", "corte_s": 4, "ganho_db": -3,
     "fade_out": 2, "origem": {"documento": "video", "clipe": "clipe-2"}},
    {"id": "c2", "canal": "bateria", "em": 0, "dur": 16, "padrao": "p1"}
  ]},
  "mixer": {"faixas": [
    {"id": "audio", "volume_db": 0, "pan": 0},
    {"id": "bateria", "volume_db": -4, "pan": 0, "eq": {"graves_db": 2, "agudos_db": -3},
     "compressor": {"ativo": true, "limiar_db": -18, "razao": 3}, "reverb": 0.2}
  ], "master": {"volume_db": 0, "reverb": {"tamanho": 0.6, "amortecimento": 0.4, "volume_db": 0}}},
  "video": {"documento": "video", "em_ms": 3000, "voz_guia": true}
}
```

- **Tempo em batidas** (a semínima), decimais, a partir do começo; por dentro, arredondado a 1/960. `em_s` e `dur_s` saem
  do BPM. O corte de um áudio (`corte_s`) é em segundos do arquivo. Fades de clipe em batidas.
- **Canal** `audio` (clipes com `audio`), `bateria` (clipes com `padrao`, tocados pelo `kit`) ou `sintetizador` (clipes
  com `padrao` de notas MIDI, tocados pelo `preset`: `baixo`, `pad`, `pluck` ou `lead`, com `macros` de 0 a 1: `brilho`
  abre o filtro, `ataque` deixa a entrada mais lenta, `soltura` alonga a cauda, `cor` mistura e desafina os
  osciladores). Cada canal sai na faixa do mixer `faixa_mixer` (padrão: o próprio id); faixa que falta no mixer vale 0
  dB no centro.
- **Padrão**: notas com `peca` (bateria: `bumbo`, `caixa`, `palma`, `aro`, `chimbal_fechado`, `chimbal_aberto`, `prato`,
  `tom_grave`, `tom_agudo`, `shaker`) ou `nota` (MIDI, para os instrumentos da onda 2), `em` dentro do padrão, `dur` e
  `forca` (1 a 127, padrão 100). Notas não têm id: acham-se pelo padrão, pelo tempo e pela peça. O clipe repete o padrão
  até encher `dur`; `inicio` diz em que batida do padrão o clipe começa (dividir um clipe mantém o compasso).
- **Peças do canal**: `volume_db`, `pan`, `afinacao` (semitons) e `grupo` (peças do mesmo grupo se calam: os dois
  chimbais vêm no grupo 1).
- **Mixer**: por faixa, `volume_db`, `pan` (−1 a 1), `mudo`, `solo`, `eq` (graves 200 Hz, médios 1 kHz, agudos 5 kHz,
  de −18 a +18 dB), `compressor`, `reverb` e `delay` (quanto vai a cada retorno, de 0 a 1, depois do volume) e
  `atraso_ms` (o track delay, de −500 a +500 ms; negativo adianta a faixa, ver [`docs/audio-grafo.md`](audio-grafo.md)).
  Havendo solo, só toca o que tem solo (por canal e por faixa).
- **Master**: `volume_db`; `reverb` (`tamanho`, `amortecimento`, `volume_db`); `delay` (`tempo`: `1/16`, `1/8`, `1/8.`,
  `1/4`, `1/4.` ou `1/2`, a figura em semínimas; `realimentacao` de 0 a 0,9; `brilho` de 0 a 1; `pingue_pongue`;
  `volume_db`); `limitador` (`ativo`, `teto_db` de −12 a 0, `soltura_ms`). Sem o campo, o limitador fica desligado (o
  documento antigo soa igual); a música nova nasce com ele ligado em −1 dB.
- **`alvo_lufs`** e **`pico_dbtp`**: o alvo da música em arquivo (padrão −14 LUFS e −1 dBTP).
- **`sidechain`** na faixa do mixer: `{de, peca?, quanto_db?, ataque_ms?, soltura_ms?}`; `de` é o id de um canal de
  bateria (dispara nas notas da `peca`, padrão `bumbo`) ou de sintetizador (todas as notas); `quanto_db` de 0 a 24
  (padrão 6), `ataque_ms` 0 a 50 (5), `soltura_ms` 20 a 2000 (180). Dispara pelas notas: o bumbo mudo também dispara.
- **`automacoes`**: `[{alvo, parametro?: "volume", pontos: [{em, db}]}]`, `alvo` = id da faixa ou `"master"`, `em` em
  batidas. Reta em dB entre os pontos; antes do primeiro e depois do último, o valor deles. Toma o lugar do fader.
- **`licencas`**: `[{arquivo | kit, licenca, titulo?, autor?, link?, credito?}]`, a licença dos áudios de fora (por
  arquivo) e dos kits importados (por kit). `licenca`: `proprio`, `CC0-1.0`, `MIT`, `CC-BY-4.0`, `uso_proprio` ou
  `nao_sei`. Áudio sem entrada vale `nao_sei`.
- **`swing`** de 0 (reto) a 1 (tercina): atrasa as semicolcheias do contratempo até 1/12 de batida.
- **`tom`** (`C`, `F#`, `Bb`…) e **`escala`** (`maior` ou `menor`) dão a escala que a grade de notas destaca e que o
  `na_escala` usa. **`acordes`**: a faixa de acordes, `[{em, dur, acorde}]` em batidas, cada um por grau no tom (`I`, `vi`,
  `V7`, `ii7`, `bVII`, `vii°`) ou por cifra (`Am7`, `F/C`, `Bb`, `Gsus4`). Uma nota de sintetizador sem `dur` dura um passo
  da grade do padrão.
- **`semente`**: o ruído das peças sintetizadas sai dela; a mesma semente dá o mesmo som em qualquer PC.
- **`secoes`**: marcas do arranjo, `[{id, nome, em, dur}]` em batidas (Intro, Refrão…); mover uma seção leva os clipes
  que começam nela.
- **`video`**: o vídeo de que a música é trilha, onde ela começa nele (`em_ms`) e se a voz dele toca como guia. Os cortes
  das cenas não ficam gravados: o arranjo e o `ler_musica` os tiram do vídeo na hora.
- Não há `render` nem `creditos` no documento: o app calcula e grava ao lado do render.
- Fora do lugar vira aviso, nunca erro: canal, padrão ou áudio que faltam deixam o clipe calado; números fora da faixa
  voltam para dentro.

**Esquema versionado** (M-02, `src/nucleo/musica-migrar.ts`): o `formato` diz a versão do documento (hoje 1; sem o campo,
ou com um valor que não é inteiro, vale 0). Cada mudança de esquema entra como um migrador puro de um formato para o
seguinte, na lista `MIGRADORES`; `migrarMusica` encadeia os que faltam até o formato atual. Regras:

- O migrador nunca muda o som: o documento migrado renderiza o mesmo PCM que o original (os testes comparam o SHA-256).
- Cada migrador é idempotente, e `migrarMusica` não toca no documento recebido (devolve o mesmo objeto quando nada muda).
- Documento de formato mais novo que o do app fica como está, com aviso.
- `patchDaMigracao` dá o JSON Patch da migração, para gravar pelo `aplicar_patch` com diário. Ainda ninguém chama a
  migração ao abrir: o único migrador de hoje (0 → 1) só escreve o `formato`, e o motor já lê os dois iguais.

**Endereço de parâmetro** (M-02, `src/nucleo/musica-param.ts`): um nome estável para cada botão da música, o mesmo para
a automação geral, o MIDI learn, o MCP e a tela. É o alvo e os segmentos, separados por `/`:

| Alvo | Exemplos |
|---|---|
| `faixa:<id>` (faixa do mixer) | `faixa:bateria/volume_db`, `faixa:bateria/atraso_ms`, `faixa:bateria/eq/graves_db`, `faixa:bateria/compressor/razao`, `faixa:bateria/envio/reverb`, `faixa:baixo/sidechain/quanto_db` |
| `canal:<id>` | `canal:lead/macro/brilho`, `canal:bateria/peca:caixa/afinacao`, `canal:bateria/mudo` |
| `master` | `master/volume_db`, `master/reverb/tamanho`, `master/delay/tempo`, `master/limitador/teto_db` |
| `musica` (o documento) | `musica/bpm`, `musica/swing` |

- Um segmento é `nome` ou `nome:chave`. No id e na chave, `%`, `/` e `:` vão como `%25`, `%2F` e `%3A`.
- O endereço usa ids, nunca posições: mover a faixa no mixer muda o caminho JSON, não o endereço.
- `faixa:<id>/efeito:<slot>/<param>` já se lê e se escreve, mas só resolve quando houver inserts (X-01).
- `lerEndereco` e `escreverEndereco` fazem a ida e a volta do texto.
- `resolverParametro` dá o JSON Pointer do campo e o que falta criar. Cria a faixa que só existe pelo canal e os objetos
  pais. O sidechain não nasce sem o canal que dispara.
- `lerParametro` dá o valor efetivo (como o motor usa), o gravado e se o campo está no documento.
- `patchDoParametro` dá o JSON Patch: número fora da faixa volta para dentro com aviso, tipo errado é erro.
- `paraNormalizado` e `deNormalizado` levam a 0..1 e de volta (log nos tempos e na razão), para o MIDI learn.
- `enderecosDoDocumento` lista o que um documento tem; `enderecoDaAutomacao` liga a automação de volume de hoje ao
  endereço dela.

A tabela `PARAMETROS` diz de cada parâmetro o tipo, a faixa, o padrão, a unidade, a curva e se é automatizável. Os
padrões e as faixas são os do `resolverMusica`, e um teste confere um contra o outro. Nas peças do kit, a faixa é a da
tela e do MCP: o motor não traz o valor de volta para dentro.

**No vídeo** (`src/nucleo/audio.ts`): o `ClipeAudio` ganha `musica` (id do documento) e `musica_original`
(`{arquivo, corte_ms?, duracao_ms}`, o áudio de antes do "Editar em Música"). `arquivo` aponta o render; o volume, os
fades e o ducking do clipe continuam valendo, porque para o vídeo é um clipe como outro qualquer.

## O som

`src/nucleo/musica-som.ts`, em TypeScript puro: o kit eletrônico sintetizado (seno com queda de afinação, ruído filtrado
e quadradas desafinadas, sem arquivo nem licença de terceiros), os clipes de áudio com corte, ganho e fades, o mixer
(filtros do Audio EQ Cookbook, compressor de alimentação direta, pan de potência igual) e o reverb Freeverb (Jezar,
domínio público) no master. A mesma conta roda na janela, num Web Worker (o Web Audio só decodifica a 48 kHz e toca o
resultado), no render que vai para o vídeo e no MCP por stdio, então a prévia e o render saem iguais amostra por amostra.

**Por que um motor próprio e não o Tone.js** (decisão da frente, dentro da D1: só Web Audio, sem módulo nativo nem VST).
A D1 foi revista em 12/11/2026 em duas camadas ([A1](adr/A1-d1-em-duas-camadas.md)): o render canônico (vídeo,
exportação, MCP) continua só TypeScript/WASM, e código nativo só entra na periferia, em processo separado, com a saída
congelada em WAV; isso só chega na onda M8. As outras decisões do roadmap (`docs/musica-daw.md`) estão em
[`docs/adr/`](adr/README.md). Os motivos abaixo seguem valendo:
- O Tone.js toca no Web Audio da janela e renderiza com o `OfflineAudioContext`, que só existe no navegador. O MCP por
  stdio (outro app de IA, sem a janela do Estúdio) e o processo principal não teriam como fazer o render para o vídeo; a
  ligação viva dependeria da janela aberta.
- Um renderizador puro roda igual no vitest: os testes medem o som (tempo de cada batida, swing, grupo de corte, ganho em
  dB, divisão de clipe sem mudar nada) e comparam o render da janela com o do processo byte a byte.
- O mesmo código na prévia e no render garante que se ouve o que vai para o vídeo; com dois motores (Tone.js na prévia e
  outro no render) isso viraria teste de semelhança.
- Nenhuma dependência nova no instalador. O que o Tone.js traz e falta aqui (sintetizadores prontos, agendador de tempo
  real) entra pelos itens do plano, escrito na mesma conta.

**Grafo de processadores** (M-01, [A2](adr/A2-motor-em-grafo-por-bloco.md)): o render (`renderizarMusica`) monta o
documento como um grafo (canais → faixas → retornos → master → limitador) e o roda em blocos de 128 amostras, com soma em
ordem fixa, PDC e parâmetros pelo endereço da M-02 (`src/nucleo/audio-grafo/`, ver [`docs/audio-grafo.md`](audio-grafo.md)).
O EQ, o compressor, o Freeverb, o delay e o limitador são processadores por bloco (o limitador com 1,5 ms de latência
compensada), e os instrumentos entram como o som seco de cada canal. O PCM é o mesmo do motor antigo bit a bit: ele
continua em `musica-som.ts` (`renderizarMusicaAntigo`) só como oráculo de `testes/audio-grafo-oraculo.test.ts`.

**Memória do render** (M-04): fora da prévia, o render não guarda o som da música inteira por canal nem por faixa. Cada
canal é feito por trechos enquanto o grafo lê, e na memória ficam só a mistura e, se pedidos, os stems: 24 faixas de
5 min passaram de 5,9 GB no motor antigo (8 GB no grafo da M-01) para 290 MB ([`docs/desempenho.md`, seção
4.10](desempenho.md#410-música-memória-do-render-m-04)). No processo principal e no MCP por stdio, cada faixa
processada e cada retorno ficam num **cache em disco** em `.estudio/cache-audio/` do projeto (fora do git, teto de 2 GB,
LRU; `ESTUDIO_CACHE_AUDIO_MB` muda o teto e 0 desliga): renderizar, medir ou exportar de novo depois de mexer numa faixa
refaz só ela. Detalhes em [`docs/audio-grafo.md`, seção Memória](audio-grafo.md#memória).

**Fora da thread da interface.** Na janela, o som é feito no Web Worker `src/renderer/modulos/musica/render.worker.ts`,
que guarda os áudios decodificados e o cache por camada. O render que vai para o vídeo também sai dele: o processo
principal pede pela ponte com a janela (`src/main/ponte-janela.ts`, os canais `estudio:mcp-pedido` e
`estudio:mcp-resposta` da seção 0.1 do 05), mandando o documento que leu, e só grava o WAV, a medida e o envelope que
voltam. Como a prévia já fez a mesma conta, o render para o vídeo costuma sair do cache. Sem janela (MCP por stdio,
janela fechada) ou sem resposta em 2 minutos, a conta é feita no processo, como antes. A medida ao lado do render diz quem
fez (`feito_por`: `janela` ou `processo`).

**Sintetizadores da casa** (item 14): dois osciladores com PolyBLEP (serra e quadrada sem o serrilhado do ingênuo), um
sub em seno no baixo, filtro passa-baixas com envelope próprio e o envelope de volume (ataque, queda, sustentação,
soltura); vibrato só no lead. As quatro predefinições são receitas desses números, e as macros mexem neles. Sem amostra
e sem aleatório: a mesma nota soa igual em qualquer PC.

**Tom e acordes** (itens 18 e 19, `src/nucleo/musica-teoria.ts`): a faixa de acordes vem de uma progressão
(`aplicar_progressao`, ou o campo "Acordes" do inspetor da música, um acorde por compasso), e dela saem padrões prontos:
o **baixo** (`longo`, um por acorde; `batidas`, a fundamental em cada tempo; `oitavas`, fundamental e oitava em
colcheias), o **arpejo** (`sobe`, `desce`, `sobe_desce`, em colcheias) e os **acordes** (`longo` ou `batidas`, vozes em
volta do Ré4). As notas ficam escritas no padrão ("fixar como notas" é o padrão): mudar os acordes depois não mexe nelas.
O baixo nasce num canal de sintetizador com o som "baixo", o arpejo no "pluck" e os acordes no "pad".

O cache guarda três camadas (o som seco de cada canal, cada faixa processada e o retorno do reverb) e, a cada render,
só o que aquele render usou. **Medido** (este PC, com as oito frentes rodando; 60 s, dois canais de bateria e um de
áudio, EQ, compressor e reverb): 1,1 s a frio; volume de uma faixa sem reverb, 0,16 s; de uma faixa com reverb, 0,8 s;
uma nota nova, 1,0 s. Memória do processo no teste: 414 MB.

**Delay e limitador** (item 21): o delay é estéreo, com realimentação e um passa-baixas de um polo no laço (brilho 0 =
1,5 kHz, 1 = 12 kHz: cada repetição mais escura); no pingue-pongue a entrada começa à esquerda e cada volta troca de lado.
O retorno entra no cache como o do reverb. O limitador fica no fim do master: o ganho desce 1,5 ms antes do pico, numa
rampa (média do mínimo pedido na janela), e volta na soltura; cada ponto da rampa já é menor ou igual ao que o pico
pede, então nada passa do teto de amostra (o teste mede).

**A música em arquivo** (item 23, `src/nucleo/musica-entrega.ts`): a mistura é medida (BS.1770, o mesmo medidor do vídeo,
com o pico verdadeiro por sobreamostragem 4×), recebe o ganho que leva ao alvo e passa por um limitador com teto de
amostra 0,3 dB abaixo do pico pedido, que desce até o pico verdadeiro caber; até cinco voltas, compensando o que o
limitador tira do integrado. Para M4A e Opus o teto fica 0,5 dB mais baixo (o codificador sobe o pico). Os stems levam o
mesmo ganho, sem o limitador: somados, dão a mistura antes dele. A conta é feita no worker da janela (pela ponte) ou, sem
janela, no processo; o processo principal só grava o WAV de 24 bits e chama o ffmpeg do Remotion para o M4A (AAC 256
kb/s, contêiner mp4, porque esse ffmpeg não tem o `ipod`) e o Opus (192 kb/s), e mede o arquivo codificado com o
`loudnorm`. **Medido** no teste: WAV em −14,0 ± 0,3 LUFS e até −1 dBTP; M4A e Opus a menos de 1 LU do alvo e até −0,5 dBTP.

**MIDI** (item 26, `src/nucleo/midi.ts` e `musica-midi.ts`, sem biblioteca): lê os formatos 0 e 1 (running status,
nota-ligada com força 0, tempo, compasso, nome da trilha, programa e marcadores; SMPTE não) e grava o formato 1 a 960
PPQ, a resolução de dentro. Exportar leva o arranjo como se ouve (com swing), uma trilha por canal de bateria ou de
sintetizador, a bateria no canal 10 pelo mapa General MIDI (bumbo 36, aro 37, caixa 38, palma 39, chimbal fechado 42, tom
grave 45, chimbal aberto 46, prato 49, tom agudo 50, shaker 82), os sintetizadores com o programa do som (baixo 38, pad
89, pluck 46, lead 81, contando de 0) e as seções como marcadores. Importar cria um canal por trilha com notas (canal 10
= bateria; o resto, sintetizador pelo nome da trilha ou pelo programa), um padrão com as notas em batidas (até 4.096) e
um clipe em `em`; numa música sem clipes, o BPM e o compasso vêm do arquivo, e os marcadores viram seções.

**Sidechain e automação** (item 22): o sidechain dispara pelas notas do canal de origem (não pelo som), então é exato
e barato: a faixa desce até `−quanto_db` numa rampa de `ataque_ms` que termina na nota e volta numa curva quadrática em
`soltura_ms`; notas próximas valem pela maior redução. A automação é uma reta em dB entre os pontos, amostra a amostra,
aplicada depois do processamento da faixa (no lugar do volume do fader) e antes dos envios aos retornos. No master,
vale para a mistura e para os stems. As duas entram na chave do cache da faixa.

**Licenças e créditos** (item 24, `src/nucleo/musica-licencas.ts`): cada som que se ouve (canal e clipe não mudos) tem
origem e licença: o kit pela lista de kits (o eletrônico é próprio) ou por `licencas` (kit importado), o sintetizador
da casa é próprio, e o áudio por `licencas`. Classes: **livre** (própria, CC0, MIT: publica sem crédito), **credito**
(CC BY 4.0: publica com o crédito), **declarado** (uso próprio que a pessoa declarou) e **sem_licenca** (impede
publicar até alguém dizer: aviso, nunca erro). A linha de crédito é o texto exigido, literal, ou "título" por autor
(endereço), licença CC BY 4.0 (endereço da licença). A exportação grava sempre `saidas/<título>.licencas.json` (o
comprovante: cada som, licença, classe e o SHA-256 do áudio) e, quando algum som pede crédito, `saidas/<título> -
créditos.txt`. Ao pôr no vídeo uma música com som CC BY, o `por_no_video` e o `concluir_transicao` avisam.
`creditosDoVideo` (`musica-projeto.ts`) junta os créditos das músicas ligadas a um vídeo, para a exportação do vídeo.

**Modelos** (item 27, `src/nucleo/musica-modelos.ts`): montados com as mesmas edições da tela e do MCP. **Batida**: Lá
menor, 100 BPM, `i VI III VII`, bateria pop, baixo em oitavas com sidechain do bumbo e acordes em batidas, 8 compassos,
duas seções. **Trilha para vídeo**: Dó maior, 90 BPM, `I V vi IV`, pad longo, arpejo, baixo longo e bateria calma, todos
com o preset "Cama sob a voz" (o pad com o "Pad") e volumes baixos, 16 compassos, fade de um compasso no master.
**Efeito sonoro**: 120 BPM, uma subida de notas e um rufar da caixa até o impacto (bumbo, prato, tom grave e um grave
longo), com reverb e delay. Com `dur_s` (do vídeo), o modelo enche essa duração em compassos inteiros, para cima.

**Na janela**, três buffers tocam juntos com o mesmo loop nativo: a música, a voz do vídeo como guia e o metrônomo.
"Ouvir como no vídeo" aplica ao volume a curva do clipe ligado (faixa × clipe × fades × ducking, `volumeDoClipe`).

**O render para o vídeo** vai para `midia/musica/<id>.<código>.wav` (16 bits, 48 kHz, estéreo), com a medida ao lado
(`.json`: duração, LUFS integrado, pico, avisos) e o envelope (`.wav.envelope.json`, que o ducking e a linha do tempo do
vídeo usam sem medir de novo). O código vem do que se ouve no documento e do tamanho dos áudios: o mesmo documento dá o
mesmo arquivo, e mudar o título não refaz nada. A pasta fica fora do git (a primeira gravação põe `midia/musica/` no
`.gitignore`).

**Ligação viva**: qualquer mudança numa música (da pessoa, da IA pelas ferramentas ou por `aplicar_patch`, ou de outro
app) troca o arquivo dos clipes ligados por um patch com autor `sistema` (fora do Ctrl+Z da pessoa) e grava o render. A
duração do clipe acompanha a música, salvo quando a pessoa aparou o clipe no vídeo. O render que nenhum vídeo toca
mais sai na hora; na abertura do projeto, o que falta no disco (pasta clonada) é gravado e as sobras saem. Sem a janela
(MCP por stdio), as ferramentas fazem o mesmo, com o ffmpeg do `node_modules` para áudios que não são WAV a 48 kHz.

## Determinismo

Contrato da M-03 (ADR A4 de `docs/musica-daw.md`), em duas classes:

- **Canônico**: o render offline que vai para o vídeo, a exportação e o MCP. O mesmo documento dá o mesmo PCM, bit a bit,
  na janela (Web Worker), no processo principal e no MCP por stdio. É o que se confere por hash.
- **Prévia viva**: o que tocar em tempo real (worklet, knob mexido na hora, entrada de áudio, onda M5 em diante). É
  declarada aproximada. Hoje a prévia ainda é o próprio render canônico, tocado em buffer, então ainda não há diferença.

**A impressão digital** (`src/nucleo/musica-hash.ts`) é o SHA-256 dos bytes float32 little-endian, com os canais
intercalados (L0 R0 L1 R1 ...), da mistura final a 48 kHz: depois do master e do limitador, antes da conversão para 16 ou
24 bits. Os bits vão como estão, então −0 e +0 contam diferente. O SHA-256 é escrito em TypeScript puro (sem
`node:crypto` nem `crypto.subtle`) para rodar igual nos quatro lugares. `hashDaMusica(doc, fontes)` renderiza sem cache e
devolve `{pcm_sha256, amostras, canais, taxa}`. `hashDoPcm(canais)` serve para um render já feito.

**Documentos de referência** (`testes/fixtures/musica-referencia/`), congelados em JSON: mudar um modelo depois não muda
o oráculo.

| Documento | O que exercita |
|---|---|
| `batida` | o modelo Batida: bateria pop, baixo em oitavas com sidechain do bumbo, acordes, presets de faixa |
| `trilha-video` | o modelo Trilha para vídeo: pad, arpejo, baixo, bateria calma, "Cama sob a voz", fade por automação no master |
| `efeito-sonoro` | o modelo Efeito sonoro: subida de notas, rufar, impacto, reverb e delay pingue-pongue |
| `sidechain-automacao` | swing 0,35, semente 7, ajuste de peças, EQ e compressor, dois sidechains (bumbo e caixa), automação de duas faixas, clipe com `inicio` |
| `delay-limitador` | compasso 3/4, delay pingue-pongue de colcheia pontuada com realimentação 0,7, reverb grande, master +9 dB no limitador a −3 dB (13 dB de redução), pan |
| `sintetizadores-audio` | os quatro sintetizadores com macros nos extremos, swing 0,6, canal e faixa mudos, clipes de áudio (`midia/ref-ruido.wav`) com corte, ganho e fades |

`hashes.json` guarda o hash, as amostras e os canais de cada um. **Esses hashes são o oráculo da migração da M1**: o motor
por blocos tem que dar os mesmos números (o grafo da M-01 já dá: os seis batem pelo vitest e pelo MCP por stdio). A exceção prevista é o compressor e o limitador, que ficam dentro de uma
tolerância a aprovar.

**Como conferir:**
- `npx vitest run testes/musica-determinismo.test.ts`: renderiza cada documento pelo motor de agora e confere o hash. Confere
  também o SHA-256 contra o `node:crypto`, a prévia com cache (mexer num volume e voltar dá o mesmo PCM) e o
  `medir_musica {hash: true}` pelo registro do MCP.
- `node scripts/hashes-musica.mjs` (depois do `npm run mcp:build`): roda o vitest, monta um projeto temporário com os
  documentos e pede `medir_musica {hash: true}` a cada um pelo MCP por stdio (`dist-mcp/nucleo.cjs`). Com `--executavel
  <Estúdio>`, roda pelo executável do app em modo Node, que usa o V8 do Electron. `--sem-vitest` pula o vitest.
- Na janela: com o app aberto no projeto, o MCP por stdio repassa ao app, e o `medir_musica {hash: true}` sai do Web Worker
  (`feito_por: "janela"`).

**Regravar o oráculo** só quando uma mudança de som foi decidida e aprovada pelo dono:
`ESTUDIO_GRAVAR_HASHES=1 npx vitest run testes/musica-determinismo.test.ts`. O diff do `hashes.json` vai no mesmo commit,
com o motivo.

**Medido** (este PC, Linux, Node 26): os seis hashes do vitest batem com os do MCP por stdio. O SHA-256 em TS puro leva
0,08 s para 40 s de música estéreo. O `npm test` do CI roda o mesmo teste no Linux, no Windows e no Mac (Intel e Apple
Silicon), então um hash que mude por sistema ou processador quebra o CI. Ainda falta conferir na janela (o V8 do
Electron) e pelo executável do app com `--executavel`.

## Ferramentas MCP

Em `src/nucleo/mcp-musica.ts`, registradas por uma linha em `registrarFerramentas`. Servem a qualquer IA: esquema Zod sem
`z.any()` nem união solta, descrição curta, resultado curto (o teste confere). As edições são as mesmas da tela
(`src/nucleo/musica-acoes.ts`). Toda escrita devolve `{ok, seq, documento, caminho}` e, quando um clipe do vídeo mudou,
`video_atualizado`. Sem `documento`, vale a música da transição aberta, a que a pessoa vê ou a única do projeto.

| Ferramenta | Parâmetros | O que faz | Classe |
|---|---|---|---|
| `ler_musica` | `documento?, eventos?, de?, ate?` | BPM, compasso, duração, canais, padrões, clipes (batidas e segundos), mixer, onde toca no vídeo e se o render está em dia, cortes das cenas e avisos; com `eventos`, as notas do trecho em segundos | livre |
| `arranjar` | `documento?, acao: por\|mover\|aparar\|dividir\|apagar\|ajustar\|repetir\|secao\|mover_secao, clipe?, canal?, audio?, padrao?, em?, dur?, corte_s?, ganho_db?, fade_in?, fade_out?, mudo?, vezes?, secao?, nome?` | Põe, move, apara, divide, apaga, ajusta e repete clipes; cria, renomeia e move seções (mover leva os clipes); aparar o começo anda o corte do áudio ou o início do padrão | livre |
| `medir_musica` | `documento?, por_faixa?, hash?` | LUFS integrado e pico da música e de cada faixa; com `hash`, o SHA-256 do PCM, as amostras e quem fez a conta (seção Determinismo) | livre |
| `por_no_video` | `musica?, video?, faixa?, em_ms?, substituir?` | Clipe novo ligado à música, ou liga um clipe que existe | livre |
| `levar_para` | `modulo, alvo: {documento, caminho}, intencao?, tempo?: {em_ms?, dur_ms?}, modelo?` | Abre a Música com o clipe ou a faixa do vídeo e guarda de onde veio; ao criar, `modelo` (`vazio`, `batida`, `trilha_video`, `efeito_sonoro`) escolhe a música nova | livre |
| `concluir_transicao` | `transicao, aplicar?, resultado?: {documento?, midia?}` | Põe a música no vídeo por patch e volta | livre |
| `cancelar_transicao` | `transicao, descartar?` | Volta sem mudar a origem; com descartar, desfaz o que se fez no destino | livre |
| `trocar_kit` | `documento?, canal, kit` | Troca o kit de um canal de bateria (hoje: `eletronico`) | livre |
| `criar_padrao` | `documento?, canal, nome?, dur?, passos?, clonar?, estilo?, no_arranjo?: {em?, dur?}, instrumento?, variar?: {de, quanto?, semente?}` | Padrão vazio, clonado ou de um estilo de bateria da casa (`basico`, `pop`, `eletronico`, `dembow`, `trap`, `calmo`); canal novo se não existir, de bateria ou de sintetizador (`instrumento`: `baixo`, `pad`, `pluck`, `lead`) | livre |
| `escrever_notas` | `documento?, padrao, notas[], modo?: somar\|trocar, de?, ate?, quantizar?, na_escala?` | Escreve notas (peça de bateria ou nota MIDI); nota igual troca, não duplica; `na_escala` leva cada nota para a escala do tom | livre |
| `editar_notas` | `documento?, padrao, acao: quantizar\|transpor\|duplicar\|apagar\|forca\|humanizar\|esticar, selecao?: {de?, ate?, notas?: [{em, nota?, peca?}]}, valor?, grade?, semente?` | As operações do piano roll sobre uma seleção (as notas dadas, um trecho, ou todas) | livre |
| `aplicar_progressao` | `documento?, acordes[], em?, dur_por_acorde?` | Escreve a faixa de acordes por grau ou cifra; o trecho coberto é trocado | livre |
| `gerar_notas` | `documento?, tipo: baixo\|arpejo\|acordes, estilo?, canal?` | Gera um padrão da faixa de acordes num canal de sintetizador e põe o clipe | livre |
| `encaixar_no_video` | `documento?, video?, modo?: duracao\|cortes\|tudo, viradas?` | Fecha a música no último quadro em compassos inteiros (o BPM muda até 8%; com áudio, o BPM fica), põe uma seção por cena no compasso de cada corte e, com viradas, uma virada antes de cada corte e um prato nele | livre |
| `exportar_musica` | `documento?, formato: wav\|m4a\|opus\|mid, stems?, alvo_lufs?, nome?` | Grava em `saidas/` no alvo de loudness (stems em WAV), ou o MIDI; devolve os arquivos e a medida | cartao |
| `importar_midi` | `arquivo, documento?, em?, usar_bpm?, nome?` | Lê um .mid (do projeto ou do computador) e cria um canal, um padrão e um clipe por trilha | cartao |
| `licencas_do_projeto` | `documento?` | Cada som que a música toca, com licença, classe, SHA-256 do áudio e o que impede publicar, e os créditos; sem documento, todas as músicas e os créditos de cada vídeo | livre |

Estendidas: `criar_documento` aceita `modulo: "musica"` e `modelo`; `estado_do_editor` mostra a transição em curso e, na Música, a
seleção como caminho no documento (`/arranjo/clipes/2`) e a cabeça em ms. As "livre" gravam no diário e têm Reverter,
ou só leem. As duas "cartao" passam do diário: `exportar_musica` grava arquivo em `saidas/` (fora do Ctrl+Z) e
`importar_midi` pode ler um arquivo de fora do projeto (o que ela escreve na música vai ao diário). Nenhuma baixa nem
apaga. O "Pôr no vídeo" de uma música sem `video` grava o `video` nela antes do clipe (a voz guia, os cortes e o
encaixe vêm desse vídeo).

**Patch descrito** (sem ferramenta, pelo `aplicar_patch`): BPM, compasso, swing, semente, tom e escala; nome, kit,
peças, `preset`, `macros`, mudo e solo dos canais; volume, pan, mudo, solo, EQ, compressor, reverb e delay das faixas
do mixer; volume, reverb, delay e limitador do master; `alvo_lufs` e `pico_dbtp`; `video`; `sidechain` das faixas;
`automacoes`; `licencas` (a licença de um áudio de fora: `{op: "add", path: "/licencas/-", value: {arquivo, licenca, ...}}`). Os presets de faixa são só
valores (EQ graves/médios/agudos em dB, compressor, envios): Limpo 0/0/0, sem compressor; Bateria +2/−1/+2, compressor
−18 dB 4:1, reverb 0,1; Baixo +3/−2/−4, compressor −20 dB 4:1; Pad −3/0/+1, reverb 0,4, delay 0,15; Lead −2/+2/+1,5,
compressor −16 dB 3:1, reverb 0,2, delay 0,25; Cama sob a voz 0/−4/−2, compressor −24 dB 2:1, reverb 0,15; Voz
−4/+2/+2, compressor −20 dB 3:1, reverb 0,08 (`PRESETS_FAIXA` em `src/nucleo/musica.ts`).
Depois de um patch numa música, os clipes ligados recebem o render novo sozinhos (com o app aberto).

## Para o guia da IA

Texto para a seção do CLAUDE.md do projeto (a coordenação junta no `claudeMd`):

```
## Música

- Música (`"tipo": "musica"`, em `musica/<id>.json`): tempo em batidas (a semínima) a partir do começo; `bpm` e
  `compasso`. `canais` de `audio` ou `bateria` (com `kit`); `padroes` de notas `{peca, em, forca}` (peças: bumbo,
  caixa, palma, aro, chimbal_fechado, chimbal_aberto, prato, tom_grave, tom_agudo, shaker); `arranjo.clipes` com
  `canal`, `em`, `dur` e `audio` (+ `corte_s` em segundos do arquivo) ou `padrao`; `mixer.faixas` com `volume_db`,
  `pan`, `eq`, `compressor` e `reverb` (0 a 1). Leia com `ler_musica`; mexa com `arranjar`, `criar_padrao`,
  `escrever_notas` e `trocar_kit`; o resto (BPM, mixer) por `aplicar_patch`.
- Melodia e harmonia: `tom` e `escala` por patch; `aplicar_progressao {acordes: ["I","vi","IV","V"]}` escreve a faixa de
  acordes; `gerar_notas {tipo: "baixo"|"arpejo"|"acordes", estilo?}` faz o padrão num canal de sintetizador (`preset`
  baixo, pad, pluck ou lead; `macros` brilho, ataque, soltura e cor, de 0 a 1). Notas MIDI (60 = Dó central) com
  `escrever_notas` (`na_escala: true` encaixa na escala); `criar_padrao {canal, instrumento: "lead"}` cria o canal.
- Ida e volta com o vídeo: `levar_para {modulo: "musica", alvo: {documento: "video", caminho:
  "/audio/faixas/@musica/clipes/@<id>"}}` abre a música daquele áudio (ou, com só a faixa e `intencao: "criar"`, uma
  nova); `concluir_transicao {transicao}` põe no vídeo e volta; `cancelar_transicao {transicao, descartar?}` volta sem
  mudar o vídeo. A tela troca de área sozinha. A voz não vai para a Música.
- Um clipe do vídeo com `musica` toca o render dela e se atualiza sozinho a cada mudança: não exporte a música para pôr
  no vídeo. `por_no_video` liga uma música a um clipe novo ou existente. `medir_musica` dá LUFS e pico; o vídeo leva a
  mistura final a −14 LUFS e a música fica de 18 a 23 LU abaixo da voz pelo ducking da faixa.
- Mixer: cada faixa tem `reverb` e `delay` (envios de 0 a 1); `mixer.master.delay.tempo` é a figura (`1/8.` = colcheia
  pontuada) e `mixer.master.limitador {ativo, teto_db}` segura o pico. Para a trilha ficar sob a voz, use na faixa os
  valores do preset "Cama sob a voz" (médios −4 dB).
- Encaixe: `encaixar_no_video {modo: "tudo", viradas: true}` fecha a música no fim do vídeo em compassos inteiros e
  põe uma seção por cena, com virada antes de cada corte. Use depois de `por_no_video`.
- Arquivo: `exportar_musica {formato: "wav"|"m4a"|"opus"|"mid", stems?}` grava em `saidas/` a −14 LUFS (só quando a
  pessoa pedir o arquivo: no vídeo, a música já toca ligada). `importar_midi {arquivo}` traz um .mid como canais e
  padrões.
- Sidechain e automação: `mixer.faixas[i].sidechain = {de: "bateria", peca: "bumbo", quanto_db: 6}` faz a faixa abaixar
  a cada bumbo; `automacoes: [{alvo: "master", pontos: [{em: 28, db: 0}, {em: 32, db: -40}]}]` faz um fade (a curva toma
  o lugar do fader).
- Licenças: cada áudio de fora precisa de uma entrada em `licencas` (`{arquivo, licenca: "CC-BY-4.0", titulo, autor,
  link}` ou `"uso_proprio"`); sem ela, `licencas_do_projeto` diz que impede publicar. Não invente licença: pergunte à
  pessoa. Os sons do Estúdio (kit eletrônico, sintetizadores) são próprios.
- Modelos: `criar_documento {modulo: "musica", modelo: "batida"|"trilha_video"|"efeito_sonoro"}`; do vídeo,
  `levar_para {..., intencao: "criar", modelo: "trilha_video"}`.
```

## Licenças

Nenhuma dependência nova. O MIDI é lido e gravado por código próprio (`src/nucleo/midi.ts`, sem o `@tonejs/midi` que o
relatório citava). O kit eletrônico é sintetizado pelo próprio código (sem amostra). O reverb é o algoritmo
Freeverb (Jezar at Dreampoint, domínio público), escrito aqui; os filtros seguem as fórmulas do Audio EQ Cookbook (Robert
Bristow-Johnson, de uso livre). Os estilos de bateria da casa foram escritos à mão. Nenhum kit, faixa ou banco de som foi
baixado; os kits de terceiros entram na onda 2, cada pacote com o LICENSE de dentro conferido e o ok do responsável.

## Verificado no app

Medido no Electron 42 deste PC (Linux/Omarchy, PipeWire 1.6.9, máquina com outros apps abertos), com o app de
desenvolvimento aberto pela porta de depuração e operado como a pessoa faria (mouse e teclado de verdade pelo CDP, fotos de
cada passo, console e log do processo principal). ✔ medido, ◐ inferido.

- ✔ **Roteiro**: os passos 1 a 19 rodaram. O passo 10 usou o MCP por stdio como "outro app" no lugar do painel do
  Claude (a tela abriu na Música com "aberta pela IA" e voltou ao vídeo sozinha quando a transição foi concluída por fora).
- ✔ **Som**: o `AudioContext` fica `running` a 48 kHz (`baseLatency` 10,7 ms, `outputLatency` 26 a 35 ms); o worker do
  render carrega (`semWorker` falso); o som chega ao PipeWire (captura do monitor do sink: pico −4,6 dB, média −18,8 dB tocando
  a música; no vídeo, pico −6,7 dB). **Latência**: do keydown do Espaço ao medidor pintado no DOM, 28 a 38 ms (5 medidas),
  e a posição já anda em 10 a 21 ms. Mais os 26 a 35 ms da saída de áudio até o alto-falante.
- ✔ **Ouvir como no vídeo**: com a TV ligada a mistura ficou 4,2 dB mais baixa na média (6 dB no pico) sob a narração.
- ✔ **Arquivos** (ffprobe e ffmpeg `ebur128`, medidos nos arquivos de `saidas/`): WAV 24 bits, 48 kHz, estéreo, 12,000 s,
  −14,0 LUFS, pico −3,0 dBFS; M4A (aac) 12,000 s, −14,0 LUFS, −3,0 dBFS; Opus 12,0065 s, −14,0 LUFS, −3,3 dBFS; os cinco
  stems somados (ffmpeg `amix`, sem normalizar) menos a mistura: −91 dB, resíduo da quantização de 24 bits, e os dois a
  −14,0 LUFS. Com a automação (0 dB → −29,5 dB em 8,6 s) a média por dois segundos caiu −11,5, −18,5, −24,2, −31,4 e
  −37,6 dB. O vídeo exportado pelo app (0,5×, leve): H.264 + AAC 48 kHz, 12,000 s, −13,9 LUFS.
- ✔ **MIDI**: lido por um parser independente (Python): formato 1, 960 ppq, andamento 500000 µs por semínima (120 BPM), 4
  trilhas, notas 126, 16 e 32, todas as trilhas fechadas com fim de trilha e nenhum byte sobrando; a **importação** devolveu
  3 canais com 128, 64 e 96 notas de uma Batida exportada.
- ✔ **Licenças**: CC BY no áudio da cama saiu no `- créditos.txt` e no `.licencas.json` da exportação.
- ✔ Reabrir o projeto: a música, a ligação, as seções e o render continuam.

Para repetir: com o app de desenvolvimento aberto pela porta de depuração (`ESTUDIO_DEPURAR_PORTA=9484`, ver CLAUDE.md),
`scripts/preparar-roteiro.ts` monta o projeto do roteiro (vídeo de 3 cenas com narração e música sintéticas),
`scripts/abrir.mjs` e `scripts/novo-projeto.mjs` abrem e criam projetos, `scripts/rc.mjs` clica, arrasta, aperta teclas e
tira foto (coordenadas da foto), `scripts/latencia.mjs` mede o Espaço até o medidor, `scripts/som-check.mjs` amostra o motor e
`scripts/mcp-externo.mjs` faz de "outro app" pelo MCP por stdio. O som que chega ao PipeWire se mede com `parec -d
<sink>.monitor` e `ffmpeg -af volumedetect`.

### O que ainda não foi verificado

- ◐ Os kits de terceiros (onda 2) não existem: o kit.json de cada kit vai dar o `spdx` e o crédito; o teste usa um kit CC BY
  de exemplo, que não existe.
- ◐ Áudio do próprio projeto sem licença informada (a cama que já estava no vídeo) aparece como "sem licença" e avisa no
  rodapé ao exportar, mas não trava (pergunta ao responsável na nota da frente).
- ? O som do delay, do limitador, do sidechain, dos sintetizadores e dos modelos foi conferido por medida e por forma de
  onda, não de ouvido (o sink de áudio deste PC estava mudo).
- ? O monitor do vídeo dentro da Música busca o quadro a cada mudança da cabeça: conferido parado e andando, não tocando por
  muito tempo num vídeo pesado.
- ? Notebook de 8 GB (o app rodou aqui com 800 a 970 MB de memória; o render da Batida de 19 s levou 1,2 a 1,4 s no
  primeiro render e 17 a 600 ms nas edições).
- ? M4A e Opus no app **empacotado** (a exportação rodou no app de desenvolvimento, com o ffmpeg do `node_modules`).
- ? Áudio que não é WAV a 48 kHz no render para o vídeo passa pelo ffmpeg do Remotion; o teste usa WAV a 48 kHz.
- ? O modo "só o padrão" (tocar o padrão em loop fora do arranjo) não entrou: o L no clipe selecionado faz a mesma coisa.
- ◐ Ao "Cancelar e desfazer" (ou Ctrl+Z) uma troca de render, o clipe do vídeo aponta por um instante para o render velho,
  que a limpeza já tinha apagado: há um 404 no console e o clipe fica mudo até o render voltar (uns segundos; o arquivo
  volta pelo mesmo código).
- ? Cada abertura da Música num projeto sem `.estudio/transicoes.json` deixa uma linha de erro no log do processo principal
  (o `ler-json` do registro responde "arquivo não achado"; a tela trata e segue). É só ruído de log.

## Roteiro para o responsável no app (20 minutos)

1. Abra um projeto com um vídeo de cenas que tenha narração e uma música (ou ponha as duas com "+ Áudio").
2. Selecione o clipe da música na linha do tempo. No inspetor, seção **Música**, clique em **Editar em Música**. A área
   troca para Música, com a faixa verde no topo ("Editando o áudio de…") e o clipe selecionado no arranjo.
3. Toque (Espaço). A voz do vídeo toca junto, como guia (o ícone do microfone liga e desliga). Ligue o ícone da TV
   ("Ouvir como no vídeo") e toque de novo: a música cai sob a voz como no vídeo.
4. Na lista à esquerda, clique em **+ Bateria**. No sequenciador, ligue e desligue alguns passos e troque o estilo.
5. Na aba **Mixer**, baixe o volume da bateria e mande um pouco para o reverb.
6. Clique em **Concluir e voltar**. Confira: área Vídeo, o mesmo clipe selecionado, a cabeça onde estava, e a seção
   Música do inspetor dizendo que o clipe toca a música. Toque o vídeo.
7. Aperte **5**, mude um passo e volte com **1**: o rodapé diz "Trilha atualizada no vídeo" e o vídeo já toca a versão
   nova, sem exportar.
8. No inspetor do clipe, **Voltar ao original**: o clipe toca de novo o áudio de antes (a música fica no projeto).
   Logo depois do passo 6, antes de mexer de novo na música, o Ctrl+Z também tira a música do clipe; depois, as trocas
   de render mudam o vídeo e o Ctrl+Z desfaz primeiro as suas edições na música.
9. Sem seleção, no inspetor da música, **Tom e acordes**: escreva `I vi IV V` no campo Acordes e use **Gerar baixo ›
   batidas** e **Gerar arpejo › sobe**. A faixa de acordes aparece no arranjo, os canais Baixo e Pluck nascem, e a grade
   de notas mostra as notas (as fora da escala apagadas). Clique no nome de uma nota para ouvi-la; mexa nas macros.
10. No painel do Claude, peça "abra a música do clipe da trilha, ponha um prato no começo e volte ao vídeo". A área
   deve trocar sozinha na ida e na volta. (Na retomada rodou pelo MCP por stdio, `scripts/mcp-externo.mjs`, porque o
   painel do Claude não foi usado.)
11. Feche e reabra o projeto: a música, a ligação e o render continuam lá.
12. Numa música posta no vídeo com "Pôr no vídeo", num vídeo de três cenas: inspetor da música, seção **Vídeo**, ligue
    **Viradas** e clique em **Encaixar tudo**. A música passa a terminar no fim do vídeo, o arranjo ganha as seções
    Cena 1, 2 e 3, e antes de cada corte entra uma virada com prato no corte. Ligue a claquete no transporte e mexa a
    cabeça: o quadro do vídeo acompanha.
13. Aba **Mixer**: suba o **Delay** da bateria e toque. No inspetor da faixa, **Preset › Cama sob a voz**. A tira do
    master diz quanto o limitador tirou.
14. Botão **Exportar** do transporte (ou a seção **Exportar** do inspetor): WAV com **Stems** e depois M4A. Abra `saidas/` no explorador: o arquivo da música, a pasta dos
    stems e o M4A; o rodapé disse o loudness (perto de −14 LUFS).
15. Exporte em **MIDI**, abra uma música nova e use **+ MIDI…** com o arquivo de `saidas/`: os canais voltam com as
    mesmas notas.
16. Num projeto sem música, área Música: **Batida**. Toque: o baixo abaixa a cada bumbo (inspetor da faixa do Baixo,
    seção **Sidechain**; suba o "Quanto" para ouvir melhor).
17. Na linha **Volume** no pé do arranjo (clique na seta): clique perto do fim, bem embaixo (−30 dB); arraste o ponto
    para ajustar. Toque: a música some aos poucos. (O mesmo pelo inspetor da música: **Automação de volume**, **Ponto na
    cabeça**.) Depois, num canal de bateria, arraste no vazio depois do último clipe: um clipe do padrão aparece.
18. Num clipe de áudio de fora, **Licença do áudio** › CC BY 4.0, com título e autor. Exporte em WAV: em `saidas/` saem
    o `.licencas.json` e o `- créditos.txt` com a linha de crédito.
19. No vídeo, numa faixa de música, **Criar em Música**: a Trilha para vídeo abre do tamanho do vídeo; **Concluir e
    voltar** e toque o vídeo.

Anote o que travar ou demorar: o tempo do render na sua máquina é o que falta medir.
