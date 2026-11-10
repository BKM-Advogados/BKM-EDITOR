// Edição de clipes de áudio do vídeo de cenas, em JSON Patch (o mesmo caminho das outras edições: diário, desfazer, o
// Claude vê): dividir um clipe na cabeça, copiar e crossfade entre dois clipes. A interface (acoes-audio.ts) e o MCP
// (mcp-som.ts) chamam estas funções, então a pessoa e a IA fazem a mesma conta. Puro: sem disco, sem relógio.
//
// Dividir e copiar levam as legendas do clipe (docs/audio.md): o segmento que fica inteiro de um lado vai com aquele
// clipe, o que o corte atravessa é partido na palavra do corte (dividirSegmento), e o clipe novo ganha a `origem` do
// clipe de onde veio, para as legendas dele seguirem o clipe se ele for movido ou aparado depois.
import {dbDeGanho, DURACAO_CLIPE_MIN, ehCurvaFade, ganhoDeDb, mediana, nivelDeReferencia, novaFaixaAudio, novoAudioCenas, PAPEIS, papelDe, VOZ_SEM_MEDIDA_DB, type AudioP, type ClipeAudio, type CurvaFade, type Envelope, type FaixaAudio,
  type PapelFaixa} from './audio';
import {idLivre, resolverCenas, type DocCenas} from './cenas';
import type {OperacaoPatch} from './documentos';
import {formatoDoVideo} from './formatos';
import {arquivoDaFala, arquivoDasPalavras, deslocamentoDaLegenda, dividirSegmento, palavrasDe, type LegendasCenas, type OrigemLegendas, type SegmentoLegenda} from './legendas';

export type Recusa = {erro: string};
export const recusou = (x: unknown): x is Recusa => typeof (x as Recusa | null)?.erro === 'string';

/** Menor crossfade que vale a pena (abaixo disto é um clique, não uma transição). */
export const CROSSFADE_MIN_MS = 50;

const num = (v: unknown, padrao: number) => (typeof v === 'number' && Number.isFinite(v) ? v : padrao);
const r3 = (v: number) => Math.round(v * 1000) / 1000; // ms com três casas: a grade de quadros (33,333… ms) sem lixo de ponto flutuante
const seg = (ms: number) => (ms / 1000).toLocaleString('pt-BR', {maximumFractionDigits: 2});

export type ClipeAchado = {faixa: number; indice: number; f: FaixaAudio; c: ClipeAudio; caminho: string; caminhoFaixa: string};

/** O clipe pelo id, com a faixa dele e o caminho JSON Pointer; null se não estiver no documento. */
export const acharClipe = (doc: {audio?: {faixas?: FaixaAudio[]}}, id: string): ClipeAchado | null => {
  const faixas = Array.isArray(doc.audio?.faixas) ? doc.audio!.faixas! : [];
  for (let i = 0; i < faixas.length; i++) {
    const clipes = Array.isArray(faixas[i]?.clipes) ? faixas[i].clipes : [];
    const j = clipes.findIndex((c) => c?.id === id);
    if (j >= 0) return {faixa: i, indice: j, f: faixas[i], c: clipes[j], caminho: `/audio/faixas/${i}/clipes/${j}`, caminhoFaixa: `/audio/faixas/${i}`};
  }
  return null;
};

const todosOsClipes = (doc: {audio?: {faixas?: FaixaAudio[]}}) => (Array.isArray(doc.audio?.faixas) ? doc.audio!.faixas! : []).flatMap((f) => (Array.isArray(f?.clipes) ? f.clipes : []));

/** O id de um clipe novo: o do original com sufixo (n1 → n1-1), livre no documento inteiro. */
export const idDeClipeNovo = (doc: unknown, base: string) => idLivre(doc, base || 'clipe');

