// Resolve o roteiro.json do vídeo (cenas e blocos ancorados em palavras da narração) nas props da composição
// CarrosselTema, em ms de SAÍDA. Porte de scripts/preparar_carrossel.py (motor do Mac, 04/11/2026), com uma diferença:
// a narração não é regravada com ffmpeg; sai como trechos do vídeo-fonte que a composição toca em sequência, com os
// respiros entre eles. Assim mudar uma pausa não exige reprocessar áudio.
//
// Âncora "palavra@ms": a primeira palavra que começa com `palavra` a partir de `ms` do vídeo-fonte (sem diferença de
// acento, caixa ou pontuação), com deslocamento opcional ("multa@16000+120") e "$" para ancorar no fim da palavra.

import {acharPalavra, ErroRoteiro, lerAncora, palavrasPerto, type Palavra} from '../ancora-palavra';
import {temaDoCarrossel} from './tema';

// a âncora mora em ancora-palavra.ts (o vídeo de cenas usa a mesma); quem já importava daqui continua importando
export {ErroRoteiro, lerAncora, norm, type Palavra} from '../ancora-palavra';

export const ABERTURA_MS = 1600; // vinheta do logo antes da narração
export const FINAL_MS = 3500; // cartão final parado depois da narração
export const PAUSA_GANCHO = 1200; // transição depois do gancho
export const PAUSA_PARTE = 500;
export const MARCA_VAZIA = {nome: '', site: '', insta: ''};
export const FINAL_PADRAO = {titulo: 'SALVE E COMPARTILHE COM QUEM PRECISA', aviso: 'Conteúdo informativo. Não substitui a análise de cada caso.'};
export const DUVIDA_PADRAO = {pergunta: 'Ficou com alguma dúvida?', resposta: 'Procure um advogado trabalhista.'};

export type TrechoNarracao = {de: number; ate: number; em: number}; // ms do vídeo-fonte [de, ate) tocado em `em` (saída)
export type Som = {src: string; t: number; vol: number};

export type BlocoRoteiro = {id?: string; tipo: string; em?: string | number; sai?: string | number; y?: number; [k: string]: unknown};
export type CenaRoteiro = {
  id?: string;
  tipo: 'gancho' | 'parte' | 'duvida';
  inicio?: string;
  pausa?: number;
  blocos?: BlocoRoteiro[];
  [k: string]: unknown;
};
export type FotoRoteiro = {src: string; credito?: string};
export type Roteiro = {
  tema?: string; // nome do tema do carrossel (roteiro/tema.ts); o "c2" dos roteiros antigos vale o neutro
  fonte: string; // vídeo-fonte da narração (caminho no projeto)
  palavras: string; // transcrição com tempo por palavra (caminho no projeto)
  rotulo_partes: string;
  cenas: CenaRoteiro[];
  pausas?: {depois_de: string; ms: number}[];
  decisao?: {titulo: string; linha: string};
  marca?: {nome?: string; site?: string; insta?: string}; // quem assina: rodapé, vinheta sem logo e cartão final
  logo?: string; // arquivo em midia/ (sem "midia/")
  foto?: FotoRoteiro; // a foto dos blocos foto sem src, arquivo em midia/
  final?: {titulo?: string; aviso?: string};
  [k: string]: unknown;
};

/** O que o roteiro não diz e o projeto pode suprir: o logo e a foto padrão que estão em midia/ (ver sessao-projeto.ts). */
export type PadroesRoteiro = {logo?: string; foto?: FotoRoteiro};

const IMAGEM = /\.(png|jpe?g|webp|svg)$/i;
/** O logo e a foto padrão pelos arquivos da raiz de midia/: o logo é o primeiro "logo*" (o kit de marca copia como
 *  logo-<kit>.png); a foto, a primeira outra imagem. Sem crédito: quem quiser crédito põe `foto` no roteiro. */
