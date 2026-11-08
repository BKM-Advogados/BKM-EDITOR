// Música ↔ vídeo, sem disco: achar o clipe de áudio do vídeo por id, o patch que liga um clipe a um documento de música
// (e o que volta ao original), o clipe novo do "Pôr no vídeo", o código do render (o mesmo documento dá sempre o mesmo
// arquivo) e a lista de clipes ligados que precisam trocar de render. Quem grava e renderiza chama estas funções:
// transicoes.ts, mcp-musica.ts, src/main/ipc-musica.ts e a ponte da prévia web. Ver docs/musica.md.
import type {ClipeAudio, FaixaAudio} from './audio';
import {PAPEIS, papelDe} from './audio';
import type {OperacaoPatch} from './documentos';
import type {DocCenas} from './cenas';
import {caminhoDoRender, partesDoSom, resolverMusica, type DocMusica} from './musica';

// ---------- código do render ----------
/** FNV-1a de 32 bits, com base própria: duas passadas com bases diferentes dão 16 hexadecimais. */
const fnv = (texto: string, base: number) => {
  let h = base >>> 0;
  for (let i = 0; i < texto.length; i++) h = Math.imul(h ^ texto.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, '0');
};

/** Código do som do documento: muda quando muda o que se ouve (não o título nem a voz guia). `assinatura` diz algo do
 *  arquivo de áudio (o tamanho), para regravar a mesma tomada com o mesmo nome refazer o render. */
export const codigoDoSom = (doc: DocMusica, assinatura: (arquivo: string) => string = () => '') => {
  const audios = [...new Set((doc.arranjo?.clipes ?? []).map((c) => c.audio).filter((a): a is string => Boolean(a)))].sort();
  const texto = JSON.stringify({som: partesDoSom(doc), audios: audios.map((a) => [a, assinatura(a)])});
  return fnv(texto, 0x811c9dc5) + fnv(texto, 0x01000193 ^ 0x5bd1e995);
};

export const renderDaMusica = (id: string, doc: DocMusica, assinatura?: (arquivo: string) => string) => ({
  arquivo: caminhoDoRender(id, codigoDoSom(doc, assinatura)),
  duracao_ms: Math.max(1, Math.round(resolverMusica(doc).musica.duracao_s * 1000)),
});

/** O render e a medida ao lado: midia/musica/x.<código>.wav → midia/musica/x.<código>.json. */
export const medidaDoRender = (arquivo: string) => arquivo.replace(/\.wav$/, '.json');
export const ehRenderDeMusica = (arquivo: string) => /^midia\/musica\/[^/]+\.[0-9a-f]{16}\.(wav|json)$/.test(arquivo);

// ---------- achar no vídeo ----------
/** Segmento de caminho: "@id" acha pelo id, número acha pela posição. */
const acharPor = <T extends {id: string}>(lista: T[], seg: string): number => (seg.startsWith('@') ? lista.findIndex((x) => x?.id === seg.slice(1)) : /^\d+$/.test(seg) ? (Number(seg) < lista.length ? Number(seg) : -1) : lista.findIndex((x) => x?.id === seg));

export type AlvoAudio = {faixa: FaixaAudio; fi: number; clipe?: ClipeAudio; ci?: number};

/** "/audio/faixas/@musica/clipes/@clipe-2" (ou com posições, ou só a faixa) no vídeo de cenas. */
export const acharAlvoAudio = (doc: DocCenas, caminho: string): AlvoAudio | null => {
  const m = /^\/audio\/faixas\/([^/]+)(?:\/clipes\/([^/]+))?\/?$/.exec(caminho);
  const faixas = doc.audio?.faixas;
  if (!m || !Array.isArray(faixas)) return null;
  const fi = acharPor(faixas, decodeURIComponent(m[1]));
  if (fi < 0) return null;
  const faixa = faixas[fi];
  if (!m[2]) return {faixa, fi};
  const clipes = Array.isArray(faixa.clipes) ? faixa.clipes : [];
  const ci = acharPor(clipes, decodeURIComponent(m[2]));
  return ci < 0 ? null : {faixa, fi, clipe: clipes[ci], ci};
};

