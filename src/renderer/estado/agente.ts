// "O Claude mudou isto" no lugar (ux/pesquisa-ux-visual.md, item 10; docs/tela.md §8.1): as mudanças que o agente fez
// nos últimos 30 s, tiradas do diário, para o monitor, a lista, a linha do tempo e o inspetor marcarem o objeto que
// mudou (em violeta) e mostrarem o valor de antes. Só dados e regras: a loja guarda a lista e os painéis leem daqui.
import type {EntradaDocumento, OperacaoPatch, ResumoDiario} from '../../nucleo/documentos';

export const JANELA_AGENTE_MS = 30_000;

/** Uma entrada do diário feita pelo agente, já com o id do documento, os caminhos tocados e os valores de antes. */
export type MudancaAgente = {
  seq: number;
  documento: string; // id do documento
  titulo: string;
  rotulo: string;
  origem: string;
  caminhos: string[]; // os caminhos do patch
  antes: Record<string, {tinha: boolean; valor?: unknown}>; // pelo inverso: o valor que cada caminho tinha
  em: number; // quando chegou na tela (ms)
};

/** O objeto que um caminho do patch toca: o bloco da cena, a camada (da página), o objeto 3D, o canal… */
export const objetoDoCaminho = (caminho: string): string => {
  const padroes = [/^\/cenas\/\d+\/blocos\/\d+/, /^\/paginas\/\d+\/camadas\/\d+/, /^\/camadas\/\d+/, /^\/objetos\/\d+/, /^\/luzes\/\d+/, /^\/canais\/\d+/,
    /^\/padroes\/\d+/, /^\/arranjo\/clipes\/\d+/, /^\/audio\/clipes\/\d+/, /^\/efeitos\/\d+/, /^\/cenas\/\d+/];
  for (const p of padroes) {
    const m = p.exec(caminho);
    if (m) return m[0];
  }
  return caminho;
};

const valorDoInverso = (inverso: OperacaoPatch[], caminho: string): {tinha: boolean; valor?: unknown} | undefined => {
  const op = inverso.find((o) => o.path === caminho);
  if (!op) return undefined;
  if (op.op === 'remove') return {tinha: false};
  if (op.op === 'replace' || op.op === 'add') return {tinha: true, valor: (op as {value?: unknown}).value};
  return undefined;
};

/** As mudanças do agente que chegaram depois de `desdeSeq` (o que já foi visto), como a tela as mostra. Reversões
 *  (`desfaz`) não entram: elas desmarcam o que desfazem. */
export const mudancasNovas = (diario: ResumoDiario[], desdeSeq: number | undefined, docs: EntradaDocumento[], agora: number): MudancaAgente[] => {
  if (desdeSeq === undefined) return [];
  return diario.filter((e) => e.seq > desdeSeq && e.autor === 'agente' && e.desfaz === undefined).flatMap((e) => {
    const d = docs.find((x) => x.caminho === e.documento || x.id === e.documento);
    if (!d) return [];
    const caminhos = [...new Set((e.patch ?? []).filter((o) => o.op !== 'test').map((o) => o.path))];
    const antes: MudancaAgente['antes'] = {};
    for (const c of caminhos) {
      const v = valorDoInverso(e.inverso ?? [], c);
      if (v) antes[c] = v;
    }
    return [{seq: e.seq, documento: d.id, titulo: d.titulo, rotulo: e.rotulo, origem: e.origem, caminhos, antes, em: agora}];
  });
};

/** Junta as novas às que ainda valem (30 s), tira as revertidas e as de seq repetido. */
export const juntarMudancas = (atuais: MudancaAgente[], novas: MudancaAgente[], revertidas: Set<number>, agora: number) => {
  const vivas = [...atuais, ...novas].filter((m) => agora - m.em < JANELA_AGENTE_MS && !revertidas.has(m.seq));
  return vivas.filter((m, i) => vivas.findIndex((x) => x.seq === m.seq) === i);
};

/** O objeto (ou um campo dele) mudou pelo agente neste documento? */
export const mudouEm = (mudancas: MudancaAgente[], documento: string | undefined, objeto: string) =>
  Boolean(documento && objeto) && mudancas.some((m) => m.documento === documento && m.caminhos.some((c) => c === objeto || c.startsWith(`${objeto}/`) || objetoDoCaminho(c) === objeto));

/** Os objetos que mudaram num documento (para o monitor desenhar o contorno). */
export const objetosMudados = (mudancas: MudancaAgente[], documento: string | undefined) =>
  [...new Set(mudancas.filter((m) => m.documento === documento).flatMap((m) => m.caminhos.map(objetoDoCaminho)))];