export const padroesDaMidia = (arquivos: string[]): PadroesRoteiro => {
  const imagens = arquivos.filter((a) => IMAGEM.test(a) && !a.startsWith('.')).sort((x, y) => x.localeCompare(y));
  const logo = imagens.find((a) => /^logo/i.test(a));
  const foto = imagens.find((a) => !/^logo/i.test(a) && !a.endsWith('.svg'));
  return {...(logo ? {logo} : {}), ...(foto ? {foto: {src: foto}} : {})};
};

const texto = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
/** Só os campos de texto preenchidos de um objeto do roteiro (marca, final): o resto fica no padrão. */
const textos = (o: unknown): Record<string, string> =>
  Object.fromEntries(Object.entries(o && typeof o === 'object' ? o : {}).filter(([, v]) => texto(v)).map(([k, v]) => [k, (v as string).trim()]));

// round() do Python arredonda .5 para o par; o preparar_carrossel.py depende disso nos cortes.
export const arredondar = (x: number): number => {
  const piso = Math.floor(x);
  const resto = x - piso;
  if (Math.abs(resto - 0.5) > 1e-9) return Math.round(x);
  return piso % 2 === 0 ? piso : piso + 1;
};

export class Narracao {
  cortes: [number, number][] = [];
  constructor(readonly p: Palavra[]) {}

  indice(w: string, depois: number): number {
    const i = acharPalavra(this.p, w, depois);
    if (i >= 0) return i;
    throw new ErroRoteiro(`âncora não achada: '${w}' a partir de ${depois} ms. Perto: ${palavrasPerto(this.p, depois)}`);
  }

  corteAntes(i: number): number {
    return i > 0 ? arredondar((this.p[i - 1].e + this.p[i].s) / 2) : this.p[0].s;
  }

  corteDepois(i: number): number {
    const prox = i + 1 < this.p.length ? this.p[i + 1].s : this.p[i].e + 600;
    return arredondar((this.p[i].e + prox) / 2);
  }

  saida(ms: number): number {
    let soma = 0;
    for (const [c, p] of this.cortes) if (c <= ms) soma += p;
    return arredondar(ABERTURA_MS + ms + soma);
  }

  ancora(a: string): number {
    const m = lerAncora(a);
    const p = this.p[this.indice(m.w, m.ms)];
    return this.saida(m.fim ? p.e : p.s) + m.d;
  }
}

/** Troca as âncoras ("em", "sai") por ms de saída em qualquer nível do bloco. */
const resolver = (x: unknown, n: Narracao): unknown => {
  if (Array.isArray(x)) return x.map((v) => resolver(v, n));
  if (x && typeof x === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(x)) o[k] = (k === 'em' || k === 'sai') && typeof v === 'string' ? n.ancora(v) : resolver(v, n);
    return o;
  }
  return x;
};

const ems = (x: unknown): number[] => {
  if (Array.isArray(x)) return x.flatMap(ems);
  if (x && typeof x === 'object') {
    const o = x as Record<string, unknown>;
    const proprios = Object.entries(o)
      .filter(([k, v]) => k === 'em' && typeof v === 'number')
      .map(([, v]) => v as number);
    return [...proprios, ...Object.values(o).flatMap(ems)];
  }
  return [];
};

export const legendas = (palavras: Palavra[], saida: (ms: number) => number) => {
  const ps: Palavra[] = [];
  for (const p of palavras) {
    const w = p.w.trim();
    if ((w === '%' || w.startsWith('-')) && ps.length) {
      // o Whisper separa "40 %" e "seguro -desemprego"
      ps[ps.length - 1].w += w;
      ps[ps.length - 1].e = saida(p.e);
      continue;
    }
    ps.push({w, s: saida(p.s), e: saida(p.e)});
  }
  const blocos: Palavra[][] = [];
  let atual: Palavra[] = [];
  for (const p of ps) {
    atual.push(p);
    const ultima = p.w.slice(-1);
    if (atual.length >= 4 || (ultima !== '' && '.,?!'.includes(ultima))) {
      blocos.push(atual);
      atual = [];
    }
  }
  if (atual.length) blocos.push(atual);
  return blocos.map((b) => ({s: b[0].s, e: b[b.length - 1].e, palavras: b}));
};

