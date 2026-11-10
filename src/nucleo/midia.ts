// A mídia do projeto (frente Casca, rodada 3): o que há em midia/, agrupado e pesquisável. Esta parte é pura (sem disco,
// sem node:*), porque o painel de mídia da interface importa as mesmas funções que a ferramenta `listar_midia`.
//  - tipo pela extensão;
//  - derivados sob o original: `.palavras.json` (transcrição), `.envelope.json` (loudness medido), `.limpo[-leve|-forte].wav`
//    (voz limpa) e `.<código>.sem-fundo.png` (recorte) ficam dentro do arquivo de onde vieram, e não como linhas soltas;
//  - busca por palavras (sem acento nem caixa), medida em menos de 100 ms com 500 arquivos;
//  - marcação de tomadas: `boa`, `descartada` e uma nota, em midia/marcas.json.
import {caminhoSemFundo} from './remover-fundo';

export type TipoMidia = 'video' | 'audio' | 'imagem' | 'outro';

export const EXTENSOES_DE_MIDIA: Record<Exclude<TipoMidia, 'outro'>, string[]> = {
  video: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v', 'mts', 'mxf'],
  audio: ['wav', 'mp3', 'm4a', 'ogg', 'aac', 'flac', 'aif', 'aiff'],
  imagem: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'avif', 'bmp'],
};

export const ARQUIVO_MARCAS_MIDIA = 'midia/marcas.json';
export const NOTA_MAX = 500;

const extensao = (rel: string) => (rel.includes('.') ? rel.slice(rel.lastIndexOf('.') + 1).toLowerCase() : '');
const nomeDe = (rel: string) => rel.slice(rel.lastIndexOf('/') + 1);
const pastaDe = (rel: string) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '');

export const tipoDaMidia = (rel: string): TipoMidia => {
  const e = extensao(rel);
  for (const [tipo, lista] of Object.entries(EXTENSOES_DE_MIDIA)) if (lista.includes(e)) return tipo as TipoMidia;
  return 'outro';
};

/** Sem acento (a faixa de marcas combinantes U+0300 a U+036F que o NFKD separa da letra), em minúsculas, com espaço simples:
 *  o que a busca compara. */
export const paraBusca = (s: string): string => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

// ---------- derivados ----------
export type TipoDerivado = 'transcricao' | 'envelope' | 'voz_limpa' | 'sem_fundo';

export const ROTULO_DERIVADO: Record<TipoDerivado, string> = {
  transcricao: 'transcrição',
  envelope: 'loudness medido',
  voz_limpa: 'voz limpa',
  sem_fundo: 'sem fundo',
};

export type Classificacao = {derivado: TipoDerivado; origem: string; detalhe?: string};

/** Se o nome é de um arquivo que o app gera a partir de outro, diz de que tipo e de qual (`origem`, o caminho do arquivo de
 *  onde veio; no recorte sem fundo, o caminho do original sem a extensão). Só vale o nome que o app dá: um `voz.limpo.wav` da
 *  pessoa, sem o arquivo com extensão antes dele, é um arquivo como outro qualquer. */
export const classificarDerivado = (rel: string): Classificacao | null => {
  let m: RegExpExecArray | null;
  if (rel.endsWith('.palavras.json')) return {derivado: 'transcricao', origem: rel.slice(0, -'.palavras.json'.length)};
  if (rel.endsWith('.envelope.json')) return {derivado: 'envelope', origem: rel.slice(0, -'.envelope.json'.length)};
  if ((m = /^(.+\.[a-z0-9]{1,5})\.limpo(?:-(leve|forte))?\.wav$/i.exec(rel))) return {derivado: 'voz_limpa', origem: m[1], detalhe: m[2] ?? 'media'};
  if ((m = /^(.+)\.[0-9a-f]{8}(?:-\d+)?\.sem-fundo\.png$/i.exec(rel))) return {derivado: 'sem_fundo', origem: m[1]};
  return null;
};

// ---------- o índice ----------
/** O que se sabe de um arquivo antes de agrupar: o disco diz tamanho e data; a duração e as dimensões vêm do cabeçalho. */
export type ArquivoBruto = {rel: string; tamanho: number; modificado_ms: number; duracao_ms?: number; largura?: number; altura?: number};

export type DerivadoDeMidia = {caminho: string; tipo: TipoDerivado; detalhe?: string; tamanho: number};

/** Tudo que o painel precisa: as entradas (derivados dentro), as pastas com contagem e os totais. */
export type IndiceDaMidia = {entradas: EntradaMidia[]; pastas: {pasta: string; quantidade: number}[]; total: number; tamanho_total: number};

export type EstadoDaTomada = 'boa' | 'descartada';
export type MarcaDeMidia = {estado?: EstadoDaTomada; nota?: string};
export type MarcasDeMidia = {versao: 1; marcas: Record<string, MarcaDeMidia>};

