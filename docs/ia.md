# IA de todos os provedores

Frente IA da rodada 3. Plano completo e pesquisa em
`tasks/estudio-ia-provedores-2026-11-07/` (fora do repositório). Princípios em `tasks/estudio-acompanhamento/principios.md`.

## O objetivo

A pessoa conversa com qualquer IA, em qualquer módulo, pelo painel ou pelo terminal, e todas editam pelo mesmo MCP
`estudio`, com o mesmo cartão de permissão, o mesmo "Ver" e "Reverter" e o mesmo diário. Dois padrões:

- **Padrão Cline** (a IA dentro do app): a pessoa escolhe o provedor numa lista e põe a chave, ou aponta um endereço.
- **Padrão Screenpipe** (a IA de fora entra no app): Claude Desktop, Cursor, Cline e outros se conectam ao MCP
  `estudio` do projeto aberto, com o mesmo portão (marco seguinte).

## As três vias (`src/main/ia/`)

| Via | Arquivo | Para | Processo |
|---|---|---|---|
| `claude-cli` | `../conversa.ts` (sem mudança) | Claude pela conta da pessoa | um `claude -p` por conversa |
| `openai` | `laco.ts` | qualquer API de chat no formato da OpenAI: DeepSeek, Gemini (endpoint compatível), OpenAI, Anthropic (compatível), OpenRouter, Mistral, xAI, Groq, Ollama, LM Studio, outro endereço | nenhum: laço no processo principal |
| `acp` | `acp.ts`, `motor-acp.ts` | agentes que a pessoa já tem: Gemini CLI, Qwen Code, opencode, goose, Antigravity | o agente dela, com a configuração e o login dela |

`sessoes.ts` junta as três atrás de uma interface só (`abrir`, `enviar`, `permitir`, `parar`, `hibernar`, `fechar`).
Os eventos para a tela são os mesmos (`EventoConversa`, em `src/compartilhado/api.ts`), com o evento novo `uso`
(tokens do turno e custo, quando o provedor informa). O catálogo fica em `provedores.ts`; o modelo padrão só vem
preenchido onde foi conferido na fonte (DeepSeek `deepseek-flash`, Gemini `gemini-3.6-flash`, em 07/11/2026).

### Por que laço próprio e não um agente embutido (F0, 08/11/2026)

- O laço próprio passou nos 4 testes contra a API falsa e o MCP de verdade: com chave, modelo local sem chave, chave
  recusada e parar. Isso inclui o `reasoning_content` que o DeepSeek exige de volta nos turnos com ferramenta. Não
  traz dependência nova nem processo a mais por conversa.
- O cliente ACP passou nos 3 testes contra um agente ACP falso que usa o MCP vindo do cliente: permitir, negar e
  cancelar.
- O Qwen Code, que o plano previa embutir, tem 156 MB descompactado (medido). Rodá-lo é rodar código de terceiro, e o
  modo automático deste PC bloqueou a prova. A prova com ele fica opcional: `ESTUDIO_QWEN=<caminho do cli-entry.js>
  npx vitest run testes/prova-acp-qwen.test.ts`.
- Cliente ACP escrito à mão (cerca de 150 linhas), sem o `@agentclientprotocol/sdk`. O SDK traria 9 MB de esquemas num
  módulo só-ESM, e o app usa só 8 métodos. Os formatos seguem o `schema/v1/schema.json` do SDK 2.4.0 (Apache-2.0).

## Nome da ferramenta e rótulo da aba

- `src/compartilhado/ferramentas.ts` tira o prefixo de cada agente (`mcp__estudio__`, `estudio__`, `estudio_`, o título
  "x (estudio MCP Server)") e dá às ferramentas internas um nome comum (`shell`, `ler_arquivo`, `editar_arquivo`…). O
  cartão da conversa usa esse nome.
- O rótulo da aba ("Claude 1", "DeepSeek 1", "Gemini CLI 1") vira a origem no diário e o aviso "DeepSeek 1: rótulo".

## Chaves, Configurações › IA e custo

