// Acabamento do vídeo de cenas (Onda B, docs/carrossel-narrado.md): a vinheta do logo no começo, o rodapé com a marca
// durante as cenas, o cartão final e os efeitos sonoros de `midia/sfx/` nas trocas de cena e nas entradas, as quatro
// peças que o carrossel narrado (CarrosselTema) já desenha. Tudo opcional e desligado de fábrica: documento sem
// `acabamento` (ou com tudo desligado) resolve exatamente como antes. Só regras e números, sem React nem disco; a
// composição (src/composicoes/cenas/VideoCenas.tsx) desenha com as peças comuns de src/composicoes/marca-video.tsx.
//
// O que aparece vem do kit de marca que o `tema` traz (`logo`, `assinatura`, as cores e a fonte) e do próprio bloco:
// `nome` (quem assina por extenso) e o título e o aviso do cartão. Sem logo, sem nome e sem assinatura, a vinheta e o
// rodapé não aparecem (com aviso); o cartão aparece só com o título.
//
// Tempo (a escolha, documentada em docs/carrossel-narrado.md):
//  - a vinheta OCUPA o começo da primeira cena: cobre os primeiros `duracao_ms` (padrão 1,6 s, nunca mais que a cena) e
//    some revelando a cena. Nada anda: clipes de áudio, legendas e âncoras de palavra ficam onde estavam. O modelo
//    "Carrossel narrado" com kit começa por uma cena "Abertura" sem fala, do tamanho da vinheta, para ela não cobrir
//    nem a fala nem os blocos;
//  - o cartão final SOMA ao fim: vem depois da última cena (padrão 3,5 s) e o vídeo fica esse tanto mais longo
//    (`duracao_ms` das props). Nada anda também, porque só o fim cresce; a música que vai "até o fim do vídeo" cobre o cartão.
//
// Os efeitos sonoros usam os arquivos que o projeto tem em `midia/sfx/` (os nomes do carrossel: whoosh.wav, pop.wav,
// swell.wav e impacto_grave.wav); o que falta é pulado. O volume é baixo de fábrica (metade do que o carrossel usa) e cada
// efeito cai sob a narração com o mesmo ducking da música (calcularDucking, audio.ts), 14 LU abaixo da voz.
import {calcularDucking, dbDeGanho, type AudioP, type ClipeAudioP, type Envelope, type FaixaAudioP, type TrechoDeVoz} from './audio';
import type {CenaCenasP, TemaCenas} from './cenas';
import {caixaDaLegenda} from './exportacao';
import type {Formato} from './formatos';
import type {LegendasP} from './legendas';
import type {OperacaoPatch} from './documentos';
import {posicaoSegura, zonasDaMarca} from './zonas-seguras';

export type AcabamentoCenas = {
  nome?: string; // quem assina, por extenso; sem ele, a vinheta e o rodapé usam a assinatura do kit
  vinheta?: {ligada?: boolean; duracao_ms?: number};
  rodape?: {ligado?: boolean};
  cartao_final?: {ligado?: boolean; duracao_ms?: number; titulo?: string; aviso?: string};
  sons?: {ligados?: boolean; volume?: number}; // volume de 0 a 1 sobre o de cada efeito (padrão 0,5)
};

export const VINHETA_MS = 1600; // a do carrossel narrado (ABERTURA_MS)
export const CARTAO_MS = 3500; // a do carrossel narrado (FINAL_MS)
export const VINHETA_MIN_MS = 600;
export const VINHETA_MAX_MS = 5000;
export const CARTAO_MIN_MS = 1000;
export const CARTAO_MAX_MS = 10000;
export const VOLUME_SONS_PADRAO = 0.5;
export const ALVO_SONS_LU = 14; // o efeito fica 14 LU abaixo da voz quando cai sobre ela
export const TITULO_CARTAO_PADRAO = 'Salve e compartilhe com quem precisa';
/** Os efeitos de midia/sfx/ que o acabamento usa (os nomes do carrossel narrado). */
export const SONS_ACABAMENTO = {passagem: 'whoosh.wav', entrada: 'pop.wav', subida: 'swell.wav', impacto: 'impacto_grave.wav'} as const;
const PASTA_SONS = 'midia/sfx';
const DURACAO_SOM_MS = 3000; // o efeito mais longo do carrossel tem ~3,7 s; sem medida, o clipe vai até 3 s

/** O que a composição desenha. Tempos em ms de saída; posição do rodapé em frações do quadro e letra em fração do lado menor. */
export type AcabamentoP = {
  marca: {logo?: string; nome?: string; assinatura?: string};
  vinheta?: {t_in: number; t_out: number};
  rodape?: {t_in: number; t_out: number; x: number; y: number; largura: number; altura: number; tam: number; segura: boolean};
  cartao?: {t_in: number; t_out: number; titulo: string; aviso: string};
  sons?: FaixaAudioP;
};

