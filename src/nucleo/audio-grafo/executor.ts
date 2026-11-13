// O executor offline do grafo (M-01): roda os processadores em blocos de tamanho fixo (128 amostras por padrão), na ordem
// topológica estável, somando as ligações de cada entrada na ordem em que entraram. É o render canônico (ADR A4): o mesmo
// grafo, o mesmo bloco e a mesma ordem dão o mesmo PCM no worker, no processo principal e no MCP por stdio.
//
// Duas coisas além do laço simples:
// - Compensação de latência (PDC): cada nó sabe a latência que chega a ele (a maior das entradas) e cada ligação que vem
//   de um caminho mais curto passa por uma linha de atraso; no fim, o atraso da saída é descartado (o executor roda
//   `latência` amostras a mais, com as fontes em silêncio).
// - Adaptadores de buffer inteiro (`ProcessadorInteiro`): dividem o render em estágios. No estágio s rodam os nós por
//   bloco que dependem só do que já existe; a entrada de um adaptador é juntada inteira e, no fim do estágio, ele roda e a
//   saída vira fonte do estágio seguinte. Saídas por bloco que um estágio posterior lê são gravadas inteiras.
//   Sem adaptadores, tudo roda num estágio só, com memória limitada ao que se pede para coletar.
//
// Memória (M-04): o que não precisa voltar inteiro não fica inteiro. A saída pode ir bloco a bloco para `aoBloco` (um WAV
// em streaming), um nó com chave pode ser guardado num `armazem` (o cache em disco) enquanto roda, sem cópia inteira na
// memória, e um nó guardado é lido de volta por trecho. O cache em Map (o da prévia na janela) continua como antes.
// Ver docs/audio-grafo.md.
import type {ArmazemAudio, FonteAmostras, GravadorAmostras} from './amostras';
import {fonteDeMemoria} from './amostras';
import {Atraso} from './processadores';
import type {Grafo, Ligacao, NoGrafo} from './grafo';
import {ehInteiro, type ContextoBloco, type CurvaParam, type Processador, type ProcessadorInteiro} from './tipos';

export const BLOCO_PADRAO = 128;

/** Cache de saídas inteiras por chave de nó (o mesmo Map do CacheSom do motor: outras chaves convivem nele). */
export type CacheGrafo = Map<string, unknown>;

export type OpcoesExecucao = {
  taxa: number;
  /** Amostras por canal da saída. */
  n: number;
  bloco?: number;
  /** O nó cuja porta 0 é a saída. */
  saida: string;
  /** Nós cuja saída (porta 0) volta inteira, alinhada no tempo da música (os stems, os retornos). */
  coletar?: string[];
  /** Com cache, nó com `chave` já guardada não roda (nem o que só ele usa) e nó com chave nova é guardado. */
  cache?: CacheGrafo;
  /** Como o cache, mas lido e gravado por trecho (o cache em disco): o nó guardado vira uma fonte lida bloco a bloco e o
   *  nó novo é gravado enquanto roda. Com os dois, o Map vale primeiro e os dois recebem o que for novo. */
  armazem?: ArmazemAudio;
  /** Recebe a saída bloco a bloco (alinhada no tempo da música, `qtd` amostras a partir de `inicio`, os buffers só valem
   *  durante a chamada) em vez de juntá-la: `canais` volta vazio e a mistura nunca fica inteira na memória. */
  aoBloco?: (canais: readonly Float32Array[], inicio: number, qtd: number) => void;
};

export type ResultadoExecucao = {
  canais: Float32Array[];
  coletados: Record<string, Float32Array[]>;
  /** As chaves de nó que este render usou (achadas ou guardadas): o resto do cache pode sair. */
  chavesUsadas: Set<string>;
  /** Latência que chegou à saída (amostras descartadas do começo). */
  latencia: number;
  /** Quantos estágios rodaram (1 sem adaptadores de buffer inteiro). */
  estagios: number;
  /** As chaves que vieram do armazém e as que foram gravadas nele neste render. */
  armazem: {lidas: string[]; gravadas: string[]};
};