- Cofre: `src/main/ia/cofre-arquivo.ts`. A chave fica cifrada pelo `safeStorage` (DPAPI no Windows) em
  `%APPDATA%\Estudio\ia\chaves.json`. Sem cifra, vale só na sessão. A chave só vive no processo principal. A tela
  recebe "tem chave", a origem (cofre ou variável de ambiente, como `DEEPSEEK_API_KEY`) e os 4 últimos caracteres.
- Antes de gravar, a chave é testada na lista de modelos do provedor (`GET /models`), que não gasta token. Na
  Anthropic, o teste é no `/v1/models` nativo, com `x-api-key`. Chave recusada (401/403) não grava; sem rede, grava e
  avisa.
- Configurações › IA (`src/renderer/paineis/ConfigIA.tsx`), aberta pelo menu "+ Conversa" → "Provedores e chaves…".
  Mostra os provedores e o que falta em cada um, e permite trocar o modelo (da lista do próprio endereço), o endereço
  (no compatível e nos locais) e o provedor padrão. Embaixo ficam os apps de IA de fora e o uso do mês.
- Custo: tabela em `src/main/ia/precos.ts`, conferida em 07 e 08/11/2026. O DeepSeek tem pico e fora de pico; o
  Gemini troca de preço por data. O evento `uso` ganha o custo estimado, e a soma do mês fica em
  `%APPDATA%\Estudio\ia\uso-AAAA-MM.json`.
- Seletor de modelo na caixa da conversa: vale na próxima mensagem. No Claude, o processo volta com `--resume` e
  `--model`. Agente ACP usa o modelo da configuração dele.

### Chaves da narração por IA (docs/narracao.md)

- **Gemini TTS** usa a **mesma chave** do provedor `gemini` (Configurações › IA › Gemini (chave)), com as variáveis
  `GEMINI_API_KEY` e `GOOGLE_API_KEY` como reserva. Não há chave nova. Na seção "Narração por IA" aparecem o estado dela
  e o aviso do plano gratuito: sem cobrança, o Google pode usar o texto e o áudio.
- **Google Cloud TTS** (vozes Chirp 3: HD) tem uma credencial nova no cofre, `google-tts`, com a variável de reserva
  `GOOGLE_TTS_API_KEY`. O fluxo é o das outras chaves: testar, cifrar e mostrar só os 4 últimos caracteres.
  - O teste é `GET https://texttospeech.googleapis.com/v1/voices?languageCode=pt-BR`, que não custa nada.
  - Recusada (400 `API_KEY_INVALID`, 401 ou 403), não grava.
  - Com a API desativada no projeto da chave (403 `SERVICE_DISABLED`), não grava, e a mensagem diz onde ativar.
  - Sem rede, grava e avisa.
- O `google-tts` não entra no catálogo `PROVEDORES` (não é de conversa): a seção própria fica em `ConfigIA.tsx`, e o IPC
  em `src/main/ipc-narracao.ts`, que lê o cofre por `cofreAtual()` de `ipc-ia.ts`.
- A chave só vive no processo principal. A tela pede "gerar" e recebe o resultado. O MCP por HTTP recebe o mesmo serviço
  (`definirNarradorMcp`); o MCP por stdio lê as variáveis de ambiente (`servicoDoAmbiente`).
- Custo: `custoNarracao` em `precos.ts` (tabela de 10/11/2026). No Gemini conta por tokens de texto e de áudio (25 por
  segundo), e o preço dobra em 01/01/2027. No Cloud TTS conta por caractere (US$ 30 por milhão, 1 milhão grátis por mês).
- O uso do mês entra como `gemini-tts` (tokens) e `google-tts` (caracteres).

## Portão de permissão (`src/nucleo/portao.ts`)

Envolve o `registerTool`: toda ferramenta registrada depois dele passa por ele, de qualquer frente.

