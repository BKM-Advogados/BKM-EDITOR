// Carrossel: um documento de imagem com várias páginas (pranchetas) do mesmo tamanho. Tudo aqui é puro, sem disco nem
// DOM: a interface, os testes e o MCP usam as mesmas funções. Documento sem `paginas` continua valendo como uma página
// só, em memória; o arquivo da pessoa só ganha `paginas` quando ela cria a segunda página (ou renomeia a primeira).
// Cada operação devolve o patch e a lista de páginas que resulta dele, para a interface escolher a página ativa sem
// reler o disco. Ver docs/carrossel.md.
import type {CamadaImagem, DocImagem, OperacaoPatch, PaginaImagem} from './documentos';

export const NOME_PAGINA = (n: number) => `Página ${n}`;

/** "Título da página" → "titulo-da-pagina"; vazio → `vazio`. */
export const slug = (texto: string, vazio = 'item') =>
  texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || vazio;

/** Id que ainda não existe na lista: "<base>-1", "<base>-2"… (a base perde um "-N" que já tenha, para a cópia de "pagina-2" sair "pagina-3"). */
export const idLivre = (usados: {id: string}[], base: string) => {
  const limpo = slug(base).replace(/-\d+$/, '') || 'item';
  let n = 1;
  while (usados.some((x) => x.id === `${limpo}-${n}`)) n++;
  return `${limpo}-${n}`;
};

export const temPaginas = (doc: Pick<DocImagem, 'paginas'> | undefined): boolean => Array.isArray(doc?.paginas);

// a página única em memória é guardada por documento: a mesma lista para o mesmo objeto, para os seletores da
// interface (que comparam por referência) não verem uma página nova a cada leitura
const unicaPorDoc = new WeakMap<object, PaginaImagem[]>();

/** Páginas como a interface vê: as do documento ou, numa prancheta só, uma página em memória com as camadas da raiz. */
export const paginasDe = (doc: DocImagem): PaginaImagem[] => {
  if (Array.isArray(doc.paginas)) return doc.paginas;
  const chave = doc && typeof doc === 'object' ? doc : null;
  const pronta = chave ? unicaPorDoc.get(chave) : undefined;
  if (pronta) return pronta;
  const unica: PaginaImagem[] = [{id: 'pagina-1', nome: NOME_PAGINA(1), camadas: Array.isArray(doc?.camadas) ? doc.camadas : []}];
  if (chave) unicaPorDoc.set(chave, unica);
  return unica;
};

/** Caminho da lista de camadas da página `p`: "/camadas" numa prancheta só, "/paginas/2/camadas" no carrossel. */
export const baseCamadas = (doc: DocImagem, p: number) => (temPaginas(doc) ? `/paginas/${p}/camadas` : '/camadas');

/** Índice N num caminho "<base>/N"; -1 se o caminho não for uma camada dessa lista. */
export const indiceNaBase = (caminho: string | null | undefined, base: string) => {
  if (!caminho || !caminho.startsWith(`${base}/`)) return -1;
  const resto = caminho.slice(base.length + 1);
  return /^\d+$/.test(resto) ? Number(resto) : -1;
};

/** Página de um caminho de camada: "/paginas/1/camadas/3" → 1; "/camadas/3" → 0 numa prancheta só; -1 se não for camada deste documento. */
export const paginaDoCaminho = (doc: DocImagem, caminho?: string | null): number => {
  const m = /^\/paginas\/(\d+)\/camadas\/\d+$/.exec(caminho ?? '');
  if (m) return temPaginas(doc) ? Number(m[1]) : -1;
  return /^\/camadas\/\d+$/.test(caminho ?? '') && !temPaginas(doc) ? 0 : -1;
};

/** Caminho da página `p` para o estado do editor ("/paginas/2"); uma prancheta só não tem o que dizer. */
export const caminhoPagina = (doc: DocImagem, p: number) => (temPaginas(doc) ? `/paginas/${p}` : undefined);

/** Índice num caminho "/paginas/N" (o do estado gravado); -1 se não for. */
export const indicePagina = (caminho?: string | null) => {
  const m = /^\/paginas\/(\d+)$/.exec(caminho ?? '');
  return m ? Number(m[1]) : -1;
};

