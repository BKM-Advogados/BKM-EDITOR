# Música

Versão 1, de 08/11/2026 (rodada 3, frente Música, onda 1: marcos A e B do plano
`tasks/estudio-musica-2026-11-07/fork/00-plano.md`). Versão 2, do mesmo dia: o som num Web Worker, a ponte com a janela,
os sintetizadores da casa, tom, escala, acordes e o baixo, o arpejo e os acordes gerados (itens 14, 18 e 19). Versão
3: o piano roll com mouse, carimbo e teclado (item 17), o medidor ao vivo, a variação de padrão (16), repetir e seções
(20). A música é uma vista do mesmo projeto: um documento
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
  de −18 a +18 dB), `compressor` e `reverb` (quanto vai ao reverb do master, de 0 a 1). Havendo solo, só toca o que tem
  solo (por canal e por faixa).
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

**No vídeo** (`src/nucleo/audio.ts`): o `ClipeAudio` ganha `musica` (id do documento) e `musica_original`
(`{arquivo, corte_ms?, duracao_ms}`, o áudio de antes do "Editar em Música"). `arquivo` aponta o render; o volume, os
fades e o ducking do clipe continuam valendo, porque para o vídeo é um clipe como outro qualquer.

## O som

`src/nucleo/musica-som.ts`, em TypeScript puro: o kit eletrônico sintetizado (seno com queda de afinação, ruído filtrado
e quadradas desafinadas, sem arquivo nem licença de terceiros), os clipes de áudio com corte, ganho e fades, o mixer
(filtros do Audio EQ Cookbook, compressor de alimentação direta, pan de potência igual) e o reverb Freeverb (Jezar,
domínio público) no master. A mesma conta roda na janela, num Web Worker (o Web Audio só decodifica a 48 kHz e toca o
resultado), no render que vai para o vídeo e no MCP por stdio, então a prévia e o render saem iguais amostra por amostra.

**Por que um motor próprio e não o Tone.js** (decisão da frente, dentro da D1: só Web Audio, sem módulo nativo nem VST):
- O Tone.js toca no Web Audio da janela e renderiza com o `OfflineAudioContext`, que só existe no navegador. O MCP por
  stdio (outro app de IA, sem a janela do Estúdio) e o processo principal não teriam como fazer o render para o vídeo; a
  ligação viva dependeria da janela aberta.
- Um renderizador puro roda igual no vitest: os testes medem o som (tempo de cada batida, swing, grupo de corte, ganho em
  dB, divisão de clipe sem mudar nada) e comparam o render da janela com o do processo byte a byte.
- O mesmo código na prévia e no render garante que se ouve o que vai para o vídeo; com dois motores (Tone.js na prévia e
  outro no render) isso viraria teste de semelhança.
- Nenhuma dependência nova no instalador. O que o Tone.js traz e falta aqui (sintetizadores prontos, agendador de tempo
  real) entra pelos itens do plano, escrito na mesma conta.

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

## Ferramentas MCP

Em `src/nucleo/mcp-musica.ts`, registradas por uma linha em `registrarFerramentas`. Servem a qualquer IA: esquema Zod sem
`z.any()` nem união solta, descrição curta, resultado curto (o teste confere). As edições são as mesmas da tela
(`src/nucleo/musica-acoes.ts`). Toda escrita devolve `{ok, seq, documento, caminho}` e, quando um clipe do vídeo mudou,
`video_atualizado`. Sem `documento`, vale a música da transição aberta, a que a pessoa vê ou a única do projeto.

