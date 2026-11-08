// Ações das legendas do vídeo de cenas pela interface, como JSON Patch (diário, Ctrl+Z, o Claude vê): transcrever a
// fala no PC (window.estudio.fala), gerar as legendas das transcrições, editar, juntar, dividir, excluir, localizar e
// substituir em lote, trocar o estilo e ir e voltar de SRT e VTT. O cálculo é do núcleo (src/nucleo/legendas.ts).
import type {PedidoTranscricao, ProgressoTranscricao} from '../../../compartilhado/api';
import {idLivre, type DocCenas, type PropsCenas} from '../../../nucleo/cenas';
import {formatoDoVideo} from '../../../nucleo/formatos';
import {
  arquivoDaFala, arquivoDasPalavras, clipesDeVoz, comTexto, palavrasValidas, type PalavraLegenda, legendasDeOutraTomada, limitesDoArrasto, dividirSegmento, juntarSegmentos, legendasDeArquivo, legendasDoDocumento, nomeDoArquivoDeLegenda, paraSrt, paraVtt,
  requebrar, substituirEmLote, type EstadoDaFala, type EstiloLegenda, type LegendasCenas, type OpcoesBusca, type SegmentoLegenda,
} from '../../../nucleo/legendas';
import {confirmar} from '../../componentes/Dialogo';
import {acharClipe, patchDosCortes, patchSemCortes, proporCortes, trechoDoClipe, type CorteFala} from '../../../nucleo/cortes-fala';
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
/** Passa a ouvir o andamento das transcrições: as do botão e as que a IA pede pelo MCP (transversal-N4). O painel liga
 *  ao abrir, para o andamento e o Cancelar aparecerem também quando quem pediu foi a IA. */
export const ouvirAndamento = () => ligar();
const ligar = () => {
  if (ligado) return;
  ligado = true;
  window.estudio.fala.aoProgresso((p) => {
    andamento = p.etapa === 'pronto' || p.etapa === 'cancelado' ? null : p;
    avisarOuvintes();
  });
};

/** Por arquivo de fala: 'em_dia' (a transcrição é do áudio como ele está), 'velha' (a tomada mudou depois da
 *  transcrição) ou 'falta'. */
export const estadoDasFalas = async (arquivos: string[]): Promise<Record<string, EstadoDaFala>> => {
  try {
    return await window.estudio.fala.conferir(arquivos);
  } catch {
    return Object.fromEntries(arquivos.map((a) => [a, 'falta' as const]));
  }
};

const nomeCurto = (arquivo: string) => arquivo.split('/').pop() ?? arquivo;
const clipesComLegenda = (d: DocCenas) => new Set((d.legendas?.segmentos ?? []).map((s) => s?.clipe).filter((c): c is string => Boolean(c)));
const AVISO_CORRECOES = 'As palavras corrigidas à mão que ainda caem no tempo da fala ficam; divisões, junções, tempos ajustados e legendas apagadas '
  + 'voltam ao automático. Ctrl+Z desfaz.';

/** Transcreve no PC a fala dos clipes de voz (todos, uma faixa ou um clipe) que ainda não tem transcrição, ou cuja tomada
 *  mudou depois dela, e gera as legendas que faltam. A fala do clipe de voz limpa é a do original. Clipe que já tem
 *  legendas fica como está; se a tomada dele mudou, pergunta antes de refazer. `refazer`: transcreve tudo de novo e
 *  refaz todas as legendas, também com confirmação. Um arquivo por vez; Cancelar para no que estiver rodando. */
