// Documento de música (musica/<id>.json): a vista Música do mesmo projeto, editada pela pessoa e pela IA pelo mesmo JSON
// Patch com diário. Tudo aqui é puro (sem disco, sem Web Audio): o tipo, o documento novo, o que nasce de um clipe do
// vídeo e a resolução para tempo de relógio, com os avisos. O som sai de musica-som.ts, o mesmo na prévia da janela, no
// render que vai para o vídeo e no MCP por stdio. Regras (docs/musica.md):
// - tempo em batidas a partir do começo (decimais; por dentro, arredondado a 1/960 de batida); o corte de um áudio é em
//   segundos do arquivo, porque o arquivo não sabe de batidas;
// - volume em dB, pan de −1 a 1, força de 1 a 127; nota em número MIDI (60 é o Dó central), bateria pelo nome da peça;
// - aleatório só com a semente do documento;
// - o que estiver fora do lugar vira aviso, nunca erro: a música sempre toca.
import type {EntradaDocumento, Manifesto} from './documentos';

export const FORMATO_MUSICA = 1;
export const RESOLUCAO = 960; // partes de batida
export const BPM_MIN = 20;
export const BPM_MAX = 300;
export const BPM_PADRAO = 120;
export const VOLUME_DB_MIN = -60;
export const VOLUME_DB_MAX = 12;
export const GANHO_EQ_DB = 18; // cada banda do EQ vai de −18 a +18 dB
export const DUR_MIN = 1 / 16; // o menor clipe ou padrão: 1/16 de batida (a semicolcheia é 1/4)

export type PecaBateria = 'bumbo' | 'caixa' | 'palma' | 'aro' | 'chimbal_fechado' | 'chimbal_aberto' | 'prato' | 'tom_grave' | 'tom_agudo' | 'shaker';
export const PECAS: PecaBateria[] = ['bumbo', 'caixa', 'palma', 'aro', 'chimbal_fechado', 'chimbal_aberto', 'prato', 'tom_grave', 'tom_agudo', 'shaker'];
export const NOME_PECA: Record<PecaBateria, string> = {
  bumbo: 'Bumbo', caixa: 'Caixa', palma: 'Palma', aro: 'Aro', chimbal_fechado: 'Chimbal fechado', chimbal_aberto: 'Chimbal aberto', prato: 'Prato',
  tom_grave: 'Tom grave', tom_agudo: 'Tom agudo', shaker: 'Shaker',
};

/** Ajuste de uma peça do kit: volume (dB), pan, afinação (semitons) e grupo de corte (peças do mesmo grupo se calam
 *  umas às outras, como o chimbal fechado que corta o aberto). */
export type AjustePeca = {volume_db?: number; pan?: number; afinacao?: number; grupo?: number};

/** Sintetizador da casa (item 14): quatro sons de partida e quatro macros de 0 a 1. */
export type PresetSintetizador = 'baixo' | 'pad' | 'pluck' | 'lead';
export const PRESETS: PresetSintetizador[] = ['baixo', 'pad', 'pluck', 'lead'];
export const NOME_PRESET: Record<PresetSintetizador, string> = {baixo: 'Baixo', pad: 'Pad', pluck: 'Pluck', lead: 'Lead'};
/** brilho: abre o filtro; ataque: entrada mais lenta; soltura: cauda mais longa; cor: mistura e desafina os osciladores. */
export type MacrosSintetizador = {brilho?: number; ataque?: number; soltura?: number; cor?: number};

/** Canal do arranjo: de áudio (clipes de arquivo), de bateria (clipes de padrão tocados por um kit) ou de sintetizador
 *  (clipes de padrão com notas MIDI). Cada canal sai numa faixa do mixer (`faixa_mixer`, padrão o próprio id). */
export type CanalMusica = {
  id: string;
  nome: string;
  tipo: 'audio' | 'bateria' | 'sintetizador';
  faixa_mixer?: string;
  kit?: string; // bateria: id do kit (padrão: 'eletronico', o sintetizado pelo motor)
  pecas?: Partial<Record<PecaBateria, AjustePeca>>;
  preset?: PresetSintetizador; // sintetizador (padrão: pluck)
  macros?: MacrosSintetizador;
  mudo?: boolean;
  solo?: boolean;
};

/** Nota de um padrão: `peca` (bateria) ou `nota` (MIDI), `em` em batidas desde o começo do padrão, `dur` em batidas
 *  (padrão: 1/4), `forca` de 1 a 127 (padrão 100). Sem id: uma nota se acha pelo padrão, o tempo e a altura. */
