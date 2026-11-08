# Casca, projeto, mídia e regras (frente Casca, rodada 3)

O que a frente Casca cuida: a janela e o processo principal (instância, queda do renderer), a gravação do projeto, a barra, o
rodapé e a tela inicial, as regras de texto da Cliente e o `.gitignore` e o `CLAUDE.md` do projeto criado. Este doc diz o que
mudou na rodada 3, onde está e como se vê. O painel de mídia entra no marco seguinte e ganha a sua seção aqui.

## O app que não perde trabalho

| Defeito | O que faz agora | Onde |
|---|---|---|
| transversal-D8 | Gravar um JSON com o arquivo preso (OneDrive, antivírus lendo) tenta o rename de novo após 20, 40, 80, 160 e 320 ms (menos de 1 s). Sem sucesso, apaga o `.tmp` e diz em português que o arquivo está em uso. | `src/nucleo/gravar-seguro.ts`, `Projeto.gravarTexto` |
| transversal-D5 | Um Estúdio por pasta de dados. A segunda abertura traz a primeira para a frente (restaura se minimizada) e sai. `ESTUDIO_VARIAS_INSTANCIAS=1` libera uma instância de desenvolvimento ao lado da instalada. | `src/main/janela-segura.ts`, `main.ts` |
| transversal-D6 | O renderer que cai (falta de memória) recarrega a janela; o projeto segue aberto no processo principal e a tela o relê. No máximo 3 recargas por minuto: depois disso um aviso diz que o trabalho já está gravado e pede para reabrir o app. | `src/main/janela-segura.ts`, `main.ts` |
| transversal-D7 | Vídeo (`mp4 mov mkv webm avi m4v mts mxf`) e áudio sem perda (`flac aif aiff`) em `midia/` ficam fora do git por extensão, no `.gitignore` do projeto novo. O resto de `midia/` sai do git acima de 25 MB: antes de cada commit automático a sessão acrescenta o caminho exato ao `.gitignore`. O que já entrou no histórico continua nele. Os JSON ao lado (transcrições, envelopes) seguem versionados. | `src/nucleo/midia-git.ts`, `SessaoProjeto.ignorarMidiaPesada` |

## Teclas, avisos e telas

- **transversal-D4.** Ctrl+O, Ctrl+N e Ctrl+W valem só fora do terminal: com o foco no terminal, o Ctrl+W apaga a palavra. O menu
  do projeto tem os três itens. Ctrl+S, Ctrl+Shift+E, Alt+1 a 4 e Ctrl+' seguem valendo em qualquer lugar. `casca/atalhos.ts`.
- **transversal-D10.** O erro fica 9 s no rodapé, o mesmo prazo da loja (antes o rodapé o escondia aos 4 s). `estado/gravacao.ts`.
- **transversal-D11.** O selo da barra mostra "Salvo", "Gravando…" ou "Não salvo" (com o motivo no título), até uma gravação dar
  certo. `casca/SeloSalvo.tsx`, `loja.gravacao`.
- **transversal-D16.** As edições da pessoa saem uma por vez em cada documento: cada uma lê a versão que a anterior deixou. Se
  mesmo assim uma não entrar e havia edição da própria pessoa na frente, o aviso diz "duas edições seguidas se cruzaram" em vez
  de culpar o agente. `estado/loja.ts` (`aplicar`), `estado/gravacao.ts`.
- **transversal-D17.** Tamanho personalizado de 16 a 7680 px: o campo da tela inicial fica vermelho com o limite enquanto o valor é
  inválido e volta ao limite mais perto ao sair dele; `limitarTamanho` (formatos.ts) também vale na criação do documento, pelo MCP
  e pelo app.
- **transversal-D21.** `scripts/e2e-boas-vindas.mjs` procura "Ver um pronto".

## Regras da Cliente no texto do vídeo

- **transversal-D18.** A frase de fecho que as regras pedem ("Ficou com alguma dúvida? Procure um advogado trabalhista.", também sem o
  ponto final) não recebe o aviso de "advogado". O resto do texto continua sendo checado.
- **transversal-D19.** Termo que termina em símbolo (`r$`, `100%`) não exige fronteira depois: "R$500" avisa como "R$ 500".
- **transversal-N5.** `checar_texto` de um vídeo de cenas passa as legendas pelas regras (`onde: "legenda <id>"`, com a quebra de
  linha tratada como espaço) e a frase de fecho vale se vier no último bloco **ou** na última legenda (por `sai`).

## CLAUDE.md do projeto

- **imagem-N3.** O `CLAUDE.md` à mão do modelo "Carrossel narrado Cliente" leva, entre `<!-- estudio:imagem:inicio -->` e
  `<!-- estudio:imagem:fim -->`, a lista de imagem do app (camadas, páginas, sombra, contorno, degradê, máscara, `remover_fundo`).
  O bloco é refeito ao abrir; o texto à mão fora dele não é tocado; projeto da Cliente antigo ganha o bloco no fim; projeto sem módulo
  de imagem não o recebe.
- **imagem-N5.** Ao trocar o texto sem marcas da 0.2.0 ou 0.3.0 pelo novo, as linhas que o app nunca escreveu vão para a seção
  "Anotações do texto anterior" em vez de sumir. A lista do que o app escreveu está em `src/nucleo/claude-md-antigo.ts` (gerada
  do `claudeMd` dos commits `c0407e5`, `63416c0` e `580050c`).

## Ferramentas MCP e permissão

Esta parte não cria ferramenta nova. Muda a saída de uma que existe: `checar_texto` (classe `livre`, só lê) agora devolve avisos
das legendas e `ultima_frase.termina` considera a última legenda.

## Para o guia da IA

Texto para a coordenação juntar no `claudeMd` (item 6 da seção "Pesquisa"): "`checar_texto` também confere as legendas do vídeo de
cenas; a frase de fecho vale dita na última cena ou na última legenda."

## Não verificado

Nada disto rodou no Electron de verdade (o de desenvolvimento não abre neste PC): a instância única, a recarga do renderer, o
selo e os campos de tamanho foram testados na lógica pura (vitest) e pelo typecheck. O que o responsável confere no app: abrir o Estúdio
duas vezes (a segunda só traz a primeira para a frente); digitar 9000 no tamanho livre; Ctrl+W dentro do terminal; segurar
Alt+seta na pilha de efeitos (sem aviso de "outra mão"); um erro de gravação deixa o selo em "Não salvo".