- **Classe "cartao"** (pergunta à pessoa antes de rodar):
  - a tabela `CLASSES`: `ler_fonte`, `transcrever`, `remover_fundo`, `exportar_legendas`, `destravar_camadas`,
    `exportar_musica`, `importar_midi`, `escolher_trilha`, `narrar` e `vozes_narracao` (narração por IA);
    `exportar_video`, `exportar_imagem` e `exportar_carrossel` (exportação final, `docs/exportacao.md`);
    `importar_midia`, `criar_projeto`, `abrir_projeto`, `duplicar_projeto`, `fechar_projeto`, `criar_marca`,
    `editar_marca`, `importar_logo_marca` e `importar_fonte_marca` (mídia, projeto e marca); `salvar_como_modelo`
    (grava na pasta de modelos da pessoa, `docs/casca.md`); `aprovar_plano` (o Plano do vídeo, abaixo);
  - ou quem declara `annotations: {openWorldHint: true}` (sai do PC ou do projeto) ou `destructiveHint: true` (apaga)
    no `registerTool`.
- **Classe "livre"**: o resto. Quando muda um documento que já existe, grava no diário e tem Reverter. Criar documento
  (`criar_documento`, `criar_animacao`) não entra no diário (o app não tem "excluir documento" para reverter): o
  documento novo aparece na tela da pessoa (veja "A tela da pessoa" abaixo).
- **Para declarar a classe de uma ferramenta nova**: uma linha em `CLASSES` ou a anotação. Não precisa devolver o
  `seq`: o portão acrescenta ao resultado `{"estudio_mudancas":[{seq, documento, rotulo}]}`.
- **Livres declaradas em `CLASSES`**, para constar: `listar_modelos` (só lê) e `dividir_narracao` (a narração gravada
  inteira dividida nas cenas: só muda o documento, com diário e Reverter; `docs/narracao.md`).
- **`livreSe`** na linha de `CLASSES`: o pedido que não sai do PC roda sem cartão. Hoje vale para `narrar` com
  `previa: true`, que só devolve o texto final e o custo estimado.
- **Onde aparece o pedido**: na conversa da aba ou, sem conversa (terminal, app de fora), num cartão solto no canto da
  tela. "Sempre nesta conversa" vale para o token. O Parar da conversa cancela. Sem resposta em 10 minutos, nada roda
  e a IA recebe `SEM_RESPOSTA` ("ninguém respondeu"), não "a pessoa negou".
- **Pedido vindo do Claude Code ou do Claude Desktop (13/11/2026)**: a pessoa está olhando o cliente, não a janela do
  app. A ponte (`mcp-desktop.ts`) pergunta na tela do cliente pela confirmação do próprio MCP (elicitação) e, se a
  pessoa permitir, repassa ao app com `_meta["estudio/permitido_no_cliente"] = true`. O app só aceita essa marca nas
  conexões que ele mesmo criou para as pontes (token da IDE e token da descoberta do Claude Desktop); um app de fora que
  mande a marca continua passando pelo cartão. Cliente sem elicitação: vai como antes, com o cartão do app.
- **Reverter por `seq`**: o cartão de qualquer provedor e o Histórico usam `Projeto.reverter`. Antes de reverter, ele
  confere que os valores trocados ainda estão lá. Se mudaram, devolve `mudou_depois`, e só passa por cima com
  `forcar`. O Ctrl+Z (`desfazerUltima`) lembra o que já desfez pelo campo `desfaz` da entrada.

## Apps de IA de fora (padrão Screenpipe, `src/main/ia/apps-de-fora.ts`)

- Desligado por padrão. Ligado, abre uma porta fixa (47815, ajustável) só em `127.0.0.1` e só com `/mcp`. Recusa pedido
  de página web (cabeçalho `Origin`) e `Host` diferente de `127.0.0.1:<porta>` ou `localhost:<porta>`.
- Cada app tem um token próprio no cofre, que vira a origem no diário ("Cursor") e passa pelo mesmo portão. O token
  sobrevive a fechar o projeto e a reabrir o app. Revogar corta o acesso na hora.
