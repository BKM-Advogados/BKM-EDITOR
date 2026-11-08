// Edições da música como patches, puras: a mesma conta para a tela (src/renderer/modulos/musica) e para as ferramentas
// do MCP (mcp-musica.ts). Cada função lê o documento como está e devolve o patch (com "test" no que ela confere), o
// rótulo do diário e o caminho do que mudou; nada aqui grava. Erro é Error com a frase para a pessoa ou para a IA.
import type {OperacaoPatch} from './documentos';
import {arredondarBatida, batidasPorCompasso, idLivre, novaFaixaMixer, posicaoEmCompasso, segPorBatida,
  type CanalMusica, type ClipeMusica, type DocMusica, type NotaMusica, type PadraoMusica, type PecaBateria} from './musica';
import {KITS} from './musica-som';
import {ESTILOS, padraoDoEstilo} from './musica-estilos';

export type Edicao = {patch: OperacaoPatch[]; rotulo: string; caminho: string; extra?: Record<string, unknown>; avisos?: string[]};

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const fimDoCanal = (doc: DocMusica, canal: string) => doc.arranjo.clipes.filter((c) => c.canal === canal).reduce((x, c) => Math.max(x, c.em + c.dur), 0);

export const indiceDoClipe = (doc: DocMusica, id: string) => {
  const i = doc.arranjo.clipes.findIndex((c) => c.id === id);
  if (i < 0) throw new Error(`clipe não achado: ${id} (clipes: ${doc.arranjo.clipes.map((c) => c.id).join(', ') || 'nenhum'})`);
  return i;
};

// ---------- arranjo ----------
export type AcaoArranjo = 'por' | 'mover' | 'aparar' | 'dividir' | 'apagar' | 'ajustar';
export type PedidoArranjo = {acao: AcaoArranjo; clipe?: string; canal?: string; audio?: string; padrao?: string; em?: number; dur?: number; corte_s?: number;
  ganho_db?: number; fade_in?: number; fade_out?: number; mudo?: boolean};

/** Põe, move, apara, divide, apaga ou ajusta um clipe. Aparar o começo de um áudio anda o corte no arquivo, e o de um
 *  padrão anda o "inicio": o que toca fica no mesmo lugar. Dividir faz o mesmo na segunda metade. */
