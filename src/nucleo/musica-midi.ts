// Música ↔ MIDI (item 26). Exportar: o arranjo inteiro como o motor toca (com swing), uma trilha por canal de bateria
// ou de sintetizador, bateria no canal 10 pelo mapa General MIDI, as seções como marcadores. Importar: cada trilha com
// notas vira um canal (canal 10 = bateria; o resto, sintetizador pelo programa), um padrão com todas as notas e um
// clipe no arranjo. Os áudios não vão para o MIDI. Ver docs/musica.md, "MIDI".
import {gravarMidi, lerMidi, type ArquivoMidi, type TrilhaMidi} from './midi';
import {arredondarBatida, batidasPorCompasso, idLivre, NOME_PRESET, novaFaixaMixer, resolverMusica, BPM_MAX, BPM_MIN,
  type CanalMusica, type ClipeMusica, type DocMusica, type NotaMusica, type PadraoMusica, type PecaBateria, type PresetSintetizador} from './musica';
import {notasDoClipe} from './musica-som';
import type {Edicao} from './musica-acoes';
import type {OperacaoPatch} from './documentos';

export const PPQ_MUSICA = 960; // a resolução de dentro (1/960 de batida): o tick é exato
const CANAL_BATERIA = 9; // o "canal 10" do General MIDI

/** Peça da casa → nota do General MIDI (bateria, canal 10). */
export const NOTA_GM_DA_PECA: Record<PecaBateria, number> = {bumbo: 36, aro: 37, caixa: 38, palma: 39, chimbal_fechado: 42, tom_grave: 45, chimbal_aberto: 46, prato: 49,
  tom_agudo: 50, shaker: 82};
/** Nota do General MIDI → peça (o que não está aqui é contado e fica de fora). Ride vai para o chimbal fechado, que
 *  toca o mesmo desenho; cowbell e o resto da percussão latina, para o aro e o shaker. */
const PECA_DA_NOTA_GM: Record<number, PecaBateria> = {
  35: 'bumbo', 36: 'bumbo', 37: 'aro', 38: 'caixa', 40: 'caixa', 39: 'palma', 42: 'chimbal_fechado', 44: 'chimbal_fechado', 46: 'chimbal_aberto',
  41: 'tom_grave', 43: 'tom_grave', 45: 'tom_grave', 47: 'tom_agudo', 48: 'tom_agudo', 50: 'tom_agudo', 49: 'prato', 52: 'prato', 55: 'prato', 57: 'prato',
  51: 'chimbal_fechado', 53: 'chimbal_fechado', 59: 'chimbal_fechado', 54: 'shaker', 69: 'shaker', 70: 'shaker', 82: 'shaker', 56: 'aro', 75: 'aro', 76: 'aro', 77: 'aro',
};
/** Som da casa → programa do General MIDI (contando de 0): Synth Bass 1, Pad 2 (warm), Orchestral Harp e Lead 2 (saw). */
export const PROGRAMA_DO_PRESET: Record<PresetSintetizador, number> = {baixo: 38, pad: 89, pluck: 46, lead: 81};
const presetDoPrograma = (programa: number | undefined, nome = ''): PresetSintetizador => {
  if (/bass|baixo/i.test(nome)) return 'baixo';
  if (/pad|string|cord/i.test(nome)) return 'pad';
  if (/lead|solo|melod/i.test(nome)) return 'lead';
  if (programa === undefined) return 'pluck';
  if (programa >= 32 && programa <= 39) return 'baixo';
  if ((programa >= 88 && programa <= 95) || (programa >= 48 && programa <= 55)) return 'pad';
  if (programa >= 80 && programa <= 87) return 'lead';
  return 'pluck';
};

