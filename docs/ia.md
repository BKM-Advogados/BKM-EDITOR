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

## Chaves

A chave fica só no processo principal. A tela recebe "tem chave", a origem (cofre ou variável de ambiente) e os 4
últimos caracteres. Até a tela de chaves entrar, valem as variáveis de ambiente do PC (`DEEPSEEK_API_KEY`,
`GEMINI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, `MISTRAL_API_KEY`, `XAI_API_KEY`,
`GROQ_API_KEY`). Os testes conferem que nenhuma chave aparece em evento nem na lista de provedores.

## Testes

| Arquivo | O quê |
|---|---|
| `testes/laco-openai.test.ts` | laço próprio contra `fixtures/api-falsa.ts` e o MCP real |
| `testes/acp-cliente.test.ts` | cliente ACP contra `fixtures/acp-falso.mjs` e o MCP real |
| `testes/contrato-ia.test.ts` | a mesma checagem nas três vias (Claude falso, API falsa, ACP falso), catálogo sem chave, nomes de ferramenta |
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
