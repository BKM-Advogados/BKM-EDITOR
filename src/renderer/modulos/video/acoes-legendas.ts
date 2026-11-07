// Ações das legendas do vídeo de cenas pela interface, como JSON Patch (diário, Ctrl+Z, o Claude vê): transcrever a
// fala no PC (window.estudio.fala), gerar as legendas das transcrições, editar, juntar, dividir, excluir, localizar e
// substituir em lote, trocar o estilo e ir e voltar de SRT e VTT. O cálculo é do núcleo (src/nucleo/legendas.ts).
import type {PedidoTranscricao, ProgressoTranscricao} from '../../../compartilhado/api';
import {idLivre, type DocCenas, type PropsCenas} from '../../../nucleo/cenas';
import {formatoDoVideo} from '../../../nucleo/formatos';
import {
  arquivoDasPalavras, clipesDeVoz, comTexto, dividirSegmento, juntarSegmentos, legendasDeArquivo, legendasDoDocumento, nomeDoArquivoDeLegenda, paraSrt, paraVtt,
  requebrar, substituirEmLote, type EstiloLegenda, type LegendasCenas, type OpcoesBusca, type SegmentoLegenda,
} from '../../../nucleo/legendas';
import {aplicar, avisar, loja, mensagemDe, selecionar, trocar} from '../../estado/loja';

export const docDe = (documento: string) => loja.get().docs[documento]?.doc as DocCenas | undefined;
export const propsDe = (documento: string) => {
  const m = loja.get().props[documento];
  return m && 'props' in m ? (m.props as unknown as PropsCenas) : undefined;
};
const legendasDe = (documento: string): LegendasCenas | undefined => docDe(documento)?.legendas;

/** Grava as legendas inteiras (troca o que havia; undefined apaga). */
export const gravarLegendas = (documento: string, legendas: LegendasCenas | undefined, rotulo: string) => trocar(documento, '/legendas', legendas, rotulo);

// ---------- transcrever ----------

type Andamento = ProgressoTranscricao & {arquivo: string};
let andamento: Andamento | null = null;
const ouvintes = new Set<() => void>();
const avisarOuvintes = () => ouvintes.forEach((f) => f());
export const assinarAndamento = (f: () => void) => {
  ouvintes.add(f);
  return () => {
    ouvintes.delete(f);
  };
};
export const lerAndamento = () => andamento;
let ligado = false;
const ligar = () => {
  if (ligado) return;
  ligado = true;
  window.estudio.fala.aoProgresso((p) => {
    andamento = p.etapa === 'pronto' || p.etapa === 'cancelado' ? null : p;
    avisarOuvintes();
  });
};

/** Se o arquivo já tem palavras.json (lerJson falha quando não tem). */
export const temTranscricao = async (arquivo: string) => {
  try {
    const p = await window.estudio.lerJson<unknown[]>(arquivoDasPalavras(arquivo));
    return Array.isArray(p) && p.length > 0;
  } catch {
    return false;
  }
};

/** Transcreve no PC os clipes de voz (todos, uma faixa ou um clipe) que ainda não têm transcrição (ou todos, com
 *  `refazer`) e gera as legendas. Um arquivo por vez; Cancelar para no que estiver rodando. */
export const transcreverEGerar = async (documento: string, o: {clipe?: string; faixa?: string; refazer?: boolean; modelo?: PedidoTranscricao['modelo']} = {}) => {
  ligar();
  const d = docDe(documento);
  if (!d) return;
  const arquivos = [...new Set(clipesDeVoz(d, o).map((c) => c.clipe.arquivo))];
  if (!arquivos.length) return avisar('Não há narração para transcrever: use "+ Áudio → Narração…" na linha do tempo.', 'info');
  try {
    for (const [i, arquivo] of arquivos.entries()) {
      if (!o.refazer && (await temTranscricao(arquivo))) continue;
      andamento = {etapa: 'audio', mensagem: `Preparando ${arquivo.split('/').pop()}`, arquivo, progresso: 0};
      avisarOuvintes();
      const r = await window.estudio.fala.transcrever({arquivo, modelo: o.modelo});
      if (!r.ok) {
        avisar(r.cancelado ? 'Transcrição cancelada.' : r.mensagem ?? 'A transcrição não terminou.', r.cancelado ? 'info' : 'erro');
        return;
      }
      avisar(`Transcrito${arquivos.length > 1 ? ` (${i + 1} de ${arquivos.length})` : ''}: ${r.n} palavras em ${String(r.duracao_s).replace('.', ',')} s.`, 'ok');
    }
  } catch (e) {
    avisar(mensagemDe(e), 'erro');
    return;
  } finally {
    andamento = null;
    avisarOuvintes();
  }
  await gerarDasTranscricoes(documento, o);
};

export const cancelarTranscricao = () => window.estudio.fala.cancelar();

