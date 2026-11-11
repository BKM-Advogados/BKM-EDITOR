# Marca: kit, cores e fontes por referência, ícones e traçado

Rodada 3, frente Marca (`tasks/estudio-acompanhamento/rodada-3/B1-marca.md`). O kit de marca (`src/nucleo/marca.ts`,
rodada 1) ganhou três coisas: a imagem guarda o kit que recebeu, cor e fonte das camadas leem dele por referência
(`src/nucleo/cor-marca.ts`) e os campos de cor mostram as cores do kit com aviso de contraste. Código novo:
`cor-marca.ts`, `camadas-novas.ts`, `fonte-variavel.ts`, `mcp-marca.ts` (núcleo), `estado/kits.ts` e `estado/paleta.ts`
(interface). Testes: `testes/marca-camadas.test.ts`, `testes/mcp-marca.test.ts`.

## A imagem guarda o kit

Um documento de imagem tem, no fim do tipo, o campo opcional `marca`: o kit como estava quando foi aplicado.

```json
"marca": {"id": "escritorio", "nome": "Escritório Exemplo",
  "cores": {"fundo": "#101826", "texto": "#F2EEE6", "destaque": "#C9A961", "suave": "#A5ADBA"},
  "fontes": {"titulo": "Inter", "texto": "Inter"}}
```

Quem o grava: `aplicar_marca`, o painel Marca (menu → Marca…), "Mais opções → Marca" na tela inicial e o modelo
"Novo carrossel". Imagem de antes do campo continua válida: sem `marca`, as referências leem o kit neutro e o
"Da marca" do acabamento adivinha o kit pela cor de fundo, como antes. O vídeo de cenas continua com o kit no `tema`
(`tema.marca`), cópia dos valores: lá a cor de bloco é do Vídeo (video-D15).

## Cor e fonte por referência

Um campo de cor da imagem pode dizer `"@destaque"` em vez de `#C9A961`; o campo `fonte` de um texto, `"@titulo"`. O
valor sai de `marca`, na hora de pintar: a prévia, a miniatura, o PNG e o PDF passam o documento por
`resolverMarcaNoDoc` antes de desenhar. Trocar de kit, ou o kit ganhar outra cor, muda a peça sem tocar nas camadas.
`#C9A961` continua valendo: é a cor escolhida à mão.

| Referência | Vale |
|---|---|
| `@fundo`, `@texto`, `@destaque`, `@suave` | As quatro cores de todo kit. |
| `@terracotaEscura`, `@nevoa`… | Cor de apoio do kit, pelo nome (um kit pode ter `terracota`, `grafite`, `areia`…). Maiúsculas não importam. |
| `@destaque+35` | A cor 35% em direção ao branco. `@texto-20`: 20% em direção ao preto. |
| `@fundo:destaque:25` | A cor 25% do caminho até outra cor do kit (o degradê "Da marca" do fundo usa). |
| `@titulo`, `@texto`, `@mono` | Só em `fonte`: a de título, a de texto e a mono do kit (sem mono, a de texto). |

Onde vale: `fundo`, `fundo_degrade`, e em cada camada `cor`, `preenchimento`, `sombra.cor`, `contorno.cor`, `degrade`
(cada parada) e `fonte`. Não vale na cor do efeito de tom da pilha de efeitos (sempre hexadecimal). Nome que o kit
não tem vira cinza `#808080`, que aparece em vez de esconder a camada.

## Trocar de kit na imagem

`patchDaMarca` (imagem) passa cada cor e fonte para o **mesmo papel** no kit novo: o que era o destaque do kit
anterior vira o destaque do novo; título, texto e mono também. O kit anterior é o que a imagem guarda em `marca`; sem
ele valem os kits de fábrica (o neutro, as paletas marinho e escura de dois kits de fábrica que saíram e o carrossel de antes do campo). Cor ou fonte que não é de nenhum kit
(`#123456`, "Impact") é escolha da pessoa e fica. Referência (`@destaque`) não é tocada: ela já lê o kit novo. O texto
sem cor, ou no branco padrão, recebe `@texto`. Fecha imagem-D1 (fundo, formas e degradês ficavam do kit anterior) e
imagem-D9 (o subtítulo virava cor de título e o numeral perdia a mono).