const texto = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const ehObjeto = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
/** Peça ligada: o objeto existe e o interruptor não diz `false` (`{}` liga). */
const ligada = (o: unknown, chave: 'ligada' | 'ligado' | 'ligados') => ehObjeto(o) && o[chave] !== false;
const limitar = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const seg = (ms: number) => (ms / 1000).toLocaleString('pt-BR', {maximumFractionDigits: 1});

/** Duração pedida dentro da faixa; fora dela (ou não numérica) vira aviso e vale o padrão ou o limite. */
const duracaoPedida = (v: unknown, padrao: number, min: number, max: number, nome: string, avisos: string[]) => {
  if (v === undefined) return padrao;
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    avisos.push(`Acabamento: ${nome} tem duração ${String(v)}; vai com ${seg(padrao)} s`);
    return padrao;
  }
  const d = limitar(Math.round(v), min, max);
  if (d !== v) avisos.push(`Acabamento: ${nome} vai de ${seg(min)} a ${seg(max)} s; vai com ${seg(d)} s`);
  return d;
};

/** Há algo ligado no acabamento? Sem nada ligado, o vídeo é o de antes (nem `acabamento` nas props). */
export const temAcabamento = (a: unknown): boolean =>
  ehObjeto(a) && (ligada(a.vinheta, 'ligada') || ligada(a.rodape, 'ligado') || ligada(a.cartao_final, 'ligado') || ligada(a.sons, 'ligados'));

/** Quanto o cartão final soma ao fim do vídeo (0 sem cartão). O resolvedor das cenas soma isto à duração. */
export const duracaoDoCartao = (a: unknown, avisos: string[] = []): number =>
  ehObjeto(a) && ligada(a.cartao_final, 'ligado') ? duracaoPedida((a.cartao_final as Record<string, unknown>).duracao_ms, CARTAO_MS, CARTAO_MIN_MS, CARTAO_MAX_MS, 'o cartão final', avisos) : 0;

/** A caixa do rodapé em px: letra de 2,4% do lado menor, uma linha com a barra de destaque, o nome e a assinatura (ou só o
 *  logo, numa caixa de 4 alturas). A largura é estimada pelas letras (0,62 da altura por letra, folga para a Archivo e a
 *  Inter em caixa alta), até 90% do quadro. */
export const caixaDoRodape = (quadro: {largura: number; altura: number}, linha: string) => {
  const menor = Math.min(quadro.largura, quadro.altura);
  const tam = 0.024 * menor;
  const altura = tam * 2;
  const largura = linha ? linha.length * 0.62 * tam + tam * 2.2 : altura * 4;
  return {tam, altura, largura: Math.min(largura, quadro.largura * 0.9)};
};

/** O texto do rodapé: o nome em caixa alta e a assinatura, separados por um ponto. Vazio: só o logo. */
export const linhaDoRodape = (marca: AcabamentoP['marca']) => [marca.nome?.toLocaleUpperCase('pt-BR'), marca.assinatura].filter(Boolean).join('  ·  ');

