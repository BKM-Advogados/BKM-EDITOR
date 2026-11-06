# Carrossel de páginas na imagem

Versão 1, de 06/11/2026. Itens 8 e 9 da ordem sugerida em `tasks/estudio-funcoes-ancoras-2026-11-06`: carrossel de
várias páginas com campos por página e exportação em PDF para o LinkedIn. Código: `src/nucleo/carrossel.ts` (formato e
patches, puro), `src/renderer/modulos/imagem/PaginasImagem.tsx` (barra de páginas), `exportarPaginas.ts` (desenho de
cada página) e `src/main/exportar-paginas.ts` (PNG por página e PDF). Testes em `testes/carrossel.test.ts`.

## Formato

O documento de imagem ganhou `paginas`. Cada página tem `id`, `nome` e as suas `camadas` (imagem, texto, forma, de
baixo para cima, como antes). `largura`, `altura`, `fundo` e `efeitos` são do documento e valem para todas as páginas:
um carrossel tem um tamanho só (1080×1350 para o feed 4:5, 1080×1080 para o quadrado; os tamanhos de
`src/nucleo/formatos.ts`).

```json
{
  "formato": 1,
  "largura": 1080,
  "altura": 1350,
  "fundo": "#111418",
  "camadas": [],
  "paginas": [
    {"id": "capa", "nome": "Capa", "camadas": [{"id": "titulo", "tipo": "texto", "texto": "…"}, {"id": "pagina", "tipo": "texto", "texto": "1/7"}]},
    {"id": "pagina-2", "nome": "Página 2", "camadas": [{"id": "titulo"}, {"id": "texto"}, {"id": "pagina", "texto": "2/7"}]},
    {"id": "final", "nome": "Final", "camadas": []}
  ],
  "efeitos": []
}
```

**Uma prancheta só continua como estava.** Documento sem `paginas` (a `capa.json` da Cliente, os projetos de antes) vale
como uma página só: `paginasDe(doc)` devolve, em memória, `[{id: "pagina-1", nome: "Página 1", camadas: doc.camadas}]`
e nada é reescrito no arquivo da pessoa. O arquivo só ganha `paginas` quando ela cria a segunda página (ou renomeia a
primeira): a primeira página recebe as camadas da raiz e `camadas` fica `[]`. Num carrossel, a lista `camadas` da raiz
fica vazia e é ignorada; as camadas de cada página ficam nela.

Os caminhos de camada (seleção, comentários, `estado_do_editor`) levam a página: `/paginas/2/camadas/0` no carrossel,
`/camadas/0` na prancheta só. Os ids de camada valem dentro da página (duas páginas podem ter uma camada `titulo`).
Os ids de página são únicos no documento e não mudam quando a página muda de lugar; a interface guarda a página
ativa pelo id.

As camadas de texto com id `pagina` e texto no padrão `2/7` são o contador: criar, duplicar, mover ou excluir páginas
acerta o contador de todas as páginas no mesmo patch. Um `pagina` com outro texto (ex.: "Capa") fica em paz.

## Tela

A barra de páginas fica no monitor da área Imagem, entre a peça e o transporte: miniaturas na ordem, a ativa com a
borda do acento. Clicar vai para a página; **PageUp/PageDown** trocam de página quando o foco está na área Imagem
(fora de campo de texto e do terminal); setas ←/→ na miniatura em foco também. **Arrastar** uma miniatura sobre outra
reordena (o filete do acento mostra de que lado ela cai). **Dois cliques no nome** (ou F2) renomeiam; **Delete** na
miniatura exclui; a última página não sai. À direita: **+ Página** (vazia, depois da ativa), **Duplicar**,
**Excluir**, o menu ⋯ (renomear, mover, novo carrossel 4:5 ou 1:1) e **Exportar carrossel**.

Camadas (lista), monitor, inspector e o trilho (T texto, U forma, inserir imagem) operam na página ativa. A lista de
camadas mostra "Página 2 de 7 · nome" no topo quando há várias; o rótulo acima da peça mostra "2/7 nome"; o inspector
sem seleção mostra a seção "Página" (nome, id, caminho) e a "Prancheta (todas as páginas)" com tamanho e fundo.
Selecionar uma camada de outra página (pelo painel de comentários, por exemplo) traz a página dela para a frente.

Na área Efeitos o monitor mostra a página ativa com a pilha; a barra não aparece lá.

## Para o Claude

`estado_do_editor` traz `pagina: "/paginas/2"` quando a imagem tem várias páginas (nada quando é uma prancheta só),
além de `documento` e `selecao` (ex.: `/paginas/2/camadas/1`). `ler_documento` com `caminho: "/paginas/2"` devolve só
aquela página. Preencher os campos é um `aplicar_patch` comum, com `test` no valor que vai trocar:

