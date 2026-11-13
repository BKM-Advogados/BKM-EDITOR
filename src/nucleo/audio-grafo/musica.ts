// O documento de música como grafo (M-01): canais → faixas do mixer → retornos (delay e reverb) → master → limitador, e o
// render canônico em cima dele. A topologia e a ordem das somas são as do motor antigo (renderizarMusicaAntigo em
// musica-som.ts), então o PCM sai igual bit a bit; o oráculo confere (testes/audio-grafo-oraculo.test.ts) e os hashes de
// referência da M0 também (testes/musica-determinismo.test.ts).
//
// Os nós e os ids (que são os endereços da M-02 quando há um):
//   canal:<id>                     Fonte: o som seco do canal (instrumento ainda de buffer inteiro, guardado no cache)
//   faixa:<id>/entrada             Passa: soma dos canais da faixa, na ordem dos canais
//   faixa:<id>/atraso              AtrasoFaixa: o atraso manual da faixa (só se atraso_ms ≠ 0; negativo vira latência)
//   faixa:<id>/eq                  AdaptadorEq3 (só se alguma banda ≠ 0)
//   faixa:<id>/compressor          AdaptadorCompressor (só se ligado)
//   faixa:<id>/volume_pan          VolumePan (volume 0 dB quando há automação: a curva toma o lugar do fader)
//   faixa:<id>/sidechain           Ganho com a curva do sidechain por notas
//   faixa:<id>/automacao           Ganho ligado ao endereço faixa:<id>/volume_db (a automação de volume de hoje)
//   retorno:delay, retorno:reverb  AdaptadorDelay, AdaptadorFreeverb (os envios entram com o ganho do envio)
//   master                         Passa: faixas na ordem do mixer, depois o delay e o reverb, cada um com o seu volume
//   master/automacao | master/volume, master/limitador
// Ver docs/audio-grafo.md.
import type {FonteAudio} from '../loudness';
import {resolverMusica, type DocMusica} from '../musica';
import {escreverEndereco} from '../musica-param';
import {chaveDoCanal, disparosDoSidechain, ganhoDaAutomacao, ganhoDoSidechain, renderAudio, renderBateria, renderSintetizador, TAXA_MUSICA, type CacheSom,
  type ResultadoSom} from '../musica-som';
import {AdaptadorCompressor, AdaptadorDelay, AdaptadorEq3, AdaptadorFreeverb, AdaptadorLimitador} from './adaptadores';
import {BLOCO_PADRAO, executarOffline} from './executor';
import {Grafo} from './grafo';
import {AtrasoFaixa, Fonte, Ganho, ganhoDeDb, Passa, VolumePan} from './processadores';
import type {CurvaParam} from './tipos';

/** Uma curva calculada inteira só na primeira leitura (se o nó vier do cache, nem isso). Fora dela vale a ponta. */
const preguicosa = (fazer: () => Float32Array): CurvaParam => {
  let c: Float32Array | null = null;
  return (inicio, n, out) => {
    c ??= fazer();
    const ult = c.length - 1;
    for (let i = 0; i < n; i++) {
      const j = inicio + i;
      out[i] = c[j < 0 ? 0 : j > ult ? ult : j];
    }
  };
};

export type GrafoDaMusica = {
  grafo: Grafo;
  saida: string;
  n: number;
  taxa: number;
  /** Nó final de cada faixa que toca (o stem) e de cada retorno. */
  faixas: Record<string, string>;
  retornos: Partial<Record<'reverb' | 'delay', {no: string; ganho: number}>>;
  limitador?: AdaptadorLimitador;
  avisos: string[];
  faltando: Set<string>;
  /** Chaves do cache que a montagem usou (os canais secos). */
  usadas: Set<string>;
};