| Ferramenta | Parâmetros | O que faz | Classe |
|---|---|---|---|
| `ler_musica` | `documento?, eventos?, de?, ate?` | BPM, compasso, duração, canais, padrões, clipes (batidas e segundos), mixer, onde toca no vídeo e se o render está em dia, cortes das cenas e avisos; com `eventos`, as notas do trecho em segundos | livre |
| `arranjar` | `documento?, acao: por\|mover\|aparar\|dividir\|apagar\|ajustar\|repetir\|secao\|mover_secao, clipe?, canal?, audio?, padrao?, em?, dur?, corte_s?, ganho_db?, fade_in?, fade_out?, mudo?, vezes?, secao?, nome?` | Põe, move, apara, divide, apaga, ajusta e repete clipes; cria, renomeia e move seções (mover leva os clipes); aparar o começo anda o corte do áudio ou o início do padrão | livre |
| `medir_musica` | `documento?, por_faixa?` | LUFS integrado e pico da música e de cada faixa | livre |
| `por_no_video` | `musica?, video?, faixa?, em_ms?, substituir?` | Clipe novo ligado à música, ou liga um clipe que existe | livre |
| `levar_para` | `modulo, alvo: {documento, caminho}, intencao?, tempo?: {em_ms?, dur_ms?}` | Abre a Música com o clipe ou a faixa do vídeo e guarda de onde veio | livre |
| `concluir_transicao` | `transicao, aplicar?, resultado?: {documento?, midia?}` | Põe a música no vídeo por patch e volta | livre |
| `cancelar_transicao` | `transicao, descartar?` | Volta sem mudar a origem; com descartar, desfaz o que se fez no destino | livre |
| `trocar_kit` | `documento?, canal, kit` | Troca o kit de um canal de bateria (hoje: `eletronico`) | livre |
| `criar_padrao` | `documento?, canal, nome?, dur?, passos?, clonar?, estilo?, no_arranjo?: {em?, dur?}, instrumento?, variar?: {de, quanto?, semente?}` | Padrão vazio, clonado ou de um estilo de bateria da casa (`basico`, `pop`, `eletronico`, `dembow`, `trap`, `calmo`); canal novo se não existir, de bateria ou de sintetizador (`instrumento`: `baixo`, `pad`, `pluck`, `lead`) | livre |
| `escrever_notas` | `documento?, padrao, notas[], modo?: somar\|trocar, de?, ate?, quantizar?, na_escala?` | Escreve notas (peça de bateria ou nota MIDI); nota igual troca, não duplica; `na_escala` leva cada nota para a escala do tom | livre |
| `editar_notas` | `documento?, padrao, acao: quantizar\|transpor\|duplicar\|apagar\|forca\|humanizar\|esticar, selecao?: {de?, ate?, notas?: [{em, nota?, peca?}]}, valor?, grade?, semente?` | As operações do piano roll sobre uma seleção (as notas dadas, um trecho, ou todas) | livre |
| `aplicar_progressao` | `documento?, acordes[], em?, dur_por_acorde?` | Escreve a faixa de acordes por grau ou cifra; o trecho coberto é trocado | livre |
| `gerar_notas` | `documento?, tipo: baixo\|arpejo\|acordes, estilo?, canal?` | Gera um padrão da faixa de acordes num canal de sintetizador e põe o clipe | livre |

Estendidas: `criar_documento` aceita `modulo: "musica"`; `estado_do_editor` mostra a transição em curso e, na Música, a
seleção como caminho no documento (`/arranjo/clipes/2`) e a cabeça em ms. Todas são "livre" (gravam no diário e têm
Reverter, ou só leem): nenhuma baixa, lê fora do projeto ou apaga.

**Patch descrito** (sem ferramenta, pelo `aplicar_patch`): BPM, compasso, swing, semente, tom e escala; nome, kit,
peças, `preset`, `macros`, mudo e solo dos canais; volume, pan, mudo, solo, EQ, compressor e reverb das faixas do mixer; volume e reverb do master; `video`.
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
```

## Licenças

Nenhuma dependência nova. O kit eletrônico é sintetizado pelo próprio código (sem amostra). O reverb é o algoritmo
Freeverb (Jezar at Dreampoint, domínio público), escrito aqui; os filtros seguem as fórmulas do Audio EQ Cookbook (Robert
Bristow-Johnson, de uso livre). Os estilos de bateria da casa foram escritos à mão. Nenhum kit, faixa ou banco de som foi
baixado; os kits de terceiros entram na onda 2, cada pacote com o LICENSE de dentro conferido e o ok do responsável.

## O que não foi verificado

- O app real (Electron): o Bitdefender bloqueia o Electron de desenvolvimento neste PC. A tela foi conferida na prévia
  web (porta 5209) e o núcleo e as ferramentas no vitest, com o MCP em processo e por stdio.
- Latência de tocar no Electron e no notebook de 8 GB.
- Com o app aberto, o render roda no Web Worker da janela (conferido na prévia web: o worker carrega e o render que vai
  para o vídeo volta com `feito_por: janela`). Sem janela, ele ainda roda no processo que pediu: no MCP por stdio isso só
  segura aquele processo, mas no processo principal (janela fechada no meio de um pedido do MCP por HTTP) seguraria a
  janela por perto de 1 s numa música de 60 s.
- Áudio que não é WAV a 48 kHz no render para o vídeo passa pelo ffmpeg do Remotion; o teste usa WAV a 48 kHz.
- O medidor ao vivo do mixer (nível por faixa durante a reprodução) não entrou; `medir_musica` dá o LUFS e o pico.
- O modo "só o padrão" (tocar o padrão em loop fora do arranjo) não entrou: o L no clipe selecionado faz a mesma coisa.
- "Pintar" clipes arrastando no vazio do arranjo não entrou; Repetir cobre o caso de encher compassos.
- O som dos sintetizadores foi conferido por medida (altura por autocorrelação, brilho pela energia nos agudos), não de
  ouvido.

## Roteiro para o responsável no app (10 minutos)

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
   deve trocar sozinha na ida e na volta.
11. Feche e reabra o projeto: a música, a ligação e o render continuam lá.

Anote o que travar ou demorar: o tempo do render na sua máquina é o que falta medir.