/** O arranjo como MIDI (o que se ouve: clipes mudos e canais mudos ficam de fora; mudo e solo do mixer, não). */
export const musicaParaMidi = (doc: DocMusica): {bytes: Uint8Array; trilhas: number; notas: number; avisos: string[]} => {
  const {musica: m} = resolverMusica(doc);
  const avisos: string[] = [];
  const tick = (batidas: number) => Math.round(batidas * PPQ_MUSICA);
  const trilhas: TrilhaMidi[] = [];
  let proximo = 0;
  for (const canal of m.canais) {
    if (canal.tipo === 'audio') {
      if (m.clipes.some((c) => c.canal === canal.id)) avisos.push(`o canal de áudio "${canal.nome}" não vai para o MIDI`);
      continue;
    }
    if (canal.mudo) continue;
    const bateria = canal.tipo === 'bateria';
    let numero = CANAL_BATERIA;
    if (!bateria) {
      if (proximo === CANAL_BATERIA) proximo++;
      if (proximo > 15) {
        avisos.push(`o MIDI tem 16 canais; "${canal.nome}" ficou de fora`);
        continue;
      }
      numero = proximo++;
    }
    const notas: TrilhaMidi['notas'] = [];
    for (const c of m.clipes.filter((x) => x.canal === canal.id)) {
      const fim = c.em + c.dur;
      for (const ev of notasDoClipe(m, c)) {
        const em = ev.s / m.seg_por_batida;
        const n = ev.nota;
        const nota = bateria ? (n.peca ? NOTA_GM_DA_PECA[n.peca] : undefined) : n.nota;
        if (nota === undefined) continue;
        const dur = bateria ? 0.25 : Math.min(n.dur ?? 0.25, Math.max(1 / 16, fim - em));
        notas.push({tick: tick(em), dur: Math.max(1, tick(dur)), nota, forca: n.forca ?? 100});
      }
    }
    trilhas.push({nome: canal.nome, canal: numero, ...(bateria ? {} : {programa: PROGRAMA_DO_PRESET[canal.preset]}), notas});
  }
  const marcadores = (doc.secoes ?? []).map((s) => ({tick: tick(s.em), texto: s.nome}));
  const arquivo: ArquivoMidi = {ppq: PPQ_MUSICA, bpm: m.bpm, compasso: m.compasso, trilhas, marcadores};
  return {bytes: gravarMidi(arquivo), trilhas: trilhas.length, notas: trilhas.reduce((s, t) => s + t.notas.length, 0), avisos};
};

const MAX_NOTAS_PADRAO = 4096;

export type PedidoImportarMidi = {em?: number; usar_bpm?: boolean; nome?: string};

/** Lê o .mid e devolve a edição que cria os canais, os padrões e os clipes. O BPM e o compasso do arquivo entram quando
 *  a música ainda não tem clipes (ou com usar_bpm). As notas ficam em batidas: o mesmo arquivo em outro BPM toca igual. */