export type NotaMusica = {peca?: PecaBateria; nota?: number; em: number; dur?: number; forca?: number};

/** Padrão: um trecho de notas que os clipes repetem. `dur` em batidas (padrão: um compasso); `passos` é a grade do
 *  sequenciador (padrão 16 por compasso de 4/4). */
export type PadraoMusica = {id: string; nome?: string; canal: string; dur?: number; passos?: number; notas: NotaMusica[]};

/** Clipe do arranjo, num canal. `em` e `dur` em batidas. Clipe de áudio: `audio` (caminho no projeto), `corte_s`
 *  (onde começa dentro do arquivo, em segundos), `ganho_db` e fades em batidas. Clipe de padrão: `padrao`, que se
 *  repete até encher `dur`. `origem` diz de que clipe do vídeo o áudio veio ("Editar em Música"). */
export type ClipeMusica = {
  id: string;
  canal: string;
  em: number;
  dur: number;
  audio?: string;
  corte_s?: number;
  ganho_db?: number;
  fade_in?: number;
  fade_out?: number;
  padrao?: string;
  inicio?: number; // clipe de padrão: em que batida do padrão ele começa (padrão 0); dividir um clipe mantém o compasso
  mudo?: boolean;
  origem?: {documento: string; clipe: string};
};

/** EQ de três bandas: prateleira de graves (200 Hz), sino nos médios (1 kHz) e prateleira de agudos (5 kHz), em dB. */
export type EqFaixa = {graves_db?: number; medios_db?: number; agudos_db?: number};
/** Compressor: limiar e ganho de compensação em dB, razão (2 = 2:1), ataque e soltura em ms. */
export type CompressorFaixa = {ativo?: boolean; limiar_db?: number; razao?: number; ataque_ms?: number; soltura_ms?: number; ganho_db?: number};

/** Faixa do mixer: volume em dB, pan, mudo, solo, EQ, compressor e quanto vai para o reverb (0 a 1, depois do volume).
 *  A lista de efeitos livre (delay, presets) vem com o mixer completo, sem tirar estes campos. */
export type FaixaMixer = {id: string; nome?: string; volume_db?: number; pan?: number; mudo?: boolean; solo?: boolean; eq?: EqFaixa; compressor?: CompressorFaixa; reverb?: number};
export type ReverbMaster = {tamanho?: number; amortecimento?: number; volume_db?: number};
export type MixerMusica = {faixas: FaixaMixer[]; master?: {volume_db?: number; reverb?: ReverbMaster}};

export type MarcadorMusica = {id: string; em: number; nome: string};

/** Faixa de acordes (item 18): cada acorde por cifra ("Am7") ou grau no tom ("vi"), em batidas. */
export type AcordeNoTempo = {em: number; dur: number; acorde: string};

/** Ligação com o vídeo: de que documento a música é a trilha, onde ela começa nele e se a voz do vídeo toca como guia
 *  na Música (não entra no render). Os cortes das cenas não ficam gravados: saem do vídeo na hora. */
export type VideoMusica = {documento: string; em_ms?: number; voz_guia?: boolean};

export type DocMusica = {
  formato: typeof FORMATO_MUSICA;
  tipo: 'musica';
  titulo?: string;
  bpm: number;
  compasso: [number, number];
  tom?: string;
  escala?: 'maior' | 'menor';
  swing?: number; // 0 (reto) a 1 (tercina): atrasa as semicolcheias do contratempo
  semente?: number;
  alvo_lufs?: number;
  pico_dbtp?: number;
  canais: CanalMusica[];
  padroes: PadraoMusica[];
  arranjo: {clipes: ClipeMusica[]};
  mixer: MixerMusica;
  marcadores?: MarcadorMusica[];
  video?: VideoMusica;
  acordes?: AcordeNoTempo[];
};

export const ehDocMusica = (d: unknown): d is DocMusica => Boolean(d && typeof d === 'object' && (d as {tipo?: unknown}).tipo === 'musica');