/** Monta o grafo do documento. O som seco de cada canal é feito aqui (pelo cache, se houver), como no motor antigo. */
export const grafoDaMusica = (doc: DocMusica, fontes: Record<string, FonteAudio | undefined>, o: {taxa?: number; cache?: CacheSom; duracao_s?: number} = {}): GrafoDaMusica => {
  const taxa = o.taxa ?? TAXA_MUSICA;
  const cache = o.cache ?? new Map();
  const {musica: m, avisos} = resolverMusica(doc);
  const duracao_s = o.duracao_s ?? m.duracao_s;
  const n = Math.max(1, Math.ceil(duracao_s * taxa));
  const faltando = new Set<string>();
  const algumSoloCanal = m.canais.some((c) => c.solo);
  const algumSoloFaixa = m.faixas.some((f) => f.solo);
  const usadas = new Set<string>();
  const doCache = <T,>(chave: string, fazer: () => T): T => {
    usadas.add(chave);
    let v = cache.get(chave) as T | undefined;
    if (v === undefined) {
      v = fazer();
      cache.set(chave, v as never);
    }
    return v;
  };
  const g = new Grafo();
  // o id do nó é o endereço da M-02 do alvo; um documento com id repetido (o motor antigo aceita) ganha "#2", "#3"...
  const tomados = new Set<string>();
  const livre = (base: string) => {
    let id = base;
    for (let i = 2; tomados.has(id); i++) id = `${base}#${i}`;
    tomados.add(id);
    return id;
  };
  const alvo = (tipo: 'faixa' | 'canal', id: string) => livre(escreverEndereco({alvo: tipo, id: String(id), segmentos: [{nome: 'x'}]}).slice(0, -2));

  // canais: o som seco (os instrumentos ainda são de buffer inteiro; viram processadores na I-01)
  const secos = new Map<string, {no: string; chave: string}[]>();
  for (const canal of m.canais) {
    if (canal.mudo || (algumSoloCanal && !canal.solo)) continue;
    const chave = chaveDoCanal(m, canal, n, taxa, fontes);
    const faltavam = faltando.size;
    let som: Float32Array[];
    if (canal.tipo === 'bateria') som = doCache(chave, () => renderBateria(m, canal, n, taxa, cache));
    else if (canal.tipo === 'sintetizador') som = doCache(chave, () => renderSintetizador(m, canal, n, taxa));
    else {
      const antes = cache.get(chave) as Float32Array[] | undefined;
      som = antes ?? renderAudio(m, canal, n, taxa, fontes, faltando);
      if (!antes && faltando.size === faltavam) cache.set(chave, som);
      if (cache.has(chave)) usadas.add(chave);
      for (const c of m.clipes) if (c.canal === canal.id && c.audio && !fontes[c.audio]) faltando.add(c.audio);
    }
    const no = g.no(alvo('canal', canal.id), new Fonte(som));
    secos.set(canal.faixa_mixer, [...(secos.get(canal.faixa_mixer) ?? []), {no, chave}]);
  }

  // faixas do mixer
  const master = g.no('master', new Passa(2), {soma: 'zero'}); // o motor antigo soma a mistura a partir de +0
  const envios: {no: string; chave: string; quanto: number}[] = [];
  const enviosDelay: typeof envios = [];
  const faixas: Record<string, string> = {};
  // o atraso manual (M-07) em amostras inteiras, por faixa (a primeira com o id, como o resto do motor acha a faixa)
  const atrasoDe = (id: string) => Math.round(((m.faixas.find((x) => x.id === id)?.atraso_ms ?? 0) * taxa) / 1000);
  for (const f of m.faixas) {
    const entram = secos.get(f.id);
    if (!entram || f.mudo || (algumSoloFaixa && !f.solo)) continue;
    const auto = m.automacoes[f.id];
    const disparos = f.sidechain ? disparosDoSidechain(m, f.sidechain) : [];
    // o sidechain segue o som de quem dispara: o atraso manual da faixa do canal que dispara move os disparos junto
    const canalSc = f.sidechain ? m.canais.find((c) => c.id === f.sidechain!.de) : undefined;
    const deslSc = canalSc ? atrasoDe(canalSc.faixa_mixer) : 0;
    const chave = `faixa:${JSON.stringify({f: {...f, mudo: false, solo: false, reverb: 0, delay: 0}, de: entram.map((e) => e.chave), auto, disparos,
      ...(deslSc ? {deslSc} : {}), ...(f.atraso_ms ? {taxa} : {})})}`;
    const base = alvo('faixa', f.id);
    const cadeia: string[] = [g.no(`${base}/entrada`, new Passa(2))];
    for (const e of entram) g.ligar(e.no, cadeia[0]);
    // o atraso manual vem logo depois da soma dos canais: desloca o som da faixa (e o que ela manda aos retornos), mas a
    // automação e o sidechain da própria faixa ficam no tempo da música
    const atraso = Math.round((f.atraso_ms * taxa) / 1000);
    if (atraso) cadeia.push(g.no(`${base}/atraso`, new AtrasoFaixa(atraso)));
    const {graves_db, medios_db, agudos_db} = f.eq;
    if (graves_db || medios_db || agudos_db) cadeia.push(g.no(`${base}/eq`, new AdaptadorEq3(f.eq)));
    if (f.compressor.ativo) cadeia.push(g.no(`${base}/compressor`, new AdaptadorCompressor(f.compressor)));
    // os parâmetros levam o endereço da M-02 (a automação geral da X-08 liga aqui); a de volume de hoje é um ganho linear
    // depois do fader (nó `automacao`), como no motor antigo, então com ela o fader fica em 0 dB e sem endereço
    const endVolume = `${base.replace(/#\d+$/, '')}/volume_db`;
    cadeia.push(g.no(`${base}/volume_pan`, new VolumePan(), {params: {volume_db: auto ? 0 : {endereco: endVolume, valor: f.volume_db},
      pan: {endereco: `${base.replace(/#\d+$/, '')}/pan`, valor: f.pan}}}));
    if (f.sidechain && disparos.length) {
      const sc = f.sidechain;
      cadeia.push(g.no(`${base}/sidechain`, new Ganho(2), {params: {ganho: {curva: preguicosa(() => ganhoDoSidechain(disparos, sc, n, taxa, deslSc))}}}));
    }
    if (auto) {
      g.automatizar(endVolume, preguicosa(() => ganhoDaAutomacao(auto, n, taxa)));
      cadeia.push(g.no(`${base}/automacao`, new Ganho(2), {params: {ganho: {endereco: endVolume}}}));
    }
    for (let i = 1; i < cadeia.length; i++) g.ligar(cadeia[i - 1], cadeia[i]);
    const fim = cadeia[cadeia.length - 1];
    g.nos.get(fim)!.chave = chave;
    g.ligar(fim, master);
    faixas[f.id] = fim;
    if (f.reverb > 0) envios.push({no: fim, chave, quanto: f.reverb});
    if (f.delay > 0) enviosDelay.push({no: fim, chave, quanto: f.delay});
  }

  // retornos: primeiro o delay, depois o reverb (a ordem da soma no master)
  const retornos: GrafoDaMusica['retornos'] = {};
  if (enviosDelay.length) {
    const d = m.master.delay;
    const atraso_s = d.batidas * m.seg_por_batida;
    const no = g.no('retorno:delay', new AdaptadorDelay(atraso_s, d.realimentacao, d.brilho, d.pingue_pongue),
      {soma: 'zero', chave: `delay:${JSON.stringify({d: [atraso_s, d.realimentacao, d.brilho, d.pingue_pongue], e: enviosDelay.map((e) => [e.chave, e.quanto]), taxa})}`});
    for (const e of enviosDelay) g.ligar(e.no, no, {ganho: e.quanto});
    const ganho = ganhoDeDb(d.volume_db);
    g.ligar(no, master, {ganho});
    retornos.delay = {no, ganho};
  }
  if (envios.length) {
    const r = m.master.reverb;
    const no = g.no('retorno:reverb', new AdaptadorFreeverb(r.tamanho, r.amortecimento),
      {soma: 'zero', chave: `reverb:${JSON.stringify({r: [r.tamanho, r.amortecimento], e: envios.map((e) => [e.chave, e.quanto]), taxa})}`});
    for (const e of envios) g.ligar(e.no, no, {ganho: e.quanto});
    const ganho = ganhoDeDb(r.volume_db);
    g.ligar(no, master, {ganho});
    retornos.reverb = {no, ganho};
  }

  // master: automação (no lugar do fader) ou volume, e o limitador
  let saida = master;
  const autoMaster = m.automacoes.master;
  if (autoMaster) {
    g.automatizar('master/volume_db', preguicosa(() => ganhoDaAutomacao(autoMaster, n, taxa)));
    const no = g.no('master/automacao', new Ganho(2), {params: {ganho: {endereco: 'master/volume_db'}}});
    g.ligar(saida, no);
    saida = no;
  } else {
    const gm = ganhoDeDb(m.master.volume_db);
    if (gm !== 1) {
      const no = g.no('master/volume', new Ganho(2), {params: {ganho: gm}});
      g.ligar(saida, no);
      saida = no;
    }
  }
  const lim = m.master.limitador;
  let limitador: AdaptadorLimitador | undefined;
  if (lim.ativo) {
    limitador = new AdaptadorLimitador(lim.teto_db, lim.soltura_ms);
    const no = g.no('master/limitador', limitador);
    g.ligar(saida, no);
    saida = no;
  }
  return {grafo: g, saida, n, taxa, faixas, retornos, ...(limitador ? {limitador} : {}), avisos, faltando, usadas};
};