export const importarMidi = (doc: DocMusica, bytes: Uint8Array, o: PedidoImportarMidi = {}): Edicao => {
  const a = lerMidi(bytes);
  if (!a.trilhas.length) throw new Error('o MIDI não tem notas');
  const avisos: string[] = [];
  const patch: OperacaoPatch[] = [];
  const vazio = !doc.arranjo.clipes.length;
  const usarBpm = o.usar_bpm ?? vazio;
  let compasso = doc.compasso;
  if (usarBpm && a.bpm) {
    const bpm = Math.min(BPM_MAX, Math.max(BPM_MIN, a.bpm));
    if (bpm !== doc.bpm) patch.push({op: 'replace', path: '/bpm', value: bpm});
    if (bpm !== a.bpm) avisos.push(`o MIDI está em ${a.bpm} BPM; a música vai com ${bpm} (limites ${BPM_MIN} a ${BPM_MAX})`);
  }
  if (usarBpm && a.compasso && [2, 4, 8, 16].includes(a.compasso[1]) && (a.compasso[0] !== doc.compasso[0] || a.compasso[1] !== doc.compasso[1])) {
    compasso = a.compasso;
    patch.push({op: 'replace', path: '/compasso', value: compasso});
  }
  const bpc = batidasPorCompasso(compasso);
  const em = arredondarBatida(Math.max(0, o.em ?? 0));
  const idsCanais = doc.canais.map((c) => c.id);
  const idsPadroes = doc.padroes.map((p) => p.id);
  const idsClipes = doc.arranjo.clipes.map((c) => c.id);
  const idsFaixas = doc.mixer.faixas.map((f) => f.id);
  const criados: {canal: string; padrao: string; notas: number}[] = [];
  let ignoradas = 0;
  const base = (o.nome ?? '').trim();
  for (const t of a.trilhas) {
    const bateria = t.canal === CANAL_BATERIA;
    const notas: NotaMusica[] = [];
    let fim = 0;
    for (const n of t.notas) {
      const at = arredondarBatida(n.tick / a.ppq);
      const dur = arredondarBatida(Math.max(1 / 64, n.dur / a.ppq));
      if (bateria) {
        const peca = PECA_DA_NOTA_GM[n.nota];
        if (!peca) {
          ignoradas++;
          continue;
        }
        notas.push({peca, em: at, forca: n.forca});
        fim = Math.max(fim, at + 0.25);
      } else {
        notas.push({nota: n.nota, em: at, dur, forca: n.forca});
        fim = Math.max(fim, at + dur);
      }
    }
    if (!notas.length) continue;
    if (notas.length > MAX_NOTAS_PADRAO) {
      avisos.push(`a trilha "${t.nome ?? t.canal + 1}" tem ${notas.length} notas; entraram as primeiras ${MAX_NOTAS_PADRAO}`);
      notas.length = MAX_NOTAS_PADRAO;
    }
    const preset = presetDoPrograma(t.programa, t.nome);
    const id = idLivre(bateria ? 'bateria-' : `${preset}-`, idsCanais);
    idsCanais.push(id);
    const nomeCanal = [base, t.nome || (bateria ? 'Bateria' : NOME_PRESET[preset])].filter(Boolean).join(' · ');
    const canal: CanalMusica = bateria ? {id, nome: nomeCanal, tipo: 'bateria', faixa_mixer: id, kit: 'eletronico'}
      : {id, nome: nomeCanal, tipo: 'sintetizador', faixa_mixer: id, preset};
    patch.push({op: 'add', path: '/canais/-', value: canal});
    if (!idsFaixas.includes(id)) {
      patch.push({op: 'add', path: '/mixer/faixas/-', value: novaFaixaMixer(id, nomeCanal)});
      idsFaixas.push(id);
    }
    const dur = Math.max(bpc, Math.ceil(fim / bpc - 1e-9) * bpc);
    const padrao = idLivre('p', idsPadroes);
    idsPadroes.push(padrao);
    patch.push({op: 'add', path: '/padroes/-', value: {id: padrao, nome: `${t.nome || nomeCanal} (MIDI)`, canal: id, dur, passos: Math.min(256, Math.round(dur * 4)), notas} satisfies PadraoMusica});
    const clipe = idLivre('c', idsClipes);
    idsClipes.push(clipe);
    patch.push({op: 'add', path: '/arranjo/clipes/-', value: {id: clipe, canal: id, em, dur, padrao} satisfies ClipeMusica});
    criados.push({canal: id, padrao, notas: notas.length});
  }
  if (!criados.length) throw new Error(`nenhuma nota do MIDI tem lugar na música (${ignoradas} notas de bateria sem peça da casa)`);
  if (ignoradas) avisos.push(`${ignoradas} notas de bateria sem peça da casa ficaram de fora`);
  // marcadores do MIDI viram seções quando a música ainda não tem nenhuma
  if (!(doc.secoes ?? []).length && a.marcadores.length) {
    const fimArranjo = Math.max(...criados.map((c) => {
      const p = patch.find((x) => x.op === 'add' && x.path === '/padroes/-' && (x.value as PadraoMusica).id === c.padrao)?.value as PadraoMusica;
      return em + (p?.dur ?? 0);
    }));
    const marcas = [...a.marcadores].sort((x, y) => x.tick - y.tick).map((x) => ({em: arredondarBatida(em + x.tick / a.ppq), nome: x.texto || 'Seção'}));
    const secoes = marcas.map((x, i) => ({id: `s${i + 1}`, nome: x.nome, em: x.em, dur: arredondarBatida(Math.max(1 / 4, (marcas[i + 1]?.em ?? fimArranjo) - x.em))}));
    patch.push({op: doc.secoes === undefined ? 'add' : 'replace', path: '/secoes', value: secoes});
  }
  const notas = criados.reduce((s, c) => s + c.notas, 0);
  return {patch, rotulo: `MIDI importado: ${criados.length} ${criados.length === 1 ? 'canal' : 'canais'}, ${notas} notas`, caminho: '/canais',
    extra: {canais: criados, ...(a.bpm ? {bpm_do_arquivo: a.bpm} : {})}, ...(avisos.length ? {avisos} : {})};
};