const semFadeDeSaida = (c: ClipeAudio): ClipeAudio => {
  const {fade_out_ms: _a, fade_out_curva: _b, ...resto} = c;
  return resto;
};
const semFadeDeEntrada = (c: ClipeAudio): ClipeAudio => {
  const {fade_in_ms: _a, fade_in_curva: _b, ...resto} = c;
  return resto;
};

// ---------- legendas que acompanham o clipe ----------

const legendasDe = (doc: DocCenas): LegendasCenas | undefined => (doc.legendas && Array.isArray(doc.legendas.segmentos) ? doc.legendas : undefined);
const temLegendas = (doc: DocCenas, id: string) => Boolean(legendasDe(doc)?.segmentos.some((s) => s?.clipe === id));

/** As operações que passam as legendas do clipe `c` para o clipe novo `idNovo` (que começa em `corteDoVideo`, tempo do vídeo
 *  em que o clipe é dividido). Cada segmento fica inteiro de um lado ou é partido na primeira palavra depois do corte. */
const legendasDaDivisao = (doc: DocCenas, c: ClipeAudio, idNovo: string, corteDoVideo: number): {ops: OperacaoPatch[]; movidas: number; partidas: number} => {
  const leg = legendasDe(doc)!;
  const origens = Array.isArray(leg.origens) ? leg.origens : [];
  const o = origens.find((x) => x.clipe === c.id);
  // o corte no tempo em que a legenda está guardada (a tela soma o quanto o clipe andou desde que ela nasceu)
  const corteGuardado = corteDoVideo - deslocamentoDaLegenda({clipe: c.id}, origens, todosOsClipes(doc));
  const usados: unknown[] = [doc];
  const novos: SegmentoLegenda[] = [];
  let movidas = 0;
  let partidas = 0;
  for (const s of leg.segmentos) {
    if (s?.clipe !== c.id) {
      novos.push(s);
      continue;
    }
    const ps = palavrasDe(s);
    const antes = ps.filter((p) => (p.s + Math.max(p.s, p.e)) / 2 < corteGuardado).length;
    if (antes >= ps.length) novos.push(s);
    else if (antes === 0) {
      novos.push({...s, clipe: idNovo});
      movidas++;
    } else {
      const id = idLivre(usados, 'leg');
      usados.push({id});
      const par = dividirSegmento(s, id, antes);
      if (!par) {
        novos.push(s);
        continue;
      }
      novos.push(par[0], {...par[1], clipe: idNovo});
      partidas++;
    }
  }
  const ops: OperacaoPatch[] = [{op: 'replace', path: '/legendas/segmentos', value: novos}];
  if (o) ops.push(Array.isArray(leg.origens) ? {op: 'add', path: '/legendas/origens/-', value: {...o, clipe: idNovo}} : {op: 'add', path: '/legendas/origens', value: [{...o, clipe: idNovo}]});
  return {ops, movidas, partidas};
};

/** As operações que copiam as legendas do clipe `c` para a cópia `copia` (que começa `desloca` ms depois). O tempo guardado
 *  das cópias já inclui o quanto o original andou e o deslocamento, e a origem da cópia é o lugar dela: o deslocamento
 *  começa em zero. */
const legendasDaCopia = (doc: DocCenas, c: ClipeAudio, copia: ClipeAudio): {ops: OperacaoPatch[]; n: number} => {
  const leg = legendasDe(doc)!;
  const origens = Array.isArray(leg.origens) ? leg.origens : [];
  const o = origens.find((x) => x.clipe === c.id);
  const mover = deslocamentoDaLegenda({clipe: c.id}, origens, todosOsClipes(doc)) + (num(copia.em, 0) - num(c.em, 0));
  const usados: unknown[] = [doc];
  const novos: SegmentoLegenda[] = [];
  for (const s of leg.segmentos) {
    if (s?.clipe !== c.id) continue;
    const id = idLivre(usados, 'leg');
    usados.push({id});
    novos.push({...structuredClone(s), id, clipe: copia.id, em: s.em + mover, sai: s.sai + mover,
      ...(Array.isArray(s.palavras) ? {palavras: s.palavras.map((p) => ({...p, s: p.s + mover, e: p.e + mover}))} : {})});
  }
  const arq = arquivoDaFala(c);
  const origemNova: OrigemLegendas = {...(o ?? {arquivo: arq, palavras: arquivoDasPalavras(arq)}), clipe: copia.id, em: num(copia.em, 0), corte_ms: num(copia.corte_ms, 0)};
  const ops: OperacaoPatch[] = [{op: 'replace', path: '/legendas/segmentos', value: [...leg.segmentos, ...novos]},
    Array.isArray(leg.origens) ? {op: 'add', path: '/legendas/origens/-', value: origemNova} : {op: 'add', path: '/legendas/origens', value: [origemNova]}];
  return {ops, n: novos.length};
};

