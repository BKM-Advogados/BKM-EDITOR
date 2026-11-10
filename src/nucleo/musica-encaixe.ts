// Encaixe da música no vídeo (item 25), puro. "duracao": a música fecha no último quadro do vídeo com compassos
// inteiros (o BPM muda até 8% para isso, se a música não tem áudio; senão, ou se precisaria de mais, o BPM fica e o fim
// cai no meio de um compasso); clipes que passam do fim são aparados, e os padrões que acabam antes se estendem.
// "cortes": uma seção por cena, com a divisa no compasso mais perto de cada corte; com `viradas`, a bateria abre um
// buraco de dois tempos antes de cada divisa para uma virada e põe um prato nela. "tudo" faz os dois, nessa ordem.
// Ver docs/musica.md, "Encaixe no vídeo".
import {resolverCenas, type DocCenas} from './cenas';
import {arredondarBatida, batidasPorCompasso, BPM_MAX, BPM_MIN, idLivre, posicaoEmCompasso, segPorBatida, type ClipeMusica, type DocMusica, type PadraoMusica} from './musica';
import {cortesDoVideo} from './musica-video';
import type {Edicao} from './musica-acoes';
import type {OperacaoPatch} from './documentos';

export type ModoEncaixe = 'duracao' | 'cortes' | 'tudo';
export type PedidoEncaixe = {modo?: ModoEncaixe; viradas?: boolean};

const MUDANCA_MAX_BPM = 0.08;
const EPS = 1e-6;
const r2 = (x: number) => Math.round(x * 100) / 100;
const seg = (ms: number) => `${(ms / 1000).toLocaleString('pt-BR', {maximumFractionDigits: 1})} s`;

/** O clipe que sobra de `c` depois de cortar o trecho [de, ate) (em batidas): zero, um ou dois pedaços. O pedaço de
 *  depois continua o padrão de onde estava (inicio) ou o áudio (corte_s). */
const semTrecho = (c: ClipeMusica, de: number, ate: number, spb: number, novoId: () => string): ClipeMusica[] => {
  const fim = c.em + c.dur;
  if (fim <= de + EPS || c.em >= ate - EPS) return [c];
  const out: ClipeMusica[] = [];
  if (c.em < de - EPS) out.push({...c, dur: arredondarBatida(de - c.em), ...(c.fade_out ? {fade_out: 0} : {})});
  if (fim > ate + EPS) {
    const anda = ate - c.em;
    out.push({...c, id: out.length ? novoId() : c.id, em: arredondarBatida(ate), dur: arredondarBatida(fim - ate),
      ...(c.audio ? {corte_s: (c.corte_s ?? 0) + anda * spb} : {inicio: arredondarBatida((c.inicio ?? 0) + anda)}), ...(c.fade_in ? {fade_in: 0} : {})});
  }
  return out;
};

const VIRADA: PadraoMusica['notas'] = [
  {peca: 'caixa', em: 0, forca: 70}, {peca: 'caixa', em: 0.25, forca: 78}, {peca: 'caixa', em: 0.5, forca: 86}, {peca: 'caixa', em: 0.75, forca: 94},
  {peca: 'tom_agudo', em: 1, forca: 104}, {peca: 'tom_agudo', em: 1.25, forca: 108}, {peca: 'tom_grave', em: 1.5, forca: 114}, {peca: 'tom_grave', em: 1.75, forca: 120},
];