export type EntradaMidia = {
  caminho: string;
  nome: string;
  pasta: string;
  tipo: TipoMidia;
  tamanho: number;
  modificado_ms: number;
  duracao_ms?: number;
  largura?: number;
  altura?: number;
  marca?: MarcaDeMidia;
  derivados: DerivadoDeMidia[];
  /** O que a busca compara (nome, caminho, tipo, marca, nota e derivados), já normalizado. */
  busca: string;
};

const textoDeBusca = (e: Omit<EntradaMidia, 'busca'>): string =>
  paraBusca([
    e.nome,
    e.caminho,
    e.tipo,
    e.marca?.estado === 'boa' ? 'boa tomada boa' : e.marca?.estado === 'descartada' ? 'descartada tomada descartada' : '',
    e.marca?.nota ?? '',
    ...e.derivados.map((d) => `${ROTULO_DERIVADO[d.tipo]} ${d.detalhe ?? ''}`),
    e.derivados.some((d) => d.tipo === 'transcricao') ? 'transcrito' : '',
  ].join(' '));

// transcrição, loudness, voz limpa (média, leve, forte) e recorte; dentro de cada um, pelo caminho (sem depender do idioma)
const ORDEM_TIPO: TipoDerivado[] = ['transcricao', 'envelope', 'voz_limpa', 'sem_fundo'];
const ORDEM_INTENSIDADE = ['media', 'leve', 'forte'];
const ordemDosDerivados = (x: DerivadoDeMidia, y: DerivadoDeMidia): number =>
  ORDEM_TIPO.indexOf(x.tipo) - ORDEM_TIPO.indexOf(y.tipo)
  || (x.tipo === 'voz_limpa' ? ORDEM_INTENSIDADE.indexOf(x.detalhe ?? 'media') - ORDEM_INTENSIDADE.indexOf(y.detalhe ?? 'media') : 0)
  || (x.caminho < y.caminho ? -1 : x.caminho > y.caminho ? 1 : 0);

/** Agrupa os derivados sob o original e junta as marcas. Arquivo cujo original não está em midia/ (um recorte de uma foto de
 *  outra pasta, uma transcrição sem o áudio) fica como entrada própria. */
export const montarIndice = (arquivos: ArquivoBruto[], marcas: MarcasDeMidia = {versao: 1, marcas: {}}): EntradaMidia[] => {
  const porCaminho = new Map(arquivos.map((a) => [a.rel, a]));
  const classe = new Map<string, Classificacao>();
  const originalDoRecorte = (c: Classificacao, rel: string): string | null => {
    // o recorte vem de um arquivo de mesmo nome sem extensão; o código do nome diz de qual, quando há dois (foto.jpg e foto.png)
    const candidatos = arquivos.filter((a) => !classificarDerivado(a.rel) && a.rel.replace(/\.[^./]+$/, '') === c.origem && tipoDaMidia(a.rel) === 'imagem');
    const base = rel.replace(/-\d+(\.sem-fundo\.png)$/i, '$1');
    return candidatos.find((a) => caminhoSemFundo(a.rel) === base)?.rel ?? null;
  };
  for (const a of arquivos) {
    const c = classificarDerivado(a.rel);
    if (!c) continue;
    const origem = c.derivado === 'sem_fundo' ? originalDoRecorte(c, a.rel) : porCaminho.has(c.origem) ? c.origem : null;
    if (origem) classe.set(a.rel, {...c, origem});
  }
  // um derivado de derivado (o envelope da voz limpa) sobe até o arquivo que a pessoa trouxe
  const raiz = (rel: string): string => {
    const c = classe.get(rel);
    return c && c.origem !== rel ? raiz(c.origem) : rel;
  };
  const filhos = new Map<string, DerivadoDeMidia[]>();
  for (const a of arquivos) {
    const c = classe.get(a.rel);
    if (!c) continue;
    const dono = raiz(a.rel);
    if (dono === a.rel) continue;
    const intermediario = c.origem !== dono ? classe.get(c.origem) : undefined;
    const detalhe = intermediario ? ROTULO_DERIVADO[intermediario.derivado] : c.detalhe;
    (filhos.get(dono) ?? filhos.set(dono, []).get(dono)!).push({caminho: a.rel, tipo: c.derivado, ...(detalhe ? {detalhe} : {}), tamanho: a.tamanho});
  }
  const entradas: EntradaMidia[] = [];
  for (const a of arquivos) {
    if (classe.has(a.rel) || a.rel === ARQUIVO_MARCAS_MIDIA) continue;
    const base = {
      caminho: a.rel,
      nome: nomeDe(a.rel),
      pasta: pastaDe(a.rel),
      tipo: tipoDaMidia(a.rel),
      tamanho: a.tamanho,
      modificado_ms: a.modificado_ms,
      ...(a.duracao_ms !== undefined ? {duracao_ms: a.duracao_ms} : {}),
      ...(a.largura !== undefined ? {largura: a.largura, altura: a.altura} : {}),
      ...(marcas.marcas[a.rel] ? {marca: marcas.marcas[a.rel]} : {}),
      derivados: (filhos.get(a.rel) ?? []).sort(ordemDosDerivados),
    };
    entradas.push({...base, busca: textoDeBusca(base)});
  }
  return entradas.sort((x, y) => x.caminho.localeCompare(y.caminho, 'pt-BR', {numeric: true}));
};