// ---------- números ----------
const numero = (v: unknown, padrao: number) => (typeof v === 'number' && Number.isFinite(v) ? v : padrao);
const limitar = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
export const arredondarBatida = (b: number) => Math.round(b * RESOLUCAO) / RESOLUCAO;
const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** Segundos por batida (a semínima, num compasso de 4/4; a batida é sempre a semínima). */
export const segPorBatida = (bpm: number) => 60 / limitar(numero(bpm, BPM_PADRAO), BPM_MIN, BPM_MAX);
export const batidasPorCompasso = (compasso: [number, number] | undefined) => {
  const [n, d] = Array.isArray(compasso) ? compasso : [4, 4];
  return (limitar(numero(n, 4), 1, 32) * 4) / (d === 2 || d === 4 || d === 8 || d === 16 ? d : 4);
};
/** "3.2" = compasso 3, tempo 2 (contando de 1), para a régua e para a IA. */
export const posicaoEmCompasso = (batida: number, compasso: [number, number] | undefined) => {
  const bpc = batidasPorCompasso(compasso);
  const c = Math.floor(batida / bpc);
  const t = batida - c * bpc;
  return `${c + 1}.${Math.floor(t + 1e-9) + 1}${t % 1 > 1e-6 ? `+${r3(t % 1)}` : ''}`;
};

// ---------- documento novo ----------
export const novaFaixaMixer = (id: string, nome: string): FaixaMixer => ({id, nome, volume_db: 0, pan: 0});

/** Documento vazio: 120 BPM, 4/4, Dó maior, sem canais. */
export const novaMusica = (o: {titulo?: string; bpm?: number} = {}): DocMusica => ({
  formato: FORMATO_MUSICA,
  tipo: 'musica',
  ...(o.titulo ? {titulo: o.titulo} : {}),
  bpm: o.bpm ?? BPM_PADRAO,
  compasso: [4, 4],
  tom: 'C',
  escala: 'maior',
  swing: 0,
  semente: 1,
  canais: [],
  padroes: [],
  arranjo: {clipes: []},
  mixer: {faixas: [], master: {volume_db: 0, reverb: {tamanho: 0.6, amortecimento: 0.4, volume_db: 0}}},
  marcadores: [],
});

/** Id livre com o prefixo dado ("c1", "c2"…), entre os ids que já existem. */
export const idLivre = (prefixo: string, existentes: Iterable<string>) => {
  const usados = new Set(existentes);
  let n = 1;
  while (usados.has(`${prefixo}${n}`)) n++;
  return `${prefixo}${n}`;
};

/** Um clipe de áudio do vídeo (ms) visto como música: o arquivo, o corte e a duração. */
export type ClipeDoVideo = {id: string; arquivo: string; nome?: string; em: number; duracao_ms: number; corte_ms?: number; volume?: number};

/** "Editar em Música": o documento nasce com uma faixa de áudio com o arquivo do clipe, o corte e a duração dele, e o
 *  começo da música no ponto do vídeo em que o clipe está. O BPM fica em 120 (o áudio toca no tempo dele; a grade é só
 *  guia). Os fades, o volume e o ducking continuam no clipe do vídeo: o render sai cru, como o arquivo tocava. */
export const musicaDeClipe = (clipe: ClipeDoVideo, o: {video: string; titulo?: string; bpm?: number}): DocMusica => {
  const doc = novaMusica({titulo: o.titulo ?? clipe.nome ?? clipe.arquivo.split('/').pop(), bpm: o.bpm});
  const spb = segPorBatida(doc.bpm);
  const canal: CanalMusica = {id: 'audio', nome: clipe.nome || 'Áudio do vídeo', tipo: 'audio', faixa_mixer: 'audio'};
  doc.canais.push(canal);
  doc.mixer.faixas.push(novaFaixaMixer('audio', canal.nome));
  doc.arranjo.clipes.push({id: 'c1', canal: 'audio', em: 0, dur: arredondarBatida(clipe.duracao_ms / 1000 / spb), audio: clipe.arquivo,
    corte_s: r3((clipe.corte_ms ?? 0) / 1000), ganho_db: 0, origem: {documento: o.video, clipe: clipe.id}});
  doc.video = {documento: o.video, em_ms: Math.max(0, Math.round(clipe.em)), voz_guia: true};
  return doc;
};