export const editarArranjo = (doc: DocMusica, a: PedidoArranjo, o: {existe?: (arquivo: string) => boolean} = {}): Edicao => {
  const spb = segPorBatida(doc.bpm);
  const bpc = batidasPorCompasso(doc.compasso);
  if (a.acao === 'por') {
    const canal = doc.canais.find((c) => c.id === a.canal);
    if (!canal) throw new Error(`diga o canal (${doc.canais.map((c) => c.id).join(', ') || 'a música não tem canais'})`);
    const em = arredondarBatida(a.em ?? fimDoCanal(doc, canal.id));
    const avisos: string[] = [];
    let novo: ClipeMusica;
    const id = idLivre('c', doc.arranjo.clipes.map((c) => c.id));
    if (canal.tipo === 'audio') {
      if (!a.audio) throw new Error('canal de áudio: diga o "audio" (caminho no projeto)');
      if (o.existe && !o.existe(a.audio)) avisos.push(`${a.audio} não está no projeto: o clipe fica calado até o arquivo chegar`);
      if (a.dur === undefined) avisos.push('sem "dur": o clipe ficou com 4 compassos; confira com a duração do arquivo');
      novo = {id, canal: canal.id, em, dur: arredondarBatida(a.dur ?? 4 * bpc), audio: a.audio, corte_s: a.corte_s ?? 0, ganho_db: a.ganho_db ?? 0,
        ...(a.fade_in ? {fade_in: a.fade_in} : {}), ...(a.fade_out ? {fade_out: a.fade_out} : {})};
    } else {
      const padrao = a.padrao ?? doc.padroes.find((p) => p.canal === canal.id)?.id;
      const p = doc.padroes.find((x) => x.id === padrao);
      if (!p) throw new Error(`canal de bateria: diga o "padrao" (${doc.padroes.filter((x) => x.canal === canal.id).map((x) => x.id).join(', ') || 'crie com criar_padrao'})`);
      novo = {id, canal: canal.id, em, dur: arredondarBatida(a.dur ?? p.dur ?? bpc), padrao: p.id};
    }
    return {patch: [{op: 'add', path: '/arranjo/clipes/-', value: novo}], rotulo: `clipe ${id} em ${posicaoEmCompasso(em, doc.compasso)}`,
      caminho: `/arranjo/clipes/${doc.arranjo.clipes.length}`, extra: {clipe: id}, avisos};
  }
  if (!a.clipe) throw new Error('diga o "clipe"');
  const i = indiceDoClipe(doc, a.clipe);
  const c = doc.arranjo.clipes[i];
  const base = `/arranjo/clipes/${i}`;
  const teste: OperacaoPatch = {op: 'test', path: `${base}/id`, value: c.id};
  const campo = (k: keyof ClipeMusica, v: unknown): OperacaoPatch[] =>
    (v === undefined || c[k] === v ? [] : [{op: c[k] === undefined ? 'add' : 'replace', path: `${base}/${k}`, value: v}]);
  switch (a.acao) {
    case 'mover': {
      if (a.em === undefined && !a.canal) throw new Error('diga o "em" novo e/ou o "canal"');
      if (a.canal) {
        const destino = doc.canais.find((k) => k.id === a.canal);
        const atual = doc.canais.find((k) => k.id === c.canal);
        if (!destino) throw new Error(`canal não achado: ${a.canal}`);
        if (atual && destino.tipo !== atual.tipo) throw new Error(`o clipe é de ${atual.tipo} e o canal ${destino.id} é de ${destino.tipo}`);
      }
      const em = a.em === undefined ? undefined : arredondarBatida(Math.max(0, a.em));
      return {patch: [teste, ...campo('em', em), ...campo('canal', a.canal)], rotulo: `move ${c.id}${em !== undefined ? ` para ${posicaoEmCompasso(em, doc.compasso)}` : ''}`,
        caminho: base, extra: {clipe: c.id}};
    }
    case 'aparar': {
      if (a.em === undefined && a.dur === undefined) throw new Error('diga o "em" novo (o fim fica) e/ou a "dur"');
      const fim = c.em + c.dur;
      const em = a.em === undefined ? c.em : arredondarBatida(Math.max(0, Math.min(a.em, fim - 1 / 16)));
      const desloc = em - c.em;
      const dur = arredondarBatida(Math.max(1 / 16, a.dur ?? fim - em));
      const patch = [teste, ...campo('em', em), ...campo('dur', dur)];
      if (desloc && c.audio) patch.push(...campo('corte_s', r3(Math.max(0, (c.corte_s ?? 0) + desloc * spb))));
      if (desloc && c.padrao) patch.push(...campo('inicio', arredondarBatida(Math.max(0, (c.inicio ?? 0) + desloc))));
      return {patch, rotulo: `apara ${c.id}`, caminho: base, extra: {clipe: c.id}};
    }
    case 'dividir': {
      if (a.em === undefined || a.em <= c.em || a.em >= c.em + c.dur) throw new Error(`diga o "em" do corte, entre ${c.em} e ${c.em + c.dur}`);
      const corte = arredondarBatida(a.em);
      const id = idLivre('c', doc.arranjo.clipes.map((x) => x.id));
      const desloc = corte - c.em;
      const {fade_in: _fi, origem: _o, ...resto} = c;
      const segundo: ClipeMusica = {...resto, id, em: corte, dur: arredondarBatida(c.dur - desloc), ...(c.audio ? {corte_s: r3((c.corte_s ?? 0) + desloc * spb)} : {}),
        ...(c.padrao ? {inicio: arredondarBatida((c.inicio ?? 0) + desloc)} : {})};
      const patch: OperacaoPatch[] = [teste, ...campo('dur', arredondarBatida(desloc)), ...(c.fade_out !== undefined ? [{op: 'remove' as const, path: `${base}/fade_out`}] : []),
        {op: 'add', path: `/arranjo/clipes/${i + 1}`, value: segundo}];
      return {patch, rotulo: `divide ${c.id} em ${posicaoEmCompasso(corte, doc.compasso)}`, caminho: `/arranjo/clipes/${i + 1}`, extra: {clipes: [c.id, id]}};
    }
    case 'apagar':
      return {patch: [teste, {op: 'remove', path: base}], rotulo: `apaga ${c.id}`, caminho: base, extra: {clipe: c.id}};
    case 'ajustar': {
      const patch = [teste, ...campo('ganho_db', a.ganho_db), ...campo('fade_in', a.fade_in), ...campo('fade_out', a.fade_out), ...campo('mudo', a.mudo)];
      if (patch.length === 1) throw new Error('diga ganho_db, fade_in, fade_out ou mudo (diferente do que está)');
      return {patch, rotulo: `ajusta ${c.id}`, caminho: base, extra: {clipe: c.id}};
    }
  }
  throw new Error(`ação desconhecida: ${String(a.acao)}`);
};