export type Resolvido = {
  props: Record<string, unknown> & {duracao_ms: number; cenas: Record<string, unknown>[]};
  trechos: TrechoNarracao[];
  avisos: string[];
};

/** Resolve o roteiro. `padroes` traz o logo e a foto que o projeto tem, para o roteiro que não os cita. */
export const resolverRoteiro = (r: Roteiro, palavras: Palavra[], padroes: PadroesRoteiro = {}): Resolvido => {
  const avisos: string[] = [];
  const n = new Narracao(palavras);
  const cenasR = r.cenas;
  if (cenasR[0]?.tipo !== 'gancho' || cenasR[cenasR.length - 1]?.tipo !== 'duvida') {
    throw new ErroRoteiro('o roteiro começa no gancho e termina na dúvida');
  }

  // cortes: no começo de cada cena (o respiro fica no fim da cena anterior) e depois das frases de `pausas`
  const inicios: number[] = [];
  cenasR.slice(1).forEach((c, k0) => {
    const k = k0 + 1;
    if (!c.inicio) throw new ErroRoteiro(`a cena ${k + 1} (${c.tipo}) não tem "inicio"`);
    const m = lerAncora(c.inicio);
    const corte = n.corteAntes(n.indice(m.w, m.ms));
    n.cortes.push([corte, c.pausa ?? (k === 1 ? PAUSA_GANCHO : PAUSA_PARTE)]);
    inicios.push(corte);
  });
  for (const extra of r.pausas ?? []) {
    const m = lerAncora(extra.depois_de);
    n.cortes.push([n.corteDepois(n.indice(m.w, m.ms)), extra.ms]);
  }
  n.cortes.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const durFonte = palavras[palavras.length - 1].e + 500;
  const durNarr = ABERTURA_MS + durFonte + n.cortes.reduce((s, [, p]) => s + p, 0);

  // a narração tocada por trechos: [0, corte1), [corte1, corte2)... cada um depois da sua pausa
  const pontos = [0, ...n.cortes.map(([c]) => c), durFonte];
  const trechos: TrechoNarracao[] = [];
  let cursor = ABERTURA_MS;
  for (let i = 0; i < pontos.length - 1; i++) {
    trechos.push({de: pontos[i], ate: pontos[i + 1], em: cursor});
    cursor += pontos[i + 1] - pontos[i] + (i < n.cortes.length ? n.cortes[i][1] : 0);
  }

  const tIns = [ABERTURA_MS, ...inicios.map((c) => n.saida(c))];
  const tOuts = [...tIns.slice(1), durNarr];
  const cenas: Record<string, unknown>[] = [{tipo: 'abertura', t_in: 0, t_out: ABERTURA_MS, ev: {}}];
  let parte = 0;
  cenasR.forEach((c, ic) => {
    const tIn = tIns[ic];
    const tOut = tOuts[ic];
    const semInicio = Object.fromEntries(Object.entries(c).filter(([k]) => k !== 'inicio' && k !== 'pausa'));
    const cena = resolver(semInicio, n) as Record<string, unknown>;
    Object.assign(cena, {t_in: tIn, t_out: tOut, ev: {}});
    cena.origem = `/cenas/${ic}`;
    if (c.tipo === 'parte') {
      parte += 1;
      if (cena.n === undefined) cena.n = parte;
    }
    if (c.tipo === 'duvida') {
      // a cena de dúvida acompanha as palavras "ficou" e "procure" da narração, mas não depende delas (video-D6): sem uma
      // das duas, o vídeo monta do mesmo jeito, com o aviso, e a composição usa o começo da cena e +1,5 s
      const ini = lerAncora(c.inicio!).ms;
      const ev: Record<string, number> = {};
      for (const [campo, palavra] of [['duvida', 'ficou'], ['advogado', 'procure']] as const) {
        try {
          ev[campo] = n.ancora(`${palavra}@${ini}`);
        } catch (e) {
          if (!(e instanceof ErroRoteiro)) throw e;
          avisos.push(`cena de dúvida: não achei "${palavra}" na narração depois de ${ini} ms; a animação usa o tempo da cena`);
        }
      }
      cena.ev = ev;
    }
    const blocos = (cena.blocos ?? []) as Record<string, unknown>[];
    blocos.forEach((b, ib) => {
      b.origem = `/cenas/${ic}/blocos/${ib}`;
      if (b.em === undefined) {
        const aninhados = ems(b);
        b.em = aninhados.length ? Math.min(...aninhados) : tIn + 300;
      }
      const rotulo = `${String(c.tipo)} ${cena.n ?? ''}`.trim();
      if (b.y === undefined) {
        avisos.push(`bloco ${String(b.tipo)} sem y na cena ${rotulo}; vai em 600`);
        b.y = 600;
      }
      for (const e of [b.em as number, ...ems(b), (b.sai as number | undefined) ?? tIn]) {
        if (!(tIn - 100 <= e && e <= tOut + 100)) avisos.push(`tempo ${e} fora da cena ${rotulo} (${tIn}–${tOut}), bloco ${String(b.tipo)}`);
      }
    });
    cenas.push(cena);
  });
  cenas.push({tipo: 'final', t_in: durNarr, t_out: durNarr + FINAL_MS, ev: {}});

  const S = (nome: string, t: number, vol: number): Som => ({src: `sfx/${nome}`, t: Math.max(0, t), vol});
  const sons: Som[] = [S('whoosh.wav', 120, 0.55), S('impacto_grave.wav', 380, 0.28)];
  const pausa1 = cenasR[1]?.pausa ?? PAUSA_GANCHO;
  const t2 = cenas[2].t_in as number;
  sons.push(S('swell.wav', t2 - pausa1 - 100, 0.45), S('whoosh.wav', t2 - 250, 0.45));
  for (const c of cenas.slice(3, -1)) sons.push(S('whoosh.wav', (c.t_in as number) - 200, 0.22));
  let usaFoto = false;
  for (const c of cenas) {
    for (const b of (c.blocos ?? []) as Record<string, any>[]) {
      const tp = b.tipo;
      if (tp === 'itens') sons.push(...(b.itens as {em: number}[]).map((it) => S('pop.wav', it.em, 0.3)));
      else if (tp === 'comparacao') sons.push(...(b.barras as {em: number}[]).map((x) => S('pop.wav', x.em, 0.3)));
      else if (tp === 'numero' || tp === 'grande') sons.push(S('pop.wav', b.em, 0.3));
      else if (tp === 'carimbo') sons.push(S('carimbo_0.wav', b.em + 120, 0.5));
      else if (tp === 'documento') {
        sons.push(S('papel_desliza_0.wav', b.em, 0.35));
        if (b.carimbo) sons.push(S('carimbo_0.wav', b.carimbo.em + 120, 0.5));
      } else if (tp === 'foto') {
        if (!b.src) usaFoto = true; // foto própria do bloco (src e credito) dispensa a padrão (video-D7)
        sons.push(S('papel_desliza_0.wav', b.em + 60, 0.5));
      }
    }
  }
  sons.push(S('swell.wav', durNarr - 200, 0.4));
  sons.sort((a, b) => a.t - b.t);

  const props: Resolvido['props'] = {
    composicao: 'CarrosselTema',
    duracao_ms: durNarr + FINAL_MS,
    audio: 'narracao.wav',
    legendas: legendas(palavras, (ms) => n.saida(ms)),
    cenas,
    total_partes: parte,
    rotulo_partes: r.rotulo_partes,
    tema_carrossel: temaDoCarrossel(r.tema).id,
    marca: {...MARCA_VAZIA, ...textos(r.marca)},
    decisao: r.decisao ?? {titulo: 'Decisão de 1º grau · cabe recurso', linha: ''},
    final: {...FINAL_PADRAO, ...textos(r.final)},
    duvida: DUVIDA_PADRAO,
    sons,
  };
  const logo = texto(r.logo) ?? padroes.logo;
  if (logo) props.logo = logo;
  const foto = r.foto && texto(r.foto.src) ? r.foto : padroes.foto;
  if (usaFoto && foto) props.foto = {src: foto.src, credito: foto.credito ?? ''};
  return {props, trechos, avisos};
};