/** Os campos de um objeto que o agente mudou, com o valor de antes (o mais antigo vence: é o "era" de verdade). */
export const camposMudados = (mudancas: MudancaAgente[], documento: string | undefined, objeto: string) => {
  const campos = new Map<string, {campo: string; caminho: string; antes?: {tinha: boolean; valor?: unknown}; em: number}>();
  for (const m of [...mudancas].sort((a, b) => a.seq - b.seq)) {
    if (m.documento !== documento) continue;
    for (const c of m.caminhos) {
      if (!(c.startsWith(`${objeto}/`) || c === objeto)) continue;
      if (!campos.has(c)) campos.set(c, {campo: c.slice(objeto.length + 1) || c.split('/').pop() || c, caminho: c, antes: m.antes[c], em: m.em});
    }
  }
  return [...campos.values()];
};

/** "há 12 s" */
export const haQuanto = (em: number, agora = Date.now()) => {
  const s = Math.max(0, Math.round((agora - em) / 1000));
  return s < 2 ? 'agora' : `há ${s} s`;
};

/** Valor de antes em texto curto para a tela ("era 80"). */
export const textoDoValor = (v: {tinha: boolean; valor?: unknown} | undefined) => {
  if (!v) return '';
  if (!v.tinha) return 'não tinha';
  const x = v.valor;
  if (typeof x === 'number') return String(Number(x.toFixed(3))).replace('.', ',');
  if (typeof x === 'string') return x.length > 24 ? `${x.slice(0, 23)}…` : x;
  if (typeof x === 'boolean') return x ? 'sim' : 'não';
  return Array.isArray(x) ? `${x.length} itens` : 'outro valor';
};

// ---------- Histórico agrupado (item 11) ----------
/** Uma diferença de campo de uma entrada do diário, em português de quem edita. */
export type DiferencaCampo = {campo: string; caminho: string; antes?: {tinha: boolean; valor?: unknown}; depois?: {tinha: boolean; valor?: unknown}};

/** O que cada entrada mudou, campo a campo: o depois sai do patch, o antes do inverso. */
export const diferencasDa = (e: Pick<ResumoDiario, 'patch' | 'inverso'>): DiferencaCampo[] =>
  (e.patch ?? []).filter((o) => o.op !== 'test' && o.op !== 'move' && o.op !== 'copy').map((o) => {
    const objeto = objetoDoCaminho(o.path);
    const campo = o.path === objeto ? o.path.split('/').filter(Boolean).slice(-2).join(' ') : o.path.slice(objeto.length + 1).replace(/\//g, ' › ');
    return {campo: campo || o.path, caminho: o.path, antes: valorDoInverso(e.inverso ?? [], o.path),
      depois: o.op === 'remove' ? {tinha: false} : {tinha: true, valor: (o as {value?: unknown}).value}};
  });

export type GrupoHistorico = {
  chave: string;
  autor: string;
  origem: string;
  entradas: ResumoDiario[]; // da mais nova para a mais velha
  documentos: string[]; // títulos
  inicio: string;
  fim: string;
};

/** Junta o diário em rodadas: entradas seguidas do mesmo autor e da mesma origem (a mesma conversa do Claude ou a mesma
 *  sessão de edição da pessoa) com menos de `vaoMs` entre uma e outra. Mais nova primeiro. */
export const agruparDiario = (diario: ResumoDiario[], docs: EntradaDocumento[], vaoMs = 120_000): GrupoHistorico[] => {
  const grupos: GrupoHistorico[] = [];
  const titulo = (caminho: string) => docs.find((d) => d.caminho === caminho || d.id === caminho)?.titulo ?? caminho;
  for (const e of [...diario].sort((a, b) => a.seq - b.seq)) {
    const ult = grupos[grupos.length - 1];
    const mesmo = ult && ult.autor === e.autor && ult.origem === e.origem && Date.parse(e.em) - Date.parse(ult.fim) < vaoMs;
    if (mesmo) {
      ult.entradas.unshift(e);
      ult.fim = e.em;
      if (!ult.documentos.includes(titulo(e.documento))) ult.documentos.push(titulo(e.documento));
    } else {
      grupos.push({chave: `g${e.seq}`, autor: e.autor, origem: e.origem, entradas: [e], documentos: [titulo(e.documento)], inicio: e.em, fim: e.em});
    }
  }
  return grupos.reverse();
};

/** "3 mudanças em Vídeo 9:16" */
export const resumoDoGrupo = (g: GrupoHistorico) => {
  const n = g.entradas.length;
  const onde = g.documentos.length === 1 ? g.documentos[0] : `${g.documentos.length} documentos`;
  return `${n === 1 ? '1 mudança' : `${n} mudanças`} em ${onde}`;
};
