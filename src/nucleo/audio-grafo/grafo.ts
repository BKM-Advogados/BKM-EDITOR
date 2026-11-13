// O grafo de áudio (M-01): nós com processadores, ligações de porta a porta com ganho e automações por endereço da M-02.
// Acíclico, com ordem topológica estável (empate desfeito pela ordem em que os nós entraram) e soma em ordem fixa (a
// ordem em que as ligações entraram): o mesmo documento monta o mesmo grafo e dá a mesma conta, bit a bit.
// Ver docs/audio-grafo.md.
import {ehInteiro, type CurvaParam, type LigacaoParam, type QualquerProcessador} from './tipos';

export type Porta = {no: string; porta: number};
export type Ligacao = {de: Porta; para: Porta; ganho: number; ordem: number};

export type NoGrafo = {
  id: string;
  proc: QualquerProcessador;
  /** Ligação de cada parâmetro (nome local → valor ou endereço). */
  params: Record<string, LigacaoParam>;
  /** Chave de conteúdo da saída (porta 0): com um cache no executor, a mesma chave reaproveita a saída inteira guardada
   *  em vez de rodar o nó e o que vem antes dele. Tem que mudar sempre que mudar algo que muda o som que sai daqui. */
  chave?: string;
  /** Como as ligações de uma entrada somam. "primeira" (padrão): a primeira é copiada como chega (com o ganho) e as
   *  outras somam em cima, então uma ligação só passa o sinal intacto, −0 incluído. "zero": todas somam a partir de +0
   *  (é a conta do master e dos envios no motor antigo; 0 + −0 dá +0). */
  soma?: 'primeira' | 'zero';
  ordem: number;
};

const portaDe = (p: string | Porta): Porta => (typeof p === 'string' ? {no: p, porta: 0} : p);

export class Grafo {
  readonly nos = new Map<string, NoGrafo>();
  readonly ligacoes: Ligacao[] = [];
  readonly automacoes = new Map<string, CurvaParam>();

  /** Põe um nó. O id é único no grafo (use o endereço da M-02 quando houver: `faixa:<id>/eq`). */
  no(id: string, proc: QualquerProcessador, o: {params?: Record<string, LigacaoParam>; chave?: string; soma?: 'primeira' | 'zero'} = {}): string {
    if (this.nos.has(id)) throw new Error(`grafo: o nó "${id}" já existe`);
    const nomes = new Set((!ehInteiro(proc) ? proc.parametros ?? [] : []).map((p) => p.nome));
    for (const nome of Object.keys(o.params ?? {})) if (!nomes.has(nome)) throw new Error(`grafo: o nó "${id}" (${proc.tipo}) não tem o parâmetro "${nome}"`);
    this.nos.set(id, {id, proc, params: o.params ?? {}, ...(o.chave !== undefined ? {chave: o.chave} : {}), ...(o.soma ? {soma: o.soma} : {}), ordem: this.nos.size});
    return id;
  }

  /** Liga a saída `de` (id = porta 0) à entrada `para`. Várias ligações na mesma entrada somam, na ordem em que foram
   *  feitas, cada uma multiplicada pelo seu ganho (o envio a um retorno, o volume de um retorno no master). */
  ligar(de: string | Porta, para: string | Porta, o: {ganho?: number} = {}) {
    const a = portaDe(de), b = portaDe(para);
    const na = this.nos.get(a.no), nb = this.nos.get(b.no);
    if (!na) throw new Error(`grafo: o nó "${a.no}" não existe`);
    if (!nb) throw new Error(`grafo: o nó "${b.no}" não existe`);
    const ca = na.proc.saidas[a.porta], cb = nb.proc.entradas[b.porta];
    if (ca === undefined) throw new Error(`grafo: "${a.no}" não tem a saída ${a.porta}`);
    if (cb === undefined) throw new Error(`grafo: "${b.no}" não tem a entrada ${b.porta}`);
    if (ca !== cb) throw new Error(`grafo: "${a.no}":${a.porta} tem ${ca} canais e "${b.no}":${b.porta} pede ${cb}`);
    this.ligacoes.push({de: a, para: b, ganho: o.ganho ?? 1, ordem: this.ligacoes.length});
  }

  /** Registra a curva de um endereço da M-02: todo parâmetro ligado a esse endereço passa a seguir a curva. */
  automatizar(endereco: string, curva: CurvaParam) {
    this.automacoes.set(endereco, curva);
  }

  /** As ligações que chegam a um nó, na ordem da soma. */
  entradasDe(id: string): Ligacao[] {
    return this.ligacoes.filter((l) => l.para.no === id);
  }

  /** Ordem topológica estável (Kahn, empate pela ordem de entrada dos nós). Só dos nós de `so`, se dado. Ciclo é erro:
   *  realimentação mora dentro de um processador (o laço do delay), nunca entre nós. */
  ordemTopologica(so?: Set<string>): string[] {
    const ids = [...this.nos.values()].filter((n) => !so || so.has(n.id)).sort((a, b) => a.ordem - b.ordem).map((n) => n.id);
    const dentro = new Set(ids);
    const grau = new Map(ids.map((id) => [id, 0]));
    const saem = new Map<string, string[]>(ids.map((id) => [id, []]));
    for (const l of this.ligacoes) {
      if (!dentro.has(l.de.no) || !dentro.has(l.para.no)) continue;
      grau.set(l.para.no, grau.get(l.para.no)! + 1);
      saem.get(l.de.no)!.push(l.para.no);
    }
    const ordemDe = (id: string) => this.nos.get(id)!.ordem;
    const prontos = ids.filter((id) => grau.get(id) === 0);
    const out: string[] = [];
    while (prontos.length) {
      // o de menor ordem primeiro: a mesma montagem dá sempre a mesma sequência
      let k = 0;
      for (let i = 1; i < prontos.length; i++) if (ordemDe(prontos[i]) < ordemDe(prontos[k])) k = i;
      const id = prontos.splice(k, 1)[0];
      out.push(id);
      for (const d of saem.get(id)!) {
        grau.set(d, grau.get(d)! - 1);
        if (grau.get(d) === 0) prontos.push(d);
      }
    }
    if (out.length !== ids.length) throw new Error(`grafo: há um ciclo entre ${ids.filter((id) => !out.includes(id)).join(', ')}`);
    return out;
  }
}