type Tipo = 'cache' | 'bloco' | 'inteiro';
type Info = {
  no: NoGrafo;
  tipo: Tipo;
  estagio: number;
  entradas: Ligacao[];
  /** Latência que chega (a maior das entradas do mesmo estágio) e a que sai (mais a do processador). */
  lin: number;
  lout: number;
  /** Gravar a saída inteira na memória (algum estágio posterior lê, é a saída, é coletada ou vai para o cache em Map). */
  gravar: boolean;
  /** Gravar no armazém, bloco a bloco. */
  gravador?: GravadorAmostras;
};

const ehSaidaInteira = (v: unknown): v is Float32Array[] => Array.isArray(v) && v.length > 0 && v.every((c) => c instanceof Float32Array);

/** Roda o grafo inteiro offline e devolve a saída alinhada no tempo da música (sem a latência). */
export const executarOffline = (g: Grafo, o: OpcoesExecucao): ResultadoExecucao => {
  const bloco = o.bloco ?? BLOCO_PADRAO;
  const {taxa, n} = o;
  if (!(bloco >= 1 && Number.isInteger(bloco))) throw new Error(`executor: bloco ${bloco} inválido`);
  if (!g.nos.has(o.saida)) throw new Error(`executor: a saída "${o.saida}" não existe`);
  const coletar = o.coletar ?? [];
  const cache = o.cache;
  const armazem = o.armazem;
  const fontes: FonteAmostras[] = [];
  const gravadores: GravadorAmostras[] = [];
  const lidas: string[] = [];
  try {
    // 1) o que precisa rodar: da saída e dos coletados para trás, parando no que o cache já tem
    const precisa = new Set<string>();
    const doCache = new Map<string, FonteAmostras>();
    const pilha = [o.saida, ...coletar];
    while (pilha.length) {
      const id = pilha.pop()!;
      if (precisa.has(id)) continue;
      const no = g.nos.get(id);
      if (!no) throw new Error(`executor: o nó "${id}" não existe`);
      precisa.add(id);
      const guardado = cache && no.chave !== undefined ? cache.get(no.chave) : undefined;
      if (ehSaidaInteira(guardado) && guardado[0].length === n && guardado.length === no.proc.saidas[0]) {
        doCache.set(id, fonteDeMemoria(guardado));
        continue;
      }
      const lida = armazem && no.chave !== undefined ? armazem.abrir(no.chave, no.proc.saidas[0], n) : null;
      if (lida) {
        fontes.push(lida);
        doCache.set(id, lida);
        lidas.push(no.chave!);
        continue;
      }
      for (const l of g.entradasDe(id)) pilha.push(l.de.no);
    }
    const ordem = g.ordemTopologica(precisa);

    // 2) estágio, latência e o que gravar
    const info = new Map<string, Info>();
    for (const id of ordem) {
      const no = g.nos.get(id)!;
      const tipo: Tipo = doCache.has(id) ? 'cache' : ehInteiro(no.proc) ? 'inteiro' : 'bloco';
      const entradas = tipo === 'cache' ? [] : g.entradasDe(id);
      let estagio = 0;
      for (const l of entradas) {
        const s = info.get(l.de.no)!;
        estagio = Math.max(estagio, s.tipo === 'inteiro' ? s.estagio + 1 : s.tipo === 'cache' ? 0 : s.estagio);
      }
      info.set(id, {no, tipo, estagio, entradas, lin: 0, lout: 0,
        gravar: (id === o.saida && !o.aoBloco) || coletar.includes(id) || (!!cache && no.chave !== undefined && tipo !== 'cache')});
    }
    // a latência de quem roda por bloco só depois do preparar (pode depender da taxa)
    for (const id of ordem) {
      const x = info.get(id)!;
      if (x.tipo === 'bloco') {
        (x.no.proc as Processador).preparar(taxa, bloco);
        (x.no.proc as Processador).resetar();
      } else if (x.tipo === 'inteiro') (x.no.proc as ProcessadorInteiro).resetar();
    }
    const mesmoEstagio = (de: Info, para: Info) => de.tipo === 'bloco' && de.estagio === para.estagio;
    for (const id of ordem) {
      const x = info.get(id)!;
      if (x.tipo === 'cache') continue;
      for (const l of x.entradas) {
        const s = info.get(l.de.no)!;
        if (mesmoEstagio(s, x)) x.lin = Math.max(x.lin, s.lout);
        else if (s.tipo === 'bloco') s.gravar = true; // um estágio posterior lê a saída inteira
      }
      x.lout = x.lin + (x.tipo === 'bloco' ? Math.max(0, Math.round((x.no.proc as Processador).latencia)) : 0);
    }
    const estagios = Math.max(0, ...[...info.values()].map((x) => x.estagio)) + 1;
    if (o.aoBloco && info.get(o.saida)!.tipo !== 'bloco') info.get(o.saida)!.gravar = true; // vem do cache ou de um adaptador: entrega no fim
    if (armazem)
      for (const id of ordem) {
        const x = info.get(id)!;
        if (x.tipo === 'cache' || x.no.chave === undefined) continue;
        const gr = armazem.gravar(x.no.chave, x.no.proc.saidas[0], n);
        if (gr) {
          x.gravador = gr;
          gravadores.push(gr);
        }
      }

    // as saídas inteiras dos adaptadores e as gravadas (alinhadas no tempo da música, n amostras)
    const cheio = new Map<string, Float32Array[][]>();
    const leituras = new Map<FonteAmostras, Float32Array[]>(); // um bloco de leitura por fonte do cache
    const entrega: Float32Array[] = [];

    for (let s = 0; s < estagios; s++) {
      const nos = ordem.map((id) => info.get(id)!).filter((x) => x.tipo !== 'cache' && x.estagio === s);
      if (!nos.length) continue;
      const porBloco = nos.filter((x) => x.tipo === 'bloco');
      const inteiros = nos.filter((x) => x.tipo === 'inteiro');
      // buffers do estágio
      const ins = new Map<string, Float32Array[][]>();
      const outs = new Map<string, Float32Array[][]>();
      const atrasos = new Map<Ligacao, {a: Atraso; buf: Float32Array[][]}>();
      const juntos = new Map<string, Float32Array[][]>(); // entradas inteiras dos adaptadores
      const curvas = new Map<string, Map<string, {valor: number} | {curva: CurvaParam; buf: Float32Array}>>();
      for (const x of porBloco) {
        const p = x.no.proc as Processador;
        ins.set(x.no.id, p.entradas.map((c) => Array.from({length: c}, () => new Float32Array(bloco))));
        outs.set(x.no.id, p.saidas.map((c) => Array.from({length: c}, () => new Float32Array(bloco))));
        if (x.gravar) cheio.set(x.no.id, p.saidas.map((c) => Array.from({length: c}, () => new Float32Array(n))));
        const m = new Map<string, {valor: number} | {curva: CurvaParam; buf: Float32Array}>();
        for (const def of p.parametros ?? []) {
          const lig = x.no.params[def.nome];
          const endereco = typeof lig === 'object' ? lig.endereco : undefined;
          const curva = (endereco !== undefined ? g.automacoes.get(endereco) : undefined) ?? (typeof lig === 'object' ? lig.curva : undefined);
          if (curva && (typeof curva === 'function' || curva.length)) m.set(def.nome, {curva, buf: new Float32Array(bloco)});
          else m.set(def.nome, {valor: typeof lig === 'number' ? lig : lig?.valor ?? def.padrao});
        }
        curvas.set(x.no.id, m);
      }
      for (const x of inteiros) {
        juntos.set(x.no.id, x.no.proc.entradas.map((c) => Array.from({length: c}, () => new Float32Array(n))));
        ins.set(x.no.id, x.no.proc.entradas.map((c) => Array.from({length: c}, () => new Float32Array(bloco))));
      }
      for (const x of nos) {
        for (const l of x.entradas) {
          const src = info.get(l.de.no)!;
          if (!mesmoEstagio(src, x)) continue;
          const d = x.lin - src.lout;
          if (d > 0) {
            const ch = (src.no.proc as Processador).saidas[l.de.porta];
            const a = new Atraso(d, ch);
            atrasos.set(l, {a, buf: [Array.from({length: ch}, () => new Float32Array(bloco))]});
          }
        }
      }
      const quadros = n + Math.max(0, ...nos.map((x) => (x.tipo === 'bloco' ? x.lout : x.lin)));

      /** Soma as ligações que chegam à porta `p` de `x` no quadro `t` (o tempo da música é t − lin), em `dest[c][off..]`. */
      const somarEntrada = (x: Info, p: number, dest: Float32Array[], off: number, t: number, bn: number) => {
        for (const c of dest) c.fill(0, off, off + bn);
        // "primeira": a primeira ligação é copiada (−0 continua −0) e as outras somam; "zero": todas somam a partir de +0
        let copiar = x.no.soma !== 'zero';
        for (const l of x.entradas) {
          if (l.para.porta !== p) continue;
          const src = info.get(l.de.no)!;
          const ganho = l.ganho;
          if (mesmoEstagio(src, x)) {
            let blk = outs.get(src.no.id)![l.de.porta];
            const at = atrasos.get(l);
            if (at) {
              at.a.processar([blk], at.buf, bn);
              blk = at.buf[0];
            }
            for (let c = 0; c < dest.length; c++) {
              const y = dest[c], v = blk[c];
              if (copiar) {
                if (ganho === 1) for (let i = 0; i < bn; i++) y[off + i] = v[i];
                else for (let i = 0; i < bn; i++) y[off + i] = v[i] * ganho;
              } else if (ganho === 1) for (let i = 0; i < bn; i++) y[off + i] = y[off + i] + v[i];
              else for (let i = 0; i < bn; i++) y[off + i] = y[off + i] + v[i] * ganho;
            }
          } else {
            // de outro estágio ou do cache: a saída inteira na memória, ou uma fonte lida por trecho; só o que cai em [0, n)
            const ini = t - x.lin;
            const a = Math.max(0, -ini), b = Math.min(bn, n - ini);
            let v: readonly Float32Array[] | undefined, base = ini; // a amostra i do bloco está em v[c][base + i]
            const pronta = doCache.get(src.no.id);
            if (pronta) {
              let tmp = leituras.get(pronta);
              if (!tmp) leituras.set(pronta, (tmp = Array.from({length: pronta.canais}, () => new Float32Array(bloco))));
              if (b > a) pronta.ler(ini + a, b - a, tmp, 0);
              v = tmp;
              base = -a;
            } else v = cheio.get(src.no.id)?.[l.de.porta];
            if (!v) throw new Error(`executor: a saída inteira de "${src.no.id}" não foi gravada`);
            for (let c = 0; c < dest.length; c++) {
              const y = dest[c], vc = v[c];
              if (copiar) {
                if (ganho === 1) for (let i = a; i < b; i++) y[off + i] = vc[base + i];
                else for (let i = a; i < b; i++) y[off + i] = vc[base + i] * ganho;
              } else if (ganho === 1) for (let i = a; i < b; i++) y[off + i] = y[off + i] + vc[base + i];
              else for (let i = a; i < b; i++) y[off + i] = y[off + i] + vc[base + i] * ganho;
            }
          }
          copiar = false;
        }
      };

      const ctxs = new Map<string, ContextoBloco & {n: number}>();
      for (const x of porBloco) {
        const m = curvas.get(x.no.id)!;
        const ctx: ContextoBloco & {n: number} = {
          inicio: 0, taxa, n: 0,
          param(nome) {
            const v = m.get(nome);
            if (!v) throw new Error(`executor: "${x.no.id}" leu o parâmetro "${nome}", que não declarou`);
            if ('valor' in v) return v.valor;
            if (typeof v.curva === 'function') v.curva(this.inicio, this.n, v.buf);
            else {
              const c = v.curva, ult = c.length - 1;
              for (let i = 0; i < this.n; i++) {
                const j = this.inicio + i;
                v.buf[i] = c[j < 0 ? 0 : j > ult ? ult : j];
              }
            }
            return v.buf;
          },
        };
        ctxs.set(x.no.id, ctx);
      }

      for (let t = 0; t < quadros; t += bloco) {
        const bn = Math.min(bloco, quadros - t);
        for (const x of porBloco) {
          const p = x.no.proc as Processador;
          const xi = ins.get(x.no.id)!, xo = outs.get(x.no.id)!;
          for (let porta = 0; porta < xi.length; porta++) somarEntrada(x, porta, xi[porta], 0, t, bn);
          const ctx = ctxs.get(x.no.id)!;
          ctx.inicio = t - x.lin;
          ctx.n = bn;
          p.processar(xi, xo, bn, ctx);
          const ini = t - x.lout;
          const a = Math.max(0, -ini), b = Math.min(bn, n - ini);
          if (b > a) {
            if (x.gravar) {
              const dest = cheio.get(x.no.id)!;
              for (let porta = 0; porta < xo.length; porta++) for (let c = 0; c < xo[porta].length; c++) dest[porta][c].set(xo[porta][c].subarray(a, b), ini + a);
            }
            x.gravador?.escrever(xo[0], ini + a, b - a, a);
            if (o.aoBloco && x.no.id === o.saida) {
              for (let c = 0; c < xo[0].length; c++) entrega[c] = xo[0][c].subarray(a, b);
              o.aoBloco(entrega, ini + a, b - a);
            }
          }
        }
        for (const x of inteiros) {
          // a entrada do adaptador no bloco (as linhas de atraso andam sempre) e, no tempo da música, só o que cai em [0, n)
          const ini = t - x.lin;
          const a = Math.max(0, -ini), b = Math.min(bn, n - ini);
          const j = juntos.get(x.no.id)!, tmp = ins.get(x.no.id)!;
          for (let porta = 0; porta < j.length; porta++) {
            somarEntrada(x, porta, tmp[porta], 0, t, bn);
            if (b > a) for (let c = 0; c < j[porta].length; c++) j[porta][c].set(tmp[porta][c].subarray(a, b), ini + a);
          }
        }
      }
      for (const x of inteiros) {
        const p = x.no.proc as ProcessadorInteiro;
        const saida = p.processarTudo(juntos.get(x.no.id)!, n, taxa);
        if (saida.length !== p.saidas.length || saida.some((c, i) => c.length !== p.saidas[i] || c.some((v) => v.length !== n)))
          throw new Error(`executor: o adaptador "${x.no.id}" (${p.tipo}) devolveu portas, canais ou amostras a mais ou a menos`);
        cheio.set(x.no.id, saida);
        x.gravador?.escrever(saida[0], 0, n, 0);
      }
    }

    /** A saída inteira (porta 0) de um nó: a gravada, a do adaptador ou a do cache (lida inteira, só se pedida). */
    const inteira = (id: string): Float32Array[] => {
      const c = cheio.get(id);
      if (c) return c[0];
      const f = doCache.get(id)!;
      if ('buffers' in f) return f.buffers as Float32Array[];
      const bufs = Array.from({length: f.canais}, () => new Float32Array(n));
      f.ler(0, n, bufs, 0);
      return bufs;
    };
    const chavesUsadas = new Set<string>();
    for (const id of ordem) {
      const x = info.get(id)!;
      const chave = x.no.chave;
      if (chave === undefined || (!cache && !armazem)) continue;
      chavesUsadas.add(chave);
      if (cache && x.tipo !== 'cache') cache.set(chave, cheio.get(id)![0]);
    }
    const gravadas: string[] = [];
    for (const id of ordem) {
      const x = info.get(id)!;
      if (!x.gravador) continue;
      x.gravador.concluir();
      gravadas.push(x.no.chave!);
    }
    gravadores.length = 0;
    const saida = info.get(o.saida)!;
    let canais: Float32Array[] = [];
    if (o.aoBloco) {
      if (saida.tipo !== 'bloco') {
        // do cache ou de um adaptador: entrega em blocos do mesmo tamanho
        const tudo = inteira(o.saida);
        for (let t = 0; t < n; t += bloco) o.aoBloco(tudo.map((c) => c.subarray(t, Math.min(n, t + bloco))), t, Math.min(bloco, n - t));
      }
    } else canais = inteira(o.saida);
    return {canais, coletados: Object.fromEntries(coletar.map((id) => [id, inteira(id)])), chavesUsadas, latencia: saida.lout, estagios,
      armazem: {lidas, gravadas}};
  } catch (e) {
    for (const gr of gravadores) gr.descartar();
    throw e;
  } finally {
    for (const f of fontes) f.fechar?.();
  }
};