// ---------- notas ----------
export type Quantizar = '1/4' | '1/8' | '1/16' | '1/32';
export type PedidoNotas = {padrao: string; notas: NotaMusica[]; modo?: 'somar' | 'trocar'; de?: number; ate?: number; quantizar?: Quantizar};

/** Escreve notas num padrão: nota igual (mesma peça ou altura, mesmo tempo) troca, não duplica; com "trocar", o trecho
 *  de..ate é apagado antes. As notas ficam em ordem de tempo. */
export const escreverNotas = (doc: DocMusica, a: PedidoNotas): Edicao => {
  const i = doc.padroes.findIndex((p) => p.id === a.padrao);
  if (i < 0) throw new Error(`padrão não achado: ${a.padrao} (${doc.padroes.map((p) => p.id).join(', ') || 'crie com criar_padrao'})`);
  const p = doc.padroes[i];
  const dur = p.dur ?? batidasPorCompasso(doc.compasso);
  const grade = a.quantizar ? 4 / Number(a.quantizar.split('/')[1]) : 0;
  const avisos: string[] = [];
  const de = a.de ?? 0;
  const ate = a.ate ?? dur;
  let notas = a.modo === 'trocar' ? p.notas.filter((n) => n.em < de || n.em >= ate) : [...p.notas];
  let fora = 0;
  for (const n0 of a.notas) {
    if (!n0.peca && n0.nota === undefined) {
      avisos.push('nota sem peca nem nota: ignorada');
      continue;
    }
    const em = arredondarBatida(grade ? Math.round(n0.em / grade) * grade : n0.em);
    if (em >= dur || em < 0) {
      fora++;
      continue;
    }
    const n: NotaMusica = {...(n0.peca ? {peca: n0.peca} : {nota: n0.nota}), em, ...(n0.dur ? {dur: n0.dur} : {}), ...(n0.forca ? {forca: n0.forca} : {})};
    notas = notas.filter((x) => !(Math.abs(x.em - n.em) < 1e-6 && (n.peca ? x.peca === n.peca : x.nota === n.nota)));
    notas.push(n);
  }
  if (fora) avisos.push(`${fora} nota(s) fora do padrão (0 a ${dur} batidas) ficaram de fora`);
  notas.sort((x, y) => x.em - y.em || String(x.peca ?? x.nota).localeCompare(String(y.peca ?? y.nota)));
  return {patch: [{op: 'test', path: `/padroes/${i}/id`, value: p.id}, {op: 'replace', path: `/padroes/${i}/notas`, value: notas}],
    rotulo: `${a.notas.length} nota(s) em ${p.nome ?? p.id}`, caminho: `/padroes/${i}/notas`, extra: {padrao: p.id, notas: notas.length}, avisos};
};

