# Narração por IA

Frente "narração por IA" (branch `frente/narracao-ia`, 10/11/2026). A voz do vídeo de cenas sai de uma IA do Google, dentro
do app: a chave fica no cofre, o painel fica na tela, as ferramentas ficam no MCP e cada geração entra no diário, com
Reverter. Dois provedores:

| Provedor | Id | Chave | Vozes | Controle |
|---|---|---|---|---|
| **Gemini TTS** (Gemini API / Google AI Studio) | `gemini` | a mesma do provedor Gemini das conversas | 30 prontas e a biblioteca estendida em português | estilo em linguagem natural; modelo Flash ou Flash-Lite |
| **Google Cloud TTS, vozes Chirp 3: HD** | `google-tts` | chave própria no cofre ("Google Cloud TTS") | `pt-BR-Chirp3-HD-<Nome>` (30) | velocidade de 0,25 a 2 |

## O que foi conferido nas docs (10/11/2026)

**Gemini TTS** (aistudio.google.com/docs/speech-generation, variante generateContent, e aistudio.google.com/docs/models/gemini-3.8-flash-tts):

- Ids dos modelos: `gemini-3.8-flash-tts` e `gemini-3.8-flash-lite-tts`. A página do modelo dá "setembro de 2026" como última
  atualização, sem o selo "Preview". Esse selo aparece só no `gemini-3.1-flash-tts-preview`. A pesquisa da pessoa dizia
  "Preview": o app trata os dois como podendo mudar e não depende de nada que só a versão estável teria.
- O pedido é `POST https://generativelanguage.googleapis.com/v1beta/models/{modelo}:generateContent`, com a chave no
  cabeçalho `x-goog-api-key`:

  ```json
  {"contents": [{"role": "user", "parts": [{"text": "<o roteiro literal>", "speech_metadata": {"style": "<como falar>"}}]}],
   "generationConfig": {"responseModalities": ["AUDIO"], "speechConfig": {"voiceConfig": {"voice": "Kore"}}}}
  ```

- A doc de hoje põe a voz em `voiceConfig.voice` e o estilo em `speech_metadata.style`, separado do texto. Ela diz que o
  texto deve ser o roteiro literal. A pesquisa da pessoa trazia o formato anterior (`voiceConfig.prebuiltVoiceConfig.voiceName`
  e o estilo como instrução no texto). **Decisão:** o app manda o formato novo. Se o Google recusar algum campo (400
  "Unknown name"), ele pede de novo, uma vez, no formato anterior. Os dois formatos estão nos testes.
- A resposta traz o áudio em `candidates[0].content.parts[].inlineData {mimeType, data}`. No Gemini 3.8 vem WAV de 16 bits,
  24 kHz, mono, com cabeçalho RIFF. Nos modelos anteriores vinha PCM cru (`audio/L16`). O app aceita os dois e grava sempre
  WAV (`wavDaResposta`).
- Há tags no texto: `<short pause>`, `<long pause>`, `<laugh>`, `<sigh>`. O Gemini **não marca o tempo de cada palavra** e
  **não aceita fonema**: as legendas vêm da transcrição local (`transcrever`) e a pronúncia vem do dicionário do app.
- A entrada vai até 8.192 tokens. O modelo detecta a língua sozinho e aceita português.
- A lista de vozes é `GET /v1beta/voices?language_code=pt-BR`, para a biblioteca estendida. As 30 vozes prontas estão no
  catálogo do app, com o caráter que a doc dá a cada uma.

**Cloud TTS** (docs.cloud.google.com/text-to-speech/docs/chirp3-hd e a referência REST da v1):

- O pedido é `POST https://texttospeech.googleapis.com/v1/text:synthesize`, com a chave de API em `x-goog-api-key`:

  ```json
  {"input": {"text": "..."}, "voice": {"languageCode": "pt-BR", "name": "pt-BR-Chirp3-HD-Charon"},
   "audioConfig": {"audioEncoding": "LINEAR16", "speakingRate": 1.0}}
  ```

