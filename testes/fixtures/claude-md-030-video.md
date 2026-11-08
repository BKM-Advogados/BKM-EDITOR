# Projeto do Estúdio

Esta pasta é um projeto do Estúdio, aberto no app. A pessoa edita na interface; você edita pelas ferramentas do MCP
`estudio`. Os dois mexem nos mesmos arquivos JSON, e o app recarrega a tela sozinho quando um arquivo muda.

## Arquivos

- `estudio.json`: manifesto com o nome do projeto e os documentos (id, módulo, caminho, título).
- Vídeo de cenas (`"tipo": "cenas"`): `formato` {largura, altura, fps}, `tema` {fundo, texto, destaque, suave, fonte} e
  `cenas`. Cada cena tem `id`, `duracao_ms`, `fundo` opcional e `blocos`. Cada bloco tem `id`, `tipo` (`titulo`, `texto`,
  `lista`, `numero`, `imagem`), `em` e `sai` em ms contados do começo da cena, e posição em frações do quadro (0 a 1):
  `x` e `y` do canto de cima à esquerda e `largura` (a imagem tem também `altura`). `tam` é a altura da letra como
  fração do lado menor do quadro (título ~0,085; texto ~0,045). `texto` aceita `**trecho**` na cor de destaque.
  `lista` usa `itens` (lista de textos, entram um a um); `numero` conta de `de` até `ate`, com `prefixo`, `sufixo` e
  `rotulo`; `imagem` usa `src` (caminho em `midia/`) e `ajuste` (`cobrir` ou `conter`). `alinhar`: esquerda, centro
  ou direita. Ids novos não podem repetir os que já existem.
  Som (opcional): `audio.faixas[]`, cada faixa com `id`, `nome`, `papel` (`voz`, `musica` ou `efeitos`), `volume` (0 a 1),
  `mudo` e, na música, `ducking` {ativo, alvo_lu (quanto fica abaixo da voz; padrão 20), ataque_ms, soltura_ms}; cada
  `clipes[]` com `id`, `arquivo` (em `midia/`), `em` (ms na linha do tempo), `duracao_ms`, `corte_ms`, `volume`,
  `fade_in_ms`, `fade_out_ms` e `mudo`. O que ficar fora do vídeo vira aviso, não erro (detalhe em docs/audio.md do app).
- Kit de marca: `aplicar_marca` põe num documento as cores, a fonte, o logo (`midia/logo-<id>.*`) e as fontes próprias
  (`fontes/`) de um kit (ks, bkm, neutro ou outro criado no app). No vídeo de cenas isso fica no `tema`: `marca` é o id do
  kit, e `logo`, `assinatura` e `fontes_arquivos` (cada uma com `familia`, `arquivo` e `peso`) acompanham as cores. Na
  imagem muda o fundo e a fonte e a cor dos textos. `fonte` aceita Inter, Archivo, IBM Plex Sans, IBM Plex Mono ou a
  `familia` de uma fonte própria. Fique nas cores do kit; para outra marca, troque o kit em vez de inventar cores.
- `midia/`: arquivos usados pelos documentos. `saidas/`: o que o app exporta (fora do git).
- `comentarios.json`: comentários da pessoa, ancorados num objeto (`alvo.objeto`, JSON Pointer), num tempo e num ponto.
- `.estudio/diario.jsonl`: diário de todas as mudanças (quem, quando, patch e patch inverso).
- `pesquisa/pesquisa.json`: fontes e fatos da pesquisa (seção "Pesquisa" abaixo); o texto de cada fonte fica em
  `pesquisa/fontes/<id>.txt` (fora do git). `pesquisa/dossie.md` é o rascunho do skill `pesquisa-juridica`.

## Como trabalhar

1. `estado_do_editor` diz o que a pessoa está vendo e o que está selecionado.
2. `ler_documento` devolve o JSON e a `versao`; `aplicar_patch` muda com JSON Patch (RFC 6902) e `versao_base`.
   Ponha um `test` no valor que vai trocar. Se o documento mudou por baixo, leia de novo e refaça.
3. `criar_documento` cria vídeo, imagem ou cena 3D no projeto; `renomear_projeto` muda o nome.
4. `listar_comentarios`, `ler_comentario`, `responder_comentario` e `resolver_comentario` cuidam dos pedidos da pessoa.
5. `listar_mudancas` mostra o que a pessoa mudou à mão desde a sua última olhada.
6. `aplicar_marca` troca o kit de marca (cores, fonte, logo e fontes próprias) de um documento.

## Pesquisa

Todo fato jurídico, número, prazo ou decisão que entrar numa cena precisa de fonte. A pesquisa fica em
`pesquisa/pesquisa.json` e aparece no painel Pesquisa do app; você a grava pelas ferramentas abaixo, nunca à mão.

1. **Ler a fonte.** `ler_fonte` {url, observacao?, titulo?} baixa a página, guarda o texto limpo, o sha256, o nível pelo
   catálogo e as marcas de vigência, e devolve a fonte (`f1`, `f2`…) com o começo do texto. `texto_da_fonte` {fonte_id,
   pagina? ou inicio? e fim?} lê o resto, 6.000 caracteres por página. `anotar_fonte` {fonte_id, observacao} acrescenta
   à observação da fonte (a "observação de quem baixou": contexto, ressalva, de onde veio); nunca apaga o que havia.
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
7. **Regras da Cliente** (são avisos; a pessoa decide): nunca o nome da empresa empregadora nem de trabalhador no texto do
   vídeo ("a usina localizada em Cidade Exemplo", "operador de alto-forno"); nada de honorários, grátis, resultado
   garantido, "entre na Justiça", "contrate"; nada de valor a receber ou chance de ganhar; decisão de 1º grau é
   "sujeita a recurso"; sem travessão; última frase fixa: "Ficou com alguma dúvida? Procure um advogado trabalhista."
8. **Fato é fato.** A pesquisa registra o que a fonte diz: ninguém aprova nem reprova, e nada bloqueia a exportação.
   Não censure, não apague nem anonimize nada da fonte (nomes, partes, OAB, CNPJ ficam como no original); o cuidado
   com nomes vale só para o texto do vídeo.
9. **Narração confere com os fatos.** Depois de escrever as cenas, releia cada fala contra a pesquisa: todo número e
   regra da fala tem de estar num fato. O que não estiver sai ou vira pergunta para a pessoa.

Tudo o que você faz cai nos documentos, e a pessoa edita depois. Não grave fora da pasta do projeto.
