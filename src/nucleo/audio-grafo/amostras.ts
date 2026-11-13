// Amostras lidas por trecho (M-04): a base da memória limitada do motor. Uma `FonteAmostras` entrega qualquer trecho de
// um som sem precisar dele inteiro na memória: um buffer pronto, um instrumento que renderiza só o trecho pedido, um
// arquivo do cache em disco ou, na onda M2, a amostra de um sampler carregada aos poucos. Um `ArmazemAudio` guarda e
// devolve saídas de nós por chave (o cache em disco com LRU de src/nucleo/cache-audio.ts, ou o de memória daqui).
// Puro: nada de Node, para rodar igual no worker da janela, no processo principal e no MCP por stdio.
// Ver docs/audio-grafo.md, "Memória".

/** Um som de `canais` canais e `n` amostras por canal, lido por trecho. Fora de [0, n) é silêncio (+0). */
export interface FonteAmostras {
  readonly canais: number;
  readonly n: number;
  /** Escreve em `dest[c][off + i]` a amostra `inicio + i` do canal c, para i em [0, qtd). */
  ler(inicio: number, qtd: number, dest: readonly Float32Array[], off?: number): void;
  /** Solta o que a fonte segura (um arquivo aberto). Ler depois disso é erro. */
  fechar?(): void;
}

/** Recebe um som em ordem, bloco a bloco, e o guarda quando `concluir`. `descartar` desiste (um render que falhou). */
export interface GravadorAmostras {
  /** As amostras `[inicio, inicio + qtd)` de cada canal, tiradas de `canais[c][off..]`. Vem em ordem, sem buraco. */
  escrever(canais: readonly Float32Array[], inicio: number, qtd: number, off?: number): void;
  concluir(): void;
  descartar(): void;
}

/** Saídas de nós guardadas por chave (o conteúdo: muda a chave sempre que muda o som). */
export interface ArmazemAudio {
  /** A saída guardada com essa chave, `canais` e `n`, ou null. Marca o uso (LRU). */
  abrir(chave: string, canais: number, n: number): FonteAmostras | null;
  /** Um gravador para guardar a saída dessa chave, ou null se não convém guardar (maior que o teto, por exemplo). */
  gravar(chave: string, canais: number, n: number): GravadorAmostras | null;
}

/** Copia `[inicio, inicio + qtd)` de buffers inteiros, com silêncio fora deles. */
const copiar = (src: readonly Float32Array[], n: number, inicio: number, qtd: number, dest: readonly Float32Array[], off: number) => {
  for (let c = 0; c < dest.length; c++) {
    const s = src[c], d = dest[c];
    const a = Math.max(0, -inicio), b = Math.min(qtd, n - inicio);
    if (b <= a) {
      d.fill(0, off, off + qtd);
      continue;
    }
    if (a > 0) d.fill(0, off, off + a);
    d.set(s.subarray(inicio + a, inicio + b), off + a);
    if (b < qtd) d.fill(0, off + b, off + qtd);
  }
};

/** Buffers que já estão na memória (o som seco da prévia, um áudio decodificado). */
export const fonteDeMemoria = (canais: readonly Float32Array[]): FonteAmostras & {buffers: readonly Float32Array[]} => {
  const n = canais[0]?.length ?? 0;
  return {canais: canais.length, n, buffers: canais, ler: (inicio, qtd, dest, off = 0) => copiar(canais, n, inicio, qtd, dest, off)};
};

/** Carga preguiçosa: o som é feito por trechos de `trecho` amostras, só quando lido, e só o último trecho fica na memória
 *  (mais o anterior, para uma leitura que cruza a borda). `fazer(de, ate)` devolve `ate − de` amostras por canal e tem que
 *  dar, para cada amostra, o mesmo que daria o som inteiro (os instrumentos de instrumentos.ts garantem). */
export const fontePorTrechos = (o: {canais: number; n: number; trecho: number; fazer: (de: number, ate: number) => Float32Array[]}): FonteAmostras => {
  const {canais, n, trecho, fazer} = o;
  if (!(trecho >= 1)) throw new Error('fontePorTrechos: trecho inválido');
  const guardados: {k: number; bufs: Float32Array[]}[] = [];
  const pegar = (k: number) => {
    let g = guardados.find((x) => x.k === k);
    if (!g) {
      const de = k * trecho, ate = Math.min(n, de + trecho);
      g = {k, bufs: fazer(de, ate)};
      if (g.bufs.length !== canais || g.bufs.some((b) => b.length !== ate - de)) throw new Error('fontePorTrechos: o trecho veio com canais ou amostras a mais ou a menos');
      guardados.push(g);
      if (guardados.length > 2) guardados.shift();
    }
    return g.bufs;
  };
  return {
    canais, n,
    ler(inicio, qtd, dest, off = 0) {
      let i = 0;
      while (i < qtd) {
        const j = inicio + i;
        if (j < 0 || j >= n) {
          const ate = j < 0 ? Math.min(qtd, -inicio) : qtd;
          for (const d of dest) d.fill(0, off + i, off + ate);
          i = ate;
          continue;
        }
        const k = Math.floor(j / trecho), base = k * trecho;
        const bufs = pegar(k);
        const ate = Math.min(qtd, base + bufs[0].length - inicio);
        for (let c = 0; c < canais; c++) dest[c].set(bufs[c].subarray(j - base, j - base + (ate - i)), off + i);
        i = ate;
      }
    },
    fechar() {
      guardados.length = 0;
    },
  };
};

/** Armazém na memória, com teto em bytes e LRU (o menos usado sai primeiro). Para testes e para quem não tem disco. */
export const armazemDeMemoria = (teto_bytes = Infinity) => {
  const itens = new Map<string, Float32Array[]>(); // a ordem do Map é a do uso: o primeiro é o mais antigo
  let bytes = 0;
  const tamanho = (c: Float32Array[]) => c.reduce((s, x) => s + x.byteLength, 0);
  const caber = () => {
    for (const [k, v] of itens) {
      if (bytes <= teto_bytes) break;
      itens.delete(k);
      bytes -= tamanho(v);
    }
  };
  const armazem: ArmazemAudio & {readonly bytes: number; chaves(): string[]} = {
    get bytes() {
      return bytes;
    },
    chaves: () => [...itens.keys()],
    abrir(chave, canais, n) {
      const v = itens.get(chave);
      if (!v || v.length !== canais || v[0].length !== n) return null;
      itens.delete(chave);
      itens.set(chave, v);
      return fonteDeMemoria(v);
    },
    gravar(chave, canais, n) {
      if (canais * n * 4 > teto_bytes) return null;
      const bufs = Array.from({length: canais}, () => new Float32Array(n));
      let feito = 0;
      return {
        escrever(src, inicio, qtd, off = 0) {
          if (inicio !== feito) throw new Error(`armazém: escrita fora de ordem (${inicio}, esperava ${feito})`);
          for (let c = 0; c < canais; c++) bufs[c].set(src[c].subarray(off, off + qtd), inicio);
          feito += qtd;
        },
        concluir() {
          if (feito !== n) throw new Error(`armazém: ${feito} de ${n} amostras`);
          const antes = itens.get(chave);
          if (antes) bytes -= tamanho(antes);
          itens.delete(chave);
          itens.set(chave, bufs);
          bytes += tamanho(bufs);
          caber();
        },
        descartar() {},
      };
    },
  };
  return armazem;
};