/** Legendas das transcrições já gravadas (o palavras.json de cada clipe de voz), no estilo atual. */
export const gerarDasTranscricoes = async (documento: string, o: {clipe?: string; faixa?: string; estilo?: EstiloLegenda} = {}) => {
  const d = docDe(documento);
  if (!d) return;
  const lidas: Record<string, unknown> = {};
  for (const {clipe} of clipesDeVoz(d, o)) {
    const c = arquivoDasPalavras(clipe.arquivo);
    if (c in lidas) continue;
    try {
      lidas[c] = await window.estudio.lerJson(c);
    } catch {
      lidas[c] = [];
    }
  }
  const f = formatoDoVideo(d);
  const r = legendasDoDocumento(d, (c) => lidas[c], {largura: f.largura, altura: f.altura, clipe: o.clipe, faixa: o.faixa, estilo: o.estilo});
  if (!r.clipes) return avisar('Nenhum clipe de voz tem transcrição ainda: clique em Transcrever.', 'info');
  if (await gravarLegendas(documento, r.legendas, `legendas da fala (${r.legendas.segmentos.length})`)) {
    avisar(`${r.legendas.segmentos.length} legendas geradas${r.faltam.length ? `; sem transcrição: ${r.faltam.map((a) => a.split('/').pop()).join(', ')}` : ''}. Ctrl+Z desfaz.`, 'ok');
  }
};

// ---------- editar ----------

const caminhoSeg = (i: number) => `/legendas/segmentos/${i}`;
const indiceDe = (documento: string, id: string) => (legendasDe(documento)?.segmentos ?? []).findIndex((s) => s.id === id);

export const editarTexto = async (documento: string, id: string, texto: string) => {
  const i = indiceDe(documento, id);
  const s = legendasDe(documento)?.segmentos[i];
  if (!s || s.texto === texto) return;
  await trocar(documento, caminhoSeg(i), comTexto(s, texto), 'texto da legenda');
};

export const DURACAO_MIN_LEGENDA = 200;

/** Muda o tempo de um segmento em `dms` (passos de 10 ms): "mover" leva tudo junto, as palavras também; "ini" e "fim"
 *  aparam as pontas. Relativo, então vale também para a legenda que anda com o clipe de voz. */
export const moverSegmento = async (documento: string, id: string, modo: 'mover' | 'ini' | 'fim', dms: number) => {
  const i = indiceDe(documento, id);
  const s = legendasDe(documento)?.segmentos[i];
  if (!s) return;
  const d = Math.round(dms / 10) * 10;
  if (!d) return;
  let novo: SegmentoLegenda;
  if (modo === 'mover') {
    const dd = Math.max(-s.em, d);
    novo = {...s, em: s.em + dd, sai: s.sai + dd, ...(s.palavras ? {palavras: s.palavras.map((p) => ({...p, s: p.s + dd, e: p.e + dd}))} : {})};
  } else if (modo === 'ini') novo = {...s, em: Math.max(0, Math.min(s.sai - DURACAO_MIN_LEGENDA, s.em + d))};
  else novo = {...s, sai: Math.max(s.em + DURACAO_MIN_LEGENDA, s.sai + d)};
  await trocar(documento, caminhoSeg(i), novo, modo === 'mover' ? 'mover legenda' : modo === 'ini' ? 'onde a legenda entra' : 'onde a legenda sai');
};

export const juntarComProxima = async (documento: string, id: string) => {
  const segs = [...(legendasDe(documento)?.segmentos ?? [])];
  const i = segs.findIndex((s) => s.id === id);
  if (i < 0 || i >= segs.length - 1) return avisar('Não há legenda depois desta para juntar.', 'info');
  const junta = juntarSegmentos(segs[i], segs[i + 1]);
  await aplicar(documento, [
    {op: 'test', path: `${caminhoSeg(i + 1)}/id`, value: segs[i + 1].id},
    {op: 'remove', path: caminhoSeg(i + 1)},
    {op: 'replace', path: caminhoSeg(i), value: junta},
  ], 'juntar legendas');
};

/** Divide no tempo `ms` (a palavra mais perto) ou, sem ele, no meio do texto. */
export const dividir = async (documento: string, id: string, ms?: number) => {
  const d = docDe(documento);
  const segs = d?.legendas?.segmentos ?? [];
  const i = segs.findIndex((s) => s.id === id);
  const s = segs[i];
  if (!s || !d) return;
  let indice: number | undefined;
  if (ms !== undefined && Array.isArray(s.palavras) && ms > s.em && ms < s.sai) {
    const k = s.palavras.findIndex((p) => p.s >= ms);
    if (k > 0) indice = k;
  }
  const r = dividirSegmento(s, idLivre(d, 'leg'), indice);
  if (!r) return avisar('Uma palavra só não se divide.', 'info');
  await aplicar(documento, [{op: 'replace', path: caminhoSeg(i), value: r[0]}, {op: 'add', path: caminhoSeg(i + 1), value: r[1]}], 'dividir legenda');
};