// ---------- dividir ----------

export type Divisao = {
  patch: OperacaoPatch[];
  primeiro: ClipeAudio;
  segundo: ClipeAudio;
  caminho_segundo: string;
  /** o corte no tempo do vídeo (ms), já na grade de quadros */
  corte_ms: number;
  legendas: {levadas_ao_segundo: number; partidas: number};
  avisos: string[];
};

/** Divide o clipe `idClipe` em `t_ms` (tempo do vídeo, a cabeça). O corte cai na grade de quadros contada do começo do
 *  clipe: o Remotion põe cada clipe no quadro mais perto de `em` e pula `corte_ms` em quadros, e com o corte a um número
 *  inteiro de quadros as duas metades tocam, junto, exatamente o que o clipe inteiro tocava. A segunda metade nasce com
 *  id novo e leva o resto do clipe (arquivo, volume, mudo, voz limpa e o que ela mediu); o fade de entrada fica com a
 *  primeira e o de saída com a segunda. */
export const dividirClipe = (doc: DocCenas, idClipe: string, t_ms: number): Divisao | Recusa => {
  const a = acharClipe(doc, idClipe);
  if (!a) return {erro: `clipe não achado: ${idClipe}`};
  const c = a.c;
  const em = num(c.em, 0);
  const dur = num(c.duracao_ms, 0);
  const corte = num(c.corte_ms, 0);
  if (!Number.isFinite(t_ms)) return {erro: 'diga em que tempo do vídeo (ms) o clipe se divide'};
  const quadro = 1000 / formatoDoVideo(doc).fps;
  const d = r3(Math.round((t_ms - em) / quadro) * quadro);
  if (!(d >= DURACAO_CLIPE_MIN && dur - d >= DURACAO_CLIPE_MIN)) {
    return {erro: `o corte em ${seg(t_ms)} s não divide o clipe (de ${seg(em)} a ${seg(em + dur)} s): cada metade precisa de pelo menos ${DURACAO_CLIPE_MIN} ms`};
  }
  const avisos: string[] = [];
  const fi = num(c.fade_in_ms, 0);
  const fo = num(c.fade_out_ms, 0);
  if (fi > d) avisos.push(`o fade de entrada (${seg(fi)} s) passa do corte; fica só na primeira metade`);
  if (fo > dur - d) avisos.push(`o fade de saída (${seg(fo)} s) passa do corte; fica só na segunda metade`);

  const idNovo = idDeClipeNovo(doc, c.id);
  const primeiro = semFadeDeSaida(c);
  primeiro.duracao_ms = d;
  const segundo: ClipeAudio = {...semFadeDeEntrada(structuredClone(c)), id: idNovo, em: r3(em + d), corte_ms: r3(corte + d), duracao_ms: r3(dur - d)};
  const patch: OperacaoPatch[] = [
    {op: 'test', path: `${a.caminho}/id`, value: c.id},
    {op: 'replace', path: a.caminho, value: primeiro},
    {op: 'add', path: `${a.caminhoFaixa}/clipes/${a.indice + 1}`, value: segundo},
  ];
  let legendas = {levadas_ao_segundo: 0, partidas: 0};
  if (temLegendas(doc, c.id)) {
    const l = legendasDaDivisao(doc, c, idNovo, r3(em + d));
    patch.push(...l.ops);
    legendas = {levadas_ao_segundo: l.movidas, partidas: l.partidas};
  }
  return {patch, primeiro, segundo, caminho_segundo: `${a.caminhoFaixa}/clipes/${a.indice + 1}`, corte_ms: r3(em + d), legendas, avisos};
};

