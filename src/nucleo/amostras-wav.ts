// WAV lido por trecho (M-04): a primeira fonte de amostras preguiçosa de arquivo, base do sampler da M2 (I-02, I-03). Só
// o cabeçalho é lido na abertura; as amostras vêm do disco em trechos, quando alguém lê, e só o trecho atual (e o
// anterior) fica na memória. Lê os mesmos formatos e dá os mesmos valores que lerWav (src/main/ffmpeg-som.ts): PCM de 16,
// 24 e 32 bits e float de 32 bits, WAVE_FORMAT_EXTENSIBLE incluído. Node (fs); o núcleo puro só conhece a interface
// FonteAmostras (audio-grafo/amostras.ts). Ver docs/audio-grafo.md, "Memória".
import {closeSync, fstatSync, openSync, readSync} from 'node:fs';
import {fontePorTrechos, type FonteAmostras} from './audio-grafo/amostras';

/** Quadros (uma amostra de cada canal) lidos do disco de uma vez. */
const TRECHO_WAV = 1 << 15;

export type FonteWav = FonteAmostras & {taxa: number; bits: number; formato: 'pcm' | 'float'};

/** Abre um WAV para leitura por trecho. Feche com `fechar()` (o arquivo fica aberto até lá). */
export const abrirWav = (caminho: string, o: {trecho?: number} = {}): FonteWav => {
  const fd = openSync(caminho, 'r');
  try {
    const tamArquivo = fstatSync(fd).size;
    const ler = (pos: number, tam: number) => {
      const b = new Uint8Array(tam);
      let feito = 0;
      while (feito < tam) {
        const r = readSync(fd, b, feito, tam - feito, pos + feito);
        if (r <= 0) break;
        feito += r;
      }
      return new DataView(b.buffer, 0, feito);
    };
    const texto = (v: DataView, p: number) => String.fromCharCode(v.getUint8(p), v.getUint8(p + 1), v.getUint8(p + 2), v.getUint8(p + 3));
    const cab = ler(0, 12);
    if (cab.byteLength < 12 || texto(cab, 0) !== 'RIFF' || texto(cab, 8) !== 'WAVE') throw new Error('não é um WAV');
    let p = 12;
    let fmt: {formato: number; nc: number; taxa: number; bits: number} | null = null;
    while (p + 8 <= tamArquivo) {
      const c = ler(p, 8);
      const id = texto(c, 0), tam = c.getUint32(4, true);
      if (id === 'fmt ') {
        const f = ler(p + 8, Math.min(tam, 40));
        let formato = f.getUint16(0, true);
        if (formato === 0xfffe) formato = f.getUint16(24, true); // WAVE_FORMAT_EXTENSIBLE: o subformato vem no GUID
        fmt = {formato, nc: f.getUint16(2, true), taxa: f.getUint32(4, true), bits: f.getUint16(14, true)};
      } else if (id === 'data') {
        if (!fmt) throw new Error('WAV sem bloco "fmt "');
        const {formato, nc, taxa, bits} = fmt;
        const bpa = bits / 8;
        const resto = tamArquivo - (p + 8);
        const bytes = tam === 0 || tam === 0xffffffff || tam > resto ? resto : tam;
        const n = Math.floor(bytes / (nc * bpa));
        const conv = formato === 3 && bits === 32 ? (v: DataView, q: number) => v.getFloat32(q, true)
          : formato === 1 && bits === 16 ? (v: DataView, q: number) => v.getInt16(q, true) / 32768
            : formato === 1 && bits === 24 ? (v: DataView, q: number) => (v.getUint8(q) | (v.getUint8(q + 1) << 8) | (v.getInt8(q + 2) << 16)) / 8388608
              : formato === 1 && bits === 32 ? (v: DataView, q: number) => v.getInt32(q, true) / 2147483648 : null;
        if (!conv) throw new Error(`WAV em formato ${formato} de ${bits} bits não é lido aqui`);
        const inicioDados = p + 8;
        let aberto = true;
        const f = fontePorTrechos({canais: nc, n, trecho: o.trecho ?? TRECHO_WAV, fazer: (de, ate) => {
          if (!aberto) throw new Error('WAV: leitura depois de fechar');
          const v = ler(inicioDados + de * nc * bpa, (ate - de) * nc * bpa);
          const out = Array.from({length: nc}, () => new Float32Array(ate - de));
          const quadros = Math.floor(v.byteLength / (nc * bpa)); // arquivo encurtado depois de aberto: o resto fica em silêncio
          for (let i = 0, q = 0; i < quadros; i++) for (let c = 0; c < nc; c++, q += bpa) out[c][i] = conv(v, q);
          return out;
        }});
        return {canais: nc, n, taxa, bits, formato: formato === 3 ? 'float' : 'pcm', ler: f.ler,
          fechar: () => {
            if (!aberto) return;
            aberto = false;
            f.fechar?.();
            closeSync(fd);
          }};
      }
      p += 8 + tam + (tam % 2);
    }
    throw new Error('WAV sem bloco "data"');
  } catch (e) {
    closeSync(fd);
    throw e;
  }
};