/** O caminho estável, por id: "/audio/faixas/@musica/clipes/@clipe-2". */
export const caminhoPorId = (faixa: string, clipe?: string) => `/audio/faixas/@${faixa}${clipe ? `/clipes/@${clipe}` : ''}`;

/** O clipe de um id em qualquer faixa. */
export const acharClipePorId = (doc: DocCenas, id: string): AlvoAudio | null => {
  for (const [fi, faixa] of (doc.audio?.faixas ?? []).entries()) {
    const ci = (faixa.clipes ?? []).findIndex((c) => c.id === id);
    if (ci >= 0) return {faixa, fi, clipe: faixa.clipes[ci], ci};
  }
  return null;
};

// ---------- patches no vídeo ----------
/** Liga um clipe existente ao documento de música: o arquivo vira o render, o corte zera (o render começa onde o clipe
 *  começava), a duração vira a da música, e o áudio de antes fica em `musica_original` (só da primeira vez). */
export const patchLigarClipe = (a: Required<Pick<AlvoAudio, 'clipe' | 'ci'>> & AlvoAudio, idMusica: string, render: {arquivo: string; duracao_ms: number}): OperacaoPatch[] => {
  const c = a.clipe;
  const base = `/audio/faixas/${a.fi}/clipes/${a.ci}`;
  const trocar = (campo: string, valor: unknown, antes: unknown): OperacaoPatch[] =>
    antes === undefined ? [{op: 'add', path: `${base}/${campo}`, value: valor}] : antes === valor ? [] : [{op: 'replace', path: `${base}/${campo}`, value: valor}];
  return [
    {op: 'test', path: `${base}/id`, value: c.id},
    {op: 'test', path: `${base}/arquivo`, value: c.arquivo},
    ...trocar('arquivo', render.arquivo, c.arquivo),
    ...trocar('musica', idMusica, c.musica),
    ...(c.musica_original || c.musica ? [] : [{op: 'add' as const, path: `${base}/musica_original`, value: {arquivo: c.arquivo, ...(c.corte_ms ? {corte_ms: c.corte_ms} : {}), duracao_ms: c.duracao_ms}}]),
    ...(c.corte_ms ? [{op: 'replace' as const, path: `${base}/corte_ms`, value: 0}] : []),
    ...trocar('duracao_ms', render.duracao_ms, c.duracao_ms),
  ];
};

/** "Voltar ao original": o clipe toca de novo o áudio de antes e deixa de seguir a música (o documento fica). */
export const patchVoltarAoOriginal = (a: Required<Pick<AlvoAudio, 'clipe' | 'ci'>> & AlvoAudio): OperacaoPatch[] => {
  const c = a.clipe;
  const o = c.musica_original;
  if (!o) return [];
  const base = `/audio/faixas/${a.fi}/clipes/${a.ci}`;
  return [
    {op: 'test', path: `${base}/id`, value: c.id},
    {op: 'replace', path: `${base}/arquivo`, value: o.arquivo},
    {op: c.corte_ms === undefined ? 'add' : 'replace', path: `${base}/corte_ms`, value: o.corte_ms ?? 0},
    {op: 'replace', path: `${base}/duracao_ms`, value: o.duracao_ms},
    ...(c.musica !== undefined ? [{op: 'remove' as const, path: `${base}/musica`}] : []),
    {op: 'remove', path: `${base}/musica_original`},
  ];
};

/** Id livre para um clipe novo no vídeo ("musica-1", "musica-2"…), entre todos os clipes de todas as faixas. */
export const idDeClipeNovo = (doc: DocCenas, prefixo = 'musica') => {
  const usados = new Set((doc.audio?.faixas ?? []).flatMap((f) => (f.clipes ?? []).map((c) => c.id)));
  let n = 1;
  while (usados.has(`${prefixo}-${n}`)) n++;
  return `${prefixo}-${n}`;
};