export const excluirSegmento = async (documento: string, id: string) => {
  const i = indiceDe(documento, id);
  if (i < 0) return;
  if (await aplicar(documento, [{op: 'test', path: `${caminhoSeg(i)}/id`, value: id}, {op: 'remove', path: caminhoSeg(i)}], 'excluir legenda')) {
    selecionar({documento, caminho: '/legendas'});
    avisar('Legenda excluída. Ctrl+Z desfaz.', 'ok');
  }
};

/** Legenda nova de 2 s no tempo da cabeça (ou o que couber até a próxima). */
export const novaLegenda = async (documento: string, ms: number) => {
  const d = docDe(documento);
  if (!d) return;
  const segs = d.legendas?.segmentos ?? [];
  const prox = segs.filter((s) => s.em > ms).reduce((m, s) => Math.min(m, s.em), Infinity);
  const em = Math.round(ms);
  const nova: SegmentoLegenda = {id: idLivre(d, 'leg'), em, sai: Math.max(em + 500, Math.min(em + 2000, prox)), texto: 'Nova legenda'};
  const i = segs.filter((s) => s.em <= ms).length;
  const patch = d.legendas
    ? [{op: 'add' as const, path: caminhoSeg(i), value: nova}]
    : [{op: 'add' as const, path: '/legendas', value: {estilo: {predefinicao: 'classica'}, segmentos: [nova]} satisfies LegendasCenas}];
  if (await aplicar(documento, patch, 'nova legenda')) selecionar({documento, caminho: caminhoSeg(i)});
};

export const substituirTudo = async (documento: string, procurar: string, troca: string, o: OpcoesBusca) => {
  const leg = legendasDe(documento);
  if (!leg || !procurar) return;
  const r = substituirEmLote(leg.segmentos, procurar, troca, o);
  if (!r.trocas) return avisar(`"${procurar}" não aparece nas legendas.`, 'info');
  if (await trocar(documento, '/legendas/segmentos', r.segmentos, `substituir "${procurar}" por "${troca}" (${r.trocas})`)) {
    avisar(`${r.trocas} ${r.trocas === 1 ? 'troca' : 'trocas'}. Ctrl+Z desfaz.`, 'ok');
  }
};

// ---------- estilo ----------

/** Troca a predefinição e quebra as legendas de novo para a largura e as palavras por vez dela. */
export const trocarPredefinicao = async (documento: string, estilo: EstiloLegenda) => {
  const d = docDe(documento);
  if (!d?.legendas) return;
  const f = formatoDoVideo(d);
  const quebradas = requebrar(d.legendas, estilo, f.largura, f.altura);
  await gravarLegendas(documento, quebradas, `estilo das legendas: ${estilo.predefinicao}`);
};

export const mudarEstilo = (documento: string, campo: keyof EstiloLegenda, valor: unknown, rotulo: string) => {
  const d = docDe(documento);
  if (!d?.legendas) return;
  return trocar(documento, d.legendas.estilo ? `/legendas/estilo/${campo}` : '/legendas/estilo', d.legendas.estilo ? valor : {predefinicao: 'classica', [campo]: valor}, rotulo);
};

// ---------- SRT e VTT ----------

export const importarArquivo = async (documento: string) => {
  try {
    const a = await window.estudio.fala.escolherLegenda();
    if (!a) return;
    const d = docDe(documento);
    const {legendas, avisos} = legendasDeArquivo(a.texto, a.nome, d?.legendas?.estilo);
    if (!legendas.segmentos.length) return avisar(`Nenhuma legenda lida de ${a.nome}${avisos.length ? `: ${avisos[0]}` : ''}.`, 'erro');
    const {origens: _o, ...antes} = d?.legendas ?? {segmentos: []};
    if (await gravarLegendas(documento, {...antes, ...legendas}, `legendas importadas de ${a.nome}`)) {
      avisar(`${legendas.segmentos.length} legendas de ${a.nome}${avisos.length ? ` (${avisos.length} ${avisos.length === 1 ? 'trecho ignorado' : 'trechos ignorados'})` : ''}. Ctrl+Z desfaz.`, 'ok');
    }
  } catch (e) {
    avisar(mensagemDe(e), 'erro');
  }
};

/** Grava saidas/<título>.srt ou .vtt com os tempos de saída (o clipe no lugar em que está). */
export const exportarArquivo = async (documento: string, ext: 'srt' | 'vtt') => {
  const segs = propsDe(documento)?.legendas_cenas?.segmentos ?? [];
  if (!segs.length) return avisar('Não há legendas para exportar.', 'info');
  const titulo = loja.get().info?.manifesto.documentos.find((x) => x.id === documento)?.titulo ?? documento;
  try {
    const caminho = await window.estudio.fala.gravarSaida(nomeDoArquivoDeLegenda(titulo, ext), ext === 'srt' ? paraSrt(segs) : paraVtt(segs));
    avisar(`Gravado em ${caminho}`, 'ok');
    return caminho;
  } catch (e) {
    avisar(mensagemDe(e), 'erro');
  }
};