Camada nova (`textoNovo` e `formaNova`, em `camadas-novas.ts`) e o modelo de carrossel nascem com `@titulo`, `@texto`,
`@mono`, `@destaque` e `@suave`: a marca da peça, não as cores de um kit fixo (imagem-D8).

## Fontes

- **Dentro do app, sem internet** (video-D9): Inter, Archivo, IBM Plex Sans e IBM Plex Mono vêm em
  `src/composicoes/fontes-pacote/` (woff2 do subconjunto latin, que cobre o português, com a licença OFL de cada uma
  ao lado). Antes cada família ia buscar o arquivo em `fonts.gstatic.com` e, sem rede ou atrás de um proxy, o render
  esperava 60 s e falhava; legenda e marca d'água passavam pelo mesmo caminho. Agora `fontes.ts` carrega pelo CSS
  (`FontFace` com `url()`, que vale em http e em `file://`) e o pacote do Remotion não cita a internet
  (`scripts/exportar-teste-fontes.mjs` confere). Pesos: Inter e Archivo variáveis (100 a 900); Plex Sans e Mono, um
  arquivo por peso de 100 a 700. Sem itálico: o navegador inclina. Caractere fora do latin cai numa fonte do sistema.
- **Fonte que não carrega não cancela** (video-D10): o `loadFont` do `@remotion/fonts` chamava `cancelRender` em
  qualquer erro, então uma fonte de kit apagada de `fontes/` derrubava a exportação inteira. `fontes.ts` carrega a
  variante sozinho: se falha, avisa no console e registra a mesma família como apelido de uma fonte do sistema (Segoe
  UI, Helvetica Neue, Arial, Roboto, DejaVu Sans; o negrito de verdade quando o peso é 600 ou mais), e o render segue.
  Tenta de novo depois de 5 s. O `@remotion/fonts` deixou de ser importado (continua no `package.json`).
- **A exportação da imagem espera** (imagem-D7): `aguardarFontes(nomes)` espera cada variante da família terminar de
  carregar, ou de falhar, antes do PNG e do PDF; antes só as três famílias do Google que a imagem conhecia (sem a
  Inter) eram esperadas e as de arquivo nunca.
- **Seletor da imagem** (`opcoesDeFonte`, `comum.ts`): primeiro "Título do kit", "Texto do kit" e "Mono do kit"
  (referências), depois as famílias do kit e do projeto (`fontes/`), as do app e a do sistema. Inclui a Inter, e a
  fonte que a camada já usa entra sempre (imagem-D10).
- **Fonte variável importada no kit** (imagem-D14): `peso_max` em `FonteArquivo` e `pesoMax` em `FonteDeArquivo`. O
  arquivo é lido (`fonte-variavel.ts`: tabela `fvar`, eixo `wght`, TTF/OTF/WOFF; o WOFF2 só pelo nome, "VariableFont"
  ou "[wght]") e a fonte entra no navegador com `font-weight: 100 900`, não presa no 400. Peso dito à mão vale um só.
- **Reaplicar o kit** (imagem-D13): o logo e as fontes que mudaram no kit trocam os do projeto (mesmo nome) e voltam
  em `atualizados`; o painel Marca avisa quais.

## Ícones do Lucide

2020 ícones (Lucide 1.68.0, licença ISC), recoloríveis e vetoriais. Um ícone é uma camada de `tipo: "forma"` com
`forma: "icone"`, o nome em `icone` (inglês, com hífen: `scale`, `file-text`) e a cor em `preenchimento` (ou `degrade`):

```json
{"id": "icone-1", "nome": "Ícone · scale", "tipo": "forma", "forma": "icone", "icone": "scale", "preenchimento": "@destaque",
 "x": 454, "y": 588, "largura": 173, "altura": 173, "icone_espessura": 2}
```

- **Pintura** (`src/renderer/modulos/imagem/icone.ts`): cada elemento do Lucide vira um `Path2D` na grade de 24, com traço
  arredondado de `icone_espessura` (padrão 2, na grade: cresce e encolhe com a caixa). O ícone é um quadrado do menor
  lado da caixa, centrado. Vai sempre pelo caminho do acabamento (canvas), então sombra, contorno (pelo alfa, como numa
  foto), degradê e máscara valem. Medido na prévia (`minus` numa caixa de 96 px): o traço sai com 8, 16 e 32 px em 1x,
  2x e 4x, sem nenhum pixel intermediário na borda.