/** "Pôr no vídeo": um clipe novo ligado à música, na faixa dada (cria a faixa do papel se o vídeo não tiver). Devolve o
 *  patch e onde o clipe fica. */
export const patchClipeNovo = (doc: DocCenas, o: {idMusica: string; nome?: string; faixa?: string; papel?: 'musica' | 'efeitos'; em_ms: number; render: {arquivo: string; duracao_ms: number}}) => {
  const faixas = doc.audio?.faixas ?? [];
  const papel = o.papel ?? 'musica';
  let fi = o.faixa ? faixas.findIndex((f) => f.id === o.faixa) : faixas.findIndex((f) => papelDe(f) === papel);
  const patch: OperacaoPatch[] = [];
  if (!doc.audio) patch.push({op: 'add', path: '/audio', value: {faixas: []}});
  if (fi < 0) {
    if (o.faixa) throw new Error(`a faixa ${o.faixa} não existe no vídeo`);
    const idFaixa = faixas.some((f) => f.id === PAPEIS[papel].id) ? `${PAPEIS[papel].id}-2` : PAPEIS[papel].id;
    patch.push({op: 'add', path: '/audio/faixas/-', value: {id: idFaixa, nome: PAPEIS[papel].nome_faixa, papel, volume: 1, clipes: [],
      ...(papel === 'musica' ? {ducking: {ativo: true, alvo_lu: 20, ataque_ms: 80, soltura_ms: 500}} : {})}});
    fi = faixas.length;
  }
  const id = idDeClipeNovo(doc);
  const clipe: ClipeAudio = {id, arquivo: o.render.arquivo, ...(o.nome ? {nome: o.nome} : {}), em: Math.max(0, Math.round(o.em_ms)), duracao_ms: o.render.duracao_ms, musica: o.idMusica};
  patch.push({op: 'add', path: `/audio/faixas/${fi}/clipes/-`, value: clipe});
  const idFaixa = (patch.find((p) => p.path === '/audio/faixas/-')?.value as FaixaAudio | undefined)?.id ?? faixas[fi].id;
  return {patch, clipe: id, faixa: idFaixa, caminho: caminhoPorId(idFaixa, id)};
};

/** Clipes do vídeo ligados à música `idMusica` que não tocam o render de agora: o patch de cada um troca o arquivo e,
 *  se o clipe tinha a duração da música de antes (`duracaoAnterior` do render que ele toca), a duração também. Clipe
 *  que a pessoa aparou no vídeo fica com a duração dela. */
export const patchAtualizarLigados = (doc: DocCenas, idMusica: string, render: {arquivo: string; duracao_ms: number}, duracaoAnterior: (arquivo: string) => number | undefined) => {
  const patch: OperacaoPatch[] = [];
  const clipes: string[] = [];
  const antigos: string[] = [];
  for (const [fi, f] of (doc.audio?.faixas ?? []).entries()) {
    for (const [ci, c] of (f.clipes ?? []).entries()) {
      if (c.musica !== idMusica || c.arquivo === render.arquivo) continue;
      antigos.push(c.arquivo);
      const base = `/audio/faixas/${fi}/clipes/${ci}`;
      const antes = duracaoAnterior(c.arquivo);
      const segue = antes === undefined || Math.abs(antes - c.duracao_ms) <= 1;
      patch.push({op: 'test', path: `${base}/id`, value: c.id}, {op: 'replace', path: `${base}/arquivo`, value: render.arquivo});
      if (segue && c.duracao_ms !== render.duracao_ms) patch.push({op: 'replace', path: `${base}/duracao_ms`, value: render.duracao_ms});
      clipes.push(c.id);
    }
  }
  return {patch, clipes, antigos};
};

/** Os cortes de cena do vídeo em ms (começo de cada cena depois da primeira): os marcadores que a Música mostra. */
export const cortesDoVideo = (doc: DocCenas): number[] => {
  const out: number[] = [];
  let t = 0;
  for (const c of doc.cenas ?? []) {
    if (t > 0) out.push(t);
    t += Math.max(0, typeof c.duracao_ms === 'number' ? c.duracao_ms : 0);
  }
  return out;
};
