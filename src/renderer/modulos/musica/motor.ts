// Motor da Música na janela. O som sai de src/nucleo/musica-som.ts (a mesma conta do render que vai para o vídeo); o Web
// Audio só decodifica os arquivos (a 48 kHz) e toca o resultado. Três buffers tocam juntos, com o mesmo loop nativo:
// a música, a voz do vídeo como guia (fora do render) e o metrônomo. "Ouvir como no vídeo" aplica ao volume a curva do
// clipe ligado (faixa × clipe × fades × ducking, volumeDoClipe de audio.ts). O som é feito num Web Worker
// (render.worker.ts), fora da thread da interface; mudou o documento, o worker refaz só o que mudou (o cache por camada
// fica lá) e, tocando, o buffer troca na mesma posição. O mesmo worker faz o render que vai para o vídeo.
import type {AudioP, ClipeAudioP, FaixaAudioP} from '../../../nucleo/audio';
import {volumeDoClipe} from '../../../nucleo/audio';
import {medirAmostras, type FonteAudio} from '../../../nucleo/loudness';
import {envelopeDeAmostras} from '../../../nucleo/audio';
import {audiosDaMusica, partesDoSom, resolverMusica, type AjustePeca, type DocMusica, type MacrosSintetizador, type PecaBateria, type PresetSintetizador} from '../../../nucleo/musica';
import {codificarWav16, notaDoSintetizador, receitaDe, renderizarMusica, somDeUmaBatida, TAXA_MUSICA, type CacheSom} from '../../../nucleo/musica-som';
import type {PedidoRender, RespostaRender} from './render.worker';

type SemId<T> = T extends unknown ? Omit<T, 'id'> : never;
import {loja} from '../../estado/loja';

/** Endereço de um arquivo do projeto (o servidor de mídia do app; na prévia web, a URL de blob já vem pronta). */
export const urlDaMidia = (arquivo: string) => {
  if (/^[a-z][a-z0-9+.-]*:/i.test(arquivo)) return arquivo;
  const base = (loja.get().info?.base_midia ?? '').replace(/\/+$/, '');
  return `${base}/${arquivo.split('/').map(encodeURIComponent).join('/')}`;
};

export type VozGuia = {clipes: {arquivo: string; em_s: number; dur_s: number; corte_s: number; ganho: number}[]};

class MotorMusica {
  private ctx: AudioContext | null = null;
  private fontes = new Map<string, FonteAudio | null>(); // a voz guia (fica aqui)
  private naObra = new Map<string, number | null>(); // áudios da música, já no worker: amostras (null = não leu)
  private pedidos = new Map<string, Promise<void>>();
  private musica: AudioBuffer | null = null;
  private chaveMusica = '';
  private geracao = 0;
  private guia: AudioBuffer | null = null;
  private chaveGuia = '';
  private metro: AudioBuffer | null = null;
  private chaveMetro = '';
  private tocando: {fontes: AudioBufferSourceNode[]; ganho: GainNode; inicioCtx: number; inicioS: number; loop: [number, number] | null} | null = null;
  avisos: string[] = [];
  duracao_s = 0;
  ultimoRender_ms = 0;

  // ---------- o worker do som (render.worker.ts) ----------
  private trabalhador: Worker | null = null;
  private semWorker = false;
  private proximo = 1;
  private esperando = new Map<number, (r: RespostaRender) => void>();
  private cacheLocal: CacheSom = new Map(); // só se o worker não subir
  private fontesLocais = new Map<string, FonteAudio>();

  private pedir(p: SemId<PedidoRender>, transferir: Transferable[] = []): Promise<RespostaRender> {
    if (!this.trabalhador && !this.semWorker) {
      try {
        const w = new Worker(new URL('./render.worker.ts', import.meta.url), {type: 'module'});
        w.addEventListener('message', (e: MessageEvent<RespostaRender>) => {
          const f = this.esperando.get(e.data.id);
          this.esperando.delete(e.data.id);
          f?.(e.data);
        });
        w.addEventListener('error', (e) => {
          // worker que não sobe: os pedidos em curso falham e o som passa a ser feito aqui mesmo
          this.semWorker = true;
          this.trabalhador = null;
          for (const [id, f] of this.esperando) f({id, ok: false, mensagem: e.message || 'o worker do som não abriu'});
          this.esperando.clear();
        });
        this.trabalhador = w;
      } catch {
        this.semWorker = true;
      }
    }
    const id = this.proximo++;
    if (!this.trabalhador) return Promise.resolve(this.local({...p, id} as PedidoRender));
    return new Promise((ok) => {
      this.esperando.set(id, ok);
      this.trabalhador!.postMessage({...p, id}, transferir);
    });
  }

