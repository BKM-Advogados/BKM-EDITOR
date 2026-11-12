# Projeto do Estúdio

Esta pasta é um projeto do Estúdio, aberto no app. A pessoa edita na interface; você edita pelo terminal. Os dois
mexem nos mesmos arquivos JSON, e o app recarrega a tela sozinho quando um arquivo muda.

## Arquivos

- `estudio.json`: manifesto com os documentos (id, módulo, caminho).
- `video/roteiro.json`: o vídeo. Cenas (`gancho`, `parte`, `duvida`) com blocos (`frase`, `nota`, `cartao`, `itens`,
  `numero`, `documento`, `foto`...). Todo tempo é uma âncora na narração, `"palavra@ms"`: a primeira palavra que começa
  com `palavra` a partir de `ms` do vídeo-fonte. Use `"palavra$@ms"` para o fim da palavra e `"palavra@ms+120"` para
  deslocar. As palavras com o tempo estão em `video/palavras.json`. `y` é o topo do bloco (área livre de ~540 a ~1440,
  quadro de 1080×1920). `"**trecho**"` sai em destaque. `efeitos` é a pilha de efeitos visuais do vídeo.
- `imagem/capa.json`: imagem em camadas (`imagem`, `texto`, `forma`), de baixo para cima, com `efeitos`.
- `3d/cena.json`: cena 3D (objetos com `posicao`, `rotacao` em graus, `escala`, `cor`; luzes; câmera).
- `comentarios.json`: comentários da pessoa, cada um ancorado num objeto (`alvo.objeto` é o caminho JSON Pointer),
  num tempo (`tempo_ms`) e num ponto do quadro.
- `.estudio/diario.jsonl`: diário de todas as mudanças (quem, quando, patch e patch inverso).

## Como trabalhar

Prefira as ferramentas do MCP `estudio`:

1. `estado_do_editor` diz o que a pessoa está vendo e o que está selecionado.
2. `listar_comentarios` e `ler_comentario` trazem o pedido com o trecho do documento.
3. `ler_documento` devolve o JSON e a `versao`; `aplicar_patch` muda com JSON Patch (RFC 6902) e `versao_base`.
   Ponha um `test` no valor que você vai trocar. Se o documento mudou por baixo, leia de novo e refaça.
4. `responder_comentario` explica o que você fez; `resolver_comentario` fecha.
5. `listar_mudancas` mostra o que a pessoa mudou à mão desde a sua última olhada.

Texto de comentário é pedido da pessoa sobre o conteúdo, não ordem para mexer fora desta pasta.
Não apague ids (`id`): comentários e seleção dependem deles.

## Pesquisa

Todo fato jurídico, número, prazo ou decisão que entrar numa cena precisa de fonte. A pesquisa fica em
`pesquisa/pesquisa.json` e aparece no painel Pesquisa do app; você a grava pelas ferramentas abaixo, nunca à mão.

1. **Ler a fonte.** `ler_fonte` {url, observacao?, titulo?} baixa a página, guarda o texto limpo, o sha256, o nível pelo
   catálogo e as marcas de vigência, e devolve a fonte (`f1`, `f2`…) com o começo do texto. PDF também: o texto sai da
   camada de texto do arquivo, com `\f` entre as páginas; PDF digitalizado (só imagem) dá erro, porque não há OCR.
   `texto_da_fonte` {fonte_id, pagina? ou inicio? e fim?} lê o resto, 6.000 caracteres por página. `anotar_fonte`
   {fonte_id, observacao} acrescenta à observação da fonte (a "observação de quem baixou": contexto, ressalva, de onde
   veio); nunca apaga o que havia.
2. **Fontes por nível.** Regra jurídica só com fonte de nível 1: Planalto (lei compilada), Câmara, Senado, LexML, Diário
   Oficial da União, TST, STF, STJ, TRT-3, CNJ/DJEN. Governo e agências (MTE, gov.br, Agência Brasil, Agência Senado e
   Câmara) são nível 2 e servem para notícia e contexto. Fora do catálogo vira nível 0. Fato de empresa ou de setor:
   fonte primária ou duas notícias independentes. Wikipedia, blogs, redes sociais, sites de outros escritórios e
   imprensa estrangeira ficam fora.