- Configuração pronta para copiar:
  - **HTTP**, para Cursor, Cline, Windsurf e VS Code;
  - **stdio**, para o Claude Desktop e quem só aceita stdio. Usa a ponte `mcp/ponte.mjs` (gerada em
    `dist-mcp/ponte.cjs` pelo `mcp:build`), rodada pelo próprio Estúdio com `ELECTRON_RUN_AS_NODE=1`. A escrita passa
    pelo app, com diário e portão, e não pelo MCP de arquivo.
    A ponte repassa cada mensagem na hora (pedidos em paralelo): uma chamada lenta não segura o `ping`. O
    `notifications/cancelled` (o Parar do cliente) aborta o pedido HTTP dele; o app vê a conexão fechar e cancela a
    ferramenta e o cartão do portão que esperava a pessoa.
- Se um dia a fuse `RunAsNode` do Electron for desligada, a ponte stdio para de funcionar. A configuração HTTP
  continua.
- **Claude Desktop** (2.0.1): não precisa mais desta seção. O app publica um arquivo de descoberta com um token só do
  Claude Desktop, e a extensão `.mcpb` ou o botão "Conectar ao Claude Desktop" fazem o resto, com a origem "Claude
  Desktop" e o mesmo portão. A configuração stdio antiga, com a ponte, segue funcionando, e o botão a troca pela nova.
  Detalhes em `docs/claude-desktop.md`.
- **IDE de agentes** (T3 Code, Claude Code, Cursor): cada projeto leva um `.mcp.json` com o MCP por stdio, sem token e sem
  o app aberto, e o agente vê o vídeo por `ver_quadro`, `ver_cenas` e `ver_trecho` (a imagem e a cena 3D, por `ver_imagem`
  e `ver_cena_3d`, com o app aberto). Mede o som por `medir_loudness` e `medir_envelope` e limpa a voz por `limpar_voz`
  (`docs/audio.md`). Detalhes em `docs/ide.md`. Desde a
  2.0.1, também o guia em `AGENTS.md` e `GEMINI.md` e o MCP de Codex, Gemini CLI, Antigravity, Cursor, VS Code e
  opencode, com a origem de cada um no diário (`--origem`): `docs/harnesses.md`.

## Ferramentas MCP da frente (`src/nucleo/mcp-ia.ts`)

| Ferramenta | Parâmetros | Classe |
|---|---|---|
| `desfazer` | `{n?}` (só as mudanças da própria aba) | livre |
| `reverter` | `{seq, mesmo_se_mudou?}` | livre; pergunta à pessoa se a mudança é de outra aba |
| `guia_do_projeto` | — | livre |
| `criar_comentario` | `{documento, texto, objeto?, tempo_ms?}` (`objeto` tem de existir; `tempo_ms` ≥ 0) | livre |
| `reabrir_comentario` | `{id}` | livre |

O servidor também manda `instructions` na abertura, para todo cliente MCP. O `listar_mudancas` traz no máximo 50
entradas e filtra por documento. O `aplicar_patch` exige `versao_base` não vazia, recusa o patch que deixaria o
documento sem ser objeto ou fora do formato do módulo dele, e devolve os avisos do resolvedor no vídeo de cenas.

## Mídia, projeto e marca (frente 2: `src/nucleo/mcp-projeto.ts`, `src/nucleo/mcp-marca-edicao.ts`)

| Ferramenta | Parâmetros | Classe |
|---|---|---|
| `importar_midia` | `{caminho, pasta?, nome?}` | cartao: traz arquivo de fora |
| `renomear_documento` | `{documento, titulo}` | livre (o manifesto, como `renomear_projeto`; fora do diário) |
| `marcar_ponto_de_restauracao` | `{mensagem?}` | livre: o Ctrl+S, um commit no git do projeto |
| `criar_projeto` | `{nome?, modelo? ou modelo_proprio?, formato?, largura?, altura?, marca?, pasta?}` (`modelo_proprio`: id de `listar_modelos`) | cartao; só fora do app (abaixo) |
| `abrir_projeto` | `{projeto}` (nome ou pasta) | cartao; só fora do app |
| `duplicar_projeto` | `{nome?}` | cartao; só fora do app |
| `fechar_projeto` | — | cartao; só fora do app |
| `listar_marcas` | — | livre: só lê |
| `criar_marca` | `{nome, a_partir_de?}` | cartao: grava na pasta dos kits, fora do projeto e sem diário |
| `editar_marca` | `{marca, nome?, fundo?, texto?, destaque?, suave?, fonte_titulo?, fonte_texto?, fonte_mono?, assinatura?, notas?}` | cartao: idem |
| `importar_logo_marca` | `{marca, caminho}` | cartao: traz arquivo de fora para o kit |
| `importar_fonte_marca` | `{marca, caminho, familia?, peso?, estilo?}` | cartao: idem |
| `listar_modelos` | `{}` | livre: lista os modelos da pessoa (id, nome, módulo, tamanho); o id vai em `criar_projeto {modelo_proprio}` |
| `salvar_como_modelo` | `{nome, descricao?, documento?}` | cartao: grava na pasta de modelos da pessoa, fora do projeto e sem diário (Onda B) |