/** Os efeitos sonoros do acabamento, como uma faixa de efeitos das props (a composição toca com o mesmo Clipe das outras). */
const sonsDoAcabamento = (o: {volume: number; disponiveis: Set<string>; cenas: CenaCenasP[]; vinheta?: {t_out: number}; cartao?: {t_in: number};
  total: number; audio?: AudioP; envelopes: Record<string, Envelope | undefined>}): FaixaAudioP | undefined => {
  type Evento = {som: string; em: number; vol: number; daVinheta?: boolean};
  const eventos: Evento[] = [];
  const ev = (som: string, em: number, vol: number, daVinheta = false) => eventos.push({som, em: Math.max(0, Math.round(em)), vol, daVinheta});
  const S = SONS_ACABAMENTO;
  if (o.vinheta) ev(S.passagem, 120, 0.55, true), ev(S.impacto, 380, 0.28, true);
  o.cenas.slice(1).forEach((c) => ev(S.passagem, c.t_in - 200, 0.22));
  const fimVinheta = o.vinheta?.t_out ?? 0;
  for (const c of o.cenas) {
    for (const b of c.blocos) {
      if (typeof b.desde_ms === 'number' && b.desde_ms > 0) continue; // a segunda metade de um bloco cortado já entrou na cena de antes
      if (b.tipo === 'lista') (b.itens ?? []).forEach((_, k) => ev(S.entrada, b.em + k * 450, 0.3)); // o VideoCenas põe um item a cada 450 ms
      else if (b.tipo === 'numero') ev(S.entrada, b.em, 0.3);
    }
  }
  if (o.cartao) ev(S.subida, o.cartao.t_in - 200, 0.4);
  // embaixo da vinheta só os dela (o que entra escondido por ela não soa); nada depois do fim; só os arquivos que o projeto tem
  const lista = eventos.filter((e) => o.disponiveis.has(e.som) && e.em < o.total && (e.daVinheta || e.em >= fimVinheta - 200)).sort((a, b) => a.em - b.em);
  if (!lista.length) return undefined;
  const vozes: TrechoDeVoz[] = (o.audio?.faixas ?? []).filter((f) => f.papel === 'voz' && !f.mudo).flatMap((f) =>
    f.clipes.filter((c) => !c.mudo && !c.fora).map((c) => ({em: c.em, duracao_ms: c.duracao_ms, corte_ms: c.corte_ms, ganho_db: dbDeGanho(f.volume * c.volume), env: c.envelope})));
  const clipes = lista.map((e, i): ClipeAudioP => {
    const arquivo = `${PASTA_SONS}/${e.som}`;
    const env = o.envelopes[arquivo];
    const duracao_ms = Math.max(100, Math.min(env?.duracao_ms ?? DURACAO_SOM_MS, o.total - e.em));
    const volume = Math.round(limitar(e.vol * o.volume, 0, 1) * 1000) / 1000;
    const c: ClipeAudioP = {origem: `/acabamento/sons/${i}`, id: `acabamento-som-${i + 1}`, arquivo, nome: e.som, em: e.em, duracao_ms, corte_ms: 0, volume,
      fade_in_ms: 0, fade_out_ms: 0, mudo: false, fora: false, ...(env ? {envelope: env} : {})};
    if (vozes.length) c.ducking = calcularDucking({musica: {em: e.em, duracao_ms, corte_ms: 0, ganho_db: dbDeGanho(volume), env}, vozes, alvo_lu: ALVO_SONS_LU});
    return c;
  });
  return {origem: '/acabamento/sons', id: 'acabamento-sons', nome: 'Efeitos do acabamento', papel: 'efeitos', volume: 1, mudo: false, clipes};
};

/** As props do acabamento, ou undefined (nada ligado). `cenas` já resolvidas; `total` é a duração do vídeo com o cartão;
 *  `sfx` são os arquivos de midia/sfx/ (sem ele, quem chama não olhou o disco: os efeitos ficam de fora, sem aviso). */