/** O passo do sequenciador: liga a peça no tempo `em` (com a força) ou, se já toca ali, desliga. */
export const alternarPasso = (doc: DocMusica, padrao: string, peca: PecaBateria, em: number, forca?: number): Edicao => {
  const i = doc.padroes.findIndex((p) => p.id === padrao);
  if (i < 0) throw new Error(`padrão não achado: ${padrao}`);
  const p = doc.padroes[i];
  const t = arredondarBatida(em);
  const tem = p.notas.some((n) => n.peca === peca && Math.abs(n.em - t) < 1e-6);
  const notas = tem ? p.notas.filter((n) => !(n.peca === peca && Math.abs(n.em - t) < 1e-6))
    : [...p.notas, {peca, em: t, ...(forca && forca !== 100 ? {forca} : {})}].sort((x, y) => x.em - y.em || String(x.peca).localeCompare(String(y.peca)));
  return {patch: [{op: 'test', path: `/padroes/${i}/id`, value: p.id}, {op: 'replace', path: `/padroes/${i}/notas`, value: notas}],
    rotulo: `${tem ? 'tira' : 'põe'} ${peca} em ${posicaoEmCompasso(t, doc.compasso)}`, caminho: `/padroes/${i}/notas`};
};

// ---------- padrões, canais e kits ----------
export type PedidoPadrao = {canal: string; nome?: string; dur?: number; passos?: number; clonar?: string; estilo?: string; no_arranjo?: {em?: number; dur?: number}};

/** Padrão novo num canal (o canal de bateria nasce, com a faixa do mixer, se não existir): vazio, clonado ou de um
 *  estilo da casa; com no_arranjo, também o clipe que o toca. */
export const criarPadrao = (doc: DocMusica, a: PedidoPadrao): Edicao => {
  const bpc = batidasPorCompasso(doc.compasso);
  const patch: OperacaoPatch[] = [];
  let canal = doc.canais.find((c) => c.id === a.canal);
  if (!canal) {
    if (!/^[a-z0-9_-]{1,40}$/i.test(a.canal)) throw new Error('o id do canal novo é curto, sem espaço (ex.: bateria, bateria-2)');
    canal = {id: a.canal, nome: a.canal.charAt(0).toUpperCase() + a.canal.slice(1).replace(/[-_]/g, ' '), tipo: 'bateria', faixa_mixer: a.canal, kit: 'eletronico'};
    patch.push({op: 'add', path: '/canais/-', value: canal});
    if (!doc.mixer.faixas.some((f) => f.id === a.canal)) patch.push({op: 'add', path: '/mixer/faixas/-', value: novaFaixaMixer(a.canal, canal.nome)});
  } else if (canal.tipo !== 'bateria') {
    throw new Error(`${a.canal} é um canal de áudio; padrões são de canais de bateria`);
  }
  const id = idLivre('p', doc.padroes.map((p) => p.id));
  let notas: NotaMusica[] = [];
  let dur = a.dur ?? bpc;
  if (a.clonar) {
    const fonte = doc.padroes.find((p) => p.id === a.clonar);
    if (!fonte) throw new Error(`padrão não achado: ${a.clonar}`);
    notas = structuredClone(fonte.notas);
    dur = a.dur ?? fonte.dur ?? bpc;
  } else if (a.estilo) {
    const e = padraoDoEstilo(a.estilo, bpc);
    notas = e.notas;
    dur = a.dur ?? e.dur;
  }
  const estilo = a.estilo ? ESTILOS.find((e) => e.id === a.estilo) : undefined;
  const novo: PadraoMusica = {id, nome: a.nome ?? estilo?.nome ?? (a.clonar ? `${doc.padroes.find((p) => p.id === a.clonar)?.nome ?? a.clonar} (cópia)` : `Padrão ${doc.padroes.length + 1}`),
    canal: canal.id, dur, passos: a.passos ?? Math.max(1, Math.round(dur * 4)), notas};
  patch.push({op: 'add', path: '/padroes/-', value: novo});
  let clipe: string | undefined;
  if (a.no_arranjo) {
    clipe = idLivre('c', doc.arranjo.clipes.map((c) => c.id));
    const em = arredondarBatida(a.no_arranjo.em ?? fimDoCanal(doc, canal.id));
    patch.push({op: 'add', path: '/arranjo/clipes/-', value: {id: clipe, canal: canal.id, em, dur: arredondarBatida(a.no_arranjo.dur ?? dur), padrao: id} satisfies ClipeMusica});
  }
  return {patch, rotulo: `padrão ${novo.nome}`, caminho: `/padroes/${doc.padroes.length}`, extra: {padrao: id, notas: notas.length, ...(clipe ? {clipe} : {})}};
};