export const transcreverEGerar = async (documento: string, o: {clipe?: string; faixa?: string; refazer?: boolean; modelo?: PedidoTranscricao['modelo']} = {}) => {
  ligar();
  const d = docDe(documento);
  if (!d) return;
  const pedidos = clipesDeVoz(d, o);
  const arquivos = [...new Set(pedidos.map(({clipe}) => arquivoDaFala(clipe)))];
  if (!arquivos.length) return avisar('Não há narração para transcrever: use "+ Áudio → Narração…" na linha do tempo.', 'info');
  const comLegenda = clipesComLegenda(d);
  if (o.refazer && !(await confirmar({titulo: 'Transcrever de novo e refazer as legendas?', botao: 'Transcrever de novo',
    texto: `A fala de ${arquivos.length === 1 ? nomeCurto(arquivos[0]) : `${arquivos.length} arquivos`} é transcrita de novo e as legendas `
      + `${pedidos.some(({clipe}) => comLegenda.has(clipe.id)) ? 'são refeitas. ' : 'são geradas. '}${AVISO_CORRECOES}`}))) return;
  const estados = await estadoDasFalas(arquivos);
  const fila = o.refazer ? arquivos : arquivos.filter((a) => estados[a] !== 'em_dia');
  try {
    for (const [i, arquivo] of fila.entries()) {
      andamento = {etapa: 'audio', mensagem: `Preparando ${nomeCurto(arquivo)}`, arquivo, progresso: 0};
      avisarOuvintes();
      const r = await window.estudio.fala.transcrever({arquivo, modelo: o.modelo});
      if (!r.ok) {
        avisar(r.cancelado ? 'Transcrição cancelada.' : r.mensagem ?? 'A transcrição não terminou.', r.cancelado ? 'info' : 'erro');
        return;
      }
      avisar(`Transcrito${fila.length > 1 ? ` (${i + 1} de ${fila.length})` : ''}: ${r.n} palavras em ${String(r.duracao_s).replace('.', ',')} s.`, 'ok');
    }
  } catch (e) {
    avisar(mensagemDe(e), 'erro');
    return;
  } finally {
    andamento = null;
    avisarOuvintes();
  }
  let refazer: true | string[] = o.refazer ? true : [];
  // a tomada mudou depois das legendas: as de agora são da fala antiga, mas podem ter correções; a pessoa decide
  // ou o clipe trocou de arquivo depois das legendas ("Trocar arquivo…"): som-N2
  const outra = new Set(legendasDeOutraTomada(docDe(documento) ?? d));
  const mudaram = o.refazer ? [] : pedidos.filter(({clipe}) => comLegenda.has(clipe.id) && (estados[arquivoDaFala(clipe)] === 'velha' || outra.has(clipe.id)));
  if (mudaram.length) {
    const nomes = [...new Set(mudaram.map(({clipe}) => clipe.nome || nomeCurto(arquivoDaFala(clipe))))].join(', ');
    const sim = await confirmar({titulo: 'O áudio mudou depois das legendas', botao: 'Refazer as legendas',
      texto: `${nomes}: o áudio não é mais o da transcrição usada nas legendas, que ficaram com o texto e os tempos de antes. Refazer as legendas `
        + `${mudaram.length === 1 ? 'desse clipe' : 'desses clipes'} com a fala nova? A correção à mão da tomada antiga não passa para a nova. Ctrl+Z desfaz.`});
    if (sim) refazer = mudaram.map(({clipe}) => clipe.id);
    else avisar(`As legendas de ${nomes} ficaram como estavam.`, 'info');
  }
  await gerarDasTranscricoes(documento, {clipe: o.clipe, faixa: o.faixa, refazer});
};

export const cancelarTranscricao = () => window.estudio.fala.cancelar();

/** Legendas das transcrições já gravadas (o palavras.json da fala de cada clipe de voz), no estilo atual. Gera só para
 *  os clipes que ainda não têm legendas; `refazer` (true, ou ids de clipe) refaz as deles, levando as palavras corrigidas
 *  à mão que ainda caem no tempo da fala. As legendas que não vêm de clipe (importadas, criadas à mão) ficam. */
export const gerarDasTranscricoes = async (documento: string, o: {clipe?: string; faixa?: string; estilo?: EstiloLegenda; refazer?: boolean | string[]} = {}) => {
  const d = docDe(documento);
  if (!d) return;
  const lidas: Record<string, unknown> = {};
  for (const {clipe} of clipesDeVoz(d, o)) {
    const c = arquivoDasPalavras(arquivoDaFala(clipe));
    if (c in lidas) continue;
    try {
      lidas[c] = await window.estudio.lerJson(c);
    } catch {
      lidas[c] = [];
    }
  }
  const f = formatoDoVideo(d);
  const r = legendasDoDocumento(d, (c) => lidas[c], {largura: f.largura, altura: f.altura, clipe: o.clipe, faixa: o.faixa, estilo: o.estilo, refazer: o.refazer});
  if (!r.clipes) {
    return avisar(r.mantidos.length && !r.faltam.length ? 'Todos os clipes de voz já têm legendas. "Refazer as legendas" gera de novo, guardando as palavras corrigidas à mão.'
      : 'Nenhum clipe de voz sem legendas tem transcrição ainda: clique em Transcrever.', 'info');
  }
  if (await gravarLegendas(documento, r.legendas, `legendas da fala (${r.geradas})`)) {
    const partes = [`${r.geradas} legendas geradas`];
    if (r.corrigidas) partes.push(`${r.corrigidas} ${r.corrigidas === 1 ? 'palavra corrigida à mão ficou' : 'palavras corrigidas à mão ficaram'}`);
    if (r.mantidos.length) partes.push(`${r.mantidos.length === 1 ? 'um clipe que já tinha legendas ficou' : `${r.mantidos.length} clipes que já tinham legendas ficaram`} como estava`);
    if (r.faltam.length) partes.push(`sem transcrição: ${r.faltam.map(nomeCurto).join(', ')}`);
    avisar(`${partes.join('; ')}. Ctrl+Z desfaz.`, 'ok');
  }
};