// ---------- copiar ----------

export type Copia = {patch: OperacaoPatch[]; copia: ClipeAudio; caminho_copia: string; legendas_copiadas: number};

/** Copia o clipe para a mesma faixa, logo depois do original (ou em `em_ms`), com id novo e as legendas dele. */
export const copiarClipe = (doc: DocCenas, idClipe: string, opcoes: {em_ms?: number} = {}): Copia | Recusa => {
  const a = acharClipe(doc, idClipe);
  if (!a) return {erro: `clipe não achado: ${idClipe}`};
  const c = a.c;
  const em = opcoes.em_ms === undefined ? r3(num(c.em, 0) + num(c.duracao_ms, 0)) : r3(opcoes.em_ms);
  if (!Number.isFinite(em) || em < 0) return {erro: 'a cópia começa em 0 ms do vídeo ou depois'};
  const copia: ClipeAudio = {...structuredClone(c), id: idDeClipeNovo(doc, c.id), em};
  const patch: OperacaoPatch[] = [
    {op: 'test', path: `${a.caminho}/id`, value: c.id},
    {op: 'add', path: `${a.caminhoFaixa}/clipes/${a.indice + 1}`, value: copia},
  ];
  let legendas_copiadas = 0;
  if (temLegendas(doc, c.id)) {
    const l = legendasDaCopia(doc, c, copia);
    patch.push(...l.ops);
    legendas_copiadas = l.n;
  }
  return {patch, copia, caminho_copia: `${a.caminhoFaixa}/clipes/${a.indice + 1}`, legendas_copiadas};
};

// ---------- crossfade ----------

export type ModoCrossfade = 'auto' | 'estender' | 'sobrepor';
export type Crossfade = {patch: OperacaoPatch[]; de: ClipeAudio; para: ClipeAudio; duracao_ms: number; curva: CurvaFade; avisos: string[]; mudancas: string[]};

/** A curva de quem não escolheu: potência igual para música e efeito (dois sons diferentes: no meio o nível fica o de
 *  antes), linear para voz (a mesma tomada dos dois lados soma o ganho). */
export const curvaPadraoDaFaixa = (f: FaixaAudio): CurvaFade => (papelDe(f) === 'voz' ? 'linear' : 'potencia');

/** Crossfade entre dois clipes da mesma faixa: o fim de `idDe` desce e o começo de `idPara` sobe durante `duracao_ms`, em
 *  que os dois tocam juntos. Para os dois se sobreporem por `duracao_ms`:
 *  - 'estender' usa a sobra do arquivo (primeiro a cauda do primeiro clipe, depois o começo do segundo): nada muda de lugar
 *    e a narração presa a eles continua no tempo;
 *  - 'sobrepor' puxa o segundo clipe para trás (ele acaba antes);
 *  - 'auto' (padrão) estende o que der e sobrepõe o resto, avisando. Sobreposição maior que a pedida encurta a cauda do
 *    primeiro. `arquivos`: a duração (ms) de cada arquivo de áudio medido, para saber a sobra; sem ela, só 'sobrepor' vale. */