- **Uma regra para a tela e para a IA.** `importar_midia` e o botão de escolher arquivo da tela (`escolherMidia`, no
  `main.ts`) usam `importarMidia` (`src/nucleo/importar-midia.ts`): as extensões do filtro do diálogo, o arquivo que já
  está no projeto usado no lugar, o nome livre em `midia/` e a recusa quando `midia/` é link para fora. Criar e
  duplicar projeto, na tela e pelo MCP, passam por `src/nucleo/novo-projeto.ts`; o Ctrl+S e o
  `marcar_ponto_de_restauracao`, pelo mesmo commit da sessão (`SessaoProjeto.marcarVersao`; com o app fechado,
  `SessaoProjeto.pontoSemApp`).
- **Áudio importado já medido.** `importar_midia` chama o medidor do envelope (`definirMedidorDeEnvelope`; no app e no
  stdio, `medirEnvelopeDoArquivo` de `src/main/ipc-audio.ts`) e devolve a duração. Se a medida falha, o arquivo fica e
  a resposta avisa que a linha do tempo mede depois.
- **Trocar de projeto só onde a conversa sobrevive.** As quatro de projeto não aparecem para as conversas de dentro do
  app (trocar de projeto as fecharia no meio da resposta). O McpHttp as registra só para os tokens de fora (fixo do
  Claude Desktop e dos apps de fora, e o da IDE) e as atende também sem projeto aberto. A decisão completa, com o app
  aberto e fechado, está em `docs/claude-desktop.md`, "Criar, abrir e trocar de projeto".
- **Kits de marca.** Mesma pasta do painel Marca (`PastaMarcas`: a das preferências no app, `ESTUDIO_MARCAS` ou
  `~/Estudio/marcas` fora dele). Um kit editado não muda sozinho os documentos que já o receberam: `aplicar_marca` de
  novo leva a mudança.

## O Plano do vídeo (Onda B: `src/nucleo/plano-video.ts`, `src/nucleo/mcp-plano.ts`)