- **Dados**: `scripts/gerar-icones.mjs` lê o pacote `lucide-static` (`icon-nodes.json` e `tags.json`) e gera
  `icones-geometria.json` (só a interface pinta; um caminho por elemento, porque o `m` minúsculo de um caminho colado ao
  anterior viraria relativo) e `src/nucleo/icones-indice.json` (nome e etiquetas, para o MCP e a busca). A licença do
  Lucide está em `LICENSE-Lucide.txt`, ao lado da geometria. Nenhuma dependência nova: o `lucide-react` já era usado na
  interface e o `lucide-static` só serve ao script.
- **Busca em português** (`src/nucleo/icones.ts`): o léxico liga cerca de 300 palavras do direito, do trabalho e do dia a
  dia (balança, justiça, contrato, assinatura, prazo, vencimento, férias, rescisão, FGTS, atenção…) a nomes do Lucide; o
  resto da busca lê o nome e as etiquetas em inglês. Sem acento, em maiúsculas ou no plural funciona. `balança` acha
  `scale`; `contrato`, `file-text`, `handshake` e `file-pen`; `prazo`, `clock`, `calendar-clock` e `hourglass`.
- **Interface**: botão "Inserir ícone" no trilho do monitor (busca, grade de resultados, Enter insere o primeiro) e a
  seção "Ícone" do inspector (nome com sugestão se não existe, cor com as amostras do kit, traço).
- **MCP**: `buscar_icone` e `inserir_icone` (tabela abaixo).

## Traçado: tracejado, pontas, junções e setas

- **Contorno** (`contorno`): ganha `estilo` (`solido`, `tracejado`, `pontilhado`), `pontas` (`redonda`, `reta`, `quadrada`) e
  `juncao` (`redonda`, `pontuda`, `chanfrada`). Sem dizer nada é sólido, de pontas e junção redondas, como sempre. Vale em
  texto e em forma (a junção é o canto do retângulo e a dobra da letra); numa foto e num ícone o contorno sai do alfa e
  ignora o estilo. O tracejado tem tracinhos de 3 espessuras e vãos de 2; o pontilhado, pontos de 1 com vãos de 1.
  Ponta redonda e quadrada aumentam cada tracinho, então a pintura encolhe o tracinho e alarga o vão na mesma medida: o
  desenho que se vê é o mesmo nas três pontas (`tracoParaCanvas`, `src/nucleo/acabamento.ts`).
- **Linha e seta** (`forma: "linha"`, `src/nucleo/linha.ts`): segmento horizontal no meio da caixa, de ponta a ponta, que gira
  com `rotacao`: **o ângulo da seta é o giro da camada**. A cor é `preenchimento` (referência ou hex). O campo `linha` guarda
  só o que difere do padrão: `espessura` (6 px), `estilo`, `pontas`, `juncao`, `inicio` e `fim` (`nenhuma`, `seta`,
  `triangulo`, `losango`, `circulo`, `barra`) e `tamanho_seta` (4 espessuras, 14 no mínimo).

```json
{"id": "seta-1", "nome": "Seta", "tipo": "forma", "forma": "linha", "preenchimento": "@destaque", "x": 120, "y": 310, "largura": 424, "altura": 36,
 "rotacao": 45, "linha": {"fim": "triangulo", "estilo": "tracejado"}}
```

- **Pintura** (`src/renderer/modulos/imagem/linha.ts`, chamada por `pintura.ts` por `vetorial.ts`): o mesmo código desenha a
  prévia e o PNG. O traço para antes do triângulo, do losango e do círculo; a seta aberta e a barra não cobrem o traço; as
  pontas são sempre inteiras (sem tracinhos). Linha mais curta que as pontas: ficam só as pontas.
- **Medido na prévia web** (`desenharDocumento`, espessura 10): tracejado com tracinho de 30 px e período de 50 px nas três
  pontas, em 1x e em 2x; pontilhado com ponto de 10 px e período de 20.