/** A página `p` como documento de uma prancheta só: é o que a prévia e a exportação (exportarPng.ts) desenham. */
export const vistaDaPagina = (doc: DocImagem, p: number): DocImagem => {
  const {paginas: _paginas, ...resto} = doc;
  return {...resto, camadas: paginasDe(doc)[p]?.camadas ?? []};
};

export const novaPagina = (paginas: PaginaImagem[], nome?: string, camadas: CamadaImagem[] = []): PaginaImagem =>
  ({id: idLivre(paginas, 'pagina'), nome: nome ?? NOME_PAGINA(paginas.length + 1), camadas});

// ---------- operações (patches) ----------
export type ResultadoPaginas = {patch: OperacaoPatch[]; paginas: PaginaImagem[]; indice: number};

const CONTADOR = /^\d+\s*\/\s*\d+$/;

/** Acerta o "2/7" das camadas de texto com id `pagina` depois de criar, mover ou excluir páginas (só as que ainda são contador). */
export const opsNumerar = (paginas: PaginaImagem[]): OperacaoPatch[] => {
  const ops: OperacaoPatch[] = [];
  paginas.forEach((pg, i) => pg.camadas.forEach((c, k) => {
    if (c.id !== 'pagina' || c.tipo !== 'texto' || !CONTADOR.test(c.texto ?? '')) return;
    const novo = `${i + 1}/${paginas.length}`;
    if (c.texto !== novo) ops.push({op: 'replace', path: `/paginas/${i}/camadas/${k}/texto`, value: novo});
  }));
  return ops;
};

/** Ops que levam uma prancheta só ao formato com `paginas`: a primeira página recebe as camadas da raiz, que fica vazia. */
const opsMigrar = (doc: DocImagem): {ops: OperacaoPatch[]; paginas: PaginaImagem[]} => {
  if (temPaginas(doc)) return {ops: [], paginas: doc.paginas!};
  const paginas = paginasDe(doc);
  return {ops: [{op: 'add', path: '/paginas', value: paginas}, {op: 'add', path: '/camadas', value: []}], paginas};
};

const exigir = (paginas: PaginaImagem[], p: number) => {
  const pg = paginas[p];
  if (!pg) throw new Error(`a página ${p} não existe (o documento tem ${paginas.length})`);
  return pg;
};

/** Página nova (vazia, ou com `camadas`) depois de `depoisDe`; sem `depoisDe`, no fim. */
export const patchNovaPagina = (doc: DocImagem, depoisDe?: number, nome?: string, camadas?: CamadaImagem[]): ResultadoPaginas => {
  const {ops, paginas} = opsMigrar(doc);
  const nova = novaPagina(paginas, nome, camadas);
  const i = depoisDe === undefined ? paginas.length : Math.max(0, Math.min(paginas.length, depoisDe + 1));
  const depois = [...paginas.slice(0, i), nova, ...paginas.slice(i)];
  return {patch: [...ops, {op: 'add', path: `/paginas/${i}`, value: nova}, ...opsNumerar(depois)], paginas: depois, indice: i};
};

/** Cópia da página `p` logo depois dela, com id novo (as camadas mantêm os ids: valem dentro da página). */
export const patchDuplicarPagina = (doc: DocImagem, p: number): ResultadoPaginas => {
  const {ops, paginas} = opsMigrar(doc);
  const origem = exigir(paginas, p);
  const copia: PaginaImagem = {...structuredClone(origem), id: idLivre(paginas, origem.id), nome: `${origem.nome} (cópia)`};
  const depois = [...paginas.slice(0, p + 1), copia, ...paginas.slice(p + 1)];
  return {patch: [...ops, {op: 'test', path: `/paginas/${p}/id`, value: origem.id}, {op: 'add', path: `/paginas/${p + 1}`, value: copia}, ...opsNumerar(depois)],
    paginas: depois, indice: p + 1};
};

/** Move a página `de` para a posição `para` (as outras escorregam). */
export const patchMoverPagina = (doc: DocImagem, de: number, para: number): ResultadoPaginas => {
  const paginas = paginasDe(doc);
  const pg = exigir(paginas, de);
  exigir(paginas, para);
  if (de === para || !temPaginas(doc)) return {patch: [], paginas, indice: de};
  const depois = [...paginas];
  depois.splice(para, 0, ...depois.splice(de, 1));
  return {patch: [{op: 'test', path: `/paginas/${de}/id`, value: pg.id}, {op: 'move', from: `/paginas/${de}`, path: `/paginas/${para}`}, ...opsNumerar(depois)],
    paginas: depois, indice: para};
};

