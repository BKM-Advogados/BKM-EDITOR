// Criar, duplicar e excluir cena e bloco do vídeo pela interface, como JSON Patch (o mesmo caminho das outras edições:
// diário, desfazer, o Claude vê). Cada patch confere o id do que vai mexer, para não pisar no que o agente mudou por
// baixo. No vídeo de cenas vale tudo; no carrossel narrado da Cliente, cena nova precisa de uma palavra da narração, então só
// partes podem sair e blocos podem entrar (o resolvedor põe o bloco 300 ms depois do começo da cena).
import {comIdsNovos, ehDocCenas, idLivre, novaCenaCenas, novoBlocoCenas, TIPOS_BLOCO_CENAS, type TipoBlocoCenas} from '../../../nucleo/cenas';
import type {OperacaoPatch} from '../../../nucleo/documentos';
import {aplicar, avisar, loja, selecionar, valorEm} from '../../estado/loja';
import {irPara, msAtual} from './tocador';

type Cena = {id?: string; tipo?: string; blocos?: {id?: string; tipo?: string}[]};
type CenaP = {origem?: string; t_in: number; t_out: number};

export const TIPOS_CLIENTE: {tipo: string; nome: string; modelo: Record<string, unknown>}[] = [
  {tipo: 'frase', nome: 'Frase', modelo: {texto: 'NOVA FRASE', y: 700}},
  {tipo: 'nota', nome: 'Nota', modelo: {texto: 'Texto da nota', y: 900}},
  {tipo: 'cartao', nome: 'Cartão', modelo: {texto: 'Texto do cartão com **destaque**', y: 800}},
  {tipo: 'itens', nome: 'Itens', modelo: {itens: [{texto: 'Primeiro'}, {texto: 'Segundo'}], y: 700}},
  {tipo: 'numero', nome: 'Número', modelo: {de: 0, ate: 100, sufixo: '%', rotulo: 'o que mede', y: 650}},
];

const doc = (documento: string) => loja.get().docs[documento]?.doc as {cenas?: Cena[]} | undefined;
const cenasP = (documento: string) => {
  const m = loja.get().props[documento];
  return ((m && 'props' in m ? m.props.cenas : undefined) ?? []) as CenaP[];
};
const testeId = (caminho: string, id: unknown): OperacaoPatch[] => (typeof id === 'string' ? [{op: 'test', path: `${caminho}/id`, value: id}] : []);

/** Índice da cena de trabalho: a selecionada (ou a do bloco selecionado), senão a do tempo atual, senão a última. */
const cenaDeTrabalho = (documento: string): number | null => {
  const d = doc(documento);
  const n = d?.cenas?.length ?? 0;
  if (!n) return null;
  const sel = loja.get().selecao;
  const m = sel?.documento === documento ? /^\/cenas\/(\d+)/.exec(sel.caminho) : null;
  if (m && Number(m[1]) < n) return Number(m[1]);
  const t = msAtual();
  const aqui = cenasP(documento).find((c) => c.origem && t >= c.t_in && t < c.t_out);
  const i = aqui?.origem ? Number(aqui.origem.split('/')[2]) : NaN;
  return Number.isFinite(i) && i < n ? i : n - 1;
};

const irParaCena = (documento: string, i: number, mais = 0) => {
  requestAnimationFrame(() => {
    const c = cenasP(documento).find((x) => x.origem === `/cenas/${i}`);
    if (c) irPara(c.t_in + mais);
  });
};

export const podeCriarCena = (documento?: string) => Boolean(documento && ehDocCenas(doc(documento)));

export const adicionarCena = async (documento: string) => {
  const d = doc(documento);
  if (!ehDocCenas(d)) return avisar('No carrossel narrado, cena nova precisa de uma palavra da narração: peça ao Claude ou edite o roteiro.', 'info');
  const i = d.cenas.length ? (cenaDeTrabalho(documento) ?? d.cenas.length - 1) + 1 : 0;
  const id = idLivre(d, 'cena');
  const cena = novaCenaCenas(id, `${id}-titulo`);
  if (await aplicar(documento, [{op: 'add', path: `/cenas/${i}`, value: cena}], `nova cena ${i + 1}`)) {
    selecionar({documento, caminho: `/cenas/${i}/blocos/0`});
    irParaCena(documento, i, 400);
  }
};

