# Acabamento da imagem: sombra, contorno, degradê, máscara e remover fundo

Versão 1, de 07/11/2026. Rodada 2, frente B2 (`tasks/estudio-acompanhamento/rodada-2/B2-imagem.md`): sombra, contorno
e efeitos de texto; degradê no texto, nas formas e no fundo; máscara de recorte (foto dentro de forma ou texto);
remover fundo com um clique, com modelo local. Código: `src/nucleo/acabamento.ts` e `src/nucleo/remover-fundo.ts`
(regras, puras), `src/renderer/modulos/imagem/pintura.ts` (a pintura em canvas), `Acabamento.tsx` (inspector),
`removerFundo.ts` e `removerFundo.worker.ts` (o modelo na interface) e `src/main/remover-fundo.ts` (download e
gravação). Testes em `testes/acabamento.test.ts` e `testes/remover-fundo.test.ts`; a comparação prévia × PNG é o
`scripts/comparar-imagem.mjs`. O carrossel de páginas continua em `docs/carrossel.md`: tudo daqui vale em cada página.

## Formato

Campos opcionais no fim da camada (`CamadaImagem`) e um no documento. Sem eles, a camada e o documento são os de
sempre: a capa da Cliente abre igual, inteira em DOM na prévia.

```json
{
  "id": "titulo", "tipo": "texto", "texto": "Transferência de cidade", "x": 80, "y": 700, "largura": 920, "altura": 250,
  "sombra": {"cor": "#000000", "opacidade": 0.35, "desfoque": 24, "x": 0, "y": 8},
  "contorno": {"cor": "#C88155", "espessura": 6, "posicao": "fora"},
  "degrade": {"tipo": "linear", "angulo": 135, "paradas": [{"cor": "#C88155", "posicao": 0}, {"cor": "#E4B492", "posicao": 1, "opacidade": 1}]}
}
```

| Campo | Onde | O que faz |
|---|---|---|
| `sombra` | texto, forma, imagem | Cor, opacidade (0 a 1), desfoque e deslocamento `x`/`y`, em px do documento. A direção é a da página: a sombra não gira com a camada (como a luz global dos editores). Padrão: preta, 35%, 24 px, 8 px para baixo. Numa imagem com transparência (a foto sem fundo), a sombra segue o recorte. |
| `contorno` | texto, forma, imagem | Cor, `espessura` (px) e `posicao`: `fora` (padrão), `centro` (na borda) ou `dentro`. Cantos redondos. Numa imagem, contorna o que não é transparente: a foto sem fundo vira adesivo. |
| `degrade` | texto e forma | No lugar de `cor` (texto) ou `preenchimento` (forma). `tipo` `linear` (com `angulo`, como no CSS: 180 de cima para baixo, o padrão; 90 da esquerda para a direita) ou `radial` (com `centro` de 0 a 1, padrão o meio, até o canto mais longe). `paradas`: `cor`, `posicao` de 0 a 1 e `opacidade` de 0 a 1. Uma parada só vira cor chapada. Numa imagem é ignorado. |
| `mascara` | imagem | Id da forma ou do texto logo acima que recorta a foto (ver Máscara). |
| `src_original` | imagem | O arquivo de antes do remover fundo; "Voltar ao original" devolve o `src` a ele. |
| `fundo_degrade` | documento | Degradê por cima da cor de `fundo`, na prancheta inteira e em todas as páginas do carrossel (como o `fundo`). |

A geometria do degradê é a do CSS (`linear-gradient`, `radial-gradient(farthest-corner)`), para o Claude escrever o
que já conhece: a linha do linear passa pelo centro e tem o comprimento que leva os cantos às paradas 0 e 1; o radial
é a elipse que passa pelo canto mais longe do centro. Cores em `#RRGGBB` (aceita `#RGB`, `rgb()` e `rgba()`; nome de
cor funciona, mas sem a opacidade da parada).

**Por que `fundo_degrade` está no documento.** O brief pedia campos só na camada e na página. O `fundo` é do documento
(vale para todas as páginas) e uma prancheta só não tem página no arquivo (`docs/carrossel.md`): pôr o degradê na
página obrigaria a virar carrossel para ter um fundo em degradê. Ficou um campo opcional no fim do `DocImagem`, ao lado
do `fundo`. Fundo diferente por página fica para depois (hoje: uma forma do tamanho da página, no fundo da pilha).

