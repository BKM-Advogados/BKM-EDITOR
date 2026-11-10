// Modelos de música (item 27), só com som gerado (o kit sintetizado e os sintetizadores da casa): "batida",
// "trilha_video" e "efeito_sonoro", além de "vazio". Cada modelo é montado com as mesmas edições da tela e do MCP
// (criar_padrao, aplicar_progressao, gerar_notas, presets), aplicadas uma a uma; o título e o vídeo do documento de base
// ficam. `compassos` (ou `dur_s`, que vira compassos inteiros para cima) estica a música inteira. Ver docs/musica.md.
import jsonpatch, {type Operation} from 'fast-json-patch';
import {batidasPorCompasso, novaFaixaMixer, novaMusica, segPorBatida, type AutomacaoMusica, type DocMusica, type NotaMusica} from './musica';
import {aplicarProgressao, criarPadrao, gerarNotas, presetDaFaixa, type Edicao} from './musica-acoes';
import type {OperacaoPatch} from './documentos';

export type ModeloMusica = 'vazio' | 'batida' | 'trilha_video' | 'efeito_sonoro';
export const MODELOS_MUSICA: {id: ModeloMusica; nome: string; descricao: string}[] = [
  {id: 'vazio', nome: 'Vazia', descricao: 'sem canais'},
  {id: 'batida', nome: 'Batida', descricao: 'bateria pop, baixo em oitavas e acordes em Lá menor, 100 BPM, com sidechain no baixo'},
  {id: 'trilha_video', nome: 'Trilha para vídeo', descricao: 'cama calma em Dó maior para ficar sob a voz, 90 BPM, com pad, arpejo, baixo e bateria leve, e fade no fim'},
  {id: 'efeito_sonoro', nome: 'Efeito sonoro', descricao: 'subida e impacto: notas que sobem, rufar da caixa e bumbo, prato e grave no fim'},
];
const PADRAO_COMPASSOS: Record<ModeloMusica, number> = {vazio: 0, batida: 8, trilha_video: 16, efeito_sonoro: 2};

const aplicarE = (d: DocMusica, e: Edicao) => jsonpatch.applyPatch(d, e.patch as Operation[], true, false).newDocument as DocMusica;
const repetir = (lista: string[], n: number) => Array.from({length: n}, (_, i) => lista[i % lista.length]);
const faixa = (d: DocMusica, id: string) => d.mixer.faixas.find((f) => f.id === id)!;

