// Áudio sintético para a prévia web (ponte simulada) e para o teste de exportação (exportar-teste.mjs): uma "narração"
// (sílabas de tom com harmônicos e um pouco de ruído, em frases separadas por pausas) e uma "música" (acorde sustentado
// com tremolo), codificadas em WAV de 16 bits. Determinístico: o ruído sai de um gerador com semente fixa.
export const TAXA = 22050;

const gerador = (semente: number) => {
  let x = semente >>> 0;
  return () => {
    x = (x * 1664525 + 1013904223) >>> 0;
    return x / 0xffffffff - 0.5;
  };
};

/** Frases de 2,3 a 3,2 s com pausas de 1 a 1,2 s; sílabas de 130 ms a 150–230 Hz com seis harmônicos. RMS perto de −20 dBFS. */
export const narracaoSintetica = (segundos = 12, taxa = TAXA): Float32Array => {
  const n = Math.round(segundos * taxa);
  const out = new Float32Array(n);
  const ruido = gerador(7);
  const frases: [number, number][] = [];
  for (let t = 0.3, k = 0; t < segundos - 0.4; k++) {
    const fim = Math.min(segundos - 0.2, t + 2.3 + (k % 3) * 0.45);
    frases.push([t, fim]);
    t = fim + 1 + (k % 2) * 0.2;
  }
  let fase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / taxa;
    let v = ruido() * 0.004; // sala
    const frase = frases.find(([a, b]) => t >= a && t < b);
    if (frase) {
      const dentro = t - frase[0];
      const silaba = dentro % 0.18; // 130 ms de som, 50 ms de respiro
      if (silaba < 0.13) {
        const idx = Math.floor(dentro / 0.18);
        const f0 = 150 + 80 * (0.5 + 0.5 * Math.sin(idx * 1.7 + frase[0]));
        fase += (2 * Math.PI * f0) / taxa;
        const env = Math.min(1, silaba / 0.015, (0.13 - silaba) / 0.03);
        let s = 0;
        for (let h = 1; h <= 6; h++) s += Math.sin(fase * h) / h;
        v += s * 0.17 * env + ruido() * 0.02 * env;
      }
    }
    out[i] = Math.max(-1, Math.min(1, v));
  }
  return out;
};

/** Acorde de Lá maior (220, 277, 330 e 440 Hz) com tremolo lento. RMS perto de −15 dBFS: alto de propósito, para o ducking ter o que baixar. */
export const musicaSintetica = (segundos = 14, taxa = TAXA): Float32Array => {
  const n = Math.round(segundos * taxa);
  const out = new Float32Array(n);
  const notas = [220, 277.18, 329.63, 440];
  for (let i = 0; i < n; i++) {
    const t = i / taxa;
    const tremolo = 0.85 + 0.15 * Math.sin(2 * Math.PI * 0.3 * t);
    const entrada = Math.min(1, t / 0.5);
    let v = 0;
    for (const [k, f] of notas.entries()) v += Math.sin(2 * Math.PI * f * t + k) * 0.12 * (1 - k * 0.1);
    out[i] = v * tremolo * entrada;
  }
  return out;
};

/** WAV PCM de 16 bits, canais intercalados. */
export const codificarWav = (canais: Float32Array[], taxa: number): Uint8Array<ArrayBuffer> => {
  const nc = canais.length;
  const n = canais[0].length;
  const bytes = 44 + n * nc * 2;
  const buf = new ArrayBuffer(bytes);
  const v = new DataView(buf);
  const texto = (p: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(p + i, s.charCodeAt(i));
  };
  texto(0, 'RIFF');
  v.setUint32(4, bytes - 8, true);
  texto(8, 'WAVE');
  texto(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, nc, true);
  v.setUint32(24, taxa, true);
  v.setUint32(28, taxa * nc * 2, true);
  v.setUint16(32, nc * 2, true);
  v.setUint16(34, 16, true);
  texto(36, 'data');
  v.setUint32(40, n * nc * 2, true);
  let p = 44;
  for (let i = 0; i < n; i++) {
    for (const c of canais) {
      v.setInt16(p, Math.round(Math.max(-1, Math.min(1, c[i])) * 32767), true);
      p += 2;
    }
  }
  return new Uint8Array(buf);
};

/** Lê um WAV PCM de 16 bits (o que codificarWav grava), para o teste de exportação medir o envelope sem Web Audio. */
export const decodificarWav = (dados: Uint8Array): {canais: Float32Array[]; taxa: number} => {
  const v = new DataView(dados.buffer, dados.byteOffset, dados.byteLength);
  const nc = v.getUint16(22, true);
  const taxa = v.getUint32(24, true);
  const bits = v.getUint16(34, true);
  if (bits !== 16) throw new Error(`WAV de ${bits} bits não é o que este leitor espera (16)`);
  let p = 12;
  while (p < dados.byteLength - 8) {
    const id = String.fromCharCode(v.getUint8(p), v.getUint8(p + 1), v.getUint8(p + 2), v.getUint8(p + 3));
    const tam = v.getUint32(p + 4, true);
    if (id === 'data') {
      const n = Math.floor(tam / (nc * 2));
      const canais = Array.from({length: nc}, () => new Float32Array(n));
      let q = p + 8;
      for (let i = 0; i < n; i++) for (let c = 0; c < nc; c++, q += 2) canais[c][i] = v.getInt16(q, true) / 32768;
      return {canais, taxa};
    }
    p += 8 + tam + (tam % 2);
  }
  throw new Error('WAV sem bloco "data"');
};