## Máscara de recorte

A imagem `i` com `mascara: "<id>"` aparece só dentro da camada `i + 1`, quando ela tem esse id e é uma forma (círculo,
retângulo arredondado) ou um texto (foto dentro das letras). Como no Photoshop e no Canva:

- A máscara não aparece sozinha: o preenchimento dela vira a foto. A sombra, o contorno e a opacidade da máscara vão
  em volta da foto recortada (a "foto no círculo com borda" é um círculo com contorno e uma foto recortada por ele).
  A sombra e o contorno da própria foto ficam de lado enquanto ela está recortada.
- A foto tem a caixa dela: mover e escalar a foto muda o pedaço que aparece, sem mexer na máscara.
- Separadas (outra camada entre as duas, a de cima apagada, ou trocada por uma imagem), a foto volta inteira e a
  outra camada aparece como é. Máscara oculta mostra a foto inteira; foto oculta deixa a máscara aparecer como forma.

Na tela: **Recortar pela camada de cima** e **Soltar** no menu ⋯ da camada (lista de camadas) e na seção Recorte do
inspector; a foto recortada aparece recuada na lista. No monitor, **clicar** na foto recortada escolhe a máscara e
**arrastar** leva a foto junto (redimensionar a máscara recorta outro pedaço); **duplo clique** escolhe a foto, que
então anda e muda de tamanho dentro da máscara. Subir e descer na lista levam a máscara junto; apagar a máscara solta
a foto (sem deixar o id pendurado).

## Prévia e PNG: o mesmo desenho

A exportação sempre desenhou em canvas e a prévia em DOM. O acabamento não tem equivalente exato em CSS (contorno por
dentro no texto, foto dentro das letras, contorno no recorte da foto), então a pintura é uma função só,
`pintarItem` de `pintura.ts`:

- **PNG** (`exportarPng.ts`, `desenharDocumento`): todas as camadas passam por ela, num canvas do tamanho do
  documento (vezes a escala do diálogo de exportar). O carrossel (`exportarPaginas.ts`) e o PDF usam o mesmo.
- **Prévia** (`Prancheta.tsx`, `CamadasDaPagina`): camada com acabamento, ou foto com máscara, vira um canvas do
  tamanho da pintura dela na resolução da tela (zoom × `devicePixelRatio`, até 4096 px por lado), pintado pela mesma
  função; por cima, uma caixa invisível do tamanho da camada recebe o clique. Camada sem acabamento continua em DOM,
  como antes. O fundo em degradê também é um canvas. As miniaturas da barra de páginas usam o mesmo componente.
- Com acabamento, o corpo (e o contorno) vão a um canvas à parte do tamanho da região, e a sombra nasce ao copiar esse
  canvas de volta (`shadowBlur` do canvas, que não segue a transformação: vai em px do canvas, vezes a escala).

**Medido em 07/11/2026** (`npx tsx scripts/comparar-imagem.mjs`, Chromium de render do Remotion, monitor em 50% contra
`desenharDocumento` em 0,5, carrossel de duas páginas com sombra, contorno nas três posições, degradê linear e radial,
fundo em degradê, foto no círculo, logo com contorno de adesivo): diferença média de **2,0** (capa) e **1,2** (página 2)
numa escala de 0 a 255; **0,24%** e **0,18%** dos pixels com diferença acima de 48, todos em borda de letra e de foto
(a prévia desenha a foto reduzida, o PNG a original). O script grava a prévia, o PNG, a diferença ampliada, o carrossel
em PNG e o PDF em `testes/saida/acabamento/`.

## Inspector

Abaixo das propriedades do tipo:

- **Sombra**: "Suave" põe a sombra padrão; cor, opacidade, desfoque, desloca X e Y; "Redefinir" tira.
- **Contorno**: "Da marca" põe a cor de destaque do kit, por fora (num texto, a espessura acompanha a letra); cor,
  espessura e posição.
- **Degradê** (texto e forma): "Da marca" põe o destaque clareando em diagonal; tipo, ângulo ou centro, as cores com
  posição e opacidade, mais e menos uma cor.
