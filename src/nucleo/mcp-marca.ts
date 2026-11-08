// Ferramentas do MCP para a marca na imagem (rodada 3, frente Marca): ver o kit do documento, pôr uma cor ou uma fonte do kit
// numa camada e buscar e inserir ícones do Lucide. O que a pessoa faz no campo de cor e no seletor de fonte a IA faz aqui: a
// camada recebe a referência ("@destaque", "@titulo"), não uma cópia do valor, e acompanha o kit quando ele troca. Todas
// são da classe `livre` (gravam no diário com o autor e têm Reverter); nenhuma lê a web nem traz arquivo de fora.
// Descrições curtas e esquemas sem z.any() nem união solta, porque o Gemini, o DeepSeek (modo strict) e os modelos locais
// recusam o resto. Quem registra é ferramentas-mcp.ts, com uma linha.
import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {z} from 'zod';
import {acharCamada, baseCamadas, caminhosDoId, idLivre, paginasDe} from './carrossel';
import {iconeNovo, type OpcoesIcone} from './camadas-novas';
import {ehDocCenas} from './cenas';
import {amostrasDaMarca, avisoDeContraste, ehReferenciaCor, resolverCor} from './cor-marca';
import {buscarIcones, etiquetasDoIcone, existeIcone, sugerirIcones, VERSAO_LUCIDE} from './icones';
import type {CamadaImagem, DocImagem, MarcaDoDocumento, OperacaoPatch} from './documentos';
import {MARCA_NEUTRO, marcaDoKit} from './marca';
import {ErroProjeto, type Projeto} from './projeto';

const texto = (x: unknown) => ({content: [{type: 'text' as const, text: typeof x === 'string' ? x : JSON.stringify(x, null, 2)}]});
const erro = (e: unknown) => ({
  isError: true,
  content: [{type: 'text' as const, text: e instanceof ErroProjeto ? `${e.codigo}: ${e.message}` : String((e as Error)?.message ?? e)}],
});
const seguro = <A,>(f: (a: A) => unknown) => async (a: A) => {
  try {
    return texto(await f(a));
  } catch (e) {
    return erro(e);
  }
};

const ehImagem = (doc: unknown): doc is DocImagem => {
  const d = doc as DocImagem | null;
  return Boolean(d) && typeof d === 'object' && (Array.isArray(d!.camadas) || Array.isArray(d!.paginas)) && typeof d!.largura === 'number';
};

export const CAMPOS_DE_COR = ['cor', 'preenchimento', 'contorno', 'sombra', 'fundo'] as const;
export type CampoDeCor = (typeof CAMPOS_DE_COR)[number];
export const PAPEIS_DE_FONTE = ['titulo', 'texto', 'mono'] as const;
export type PapelDeFonte = (typeof PAPEIS_DE_FONTE)[number];

/** O kit que a imagem guarda; sem ele, o neutro (e a ferramenta avisa). */
const kitDa = (doc: DocImagem): {marca: MarcaDoDocumento; semKit: boolean} => ({marca: doc.marca ?? marcaDoKit(MARCA_NEUTRO), semKit: !doc.marca});

/** A camada pelo id ou pelo caminho; id repetido em página duplicada pede o caminho. */
const camadaDe = (doc: DocImagem, ref: string) => {
  const mesmos = ref.startsWith('/') ? [] : caminhosDoId(doc, ref);
  if (mesmos.length > 1) throw new ErroProjeto(`o id ${ref} está em ${mesmos.length} camadas (${mesmos.join(', ')}): passe o caminho da que é para mudar`, 'patch');
  const achada = acharCamada(doc, ref);
  if (!achada) throw new ErroProjeto(`camada não achada: ${ref}`, 'nao_achado');
  return achada;
};

/** "destaque" ou "@destaque+35" → "@destaque+35"; confere se o nome existe no kit e diz quais existem. */
export const referenciaDeCor = (nome: string, marca: Pick<MarcaDoDocumento, 'cores'>): string => {
  const t = nome.trim();
  const ref = t.startsWith('@') ? t : `@${t}`;
  if (!ehReferenciaCor(ref)) throw new ErroProjeto(`"${nome}" não é uma cor do kit: use o nome ("destaque") ou a forma "@destaque", "@destaque+35", "@destaque-20" ou "@fundo:destaque:25"`, 'patch');
  const base = ref.slice(1).split(/[+:-]/)[0];
  const nomes = Object.keys(marca.cores);
  if (!nomes.some((n) => n.toLowerCase() === base.toLowerCase())) throw new ErroProjeto(`o kit não tem a cor "${base}": ${nomes.join(', ')}`, 'patch');
  return ref;
};