- As pausas `[pause short]`, `[pause long]` e `[pause]` só valem em `input.markup`. O app manda `markup` quando o texto tem
  pausa e `text` no resto.
- A resposta é `{audioContent: base64}`. Em LINEAR16 o áudio já vem com o cabeçalho WAV.
- A entrada vai até **5000 bytes** por pedido. Acima disso, o app recusa antes de chamar e pede para dividir a cena.
- `GET /v1/voices?languageCode=pt-BR` lista as vozes de graça. É o teste da chave antes de gravar.
- **Decisão:** a pronúncia por IPA ou X-SAMPA (`customPronunciations`) ficou de fora. A referência REST diz "currently supports
  en-us only", embora a página do Chirp não exclua o pt-BR. O dicionário do app troca o texto e vale nos dois provedores.

## Preços (tabela em `src/main/ia/precos.ts`, conferida em 10/11/2026)

| Modelo | Até 31/12/2026 | A partir de 01/01/2027 | Fonte |
|---|---|---|---|
| `gemini-3.8-flash-tts` | entrada US$ 0,50/M tokens · saída (áudio) US$ 9/M | US$ 1 · US$ 18 | aistudio.google.com/docs/pricing |
| `gemini-3.8-flash-lite-tts` | entrada US$ 0,50/M · saída US$ 6/M | US$ 1 · US$ 12 | idem |
| Chirp 3: HD (`google-tts`) | US$ 30 por milhão de caracteres, 1 milhão grátis por mês | — | cloud.google.com/text-to-speech/pricing |

- O áudio do Gemini custa **25 tokens por segundo**: um minuto de fala no Flash sai por perto de US$ 0,0135 até o fim de 2026.
  Os dois preços do Gemini dobram em 01/01/2027, e a tabela já tem as duas faixas.
- **Plano gratuito do Gemini:** não cobra, e o Google pode usar o texto e o áudio para melhorar os produtos dele. No pago,
  não usa. O aviso aparece em Configurações › IA.
- A estimativa antes de gerar vem de `medirFala`: caracteres e bytes, os tokens de texto pela conta de caracteres ÷ 4, e a
  duração pela conta do teleprompter a 150 palavras por minuto, dividida pela velocidade no Cloud TTS. O custo depois de gerar
  usa os tokens que o Gemini devolve (`usageMetadata`).
- A estimativa não desconta o milhão grátis do Cloud TTS, porque o app não sabe quanto a pessoa já gastou no mês. A nota
  aparece junto do valor.
- O uso vai para o uso do mês de Configurações › IA. O Gemini TTS conta tokens; o Cloud TTS conta caracteres.

## Formatos no documento

```jsonc
{
  "tipo": "cenas",
  "cenas": [
    {"id": "c1", "duracao_ms": 4000, "blocos": [...], "narracao": {"texto": "Bem-vindo ao treinamento do PIN."}}
  ],
  "narracao": {                          // a configuração (tudo opcional)
    "provedor": "gemini",                // ou "google-tts"
    "modelo": "gemini-3.8-flash-tts",    // só gemini
    "voz": "Charon",                     // google-tts: "pt-BR-Chirp3-HD-Charon" (o nome curto também vale)
    "estilo": "calmo e didático",        // só gemini
    "velocidade": 1.1,                   // só google-tts, 0,25 a 2
    "folga_ms": 300,                     // a fala entra depois do começo da cena
    "margem_ms": 500,                    // o que sobra depois da fala ao ajustar as cenas
    "pronuncias": [{"de": "PIN", "para": "pin"}, {"de": "RH", "para": "erre agá"}]
  },
  "audio": {"faixas": [{"id": "narracao", "papel": "voz", "clipes": [
    {"id": "fala-1", "arquivo": "midia/narracao/3f0c…e1.wav", "em": 300, "duracao_ms": 2480, "nome": "Fala da cena 1",
     "narracao_ia": {"cena": "c1", "hash": "3f0c…e1"}}
  ]}]}
}
```

