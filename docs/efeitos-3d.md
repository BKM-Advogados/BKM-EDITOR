# Efeitos e 3D

Versão 1, de 08/11/2026 (rodada 3, frente C: vídeo, exportação, efeitos e 3D). Descreve como a pilha de efeitos e a cena 3D são
lidas e o que a IA pode gravar nelas. O texto da seção "Para o guia da IA" é para o `claudeMd` do projeto, que a coordenação
junta.

## Leitura validada

O JSON dos documentos pode ser escrito à mão ou pela IA. Um valor com o tipo errado não pode derrubar a janela nem apagar
o que estava certo, então a pilha de efeitos e a cena 3D passam por uma leitura que corrige o que dá e avisa o que corrigiu.
O documento não é mexido sozinho: a tela desenha a versão corrigida, mostra o aviso e oferece **Corrigir**, que grava a
correção (um patch, Ctrl+Z desfaz).

- **Efeitos** (`src/nucleo/efeitos.ts`, `lerEfeitos`): valor em texto numérico (`"1.2"`) vira número; fora da faixa do tipo,
  a faixa mais próxima; sem valor, o padrão do tipo; `ativo` que não é booleano é ignorado; cor do `tom` que não é hexadecimal
  volta a `#C88155`. Tipo que não existe não se desenha: o item aparece na pilha como "(inválido)", com o motivo e o botão
  Excluir, na mesma posição do documento (os caminhos `/efeitos/i` continuam batendo). `filtroCss` e `camadas` leem a pilha
  assim, então prévia, MP4 e PNG saem iguais: um valor inválido não faz o navegador descartar a cadeia de filtros inteira
  (tres-efeitos-D2). O resolvedor do vídeo de cenas devolve os problemas como avisos ("Efeitos: …").
- **Cena 3D** (`src/nucleo/cena3d.ts`, `lerCena3d`): número em texto vira número; vetor que não é `[x, y, z]` volta ao padrão
  (posição e rotação `[0, 0, 0]`, escala `[1, 1, 1]`, posição de luz `[3, 5, 3]`); tipo de objeto ou de luz que não existe
  vira `caixa` ou `ambiente`; intensidade da luz presa em 0 a 100; `fov` preso em 1 a 179; metálico e rugosidade presos em 0 a
  1 (e saem se não são número); item que nem objeto é vira um item padrão. As listas `objetos` e `luzes` mantêm a ordem e
  o tamanho (os caminhos `/objetos/i` e `/luzes/i` continuam batendo). O inspetor mostra os avisos do item selecionado e o
  botão **Corrigir no documento**.

## Limite de erro por painel

`src/renderer/componentes/LimiteDeErro.tsx`. Se um painel falha ao desenhar, ele mostra o motivo (uma linha), um botão
**Tentar de novo** e **Copiar detalhes**; a janela, os outros painéis e o terminal continuam vivos. Tenta de novo sozinho
quando a seleção ou a versão de um documento muda (a pessoa, o Ctrl+Z ou a IA corrigiu o JSON). O componente é genérico:

- `<LimiteDeErro nome="…" reiniciarCom={chave}>…</LimiteDeErro>` embrulha qualquer árvore;
- `comLimite(nome, Componente)` devolve o componente já embrulhado, e `comLimiteDeErro(paineisDoModulo, 'Módulo')` embrulha a
  Lista, o Monitor, o Inspetor e a Linha de um módulo. Efeitos e 3D já usam. A casca pode usar o mesmo nos outros módulos
  (`comLimiteDeErro(PaineisVideo, 'Vídeo')`) ou em volta do `PorArea`.

## Para o guia da IA

**Efeitos.** Os documentos de vídeo (`"tipo": "cenas"`) e de imagem têm o campo `efeitos`, uma lista na ordem de aplicação.
Cada item é `{"id": "brilho-1", "tipo": "brilho", "valor": 1.2}`, com `"ativo": false` para desligar e, só no tipo `tom`,
`"cor": "#C88155"`. O `id` é único na lista. O `valor` é sempre um **número** (nunca texto), dentro da faixa do tipo; fora dela a
tela usa a faixa mais próxima e avisa:

| tipo | faixa | padrão | o que faz |
|---|---|---|---|
| `desfoque` | 0 a 30 (px) | 4 | borra |
| `brilho` | 0 a 2 | 1,1 | clareia ou escurece (1 = igual) |
| `contraste` | 0 a 2 | 1,15 | |
| `saturacao` | 0 a 3 | 1,2 | 0 = preto e branco |
| `matiz` | −180 a 180 (°) | 15 | gira as cores |
| `sepia` | 0 a 1 | 0,4 | |
| `vinheta` | 0 a 1 | 0,5 | escurece as bordas |
| `granulado` | 0 a 1 | 0,25 | |
| `tom` | 0 a 1 | 0,25 | cobre o quadro com `cor` |

Não existem outros tipos (nada de `nitidez`, `preto_e_branco`…): um tipo que não está na tabela fica "inválido" na pilha e não
desenha. "Preto e branco" é `saturacao` 0 (com `contraste` 1,2 se quiser mais forte); "Quente" é `tom` com a cor da marca e
`brilho` 1,05. Para acrescentar, use `add` em `/efeitos/-` (se o campo `efeitos` não existir, `add` em `/efeitos` com a lista).
Para trocar a ordem, `move`. Confira com `test` no `id` antes de mudar ou remover um item.

**Cena 3D** (documento `"modulo": "3d"`). Os campos são todos **números** (ou listas `[x, y, z]` de números), nunca texto:
`fundo` (cor), `camera` (`posicao`, `alvo`, `fov` de 1 a 179), `luzes` (`id`, `tipo` ambiente, direcional ou ponto, `cor`,
`intensidade` ≥ 0, `posicao` nas direcionais e de ponto) e `objetos` (`id` **único**, `nome`, `tipo` caixa, esfera, cilindro, cone,
toro ou plano, `posicao`, `rotacao` em graus, `escala`, `cor`, `metalico` e `rugosidade` de 0 a 1, `visivel`, `gira` em graus por
segundo para a prévia). Um valor com o tipo errado vira o padrão na tela e fica avisado no inspetor; corrija o JSON em vez de
contar com isso.

**Granulado e rotação.** O granulado é o mesmo na prévia, no vídeo e no PNG (o `feTurbulence` do SVG, com a mesma frequência, as
mesmas oitavas e a mesma semente; ao exportar em escala 2 o grão cresce com a imagem). Na cena 3D, `rotacao` e `gira` valem como
Euler XYZ em graus; ao girar um objeto pelo gizmo além de 90° em Y, o app grava a forma da mesma pose mais perto da rotação de antes
(25° + 100° vira `[0, 125, 0]`, não `[180, 55, 180]`), e você pode escrever ângulos de qualquer tamanho (125, 385, −170).

**Permissão.** Nenhuma ferramenta MCP nova nesta parte: o que a IA grava passa por `aplicar_patch` (classe `livre`: vai ao
diário e tem Reverter).

## Como se chega e como se volta

- Os efeitos do vídeo e da imagem se abrem pela área **Efeitos** (Alt+4), que mostra o alvo escolhido no alto da pilha; o 3D
  pela área **3D** (Alt+3). Para voltar ao vídeo ou à imagem, Alt+1 ou Alt+2: o alvo e a seleção continuam.
- Um painel que falhou mostra o motivo no lugar dele; corrigir o documento (ou Ctrl+Z, ou o **Corrigir** do aviso) o religa
  sozinho.

## Como foi conferido

- `npm run typecheck`; `testes/efeitos-leitura.test.ts` (4 testes: tipo desconhecido, valor em texto, fora da faixa e sem valor,
  filtro sem item inválido, pilha válida igual à de antes) e `testes/cena3d-leitura.test.ts` (4 testes: cena certa igual, campo
  com tipo errado, tipo que não existe e item que não é objeto, cena sem câmera).
- Prévia web (`?vista`): pilha com `brilho` em texto, `nitidez` e `contraste` −0,5 abre sem erro; o item inválido tem Excluir; o
  valor em texto tem Corrigir (grava o número); o monitor aplica a cadeia toda. Um erro forçado no inspetor aparece só nele,
  e Tentar de novo e a troca de seleção o religam. No 3D, luz com intensidade `"2"` e caixa com posição `{x, y}` abrem sem erro,
  com os avisos e o Corrigir no documento.