/** Exclui a página `p`; a última página não sai (null). A ativa passa a ser a vizinha. */
export const patchExcluirPagina = (doc: DocImagem, p: number): ResultadoPaginas | null => {
  const paginas = paginasDe(doc);
  const pg = exigir(paginas, p);
  if (paginas.length < 2 || !temPaginas(doc)) return null;
  const depois = paginas.filter((_, i) => i !== p);
  return {patch: [{op: 'test', path: `/paginas/${p}/id`, value: pg.id}, {op: 'remove', path: `/paginas/${p}`}, ...opsNumerar(depois)],
    paginas: depois, indice: Math.min(p, depois.length - 1)};
};

/** Novo nome da página `p` (numa prancheta só, o documento passa a ter `paginas`). */
export const patchRenomearPagina = (doc: DocImagem, p: number, nome: string): ResultadoPaginas => {
  const paginas = paginasDe(doc);
  const pg = exigir(paginas, p);
  const limpo = nome.trim().slice(0, 80) || pg.nome;
  const depois = paginas.map((x, i) => (i === p ? {...x, nome: limpo} : x));
  // numa prancheta só, o nome já vai dentro do valor de /paginas
  const patch: OperacaoPatch[] = temPaginas(doc)
    ? [{op: 'test', path: `/paginas/${p}/nome`, value: pg.nome}, {op: 'replace', path: `/paginas/${p}/nome`, value: limpo}]
    : [{op: 'add', path: '/paginas', value: depois}, {op: 'add', path: '/camadas', value: []}];
  return {patch, paginas: depois, indice: p};
};

// ---------- modelo "Novo carrossel" ----------
export type OpcoesCarrossel = {largura: number; altura: number; paginas: number; fundo?: string};

const COR = {texto: '#F2F2F2', suave: '#B8BEC7', destaque: '#C88155'};
const ENTRELINHA = 1.15;

/** Modelo do carrossel: capa, páginas de conteúdo e página final, cada uma com camadas de texto nomeadas (`titulo`,
 *  `texto`, `subtitulo`, `chamada` e `pagina` com "2/7") que o Claude preenche por aplicar_patch. As cores são as do
 *  documento em branco; o kit de marca entra depois pelo tema. */
