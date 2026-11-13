// Endereço único de parâmetro da música (M-02 em docs/musica-daw.md): uma notação estável para dizer "este botão" que a
// automação geral, o MIDI learn, o MCP e a interface usam igual. Puro: lê o documento e devolve caminhos e JSON Patch; não
// muda o som (o motor continua lendo o documento como antes).
//
// A notação: o alvo, depois os segmentos, separados por "/".
//   faixa:<id>/eq/graves_db          faixa:<id>/compressor/limiar_db    faixa:<id>/envio/reverb
//   faixa:<id>/efeito:<slot>/<param> (reservado para os inserts da X-01: lê-se e escreve-se, ainda não resolve)
//   canal:<id>/macro/brilho          canal:<id>/peca:bumbo/afinacao
//   master/limitador/teto_db         master/delay/tempo                 musica/bpm
// O alvo é `faixa:<id>` (faixa do mixer), `canal:<id>`, `master` ou `musica` (o documento). Um segmento é `nome` ou
// `nome:chave`. No id e na chave, "%", "/" e ":" vão escritos como %25, %2F e %3A; o resto vai como está. O endereço
// usa ids, nunca posições: mover uma faixa no mixer não muda o endereço dos botões dela.
//
// A tabela PARAMETROS diz, de cada parâmetro que existe hoje, o tipo, a faixa de valores, o padrão e onde ele mora no
// documento. Os padrões e as faixas são os mesmos de resolverMusica (os testes conferem um contra o outro).
import type {Operation} from 'fast-json-patch';
import {ATRASO_FAIXA_MS, GANHO_EQ_DB, PECAS, TEMPOS_DELAY, VOLUME_DB_MAX, VOLUME_DB_MIN, BPM_MAX, BPM_MIN, BPM_PADRAO, type DocMusica, type PecaBateria} from './musica';
import {GRUPO_PADRAO} from './musica-som';

// ---------- notação ----------
export type TipoAlvo = 'faixa' | 'canal' | 'master' | 'musica';
export type Segmento = {nome: string; chave?: string};
export type EnderecoParam = {alvo: TipoAlvo; id?: string; segmentos: Segmento[]};