/** A música inteira pelo grafo: o render canônico (é o `renderizarMusica` de musica-som.ts). Mesma assinatura e mesmo
 *  resultado do motor antigo, cache por camada incluído (canal seco, faixa processada, retornos): com `cache`, a prévia só
 *  refaz o que mudou, e o que este render não usou sai do cache (as batidas de cada peça ficam). */
export const renderizarMusicaGrafo = (doc: DocMusica, fontes: Record<string, FonteAudio | undefined>,
  o: {taxa?: number; cache?: CacheSom; porFaixa?: boolean; duracao_s?: number; bloco?: number} = {}): ResultadoSom => {
  const gm = grafoDaMusica(doc, fontes, o);
  const {n, taxa} = gm;
  const coletar = o.porFaixa ? [...Object.values(gm.faixas), ...Object.values(gm.retornos).map((r) => r!.no)] : [];
  const r = executarOffline(gm.grafo, {taxa, n, bloco: o.bloco ?? BLOCO_PADRAO, saida: gm.saida, coletar, cache: o.cache});
  if (o.cache) {
    for (const k of r.chavesUsadas) gm.usadas.add(k);
    for (const k of [...o.cache.keys()]) if (!gm.usadas.has(k) && !k.startsWith('peca:')) o.cache.delete(k);
  }
  const faixas: Record<string, Float32Array[]> = {};
  const retornos: NonNullable<ResultadoSom['retornos']> = {};
  if (o.porFaixa) {
    for (const [id, no] of Object.entries(gm.faixas)) faixas[id] = r.coletados[no];
    for (const k of ['delay', 'reverb'] as const) {
      const ret = gm.retornos[k];
      if (!ret) continue;
      const volta = r.coletados[ret.no];
      retornos[k] = ret.ganho === 1 ? volta : volta.map((x) => x.map((v) => v * ret.ganho));
    }
  }
  const avisos = [...gm.avisos];
  for (const a of gm.faltando) avisos.push(`o áudio ${a} não foi lido; o clipe fica calado`);
  return {canais: r.canais, taxa, duracao_s: n / taxa, avisos, faltando: [...gm.faltando], ...(o.porFaixa ? {faixas, retornos} : {}),
    ...(gm.limitador ? {limitador_db: gm.limitador.reducao_db} : {})};
};