/** O documento do modelo. `base` dá o título e o vídeo (a música criada de um vídeo continua ligada a ele). */
export const musicaDoModelo = (modelo: ModeloMusica, base?: Pick<DocMusica, 'titulo' | 'video'>, o: {compassos?: number; dur_s?: number} = {}): DocMusica => {
  const bpm = modelo === 'batida' ? 100 : modelo === 'trilha_video' ? 90 : 120;
  let d = novaMusica({titulo: base?.titulo, bpm});
  if (base?.video) d.video = {...base.video};
  if (modelo === 'vazio') return d;
  const bpc = batidasPorCompasso(d.compasso);
  const compassos = Math.max(1, Math.min(256, o.compassos ?? (o.dur_s ? Math.ceil(o.dur_s / (bpc * segPorBatida(bpm)) - 1e-6) : PADRAO_COMPASSOS[modelo])));
  const fim = compassos * bpc;

  if (modelo === 'batida') {
    d.tom = 'A';
    d.escala = 'menor';
    d = aplicarE(d, aplicarProgressao(d, {acordes: repetir(['i', 'VI', 'III', 'VII'], compassos)}));
    d = aplicarE(d, criarPadrao(d, {canal: 'bateria', estilo: 'pop', no_arranjo: {em: 0, dur: fim}}));
    const baixo = gerarNotas(d, {tipo: 'baixo', estilo: 'oitavas'});
    d = aplicarE(d, baixo);
    const acordes = gerarNotas(d, {tipo: 'acordes', estilo: 'batidas'});
    d = aplicarE(d, acordes);
    d = aplicarE(d, presetDaFaixa(d, 'bateria', 'bateria'));
    d = aplicarE(d, presetDaFaixa(d, baixo.extra!.canal as string, 'baixo'));
    d = aplicarE(d, presetDaFaixa(d, acordes.extra!.canal as string, 'pad'));
    faixa(d, acordes.extra!.canal as string).volume_db = -6;
    // o baixo abaixa a cada bumbo (item 22): o grave dos dois não se embola
    faixa(d, baixo.extra!.canal as string).sidechain = {de: 'bateria', peca: 'bumbo', quanto_db: 6, soltura_ms: 160};
    if (compassos >= 4) d.secoes = [{id: 's1', nome: 'Parte A', em: 0, dur: Math.floor(compassos / 2) * bpc}, {id: 's2', nome: 'Parte B', em: Math.floor(compassos / 2) * bpc, dur: fim - Math.floor(compassos / 2) * bpc}];
    return d;
  }

  if (modelo === 'trilha_video') {
    d.tom = 'C';
    d.escala = 'maior';
    d = aplicarE(d, aplicarProgressao(d, {acordes: repetir(['I', 'V', 'vi', 'IV'], compassos)}));
    const pad = gerarNotas(d, {tipo: 'acordes', estilo: 'longo'});
    d = aplicarE(d, pad);
    const arpejo = gerarNotas(d, {tipo: 'arpejo', estilo: 'sobe'});
    d = aplicarE(d, arpejo);
    const baixo = gerarNotas(d, {tipo: 'baixo', estilo: 'longo'});
    d = aplicarE(d, baixo);
    d = aplicarE(d, criarPadrao(d, {canal: 'bateria', estilo: 'calmo', no_arranjo: {em: 0, dur: fim}}));
    const volumes: [string, number][] = [[pad.extra!.canal as string, -3], [arpejo.extra!.canal as string, -9], [baixo.extra!.canal as string, -4], ['bateria', -8]];
    for (const [id, db] of volumes) {
      d = aplicarE(d, presetDaFaixa(d, id, id === pad.extra!.canal ? 'pad' : 'cama'));
      faixa(d, id).volume_db = db;
    }
    // fecha com um fade de um compasso no master (automação por pontos, item 22)
    const fade: AutomacaoMusica = {alvo: 'master', parametro: 'volume', pontos: [{em: Math.max(0, fim - bpc), db: 0}, {em: fim, db: -40}]};
    d.automacoes = [fade];
    return d;
  }

  // efeito sonoro: subida até `impacto` e o impacto com cauda de pelo menos dois tempos
  const impacto = Math.max(2, fim - 2);
  const passos = Math.round(impacto * 4);
  const subida: NotaMusica[] = Array.from({length: passos}, (_, i) => ({nota: 60 + Math.round((i * 24) / Math.max(1, passos - 1)), em: i / 4, dur: 0.25,
    forca: Math.round(40 + (80 * i) / Math.max(1, passos - 1))}));
  const rufar: NotaMusica[] = Array.from({length: passos}, (_, i) => ({peca: 'caixa' as const, em: i / 4, forca: Math.round(30 + (90 * i) / Math.max(1, passos - 1))}))
    .filter((n) => n.em >= impacto / 2);
  const total = Math.max(fim, impacto + 2);
  d.canais.push({id: 'subida', nome: 'Subida', tipo: 'sintetizador', faixa_mixer: 'subida', preset: 'lead', macros: {brilho: 0.7}},
    {id: 'bateria', nome: 'Bateria', tipo: 'bateria', faixa_mixer: 'bateria', kit: 'eletronico'},
    {id: 'grave', nome: 'Grave', tipo: 'sintetizador', faixa_mixer: 'grave', preset: 'baixo'});
  d.padroes.push({id: 'p1', nome: 'Subida', canal: 'subida', dur: impacto, passos: Math.min(256, passos), notas: subida},
    {id: 'p2', nome: 'Rufar e impacto', canal: 'bateria', dur: total, passos: Math.min(256, Math.round(total * 4)),
      notas: [...rufar, {peca: 'bumbo', em: impacto, forca: 127}, {peca: 'prato', em: impacto, forca: 120}, {peca: 'tom_grave', em: impacto, forca: 110}]},
    {id: 'p3', nome: 'Grave', canal: 'grave', dur: total, passos: Math.min(256, Math.round(total * 4)), notas: [{nota: 28, em: impacto, dur: total - impacto, forca: 127}]});
  d.arranjo.clipes.push({id: 'c1', canal: 'subida', em: 0, dur: impacto, padrao: 'p1'}, {id: 'c2', canal: 'bateria', em: 0, dur: total, padrao: 'p2'},
    {id: 'c3', canal: 'grave', em: 0, dur: total, padrao: 'p3'});
  d.mixer.faixas.push({...novaFaixaMixer('subida', 'Subida'), volume_db: -4, reverb: 0.3, delay: 0.3}, {...novaFaixaMixer('bateria', 'Bateria'), reverb: 0.35},
    {...novaFaixaMixer('grave', 'Grave'), volume_db: -2});
  d.mixer.master = {...d.mixer.master, delay: {tempo: '1/8', realimentacao: 0.4, brilho: 0.4, pingue_pongue: true, volume_db: -3}};
  return d;
};

/** O patch que troca o documento aberto pelo modelo (título e vídeo ficam): a tela cria a música vazia e aplica isto. */
export const patchDoModelo = (doc: DocMusica, modelo: ModeloMusica, o: {compassos?: number; dur_s?: number} = {}) => {
  const novo = musicaDoModelo(modelo, doc, o) as Record<string, unknown>;
  const atual = doc as unknown as Record<string, unknown>;
  const chaves = new Set([...Object.keys(atual), ...Object.keys(novo)].filter((k) => k !== 'titulo' && k !== 'video' && k !== 'formato' && k !== 'tipo'));
  return [...chaves].flatMap((k): OperacaoPatch[] => (novo[k] === undefined ? (atual[k] === undefined ? [] : [{op: 'remove', path: `/${k}`}])
    : [{op: atual[k] === undefined ? 'add' : 'replace', path: `/${k}`, value: novo[k]}]));
};