- **Recorte**: recortar pela camada de cima ou soltar; na máscara, qual foto ela recorta.
- **Imagem**: "Remover fundo", e "Voltar ao original" quando a camada guardou o original.
- Sem seleção, na Prancheta: **Fundo em degradê**, com "Da marca" (o fundo do kit esquentando para baixo).

O kit das predefinições é o que tem a cor de fundo da imagem (aplicar um kit troca o fundo) ou, sem nenhum, o
primeiro da lista (`kitDaImagem`). Os controles que deslizam mostram o valor no monitor antes do patch.

## Para o Claude

Sombra, contorno, degradê e máscara são campos da camada: `aplicar_patch` como sempre. Exemplos:

```json
[{"op": "add", "path": "/paginas/0/camadas/2/sombra", "value": {"opacidade": 0.35, "desfoque": 24, "y": 8}},
 {"op": "add", "path": "/camadas/1/mascara", "value": "circulo"},
 {"op": "add", "path": "/fundo_degrade", "value": {"tipo": "linear", "angulo": 180, "paradas": [{"cor": "#171A19", "posicao": 0}, {"cor": "#44352B", "posicao": 1}]}}]
```

Para a foto no círculo: uma camada de imagem e, logo acima dela, uma forma `elipse` com o id que vai em `mascara`.

`remover_fundo` (no fim de `ferramentas-mcp.ts`): `{documento, camada, voltar?}`, com a camada pelo id (em qualquer
página) ou pelo caminho. Id repetido em mais de uma camada (página duplicada repete os ids) é recusado com a lista dos
caminhos: passe o caminho. Pede o PNG à janela do app, grava `midia/<arquivo>.<código>.sem-fundo.png`, troca o `src` e
guarda o original em `src_original` (de novo, roda do original). Depois do modelo, a camada é lida de novo no mesmo
caminho e tem de ter o mesmo id; se a pilha mudou nesse meio-tempo, o documento não muda e a resposta diz onde ficou
o recorte. `voltar: true` devolve o original. Fora do app (MCP por stdio) avisa que precisa do app aberto. A primeira
vez baixa o modelo, com o andamento na tela.

## Remover fundo

**Modelo: MODNet** (Ke e outros, AAAI 2022), de retrato: recorta pessoa com cabelo e ombro, o caso do advogado na
capa. Não serve para logo e objeto.

| | |
|---|---|
| Licença | Apache-2.0 (o original, `github.com/ZHKKKe/MODNet`, e a conversão ONNX do Xenova) |
| Arquivo | `model.onnx`, fp32, 25.888.640 bytes |
| Endereço | `huggingface.co/Xenova/modnet/resolve/fa2fa546052fba4c08921230a26cc69a333fca12/onnx/model.onnx` (revisão travada) |
| SHA-256 | `07c308cf0fc7e6e8b2065a12ed7fc07e1de8febb7dc7839d7b7f15dd66584df9` |
| Onde fica | `%USERPROFILE%\Estudio\modelos\modnet\model.onnx`, baixado no primeiro uso (não vai no instalador) |
| Entrada | RGB normalizado ((x/255 − 0,5) / 0,5), lado menor em 512 px, lados múltiplos de 32, maior até 1024 |

Escolhido por ser o menor que dá conta de retrato. Proibidos pela regra comum e fora: RMBG da BRIA (não comercial) e
`@imgly/background-removal` (AGPL). Para objeto e logo, o próximo da lista é o ISNet geral (Apache-2.0, cerca de
170 MB); entra como mais uma linha no catálogo de `remover-fundo.ts` se a pessoa precisar.