export type CorDaMarca = {patch: OperacaoPatch[]; camada?: string; campo: CampoDeCor; valor: string; cor: string; avisos: string[]};

/** O patch que põe a cor do kit no campo de uma camada (ou no fundo da peça). */
export const patchCorDaMarca = (doc: DocImagem, camada: string | undefined, campo: CampoDeCor, nome: string): CorDaMarca => {
  const {marca, semKit} = kitDa(doc);
  const valor = referenciaDeCor(nome, marca);
  const avisos: string[] = [];
  if (semKit) avisos.push('a imagem ainda não tem kit: a cor vem do neutro até aplicar_marca');
  const cor = resolverCor(valor, marca);
  if (campo === 'fundo') {
    return {patch: [{op: 'replace', path: '/fundo', value: valor}], campo, valor, cor, avisos};
  }
  if (!camada) throw new ErroProjeto(`o campo ${campo} pede a camada (id ou caminho)`, 'patch');
  const {caminho, c} = camadaDe(doc, camada);
  let path: string;
  let atual: unknown;
  if (campo === 'cor') {
    if (c.tipo !== 'texto') throw new ErroProjeto(`${c.id} é ${c.tipo}: a cor é do texto (na forma, use preenchimento)`, 'patch');
    path = `${caminho}/cor`;
    atual = c.cor;
    const aviso = avisoDeContraste(valor, doc.fundo, marca);
    if (aviso) avisos.push(aviso);
  } else if (campo === 'preenchimento') {
    if (c.tipo !== 'forma') throw new ErroProjeto(`${c.id} é ${c.tipo}: o preenchimento é da forma (no texto, use cor)`, 'patch');
    path = `${caminho}/preenchimento`;
    atual = c.preenchimento;
  } else {
    const enfeite = c[campo];
    if (!enfeite) throw new ErroProjeto(`${c.id} não tem ${campo}: crie antes por aplicar_patch (ex.: {"espessura": 4})`, 'patch');
    path = `${caminho}/${campo}/cor`;
    atual = enfeite.cor;
  }
  return {patch: [{op: atual === undefined ? 'add' : 'replace', path, value: valor}], camada: caminho, campo, valor, cor, avisos};
};

/** O patch que põe a fonte do kit ("@titulo", "@texto" ou "@mono") num texto. */
export const patchFonteDaMarca = (doc: DocImagem, camada: string, papel: PapelDeFonte) => {
  const {caminho, c} = camadaDe(doc, camada);
  if (c.tipo !== 'texto') throw new ErroProjeto(`${c.id} é ${c.tipo}: a fonte é do texto`, 'patch');
  const {marca, semKit} = kitDa(doc);
  const fonte = papel === 'titulo' ? marca.fontes.titulo : papel === 'texto' ? marca.fontes.texto : marca.fontes.mono ?? marca.fontes.texto;
  const avisos = semKit ? ['a imagem ainda não tem kit: a fonte vem do neutro até aplicar_marca'] : [];
  return {patch: [{op: c.fonte === undefined ? 'add' : 'replace', path: `${caminho}/fonte`, value: `@${papel}`} as OperacaoPatch], camada: caminho, valor: `@${papel}`, fonte, avisos};
};

/** O que o kit do documento oferece, para a IA saber os nomes antes de pedir uma cor. */
export const descreverMarca = (doc: unknown) => {
  if (ehImagem(doc)) {
    const {marca, semKit} = kitDa(doc);
    return {kit: semKit ? null : marca.id, nome: marca.nome ?? marca.id, ...(semKit ? {aviso: 'sem kit: a imagem lê o neutro; aplicar_marca põe um'} : {}),
      cores: amostrasDaMarca(marca).map((a) => ({nome: a.nome, referencia: a.referencia, valor: a.valor})), fontes: marca.fontes,
      como_usar: 'cor_da_marca põe "@nome" num campo de cor; fonte_da_marca põe "@titulo", "@texto" ou "@mono" no texto. "@nome+35" clareia 35%, "@nome-20" escurece 20%, "@fundo:destaque:25" mistura.'};
  }
  if (ehDocCenas(doc)) {
    const t = doc.tema;
    return {kit: (t as {marca?: string} | undefined)?.marca ?? null, tema: t ?? null, como_usar: 'no vídeo de cenas o kit é o "tema" do documento (aplicar_marca troca; aplicar_patch em /tema ajusta)'};
  }
  return {kit: null, aviso: 'este documento não recebe kit de marca'};
};

