// Cortes pela fala (frente Fala, rodada 3; docs/legendas.md, "Cortes pela fala"): tirar os silêncios longos e as
// palavras de preenchimento ("ãh", "hum") da narração, pelo palavras.json. Regras: nenhuma borda de corte a menos de
// 80 ms de uma palavra que fica (o corte nunca pega um pedaço de palavra), e cada emenda com crossfade de 8 ms (entre 5
// e 10), para não estalar. O render muda o volume por pacote e não emenda áudio, então a emenda é um WAV novo
// (src/main/cortes-fala.ts grava; aqui está a conta, pura, para o núcleo, o MCP e os testes). O clipe passa a tocar o WAV
// emendado e guarda em `cortes_fala` de onde veio, para voltar; as legendas do clipe andam junto, e a palavra cortada
// sai delas.
import type {AudioCenas, ClipeAudio} from './audio';
import type {OperacaoPatch} from './documentos';
import {arquivoDaFala, arquivoDasPalavras, palavrasDe, type LegendasCenas, type OrigemLegendas, type PalavraLegenda, type SegmentoLegenda} from './legendas';

export type MotivoCorte = 'silencio' | 'preenchimento' | 'pedido';
/** Um corte em ms do arquivo de áudio: tira [de_ms, ate_ms). */
export type CorteFala = {de_ms: number; ate_ms: number; motivo?: MotivoCorte; texto?: string};
/** O que o clipe guarda depois dos cortes: o arquivo e os campos de antes, para voltar. */
export type CortesFalaClipe = {fonte: string; cortes: {de_ms: number; ate_ms: number}[]; corte_ms?: number; duracao_ms: number; original?: string;
  limpeza?: ClipeAudio['limpeza']};

export const MARGEM_PALAVRA_MS = 80; // nenhuma borda de corte mais perto que isto de uma palavra que fica
export const CROSSFADE_MS = 8; // emenda sem estalo: de 5 a 10 ms
export const SILENCIO_MIN_MS = 700; // pausa acima disto vira corte
export const PAUSA_MANTIDA_MS = 300; // e fica com esta pausa (a mesma que abre legenda nova)
const CORTE_MIN_MS = 60; // corte menor que isto não vale a emenda

/** Palavras de preenchimento que o whisper às vezes escreve ("ãh", "hum", "éé"). "é", "né", "tipo" e "então" ficam: têm
 *  sentido na fala jurídica e cortar mudaria o que foi dito. */