**Caminho.** "Remover fundo" pergunta antes de baixar (nome, tamanho, licença, pasta); o processo principal baixa por
`net.fetch` em pedaços para `model.onnx.parcial`, confere tamanho e SHA-256 e só então põe no lugar (arquivo estragado
não fica), mandando o andamento para o aviso da tela. Ao ler, confere o SHA-256 de novo (corrompido é apagado). Os
bytes vão uma vez para um **Web Worker** da interface, que roda o **onnxruntime-web 1.30.0** (MIT) em WASM, numa
thread (a janela não é cross-origin isolated): decodifica a foto, reduz para a entrada, roda o modelo, amplia o alfa
para a foto inteira com suavização e codifica o PNG. O processo principal grava `midia/<arquivo>.<código>.sem-fundo.png`
ao lado do original (de um arquivo fora de `midia/`, dentro de `midia/`). O código são 8 hexadecimais do caminho do
original: o mesmo original cai sempre no mesmo arquivo, e dois originais de mesmo nome (`midia/ana.jpg` e
`fotos/ana.png`) não se pisam. O PNG leva dentro um bloco `tEXt` "Estudio-original" com o caminho do original; antes de
gravar por cima de um arquivo que já existe, a marca tem de ser do mesmo original, senão o recorte vai para o nome
seguinte (`-2`, `-3`…). O arquivo da pessoa e o recorte de outra foto nunca são sobrescritos. A camada troca o `src`
e guarda `src_original`. Sem o modelo, nada quebra: a função só fica indisponível com o aviso.

**Por que `onnxruntime-web` no renderer, e não `onnxruntime-node` no processo principal.** Pelo empacotamento: o
`-node` é módulo nativo (DLLs do runtime), que teria de sair do asar com configuração no Forge e iria inteiro no
instalador; neste PC o antivírus já bloqueou executável e DLL rodados do terminal. O `-web` é JavaScript e WASM, roda
igual no app e na prévia web (onde o caminho foi montado e conferido, com modelo falso: o modelo real não rodou), e
no Web Worker não trava a tela nem o processo principal. O WASM não
passa pelo CSP da página (o worker é carregado como arquivo, sem a meta da `index.html`).

**O runtime WASM vai no instalador.** O `ort-wasm-simd-threaded.wasm` (14,2 MB; 3,7 MB comprimido) é referenciado pelo
próprio pacote e o Vite o empacota com o worker; tirar exigiria mexer na configuração do Vite (área comum). Só o
modelo baixa no primeiro uso. Se a regra "binário fora do instalador" valer também para ele, o caminho é baixar o
`.wasm` como o modelo e passar por `env.wasm.wasmBinary` (o código já carrega o modelo assim).

**Tempo e memória: não medidos.** O modelo real não foi baixado nem rodou nesta frente (o responsável pediu para não baixar
em 07/11/2026). O que foi feito: o fluxo inteiro com um modelo falso nos testes (download em pedaços, SHA-256, arquivo
estragado apagado, gravação sem sobrescrever, patch, ferramenta do MCP) e o build do Vite com o worker e o WASM. Para
medir: o modelo em `testes/saida/modelos/modnet/model.onnx` e `npx tsx scripts/comparar-imagem.mjs --foto
<retrato.jpg>` (tempo do modelo, tempo total e memória do navegador), ou o botão no app.

## Licenças desta frente