- **`cenas[i].narracao.texto`** é o roteiro falado. O texto da tela fica nos blocos.
- **Pausas neutras:** `[pausa]`, `[pausa curta]` e `[pausa longa]` viram `<short pause>`/`<long pause>` no Gemini e
  `[pause short]`/`[pause long]` no Cloud TTS. As pausas próprias de um provedor também são traduzidas para o outro. As tags
  de voz do Gemini (`<laugh>`) saem do texto quando ele vai ao Cloud TTS, que as leria em voz alta.
- **Dicionário de pronúncia:** fica no documento (`narracao.pronuncias`) e é aplicado ao texto antes de qualquer provedor.
  - Troca a palavra inteira, numa passada só: o que já foi trocado não é trocado de novo, e a entrada mais longa ganha.
  - Com maiúscula no `de` (uma sigla: "RH", "PIN"), só casa a mesma caixa. Todo em minúsculas, casa qualquer caixa ("ctps"
    pega "CTPS" e "Ctps").
  - **Decisão:** o dicionário fica no documento e não no projeto. Ele anda com o vídeo, entra no diário e no Reverter como o
    resto, e o resolvedor o confere. Para reusar noutro vídeo, a IA copia com `pronuncias_narracao`.
- **Validação** (`problemasDaNarracao`, chamada pelo resolvedor de `cenas.ts`): campo fora do lugar vira aviso, nunca erro.
  Isso vale para:
  - provedor desconhecido;
  - modelo fora da lista;
  - velocidade, folga ou margem fora da faixa;
  - pronúncia sem `de`/`para`;
  - campo desconhecido na configuração ou na cena;
  - `narracao` da cena que não é `{texto}`;
  - fala acima de 5000 bytes no Cloud TTS;
  - clipe de fala de uma cena que não existe mais.

## Cache e estado de cada cena

- O **hash** do pedido é o SHA-256 de (texto já com as pronúncias e as pausas + provedor + modelo + voz + parâmetros), cortado
  em 20 caracteres.
  - No Gemini, os parâmetros são modelo e estilo; a velocidade não entra.
  - No Cloud TTS, o parâmetro é a velocidade; o estilo não entra.

  Mudar só o que o provedor não usa não desatualiza nada. O SHA-256 é puro (`src/nucleo/sha256.ts`): a tela e o processo
  principal fazem a mesma conta, síncrona, e os testes conferem com o `node:crypto`.
- O WAV fica em `midia/narracao/<hash>.wav`. Ao lado dele fica o envelope de loudness (`<hash>.wav.envelope.json`), medido das
  amostras no momento de gravar. A ficha fica em `.estudio/narracao/<hash>.json` (texto, provedor, voz, data), fora de
  `midia/` para não aparecer no painel Mídia.
- **Gerar** (`gerarNarracao`) cobre, sem pedido, as cenas "a gerar" e "desatualizadas"; com pedido, as cenas pedidas.
  - O WAV que já está no cache não vai ao Google: volta ao vídeo de graça. Isso vale para desfazer uma mudança de texto ou para
    apagar o clipe.
  - `refazer: true` pede outra tomada mesmo com o cache.
  - O documento é relido depois da rede, e as falas entram num patch só, com uma entrada no diário.
  - No primeiro erro (chave, cota, voz), a geração para; o que já foi gerado entra no vídeo, e o erro volta.
- **Estado** (`itensDaNarracao`):
  - `sem_texto`;
  - `pendente` ("a gerar"): tem texto e não tem fala;
  - `gerada`: o hash do clipe é o do texto e da voz de agora, e o arquivo existe;
  - `desatualizada`: o texto, as pronúncias, a voz ou o estilo mudaram, ou o WAV sumiu;
  - `gravada`: a cena toca um trecho da narração gravada inteira (seção abaixo) e não tem fala gerada. Não vai à IA sem ser
    pedida pelo número; pedida, a fala gerada entra junto e o `narrar` avisa para silenciar ou tirar uma das duas.