export const crossfadeEntre = (doc: DocCenas, o: {de: string; para: string; duracao_ms: number; curva?: CurvaFade; modo?: ModoCrossfade},
  arquivos: Record<string, number | undefined> = {}): Crossfade | Recusa => {
  const x = acharClipe(doc, o.de);
  const y = acharClipe(doc, o.para);
  if (!x) return {erro: `clipe não achado: ${o.de}`};
  if (!y) return {erro: `clipe não achado: ${o.para}`};
  if (x.c.id === y.c.id) return {erro: 'escolha dois clipes diferentes'};
  if (x.faixa !== y.faixa) return {erro: 'os dois clipes precisam estar na mesma faixa'};
  const [pa, pb] = num(x.c.em, 0) <= num(y.c.em, 0) ? [x, y] : [y, x]; // o que começa antes é o que desce
  const D = r3(o.duracao_ms);
  if (!Number.isFinite(D) || D < CROSSFADE_MIN_MS) return {erro: `o crossfade dura pelo menos ${CROSSFADE_MIN_MS} ms`};
  const curva = o.curva === undefined ? curvaPadraoDaFaixa(pa.f) : o.curva;
  if (!ehCurvaFade(curva)) return {erro: `curva desconhecida: ${String(o.curva)} (vale linear, suave ou potencia)`};
  const modo = o.modo ?? 'auto';
  const A: ClipeAudio = structuredClone(pa.c);
  const B: ClipeAudio = structuredClone(pb.c);
  const durA = num(A.duracao_ms, 0);
  const durB = num(B.duracao_ms, 0);
  if (D > Math.min(durA, durB)) return {erro: `o crossfade de ${seg(D)} s não cabe no clipe mais curto (${seg(Math.min(durA, durB))} s)`};
  const avisos: string[] = [];
  const mudancas: string[] = [];
  const fimA = num(A.em, 0) + durA;
  const preciso = r3(D - (fimA - num(B.em, 0))); // quanto falta para os dois se sobreporem por D (negativo: já se sobrepõem mais)
  const separados = r3(num(B.em, 0) - fimA); // > 0: há um vazio entre eles

  if (preciso > 0.5) {
    if (modo === 'estender' && separados > 0.5) return {erro: `os clipes estão separados por ${seg(separados)} s: não há como estender até se tocarem; use o modo "sobrepor"`};
    let falta = preciso;
    if (modo !== 'sobrepor' && separados <= 0.5) {
      // 1) a cauda do primeiro clipe, se o arquivo tem mais áudio depois do corte dele
      const arq = arquivos[A.arquivo];
      const cauda = arq === undefined ? 0 : Math.max(0, r3(arq - (num(A.corte_ms, 0) + durA)));
      const daCauda = Math.min(falta, cauda);
      if (daCauda > 0) {
        A.duracao_ms = r3(durA + daCauda);
        falta = r3(falta - daCauda);
        mudancas.push(`o primeiro clipe ganhou ${seg(daCauda)} s no fim (o arquivo tem mais som depois dele)`);
      }
      // 2) o começo do segundo, se o corte dele deixou som para trás
      const cabeca = Math.min(falta, Math.max(0, num(B.corte_ms, 0)));
      if (cabeca > 0) {
        B.em = r3(num(B.em, 0) - cabeca);
        B.corte_ms = r3(num(B.corte_ms, 0) - cabeca);
        B.duracao_ms = r3(durB + cabeca);
        falta = r3(falta - cabeca);
        mudancas.push(`o segundo clipe ganhou ${seg(cabeca)} s no começo (o arquivo tem som antes dele)`);
      }
    }
    if (falta > 0.5) {
      if (modo === 'estender') {
        return {erro: `só há ${seg(preciso - falta)} s de som sobrando nos arquivos (faltam ${seg(falta)} s): use o modo "sobrepor" ou um crossfade mais curto`};
      }
      if (separados > 0.5) avisos.push(`os clipes estavam separados por ${seg(separados)} s; o segundo veio até o primeiro`);
      B.em = r3(num(B.em, 0) - falta);
      mudancas.push(`o segundo clipe veio ${seg(falta)} s para trás e acaba ${seg(falta)} s antes${modo === 'auto' ? ' (não havia som sobrando nos arquivos)' : ''}`);
    }
  } else if (preciso < -0.5) {
    // já se sobrepõem mais do que o pedido: a cauda do primeiro encurta, o segundo fica onde está
    A.duracao_ms = r3(durA + preciso);
    mudancas.push(`o primeiro clipe acabou ${seg(-preciso)} s antes, para a sobreposição ficar em ${seg(D)} s`);
  }
  if (num(A.duracao_ms, 0) < DURACAO_CLIPE_MIN) return {erro: 'o primeiro clipe ficaria com menos de 100 ms'};

  A.fade_out_ms = D;
  B.fade_in_ms = D;
  if (curva === 'linear') {
    delete A.fade_out_curva;
    delete B.fade_in_curva;
  } else {
    A.fade_out_curva = curva;
    B.fade_in_curva = curva;
  }
  const patch: OperacaoPatch[] = [
    {op: 'test', path: `${pa.caminho}/id`, value: pa.c.id},
    {op: 'test', path: `${pb.caminho}/id`, value: pb.c.id},
    {op: 'replace', path: pa.caminho, value: A},
    {op: 'replace', path: pb.caminho, value: B},
  ];
  return {patch, de: A, para: B, duracao_ms: D, curva, avisos, mudancas};
};