/** Troca as notas de um padrão pelas de um estilo da casa (o "Estilo…" do sequenciador). */
export const aplicarEstilo = (doc: DocMusica, padrao: string, estilo: string): Edicao => {
  const i = doc.padroes.findIndex((p) => p.id === padrao);
  if (i < 0) throw new Error(`padrão não achado: ${padrao}`);
  const e = padraoDoEstilo(estilo, doc.padroes[i].dur ?? batidasPorCompasso(doc.compasso));
  return {patch: [{op: 'test', path: `/padroes/${i}/id`, value: padrao}, {op: 'replace', path: `/padroes/${i}/notas`, value: e.notas}],
    rotulo: `estilo ${ESTILOS.find((x) => x.id === estilo)?.nome ?? estilo} em ${doc.padroes[i].nome ?? padrao}`, caminho: `/padroes/${i}/notas`};
};

export const trocarKit = (doc: DocMusica, canal: string, kit: string): Edicao => {
  const i = doc.canais.findIndex((c) => c.id === canal);
  if (i < 0) throw new Error(`canal não achado: ${canal}`);
  if (doc.canais[i].tipo !== 'bateria') throw new Error(`${canal} não é um canal de bateria`);
  if (!KITS.some((k) => k.id === kit)) throw new Error(`kit desconhecido: ${kit} (kits: ${KITS.map((k) => k.id).join(', ')})`);
  return {patch: [{op: 'test', path: `/canais/${i}/id`, value: canal}, {op: doc.canais[i].kit === undefined ? 'add' : 'replace', path: `/canais/${i}/kit`, value: kit}],
    rotulo: `kit ${kit} em ${canal}`, caminho: `/canais/${i}`, extra: {sem_som: []}};
};

/** Canal de áudio novo com um clipe do arquivo, no fim do arranjo (a duração em segundos vira batidas). */
export const novoCanalDeAudio = (doc: DocMusica, audio: string, duracao_s: number, nome?: string): Edicao => {
  const id = idLivre('audio', doc.canais.map((c) => c.id));
  const canal: CanalMusica = {id, nome: nome ?? audio.split('/').pop() ?? id, tipo: 'audio', faixa_mixer: id};
  const clipe = idLivre('c', doc.arranjo.clipes.map((c) => c.id));
  const em = 0;
  return {
    patch: [
      {op: 'add', path: '/canais/-', value: canal},
      {op: 'add', path: '/mixer/faixas/-', value: novaFaixaMixer(id, canal.nome)},
      {op: 'add', path: '/arranjo/clipes/-', value: {id: clipe, canal: id, em, dur: arredondarBatida(Math.max(1 / 16, duracao_s / segPorBatida(doc.bpm))), audio, corte_s: 0, ganho_db: 0} satisfies ClipeMusica},
    ],
    rotulo: `canal de áudio ${canal.nome}`, caminho: `/canais/${doc.canais.length}`, extra: {canal: id, clipe},
  };
};