export const docCarrossel = (o: OpcoesCarrossel): DocImagem => {
  const W = Math.round(o.largura);
  const H = Math.round(o.altura);
  const n = Math.max(1, Math.min(30, Math.round(o.paginas)));
  const m = Math.round(W * 0.08);
  const cw = W - 2 * m;
  const menor = Math.min(W, H);
  const tamTitulo = Math.round(menor * 0.085);
  const tamSub = Math.round(menor * 0.055);
  const tamTexto = Math.round(menor * 0.04);
  const tamConta = Math.round(menor * 0.028);
  const alt = (tam: number, linhas: number) => Math.round(tam * ENTRELINHA * linhas);
  const yConta = H - m - alt(tamConta, 1);

  const texto = (id: string, nome: string, t: string, x: number, y: number, largura: number, altura: number, extra: Partial<CamadaImagem>): CamadaImagem =>
    ({id, nome, tipo: 'texto', x, y, largura, altura, texto: t, fonte: 'IBM Plex Sans', peso: 400, tamanho: tamTexto, cor: COR.texto, alinhar: 'esquerda', ...extra});
  const faixa = (y: number): CamadaImagem => ({id: 'faixa', nome: 'Faixa', tipo: 'forma', forma: 'retangulo', preenchimento: COR.destaque, x: m, y, largura: Math.round(cw * 0.12), altura: Math.max(6, Math.round(menor * 0.008))});
  const contador = (i: number): CamadaImagem =>
    texto('pagina', 'Número da página', `${i}/${n}`, W - m - Math.round(cw * 0.3), yConta, Math.round(cw * 0.3), alt(tamConta, 1), {fonte: 'IBM Plex Mono', peso: 500, tamanho: tamConta, cor: COR.suave, alinhar: 'direita'});

  const capa = (): PaginaImagem => {
    const yFaixa = Math.round(H * 0.3);
    const yTitulo = yFaixa + Math.round(menor * 0.03);
    const hTitulo = alt(tamTitulo, 3);
    return {id: 'capa', nome: 'Capa', camadas: [
      faixa(yFaixa),
      texto('titulo', 'Título', 'Seu título em\npoucas palavras', m, yTitulo, cw, hTitulo, {fonte: 'Archivo', peso: 800, tamanho: tamTitulo}),
      texto('subtitulo', 'Subtítulo', 'Uma linha que diz o que vem nas próximas páginas', m, yTitulo + hTitulo + Math.round(menor * 0.02), cw, alt(tamSub, 2), {tamanho: tamSub, cor: COR.suave}),
      texto('chamada', 'Chamada', 'Arraste para o lado →', m, yConta, Math.round(cw * 0.6), alt(tamConta, 1), {tamanho: tamConta, cor: COR.suave}),
      contador(1),
    ]};
  };
  const conteudo = (i: number): PaginaImagem => {
    const yTitulo = m + Math.round(menor * 0.03);
    const hTitulo = alt(tamSub, 2);
    const yTexto = yTitulo + hTitulo + Math.round(menor * 0.025);
    return {id: `pagina-${i}`, nome: NOME_PAGINA(i), camadas: [
      faixa(m),
      texto('titulo', 'Título', `Título da página ${i}`, m, yTitulo, cw, hTitulo, {fonte: 'Archivo', peso: 800, tamanho: tamSub}),
      texto('texto', 'Texto', 'Escreva aqui o ponto principal desta página, em poucas frases curtas.', m, yTexto, cw, Math.max(alt(tamTexto, 2), yConta - Math.round(menor * 0.04) - yTexto), {}),
      contador(i),
    ]};
  };
  const final = (): PaginaImagem => {
    const yTitulo = Math.round(H * 0.36);
    const hTitulo = alt(tamTitulo, 2);
    return {id: 'final', nome: 'Final', camadas: [
      faixa(yTitulo - Math.round(menor * 0.03)),
      texto('titulo', 'Título', 'Gostou?\nSalve e compartilhe', m, yTitulo, cw, hTitulo, {fonte: 'Archivo', peso: 800, tamanho: tamTitulo}),
      texto('texto', 'Texto', 'Siga para ver mais conteúdos como este.', m, yTitulo + hTitulo + Math.round(menor * 0.02), cw, alt(tamSub, 2), {tamanho: tamSub, cor: COR.suave}),
      contador(n),
    ]};
  };

  const paginas: PaginaImagem[] = [capa()];
  for (let i = 2; i < n; i++) paginas.push(conteudo(i));
  if (n >= 2) paginas.push(final());
  return {formato: 1, largura: W, altura: H, fundo: o.fundo ?? '#111418', camadas: [], paginas, efeitos: []};
};

/** Patch que transforma um documento de imagem recém-criado no carrossel do modelo (mesmo tamanho). */
export const patchCarrossel = (modelo: DocImagem): OperacaoPatch[] => [
  {op: 'add', path: '/fundo', value: modelo.fundo},
  {op: 'add', path: '/camadas', value: []},
  {op: 'add', path: '/paginas', value: modelo.paginas},
];

/** Camada pelo id ("foto-1", em qualquer página) ou pelo caminho ("/camadas/2", "/paginas/1/camadas/0"): o caminho
 *  atual dela e ela; null se não há (as ferramentas do MCP aceitam os dois jeitos). */
export const acharCamada = (doc: DocImagem, ref: string): {caminho: string; c: CamadaImagem} | null => {
  const paginas = paginasDe(doc);
  for (let p = 0; p < paginas.length; p++) {
    const base = baseCamadas(doc, p);
    const camadas = Array.isArray(paginas[p]?.camadas) ? paginas[p].camadas : [];
    const i = ref.startsWith('/') ? indiceNaBase(ref, base) : camadas.findIndex((c) => c?.id === ref);
    if (i >= 0 && camadas[i]) return {caminho: `${base}/${i}`, c: camadas[i]};
  }
  return null;
};

/** Caminhos de todas as camadas com este id (duplicar página repete os ids das camadas). */
export const caminhosDoId = (doc: DocImagem, id: string): string[] =>
  paginasDe(doc).flatMap((pg, p) => (Array.isArray(pg?.camadas) ? pg.camadas : []).flatMap((c, i) => (c?.id === id ? [`${baseCamadas(doc, p)}/${i}`] : [])));