export const registrarMarca = (servidor: McpServer, projeto: Projeto, autor: string, origem: string) => {
  const alvoDe = (documento?: string) => {
    const alvo = documento ?? projeto.estado()?.documento ?? projeto.manifesto().documentos[0]?.id;
    if (!alvo) throw new ErroProjeto('o projeto não tem documento', 'nao_achado');
    return alvo;
  };
  const imagem = (documento?: string) => {
    const alvo = alvoDe(documento);
    const lido = projeto.lerJson<unknown>(projeto.arquivoDoDocumento(alvo));
    if (!ehImagem(lido.doc)) throw new ErroProjeto(`${alvo} não é uma imagem`, 'patch');
    return {alvo, doc: lido.doc, versao: lido.versao};
  };

  registrarIcones(servidor, projeto, autor, origem, imagem);

  servidor.registerTool('ver_marca', {
    description: 'Mostra o kit de marca do documento: nome, cores (com o nome que se usa em cor_da_marca) e fontes. Sem documento, o que a pessoa está vendo.',
    inputSchema: {documento: z.string().optional().describe('id do documento')},
  }, seguro(({documento}: {documento?: string}) => {
    const alvo = alvoDe(documento);
    return {documento: alvo, ...descreverMarca(projeto.lerJson<unknown>(projeto.arquivoDoDocumento(alvo)).doc)};
  }));

  servidor.registerTool('cor_da_marca', {
    description: 'Põe uma cor do kit num campo da imagem, por referência ("@destaque"): a camada acompanha o kit quando ele troca. Campos: cor (texto), preenchimento (forma), contorno, sombra (da camada) e fundo (da peça, sem camada). Avisa se o texto fica abaixo de 4,5:1 sobre o fundo.',
    inputSchema: {
      documento: z.string().optional().describe('id do documento de imagem'),
      camada: z.string().optional().describe('id ou caminho da camada (não vale para fundo)'),
      campo: z.enum(CAMPOS_DE_COR).describe('qual cor trocar'),
      nome: z.string().describe('nome da cor no kit, ex.: destaque, ou com variação: destaque+35'),
    },
  }, seguro(({documento, camada, campo, nome}: {documento?: string; camada?: string; campo: CampoDeCor; nome: string}) => {
    const {alvo, doc, versao} = imagem(documento);
    const r = patchCorDaMarca(doc, camada, campo, nome);
    const gravado = projeto.aplicarPatch({documento: alvo, versao_base: versao, patch: r.patch, autor, origem, rotulo: `${r.camada ?? 'fundo'}: ${campo} ${r.valor}`});
    return {ok: true, documento: alvo, camada: r.camada, campo, valor: r.valor, cor: r.cor, versao: gravado.versao, ...(r.avisos.length ? {avisos: r.avisos} : {})};
  }));

  servidor.registerTool('fonte_da_marca', {
    description: 'Põe a fonte do kit num texto da imagem, por referência: titulo, texto ou mono (sem mono, a de texto). A camada acompanha o kit quando ele troca.',
    inputSchema: {
      documento: z.string().optional().describe('id do documento de imagem'),
      camada: z.string().describe('id ou caminho da camada de texto'),
      papel: z.enum(PAPEIS_DE_FONTE).describe('titulo, texto ou mono'),
    },
  }, seguro(({documento, camada, papel}: {documento?: string; camada: string; papel: PapelDeFonte}) => {
    const {alvo, doc, versao} = imagem(documento);
    const r = patchFonteDaMarca(doc, camada, papel);
    const gravado = projeto.aplicarPatch({documento: alvo, versao_base: versao, patch: r.patch, autor, origem, rotulo: `${r.camada}: fonte ${r.valor}`});
    return {ok: true, documento: alvo, camada: r.camada, valor: r.valor, fonte: r.fonte, versao: gravado.versao, ...(r.avisos.length ? {avisos: r.avisos} : {})};
  }));
};


// ---------- ícones ----------
export type PedidoIcone = {icone: string; pagina?: string; x?: number; y?: number; tamanho?: number; cor?: string; espessura?: number};