/** "Criar em Música" numa faixa do vídeo: trilha (do ponto dado até o fim pedido) ou efeito sonoro (2 s na cabeça). */
export const musicaParaCriar = (o: {video: string; papel: 'musica' | 'efeitos'; em_ms?: number; dur_ms?: number; titulo?: string; bpm?: number}): DocMusica => {
  const doc = novaMusica({titulo: o.titulo ?? (o.papel === 'musica' ? 'Trilha do vídeo' : 'Efeito sonoro'), bpm: o.bpm});
  doc.video = {documento: o.video, em_ms: Math.max(0, Math.round(o.em_ms ?? 0)), voz_guia: true};
  const dur_ms = o.dur_ms ?? (o.papel === 'musica' ? 8 * 4 * segPorBatida(doc.bpm) * 1000 : 2000);
  // uma bateria pronta para receber o padrão: a duração pedida vira compassos inteiros
  const bpc = batidasPorCompasso(doc.compasso);
  const compassos = Math.max(1, Math.ceil((dur_ms / 1000 / segPorBatida(doc.bpm)) / bpc - 1e-6));
  doc.canais.push({id: 'bateria', nome: 'Bateria', tipo: 'bateria', faixa_mixer: 'bateria', kit: 'eletronico'});
  doc.mixer.faixas.push(novaFaixaMixer('bateria', 'Bateria'));
  doc.padroes.push({id: 'p1', nome: 'Padrão 1', canal: 'bateria', dur: bpc, passos: 16, notas: []});
  doc.arranjo.clipes.push({id: 'c1', canal: 'bateria', em: 0, dur: compassos * bpc, padrao: 'p1'});
  return doc;
};

// ---------- resolução ----------
export type ClipeMusicaP = {
  id: string;
  canal: string;
  indice: number; // posição em arranjo.clipes, para o patch
  em: number; // batidas
  dur: number;
  em_s: number;
  dur_s: number;
  audio?: string;
  corte_s: number;
  ganho_db: number;
  fade_in_s: number;
  fade_out_s: number;
  padrao?: string;
  inicio: number;
  mudo: boolean;
};

export type FaixaMixerP = {id: string; nome: string; volume_db: number; pan: number; mudo: boolean; solo: boolean; eq: Required<EqFaixa>; compressor: Required<CompressorFaixa>; reverb: number};
export type CanalMusicaP = {id: string; nome: string; tipo: 'audio' | 'bateria' | 'sintetizador'; faixa_mixer: string; kit: string; pecas: Partial<Record<PecaBateria, AjustePeca>>;
  preset: PresetSintetizador; macros: Required<MacrosSintetizador>; mudo: boolean; solo: boolean};

export type MusicaP = {
  bpm: number;
  compasso: [number, number];
  seg_por_batida: number;
  batidas_por_compasso: number;
  swing: number;
  semente: number;
  duracao_batidas: number;
  duracao_s: number;
  canais: CanalMusicaP[];
  clipes: ClipeMusicaP[];
  padroes: Record<string, PadraoMusica & {dur: number; passos: number}>;
  faixas: FaixaMixerP[];
  master: {volume_db: number; reverb: Required<ReverbMaster>};
  video?: {documento: string; em_ms: number; voz_guia: boolean};
};

const COMPRESSOR_PADRAO: Required<CompressorFaixa> = {ativo: false, limiar_db: -18, razao: 3, ataque_ms: 10, soltura_ms: 120, ganho_db: 0};
const REVERB_PADRAO: Required<ReverbMaster> = {tamanho: 0.6, amortecimento: 0.4, volume_db: 0};

const db = (v: unknown, padrao = 0) => limitar(numero(v, padrao), VOLUME_DB_MIN, VOLUME_DB_MAX);
const pan = (v: unknown) => limitar(numero(v, 0), -1, 1);

/** O documento em tempo de relógio, com os padrões aplicados e os avisos. Canal, padrão ou faixa que faltam viram aviso
 *  e o clipe fica calado; números fora da faixa voltam para dentro. */