const NOME = /^[a-z][a-z0-9_]*$/;
const escapar = (s: string) => s.replace(/%/g, '%25').replace(/\//g, '%2F').replace(/:/g, '%3A');
const desescapar = (s: string): string | null => {
  if (/%(?!25|2F|3A)/i.test(s)) return null;
  return s.replace(/%(25|2F|3A)/gi, (_, c: string) => ({'25': '%', '2F': '/', '3A': ':'})[c.toUpperCase() as '25' | '2F' | '3A']);
};

export type Lido<T> = {ok: true; valor: T} | {ok: false; erro: string};

/** O texto do endereço em partes; erro claro se a notação não fecha. */
export const lerEndereco = (texto: string): Lido<EnderecoParam> => {
  if (typeof texto !== 'string' || !texto) return {ok: false, erro: 'endereço vazio'};
  const partes = texto.split('/');
  const cabeca = partes[0];
  const i = cabeca.indexOf(':');
  const tipo = i < 0 ? cabeca : cabeca.slice(0, i);
  let id: string | undefined;
  if (tipo === 'faixa' || tipo === 'canal') {
    const bruto = i < 0 ? '' : cabeca.slice(i + 1);
    const d = bruto ? desescapar(bruto) : null;
    if (!d) return {ok: false, erro: `"${texto}": o alvo ${tipo} pede um id (${tipo}:<id>)`};
    id = d;
  } else if (tipo === 'master' || tipo === 'musica') {
    if (i >= 0) return {ok: false, erro: `"${texto}": o alvo ${tipo} não leva id`};
  } else {
    return {ok: false, erro: `"${texto}": o alvo "${tipo}" não existe (faixa:<id>, canal:<id>, master ou musica)`};
  }
  const segmentos: Segmento[] = [];
  for (const p of partes.slice(1)) {
    const j = p.indexOf(':');
    const nome = j < 0 ? p : p.slice(0, j);
    if (!NOME.test(nome)) return {ok: false, erro: `"${texto}": o segmento "${p}" não é um nome (letras minúsculas, números e _)`};
    if (j < 0) {
      segmentos.push({nome});
      continue;
    }
    const chave = desescapar(p.slice(j + 1));
    if (!chave) return {ok: false, erro: `"${texto}": o segmento "${p}" tem a chave vazia ou mal escrita`};
    segmentos.push({nome, chave});
  }
  if (!segmentos.length) return {ok: false, erro: `"${texto}": falta o parâmetro depois do alvo`};
  return {ok: true, valor: {alvo: tipo, ...(id !== undefined ? {id} : {}), segmentos}};
};

/** O endereço em texto, na forma que lerEndereco lê (lerEndereco(escreverEndereco(e)) devolve `e`). */
export const escreverEndereco = (e: EnderecoParam): string => {
  const cabeca = e.alvo === 'faixa' || e.alvo === 'canal' ? `${e.alvo}:${escapar(e.id ?? '')}` : e.alvo;
  return [cabeca, ...e.segmentos.map((s) => (s.chave !== undefined ? `${s.nome}:${escapar(s.chave)}` : s.nome))].join('/');
};

/** O modelo do endereço, com "*" no lugar do id e das chaves: "faixa:*\/eq/graves_db". É a chave da tabela. */
export const modeloDoEndereco = (e: EnderecoParam): string =>
  [e.alvo === 'faixa' || e.alvo === 'canal' ? `${e.alvo}:*` : e.alvo, ...e.segmentos.map((s) => (s.chave !== undefined ? `${s.nome}:*` : s.nome))].join('/');

// ---------- a tabela ----------
export type TipoParam = 'numero' | 'inteiro' | 'booleano' | 'escolha';
export type ValorParam = number | boolean | string;

export type DefParam = {
  modelo: string;
  rotulo: string;
  tipo: TipoParam;
  /** Faixa aceita (número e inteiro). `motor_limita`: o motor traz de volta para dentro o que estiver fora. */
  min?: number;
  max?: number;
  motor_limita?: boolean;
  unidade?: 'dB' | 'ms' | 'BPM' | 'semitons' | 'razão';
  /** Para o mapeamento 0..1 (MIDI learn, knob): linear ou logarítmico (tempos). */
  curva?: 'linear' | 'log';
  opcoes?: string[];
  /** O valor quando o campo falta; pode depender da chave (o grupo de corte de cada peça). */
  padrao: ValorParam | ((chave?: string) => ValorParam);
  /** Dá para virar curva no tempo (X-08). Hoje o motor só automatiza o volume (`automacoes`). */
  automatizavel: boolean;
  /** Onde mora, a partir do alvo (faixa, canal, master ou o documento). Os segmentos com chave entram pela chave. */
  caminho: (chave?: string) => string[];
  /** O objeto pai não nasce sozinho: sem ele, o patch recusa (o sidechain precisa do canal que dispara). */
  pai_obrigatorio?: string;
  /** Leitura do valor efetivo, como o motor usa; sem ela, vale a leitura do tipo. */
  ler?: (bruto: unknown, chave?: string) => ValorParam;
};

const numero = (v: unknown, padrao: number) => (typeof v === 'number' && Number.isFinite(v) ? v : padrao);
const limitar = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

const vol = (modelo: string, rotulo: string, caminho: string[], automatizavel = true): DefParam => ({
  modelo, rotulo, tipo: 'numero', min: VOLUME_DB_MIN, max: VOLUME_DB_MAX, motor_limita: true, unidade: 'dB', curva: 'linear', padrao: 0, automatizavel, caminho: () => caminho,
});
const num = (modelo: string, rotulo: string, caminho: string[], min: number, max: number, padrao: number, extra: Partial<DefParam> = {}): DefParam => ({
  modelo, rotulo, tipo: 'numero', min, max, motor_limita: true, curva: 'linear', padrao, automatizavel: true, caminho: () => caminho, ...extra,
});
const bool = (modelo: string, rotulo: string, caminho: string[], padrao = false, extra: Partial<DefParam> = {}): DefParam => ({
  modelo, rotulo, tipo: 'booleano', padrao, automatizavel: false, caminho: () => caminho, ...extra,
});

const EQ = (banda: 'graves' | 'medios' | 'agudos', nome: string) =>
  num(`faixa:*/eq/${banda}_db`, `EQ ${nome}`, ['eq', `${banda}_db`], -GANHO_EQ_DB, GANHO_EQ_DB, 0, {unidade: 'dB'});
const macro = (m: 'brilho' | 'ataque' | 'soltura' | 'cor', rotulo: string, padrao: number) => num(`canal:*/macro/${m}`, rotulo, ['macros', m], 0, 1, padrao);
const peca = (campo: string): string[] => ['pecas', '?', campo]; // "?" é trocado pela chave

/** Todo parâmetro que o documento de música tem hoje. A ordem é a da tela (mixer, canal, master, música). */
export const PARAMETROS: DefParam[] = [
  // faixa do mixer
  vol('faixa:*/volume_db', 'Volume', ['volume_db']),
  num('faixa:*/pan', 'Pan', ['pan'], -1, 1, 0),
  bool('faixa:*/mudo', 'Mudo', ['mudo']),
  bool('faixa:*/solo', 'Solo', ['solo']),
  EQ('graves', 'graves (200 Hz)'),
  EQ('medios', 'médios (1 kHz)'),
  EQ('agudos', 'agudos (5 kHz)'),
  bool('faixa:*/compressor/ativo', 'Compressor ligado', ['compressor', 'ativo']),
  num('faixa:*/compressor/limiar_db', 'Limiar do compressor', ['compressor', 'limiar_db'], -60, 0, -18, {unidade: 'dB'}),
  num('faixa:*/compressor/razao', 'Razão do compressor', ['compressor', 'razao'], 1, 20, 3, {unidade: 'razão', curva: 'log'}),
  num('faixa:*/compressor/ataque_ms', 'Ataque do compressor', ['compressor', 'ataque_ms'], 0.1, 200, 10, {unidade: 'ms', curva: 'log'}),
  num('faixa:*/compressor/soltura_ms', 'Soltura do compressor', ['compressor', 'soltura_ms'], 5, 2000, 120, {unidade: 'ms', curva: 'log'}),
  num('faixa:*/compressor/ganho_db', 'Ganho do compressor', ['compressor', 'ganho_db'], 0, 24, 0, {unidade: 'dB'}),
  num('faixa:*/envio/reverb', 'Envio ao reverb', ['reverb'], 0, 1, 0),
  num('faixa:*/envio/delay', 'Envio ao delay', ['delay'], 0, 1, 0),
  // o "track delay" (M-07): desloca a faixa inteira no tempo; não é automatizável (mudar no meio pularia o som)
  num('faixa:*/atraso_ms', 'Atraso da faixa', ['atraso_ms'], -ATRASO_FAIXA_MS, ATRASO_FAIXA_MS, 0, {unidade: 'ms', automatizavel: false}),
  num('faixa:*/sidechain/quanto_db', 'Sidechain: quanto abaixa', ['sidechain', 'quanto_db'], 0, 24, 6, {unidade: 'dB', pai_obrigatorio: 'sidechain'}),
  num('faixa:*/sidechain/ataque_ms', 'Sidechain: ataque', ['sidechain', 'ataque_ms'], 0, 50, 5, {unidade: 'ms', pai_obrigatorio: 'sidechain'}),
  num('faixa:*/sidechain/soltura_ms', 'Sidechain: soltura', ['sidechain', 'soltura_ms'], 20, 2000, 180, {unidade: 'ms', curva: 'log', pai_obrigatorio: 'sidechain'}),
  {modelo: 'faixa:*/sidechain/peca', rotulo: 'Sidechain: peça', tipo: 'escolha', opcoes: [...PECAS], padrao: 'bumbo', automatizavel: false,
    caminho: () => ['sidechain', 'peca'], pai_obrigatorio: 'sidechain'},
  // canal
  bool('canal:*/mudo', 'Mudo', ['mudo']),
  bool('canal:*/solo', 'Solo', ['solo']),
  macro('brilho', 'Brilho', 0.5),
  macro('ataque', 'Ataque', 0),
  macro('soltura', 'Soltura', 0.3),
  macro('cor', 'Cor', 0.3),
  // as peças do kit: o motor não traz os números de volta para dentro (a faixa aqui é a da tela e do MCP)
  {...vol('canal:*/peca:*/volume_db', 'Peça: volume', []), motor_limita: false, caminho: (k) => peca('volume_db').map((x) => (x === '?' ? k! : x))},
  {...num('canal:*/peca:*/pan', 'Peça: pan', [], -1, 1, 0), motor_limita: false, caminho: (k) => peca('pan').map((x) => (x === '?' ? k! : x))},
  {...num('canal:*/peca:*/afinacao', 'Peça: afinação', [], -24, 24, 0, {unidade: 'semitons', automatizavel: false}), motor_limita: false,
    caminho: (k) => peca('afinacao').map((x) => (x === '?' ? k! : x))},
  {modelo: 'canal:*/peca:*/grupo', rotulo: 'Peça: grupo de corte', tipo: 'inteiro', min: 0, max: 16, motor_limita: false, automatizavel: false,
    padrao: (k) => GRUPO_PADRAO[k as PecaBateria] ?? 0, caminho: (k) => peca('grupo').map((x) => (x === '?' ? k! : x)),
    ler: (v, k) => (typeof v === 'number' ? v : GRUPO_PADRAO[k as PecaBateria] ?? 0)},
  // master
  vol('master/volume_db', 'Volume do master', ['volume_db']),
  num('master/reverb/tamanho', 'Reverb: tamanho', ['reverb', 'tamanho'], 0, 1, 0.6),
  num('master/reverb/amortecimento', 'Reverb: amortecimento', ['reverb', 'amortecimento'], 0, 1, 0.4),
  vol('master/reverb/volume_db', 'Reverb: volume do retorno', ['reverb', 'volume_db']),
  {modelo: 'master/delay/tempo', rotulo: 'Delay: tempo', tipo: 'escolha', opcoes: Object.keys(TEMPOS_DELAY), padrao: '1/8.', automatizavel: false, caminho: () => ['delay', 'tempo']},
  num('master/delay/realimentacao', 'Delay: realimentação', ['delay', 'realimentacao'], 0, 0.9, 0.35),
  num('master/delay/brilho', 'Delay: brilho', ['delay', 'brilho'], 0, 1, 0.5),
  bool('master/delay/pingue_pongue', 'Delay: pingue-pongue', ['delay', 'pingue_pongue'], true, {ler: (v) => v !== false}),
  vol('master/delay/volume_db', 'Delay: volume do retorno', ['delay', 'volume_db']),
  bool('master/limitador/ativo', 'Limitador ligado', ['limitador', 'ativo']),
  num('master/limitador/teto_db', 'Limitador: teto', ['limitador', 'teto_db'], -12, 0, -1, {unidade: 'dB'}),
  num('master/limitador/soltura_ms', 'Limitador: soltura', ['limitador', 'soltura_ms'], 10, 1000, 80, {unidade: 'ms', curva: 'log'}),
  // o documento
  num('musica/bpm', 'Andamento', ['bpm'], BPM_MIN, BPM_MAX, BPM_PADRAO, {unidade: 'BPM', automatizavel: false}),
  num('musica/swing', 'Swing', ['swing'], 0, 1, 0, {automatizavel: false}),
];

const POR_MODELO = new Map(PARAMETROS.map((p) => [p.modelo, p]));

/** A definição do parâmetro do endereço (pelo modelo); undefined se não existe (ou ainda não existe, como os efeitos). */
export const definicaoDe = (e: EnderecoParam): DefParam | undefined => POR_MODELO.get(modeloDoEndereco(e));

const chaveDe = (e: EnderecoParam) => e.segmentos.find((s) => s.chave !== undefined)?.chave;
const padraoDe = (d: DefParam, chave?: string): ValorParam => (typeof d.padrao === 'function' ? d.padrao(chave) : d.padrao);

/** O valor como o motor usa: o que está no documento (ou o padrão), trazido para dentro da faixa quando o motor faz isso. */
export const valorEfetivo = (d: DefParam, bruto: unknown, chave?: string): ValorParam => {
  if (d.ler) return d.ler(bruto, chave);
  const padrao = padraoDe(d, chave);
  if (d.tipo === 'booleano') return bruto === undefined ? padrao : Boolean(bruto);
  if (d.tipo === 'escolha') return typeof bruto === 'string' && d.opcoes?.includes(bruto) ? bruto : padrao;
  const n = numero(bruto, padrao as number);
  return d.motor_limita && d.min !== undefined && d.max !== undefined ? limitar(n, d.min, d.max) : n;
};

// ---------- resolução no documento ----------
const ponteiro = (partes: (string | number)[]) => partes.map((p) => `/${String(p).replace(/~/g, '~0').replace(/\//g, '~1')}`).join('');
const ehObjeto = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

export type Resolucao = {
  def: DefParam;
  chave?: string;
  /** JSON Pointer do campo no documento (para o JSON Patch e para o diário). */
  caminho: string;
  /** O valor gravado (undefined se o campo falta). */
  bruto: unknown;
  /** O que o patch precisa criar antes de escrever o campo (a faixa que só existe pelo canal, os objetos pais). */
  criar: Operation[];
  /** Por que não dá para escrever, se não dá (o sidechain sem canal que dispara). A leitura funciona igual. */
  bloqueio?: string;
};

/** Onde o parâmetro mora neste documento. Erro se o endereço não se lê, o parâmetro não existe ou o alvo não existe. */
export const resolverParametro = (doc: DocMusica, endereco: string | EnderecoParam): Lido<Resolucao> => {
  const lido = typeof endereco === 'string' ? lerEndereco(endereco) : {ok: true as const, valor: endereco};
  if (!lido.ok) return lido;
  const e = lido.valor;
  const texto = escreverEndereco(e);
  const def = definicaoDe(e);
  if (!def) {
    if (e.segmentos.some((s) => s.nome === 'efeito')) return {ok: false, erro: `"${texto}": ainda não há efeitos de insert no documento (vêm com a cadeia de inserts, X-01)`};
    return {ok: false, erro: `"${texto}": parâmetro desconhecido (${modeloDoEndereco(e)})`};
  }
  const chave = chaveDe(e);
  if (def.modelo.includes('peca:*') && !PECAS.includes(chave as PecaBateria)) return {ok: false, erro: `"${texto}": a peça "${chave}" não existe (${PECAS.join(', ')})`};

  const criar: Operation[] = [];
  let base: (string | number)[];
  let obj: unknown;
  const d = doc as unknown as Record<string, unknown>;
  if (e.alvo === 'musica') {
    base = [];
    obj = d;
  } else if (e.alvo === 'canal') {
    const canais = Array.isArray(doc.canais) ? doc.canais : [];
    const i = canais.findIndex((c) => c && c.id === e.id);
    if (i < 0) return {ok: false, erro: `"${texto}": o canal "${e.id}" não existe`};
    base = ['canais', i];
    obj = canais[i];
  } else {
    let mixer = ehObjeto(d.mixer) ? d.mixer : undefined;
    if (!mixer) {
      criar.push({op: 'add', path: '/mixer', value: {faixas: []}});
      mixer = {faixas: []};
    } else if (!Array.isArray(mixer.faixas)) {
      criar.push({op: 'add', path: '/mixer/faixas', value: []});
      mixer = {...mixer, faixas: []};
    }
    if (e.alvo === 'master') {
      base = ['mixer', 'master'];
      obj = mixer.master;
      if (!ehObjeto(obj)) {
        criar.push({op: 'add', path: '/mixer/master', value: {}});
        obj = {};
      }
    } else {
      const faixas = mixer.faixas as {id?: unknown}[];
      const i = faixas.findIndex((f) => f && f.id === e.id);
      if (i >= 0) {
        base = ['mixer', 'faixas', i];
        obj = faixas[i];
      } else {
        // a faixa que um canal pede existe para o motor (0 dB no centro) mesmo sem estar no mixer: o patch a escreve
        const canal = (Array.isArray(doc.canais) ? doc.canais : []).find((c) => c && (c.faixa_mixer || c.id) === e.id);
        if (!canal) return {ok: false, erro: `"${texto}": a faixa "${e.id}" não existe no mixer nem é a faixa de algum canal`};
        base = ['mixer', 'faixas', faixas.length];
        obj = {id: e.id, nome: canal.nome || e.id};
        criar.push({op: 'add', path: '/mixer/faixas/-', value: obj});
      }
    }
  }

  const rel = def.caminho(chave);
  let bloqueio: string | undefined;
  for (let k = 0; k < rel.length - 1; k++) {
    const filho = ehObjeto(obj) ? obj[rel[k]] : undefined;
    if (ehObjeto(filho)) {
      obj = filho;
      continue;
    }
    if (def.pai_obrigatorio === rel[k]) bloqueio = `"${texto}": a faixa não tem ${rel[k]}; escolha antes o canal que dispara (${ponteiro([...base, rel[k], 'de'])})`;
    else criar.push({op: 'add', path: ponteiro([...base, ...rel.slice(0, k + 1)]), value: {}});
    obj = {};
  }
  const bruto = ehObjeto(obj) ? obj[rel[rel.length - 1]] : undefined;
  return {ok: true, valor: {def, ...(chave !== undefined ? {chave} : {}), caminho: ponteiro([...base, ...rel]), bruto, criar: bloqueio ? [] : criar, ...(bloqueio ? {bloqueio} : {})}};
};

export type Leitura = {valor: ValorParam; bruto: unknown; no_documento: boolean; padrao: ValorParam; def: DefParam; caminho: string};

/** O valor do parâmetro neste documento: o efetivo (como o motor usa), o gravado e se o campo está no documento. */
export const lerParametro = (doc: DocMusica, endereco: string | EnderecoParam): Lido<Leitura> => {
  const r = resolverParametro(doc, endereco);
  if (!r.ok) return r;
  const {def, chave, bruto, caminho} = r.valor;
  return {ok: true, valor: {valor: valorEfetivo(def, bruto, chave), bruto, no_documento: bruto !== undefined, padrao: padraoDe(def, chave), def, caminho}};
};

/** O JSON Patch que grava `valor` no parâmetro (criando a faixa e os objetos pais que faltam). Número fora da faixa volta
 *  para dentro com aviso; tipo errado ou opção que não existe é erro. */
export const patchDoParametro = (doc: DocMusica, endereco: string | EnderecoParam, valor: unknown): Lido<{patch: Operation[]; valor: ValorParam; avisos: string[]}> => {
  const r = resolverParametro(doc, endereco);
  if (!r.ok) return r;
  const {def, caminho, criar, bloqueio} = r.valor;
  if (bloqueio) return {ok: false, erro: bloqueio};
  const avisos: string[] = [];
  let v: ValorParam;
  if (def.tipo === 'booleano') {
    if (typeof valor !== 'boolean') return {ok: false, erro: `${def.rotulo} pede verdadeiro ou falso`};
    v = valor;
  } else if (def.tipo === 'escolha') {
    if (typeof valor !== 'string' || !def.opcoes?.includes(valor)) return {ok: false, erro: `${def.rotulo} pede uma destas opções: ${def.opcoes?.join(', ')}`};
    v = valor;
  } else {
    if (typeof valor !== 'number' || !Number.isFinite(valor)) return {ok: false, erro: `${def.rotulo} pede um número`};
    let n = def.tipo === 'inteiro' ? Math.round(valor) : valor;
    if (def.min !== undefined && def.max !== undefined && (n < def.min || n > def.max)) {
      const dentro = limitar(n, def.min, def.max);
      avisos.push(`${def.rotulo}: ${n} está fora de ${def.min} a ${def.max}; vai ${dentro}`);
      n = dentro;
    }
    v = n;
  }
  return {ok: true, valor: {patch: [...criar, {op: 'add', path: caminho, value: v}], valor: v, avisos}};
};

// ---------- 0..1 (MIDI learn, knob) ----------
/** O valor levado a 0..1 pela faixa e pela curva do parâmetro (booleano: 0 ou 1; escolha: a posição na lista). */
export const paraNormalizado = (d: DefParam, valor: ValorParam): number => {
  if (d.tipo === 'booleano') return valor ? 1 : 0;
  if (d.tipo === 'escolha') {
    const n = d.opcoes?.length ?? 1;
    return n > 1 ? Math.max(0, d.opcoes!.indexOf(String(valor))) / (n - 1) : 0;
  }
  const min = d.min ?? 0;
  const max = d.max ?? 1;
  const x = limitar(Number(valor), min, max);
  if (d.curva === 'log' && min > 0) return Math.log(x / min) / Math.log(max / min);
  return max === min ? 0 : (x - min) / (max - min);
};

/** O caminho de volta: 0..1 para o valor do parâmetro. */
export const deNormalizado = (d: DefParam, x: number): ValorParam => {
  const t = limitar(Number.isFinite(x) ? x : 0, 0, 1);
  if (d.tipo === 'booleano') return t >= 0.5;
  if (d.tipo === 'escolha') return d.opcoes![Math.round(t * ((d.opcoes!.length || 1) - 1))];
  const min = d.min ?? 0;
  const max = d.max ?? 1;
  const v = d.curva === 'log' && min > 0 ? min * Math.pow(max / min, t) : min + t * (max - min);
  return d.tipo === 'inteiro' ? Math.round(v) : v;
};

// ---------- o que existe num documento ----------
/** Todos os endereços que este documento tem hoje: as faixas (as do mixer e as que só os canais pedem), os canais (as
 *  macros só nos de sintetizador, as peças só nos de bateria), o master e a música. Para a lista do MCP e da tela. */
export const enderecosDoDocumento = (doc: DocMusica): string[] => {
  const faixas: string[] = [];
  for (const f of doc.mixer?.faixas ?? []) if (f && typeof f.id === 'string' && !faixas.includes(f.id)) faixas.push(f.id);
  for (const c of doc.canais ?? []) {
    const id = c?.faixa_mixer || c?.id;
    if (typeof id === 'string' && !faixas.includes(id)) faixas.push(id);
  }
  const out: string[] = [];
  const comAlvo = (modelo: string, cabeca: string) => cabeca + modelo.slice(modelo.indexOf('/'));
  for (const id of faixas) {
    for (const p of PARAMETROS) if (p.modelo.startsWith('faixa:*/')) out.push(comAlvo(p.modelo, `faixa:${escapar(id)}`));
  }
  for (const c of doc.canais ?? []) {
    if (!c || typeof c.id !== 'string') continue;
    const cabeca = `canal:${escapar(c.id)}`;
    for (const p of PARAMETROS) {
      if (!p.modelo.startsWith('canal:*/')) continue;
      if (p.modelo.includes('/macro/') && c.tipo !== 'sintetizador') continue;
      if (p.modelo.includes('/peca:*/')) {
        if (c.tipo === 'bateria') for (const pc of PECAS) out.push(comAlvo(p.modelo, cabeca).replace('peca:*', () => `peca:${pc}`));
        continue;
      }
      out.push(comAlvo(p.modelo, cabeca));
    }
  }
  for (const p of PARAMETROS) if (p.modelo.startsWith('master/') || p.modelo.startsWith('musica/')) out.push(p.modelo);
  return out;
};

/** O endereço que uma automação de volume de hoje (`automacoes[]`, alvo = faixa ou "master") controla. */
export const enderecoDaAutomacao = (a: {alvo: string; parametro?: string}): string | null => {
  if (a.parametro !== undefined && a.parametro !== 'volume') return null;
  return a.alvo === 'master' ? 'master/volume_db' : `faixa:${escapar(a.alvo)}/volume_db`;
};