/** Ajusta a música ao vídeo dela (doc.video) ou ao `video` dado. */
export const encaixarNoVideo = (doc: DocMusica, video: DocCenas, o: PedidoEncaixe = {}): Edicao => {
  const modo = o.modo ?? 'tudo';
  const em_ms = Math.max(0, doc.video?.em_ms ?? 0);
  const dur_ms = resolverCenas(video).props.duracao_ms;
  const alvo_s = (dur_ms - em_ms) / 1000;
  if (alvo_s <= 0) throw new Error(`a música começa em ${seg(em_ms)}, depois do fim do vídeo (${seg(dur_ms)})`);
  const bpc = batidasPorCompasso(doc.compasso);
  const avisos: string[] = [];
  const patch: OperacaoPatch[] = [];
  let bpm = doc.bpm;
  let clipes = doc.arranjo.clipes.map((c) => ({...c}));
  let secoes = (doc.secoes ?? []).map((s) => ({...s}));
  const padroes: PadraoMusica[] = [];
  const idsClipes = new Set(clipes.map((c) => c.id));
  const novoId = () => {
    const id = idLivre('c', idsClipes);
    idsClipes.add(id);
    return id;
  };
  const extra: Record<string, unknown> = {modo};
  let total = clipes.reduce((m, c) => Math.max(m, c.em + c.dur), 0);

  if (modo === 'duracao' || modo === 'tudo') {
    const temAudio = clipes.some((c) => doc.canais.find((k) => k.id === c.canal)?.tipo === 'audio');
    const barra_s = bpc * segPorBatida(bpm);
    const n = Math.max(1, Math.round(alvo_s / barra_s));
    const bpmExato = (n * bpc * 60) / alvo_s;
    const cabe = Math.abs(bpmExato / bpm - 1) <= MUDANCA_MAX_BPM && bpmExato >= BPM_MIN && bpmExato <= BPM_MAX;
    let fim: number;
    if (cabe && !temAudio) {
      bpm = r2(bpmExato);
      fim = n * bpc;
      extra.compassos = n;
    } else {
      fim = arredondarBatida(alvo_s / segPorBatida(bpm));
      avisos.push(temAudio ? 'a música tem áudio, que não estica: o BPM ficou e o fim cai em ' + posicaoEmCompasso(fim, doc.compasso)
        : `fechar em compassos inteiros pediria ${r2(bpmExato)} BPM (mais de 8% de mudança): o BPM ficou e o fim cai em ${posicaoEmCompasso(fim, doc.compasso)}`);
    }
    // apara o que passa do fim e estende os padrões que acabam no fim de agora
    const fimAntes = total;
    clipes = clipes.filter((c) => c.em < fim - EPS).map((c) => (c.em + c.dur > fim + EPS ? {...c, dur: arredondarBatida(fim - c.em), ...(c.fade_out ? {fade_out: 0} : {})} : c));
    if (fimAntes < fim - EPS) {
      let estendidos = 0;
      clipes = clipes.map((c) => {
        const ehPadrao = doc.canais.find((k) => k.id === c.canal)?.tipo !== 'audio';
        if (!ehPadrao || Math.abs(c.em + c.dur - fimAntes) > EPS) return c;
        estendidos++;
        return {...c, dur: arredondarBatida(fim - c.em)};
      });
      if (!estendidos && fimAntes > 0) avisos.push(`a música acaba em ${posicaoEmCompasso(fimAntes, doc.compasso)} e o vídeo vai até ${posicaoEmCompasso(fim, doc.compasso)}: repita um clipe para encher`);
    }
    secoes = secoes.filter((s) => s.em < fim - EPS).map((s) => (s.em + s.dur > fim + EPS || Math.abs(s.em + s.dur - fimAntes) <= EPS ? {...s, dur: arredondarBatida(fim - s.em)} : s));
    if (bpm !== doc.bpm) patch.push({op: 'replace', path: '/bpm', value: bpm});
    total = fim;
    extra.bpm = bpm;
    extra.fim = posicaoEmCompasso(fim, doc.compasso);
  }

  if (modo === 'cortes' || modo === 'tudo') {
    const spb = segPorBatida(bpm);
    const cortes = cortesDoVideo(video).map((ms) => ({ms, b: (ms - em_ms) / 1000 / spb})).filter((x) => x.b > EPS && (!total || x.b < total - EPS));
    if (!cortes.length) avisos.push('o vídeo não tem cortes dentro da música (uma cena só, ou a música começa depois)');
    const divisas: number[] = [];
    const longe: string[] = [];
    for (const c of cortes) {
      const b = Math.round(c.b / bpc) * bpc;
      if (b <= EPS || (total && b >= total - EPS) || divisas.includes(b)) continue;
      divisas.push(b);
      const dif = Math.round((c.b - b) * spb * 1000);
      if (Math.abs(dif) > 120) longe.push(`${seg(c.ms)} (${dif > 0 ? `${seg(dif)} depois` : `${seg(-dif)} antes`} do compasso ${Math.round(b / bpc) + 1})`);
    }
    divisas.sort((a, b) => a - b);
    if (longe.length) avisos.push(`cortes longe do compasso: ${longe.join('; ')}`);
    const fimSecoes = total || divisas[divisas.length - 1] + bpc * 4;
    const bordas = [0, ...divisas, fimSecoes];
    secoes = bordas.slice(0, -1).map((b, i) => ({id: `s${i + 1}`, nome: `Cena ${i + 1}`, em: arredondarBatida(b), dur: arredondarBatida(bordas[i + 1] - b)}));
    extra.secoes = secoes.length;
    if (o.viradas) {
      const bateria = doc.canais.find((c) => c.tipo === 'bateria' && clipes.some((x) => x.canal === c.id && !x.mudo));
      if (!bateria) avisos.push('sem bateria tocando no arranjo: as viradas não entraram');
      else {
        const idsPadroes = new Set(doc.padroes.map((p) => p.id));
        const achar = (nome: string, notas: PadraoMusica['notas'], dur: number) => {
          const ja = doc.padroes.find((p) => p.canal === bateria.id && p.nome === nome);
          if (ja) return ja.id;
          const id = idLivre('p', idsPadroes);
          idsPadroes.add(id);
          padroes.push({id, nome, canal: bateria.id, dur, passos: Math.round(dur * 4), notas});
          return id;
        };
        const tam = Math.min(2, bpc);
        // num compasso curto (3/8), a virada é o fim da de dois tempos
        const virada = achar('Virada', VIRADA.filter((n) => n.em >= 2 - tam - EPS).map((n) => ({...n, em: arredondarBatida(n.em - (2 - tam))})), tam);
        const prato = achar('Prato', [{peca: 'prato', em: 0, forca: 110}], 1);
        let feitas = 0;
        for (const b of divisas) {
          const de = b - tam;
          const tocando = clipes.some((c) => c.canal === bateria.id && !c.mudo && c.em < b - EPS && c.em + c.dur > de + EPS && c.padrao !== virada && c.padrao !== prato);
          if (de < 0 || !tocando) continue;
          clipes = clipes.flatMap((c) => (c.canal === bateria.id && c.padrao !== prato ? semTrecho(c, de, b, spb, novoId) : [c]));
          clipes.push({id: novoId(), canal: bateria.id, em: arredondarBatida(de), dur: tam, padrao: virada});
          clipes.push({id: novoId(), canal: bateria.id, em: arredondarBatida(b), dur: 1, padrao: prato});
          feitas++;
        }
        extra.viradas = feitas;
        if (!feitas && divisas.length) avisos.push('nenhuma divisa tem a bateria tocando antes: as viradas não entraram');
      }
    }
  }

  clipes.sort((a, b) => a.em - b.em || a.canal.localeCompare(b.canal));
  for (const p of padroes) patch.push({op: 'add', path: '/padroes/-', value: p});
  patch.push({op: 'replace', path: '/arranjo/clipes', value: clipes});
  patch.push({op: doc.secoes === undefined ? 'add' : 'replace', path: '/secoes', value: secoes});
  const rotulo = modo === 'duracao' ? 'música encaixada na duração do vídeo' : modo === 'cortes' ? 'seções nos cortes do vídeo' : 'música encaixada no vídeo';
  return {patch, rotulo, caminho: '/arranjo', extra, ...(avisos.length ? {avisos} : {})};
};