Num pedido novo (uma peça do zero, ou refazer o roteiro), a IA não sai montando: pergunta só o que falta (até 3
perguntas, com sugestão de resposta), escreve o Plano do vídeo e espera a pessoa aprovar ou pedir ajuste. Pedido
pequeno (uma cor, um texto, um tempo, um comentário) vai direto. Quem ensina isso é o guia do projeto (seção "Planejar
antes de montar", antes de "Como trabalhar") e as `instructions` do servidor; nada bloqueia a montagem.

| Ferramenta | Parâmetros | Classe |
|---|---|---|
| `ler_plano` | — | livre: o plano, o `estado`, a `revisao`, o texto em markdown e o `proximo_passo` |
| `escrever_plano` | `{objetivo, publico, formato_e_duracao, roteiro: [{cena, mostra, fala?, duracao_s?}], midia_usar?, midia_falta?, narracao, musica, notas?}` | livre: grava em `plano.json`, com diário e Reverter; a revisão sobe e o estado volta a `aguardando` |
| `aprovar_plano` | `{revisao}` | cartao: registra a aprovação que a pessoa deu na conversa |

- **Onde mora.** `plano.json`, na raiz do projeto: entra no git com o resto e passa pelo diário como a pesquisa
  (`Projeto.alterarPlano`, `ARQUIVOS_INTERNOS`): o Histórico mostra quem escreveu e quem decidiu, e o Reverter volta
  cada passo (reverter a primeira escrita apaga o plano). O `aplicar_patch` não o alcança (não é documento do
  manifesto). O núcleo é puro, para a tela usar o mesmo tipo e o mesmo texto.
- **Estados.** `aguardando` (escrito, esperando a pessoa), `aprovado` (a IA pode montar) e `ajustar` (com
  `decisao.ajuste`, o que a pessoa pediu). Reescrever volta a `aguardando` e tira a decisão anterior.
- **Revisão.** Cada escrita sobe a `revisao`. Aprovar ou pedir ajuste exige a revisão vista: se a IA reescreveu o plano
  entretanto, a decisão é recusada (`conflito`) e nada grava, para ninguém aprovar um plano que não leu.
- **Com o app aberto.** Abaixo de cada `escrever_plano`, a conversa mostra o cartão do plano (`CartaoPlano` em
  `Conversa.tsx`) com "Aprovar plano" e "Pedir ajuste". O botão grava pelo IPC `decidirPlano` (autor `pessoa`, origem
  `interface`) e manda a decisão à conversa ("Aprovei o plano (revisão 2). Pode montar." ou "Ajuste no plano (revisão
  1): …"), para a IA seguir sem a pessoa digitar. O cartão de uma revisão que já foi reescrita só diz isso. Vale para
  qualquer provedor da conversa (Claude, laço próprio, agente ACP).
- **Sem a tela** (Claude Desktop ou IDE com o app fechado): a pessoa lê o plano na própria conversa e aprova falando; a
  IA registra com `aprovar_plano`. Por isso ele é "cartao": com o app aberto, o portão pergunta à pessoa antes (o
  botão do cartão é o caminho direto); sem o app, não há portão e a aprovação da conversa basta. A decisão fica com
  `por: "pessoa, pela conversa (<origem>)"`.
- **Por que um arquivo e não só a conversa.** O plano precisa sobreviver a hibernar a conversa, trocar de provedor e
  abrir o projeto em outro app (o Claude Desktop lê o mesmo `plano.json`); e o "aprovado" precisa de um lugar que a
  IA consulte antes de montar (`ler_plano`) em vez de depender da memória da conversa.
- **Tela inicial.** O pedido de "Começar conversando" chega à primeira conversa mandando seguir "Planejar antes de
  montar" (antes dizia "faça direto, sem perguntar").

Testes: `testes/plano.test.ts` (núcleo, diário e Reverter, as três ferramentas com e sem portão, e o guia).

## Edição fina (`src/nucleo/mcp-edicao-fina.ts`, frente 4)

O que antes só saía de um `aplicar_patch` grande montado à mão. Cada ferramenta usa a mesma conta do núcleo que o botão
da tela e grava **uma** entrada no diário (desfazer e Reverter voltam a chamada inteira). Todas `livre`: só mexem no
documento. Sem `documento`, valem no que a pessoa está vendo (se for do módulo) ou no primeiro do módulo.

| Ferramenta | Parâmetros | O que faz | Conta (núcleo) |
|---|---|---|---|
| `dividir_cena` | `{em_ms?, cena?, documento?}` | a lâmina (Ctrl+K), no tempo do vídeo; sem `em_ms`, na cabeça | `cenas-dividir.ts` |
| `duplicar_cena` | `{cena, documento?}` | cópia logo depois, com ids novos | `comIdsNovos` (`cenas.ts`) |
| `editar_legendas` | `{op: dividir, juntar, excluir, criar, substituir, estilo, …}` | os botões do painel Legendas; tempos como na tela | `legendas-edicao.ts` |
| `editar_paginas` | `{op: nova, duplicar, mover, excluir, renomear, pagina?, para?, nome?}` | a barra de páginas do carrossel | `carrossel.ts` |
| `animar_entrada`, `animar_saida` | `{camada, preajuste, duracao_ms?, em_ms?}` | as entradas e saídas prontas do inspetor | `animacao-preajustes.ts` |
| `adicionar_efeito` | `{tipo, valor?, cor?}` ou `{preajuste}` | põe na pilha de efeitos do vídeo ou da imagem | `efeitos.ts` |
| `remover_efeito` | `{id}` | tira da pilha | `efeitos.ts` |

Testes: `testes/edicao-fina-mcp.test.ts` (uma entrada no diário por chamada e o desfazer de cada uma).

## A tela da pessoa (`src/nucleo/mcp-tela.ts`)

O pedido de navegação é o `.estudio/selecao.json` (`{documento, caminhos, tempo_ms?, autor, em}`), que a interface segue
(`aplicarSelecaoPedida` em `src/renderer/estado/loja.ts`): troca de área e de documento e seleciona os caminhos.
`tempo_ms` é opcional e retrocompatível: a interface que ainda não o lê ignora.

- **`mostrar_documento`** `{documento, caminho?, tempo_ms?}` (livre): leva a tela a um documento, a um objeto que existe
  ou a um tempo. Documento ou caminho que não existe dá `nao_achado`.
- **Documento criado pelo Claude**: `criar_documento` e `criar_animacao` levam a tela até ele por padrão; com
  `mostrar: false`, não levam. A resposta traz `mostrado`. O parâmetro vem de um envoltório do `registerTool`
  (`instalarMostrarCriado`, como o portão), que vale para as ferramentas de `CRIAM_DOCUMENTO`.
- `selecionar_camadas` usa o mesmo pedido. Sem o app (MCP por stdio puro), o arquivo fica gravado e não faz mal.

## Corpo do pedido HTTP (`src/main/mcp-http.ts`)

- O corpo é juntado em bytes e só depois vira texto: um acento partido entre dois pedaços (pedido acima de ~64 KB) não
  vira U+FFFD.
- Teto de 32 MB: acima disso, 413. JSON inválido: 400 com o erro `-32700` do JSON-RPC. Na porta fixa dos apps de fora,
  uma falha no meio vira 500, nunca cliente pendurado.

## Testes

| Arquivo | O quê |
|---|---|
| `testes/laco-openai.test.ts` | laço próprio contra `fixtures/api-falsa.ts` e o MCP real |
| `testes/acp-cliente.test.ts` | cliente ACP contra `fixtures/acp-falso.mjs` e o MCP real |
| `testes/contrato-ia.test.ts` | a mesma checagem nas três vias, catálogo sem chave, nomes de ferramenta |
| `testes/ia-config.test.ts` | cofre, preços, configuração, teste da chave, custo e seletor de modelo |
| `testes/diario.test.ts` | linha quebrada, seq pelo fim do arquivo, reverter, Ctrl+Z depois de reabrir |
| `testes/portao.test.ts` | portão, seq no resultado, reverter de outra aba, limite do listar, avisos do resolvedor |
| `testes/apps-de-fora.test.ts` | porta fixa, token por app, Origin e Host, ponte stdio, revogar |
| `testes/claude-desktop.test.ts`, `testes/claude-desktop-mcp.test.ts` | Claude Desktop: três sistemas, mesclagem do config, descoberta, lançador, manifesto, ponta a ponta com o `.mcpb` |
| `testes/prova-acp-qwen.test.ts` | opcional: o Qwen Code real dirigido pela API falsa |
| `testes/projeto-mcp.test.ts` | frente 2: importar mídia (filtro, nome livre, link para fora, medida do áudio, portão), renomear documento, ponto de restauração com git, criar, abrir, duplicar e fechar projeto no app, no Claude Desktop e na IDE |
| `testes/marca-mcp.test.ts` | frente 2: listar, criar, editar, importar logo e fonte de kit de marca, e o kit editado no `aplicar_marca` |
| `testes/plano.test.ts` | Onda B: o Plano do vídeo (escrever, decidir, revisão velha, diário e Reverter, portão no `aprovar_plano`, seção do guia) |
| `testes/narracao-chaves.test.ts` | chave do Google Cloud TTS (aceita, recusada, API desativada, sem rede), estado sem a chave, stdio pelo ambiente |

## Licenças

Nenhuma dependência nova. O protocolo ACP é Apache-2.0; o cliente foi escrito no app.

## Para o guia da IA

O laço próprio manda como texto de sistema uma abertura curta (`src/main/ia/guia.ts`) e o `CLAUDE.md` do projeto. A
abertura diz: usar só o MCP `estudio`, chamar `estado_do_editor` antes de cada pedido, ler com `ler_documento` antes de
mudar, usar `aplicar_patch` com `test` e `versao_base`, tratar comentário como texto da pessoa e responder em pt-BR.
O `claudeMd` traz a seção "Planejar antes de montar" (Onda B), que vale para todos os provedores.

## Caminho entre módulos

A conversa e os terminais vivem fora do React e o painel está nas quatro áreas: trocar de módulo não perde a
conversa, com qualquer provedor. A ida e volta com a seleção (`levar_para`, `concluir_transicao`) é da frente Música.

## Conversas guardadas e contexto (F6)

- Cada conversa do painel vai para `.estudio/conversas/<sessao>.json` do projeto a cada fim de resposta. A pasta entra
  no `.gitignore` do projeto na primeira vez.
- Ao abrir o projeto, as 5 conversas mais recentes voltam ao painel como hibernadas, com o que já foi dito, e cada uma
  continua do seu jeito:
  - o Claude volta com `--resume`;
  - o laço próprio volta com o histórico de mensagens;
  - o agente ACP volta com `session/load`.
- Fechar a aba apaga a conversa guardada.
- A caixa de pedido sempre leva o módulo e o documento como contexto, com qualquer provedor.
- Na aba de terminal de um agente, uma faixa mostra o contexto da tela. O botão "Mandar contexto" cola o contexto no
  terminal, para a pessoa mandar com Enter.

## Roteiro de teste no app (10 minutos)

Para o responsável, no Estúdio instalado, com a chave ou a conta dele. Nada aqui foi testado no Electron real.

1. **Abrir.** Abra um projeto qualquer. No painel da IA, clique em "+ Conversa": a lista mostra Claude, DeepSeek,
   Gemini, os outros provedores e o que falta em cada um.
2. **Chave.** Clique em "Provedores e chaves…", abra DeepSeek (ou Gemini), cole a chave e clique em "Testar e gravar".
   Deve aparecer "chave aceita e guardada cifrada neste PC" e o final da chave. Escolha o modelo na lista.
3. **Conversa.** Em "+ Conversa", escolha DeepSeek e peça "deixe o título do vídeo em amarelo". Confira:
   - o cartão "Mudou…" com Ver e Reverter;
   - o rodapé com tokens e custo;
   - no Histórico, a entrada com a origem "DeepSeek 1".

   Clique em Reverter: o título volta.
4. **Permissão.** Peça "leia a página https://www.planalto.gov.br/ccivil_03/decreto-lei/del5452.htm". Deve aparecer
   o cartão "DeepSeek quer abrir uma página da internet". Negue e veja que nada roda; peça de novo e permita.
5. **Seletor de modelo.** Troque o modelo no rodapé da caixa e mande outra mensagem. O aviso diz que o modelo novo vale
   a partir dela.
6. **Fechar e reabrir.** Feche o projeto e abra de novo. A conversa do DeepSeek volta hibernada, com o que foi dito.
   Mande "o que você fez antes?": ela lembra.
7. **App de fora.** Em Provedores e chaves, ligue "Apps de IA de fora", crie "Cursor" (ou "Claude Desktop") e copie a
   configuração para o app. Peça a ele para listar os documentos do projeto e mudar uma cor. No Histórico, a mudança
   aparece com a origem "Cursor". Se ele pedir para ler a web, o cartão aparece solto no canto. Revogue e veja que ele
   perde o acesso.
8. **Claude.** Abra uma conversa com o Claude e peça a mesma mudança de cor: o cartão, o Reverter e o Histórico são
   iguais.

Se algo falhar, anote o passo e a mensagem. O que é do Electron (cofre, cartão solto, ponte stdio, `claude.cmd`) só se
confirma aqui.