export const resolverAcabamento = (a: unknown, o: {tema: TemaCenas & {logo?: unknown; assinatura?: unknown}; formato: Formato; cenas: CenaCenasP[]; total: number;
  legendas?: LegendasP; audio?: AudioP; sfx?: string[]; envelopes?: Record<string, Envelope | undefined>}, avisos: string[]): AcabamentoP | undefined => {
  if (a === undefined) return undefined;
  if (!ehObjeto(a)) {
    avisos.push('Acabamento: "acabamento" é um objeto {nome, vinheta, rodape, cartao_final, sons}; ficou desligado');
    return undefined;
  }
  if (!temAcabamento(a) || !o.cenas.length) return undefined;
  const marca: AcabamentoP['marca'] = {};
  const logo = texto(o.tema.logo);
  const nome = texto(a.nome);
  const assinatura = texto(o.tema.assinatura);
  if (logo) marca.logo = logo;
  if (nome) marca.nome = nome;
  if (assinatura) marca.assinatura = assinatura;
  const semMarca = !logo && !nome && !assinatura;
  const r: AcabamentoP = {marca};
  const cartaoMs = duracaoDoCartao(a, avisos);
  const fimCenas = o.total - cartaoMs;

  if (ligada(a.vinheta, 'ligada')) {
    if (semMarca) avisos.push('Acabamento: a vinheta está ligada, mas não há logo nem assinatura no kit (tema) nem "nome": aplique um kit com aplicar_marca ou escreva acabamento.nome; a vinheta não aparece');
    else {
      const pedida = duracaoPedida((a.vinheta as Record<string, unknown>).duracao_ms, VINHETA_MS, VINHETA_MIN_MS, VINHETA_MAX_MS, 'a vinheta', avisos);
      const primeira = o.cenas[0];
      const dur = Math.min(pedida, primeira.t_out - primeira.t_in);
      if (dur < pedida) avisos.push(`Acabamento: a vinheta (${seg(pedida)} s) é mais longa que a primeira cena; fica com ${seg(dur)} s`);
      r.vinheta = {t_in: 0, t_out: dur};
    }
  }
  if (cartaoMs > 0) {
    const c = a.cartao_final as Record<string, unknown>;
    r.cartao = {t_in: fimCenas, t_out: o.total, titulo: texto(c.titulo) ?? TITULO_CARTAO_PADRAO, aviso: texto(c.aviso) ?? ''};
  }
  if (ligada(a.rodape, 'ligado')) {
    if (semMarca) avisos.push('Acabamento: o rodapé está ligado, mas não há logo nem assinatura no kit (tema) nem "nome": aplique um kit com aplicar_marca ou escreva acabamento.nome; o rodapé não aparece');
    else {
      const quadro = {largura: o.formato.largura, altura: o.formato.altura};
      const caixa = caixaDoRodape(quadro, linhaDoRodape(marca));
      const menor = Math.min(quadro.largura, quadro.altura);
      // o mais embaixo e à esquerda que fica fora da interface da rede (zonas-seguras.ts) e da faixa da legenda
      const legenda = o.legendas && !o.legendas.oculto ? caixaDaLegenda(o.legendas, quadro) : null;
      const pos = posicaoSegura(zonasDaMarca(quadro.largura, quadro.altura), 'inf-esq', quadro, caixa, 0.035 * menor, legenda ? [legenda] : []);
      if (!pos.segura) avisos.push('Acabamento: o rodapé não coube fora das zonas da rede e da legenda; ficou no canto de baixo');
      const n = (v: number) => Math.round(v * 1e5) / 1e5;
      r.rodape = {t_in: r.vinheta?.t_out ?? 0, t_out: fimCenas, x: n(pos.x), y: n(pos.y), largura: n(caixa.largura / quadro.largura), altura: n(caixa.altura / quadro.altura),
        tam: n(caixa.tam / menor), segura: pos.segura};
    }
  }
  if (ligada(a.sons, 'ligados')) {
    const s = a.sons as Record<string, unknown>;
    let volume = VOLUME_SONS_PADRAO;
    if (s.volume !== undefined) {
      volume = typeof s.volume === 'number' && Number.isFinite(s.volume) ? limitar(s.volume, 0, 1) : VOLUME_SONS_PADRAO;
      if (volume !== s.volume) avisos.push(`Acabamento: o volume dos efeitos vai de 0 a 1; vai com ${volume}`);
    }
    if (o.sfx) {
      const disponiveis = new Set(o.sfx);
      if (!Object.values(SONS_ACABAMENTO).some((x) => disponiveis.has(x))) {
        avisos.push(`Acabamento: os efeitos sonoros estão ligados, mas ${PASTA_SONS}/ não tem ${Object.values(SONS_ACABAMENTO).join(', ')}: o vídeo sai sem eles`);
      } else {
        const sons = sonsDoAcabamento({volume, disponiveis, cenas: o.cenas, vinheta: r.vinheta, cartao: r.cartao, total: o.total, audio: o.audio, envelopes: o.envelopes ?? {}});
        if (sons) r.sons = sons;
      }
    }
  }
  return r.vinheta || r.rodape || r.cartao || r.sons ? r : undefined;
};

// ---------- ligar e desligar (inspetor, aplicar_marca, modelo) ----------

/** O acabamento com vinheta, rodapé e cartão final ligados, guardando o que já havia (nome, durações, textos, sons). */
export const acabamentoLigado = (atual: unknown): AcabamentoCenas => {
  const a = (ehObjeto(atual) ? structuredClone(atual) : {}) as AcabamentoCenas;
  return {...a, vinheta: {...(ehObjeto(a.vinheta) ? a.vinheta : {}), ligada: true}, rodape: {...(ehObjeto(a.rodape) ? a.rodape : {}), ligado: true},
    cartao_final: {...(ehObjeto(a.cartao_final) ? a.cartao_final : {}), ligado: true}};
};

/** Patch que troca o acabamento inteiro do documento (o inspetor e as ferramentas gravam o bloco todo: um campo dentro de
 *  um objeto que ainda não existe não entra por JSON Patch). `novo` undefined tira o campo. */
export const patchDoAcabamento = (doc: {acabamento?: unknown}, novo: AcabamentoCenas | undefined): OperacaoPatch[] => {
  const antigo = doc.acabamento;
  if (antigo === undefined) return novo === undefined ? [] : [{op: 'add', path: '/acabamento', value: novo}];
  if (novo === undefined) return [{op: 'test', path: '/acabamento', value: antigo}, {op: 'remove', path: '/acabamento'}];
  return [{op: 'test', path: '/acabamento', value: antigo}, {op: 'replace', path: '/acabamento', value: novo}];
};

/** O som do vídeo com a faixa dos efeitos do acabamento junto, para contar quantos clipes tocam ao mesmo tempo (o pool de
 *  <audio> da prévia, etiquetasDeAudio). Sem efeitos, o som de sempre. */
export const audioComSons = (audio: AudioP | undefined, a: AcabamentoP | undefined): AudioP | undefined =>
  a?.sons ? {alvo_lufs: audio?.alvo_lufs ?? -14, pico_dbtp: audio?.pico_dbtp ?? -1, ...(audio ?? {}), faixas: [...(audio?.faixas ?? []), a.sons]} : audio;