| Peça | Licença | Onde |
|---|---|---|
| MODNet (pesos e conversão ONNX) | Apache-2.0 | baixado para `%USERPROFILE%\Estudio\modelos\modnet\` |
| onnxruntime-web 1.30.0 | MIT | dependência npm (JS e o `.wasm` no instalador) |

## Limites conhecidos

- O contorno de imagem é o alfa engordado por cópias deslocadas em anéis: fino e médio ficam bons; muito grosso num
  recorte cheio de pontas arredonda tudo.
- A foto sem fundo tem a cor de borda da foto original (o modelo dá o alfa, não separa a cor do cabelo do fundo); em
  fundo muito diferente aparece um halo fino.
- O MODNet é de retrato: objeto, logo e foto sem pessoa saem ruins.
- Canvas da prévia até 4096 px por lado: num zoom muito alto, a camada com acabamento perde nitidez antes do resto.
- Fundo em degradê só no documento inteiro (todas as páginas).
- Na área Efeitos, a pilha de efeitos vale por cima do acabamento, como de qualquer camada.

## Seleção múltipla, alinhar e distribuir (rodada 3)

Versão de 08/11/2026, frente B2 da rodada 3. Código: `src/nucleo/layout-imagem.ts` (contas, puro),
`src/renderer/estado/loja.ts` (a seleção), `MonitorImagem.tsx` (os gestos), `BarraSelecao.tsx` (alinhar e distribuir),
`CamadasImagem.tsx` (a lista) e `src/nucleo/mcp-imagem.ts` (ferramentas). Testes em `testes/layout-imagem.test.ts`.

**A seleção na loja (contrato para as outras frentes).** `selecao` continua `{documento, caminho}`: quem lê uma seleção
só lê `caminho`, que é a camada principal (a última escolhida). A seleção múltipla soma `outros?: string[]`, os demais
caminhos do mesmo documento. Para ler todas: `caminhosDaSelecao(selecao, documento?)` (o principal primeiro). Para
escrever: `selecionar(...)` como sempre (solta as outras), `selecionarVarias(documento, caminhos)` (o principal é o
último) e `alternarNaSelecao(documento, caminho)` (Shift+clique). O `.estudio/estado.json` ganhou `selecao_varias`
(todos os caminhos, só quando há mais de um), que o `estado_do_editor` do MCP devolve.

**Gestos no monitor (V, mover).** Apertar numa camada já a escolhe e arrastar a move, mesmo sem estar selecionada
(imagem-D2, o gesto do Canva). Apertar dentro da seleção arrasta todas juntas (um patch só; a foto recortada vai com a
máscara). Shift+clique põe ou tira da seleção. Arrastar no vazio desenha o laço: entram as camadas tocadas por ele
(sem as ocultas e sem a foto recortada, que aparece pela máscara); com Shift, somam à seleção. Ctrl+A escolhe todas as
camadas visíveis da página; Esc solta. Clique sem arrasto dentro da seleção escolhe a camada de cima naquele ponto. Na
lista de camadas, Shift ou Ctrl+clique põe ou tira; as selecionadas ficam acesas e os botões de subir, descer e excluir
ficam na principal.

**Alinhar e distribuir.** Com seleção, a barra aparece em cima do monitor: seis alinhamentos (esquerda, centro e direita
na horizontal; topo, meio e base na vertical) e dois distribuir (horizontal e vertical, com três ou mais). Com uma
camada, o alvo é a prancheta; com várias, a caixa delas. Passar o mouse num botão mostra o alvo (tracejado do acento) e
onde cada camada vai cair (caixas fantasmas), antes do clique; o clique é um patch só, desfazível. As contas usam a
caixa da camada girada (a que contém os quatro cantos), sem sombra nem contorno. Distribuir deixa a primeira e a última
no lugar e o mesmo espaço entre as caixas.

**Redimensionar camada girada (imagem-D15).** A alça fica no canto de baixo à direita; numa camada girada, o canto de
cima à esquerda agora fica parado na página enquanto o tamanho muda (`redimensionarGirada`). Antes, o centro ficava e o
canto escorregava.

**Ferramentas do MCP** (`src/nucleo/mcp-imagem.ts`, chamada por uma linha no fim de `registrarFerramentas`):

| Ferramenta | Entrada | O que faz | Classe |
|---|---|---|---|
| `selecionar_camadas` | `documento`, `camadas` (ids ou caminhos; vazia limpa) | Grava `.estudio/selecao.json`; a tela lê, traz a área, o documento e a página para a frente e seleciona. Não muda o documento. | livre |
| `alinhar_camadas` | `documento`, `camadas`, `como` (esquerda, centro, direita, topo, meio, base), `alvo?` (selecao, prancheta) | Um patch com test dos ids, no diário. | livre |
| `distribuir_camadas` | `documento`, `camadas` (3 ou mais), `eixo` (horizontal, vertical) | Um patch com test dos ids, no diário. | livre |

As camadas vêm por id (único no documento: página duplicada repete ids, e aí a ferramenta recusa e lista os caminhos)
ou por caminho, todas da mesma página. Esquemas só com texto, listas e enumerações, sem união solta: valem para qualquer
provedor.

**Ida e volta entre módulos.** A seleção mora na loja, comum a todas as áreas: ao ir para Efeitos e voltar, ou ao
chegar pela conversa, ela continua. `selecionar_camadas` traz a área Imagem, o documento e a página para a frente
vindo de qualquer área.

### Para o guia da IA

- A imagem tem seleção múltipla: `estado_do_editor` traz `selecao` (a principal) e, com mais de uma, `selecao_varias`.
- Para mostrar à pessoa do que você fala: `selecionar_camadas` com ids ou caminhos.
- Para alinhar ou distribuir, prefira `alinhar_camadas` e `distribuir_camadas` a calcular x e y à mão: elas usam a
  caixa da camada girada e levam a foto recortada com a máscara.
