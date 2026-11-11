// Arquivo MIDI padrão (SMF, formatos 0 e 1) lido e gravado em TypeScript puro, sem biblioteca: só o que a música usa
// (notas, andamento, fórmula de compasso, nome da trilha, programa e marcadores). Divisão em SMPTE não é lida. Os
// eventos de controle, pitch bend e sysex são pulados. Ver docs/musica.md, "MIDI".

export type NotaMidi = {tick: number; dur: number; nota: number; forca: number};
/** Uma trilha por canal: um arquivo de formato 0, ou uma trilha do formato 1 com dois canais, vira duas. */
export type TrilhaMidi = {nome?: string; canal: number; programa?: number; notas: NotaMidi[]};
export type ArquivoMidi = {ppq: number; bpm?: number; compasso?: [number, number]; trilhas: TrilhaMidi[]; marcadores: {tick: number; texto: string}[]};

const texto = (b: Uint8Array) => new TextDecoder('utf-8').decode(b);

/** Lê um .mid. Erro com a frase para a pessoa quando o arquivo não é MIDI ou está cortado. */
export const lerMidi = (bytes: Uint8Array): ArquivoMidi => {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (p: number) => String.fromCharCode(bytes[p], bytes[p + 1], bytes[p + 2], bytes[p + 3]);
  if (bytes.length < 14 || tag(0) !== 'MThd') throw new Error('não é um arquivo MIDI (falta o cabeçalho MThd)');
  const formato = v.getUint16(8);
  const nTrilhas = v.getUint16(10);
  const divisao = v.getUint16(12);
  if (divisao & 0x8000) throw new Error('MIDI com tempo em SMPTE não é lido; exporte com tempo em batidas (PPQ)');
  if (formato > 1) throw new Error(`MIDI de formato ${formato} não é lido (só 0 e 1)`);
  const ppq = divisao || 480;
  const out: ArquivoMidi = {ppq, trilhas: [], marcadores: []};
  let p = 8 + v.getUint32(4);
  for (let t = 0; t < nTrilhas && p + 8 <= bytes.length; t++) {
    const tam = v.getUint32(p + 4);
    if (tag(p) !== 'MTrk') {
      p += 8 + tam; // pedaço desconhecido: pula
      t--;
      continue;
    }
    const fim = Math.min(bytes.length, p + 8 + tam);
    let i = p + 8;
    p = fim;
    let tick = 0;
    let status = 0;
    let nome: string | undefined;
    const porCanal = new Map<number, TrilhaMidi>();
    const abertas = new Map<number, {tick: number; forca: number}[]>(); // canal * 128 + nota → notas tocando (a primeira fecha primeiro)
    const trilha = (canal: number) => {
      let x = porCanal.get(canal);
      if (!x) porCanal.set(canal, (x = {canal, notas: []}));
      return x;
    };
    const vlq = () => {
      let n = 0;
      for (let k = 0; k < 4 && i < fim; k++) {
        const b = bytes[i++];
        n = (n << 7) | (b & 0x7f);
        if (!(b & 0x80)) break;
      }
      return n;
    };
    const fechar = (canal: number, nota: number) => {
      const fila = abertas.get(canal * 128 + nota);
      const a = fila?.shift();
      if (a) trilha(canal).notas.push({tick: a.tick, dur: Math.max(1, tick - a.tick), nota, forca: a.forca});
    };
    while (i < fim) {
      tick += vlq();
      let b = bytes[i];
      if (b & 0x80) {
        i++;
        if (b < 0xf0) status = b;
      } else b = status; // running status
      if (b === 0xff) {
        const tipo = bytes[i++];
        const n = vlq();
        const dados = bytes.subarray(i, Math.min(fim, i + n));
        i += n;
        if (tipo === 0x2f) break;
        if (tipo === 0x51 && n === 3 && out.bpm === undefined) out.bpm = Math.round((60e6 / ((dados[0] << 16) | (dados[1] << 8) | dados[2])) * 100) / 100;
        else if (tipo === 0x58 && n >= 2 && !out.compasso) out.compasso = [dados[0], 2 ** dados[1]];
        else if (tipo === 0x03 && nome === undefined) nome = texto(dados).trim();
        else if (tipo === 0x06) out.marcadores.push({tick, texto: texto(dados).trim()});
        continue;
      }
      if (b === 0xf0 || b === 0xf7) {
        i += vlq();
        continue;
      }
      if (!(b & 0x80)) throw new Error('MIDI cortado ou estragado (evento sem status)');
      const tipo = b & 0xf0;
      const canal = b & 0x0f;
      const d1 = bytes[i++];
      const d2 = tipo === 0xc0 || tipo === 0xd0 ? 0 : bytes[i++];
      if (tipo === 0x90 && d2 > 0) {
        const k = canal * 128 + d1;
        abertas.set(k, [...(abertas.get(k) ?? []), {tick, forca: d2}]);
        trilha(canal);
      } else if (tipo === 0x80 || tipo === 0x90) fechar(canal, d1);
      else if (tipo === 0xc0) {
        const x = trilha(canal);
        if (x.programa === undefined) x.programa = d1;
      }
    }
    // nota que nunca fechou termina no fim da trilha
    for (const [k, fila] of abertas) for (const a of fila) trilha(Math.floor(k / 128)).notas.push({tick: a.tick, dur: Math.max(1, tick - a.tick), nota: k % 128, forca: a.forca});
    for (const x of porCanal.values()) {
      if (!x.notas.length) continue;
      x.notas.sort((a, b) => a.tick - b.tick || a.nota - b.nota);
      out.trilhas.push({...x, ...(nome ? {nome: porCanal.size > 1 ? `${nome} (canal ${x.canal + 1})` : nome} : {})});
    }
  }
  return out;
};