export const resolverMusica = (doc: DocMusica): {musica: MusicaP; avisos: string[]} => {
  const avisos: string[] = [];
  const bpmPedido = numero(doc.bpm, BPM_PADRAO);
  const bpm = limitar(bpmPedido, BPM_MIN, BPM_MAX);
  if (bpm !== bpmPedido) avisos.push(`o BPM ${String(doc.bpm)} está fora de ${BPM_MIN} a ${BPM_MAX}; vai com ${bpm}`);
  const spb = 60 / bpm;
  const compasso: [number, number] = Array.isArray(doc.compasso) && doc.compasso.length === 2 ? [doc.compasso[0], doc.compasso[1]] : [4, 4];
  const bpc = batidasPorCompasso(compasso);
  const swing = limitar(numero(doc.swing, 0), 0, 1);

  const faixasDoc = Array.isArray(doc.mixer?.faixas) ? doc.mixer.faixas : [];
  const macro = (v: unknown, padrao: number) => limitar(numero(v, padrao), 0, 1);
  const canais: CanalMusicaP[] = (Array.isArray(doc.canais) ? doc.canais : []).map((c) => ({
    id: c.id, nome: c.nome || c.id, tipo: c.tipo === 'bateria' || c.tipo === 'sintetizador' ? c.tipo : 'audio', faixa_mixer: c.faixa_mixer || c.id, kit: c.kit || 'eletronico',
    pecas: c.pecas ?? {}, preset: PRESETS.includes(c.preset as PresetSintetizador) ? c.preset! : 'pluck',
    macros: {brilho: macro(c.macros?.brilho, 0.5), ataque: macro(c.macros?.ataque, 0), soltura: macro(c.macros?.soltura, 0.3), cor: macro(c.macros?.cor, 0.3)},
    mudo: Boolean(c.mudo), solo: Boolean(c.solo),
  }));
  const idsCanais = new Set(canais.map((c) => c.id));

  // toda faixa de mixer que um canal pede existe, mesmo sem estar no documento (volume 0 dB, centro)
  const faixas: FaixaMixerP[] = faixasDoc.map((f) => ({
    id: f.id, nome: f.nome || f.id, volume_db: db(f.volume_db), pan: pan(f.pan), mudo: Boolean(f.mudo), solo: Boolean(f.solo),
    eq: {graves_db: limitar(numero(f.eq?.graves_db, 0), -GANHO_EQ_DB, GANHO_EQ_DB), medios_db: limitar(numero(f.eq?.medios_db, 0), -GANHO_EQ_DB, GANHO_EQ_DB),
      agudos_db: limitar(numero(f.eq?.agudos_db, 0), -GANHO_EQ_DB, GANHO_EQ_DB)},
    compressor: {ativo: Boolean(f.compressor?.ativo), limiar_db: limitar(numero(f.compressor?.limiar_db, COMPRESSOR_PADRAO.limiar_db), -60, 0),
      razao: limitar(numero(f.compressor?.razao, COMPRESSOR_PADRAO.razao), 1, 20), ataque_ms: limitar(numero(f.compressor?.ataque_ms, COMPRESSOR_PADRAO.ataque_ms), 0.1, 200),
      soltura_ms: limitar(numero(f.compressor?.soltura_ms, COMPRESSOR_PADRAO.soltura_ms), 5, 2000), ganho_db: limitar(numero(f.compressor?.ganho_db, 0), 0, 24)},
    reverb: limitar(numero(f.reverb, 0), 0, 1),
  }));
  for (const c of canais) {
    if (!faixas.some((f) => f.id === c.faixa_mixer)) {
      faixas.push({id: c.faixa_mixer, nome: c.nome, volume_db: 0, pan: 0, mudo: false, solo: false, eq: {graves_db: 0, medios_db: 0, agudos_db: 0}, compressor: {...COMPRESSOR_PADRAO}, reverb: 0});
    }
  }

  const padroes: MusicaP['padroes'] = {};
  for (const p of Array.isArray(doc.padroes) ? doc.padroes : []) {
    if (!p || typeof p.id !== 'string') continue;
    const dur = Math.max(DUR_MIN, numero(p.dur, bpc));
    padroes[p.id] = {...p, dur, passos: limitar(Math.round(numero(p.passos, Math.round(dur * 4))), 1, 256), notas: Array.isArray(p.notas) ? p.notas : []};
    if (!idsCanais.has(p.canal)) avisos.push(`o padrão "${p.nome || p.id}" é do canal "${p.canal}", que não existe`);
  }

  const clipes: ClipeMusicaP[] = [];
  (Array.isArray(doc.arranjo?.clipes) ? doc.arranjo.clipes : []).forEach((c, indice) => {
    if (!c || typeof c.id !== 'string') return;
    const nome = c.id;
    let em = arredondarBatida(numero(c.em, 0));
    if (em < 0) {
      avisos.push(`o clipe "${nome}" começa antes do zero; vai para o começo`);
      em = 0;
    }
    const dur = arredondarBatida(Math.max(DUR_MIN, numero(c.dur, bpc)));
    const canal = canais.find((k) => k.id === c.canal);
    let mudo = Boolean(c.mudo);
    if (!canal) {
      avisos.push(`o clipe "${nome}" está no canal "${c.canal}", que não existe; fica calado`);
      mudo = true;
    } else if (canal.tipo === 'audio' && !c.audio) {
      avisos.push(`o clipe "${nome}" está num canal de áudio sem "audio"; fica calado`);
      mudo = true;
    } else if (canal.tipo !== 'audio' && (!c.padrao || !padroes[c.padrao])) {
      avisos.push(c.padrao ? `o clipe "${nome}" toca o padrão "${c.padrao}", que não existe; fica calado` : `o clipe "${nome}" está num canal de ${canal.tipo} sem "padrao"; fica calado`);
      mudo = true;
    } else if (canal.tipo !== 'audio' && padroes[c.padrao!].canal !== canal.id) {
      avisos.push(`o clipe "${nome}" toca no canal "${canal.id}" o padrão "${c.padrao}", que é do canal "${padroes[c.padrao!].canal}"`);
    }
    const fadeIn = limitar(numero(c.fade_in, 0), 0, dur);
    const fadeOut = limitar(numero(c.fade_out, 0), 0, dur);
    clipes.push({
      id: c.id, canal: c.canal, indice, em, dur, em_s: em * spb, dur_s: dur * spb, audio: canal?.tipo === 'audio' ? c.audio : undefined,
      corte_s: Math.max(0, numero(c.corte_s, 0)), ganho_db: db(c.ganho_db), fade_in_s: fadeIn * spb, fade_out_s: fadeOut * spb,
      padrao: canal && canal.tipo !== 'audio' ? c.padrao : undefined, inicio: Math.max(0, numero(c.inicio, 0)), mudo,
    });
  });
  const duracao_batidas = clipes.reduce((m, c) => Math.max(m, c.em + c.dur), 0);
  const master = doc.mixer?.master ?? {};
  const r = master.reverb ?? {};
  const v = doc.video;
  return {
    musica: {
      bpm, compasso, seg_por_batida: spb, batidas_por_compasso: bpc, swing, semente: Math.trunc(numero(doc.semente, 1)),
      duracao_batidas, duracao_s: duracao_batidas * spb, canais, clipes, padroes, faixas,
      master: {volume_db: db(master.volume_db), reverb: {tamanho: limitar(numero(r.tamanho, REVERB_PADRAO.tamanho), 0, 1),
        amortecimento: limitar(numero(r.amortecimento, REVERB_PADRAO.amortecimento), 0, 1), volume_db: db(r.volume_db)}},
      ...(v && typeof v.documento === 'string' ? {video: {documento: v.documento, em_ms: Math.max(0, numero(v.em_ms, 0)), voz_guia: v.voz_guia !== false}} : {}),
    },
    avisos,
  };
};