```json
[
  {"op": "test", "path": "/paginas/1/camadas/1/texto", "value": "Título da página 2"},
  {"op": "replace", "path": "/paginas/1/camadas/1/texto", "value": "Regra 1: a transferência precisa de acordo escrito"},
  {"op": "replace", "path": "/paginas/1/camadas/2/texto", "value": "Sem a anuência expressa, a mudança de cidade pode ser recusada…"}
]
```

Páginas novas pelo Claude: `add` em `/paginas/-` (ou `/paginas/3`) com `{id, nome, camadas}`; ids de página únicos;
acertar o `pagina` ("3/8") das outras páginas. Numa prancheta só, para virar carrossel: `add /paginas` com a lista
inteira (a primeira página com as camadas da raiz) e `replace /camadas` por `[]` no mesmo patch.

O `CLAUDE.md` que os projetos novos recebem (`src/nucleo/criar-projeto.ts`, da sessão do kit de marca) ainda descreve
a imagem como "largura, altura, fundo e camadas"; ao integrar, acrescentar: "ou `paginas` (carrossel: id, nome e
camadas por página; a raiz fica com `camadas: []`)".

## Modelo "Novo carrossel"

`docCarrossel({largura, altura, paginas: N})` em `src/nucleo/carrossel.ts` monta capa, N−2 páginas de conteúdo e
página final, cada uma com camadas de texto nomeadas que o Claude preenche:

| Página | Camadas (ids) | Texto de partida |
|---|---|---|
| `capa` | `faixa`, `titulo`, `subtitulo`, `chamada`, `pagina` | "Seu título em poucas palavras", "Uma linha que diz o que vem…", "Arraste para o lado →", "1/N" |
| `pagina-2`…`pagina-(N−1)` | `faixa`, `titulo`, `texto`, `pagina` | "Título da página i", "Escreva aqui o ponto principal…", "i/N" |
| `final` | `faixa`, `titulo`, `texto`, `pagina` | "Gostou? Salve e compartilhe", "Siga para ver mais…", "N/N" |

Medidas em frações do tamanho (margem 8%, título 8,5% do lado menor), fontes Archivo (títulos), IBM Plex Sans (texto)
e IBM Plex Mono (contador), cores do documento em branco (`#111418`, `#F2F2F2`, `#B8BEC7`, faixa `#C88155`). O kit de
marca entra depois pelo `tema`; o modelo não mexe em cores além disso.

Na tela: **Novo carrossel 4:5 / 1:1** no estado vazio da área Imagem e no menu ⋯ da barra de páginas; pergunta quantas
páginas (padrão 7, de 1 a 30), cria um documento de imagem em branco no projeto (`criarDocumento`, o IPC de sempre) e
aplica o patch do modelo (`patchCarrossel`): o diário registra "carrossel de N páginas".

## Exportar

**Exportar carrossel** (barra de páginas) desenha cada página com o mesmo canvas do PNG simples
(`desenharDocumento` de `exportarPng.ts`, chamado com a página como documento de uma prancheta só, `vistaDaPagina`),
com fundo, camadas e a pilha de efeitos, e grava:

- `saidas/<nome>/01.png`, `02.png`… (uma pasta por exportação; se já existir, `<nome> (2)/`);
- `saidas/<nome>.pdf` com uma página por imagem, do tamanho da imagem (1 px = 1 pt, sem margem), o carrossel nativo
  do LinkedIn; o PDF ganha o mesmo sufixo da pasta.

Ao fim o processo principal mostra o PDF na pasta, e a barra oferece **Mostrar na pasta**. O PDF é feito com `pdf-lib`
(dependência nova, 1.17.1, só JavaScript), no processo principal, a partir dos PNG. O IPC é `exportarPaginas`
(`estudio:exportar-paginas`, no fim de `api.ts`, `preload.ts` e `main.ts`), com o handler em
`src/main/exportar-paginas.ts`, que não importa o Electron (os testes chamam `gravarPaginas` direto).

**Exportar página** (transporte do monitor, num carrossel) grava só a página ativa: `saidas/<nome> - 03.png`. Numa
prancheta só, o botão continua sendo o "Exportar PNG" de sempre.

O **Exportar** da barra da casca (Ctrl+Shift+E) continua chamando `exportarPng`, que desenha `doc.camadas` da raiz:
num carrossel sai só o fundo. Ao integrar com o diálogo de exportação (sessão C), chamar `exportarCarrossel` quando
`temPaginas(doc)`.

## Limites conhecidos

- Comentários ancorados em `/camadas/N` de uma prancheta que virou carrossel ficam com o caminho antigo; o pino ainda
  acha a camada pelo `objeto_id` quando está na página ativa.
- As miniaturas da barra não aplicam a pilha de efeitos (servem para achar a página, não para conferir cor).
- Não há página-mestre (camadas repetidas em todas as páginas); duplicar a página é o caminho hoje.
- O tamanho do PDF em pontos é o da imagem em pixels; o LinkedIn rasteriza e não se importa, uma impressora sim.