  /** A mesma conta, na thread da janela: só quando o worker não sobe. */
  private local(p: PedidoRender): RespostaRender {
    if (p.tipo === 'fonte') {
      this.fontesLocais.set(p.arquivo, {canais: p.canais, taxa: p.taxa});
      return {id: p.id, ok: true};
    }
    if (p.tipo === 'esquecer') {
      if (p.arquivo) this.fontesLocais.delete(p.arquivo);
      else this.fontesLocais.clear();
      this.cacheLocal.clear();
      return {id: p.id, ok: true};
    }
    const t0 = performance.now();
    const r = renderizarMusica(p.doc, Object.fromEntries(this.fontesLocais), {taxa: p.taxa, cache: this.cacheLocal, porFaixa: p.porFaixa});
    const ms = Math.round(performance.now() - t0);
    if (!p.paraVideo) return {id: p.id, ok: true, canais: r.canais, duracao_s: r.duracao_s, avisos: r.avisos, faltando: r.faltando, ms};
    const m = medirAmostras(r.canais, p.taxa);
    return {id: p.id, ok: true, duracao_s: r.duracao_s, avisos: r.avisos, faltando: r.faltando, ms, medida: {integrado_lufs: m.integrado_lufs, pico_dbtp: m.pico_dbtp},
      envelope: envelopeDeAmostras(r.canais, p.taxa), wav: codificarWav16(r.canais, p.taxa)};
  }

  contexto() {
    if (!this.ctx) this.ctx = new AudioContext({sampleRate: TAXA_MUSICA, latencyHint: 'interactive'});
    return this.ctx;
  }

  private async lerArquivo(arquivo: string): Promise<FonteAudio | null> {
    try {
      const r = await fetch(urlDaMidia(arquivo));
      if (!r.ok) throw new Error(String(r.status));
      const b = await this.contexto().decodeAudioData(await r.arrayBuffer());
      return {canais: Array.from({length: b.numberOfChannels}, (_, i) => b.getChannelData(i).slice()), taxa: b.sampleRate};
    } catch {
      return null;
    }
  }

  /** Áudio da voz guia: decodificado e guardado aqui. */
  private async decodificar(arquivo: string) {
    if (this.fontes.has(arquivo)) return;
    const chave = `guia:${arquivo}`;
    let p = this.pedidos.get(chave);
    if (!p) {
      p = this.lerArquivo(arquivo).then((f) => void this.fontes.set(arquivo, f)).finally(() => this.pedidos.delete(chave));
      this.pedidos.set(chave, p);
    }
    await p;
  }

  /** Áudio da música: decodificado uma vez e entregue ao worker (sem cópia aqui). */
  private async levarAoWorker(arquivo: string) {
    if (this.naObra.has(arquivo)) return;
    const chave = `obra:${arquivo}`;
    let p = this.pedidos.get(chave);
    if (!p) {
      p = (async () => {
        const f = await this.lerArquivo(arquivo);
        if (f) await this.pedir({tipo: 'fonte', arquivo, canais: f.canais, taxa: f.taxa}, f.canais.map((c) => c.buffer));
        this.naObra.set(arquivo, f ? f.canais[0]?.length ?? 0 : null);
      })().finally(() => this.pedidos.delete(chave));
      this.pedidos.set(chave, p);
    }
    await p;
  }

  /** Arquivo regravado (outra tomada com o mesmo nome): esquece a decodificação dele. */
  esquecer(arquivo?: string) {
    if (arquivo) {
      this.fontes.delete(arquivo);
      this.naObra.delete(arquivo);
    } else {
      this.fontes.clear();
      this.naObra.clear();
    }
    void this.pedir({tipo: 'esquecer', arquivo});
    this.chaveMusica = '';
  }

  private paraBuffer(canais: Float32Array[], taxa: number) {
    const b = this.contexto().createBuffer(2, Math.max(1, canais[0].length), taxa);
    b.copyToChannel(canais[0] as Float32Array<ArrayBuffer>, 0);
    b.copyToChannel((canais[1] ?? canais[0]) as Float32Array<ArrayBuffer>, 1);
    return b;
  }

  /** Deixa o buffer da música em dia com o documento (o som vem do worker); devolve se mudou. Pedido que chega
   *  depois de outro mais novo é descartado. */
  async preparar(doc: DocMusica): Promise<boolean> {
    const minha = ++this.geracao;
    await Promise.all(audiosDaMusica(doc).map((a) => this.levarAoWorker(a)));
    const chave = JSON.stringify({s: partesDoSom(doc), f: audiosDaMusica(doc).map((a) => [a, this.naObra.get(a) ?? 0])});
    if (chave === this.chaveMusica && this.musica) return false;
    const r = await this.pedir({tipo: 'render', doc, taxa: TAXA_MUSICA});
    if (minha !== this.geracao || !r.ok || !r.canais) return false;
    this.ultimoRender_ms = r.ms ?? 0;
    this.musica = this.paraBuffer(r.canais, TAXA_MUSICA);
    this.duracao_s = r.duracao_s ?? 0;
    this.avisos = r.avisos ?? [];
    this.chaveMusica = chave;
    if (this.tocando) this.retomar();
    return true;
  }