- **Interface**: botão "Inserir linha ou seta" no trilho (oito predefinições desenhadas pelo mesmo código: linha, tracejada,
  seta, seta aberta, dupla, tracejada, ponto e seta, medida), seção "Linha" no inspector (cor, espessura, estilo, pontas,
  junção, início, fim, tamanho da seta) e "Estilo", "Pontas" e "Junção" na seção Contorno. O ângulo é o campo Giro.
- **MCP**: `inserir_linha` (tabela abaixo): dá os dois pontos e a ferramenta calcula a caixa e o ângulo.

## Listas com marcadores e numeradas

Um texto da imagem vira lista com o campo `lista` (`"marcadores"` ou `"numerada"`): **cada linha do texto é um item**
(`
` separa), o marcador fica na margem e o texto do item, e as linhas que ele quebra, ficam recuados (**recuo
pendente**). Linha em branco fica em branco e não gasta número.

```json
{"id": "texto", "tipo": "texto", "texto": "Aviso prévio
Férias vencidas com o terço
Décimo terceiro", "largura": 920,
 "lista": "marcadores", "lista_marcador": "→", "lista_recuo": 44}
```

| Campo | Vale |
|---|---|
| `lista` | `marcadores` ou `numerada` (1., 2., 3.…). Sem o campo, texto livre, em DOM como sempre. |
| `lista_marcador` | O marcador da lista com marcadores, até 4 letras (padrão `•`). A numerada ignora. |
| `lista_recuo` | Onde o texto dos itens começa, em px. Sem ele, o maior marcador mais 40% do tamanho da letra (`10.` pede mais que `9.`). |

O alinhamento vale dentro da coluna (a largura menos o recuo): `esquerda` começa no recuo, `centro` fica no meio da coluna e
`direita` na borda; o marcador fica sempre na margem esquerda. Camada com lista vai sempre pelo canvas (`temAcabamento`),
então a prévia, o PNG e o PDF quebram do mesmo jeito: `layoutDeLista` (`src/nucleo/lista.ts`) faz a conta, recebendo a
medida do texto de quem chama, e `pintura.ts` a usa em `layoutTexto` e `escreverLinhas`. Sombra, contorno, degradê e
máscara do texto valem na lista. Conferido na prévia web: marcadores e numeração na margem, linhas quebradas alinhadas
no recuo. Interface: "Lista", "Marcador" e "Recuo" na seção Texto do inspector. MCP: `fazer_lista`.

## Campo de cor

`CampoCor` (`componentes/Campos.tsx`) mostra as cores do kit do documento aberto como amostras com nome (tooltip e
legenda da ativa). Na imagem clicar grava a referência; no vídeo, o valor. Aceita `@destaque` digitado. Com `contra`
(a cor de fundo), abaixo de 4,5:1 (WCAG 2.2) avisa; o inspector de texto passa o fundo da peça. `paleta={false}`
desliga (painel Marca, 3D). Na área Efeitos grava hexadecimal.

## Para o guia da IA

Texto para o `claudeMd` do projeto (a coordenação junta em `criar-projeto.ts`):

> **Marca na imagem.** A imagem guarda o kit em `marca` (veja `ver_marca`). Prefira a cor do kit por referência a um
> hexadecimal: `cor_da_marca` põe `@destaque` no campo (`cor` do texto, `preenchimento` da forma, `contorno`, `sombra`
> ou `fundo`) e `fonte_da_marca` põe `@titulo`, `@texto` ou `@mono`; em `aplicar_patch` escreva o mesmo valor no
> campo (`"preenchimento": "@destaque"`). `@destaque+35` clareia, `@texto-20` escurece, `@fundo:destaque:25` mistura.
> `aplicar_marca` troca o kit de um documento: a peça acompanha, e o que a pessoa escolheu à mão fica. Texto sobre o
> fundo precisa de 4,5:1: `cor_da_marca` avisa quando falta.
>
> **Ícones.** `buscar_icone` ("balança", "prazo") acha o nome; `inserir_icone` põe o ícone na página. Ele é uma
> forma com `forma: "icone"` e `icone: "scale"`: mude `x`, `y`, `largura`, `altura`, `rotacao` e `sombra` por
> `aplicar_patch` como numa forma, a cor por `cor_da_marca` (campo `preenchimento`) e o traço em `icone_espessura`.
>
> **Linhas e setas.** `inserir_linha` põe uma linha do ponto (x1, y1) ao (x2, y2), em px; com `fim: "triangulo"` é uma
> seta. A camada tem `forma: "linha"`, e o ângulo é `rotacao` (0 aponta para a direita, 90 para baixo): para apontar a seta
> para outro lado, mude `rotacao`, não troque x e y. `linha` guarda `espessura`, `estilo` (`solido`, `tracejado`,
> `pontilhado`), `pontas`, `juncao`, `inicio`, `fim` e `tamanho_seta`. O contorno de texto e forma também aceita
> `estilo`, `pontas` e `juncao`.
>
> **Listas.** `fazer_lista` transforma um texto da imagem em lista (`marcadores` ou `numerada`): cada linha do texto, separada
> por `
`, é um item, e o que ele quebra fica recuado. Escreva os itens como linhas do `texto`, sem digitar o marcador;
> `lista_marcador` troca o marcador (`→`, `–`, `✓`) e `lista_recuo` o recuo, em px.