// ---------- efeito sonoro na medida da casa (som-D4) ----------

/** A casa mixa música e efeito de 18 a 23 LU abaixo da voz; o efeito novo entra no meio da faixa: 20 LU. */
export const EFEITO_ABAIXO_DA_VOZ_LU = 20;

/** A mediana da voz que toca (ponderação K, com o volume de faixa e de clipe), ou null se nenhum clipe de voz foi medido. */
export const nivelDaVoz = (audio: AudioP | undefined): number | null => {
  const niveis: number[] = [];
  for (const f of audio?.faixas ?? []) {
    if (f.papel !== 'voz' || f.mudo) continue;
    for (const c of f.clipes) if (!c.mudo && !c.fora && c.nivel_db !== undefined) niveis.push(c.nivel_db + dbDeGanho(f.volume * c.volume));
  }
  return mediana(niveis);
};

/** Volume (0,001 a 1, três casas) para o efeito de nível `efeito_db` (mediana, sem ganhos) ficar `lu` abaixo da voz. Sem voz
 *  medida, conta a voz típica de −20 dB; um efeito que já nasce mais baixo que o alvo fica a 100 % (não se sobe o volume). */
export const volumeDoEfeito = (efeito_db: number | null | undefined, voz_db: number | null, lu = EFEITO_ABAIXO_DA_VOZ_LU): number => {
  if (efeito_db === null || efeito_db === undefined) return 1;
  const v = ganhoDeDb((voz_db ?? VOZ_SEM_MEDIDA_DB) - lu - efeito_db);
  return Math.min(1, Math.max(0.001, Math.round(v * 1000) / 1000));
};

// ---------- clipe novo pelo MCP (adicionar_clipe_audio, escolher_trilha) ----------

export type ClipeNovo = {patch: OperacaoPatch[]; clipe: ClipeAudio; caminho: string; faixa: string; avisos: string[]};
const FADE_MUSICA_FINAL_MS = 1500;

/** Põe um arquivo de áudio do projeto numa faixa do papel pedido (a primeira do papel; sem ela, cria a faixa, e sem `audio`,
 *  as três). Sem `em_ms`, a música e a narração entram onde a faixa acaba (no zero, se vazia). A música vai até o fim do
 *  vídeo, com fade de saída; o efeito entra 20 LU abaixo da voz (som-D4). `duracao_ms` ou o envelope dão o tamanho do clipe. */
