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