// ---------- busca e filtros ----------
export type FiltroDeMidia = {
  busca?: string;
  tipo?: TipoMidia;
  pasta?: string; // "midia" ou "midia/tomadas": inclui as subpastas
  marca?: EstadoDaTomada | 'sem_marca';
  ordem?: 'nome' | 'recentes' | 'tamanho';
};

/** Cada palavra da busca tem de aparecer em algum lugar do texto de busca da entrada (E, sem ordem). */
export const buscarMidia = (entradas: EntradaMidia[], consulta: string): EntradaMidia[] => {
  const palavras = paraBusca(consulta).split(' ').filter(Boolean);
  if (!palavras.length) return entradas;
  return entradas.filter((e) => palavras.every((p) => e.busca.includes(p)));
};

export const filtrarMidia = (entradas: EntradaMidia[], f: FiltroDeMidia = {}): EntradaMidia[] => {
  let r = f.busca ? buscarMidia(entradas, f.busca) : entradas;
  if (f.tipo) r = r.filter((e) => e.tipo === f.tipo);
  if (f.pasta) {
    const p = f.pasta.replace(/\/+$/, '');
    r = r.filter((e) => e.pasta === p || e.pasta.startsWith(`${p}/`));
  }
  if (f.marca === 'sem_marca') r = r.filter((e) => !e.marca?.estado);
  else if (f.marca) r = r.filter((e) => e.marca?.estado === f.marca);
  if (f.ordem === 'recentes') return [...r].sort((a, b) => b.modificado_ms - a.modificado_ms);
  if (f.ordem === 'tamanho') return [...r].sort((a, b) => b.tamanho - a.tamanho);
  return r;
};

/** As pastas que têm arquivo (ou subpasta com arquivo), com quantos arquivos há em cada uma contando as subpastas. */
export const pastasDaMidia = (entradas: EntradaMidia[]): {pasta: string; quantidade: number}[] => {
  const contagem = new Map<string, number>();
  for (const e of entradas) {
    const partes = e.pasta.split('/').filter(Boolean);
    for (let i = 1; i <= partes.length; i++) {
      const p = partes.slice(0, i).join('/');
      contagem.set(p, (contagem.get(p) ?? 0) + 1);
    }
  }
  return [...contagem.entries()].map(([pasta, quantidade]) => ({pasta, quantidade})).sort((a, b) => a.pasta.localeCompare(b.pasta, 'pt-BR'));
};

// ---------- marcas das tomadas ----------
export const marcasVazias = (): MarcasDeMidia => ({versao: 1, marcas: {}});

/** Lê o midia/marcas.json com calma: o que não se entende é ignorado, nunca derruba o painel. */
export const lerMarcasDeMidia = (doc: unknown): MarcasDeMidia => {
  const bruto = (doc as {marcas?: unknown} | null)?.marcas;
  const saida = marcasVazias();
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return saida;
  for (const [caminho, valor] of Object.entries(bruto as Record<string, unknown>)) {
    const v = valor as {estado?: unknown; nota?: unknown} | null;
    const estado = v?.estado === 'boa' || v?.estado === 'descartada' ? v.estado : undefined;
    const nota = typeof v?.nota === 'string' && v.nota.trim() ? v.nota.trim().slice(0, NOTA_MAX) : undefined;
    if (estado || nota) saida.marcas[caminho] = {...(estado ? {estado} : {}), ...(nota ? {nota} : {})};
  }
  return saida;
};

/** As marcas com a de `caminho` trocada. `estado: null` tira a marca de estado, `nota: ''` tira a nota; o que não vem fica como
 *  está. Sem estado nem nota, a entrada sai do arquivo. */
export const comMarca = (marcas: MarcasDeMidia, caminho: string, mudanca: {estado?: EstadoDaTomada | null; nota?: string}): MarcasDeMidia => {
  const atual = marcas.marcas[caminho] ?? {};
  const estado = mudanca.estado === undefined ? atual.estado : (mudanca.estado ?? undefined);
  const nota = mudanca.nota === undefined ? atual.nota : mudanca.nota.trim().slice(0, NOTA_MAX) || undefined;
  const saida = {versao: 1 as const, marcas: {...marcas.marcas}};
  if (estado || nota) saida.marcas[caminho] = {...(estado ? {estado} : {}), ...(nota ? {nota} : {})};
  else delete saida.marcas[caminho];
  return saida;
};

// ---------- apresentação ----------
export const duracaoCurta = (ms: number | undefined): string => {
  if (ms === undefined) return '';
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export const tamanhoCurto = (bytes: number): string =>
  bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : bytes >= 1024 ** 2 ? `${(bytes / 1024 ** 2).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