## Ferramentas MCP e classe de permissão

| Ferramenta | O que faz | Classe |
|---|---|---|
| `ver_marca` | O kit do documento: cores com o nome que se usa, fontes. | `livre` (só lê) |
| `cor_da_marca` | Põe `@nome` num campo de cor de uma camada ou no fundo; avisa o contraste. | `livre` |
| `fonte_da_marca` | Põe `@titulo`, `@texto` ou `@mono` num texto. | `livre` |
| `buscar_icone` | Procura ícones do Lucide por palavra em português ou inglês; devolve os nomes. | `livre` (só lê) |
| `inserir_icone` | Insere um ícone como forma na página, na cor do kit (`@destaque`), com posição, tamanho, cor e traço opcionais. | `livre` |
| `inserir_linha` | Insere linha ou seta do ponto (x1, y1) ao (x2, y2), com estilo, pontas, junção e setas opcionais; o ângulo vai em `rotacao`. | `livre` |
| `fazer_lista` | Faz de um texto uma lista com marcadores ou numerada (um item por linha, recuo pendente) ou o volta a texto livre. | `livre` |
| `aplicar_marca` (rodada 1) | Aplica um kit ao documento; na imagem, por papel. | `livre` |

Todas gravam no diário com o autor e têm Reverter; nenhuma lê a web nem traz arquivo de fora do projeto.

## Caminho entre módulos

Vídeo → imagem: o kit do projeto vale nos dois; "Mais opções → Marca" na tela inicial aplica em todos os documentos
novos, e o painel Marca (menu → Marca…) aplica ao documento ativo de qualquer área. Imagem → vídeo: `aplicar_marca`
com o `documento` do vídeo. Volta: Ctrl+Z desfaz o patch do kit (a troca é um patch só, no diário).

## Licenças desta frente

- Fontes empacotadas (`src/composicoes/fontes-pacote/`): **SIL Open Font License 1.1**, que permite uso comercial e
  embutir no app. Origem: pacotes `@fontsource-variable/inter` 5.3.0, `@fontsource-variable/archivo` 5.3.0,
  `@fontsource/ibm-plex-sans` 5.3.0 e `@fontsource/ibm-plex-mono` 5.3.0 (só o woff2 latin copiado; o texto da licença
  de cada uma está ao lado, `LICENSE-*.txt`). Inter: The Inter Project Authors; Archivo: The Archivo Project Authors;
  IBM Plex: IBM Corp. Nenhuma dependência nova no `package.json`.
- Lucide 1.68.0 (**ISC**): a geometria e as etiquetas dos ícones vêm do pacote `lucide-static` 1.68.0 (a mesma versão do
  `lucide-react` do `package.json`); o texto da licença está em `src/renderer/modulos/imagem/LICENSE-Lucide.txt`.
  Nenhuma dependência nova: o `lucide-static` só serve ao script que gera os dados.
- `@remotion/fonts` (já no `package.json`; não é mais importado).

## O que não foi verificado

Nada rodou no Electron (Bitdefender). A interface foi conferida na prévia web (porta 5202); a exportação, só por
testes e por render do Remotion fora do Electron (`scripts/exportar-teste-fontes.mjs`). Sem rede de verdade desligada:
o que se prova é que o pacote não cita `fonts.gstatic.com` e que as quatro famílias saem no quadro; o proxy que
bloqueia o Google não foi simulado.
