// Cache de áudio em disco (M-04): a saída de um nó do grafo (uma faixa já processada, um retorno) guardada num arquivo por
// chave, em .estudio/cache-audio/ do projeto (fora do git), lida de volta por trecho e com teto em bytes: passou do teto,
// sai o arquivo usado há mais tempo (LRU pela data de modificação, que cada leitura renova). É o `ArmazemAudio` do
// executor (audio-grafo/amostras.ts) no Node: o render do processo principal e o do MCP por stdio. A prévia da janela
// continua com o cache em memória (o navegador não tem este disco).
//
// O arquivo: SHA-256 da versão + chave, extensão .f32. Cabeçalho de 16 bytes ("EAC1", canais, amostras por canal,
// reservado) e depois cada canal inteiro, float32 little-endian. Gravado num .tmp e renomeado no fim: um render que caiu
// no meio não deixa arquivo pela metade, e dois processos gravando a mesma chave não se atrapalham.
// Ver docs/audio-grafo.md, "Memória".
import {createHash} from 'node:crypto';
import {closeSync, mkdirSync, openSync, readdirSync, readSync, renameSync, statSync, unlinkSync, utimesSync, writeSync} from 'node:fs';
import path from 'node:path';
import {fontePorTrechos, type ArmazemAudio, type FonteAmostras, type GravadorAmostras} from './audio-grafo/amostras';

export const PASTA_CACHE_AUDIO = '.estudio/cache-audio';
/** Teto padrão: 2 GB (o do perfil leve em docs/desempenho.md). `ESTUDIO_CACHE_AUDIO_MB` muda (0 desliga o cache). */
export const TETO_CACHE_AUDIO = 2 * 1024 ** 3;
/** Muda quando muda a conta de algum processador: os arquivos antigos deixam de casar e saem pelo LRU. */
export const VERSAO_CACHE_AUDIO = 'grafo-1';
const MAGICO = 0x31434145; // "EAC1" em little-endian
const CABECALHO = 16;
/** Amostras por canal lidas ou gravadas de uma vez (0,68 s a 48 kHz). */
const TRECHO = 1 << 15;

export const tetoDoAmbiente = (env: Record<string, string | undefined> = process.env): number => {
  const mb = Number(env.ESTUDIO_CACHE_AUDIO_MB);
  return env.ESTUDIO_CACHE_AUDIO_MB !== undefined && env.ESTUDIO_CACHE_AUDIO_MB !== '' && Number.isFinite(mb) && mb >= 0 ? mb * 1024 ** 2 : TETO_CACHE_AUDIO;
};

const bytesDe = (f: Float32Array, off: number, qtd: number) => new Uint8Array(f.buffer, f.byteOffset + off * 4, qtd * 4);

export type OpcoesCacheAudio = {teto_bytes?: number};

export class CacheAudioDisco implements ArmazemAudio {
  readonly teto: number;
  constructor(readonly pasta: string, o: OpcoesCacheAudio = {}) {
    this.teto = o.teto_bytes ?? tetoDoAmbiente();
  }

  /** O arquivo de uma chave. */
  arquivo(chave: string) {
    return path.join(this.pasta, `${createHash('sha256').update(`${VERSAO_CACHE_AUDIO}\n${chave}`).digest('hex')}.f32`);
  }

  abrir(chave: string, canais: number, n: number): FonteAmostras | null {
    if (this.teto <= 0) return null;
    const arq = this.arquivo(chave);
    let fd: number;
    try {
      fd = openSync(arq, 'r');
    } catch {
      return null;
    }
    try {
      const cab = new Uint32Array(4);
      const lido = readSync(fd, new Uint8Array(cab.buffer), 0, CABECALHO, 0);
      const tam = statSync(arq).size;
      if (lido !== CABECALHO || cab[0] !== MAGICO || cab[1] !== canais || cab[2] !== n || tam !== CABECALHO + canais * n * 4) {
        closeSync(fd);
        return null;
      }
    } catch {
      closeSync(fd);
      return null;
    }
    try {
      const agora = new Date();
      utimesSync(arq, agora, agora); // o uso renova a vez no LRU
    } catch {
      /* só a ordem do LRU */
    }
    let aberto = true;
    const f = fontePorTrechos({canais, n, trecho: TRECHO, fazer: (de, ate) => {
      if (!aberto) throw new Error('cache de áudio: leitura depois de fechar');
      return Array.from({length: canais}, (_, c) => {
        const buf = new Float32Array(ate - de);
        const pos = CABECALHO + (c * n + de) * 4;
        let feito = 0;
        while (feito < buf.byteLength) {
          const r = readSync(fd, bytesDe(buf, 0, ate - de), feito, buf.byteLength - feito, pos + feito);
          if (r <= 0) throw new Error(`cache de áudio: ${path.basename(arq)} acabou antes da hora`);
          feito += r;
        }
        return buf;
      });
    }});
    return {
      canais, n,
      ler: (inicio, qtd, dest, off) => f.ler(inicio, qtd, dest, off),
      fechar: () => {
        if (!aberto) return;
        aberto = false;
        f.fechar?.();
        closeSync(fd);
      },
    };
  }