  /** O render que vai para o vídeo (pedido do processo principal pela ponte com a janela): WAV, medida e envelope,
   *  feitos no worker com os mesmos áudios e o mesmo cache da prévia. */
  async renderParaVideo(doc: DocMusica, porFaixa = false) {
    await Promise.all(audiosDaMusica(doc).map((a) => this.levarAoWorker(a)));
    return this.pedir({tipo: 'render', doc, taxa: TAXA_MUSICA, paraVideo: true, porFaixa});
  }

  /** A voz do vídeo no tempo da música (o começo da música no vídeo é o zero daqui). Não entra no render. */
  async prepararGuia(voz: VozGuia | null) {
    const chave = JSON.stringify({voz, d: this.duracao_s});
    if (chave === this.chaveGuia) return;
    this.chaveGuia = chave;
    if (!voz?.clipes.length || !this.duracao_s) {
      this.guia = null;
      return;
    }
    await Promise.all(voz.clipes.map((c) => this.decodificar(c.arquivo)));
    const n = Math.ceil(this.duracao_s * TAXA_MUSICA);
    const L = new Float32Array(n), R = new Float32Array(n);
    for (const c of voz.clipes) {
      const f = this.fontes.get(c.arquivo);
      if (!f) continue;
      const sl = f.canais[0], sr = f.canais[1] ?? f.canais[0];
      const ini = Math.round(c.em_s * TAXA_MUSICA), corte = Math.round(c.corte_s * TAXA_MUSICA), dur = Math.round(c.dur_s * TAXA_MUSICA);
      for (let i = Math.max(0, ini), k = i - ini; i < Math.min(n, ini + dur) && corte + k < sl.length; i++, k++) {
        L[i] += sl[corte + k] * c.ganho;
        R[i] += sr[corte + k] * c.ganho;
      }
    }
    this.guia = this.paraBuffer([L, R], TAXA_MUSICA);
    if (this.tocando) this.retomar();
  }

  /** Clique em cada batida (mais forte no primeiro tempo do compasso). */
  prepararMetronomo(doc: DocMusica | null) {
    const m = doc ? resolverMusica(doc).musica : null;
    const chave = m ? `${m.bpm}:${m.batidas_por_compasso}:${this.duracao_s}` : '';
    if (chave === this.chaveMetro) return;
    this.chaveMetro = chave;
    if (!m || !this.duracao_s) {
      this.metro = null;
      return;
    }
    const n = Math.ceil(this.duracao_s * TAXA_MUSICA);
    const x = new Float32Array(n);
    const clique = Math.round(0.03 * TAXA_MUSICA);
    for (let b = 0; b * m.seg_por_batida < this.duracao_s; b++) {
      const ini = Math.round(b * m.seg_por_batida * TAXA_MUSICA);
      const forte = b % Math.round(m.batidas_por_compasso) === 0;
      const f = forte ? 1600 : 1000;
      for (let k = 0; k < clique && ini + k < n; k++) x[ini + k] += Math.sin((2 * Math.PI * f * k) / TAXA_MUSICA) * Math.exp(-k / (0.006 * TAXA_MUSICA)) * (forte ? 0.5 : 0.3);
    }
    this.metro = this.paraBuffer([x, x], TAXA_MUSICA);
  }

  private curva: {valores: Float32Array; passo_s: number} | null = null;
  /** Curva de volume do clipe ligado no vídeo ("Ouvir como no vídeo"); null = cheio. */
  definirCurva(c: {f: FaixaAudioP; c: ClipeAudioP} | null) {
    if (!c || !this.duracao_s) {
      this.curva = null;
    } else {
      const passo_s = 0.02;
      const n = Math.max(2, Math.ceil(this.duracao_s / passo_s));
      const valores = new Float32Array(n);
      for (let i = 0; i < n; i++) valores[i] = volumeDoClipe(c.f, c.c, i * passo_s * 1000);
      this.curva = {valores, passo_s};
    }
    if (this.tocando) this.retomar();
  }

  posicao(): number {
    const t = this.tocando;
    if (!t || !this.ctx) return 0;
    const corrido = this.ctx.currentTime - t.inicioCtx + t.inicioS;
    if (!t.loop) return Math.min(corrido, this.duracao_s);
    const [a, b] = t.loop;
    return corrido < b ? corrido : a + ((corrido - a) % Math.max(0.01, b - a));
  }
  estaTocando() {
    return Boolean(this.tocando);
  }