/** Refaz as legendas dos clipes de voz (todos, uma faixa ou um clipe) a partir das transcrições, com confirmação. */
export const refazerLegendas = async (documento: string, o: {clipe?: string; faixa?: string} = {}) => {
  if (!(await confirmar({titulo: 'Refazer as legendas da fala?', botao: 'Refazer', texto: `As legendas dos clipes de voz são geradas de novo da transcrição. ${AVISO_CORRECOES}`}))) return;
  await gerarDasTranscricoes(documento, {...o, refazer: true});
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
    let dd = Math.max(-s.em, d);
    // a legenda de um clipe de voz não sai do trecho que ele toca: o resolvedor a esconderia (som-N6)
    const lim = limitesDoArrasto(docDe(documento) ?? {}, s);
    if (lim && (dd < lim.min || dd > lim.max)) {
      dd = Math.min(lim.max, Math.max(lim.min, dd));
      avisar('A legenda fica dentro do trecho que o clipe de voz toca. Para o texto aparecer antes ou depois da voz, puxe só o começo ou o fim.', 'info');
      if (!dd) return;
    }
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
  const quebradas = requebrar(d.legendas, estilo, f.largura, f.altura, d.tema?.fonte);
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
      const ansi = a.codificacao === 'windows-1252' ? ' (lido como Windows-1252, o "ANSI": confira os acentos)' : '';
      avisar(`${legendas.segmentos.length} legendas de ${a.nome}${ansi}${avisos.length ? ` (${avisos.length} ${avisos.length === 1 ? 'trecho ignorado' : 'trechos ignorados'})` : ''}. Ctrl+Z desfaz.`, 'ok');
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

// ---------- cortes pela fala (src/nucleo/cortes-fala.ts) ----------

const seg = (ms: number) => (ms / 1000).toFixed(1).replace('.', ',');

/** Os cortes que a fala do clipe sugere (pausas longas, "ãh", pontas), com as palavras dele; null sem transcrição. */
export const proporCortesDoClipe = async (documento: string, clipeId: string): Promise<{cortes: CorteFala[]; palavras: PalavraLegenda[]} | null> => {
  const achado = acharClipe(docDe(documento)?.audio, clipeId);
  if (!achado) return null;
  try {
    const palavras = palavrasValidas(await window.estudio.lerJson(arquivoDasPalavras(arquivoDaFala(achado.clipe))));
    return palavras.length ? {palavras, cortes: proporCortes(palavras, trechoDoClipe(achado.clipe))} : null;
  } catch {
    return null;
  }
};

/** Grava a narração emendada (processo principal) e troca o clipe por ela, com as legendas no tempo novo. */
export const aplicarCortesDoClipe = async (documento: string, clipeId: string, cortes: CorteFala[], palavras: PalavraLegenda[]) => {
  const achado = acharClipe(docDe(documento)?.audio, clipeId);
  if (!achado || !cortes.length) return false;
  try {
    avisar(`Emendando a narração (${cortes.length} ${cortes.length === 1 ? 'corte' : 'cortes'})…`, 'info');
    const r = await window.estudio.fala.emendar({fonte: achado.clipe.arquivo, cortes: cortes.map((c) => ({de_ms: c.de_ms, ate_ms: c.ate_ms})), palavras});
    const d = docDe(documento);
    if (!d) return false;
    const tirado = r.antes_ms - r.duracao_ms;
    if (await aplicar(documento, patchDosCortes(d, clipeId, cortes, r), `cortes pela fala (−${seg(tirado)} s)`)) {
      avisar(`Narração ${seg(tirado)} s mais curta${r.removidas.length ? `, sem ${r.removidas.join(' ')}` : ''}. Ctrl+Z desfaz.`, 'ok');
      return true;
    }
  } catch (e) {
    avisar(mensagemDe(e), 'erro');
  }
  return false;
};

/** O clipe volta ao áudio de antes dos cortes (as legendas dele também). */
export const voltarCortesDoClipe = async (documento: string, clipeId: string) => {
  const d = docDe(documento);
  const patch = d ? patchSemCortes(d, clipeId) : null;
  if (patch && (await aplicar(documento, patch, 'voltar ao áudio sem cortes'))) avisar('A narração voltou ao áudio sem cortes. Ctrl+Z desfaz.', 'ok');
};