  gravar(chave: string, canais: number, n: number): GravadorAmostras | null {
    const bytes = CABECALHO + canais * n * 4;
    if (this.teto <= 0 || bytes > this.teto / 2) return null; // um item só não pode empurrar o resto inteiro para fora
    mkdirSync(this.pasta, {recursive: true});
    const final = this.arquivo(chave);
    const tmp = `${final}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
    const fd = openSync(tmp, 'w');
    const cab = new Uint32Array([MAGICO, canais, n, 0]);
    writeSync(fd, new Uint8Array(cab.buffer), 0, CABECALHO, 0);
    // junta um trecho por canal antes de ir ao disco (o executor manda blocos de 128 amostras)
    const junta = Array.from({length: canais}, () => new Float32Array(Math.min(TRECHO, n)));
    let ini = 0, cheio = 0, feito = 0, fechado = false;
    const descarregar = () => {
      for (let c = 0; c < canais; c++) writeSync(fd, bytesDe(junta[c], 0, cheio), 0, cheio * 4, CABECALHO + (c * n + ini) * 4);
      ini += cheio;
      cheio = 0;
    };
    const fechar = () => {
      if (fechado) return;
      fechado = true;
      closeSync(fd);
    };
    return {
      escrever: (src, inicio, qtd, off = 0) => {
        if (inicio !== feito) throw new Error(`cache de áudio: escrita fora de ordem (${inicio}, esperava ${feito})`);
        let i = 0;
        while (i < qtd) {
          const k = Math.min(qtd - i, junta[0].length - cheio);
          for (let c = 0; c < canais; c++) junta[c].set(src[c].subarray(off + i, off + i + k), cheio);
          cheio += k;
          i += k;
          if (cheio === junta[0].length) descarregar();
        }
        feito += qtd;
      },
      concluir: () => {
        try {
          if (feito !== n) throw new Error(`cache de áudio: ${feito} de ${n} amostras`);
          if (cheio) descarregar();
          fechar();
          renameSync(tmp, final);
        } catch (e) {
          fechar();
          apagar(tmp);
          if (feito !== n) throw e;
          return; // outro processo gravou a mesma chave (no Windows, com o arquivo aberto): fica o dele
        }
        this.aparar();
      },
      descartar: () => {
        fechar();
        apagar(tmp);
      },
    };
  }

  /** Os arquivos do cache, do usado há mais tempo ao mais recente. */
  itens(): {arquivo: string; bytes: number; uso: number}[] {
    let nomes: string[];
    try {
      nomes = readdirSync(this.pasta);
    } catch {
      return [];
    }
    const out: {arquivo: string; bytes: number; uso: number}[] = [];
    for (const nome of nomes) {
      if (!nome.endsWith('.f32')) continue;
      try {
        const s = statSync(path.join(this.pasta, nome));
        out.push({arquivo: path.join(this.pasta, nome), bytes: s.size, uso: s.mtimeMs});
      } catch {
        /* saiu agora */
      }
    }
    return out.sort((a, b) => a.uso - b.uso || (a.arquivo < b.arquivo ? -1 : 1));
  }

  bytes() {
    return this.itens().reduce((s, x) => s + x.bytes, 0);
  }

  /** Tira os usados há mais tempo até caber no teto, e os .tmp esquecidos há mais de um dia (um processo que morreu). */
  aparar(teto = this.teto) {
    const itens = this.itens();
    let total = itens.reduce((s, x) => s + x.bytes, 0);
    for (const x of itens) {
      if (total <= teto) break;
      if (apagar(x.arquivo)) total -= x.bytes;
    }
    try {
      const dia = Date.now() - 24 * 3600 * 1000;
      for (const nome of readdirSync(this.pasta)) {
        if (!nome.endsWith('.tmp')) continue;
        const arq = path.join(this.pasta, nome);
        if (statSync(arq).mtimeMs < dia) apagar(arq);
      }
    } catch {
      /* pasta sumiu */
    }
    return total;
  }

  /** Esvazia o cache. */
  limpar() {
    this.aparar(0);
  }
}

const apagar = (arq: string) => {
  try {
    unlinkSync(arq);
    return true;
  } catch {
    return false; // no Windows, aberto por outro render: sai na próxima vez
  }
};

/** O cache de áudio de um projeto (a pasta absoluta do projeto). */
export const cacheAudioDoProjeto = (raiz: string, o: OpcoesCacheAudio = {}) => new CacheAudioDisco(path.join(raiz, PASTA_CACHE_AUDIO), o);