  private opcoes: {loop: [number, number] | null; guia: boolean; metronomo: boolean} = {loop: null, guia: true, metronomo: false};

  tocar(de_s: number, o: {loop: [number, number] | null; guia: boolean; metronomo: boolean}) {
    this.opcoes = o;
    this.parar();
    const ctx = this.contexto();
    void ctx.resume();
    if (!this.musica) return;
    const de = Math.max(0, Math.min(de_s, Math.max(0, this.duracao_s - 0.01)));
    const ganho = ctx.createGain();
    ganho.connect(ctx.destination);
    const quando = ctx.currentTime + 0.03;
    const fontes: AudioBufferSourceNode[] = [];
    const loop = o.loop && o.loop[1] - o.loop[0] > 0.05 ? o.loop : null;
    const tocarBuffer = (b: AudioBuffer | null, destino: AudioNode, g = 1) => {
      if (!b) return;
      const s = ctx.createBufferSource();
      s.buffer = b;
      if (loop) {
        s.loop = true;
        s.loopStart = loop[0];
        s.loopEnd = Math.min(loop[1], b.duration);
      }
      if (g !== 1) {
        const gg = ctx.createGain();
        gg.gain.value = g;
        s.connect(gg).connect(destino);
      } else s.connect(destino);
      s.start(quando, de);
      fontes.push(s);
    };
    tocarBuffer(this.musica, ganho);
    if (o.guia) tocarBuffer(this.guia, ctx.destination, 0.9);
    if (o.metronomo) tocarBuffer(this.metro, ctx.destination);
    if (this.curva && !loop) {
      const i0 = Math.min(this.curva.valores.length - 2, Math.floor(de / this.curva.passo_s));
      const resto = this.curva.valores.subarray(i0);
      ganho.gain.setValueCurveAtTime(resto, quando, Math.max(0.05, resto.length * this.curva.passo_s));
    }
    fontes[0].onended = () => {
      if (this.tocando?.fontes[0] === fontes[0]) this.tocando = null;
    };
    this.tocando = {fontes, ganho, inicioCtx: quando, inicioS: de, loop};
  }

  private retomar() {
    if (!this.tocando) return;
    const p = this.posicao();
    this.tocar(p, this.opcoes);
  }

  parar() {
    const t = this.tocando;
    this.tocando = null;
    if (!t) return;
    for (const s of t.fontes) {
      s.onended = null;
      try {
        s.stop();
      } catch {
        /* já parou */
      }
    }
    t.ganho.disconnect();
  }

  /** Uma nota agora (célula da grade, nome da nota): o sintetizador do canal. */
  tocarNota(midi: number, preset: PresetSintetizador, macros: MacrosSintetizador = {}, dur_s = 0.4) {
    const ctx = this.contexto();
    void ctx.resume();
    const m = {brilho: macros.brilho ?? 0.5, ataque: macros.ataque ?? 0, soltura: macros.soltura ?? 0.3, cor: macros.cor ?? 0.3};
    const s = notaDoSintetizador(midi, dur_s, receitaDe(preset, m), TAXA_MUSICA);
    const b = ctx.createBufferSource();
    b.buffer = this.paraBuffer([s, s], TAXA_MUSICA);
    b.connect(ctx.destination);
    b.start();
  }

  /** Uma batida agora (pad, passo clicado): a peça com o ajuste do canal. */
  tocarBatida(peca: PecaBateria, aj: AjustePeca = {}, forca = 100, semente = 1) {
    const ctx = this.contexto();
    void ctx.resume();
    const [l, r] = somDeUmaBatida(peca, aj, forca, semente, TAXA_MUSICA);
    const s = ctx.createBufferSource();
    s.buffer = this.paraBuffer([l, r], TAXA_MUSICA);
    s.connect(ctx.destination);
    s.start();
  }
}

export const motor = new MotorMusica();

/** A voz do vídeo como guia: os clipes das faixas de voz (não mudas), no tempo da música. */
export const vozGuiaDe = (audio: AudioP | undefined, em_ms: number): VozGuia | null => {
  if (!audio) return null;
  const clipes = audio.faixas.filter((f) => f.papel === 'voz' && !f.mudo).flatMap((f) => f.clipes.filter((c) => !c.mudo && !c.fora).map((c) => ({
    arquivo: c.arquivo, em_s: (c.em - em_ms) / 1000, dur_s: c.duracao_ms / 1000, corte_s: c.corte_ms / 1000, ganho: f.volume * c.volume,
  }))).filter((c) => c.em_s + c.dur_s > 0).map((c) => (c.em_s < 0 ? {...c, corte_s: c.corte_s - c.em_s, dur_s: c.dur_s + c.em_s, em_s: 0} : c));
  return clipes.length ? {clipes} : null;
};
