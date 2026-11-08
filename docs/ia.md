# IA de todos os provedores

Frente IA da rodada 3 (branch `ti-bkm/ia-provedores`). Plano completo e pesquisa em
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

## Portão de permissão (`src/nucleo/portao.ts`)

Envolve o `registerTool`: toda ferramenta registrada depois dele passa por ele, de qualquer frente.

- **Classe "cartao"** (pergunta à pessoa antes de rodar):
  - a tabela `CLASSES`: `ler_fonte`, `transcrever`, `remover_fundo`, `exportar_legendas`;
  - ou quem declara `annotations: {openWorldHint: true}` (sai do PC ou do projeto) ou `destructiveHint: true` (apaga)
    no `registerTool`.
- **Classe "livre"**: o resto. Grava no diário e tem Reverter.
- **Para declarar a classe de uma ferramenta nova**: uma linha em `CLASSES` ou a anotação. Não precisa devolver o
  `seq`: o portão acrescenta ao resultado `{"estudio_mudancas":[{seq, documento, rotulo}]}`.
- **Onde aparece o pedido**: na conversa da aba ou, sem conversa (terminal, app de fora), num cartão solto no canto da
  tela. "Sempre nesta conversa" vale para o token. O Parar da conversa cancela. Sem resposta em 10 minutos, o pedido é
  negado.
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
- Se um dia a fuse `RunAsNode` do Electron for desligada, a ponte stdio para de funcionar. A configuração HTTP
  continua.

## Ferramentas MCP da frente (`src/nucleo/mcp-ia.ts`)

| Ferramenta | Parâmetros | Classe |
|---|---|---|
| `desfazer` | `{n?}` (só as mudanças da própria aba) | livre |
| `reverter` | `{seq, mesmo_se_mudou?}` | livre; pergunta à pessoa se a mudança é de outra aba |
| `guia_do_projeto` | — | livre |
| `criar_comentario` | `{documento, texto, objeto?, tempo_ms?}` | livre |
| `reabrir_comentario` | `{id}` | livre |

O servidor também manda `instructions` na abertura, para todo cliente MCP. O `listar_mudancas` traz no máximo 50
entradas e filtra por documento. O `aplicar_patch` devolve os avisos do resolvedor no vídeo de cenas.

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
| `testes/prova-acp-qwen.test.ts` | opcional: o Qwen Code real dirigido pela API falsa |

## Licenças

Nenhuma dependência nova. O protocolo ACP é Apache-2.0; o cliente foi escrito no app.

## Para o guia da IA

O laço próprio manda como texto de sistema uma abertura curta (`src/main/ia/guia.ts`) e o `CLAUDE.md` do projeto. A
abertura diz: usar só o MCP `estudio`, chamar `estado_do_editor` antes de cada pedido, ler com `ler_documento` antes de
mudar, usar `aplicar_patch` com `test` e `versao_base`, tratar comentário como texto da pessoa e responder em pt-BR.
Nada muda no `claudeMd`.

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