- Os WAVs caem na regra de mídia pesada do `.gitignore` do projeto (`midia/**/*.wav`). Depois de clonar o projeto noutro PC,
  as cenas aparecem desatualizadas, e `narrar` gera de novo (com custo).

## A fala no vídeo

- A fala entra no começo da cena, mais a folga (300 ms por padrão). A faixa é escolhida nesta ordem:
  1. a faixa de voz que já tem falas geradas;
  2. a primeira faixa de voz vazia;
  3. uma faixa nova, "Narração IA".

  Assim, a narração gravada pela pessoa fica onde está. Gerar de novo troca o arquivo do clipe e mantém o id. As legendas que
  ele tinha passam a ser "de outra tomada", e o `transcrever` pergunta antes de refazê-las. Volume e fade ajustados à mão
  ficam. Pedaços da mesma fala divididos à mão saem.
- **Ducking:** a música que já existe tem ducking ligado e cai sob a voz gerada como cai sob qualquer outra. O envelope gravado
  junto do WAV faz o ducking valer na hora, também no MCP fora do app, sem esperar a tela medir.
- Fala mais longa que a cena gera aviso; o app não corta nada.
- **Ajustar a duração das cenas à fala** (`ajustarCenasAFala`) é uma ação separada, e nunca roda sozinha.
  - Cada cena com fala passa a durar o deslocamento da fala + a fala + a margem (500 ms por padrão).
  - `apenas_alongar` só cresce as cenas curtas.
  - As falas vão para o começo das cenas no tempo novo, com o mesmo deslocamento.
  - O resto do som anda com as cenas, pela mesma conta de `som-com-cenas.ts`.
  - Tudo vai num patch só: Ctrl+Z ou Reverter desfaz.
- **Legendas:** depois de gerar, o painel oferece "Criar legendas", e o `narrar` do MCP devolve `proximo: transcrever`. A
  transcrição local que já existe põe o tempo de cada palavra, que o Gemini não dá.

## Na tela

- **"+ Áudio" › "Narração por IA…"** abre o painel na linha do tempo, ao lado do gravador com teleprompter. Ele tem:
  - provedor, modelo e voz (a lista vem da API e fica guardada na sessão, com o botão de buscar de novo);
  - o estilo (Gemini) ou a velocidade (Cloud TTS) e a folga;
  - **Ouvir amostra**: uma frase curta. A amostra fica em `userData/ia/amostras-narracao/<hash>.wav` e não é paga duas vezes;
  - a fala de cada cena, com o estado e "Gerar esta cena". Na cena já gerada, o botão vira "Outra tomada", que vai ao Google
    de novo (com custo) com o mesmo texto e a mesma voz;
  - **Gerar todas**, que confirma antes com o custo estimado e mostra o andamento e o Cancelar;
  - **Ajustar as cenas à fala** e **Criar legendas**;
  - o **dicionário de pronúncia**.