const comVlq = (n: number) => {
  const b = [n & 0x7f];
  while ((n >>= 7) > 0) b.unshift((n & 0x7f) | 0x80);
  return b;
};
const bytesDe = (s: string) => [...new TextEncoder().encode(s)];

/** Grava um .mid de formato 1: a trilha 0 com andamento, compasso e marcadores, e uma trilha por TrilhaMidi. */
export const gravarMidi = (a: ArquivoMidi): Uint8Array => {
  type Ev = {tick: number; ordem: number; dados: number[]};
  const pedaco = (evs: Ev[]) => {
    evs.sort((x, y) => x.tick - y.tick || x.ordem - y.ordem);
    const corpo: number[] = [];
    let antes = 0;
    for (const e of evs) {
      corpo.push(...comVlq(Math.max(0, e.tick - antes)), ...e.dados);
      antes = Math.max(antes, e.tick);
    }
    corpo.push(0, 0xff, 0x2f, 0);
    return [0x4d, 0x54, 0x72, 0x6b, (corpo.length >>> 24) & 0xff, (corpo.length >>> 16) & 0xff, (corpo.length >>> 8) & 0xff, corpo.length & 0xff, ...corpo];
  };
  const meta = (tick: number, tipo: number, dados: number[], ordem = 0): Ev => ({tick, ordem, dados: [0xff, tipo, ...comVlq(dados.length), ...dados]});
  const t0: Ev[] = [];
  const uspq = Math.round(60e6 / (a.bpm ?? 120));
  t0.push(meta(0, 0x51, [(uspq >> 16) & 0xff, (uspq >> 8) & 0xff, uspq & 0xff]));
  const [num, den] = a.compasso ?? [4, 4];
  t0.push(meta(0, 0x58, [num, Math.round(Math.log2(den)), 24, 8]));
  for (const m of a.marcadores) t0.push(meta(m.tick, 0x06, bytesDe(m.texto), 1));
  const trilhas = a.trilhas.map((t) => {
    const evs: Ev[] = [];
    if (t.nome) evs.push(meta(0, 0x03, bytesDe(t.nome)));
    if (t.programa !== undefined) evs.push({tick: 0, ordem: 1, dados: [0xc0 | t.canal, t.programa & 0x7f]});
    for (const n of t.notas) {
      if (!(n.nota >= 0 && n.nota <= 127)) continue; // & 0x7f daria a volta (130 viraria 2): quem chama avisa
      const forca = Math.min(127, Math.max(1, Math.round(n.forca)));
      evs.push({tick: n.tick, ordem: 3, dados: [0x90 | t.canal, n.nota & 0x7f, forca]});
      evs.push({tick: n.tick + Math.max(1, n.dur), ordem: 2, dados: [0x80 | t.canal, n.nota & 0x7f, 0]}); // a que termina sai antes da que começa no mesmo tick
    }
    return pedaco(evs);
  });
  const nt = trilhas.length + 1;
  const cab = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, (nt >> 8) & 0xff, nt & 0xff, (a.ppq >> 8) & 0xff, a.ppq & 0xff];
  return Uint8Array.from([...cab, ...pedaco(t0), ...trilhas.flat()]);
};
