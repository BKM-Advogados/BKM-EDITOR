// Contrato de determinismo da música (M-03, ADR A4 de docs/musica-daw.md): o render canônico (offline, o mesmo código na
// janela, no worker, no processo principal e no MCP por stdio) tem que dar o mesmo PCM em todo lugar, e a impressão
// digital dele é o SHA-256 dos bytes float32 little-endian, intercalados (L0 R0 L1 R1 ...), da mistura final (depois do
// master e do limitador), antes de qualquer conversão para 16 ou 24 bits. Puro: sem node:crypto nem crypto.subtle (que é
// assíncrono e não existe em todo worker), para rodar igual nos quatro lugares. Os documentos de referência e os hashes
// esperados ficam em testes/fixtures/musica-referencia/; ver docs/musica.md, seção "Determinismo".
import type {FonteAudio} from './loudness';
import type {DocMusica} from './musica';
import {renderizarMusica, TAXA_MUSICA} from './musica-som';

// ---------- SHA-256 (FIPS 180-4), incremental ----------
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** SHA-256 em pedaços: `somar` quantas vezes quiser, `fim` uma vez (devolve o hex de 64 caracteres). */
export class Sha256 {
  private h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  private w = new Uint32Array(64);
  private bloco = new Uint8Array(64);
  private noBloco = 0;
  private total = 0; // bytes

  private comprimir(b: Uint8Array, p: number) {
    const w = this.w;
    for (let i = 0; i < 16; i++) w[i] = (b[p + 4 * i] << 24) | (b[p + 4 * i + 1] << 16) | (b[p + 4 * i + 2] << 8) | b[p + 4 * i + 3];
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15], c = w[i - 2];
      const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
      const s1 = ((c >>> 17) | (c << 15)) ^ ((c >>> 19) | (c << 13)) ^ (c >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    const h = this.h;
    let A = h[0], B = h[1], C = h[2], D = h[3], E = h[4], F = h[5], G = h[6], H = h[7];
    for (let i = 0; i < 64; i++) {
      const S1 = ((E >>> 6) | (E << 26)) ^ ((E >>> 11) | (E << 21)) ^ ((E >>> 25) | (E << 7));
      const t1 = (H + S1 + ((E & F) ^ (~E & G)) + K[i] + w[i]) | 0;
      const S0 = ((A >>> 2) | (A << 30)) ^ ((A >>> 13) | (A << 19)) ^ ((A >>> 22) | (A << 10));
      const t2 = (S0 + ((A & B) ^ (A & C) ^ (B & C))) | 0;
      H = G;
      G = F;
      F = E;
      E = (D + t1) | 0;
      D = C;
      C = B;
      B = A;
      A = (t1 + t2) | 0;
    }
    h[0] += A;
    h[1] += B;
    h[2] += C;
    h[3] += D;
    h[4] += E;
    h[5] += F;
    h[6] += G;
    h[7] += H;
  }

  somar(dados: Uint8Array) {
    let i = 0;
    this.total += dados.length;
    if (this.noBloco) {
      const falta = Math.min(64 - this.noBloco, dados.length);
      this.bloco.set(dados.subarray(0, falta), this.noBloco);
      this.noBloco += falta;
      i = falta;
      if (this.noBloco < 64) return this;
      this.comprimir(this.bloco, 0);
      this.noBloco = 0;
    }
    for (; i + 64 <= dados.length; i += 64) this.comprimir(dados, i);
    if (i < dados.length) {
      this.bloco.set(dados.subarray(i), 0);
      this.noBloco = dados.length - i;
    }
    return this;
  }

  fim(): string {
    const bits = this.total * 8;
    const resto = new Uint8Array(((this.noBloco < 56 ? 56 : 120) - this.noBloco) + 8);
    resto[0] = 0x80;
    const v = new DataView(resto.buffer);
    v.setUint32(resto.length - 8, Math.floor(bits / 0x100000000));
    v.setUint32(resto.length - 4, bits >>> 0);
    this.somar(resto);
    return Array.from(this.h, (x) => x.toString(16).padStart(8, '0')).join('');
  }
}

/** SHA-256 de bytes, em hex. */
export const sha256 = (dados: Uint8Array) => new Sha256().somar(dados).fim();

// ---------- o PCM ----------
const PEDACO = 8192; // amostras por canal convertidas de cada vez (64 KiB em estéreo): sem copiar a música inteira

/** SHA-256 do PCM: float32 little-endian, canais intercalados, em qualquer máquina (o DataView fixa a ordem dos bytes).
 *  Os bits vão como estão: −0 e +0 contam diferente, de propósito (o contrato é bit a bit). */
export const hashDoPcm = (canais: Float32Array[]): string => {
  const nc = canais.length;
  const n = canais[0]?.length ?? 0;
  if (canais.some((c) => c.length !== n)) throw new Error('hashDoPcm: canais de tamanhos diferentes');
  const s = new Sha256();
  const buf = new Uint8Array(PEDACO * nc * 4);
  const v = new DataView(buf.buffer);
  for (let i0 = 0; i0 < n; i0 += PEDACO) {
    const f = Math.min(n, i0 + PEDACO);
    let p = 0;
    for (let i = i0; i < f; i++) for (let k = 0; k < nc; k++, p += 4) v.setFloat32(p, canais[k][i], true);
    s.somar(buf.subarray(0, p));
  }
  return s.fim();
};

/** A impressão digital de um render: o hash, quantas amostras por canal, quantos canais e a taxa. */
export type HashMusica = {pcm_sha256: string; amostras: number; canais: number; taxa: number};

export const hashDoRender = (canais: Float32Array[], taxa: number): HashMusica =>
  ({pcm_sha256: hashDoPcm(canais), amostras: canais[0]?.length ?? 0, canais: canais.length, taxa});

/** Renderiza o documento (render canônico: sem cache, na taxa do vídeo) e devolve a impressão digital do PCM. */
export const hashDaMusica = (doc: DocMusica, fontes: Record<string, FonteAudio | undefined> = {}, o: {taxa?: number} = {}): HashMusica => {
  const r = renderizarMusica(doc, fontes, {taxa: o.taxa ?? TAXA_MUSICA});
  return hashDoRender(r.canais, r.taxa);
};