/** Arquivos de áudio que a música usa (para decodificar antes do render). */
export const audiosDaMusica = (doc: DocMusica) => [...new Set((doc.arranjo?.clipes ?? []).map((c) => c.audio).filter((a): a is string => typeof a === 'string' && a.length > 0))];

/** O que entra no som: o documento sem título, marcadores e voz guia (mudar o nome não refaz o render). */
export const partesDoSom = (doc: DocMusica) => {
  const {titulo: _t, marcadores: _m, video, ...resto} = doc;
  return {...resto, ...(video ? {video_em_ms: video.em_ms ?? 0} : {})};
};

/** Entrada do manifesto para um documento de música novo: musica/musica.json, musica/musica-2.json… */
export const entradaDeMusica = (m: Manifesto, titulo?: string): EntradaDocumento => {
  const ids = new Set(m.documentos.map((d) => d.id));
  const caminhos = new Set(m.documentos.map((d) => d.caminho));
  let n = 1;
  const nome = (k: number) => (k === 1 ? 'musica' : `musica-${k}`);
  while (ids.has(nome(n)) || caminhos.has(`musica/${nome(n)}.json`)) n++;
  const mesmos = m.documentos.filter((d) => d.modulo === 'musica').length;
  return {id: nome(n), modulo: 'musica', caminho: `musica/${nome(n)}.json`, titulo: titulo?.trim() || (mesmos ? `Música ${mesmos + 1}` : 'Música')};
};

/** Caminho do render que vai para o vídeo: midia/musica/<id>.<código>.wav (fora do git, refeito pelo documento). */
export const caminhoDoRender = (id: string, codigo: string) => `midia/musica/${id.replace(/[^a-z0-9_-]/gi, '_')}.${codigo}.wav`;