export const adicionarBloco = async (documento: string, tipo: string) => {
  const d = doc(documento);
  const i = cenaDeTrabalho(documento);
  if (i === null) return avisar('Crie uma cena antes.', 'info');
  const cena = d!.cenas![i];
  const j = cena.blocos?.length ?? 0;
  let bloco: Record<string, unknown>;
  if (ehDocCenas(d)) {
    const c = cenasP(documento).find((x) => x.origem === `/cenas/${i}`);
    const em = c ? Math.max(0, Math.min(c.t_out - c.t_in - 500, Math.round((msAtual() - c.t_in) / 100) * 100)) : 0;
    bloco = {...novoBlocoCenas(tipo as TipoBlocoCenas, idLivre(d, `${cena.id ?? `cena${i + 1}`}-${tipo}`)), em};
    // abaixo do que já está na cena, para o bloco novo não nascer por cima do título
    const ys = (cena.blocos ?? []).map((b) => (b as {y?: number}).y).filter((y): y is number => typeof y === 'number');
    if (ys.length) bloco.y = Math.min(0.78, Math.round((Math.max(...ys) + 0.16) * 100) / 100);
  } else {
    const modelo = TIPOS_CLIENTE.find((t) => t.tipo === tipo);
    if (!modelo) return;
    bloco = {id: idLivre(d, `${cena.id ?? `cena${i + 1}`}-${tipo}`), tipo, ...structuredClone(modelo.modelo)};
  }
  const patch: OperacaoPatch[] = [...testeId(`/cenas/${i}`, cena.id), cena.blocos ? {op: 'add', path: `/cenas/${i}/blocos/${j}`, value: bloco}
    : {op: 'add', path: `/cenas/${i}/blocos`, value: [bloco]}];
  const nome = ehDocCenas(d) ? TIPOS_BLOCO_CENAS[tipo as TipoBlocoCenas]?.nome : TIPOS_CLIENTE.find((t) => t.tipo === tipo)?.nome;
  if (await aplicar(documento, patch, `novo bloco ${nome ?? tipo} na cena ${i + 1}`)) selecionar({documento, caminho: `/cenas/${i}/blocos/${j}`});
};

const partes = (caminho: string) => {
  const m = /^\/cenas\/(\d+)(?:\/blocos\/(\d+))?$/.exec(caminho);
  return m ? {cena: Number(m[1]), bloco: m[2] !== undefined ? Number(m[2]) : null} : null;
};

export const duplicarSelecao = async (documento: string) => {
  const sel = loja.get().selecao;
  const d = doc(documento);
  const p = sel?.documento === documento ? partes(sel.caminho) : null;
  if (!p || !d?.cenas) return avisar('Selecione uma cena ou um bloco para duplicar.', 'info');
  const cena = d.cenas[p.cena];
  if (p.bloco !== null) {
    const b = valorEm(d, sel!.caminho) as Record<string, unknown>;
    const copia = comIdsNovos(b, d, `${cena.id ?? 'cena'}-${String(b.tipo)}`);
    if (ehDocCenas(d) && typeof copia.y === 'number') copia.y = Math.min(0.9, Number(copia.y) + 0.06);
    else if (typeof copia.y === 'number') copia.y = Number(copia.y) + 120;
    const destino = `/cenas/${p.cena}/blocos/${p.bloco + 1}`;
    if (await aplicar(documento, [...testeId(sel!.caminho, b.id), {op: 'add', path: destino, value: copia}], 'duplicar bloco')) selecionar({documento, caminho: destino});
    return;
  }
  if (!ehDocCenas(d)) return avisar('No carrossel narrado, cada parte começa numa palavra da narração: duplique blocos, não partes.', 'info');
  const copia = comIdsNovos(cena, d, 'cena');
  if (await aplicar(documento, [...testeId(`/cenas/${p.cena}`, cena.id), {op: 'add', path: `/cenas/${p.cena + 1}`, value: copia}], `duplicar cena ${p.cena + 1}`)) {
    selecionar({documento, caminho: `/cenas/${p.cena + 1}`});
    irParaCena(documento, p.cena + 1, 400);
  }
};

export const excluirSelecao = async (documento: string) => {
  const sel = loja.get().selecao;
  const d = doc(documento);
  const p = sel?.documento === documento ? partes(sel.caminho) : null;
  if (!p || !d?.cenas) return avisar('Selecione uma cena ou um bloco para excluir.', 'info');
  const alvo = valorEm(d, sel!.caminho) as {id?: string; tipo?: string} | undefined;
  if (!alvo) return;
  if (p.bloco === null && !ehDocCenas(d) && alvo.tipo !== 'parte') return avisar('O carrossel narrado começa no gancho e termina na dúvida: essas cenas ficam.', 'info');
  const rotulo = p.bloco === null ? `excluir cena ${p.cena + 1}` : 'excluir bloco';
  if (await aplicar(documento, [...testeId(sel!.caminho, alvo.id), {op: 'remove', path: sel!.caminho}], rotulo)) {
    selecionar(p.bloco === null ? null : {documento, caminho: `/cenas/${p.cena}`});
    avisar(`${p.bloco === null ? 'Cena excluída' : 'Bloco excluído'}. Ctrl+Z desfaz.`, 'ok');
  }
};