export const PREENCHIMENTO = /^(ã+h*|a+h+n?|é{2,}|e+h+|hu+m+|h+m+|u+h+m*|hã+|ahn)$/i;
export const ehPreenchimento = (w: string) => PREENCHIMENTO.test(w.replace(/^[¿¡"'“(]+|[,.;:!?…"'”)]+$/g, ''));

export type OpcoesCortes = {
  inicio_ms?: number; // o trecho do arquivo que o clipe toca (padrão: tudo)
  fim_ms?: number;
  silencio_min_ms?: number;
  pausa_ms?: number;
  margem_ms?: number;
  preenchimento?: boolean; // cortar palavras de preenchimento (padrão: sim)
  pontas?: boolean; // cortar o silêncio antes da primeira palavra e depois da última (padrão: sim)
};

/** Os cortes que a fala sugere: cada pausa acima de `silencio_min_ms` fica com `pausa_ms`, e a palavra de preenchimento
 *  sai junto com a pausa em volta dela; o silêncio das pontas do trecho também. Nenhuma borda fica a menos de
 *  `margem_ms` de uma palavra que fica; o preenchimento perto demais de uma palavra fica onde está. */
export const proporCortes = (todas: PalavraLegenda[], o: OpcoesCortes = {}): CorteFala[] => {
  const margem = o.margem_ms ?? MARGEM_PALAVRA_MS;
  const pausa = o.pausa_ms ?? PAUSA_MANTIDA_MS;
  const silencioMin = Math.max(o.silencio_min_ms ?? SILENCIO_MIN_MS, pausa + CORTE_MIN_MS);
  const ini = o.inicio_ms ?? 0;
  const fim = o.fim_ms ?? Infinity;
  const ws = todas.filter((p) => Number.isFinite(p.s) && Number.isFinite(p.e) && (p.s + p.e) / 2 >= ini && (p.s + p.e) / 2 < fim).sort((a, b) => a.s - b.s);
  if (!ws.length) return [];
  const preench = new Set(o.preenchimento === false ? [] : ws.filter((p) => ehPreenchimento(p.w)));
  // o preenchimento que não dá para tirar inteiro, longe das vizinhas, vira palavra que fica (e a conta recomeça)
  const ficam = new Set(ws.filter((p) => !preench.has(p)));
  // primeiro índice de ws com s >= x (ws está ordenada por s)
  const desde = (x: number) => {
    let lo = 0;
    let hi = ws.length;
    while (lo < hi) {
      const meio = (lo + hi) >> 1;
      if (ws[meio].s < x) lo = meio + 1;
      else hi = meio;
    }
    return lo;
  };
  const cortes: CorteFala[] = [];
  // a cada volta, todos os preenchimentos "presos" (perto demais das vizinhas) passam a ficar de uma vez; a condição é
  // monotônica, então o ponto fixo é o mesmo de marcar um por volta, com bem menos voltas
  for (let volta = 0; volta < ws.length + 1; volta++) {
    cortes.length = 0;
    const kept = ws.filter((p) => ficam.has(p));
    let mudou = false;
    const m = Math.max(margem, pausa / 2);
    for (let i = 0; i + 1 < kept.length; i++) {
      const a = kept[i];
      const b = kept[i + 1];
      const dentro: PalavraLegenda[] = [];
      for (let q = desde(a.e); q < ws.length && ws[q].s <= b.s; q++) {
        const p = ws[q];
        if (preench.has(p) && !ficam.has(p) && p.e <= b.s) dentro.push(p);
      }
      const de = a.e + m;
      const ate = b.s - m;
      const presos = dentro.filter((p) => p.s < de || p.e > ate);
      if (presos.length) {
        presos.forEach((p) => ficam.add(p));
        mudou = true;
        continue;
      }
      if (mudou) continue; // esta volta vai ser refeita: não vale montar corte
      if ((dentro.length || b.s - a.e >= silencioMin) && ate - de >= CORTE_MIN_MS) {
        cortes.push({de_ms: Math.round(de), ate_ms: Math.round(ate), motivo: dentro.length ? 'preenchimento' : 'silencio', ...(dentro.length ? {texto: dentro.map((p) => p.w).join(' ')} : {})});
      }
    }
    if (mudou) continue;
    // as pontas: o silêncio antes da primeira palavra e depois da última fica com meia pausa
    if (o.pontas !== false && kept.length) {
      const lead = Math.max(margem, pausa / 2);
      const primeira = kept[0];
      const ultima = kept[kept.length - 1];
      const antes = ws.filter((p) => preench.has(p) && !ficam.has(p) && p.e <= primeira.s);
      if (antes.some((p) => p.s < ini)) antes.forEach((p) => ficam.add(p));
      if (primeira.s - lead - ini >= CORTE_MIN_MS && (antes.length || primeira.s - ini >= silencioMin)) {
        cortes.unshift({de_ms: Math.round(ini), ate_ms: Math.round(primeira.s - lead), motivo: antes.length ? 'preenchimento' : 'silencio',
          ...(antes.length ? {texto: antes.map((p) => p.w).join(' ')} : {})});
      }
      const depois = ws.filter((p) => preench.has(p) && !ficam.has(p) && p.s >= ultima.e);
      if (Number.isFinite(fim) && fim - (ultima.e + lead) >= CORTE_MIN_MS && (depois.length || fim - ultima.e >= silencioMin)) {
        cortes.push({de_ms: Math.round(ultima.e + lead), ate_ms: Math.round(fim), motivo: depois.length ? 'preenchimento' : 'silencio',
          ...(depois.length ? {texto: depois.map((p) => p.w).join(' ')} : {})});
      }
    }
    break;
  }
  return juntarCortes(cortes);
};

/** Ordena e junta cortes que se tocam. */
export const juntarCortes = <C extends {de_ms: number; ate_ms: number}>(cortes: C[]): C[] => {
  const ord = [...cortes].filter((c) => c.ate_ms > c.de_ms).sort((a, b) => a.de_ms - b.de_ms);
  const out: C[] = [];
  for (const c of ord) {
    const u = out[out.length - 1];
    if (u && c.de_ms <= u.ate_ms) out[out.length - 1] = {...u, ate_ms: Math.max(u.ate_ms, c.ate_ms)};
    else out.push({...c});
  }
  return out;
};

/** O que há de errado nos cortes pedidos: borda a menos de `margem_ms` de uma palavra (ou no meio dela), corte fora do
 *  arquivo, corte curto demais. As palavras inteiras dentro de um corte saem (vão em `removidas`). */
export const conferirCortes = (palavras: PalavraLegenda[], cortes: {de_ms: number; ate_ms: number}[], o: {margem_ms?: number; duracao_ms?: number} = {}) => {
  const margem = o.margem_ms ?? MARGEM_PALAVRA_MS;
  const problemas: string[] = [];
  const ord = [...cortes].sort((a, b) => a.de_ms - b.de_ms);
  ord.forEach((c, i) => {
    if (!(Number.isFinite(c.de_ms) && Number.isFinite(c.ate_ms)) || c.ate_ms - c.de_ms < CORTE_MIN_MS) {
      problemas.push(`o corte ${i + 1} (${c.de_ms} a ${c.ate_ms} ms) tem menos de ${CORTE_MIN_MS} ms`);
      return;
    }
    if (c.de_ms < 0 || (o.duracao_ms !== undefined && c.ate_ms > o.duracao_ms)) problemas.push(`o corte ${i + 1} sai do arquivo`);
    if (i && c.de_ms < ord[i - 1].ate_ms) problemas.push(`os cortes ${i} e ${i + 1} se sobrepõem`);
    for (const borda of [c.de_ms, c.ate_ms]) {
      if (borda <= 0 || (o.duracao_ms !== undefined && borda >= o.duracao_ms)) continue; // a ponta do arquivo não emenda
      const perto = palavras.find((p) => borda > p.s - margem && borda < p.e + margem);
      if (perto) problemas.push(`a borda ${borda} ms do corte ${i + 1} fica a menos de ${margem} ms de "${perto.w}" (${perto.s} a ${perto.e} ms)`);
    }
  });
  const removidas = palavras.filter((p) => ord.some((c) => p.s >= c.de_ms && p.e <= c.ate_ms));
  return {problemas, removidas};
};

/** O tempo do arquivo emendado para um tempo do arquivo de antes: tira o que os cortes anteriores tiraram; dentro de um
 *  corte, cai no ponto da emenda. */
export const mapaDosCortes = (cortes: {de_ms: number; ate_ms: number}[]) => {
  const ord = juntarCortes(cortes);
  return (t: number) => {
    let tirado = 0;
    for (const c of ord) {
      if (t >= c.ate_ms) tirado += c.ate_ms - c.de_ms;
      else if (t > c.de_ms) return c.de_ms - tirado;
      else break;
    }
    return t - tirado;
  };
};

/** O caminho inverso: um tempo do arquivo emendado para o de antes (na emenda, o fim do corte). */
export const mapaInversoDosCortes = (cortes: {de_ms: number; ate_ms: number}[]) => {
  const ord = juntarCortes(cortes);
  return (t: number) => {
    let somado = 0;
    for (const c of ord) {
      if (t + somado >= c.de_ms) somado += c.ate_ms - c.de_ms;
      else break;
    }
    return t + somado;
  };
};

/** As palavras do arquivo emendado: as que ficam, no tempo novo. */
export const palavrasDepoisDosCortes = <P extends PalavraLegenda>(palavras: P[], cortes: {de_ms: number; ate_ms: number}[]): P[] => {
  const ord = juntarCortes(cortes);
  const mapa = mapaDosCortes(ord);
  return palavras.filter((p) => !ord.some((c) => p.s >= c.de_ms && p.e <= c.ate_ms)).map((p) => ({...p, s: Math.round(mapa(p.s)), e: Math.round(mapa(p.e))}));
};

// ---------- a emenda das amostras ----------

/** Emenda as amostras tirando os cortes (ms do arquivo), com crossfade de potência igual de `crossfade_ms` em cada emenda,
 *  centrado nela e tirado do silêncio dos dois lados (o corte fica a 80 ms das palavras, longe do crossfade). Na ponta
 *  do arquivo, uma rampa curta de entrada ou de saída. O tamanho final é o de antes menos os cortes, amostra a amostra. */
export const emendarCanais = (canais: Float32Array[], taxa: number, cortes: {de_ms: number; ate_ms: number}[], crossfade_ms = CROSSFADE_MS): Float32Array[] => {
  const n = canais[0]?.length ?? 0;
  const amostra = (ms: number) => Math.max(0, Math.min(n, Math.round((ms * taxa) / 1000)));
  const ord = juntarCortes(cortes).map((c) => ({de: amostra(c.de_ms), ate: amostra(c.ate_ms)})).filter((c) => c.ate > c.de);
  const total = n - ord.reduce((s, c) => s + c.ate - c.de, 0);
  const meio = Math.max(0, Math.round((crossfade_ms * taxa) / 2000)); // meia janela
  return canais.map((src) => {
    const out = new Float32Array(total);
    let o = 0;
    let lido = 0; // onde a parte que fica começa no arquivo de antes
    for (const c of ord) {
      out.set(src.subarray(lido, c.de), o);
      o += c.de - lido;
      lido = c.ate;
    }
    out.set(src.subarray(lido, n), o);
    if (!meio) return out;
    // crossfade em cada emenda: na saída, a emenda k fica em `ponto`; A é o que vinha (continua dentro do corte) e B o
    // que entra (começa antes do fim do corte)
    let ponto = 0;
    let anterior = 0;
    for (const c of ord) {
      ponto += c.de - anterior;
      anterior = c.ate;
      const aponta = c.de === 0 || c.ate === n;
      if (aponta) continue;
      const w = Math.min(meio, c.de, n - c.ate, Math.floor((c.ate - c.de) / 2));
      for (let k = -w; k < w; k++) {
        const t = (k + w + 0.5) / (2 * w);
        const ga = Math.cos((Math.PI / 2) * t);
        const gb = Math.sin((Math.PI / 2) * t);
        const pos = ponto + k;
        if (pos < 0 || pos >= total) continue;
        out[pos] = src[c.de + k] * ga + src[c.ate + k] * gb;
      }
    }
    // pontas cortadas: rampa curta para não começar nem acabar num degrau
    const rampa = Math.min(meio * 2, total);
    if (ord.some((c) => c.de === 0)) for (let k = 0; k < rampa; k++) out[k] *= (k + 0.5) / rampa;
    if (ord.some((c) => c.ate === n)) for (let k = 0; k < rampa; k++) out[total - 1 - k] *= (k + 0.5) / rampa;
    return out;
  });
};

// ---------- o documento: o clipe e as legendas dele ----------

/** O arquivo emendado: ao lado da fonte, com um código dos cortes (os mesmos cortes dão o mesmo arquivo). */
export const arquivoCortado = (fonte: string, cortes: {de_ms: number; ate_ms: number}[]) => {
  let h = 2166136261;
  for (const c of juntarCortes(cortes)) for (const ch of `${c.de_ms}-${c.ate_ms};`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return `${fonte}.cortes-${h.toString(16).padStart(8, '0')}.wav`;
};

/** As legendas do clipe depois dos cortes: cada palavra vai para o tempo novo (a que caiu num corte sai, do texto também),
 *  e a origem passa a ser o arquivo emendado, no lugar em que o clipe está. */
export const legendasDepoisDosCortes = (leg: LegendasCenas | undefined, clipe: ClipeAudio, cortes: {de_ms: number; ate_ms: number}[],
  novo: {arquivo: string; palavras: string; corte_ms: number; sha256?: string}): LegendasCenas | undefined => {
  if (!leg || !Array.isArray(leg.segmentos)) return leg;
  const o = (Array.isArray(leg.origens) ? leg.origens : []).find((x) => x.clipe === clipe.id);
  const ord = juntarCortes(cortes);
  const mapa = mapaDosCortes(ord);
  // tempo guardado da legenda → arquivo de antes → arquivo emendado → tempo do vídeo com a origem nova
  const ida = o ? (t: number) => t - o.em + (o.corte_ms ?? 0) : (t: number) => t - (Number(clipe.em) || 0) + (Number(clipe.corte_ms) || 0);
  const volta = (f: number) => (Number(clipe.em) || 0) + f - novo.corte_ms;
  const dentro = (p: {s: number; e: number}) => ord.some((c) => ida(p.s) >= c.de_ms && ida(p.e) <= c.ate_ms);
  const segmentos = leg.segmentos.flatMap((s): SegmentoLegenda[] => {
    if (s?.clipe !== clipe.id) return [s];
    const ps = palavrasDe(s);
    const ficam = ps.map((p, i) => [p, i] as const).filter(([p]) => !dentro(p));
    if (!ficam.length) return [];
    const palavras = ficam.map(([p]) => ({...p, s: Math.round(volta(mapa(ida(p.s)))), e: Math.round(volta(mapa(ida(p.e))))}));
    const tokens = s.texto.split(/\s+/).filter(Boolean);
    const texto = ficam.length === ps.length ? s.texto : ficam.map(([, i]) => tokens[i] ?? '').filter(Boolean).join(' ');
    const em = Math.round(volta(mapa(ida(s.em))));
    const sai = Math.max(Math.round(volta(mapa(ida(s.sai)))), palavras[palavras.length - 1].e);
    return [{...s, texto, palavras, em: Math.min(em, palavras[0].s), sai}];
  });
  const origem: OrigemLegendas = {clipe: clipe.id, arquivo: novo.arquivo, palavras: novo.palavras, em: Number(clipe.em) || 0, corte_ms: novo.corte_ms,
    ...(novo.sha256 ? {sha256: novo.sha256} : {})};
  const origens = Array.isArray(leg.origens) ? [...leg.origens.filter((x) => x.clipe !== clipe.id), ...(o ? [origem] : [])] : undefined;
  return {...leg, segmentos, ...(origens ? {origens} : {})};
};

/** O clipe depois dos cortes: toca o arquivo emendado, com o corte e a duração no tempo novo, e guarda o de antes. O
 *  `original` e a `limpeza` (voz limpa) vão para dentro de `cortes_fala`: a fala do clipe passa a ser a do arquivo
 *  emendado, que tem o palavras.json dele. */
export const clipeDepoisDosCortes = (clipe: ClipeAudio, cortes: {de_ms: number; ate_ms: number}[], arquivo: string): ClipeAudio => {
  const ord = juntarCortes(cortes);
  const mapa = mapaDosCortes(ord);
  const corte = Number(clipe.corte_ms) || 0;
  const fim = corte + (Number(clipe.duracao_ms) || 0);
  const antes = clipe.cortes_fala;
  const {original, limpeza, ...resto} = clipe;
  const guardado: CortesFalaClipe = antes
    ? {...antes, cortes: juntarCortes([...antes.cortes.map((c) => ({...c})), ...ord.map((c) => ({de_ms: Math.round(mapaInversoDosCortes(antes.cortes)(c.de_ms)),
      ate_ms: Math.round(mapaInversoDosCortes(antes.cortes)(c.ate_ms))}))])}
    : {fonte: clipe.arquivo, cortes: ord.map((c) => ({de_ms: c.de_ms, ate_ms: c.ate_ms})), ...(clipe.corte_ms !== undefined ? {corte_ms: clipe.corte_ms} : {}),
      duracao_ms: clipe.duracao_ms, ...(original ? {original} : {}), ...(limpeza ? {limpeza} : {})};
  const novoCorte = Math.round(mapa(corte));
  const {corte_ms: _k, ...semCorte} = resto;
  return {...semCorte, arquivo, ...(novoCorte ? {corte_ms: novoCorte} : {}), duracao_ms: Math.max(100, Math.round(mapa(fim) - novoCorte)), cortes_fala: guardado};
};

/** O clipe de volta ao arquivo de antes dos cortes (o primeiro, se houve mais de uma rodada). */
export const clipeSemCortes = (clipe: ClipeAudio): ClipeAudio | null => {
  const c = clipe.cortes_fala;
  if (!c) return null;
  const {cortes_fala: _c, corte_ms: _k, ...resto} = clipe;
  return {...resto, arquivo: c.fonte, ...(c.corte_ms !== undefined ? {corte_ms: c.corte_ms} : {}), duracao_ms: c.duracao_ms, ...(c.original ? {original: c.original} : {}),
    ...(c.limpeza ? {limpeza: c.limpeza} : {})};
};

/** As legendas do clipe de volta ao tempo de antes dos cortes (as palavras cortadas não voltam). */
export const legendasSemCortes = (leg: LegendasCenas | undefined, clipe: ClipeAudio, semCortes: ClipeAudio, palavras: string): LegendasCenas | undefined => {
  const c = clipe.cortes_fala;
  if (!leg || !Array.isArray(leg.segmentos) || !c) return leg;
  const o = (Array.isArray(leg.origens) ? leg.origens : []).find((x) => x.clipe === clipe.id);
  const inverso = mapaInversoDosCortes(c.cortes);
  const ida = o ? (t: number) => t - o.em + (o.corte_ms ?? 0) : (t: number) => t - (Number(clipe.em) || 0) + (Number(clipe.corte_ms) || 0);
  const corte = Number(semCortes.corte_ms) || 0;
  const volta = (f: number) => (Number(clipe.em) || 0) + f - corte;
  const t = (x: number) => Math.round(volta(inverso(ida(x))));
  const segmentos = leg.segmentos.map((s) => (s?.clipe !== clipe.id ? s
    : {...s, em: t(s.em), sai: t(s.sai), ...(Array.isArray(s.palavras) ? {palavras: s.palavras.map((p) => ({...p, s: t(p.s), e: t(p.e)}))} : {})}));
  const origens = Array.isArray(leg.origens)
    ? leg.origens.map((x) => (x.clipe === clipe.id ? {clipe: clipe.id, arquivo: c.original ?? c.fonte, palavras, em: Number(clipe.em) || 0, corte_ms: corte} : x))
    : undefined;
  return {...leg, segmentos, ...(origens ? {origens} : {})};
};

/** O clipe de voz pelo id, com a faixa e o caminho no documento. */
export const acharClipe = (audio: AudioCenas | undefined, id: string) => {
  const faixas = Array.isArray(audio?.faixas) ? audio.faixas : [];
  for (const [f, faixa] of faixas.entries()) {
    const clipes = Array.isArray(faixa.clipes) ? faixa.clipes : [];
    const c = clipes.findIndex((x) => x?.id === id);
    if (c >= 0) return {clipe: clipes[c], faixa, caminho: `/audio/faixas/${f}/clipes/${c}`};
  }
  return null;
};

// ---------- o patch (a tela e o MCP usam igual) ----------

/** O patch que aplica os cortes já gravados (`r`, do emendarArquivo): o clipe passa a tocar o arquivo emendado e as
 *  legendas dele andam junto. Vai para o diário: Ctrl+Z e Reverter desfazem. */
export const patchDosCortes = (doc: {audio?: AudioCenas; legendas?: LegendasCenas}, clipeId: string, cortes: {de_ms: number; ate_ms: number}[],
  r: {arquivo: string; palavras: string; sha256?: string}): OperacaoPatch[] => {
  const achado = acharClipe(doc.audio, clipeId);
  if (!achado) throw new Error(`clipe não achado: ${clipeId}`);
  const {clipe, caminho} = achado;
  const novo = clipeDepoisDosCortes(clipe, cortes, r.arquivo);
  const ops: OperacaoPatch[] = [{op: 'test', path: `${caminho}/id`, value: clipeId}, {op: 'replace', path: caminho, value: novo}];
  if (doc.legendas) {
    ops.push({op: 'replace', path: '/legendas', value: legendasDepoisDosCortes(doc.legendas, clipe, cortes, {arquivo: r.arquivo, palavras: r.palavras,
      corte_ms: Number(novo.corte_ms) || 0, sha256: r.sha256})});
  }
  return ops;
};

/** O patch que volta o clipe ao arquivo de antes dos cortes (e as legendas dele ao tempo de antes); null se o clipe não
 *  tem cortes. */
export const patchSemCortes = (doc: {audio?: AudioCenas; legendas?: LegendasCenas}, clipeId: string): OperacaoPatch[] | null => {
  const achado = acharClipe(doc.audio, clipeId);
  if (!achado) throw new Error(`clipe não achado: ${clipeId}`);
  const sem = clipeSemCortes(achado.clipe);
  if (!sem) return null;
  const ops: OperacaoPatch[] = [{op: 'test', path: `${achado.caminho}/id`, value: clipeId}, {op: 'replace', path: achado.caminho, value: sem}];
  if (doc.legendas) ops.push({op: 'replace', path: '/legendas', value: legendasSemCortes(doc.legendas, achado.clipe, sem, arquivoDasPalavras(arquivoDaFala(sem)))});
  return ops;
};

/** O que o clipe toca do arquivo (ms do arquivo): para propor os cortes só no trecho que se ouve. */
export const trechoDoClipe = (c: ClipeAudio) => ({inicio_ms: Number(c.corte_ms) || 0, fim_ms: (Number(c.corte_ms) || 0) + (Number(c.duracao_ms) || 0)});
