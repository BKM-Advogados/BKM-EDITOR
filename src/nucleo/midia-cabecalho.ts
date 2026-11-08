// Duração e dimensões lidas só do cabeçalho do arquivo, sem decodificar nada (frente Casca, rodada 3): o painel de mídia e o
// `listar_midia` mostram a duração de um WAV, de um MP4/MOV/M4A e o tamanho de um PNG, JPEG, GIF ou WebP sem abrir o arquivo
// inteiro. O que não está aqui (MP3, OGG, WebM, MKV) volta nulo, e a interface mede com o próprio navegador quando precisa.
// Puro: recebe bytes, ou um leitor de pedaços; o disco fica em midia-disco.ts.

/** Devolve até `n` bytes a partir de `posicao` (menos, ou nenhum, perto do fim do arquivo). */
export type Leitor = (posicao: number, n: number) => Uint8Array;

const u16 = (b: Uint8Array, o: number) => ((b[o] << 8) | b[o + 1]) >>> 0;
const u32 = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const u16le = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8)) >>> 0;
const u32le = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const u24le = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) >>> 0;
const ascii = (b: Uint8Array, o: number, n: number) => String.fromCharCode(...Array.from(b.subarray(o, o + n)));

export type Dimensoes = {largura: number; altura: number};

/** PNG, GIF, JPEG e WebP. Os primeiros 64 KB bastam para quase todo arquivo; JPEG com EXIF enorme pode voltar nulo. */
export const dimensoesDaImagem = (b: Uint8Array): Dimensoes | null => {
  if (b.length >= 24 && b[0] === 0x89 && ascii(b, 1, 3) === 'PNG' && ascii(b, 12, 4) === 'IHDR') return {largura: u32(b, 16), altura: u32(b, 20)};
  if (b.length >= 10 && ascii(b, 0, 4) === 'GIF8') return {largura: u16le(b, 6), altura: u16le(b, 8)};
  if (b.length >= 30 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') {
    const tipo = ascii(b, 12, 4);
    if (tipo === 'VP8 ' && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) return {largura: u16le(b, 26) & 0x3fff, altura: u16le(b, 28) & 0x3fff};
    if (tipo === 'VP8L' && b[20] === 0x2f) {
      const bits = u32le(b, 21);
      return {largura: (bits & 0x3fff) + 1, altura: ((bits >>> 14) & 0x3fff) + 1};
    }
    if (tipo === 'VP8X') return {largura: u24le(b, 24) + 1, altura: u24le(b, 27) + 1};
    return null;
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let p = 2;
    while (p + 9 < b.length) {
      if (b[p] !== 0xff) return null;
      const marcador = b[p + 1];
      if (marcador === 0xff) {
        p++; // preenchimento
        continue;
      }
      // SOF0 a SOF15, menos DHT (C4), JPG (C8) e DAC (CC)
      if (marcador >= 0xc0 && marcador <= 0xcf && marcador !== 0xc4 && marcador !== 0xc8 && marcador !== 0xcc) return {largura: u16(b, p + 7), altura: u16(b, p + 5)};
      if (marcador === 0xd8 || (marcador >= 0xd0 && marcador <= 0xd7) || marcador === 0x01) {
        p += 2;
        continue;
      }
      p += 2 + u16(b, p + 2);
    }
  }
  return null;
};

/** Duração (ms) de um WAV pelo cabeçalho: o tamanho do chunk `data` dividido pela taxa de bytes. `tamanhoDoArquivo` cobre o
 *  WAV de gravação em andamento, que deixa o tamanho em 0 ou 0xFFFFFFFF. */
export const duracaoDeWav = (b: Uint8Array, tamanhoDoArquivo: number): number | null => {
  if (b.length < 20 || ascii(b, 0, 4) !== 'RIFF' || ascii(b, 8, 4) !== 'WAVE') return null;
  let taxa = 0;
  let p = 12;
  while (p + 8 <= b.length) {
    const id = ascii(b, p, 4);
    const tam = u32le(b, p + 4);
    if (id === 'fmt ' && p + 20 <= b.length) taxa = u32le(b, p + 16);
    if (id === 'data') {
      if (!taxa) return null;
      const bytes = tam === 0 || tam === 0xffffffff || p + 8 + tam > tamanhoDoArquivo ? tamanhoDoArquivo - (p + 8) : tam;
      return Math.round((bytes / taxa) * 1000);
    }
    p += 8 + tam + (tam % 2); // os chunks do RIFF têm tamanho par
  }
  return null;
};

/** Duração (ms) de MP4, MOV e M4A: o `mvhd` dentro do `moov`, que pode estar no começo ou no fim do arquivo. */
export const duracaoDeMp4 = (ler: Leitor, tamanho: number): number | null => {
  const caixa = (pos: number, fim: number) => {
    const c = ler(pos, 16);
    if (c.length < 8) return null;
    let tam = u32(c, 0);
    let cab = 8;
    if (tam === 1 && c.length >= 16) {
      tam = u32(c, 8) * 2 ** 32 + u32(c, 12);
      cab = 16;
    } else if (tam === 0) tam = fim - pos;
    if (tam < cab || pos + tam > fim) return null;
    return {tipo: ascii(c, 4, 4), tam, cab};
  };
  let pos = 0;
  for (let i = 0; i < 200 && pos < tamanho; i++) {
    const c = caixa(pos, tamanho);
    if (!c) return null;
    if (c.tipo === 'moov') {
      let q = pos + c.cab;
      for (let j = 0; j < 200 && q < pos + c.tam; j++) {
        const f = caixa(q, pos + c.tam);
        if (!f) return null;
        if (f.tipo === 'mvhd') {
          const m = ler(q + f.cab, 32);
          if (m.length < 20) return null;
          const v1 = m[0] === 1;
          const escala = u32(m, v1 ? 20 : 12);
          const dur = v1 ? u32(m, 24) * 2 ** 32 + u32(m, 28) : u32(m, 16);
          return escala ? Math.round((dur / escala) * 1000) : null;
        }
        q += f.tam;
      }
      return null;
    }
    pos += c.tam;
  }
  return null;
};