/** O patch que insere um ícone do Lucide na página (a primeira, sem `pagina`): forma "icone" na cor do kit. */
export const patchInserirIcone = (doc: DocImagem, p: PedidoIcone) => {
  const nome = p.icone.trim().toLowerCase().replace(/\s+/g, '-');
  if (!existeIcone(nome)) {
    const parecidos = sugerirIcones(p.icone, 5);
    throw new ErroProjeto(`ícone não achado: ${p.icone}${parecidos.length ? ` (parecidos: ${parecidos.join(', ')}; buscar_icone procura em português)` : ''}`, 'nao_achado');
  }
  const paginas = paginasDe(doc);
  const i = p.pagina === undefined ? 0 : paginas.findIndex((x) => x.id === p.pagina);
  if (i < 0) throw new ErroProjeto(`página não achada: ${p.pagina} (ids: ${paginas.map((x) => x.id).join(', ')})`, 'nao_achado');
  const camadas = Array.isArray(paginas[i].camadas) ? paginas[i].camadas : [];
  const {marca, semKit} = kitDa(doc);
  const avisos: string[] = [];
  const o: OpcoesIcone = {x: p.x, y: p.y, tamanho: p.tamanho, espessura: p.espessura};
  if (p.cor !== undefined && p.cor.trim()) {
    const c = p.cor.trim();
    o.cor = /^(#|rgb|hsl)/i.test(c) ? c : referenciaDeCor(c, marca);
  }
  if (semKit && (o.cor === undefined || ehReferenciaCor(o.cor))) avisos.push('a imagem ainda não tem kit: a cor vem do neutro até aplicar_marca');
  const camada = {id: idLivre(camadas, 'icone'), ...iconeNovo(doc, nome, o)};
  const base = baseCamadas(doc, i);
  return {patch: [{op: 'add', path: `${base}/-`, value: camada}] as OperacaoPatch[], id: camada.id, caminho: `${base}/${camadas.length}`, icone: nome, pagina: paginas[i].id, avisos};
};

export const registrarIcones = (servidor: McpServer, projeto: Projeto, autor: string, origem: string, imagem: (documento?: string) => {alvo: string; doc: DocImagem; versao: string}) => {
  servidor.registerTool('buscar_icone', {
    description: `Procura ícones do Lucide (${VERSAO_LUCIDE}, 2000 ícones) por palavra em português ou inglês: "balança", "contrato", "prazo", "clock". Devolve os nomes, do mais certo ao menos, para inserir_icone.`,
    inputSchema: {consulta: z.string().describe('uma ou mais palavras'), limite: z.number().int().min(1).max(40).optional().describe('quantos nomes, até 40 (padrão 12)')},
  }, seguro(({consulta, limite}: {consulta: string; limite?: number}) => {
    const r = buscarIcones(consulta, limite ?? 12);
    return {consulta, achados: r.length, icones: r.map((x) => ({nome: x.nome, etiquetas: etiquetasDoIcone(x.nome).split(' ').slice(0, 6).join(' ')}))};
  }));

  servidor.registerTool('inserir_icone', {
    description: 'Insere um ícone do Lucide como forma na imagem, na cor de destaque do kit (por referência). Depois é uma forma comum: aplicar_patch muda x, y, largura, altura, rotacao, sombra; cor_da_marca troca a cor (campo preenchimento); icone_espessura é o traço.',
    inputSchema: {
      documento: z.string().optional().describe('id do documento de imagem'),
      icone: z.string().describe('nome do ícone, ex.: scale (veja buscar_icone)'),
      pagina: z.string().optional().describe('id da página do carrossel (padrão a primeira)'),
      x: z.number().optional().describe('canto esquerdo, em px (padrão centro)'),
      y: z.number().optional().describe('canto de cima, em px (padrão centro)'),
      tamanho: z.number().optional().describe('lado em px (padrão 16% do menor lado)'),
      cor: z.string().optional().describe('nome da cor do kit (destaque) ou #RRGGBB'),
      espessura: z.number().optional().describe('traço na grade de 24 (padrão 2)'),
    },
  }, seguro((a: PedidoIcone & {documento?: string}) => {
    const {alvo, doc, versao} = imagem(a.documento);
    const r = patchInserirIcone(doc, a);
    const gravado = projeto.aplicarPatch({documento: alvo, versao_base: versao, patch: r.patch, autor, origem, rotulo: `ícone ${r.icone} em ${r.pagina}`});
    return {ok: true, documento: alvo, camada: r.caminho, id: r.id, icone: r.icone, pagina: r.pagina, versao: gravado.versao, ...(r.avisos.length ? {avisos: r.avisos} : {})};
  }));
};

export type {CamadaImagem};