export const clipeNovoNaFaixa = (doc: DocCenas, o: {arquivo: string; papel: PapelFaixa; em_ms?: number; duracao_ms?: number; volume?: number; envelope?: Envelope; nome?: string},
  envelopes: Record<string, Envelope | undefined> = {}): ClipeNovo | Recusa => {
  const inteira = o.duracao_ms ?? o.envelope?.duracao_ms;
  if (inteira === undefined || !(inteira >= DURACAO_CLIPE_MIN)) return {erro: `diga duracao_ms (≥ ${DURACAO_CLIPE_MIN}): ${o.arquivo} ainda não foi medido e o MCP não decodifica áudio (o app mede ao abrir o vídeo)`};
  const props = resolverCenas(doc, {envelopes}).props;
  const duracaoVideo = props.duracao_ms;
  const avisos: string[] = [];
  const faixas = Array.isArray(doc.audio?.faixas) ? doc.audio!.faixas : null;
  const base = faixas ? null : novoAudioCenas();
  const lista = faixas ?? base!.faixas;
  let indice = lista.findIndex((f) => papelDe(f) === o.papel);
  let criarFaixa = false;
  if (indice < 0) {
    indice = lista.length;
    criarFaixa = true;
  }
  const faixa = criarFaixa ? novaFaixaAudio(o.papel, idLivre(doc, PAPEIS[o.papel].id)) : lista[indice];
  const clipes = Array.isArray(faixa.clipes) ? faixa.clipes : [];
  const fim = clipes.reduce((m, c) => Math.max(m, num(c.em, 0) + num(c.duracao_ms, 0)), 0);
  const em = r3(Math.max(0, o.em_ms ?? (o.papel === 'efeitos' || fim >= duracaoVideo - DURACAO_CLIPE_MIN ? 0 : fim)));
  const duracao = r3(o.papel === 'musica' && duracaoVideo > 0 ? Math.max(DURACAO_CLIPE_MIN, Math.min(inteira, duracaoVideo - em)) : inteira);
  const clipe: ClipeAudio = {id: idLivre(doc, 'clipe'), arquivo: o.arquivo, em, duracao_ms: duracao, ...(o.nome ? {nome: o.nome} : {})};
  if (o.papel === 'musica' && duracao > FADE_MUSICA_FINAL_MS * 2) clipe.fade_out_ms = FADE_MUSICA_FINAL_MS;
  if (o.volume !== undefined) clipe.volume = Math.min(1, Math.max(0, o.volume));
  else if (o.papel === 'efeitos' && o.envelope) {
    const v = volumeDoEfeito(nivelDeReferencia(o.envelope), nivelDaVoz(props.audio));
    if (v < 1) clipe.volume = v;
  }
  if (o.papel === 'musica') {
    const sobre = clipes.find((c) => num(c.em, 0) < em + duracao && num(c.em, 0) + num(c.duracao_ms, 0) > em);
    if (sobre) avisos.push(`a música entra por cima de "${sobre.nome ?? sobre.arquivo}" (${seg(num(sobre.em, 0))} s a ${seg(num(sobre.em, 0) + num(sobre.duracao_ms, 0))} s): faça um crossfade entre as duas, ou silencie uma`);
  }
  const caminhoFaixa = `/audio/faixas/${indice}`;
  if (base) {
    base.faixas[indice].clipes.push(clipe);
    return {patch: [{op: 'add', path: '/audio', value: base}], clipe, caminho: `${caminhoFaixa}/clipes/0`, faixa: base.faixas[indice].id, avisos};
  }
  if (criarFaixa) return {patch: [{op: 'add', path: caminhoFaixa, value: {...faixa, clipes: [clipe]}}], clipe, caminho: `${caminhoFaixa}/clipes/0`, faixa: faixa.id, avisos};
  const j = clipes.length;
  return {patch: [{op: 'test', path: `${caminhoFaixa}/id`, value: faixa.id}, Array.isArray(faixa.clipes) ? {op: 'add', path: `${caminhoFaixa}/clipes/${j}`, value: clipe} : {op: 'add', path: `${caminhoFaixa}/clipes`, value: [clipe]}],
    clipe, caminho: `${caminhoFaixa}/clipes/${j}`, faixa: faixa.id, avisos};
};