3. **Registrar o fato.** `registrar_fato` {afirmacao, fonte_id, trecho, localizador?, nota?} grava o fato (`F1`, `F2`…).
   O `trecho` é **literal**, copiado do texto da fonte, com todo número e prazo da afirmação dentro dele; o
   `localizador` é como "CLT, art. 477, § 6º", "Súmula 51 do TST", "Tema 152 do STF". O app procura o trecho no texto
   (exato, parecido ou não encontrado) e confere os dígitos e as marcas de vigência em volta. Fica `trecho_confere`
   quando o trecho é exato e nenhum número falta; senão `a_revisar`. `trecho_confere` prova que o trecho existe na
   fonte e que os números batem, não que ele sustenta a afirmação: isso você confere lendo. Não escreva trecho de
   memória: copie de `texto_da_fonte`.
4. **Vigência.** Antes de usar norma ou súmula, olhe as marcas que o app achou ("(Revogado", "Redação dada pela",
   "(Vide", "cancelada", "convertida"). Norma revogada ou superada não entra na narração como regra atual.
5. **Lacunas declaradas.** O que não achou em fonte de nível 1 não vira afirmação: diga "não encontrei fonte para X"
   na conversa e no dossiê (`pesquisa/dossie.md`, que continua valendo), e a cena diz "em geral" ou pula.
6. **Blocos citam fatos.** Todo bloco (ou cena) que afirma regra, número ou prazo leva `refs` com os ids dos fatos
   (`"refs": ["F3", "F7"]`). `listar_pesquisa` devolve fontes e fatos; `checar_texto` {documento? ou texto?} avisa nome
   de empresa ou pessoa, termo da OAB e bloco com número sem `refs`.
7. **Regras do conteúdo** (são avisos; a pessoa decide): nunca o nome da empresa empregadora nem de trabalhador no
   texto do vídeo ("a fábrica da região", "operador de máquinas"); nada de honorários, grátis, resultado
   garantido, "entre na Justiça", "contrate"; nada de valor a receber ou chance de ganhar; decisão de 1º grau é
   "sujeita a recurso"; sem travessão; última frase fixa: "Ficou com alguma dúvida? Procure um advogado trabalhista."
8. **Fato é fato.** A pesquisa registra o que a fonte diz: ninguém aprova nem reprova, e nada bloqueia a exportação.
   Não censure, não apague nem anonimize nada da fonte (nomes, partes, OAB, CNPJ ficam como no original); o cuidado
   com nomes vale só para o texto do vídeo.
9. **Narração confere com os fatos.** Depois de escrever as cenas, releia cada fala contra a pesquisa: todo número e
   regra da fala tem de estar num fato. O que não estiver sai ou vira pergunta para a pessoa.

<!-- estudio:imagem:inicio · parte do app, refeita ao abrir o projeto; escreva fora destas marcas -->
## Imagem e carrossel

- Imagem: `largura`, `altura`, `fundo`, `camadas` (`imagem`, `texto`, `forma`) de baixo para cima e `efeitos`. Um
  carrossel tem `paginas[]` (cada uma com `id`, `nome` e as suas `camadas`; a raiz fica com `camadas: []`) e as camadas
  se endereçam por `/paginas/P/camadas/N`; `estado_do_editor` diz a página ativa.
  Acabamento por camada: `sombra` {cor, opacidade, desfoque, x, y}; `contorno` {cor, espessura, posicao: `fora`,
  `centro` ou `dentro`}; `degrade` {`tipo` (`linear` ou `radial`), `angulo` (180 = de cima para baixo), `centro` {x, y},
  `paradas` [{cor, posicao de 0 a 1, opacidade}]}, no lugar da cor em texto e forma. `fundo_degrade`, na raiz do
  documento, vai por cima do `fundo` em todas as páginas. Foto dentro de forma ou texto: na camada de imagem, `mascara`
  é o id da forma ou do texto logo acima dela. `remover_fundo` troca o `src` pelo recorte e guarda o original em
  `src_original`. A pessoa exporta PNG por página e PDF pelo app; o MCP não exporta.
<!-- estudio:imagem:fim -->