- No inspetor da cena, a seção **Fala (narração por IA)** tem o texto falado, o estado, "Gerar esta cena" (ou "Outra
  tomada") e o atalho para o painel.
- Em **Configurações › IA**, a seção **Narração por IA** tem duas partes:
  - o estado da chave do Gemini (a mesma das conversas), com o aviso do plano gratuito;
  - a chave do **Google Cloud TTS**: Testar e gravar, Apagar e "Onde pego a chave?".

  O uso do mês mostra "Gemini TTS (narração)" em tokens e "Google Cloud TTS (narração)" em caracteres.
- Tudo segue os componentes que já existiam (`flutuante`, `campo`, `bt mini`, `Secao`, `CampoTexto`), sem biblioteca nova.

## Chaves

- **Gemini TTS:** usa a chave do provedor `gemini` do cofre. Ela é testada e gravada em Configurações › IA › Gemini (chave),
  como nas conversas; as variáveis `GEMINI_API_KEY` e `GOOGLE_API_KEY` valem como reserva. Não há chave nova.
- **Google Cloud TTS:** é uma credencial nova no cofre, com o id `google-tts` e a variável de reserva `GOOGLE_TTS_API_KEY`.
  - A chave é testada em `GET /v1/voices?languageCode=pt-BR`, sem custo.
  - Recusada (400 `API_KEY_INVALID`, 401 ou 403), não grava.
  - Com a API desativada no projeto (403 `SERVICE_DISABLED`), não grava, e a mensagem diz onde ativar.
  - Sem rede, grava e avisa.
  - Fica cifrada como as outras, e a tela vê só os 4 últimos caracteres.
- A chave só vive no processo principal (`src/main/ipc-narracao.ts`). A tela pede "gerar" e recebe o resultado; o MCP por HTTP
  recebe o mesmo serviço (`definirNarradorMcp`). No MCP por stdio (`mcp/nucleo.ts`), as chaves vêm do ambiente.

## Erros em pt-BR (`erroDoGoogle`, `erroDeRede`)

| Tipo | Quando | Mensagem (resumo) |
|---|---|---|
| `sem_chave` | sem chave no cofre nem no ambiente | "falta a chave do …: ponha em Configurações › IA" (no stdio: "defina GEMINI_API_KEY…") |
| `chave` | 400 `API_KEY_INVALID`, 401, 403 sem permissão | "a chave do Gemini foi recusada pelo Google (…): confira em Configurações › IA" |
| `desativada` | 403 `SERVICE_DISABLED` | "a Cloud Text-to-Speech API não está ativada no projeto…: ative em …" |
| `cota` | 429 / `RESOURCE_EXHAUSTED` | "cota ou limite de uso do Google atingido (429)…" |
| `voz` | 400 que fala de voz | "a voz "…" não existe…: escolha outra na lista de vozes" |
| `modelo` | 404 no Gemini | "o modelo "…" não foi achado no Gemini (404)" |
| `texto` | mais de 5000 bytes no Cloud TTS, outro 400 | "divida a cena em duas" / "o Google recusou o pedido (400)" |
| `sem_audio` | resposta sem áudio (bloqueio, modelo não TTS) | "o Gemini não devolveu áudio (motivo: SAFETY)…" |
| `rede`, `servico`, `cancelado` | sem internet, 5xx, Cancelar | — |

A chave nunca aparece numa mensagem, porque o texto passa por `replaceAll(chave, '…')`.

## Ferramentas MCP (`src/nucleo/mcp-narracao.ts`)

| Ferramenta | Parâmetros | Classe |
|---|---|---|
| `vozes_narracao` | `{provedor?}` | cartão (`openWorldHint`: usa a chave, sem custo) |
| `configurar_narracao` | `{provedor?, modelo?, voz?, estilo?, velocidade?, folga_ms?, margem_ms?, documento?}` | livre (diário, Reverter) |
| `pronuncias_narracao` | `{definir?: [{de, para}], tirar?: [de], testar?, documento?}`; sem nada, só lê | livre |
| `narrar` | `{cenas?, previa?, refazer?, documento?}` | cartão (`openWorldHint`); com `previa: true` roda direto (`livreSe` em `portao.ts`) e não sai do PC |
| `ajustar_cenas_a_fala` | `{cenas?, margem_ms?, apenas_alongar?, documento?}` | livre |
| `dividir_narracao` | `{arquivo?, clipe?, previa?, cortes?, margem_corte_ms?, margem_ms?, documento?}` | livre (`src/nucleo/mcp-narracao-inteira.ts`; seção "Narração gravada inteira") |

- `cenas` aceita o id ou o número da cena ("2").
- `narrar` com `previa: true` devolve, sem chamar a API:
  - o texto final de cada cena, com as pronúncias;
  - os caracteres e a duração estimada;
  - o que sai do cache;
  - o custo estimado, com a data da tabela;
  - o estado de todas as cenas.
- O guia que o app escreve no `CLAUDE.md` de cada projeto (`claudeMd`, `src/nucleo/criar-projeto.ts`) traz os campos e a
  sequência:
  1. escrever `cenas[i].narracao.texto`;
  2. `configurar_narracao` e `pronuncias_narracao`;
  3. `narrar` com `previa`;
  4. `narrar`;
  5. `ajustar_cenas_a_fala`;
  6. `transcrever`.

## Narração gravada inteira (Onda B)

Quem grava a fala do vídeo de uma vez, num áudio só, divide a gravação nas cenas pela transcrição. O núcleo é
`src/nucleo/narracao-inteira.ts` (puro: a tela e o MCP fazem a mesma conta).

**A proposta** (`proporDivisao`) recebe as palavras transcritas (`[{w, s, e}]` em ms do arquivo, o `<arquivo>.palavras.json`
do `transcrever`) e as cenas com o texto falado delas:

- **Com texto** (`cenas[i].narracao.texto`): o texto de todas as cenas, em ordem, é alinhado às palavras (Needleman-Wunsch
  global, sem diferença de acento, caixa e pontuação; a palavra parecida, com semelhança de 70% ou mais, vale como a
  mesma; as pausas `[pausa]` e o destaque `**` saem antes). Palavra falada fora do texto custa metade da palavra do texto
  que não foi falada: quem grava improvisa ("Oi, gente" no começo fica na primeira cena). A cena sem texto entra no
  alinhamento como um coringa que engole a fala dela.
- **A fronteira entre duas cenas com texto** cai na maior pausa até duas palavras para cada lado do ponto que o
  alinhamento achou (a pausa depois de ponto final vale 300 ms a mais; a de vírgula, 100), pagando 400 ms por palavra
  alinhada que muda de cena. Assim a fronteira dentro de uma frase, sem pausa longa, sai do texto.
- **Sem texto:** os cortes caem nas pausas mais longas, até o número de cenas. Pausa de menos de 250 ms não vira corte:
  se a gravação não tem pausas para tantas cenas, as que sobram (no fim) ficam sem fala, com aviso, em vez de cortar no
  meio da frase.
- **Com `cortes`** (ms do arquivo, de quem revisou a prévia): cada um vai para a pausa mais perto; o que cai dentro de
  uma palavra vai para o lado mais perto dela.
- O texto de uma cena que não foi achado na gravação vira aviso, e a cena vai pelas pausas; achado em menos da metade,
  aviso para conferir o corte. As palavras que começam depois do fim do arquivo (transcrição de outra tomada) ficam de
  fora, com aviso.

**O corte nunca cai no meio de uma palavra.** O trecho de cada cena vai de 200 ms antes da primeira palavra dela
(`margem_corte_ms`) a 200 ms depois da última, sem passar do meio da pausa vizinha nem do fim do arquivo (a medida do
envelope, quando há). As palavras sobrepostas que o whisper às vezes devolve são postas em ordem antes, e o fim de uma não
passa do começo da seguinte.

**A aplicação** (`patchDaDivisao`) não corta o arquivo. **Decisão:** o modelo já tem trecho de fonte no clipe
(`corte_ms` e `duracao_ms`, os mesmos da lâmina do Som), então cada cena ganha um clipe de voz que toca o trecho dela da
mesma gravação, marcado com `narracao_gravada` {cena} e nomeado "Fala da cena N".

- O clipe da gravação inteira que estava no vídeo sai, e os pedaços herdam dele a faixa, o volume, o mudo e a voz limpa
  (o `.limpo.wav` tem os mesmos tempos do original). Sem clipe no vídeo, os pedaços vão para a primeira faixa de voz
  vazia, ou para uma faixa nova "Narração".
- Dividir de novo a mesma gravação troca os pedaços da divisão anterior, sem duplicar. A fala por IA das cenas que ganham
  trecho sai, com aviso (o WAV fica no cache; Reverter traz de volta).
- A duração de cada cena com trecho é a conta do "Ajustar as cenas à fala": folga + trecho + margem (a da configuração,
  500 ms, ou `margem_ms`). O resto do som anda com as cenas, pela mesma conta. Os pedaços ficam no começo da cena mais
  a folga, mesmo com `audio.acompanha_cenas: false`. A cena sem fala na proposta fica como estava.
- As legendas de cada pedaço são geradas da transcrição, no estilo das que já existem (ou o padrão), com o dicionário da
  casa e o do vídeo; as do clipe inteiro saem. Assim `em_palavra` e `sai_palavra` acham a fala de cada cena.
- Tudo num patch só: uma entrada no diário, e Ctrl+Z ou Reverter desfaz.
- Depois, o "Ajustar as cenas à fala" conta os pedaços como a fala da cena, como conta a fala gerada.

**Na tela:** sem nada selecionado, o inspetor do vídeo tem a seção **Narração gravada inteira**. Ela traz a lista das
gravações (as dos clipes de voz primeiro, depois os áudios e vídeos de `midia/`, sem os da narração por IA) e "Dividir nas
cenas…", que transcreve no PC se ainda não há transcrição. A proposta mostra o trecho e o que cada cena fala, com os
avisos, e tem Aplicar e Cancelar. No inspetor da cena, a seção da fala diz "gravada" e não oferece gerar.

**Pelo MCP:** `transcrever {arquivo}` e depois `dividir_narracao`, primeiro com `previa: true` (só a proposta, para mostrar
à pessoa) e depois sem ela. Sem `arquivo`, vale a única gravação nos clipes de voz; com a gravação em mais de um clipe,
pede o `clipe`. Sem transcrição, o erro diz o `transcrever` a chamar.

**Não conferido:** com fala de verdade (os testes usam transcrições sintéticas, `testes/narracao-inteira.test.ts`) e no
app aberto (a tela foi vista na prévia web, com a transcrição simulada).

## Limites conhecidos

- **Sem chave real no desenvolvimento:** tudo foi testado com HTTP falso (`testes/fixtures/narracao-falsa.ts`), com o bundle
  stdio rodado contra um `fetch` falso e com a tela na prévia web. O formato exato do Gemini 3.8 e o som de verdade só se
  confirmam no teste ao vivo, abaixo.
- **Gemini:**
  - não marca o tempo de cada palavra: as legendas vêm do `transcrever`;
  - não aceita fonema: a pronúncia vem do dicionário de texto;
  - a fala pode variar de uma tomada para outra (`refazer` pede outra);
  - os modelos 3.8 saíram em setembro de 2026 e podem mudar.
- **Cloud TTS:** 5000 bytes por pedido; o app não divide a cena sozinho.
- **Uma geração por vez** na tela. O MCP gera uma cena por vez, sem paralelo, para não estourar a cota.
- **Não fica desatualizada:** trocar a duração da cena, porque a fala entra no começo dela e o som anda com a cena.

## Teste ao vivo (com a chave real)

Custa menos de US$ 0,01 no Gemini e cabe no milhão grátis do Cloud TTS. Nada toca em `~/Estudio`: o roteiro cria um projeto
numa pasta temporária.

```bash
npm run mcp:build
# 1) só a prévia: sem chave e sem custo
node scripts/narracao-ao-vivo.mjs --so-previa
# 2) Gemini 3.8 Flash TTS (a mesma chave das conversas)
GEMINI_API_KEY=… node scripts/narracao-ao-vivo.mjs
GEMINI_API_KEY=… node scripts/narracao-ao-vivo.mjs --modelo gemini-3.8-flash-lite-tts --voz Kore --estilo "animado, mas claro"
# 3) Google Cloud TTS, Chirp 3: HD
GOOGLE_TTS_API_KEY=… node scripts/narracao-ao-vivo.mjs --provedor google-tts --voz Kore --velocidade 1.1
```

O roteiro chama, pelo MCP por stdio (`node dist-mcp/nucleo.cjs --projeto <pasta>`), nesta ordem:

1. `configurar_narracao`;
2. `pronuncias_narracao` (PIN → pin, RH → erre agá);
3. `narrar {previa: true}`;
4. `vozes_narracao`;
5. `narrar`;
6. `narrar` de novo (tem de dizer "nada a gerar": o cache pegou);
7. `ajustar_cenas_a_fala`.

No fim, ele mostra o cabeçalho de cada WAV e a pasta para ouvir. O que conferir:

- **Pronúncia:** o "pin" e o "erre agá" saem como no dicionário.
- **Pausa:** a `[pausa]` da cena 2 aparece.
- **Formato do Gemini:** o roteiro mostra, por fala, "pedido no formato doc-3.8" (o da doc de hoje) ou "anterior" (o
  Google recusou um campo novo e o segundo pedido resolveu). Isso também fica na ficha, em `formato_pedido`.
- **Erros:** troque a chave por uma errada e veja a mensagem "foi recusada". Peça uma voz inexistente
  (`--voz pt-BR-Chirp3-HD-Nada` com `--provedor google-tts`) e veja "a voz … não existe".

**No app** (`ESTUDIO_PROJETO=<pasta do roteiro> npm run dev`, ou o instalado):

1. Abra Configurações › IA, seção Narração por IA. O Gemini aparece com a chave dele. Cole a chave do Cloud TTS em "Testar e
   gravar": deve aparecer "chave aceita (N vozes…)".
2. No vídeo, abra "+ Áudio" › "Narração por IA…". Troque a voz (a lista vem da API) e clique em "Ouvir amostra".
3. Mude o texto de uma cena: só ela vira "desatualizada". Clique em "Gerar todas" e confira o custo no aviso antes. As falas
   entram na faixa de voz, e a música (se houver) cai sob elas.
4. Ctrl+Z tira as falas. Gere de novo: sai do cache, sem custo.
5. Clique em "Ajustar as cenas à fala" e depois em "Criar legendas" (precisa do whisper-cli).
6. Peça ao Claude "narre as cenas com a voz Kore". O cartão de permissão aparece para `narrar`, e a prévia não pede cartão.

## Arquivos

| Arquivo | O quê |
|---|---|
| `src/nucleo/narracao.ts` | modelo, padrões, validação, pronúncias, pausas, hash, medida, erros, PCM/WAV (puro; a tela importa) |
| `src/nucleo/narracao-gemini.ts` | Gemini TTS: pedido, resposta, formato anterior, vozes (fetch injetável) |
| `src/nucleo/narracao-cloud-tts.ts` | Cloud TTS: pedido, LINEAR16, limite de bytes, vozes/teste da chave (fetch injetável) |
| `src/nucleo/narracao-cenas.ts` | estado de cada cena, a fala na faixa de voz, ajustar as cenas à fala (puro) |
| `src/nucleo/narracao-servico.ts` | gerar com cache, envelope, ficha, prévia, vozes, amostra (disco, sem Electron) |
| `src/nucleo/mcp-narracao.ts` | as cinco ferramentas MCP |
| `src/nucleo/narracao-inteira.ts`, `src/nucleo/mcp-narracao-inteira.ts` | a narração gravada inteira dividida nas cenas e `dividir_narracao` (Onda B) |
| `src/renderer/modulos/video/acoes-narracao-inteira.ts` | a seção "Narração gravada inteira" do inspetor do vídeo |
| `src/nucleo/sha256.ts` | SHA-256 puro |
| `src/main/narracao.ts` | o serviço do ambiente (stdio) e o do cofre (app) |
| `src/main/ipc-narracao.ts` | IPC: estado das chaves, chave do Cloud TTS, vozes, prévia, gerar, cancelar, amostra |
| `src/main/ia/precos.ts` | `custoNarracao` e a tabela com a data |
| `src/renderer/modulos/video/NarracaoIA.tsx`, `acoes-narracao.ts` | o painel e as ações |
| `scripts/narracao-ao-vivo.mjs` | o teste ao vivo |
| `testes/narracao*.test.ts` | núcleo e provedores, serviço e MCP, chaves, IPC sem o Electron |

Nenhuma dependência nova. As chamadas são REST com `fetch`: o do Node no stdio e o `net.fetch` do Electron no app.
