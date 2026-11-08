# Marca: kit, cores e fontes por referência, ícones e traçado

Rodada 3, frente Marca (`tasks/estudio-acompanhamento/rodada-3/B1-marca.md`). O kit de marca (`src/nucleo/marca.ts`,
rodada 1) ganhou três coisas: a imagem guarda o kit que recebeu, cor e fonte das camadas leem dele por referência
(`src/nucleo/cor-marca.ts`) e os campos de cor mostram as cores do kit com aviso de contraste. Código novo:
`cor-marca.ts`, `camadas-novas.ts`, `fonte-variavel.ts`, `mcp-marca.ts` (núcleo), `estado/kits.ts` e `estado/paleta.ts`
(interface). Testes: `testes/marca-camadas.test.ts`, `testes/mcp-marca.test.ts`.

## A imagem guarda o kit

Um documento de imagem tem, no fim do tipo, o campo opcional `marca`: o kit como estava quando foi aplicado.

```json
"marca": {"id": "bkm", "nome": "BKM Advogados",
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
| `@cobreProfundo`, `@nevoa`… | Cor de apoio do kit, pelo nome (a Cliente tem `cobre`, `grafite`, `osso`, `aco`…). Maiúsculas não importam. |
| `@destaque+35` | A cor 35% em direção ao branco. `@texto-20`: 20% em direção ao preto. |
| `@fundo:destaque:25` | A cor 25% do caminho até outra cor do kit (o degradê "Da marca" do fundo usa). |
| `@titulo`, `@texto`, `@mono` | Só em `fonte`: a de título, a de texto e a mono do kit (sem mono, a de texto). |

Onde vale: `fundo`, `fundo_degrade`, e em cada camada `cor`, `preenchimento`, `sombra.cor`, `contorno.cor`, `degrade`
(cada parada) e `fonte`. Não vale na cor do efeito de tom da pilha de efeitos (sempre hexadecimal). Nome que o kit
não tem vira cinza `#808080`, que aparece em vez de esconder a camada.

## Trocar de kit na imagem

`patchDaMarca` (imagem) passa cada cor e fonte para o **mesmo papel** no kit novo: o que era o destaque do kit
anterior vira o destaque do novo; título, texto e mono também. O kit anterior é o que a imagem guarda em `marca`; sem
ele valem os kits de fábrica (Cliente, BKM, neutro e o carrossel de antes do campo). Cor ou fonte que não é de nenhum kit
(`#123456`, "Impact") é escolha da pessoa e fica. Referência (`@destaque`) não é tocada: ela já lê o kit novo. O texto
sem cor, ou no branco padrão, recebe `@texto`. Fecha imagem-D1 (fundo, formas e degradês ficavam do kit anterior) e
imagem-D9 (o subtítulo virava cor de título e o numeral perdia a mono).

Camada nova (`textoNovo` e `formaNova`, em `camadas-novas.ts`) e o modelo de carrossel nascem com `@titulo`, `@texto`,
`@mono`, `@destaque` e `@suave`: a marca da peça, não o cobre da Cliente (imagem-D8).

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

## Ferramentas MCP e classe de permissão

| Ferramenta | O que faz | Classe |
|---|---|---|
| `ver_marca` | O kit do documento: cores com o nome que se usa, fontes. | `livre` (só lê) |
| `cor_da_marca` | Põe `@nome` num campo de cor de uma camada ou no fundo; avisa o contraste. | `livre` |
| `fonte_da_marca` | Põe `@titulo`, `@texto` ou `@mono` num texto. | `livre` |
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
- Lucide (ISC) e `@remotion/fonts` (já no `package.json`; não é mais importado).

## O que não foi verificado

Nada rodou no Electron (Bitdefender). A interface foi conferida na prévia web (porta 5202); a exportação, só por
testes e por render do Remotion fora do Electron (`scripts/exportar-teste-fontes.mjs`). Sem rede de verdade desligada:
o que se prova é que o pacote não cita `fonts.gstatic.com` e que as quatro famílias saem no quadro; o proxy que
bloqueia o Google não foi simulado.
