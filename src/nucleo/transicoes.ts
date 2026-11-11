// Ida e volta entre módulos (contrato da seção 4 de estudio-ia-provedores-2026-11-07/05-ferramentas-novas.md, com os
// seis ajustes do plano da música): levar_para abre o destino já com o alvo e guarda de onde veio; concluir_transicao
// põe o resultado no lugar por patch (diário, Reverter, Ctrl+Z) e devolve a seleção de antes; cancelar_transicao volta
// sem mudar a origem e, com "descartar", desfaz o que se fez no destino. A tela e a IA usam as mesmas funções: o botão
// "Editar em Música" chama levarPara como o MCP chama. O registro fica em .estudio/transicoes.json, fora do git, e a
// janela acompanha pelo arquivo (muda a área quando uma transição abre ou fecha), então vale também para o MCP por stdio.
// Puro: o disco entra por BaseProjeto (src/nucleo/transicoes-projeto.ts no Node; a ponte da prévia web em memória).
// Hoje o único destino é a Música, vinda de um clipe ou de uma faixa de áudio do vídeo de cenas; outros módulos usam o
// mesmo registro quando chegarem (docs/musica.md, "Transição").
import type {EntradaDiario, EntradaDocumento, EstadoEditor, Manifesto, Modulo, OperacaoPatch} from './documentos';
import {ehDocCenas, resolverCenas, type DocCenas} from './cenas';
import {papelDe} from './audio';
import {entradaDeMusica, ehDocMusica, musicaDeClipe, musicaParaCriar, type DocMusica} from './musica';
import {musicaDoModelo, type ModeloMusica} from './musica-modelos';
import {acharAlvoAudio, acharClipePorId, caminhoPorId, patchClipeNovo, patchLigarClipe, renderDaMusica} from './musica-video';

export const ARQUIVO_TRANSICOES = '.estudio/transicoes.json';
const GUARDAR = 60; // fechadas que ficam no registro (as abertas ficam sempre)

export type AreaTransicao = 'video' | 'imagem' | '3d' | 'efeitos' | 'musica' | 'animacao'; // a volta da transição cai em qualquer área, a Animação também
export type IntencaoTransicao = 'editar' | 'criar' | 'substituir';

/** Onde a pessoa estava (para voltar) e para onde foi. `caminho` da origem é por id ("/audio/faixas/@musica/clipes/@c2"),
 *  para sobreviver a clipes que mudam de posição; `arquivo` do destino marca as entradas do diário feitas lá. */
export type Transicao = {
  id: string;
  estado: 'aberta' | 'concluida' | 'cancelada';
  intencao: IntencaoTransicao;
  autor: string;
  criada_em: string;
  fechada_em?: string;
  origem: {modulo: Modulo; documento: string; caminho: string; area: AreaTransicao; selecao?: string; tempo_ms?: number};
  destino: {modulo: Modulo; documento: string; arquivo: string; selecao?: string; criado: boolean};
  tempo?: {em_ms?: number; dur_ms?: number};
  pai?: string; // transição aberta antes desta, de onde esta saiu (pilha: concluir volta um nível)
  resultado?: {seq: number; documento: string; caminho: string};
  seqs?: number[];
};

export type RegistroTransicoes = {formato: 1; transicoes: Transicao[]};
export const registroVazio = (): RegistroTransicoes => ({formato: 1, transicoes: []});
export const lerRegistro = (x: unknown): RegistroTransicoes => {
  const r = x as Partial<RegistroTransicoes> | null;
  return r && Array.isArray(r.transicoes) ? {formato: 1, transicoes: r.transicoes.filter((t) => t && typeof t.id === 'string')} : registroVazio();
};

/** O projeto como a transição precisa dele. `autor` e `origem` já vêm presos em quem monta a base. */
export type BaseProjeto = {
  manifesto(): Manifesto;
  ler<T>(documento: string): {doc: T; versao: string; arquivo: string};
  aplicar(p: {documento: string; versao_base?: string; patch: OperacaoPatch[]; rotulo: string; transicao?: string; autor?: string}): {versao: string; seq: number};
  adicionarDocumento(e: EntradaDocumento, conteudo: unknown): void;
  registro(): RegistroTransicoes;
  gravarRegistro(r: RegistroTransicoes): void;
  estado(): EstadoEditor | null;
  diario(): EntradaDiario[];
  /** Algo do arquivo de áudio que muda quando ele é regravado (o tamanho): entra no código do render. */
  assinatura?(arquivo: string): string;
  autor: string;
};

const agora = () => new Date().toISOString();
const proximoId = (r: RegistroTransicoes) => {
  const maior = r.transicoes.reduce((m, t) => Math.max(m, Number(/^t(\d+)$/.exec(t.id)?.[1] ?? 0)), 0);
  return `t${maior + 1}`;
};
const guardar = (b: BaseProjeto, r: RegistroTransicoes) => {
  const abertas = r.transicoes.filter((t) => t.estado === 'aberta');
  const fechadas = r.transicoes.filter((t) => t.estado !== 'aberta').slice(-GUARDAR);
  b.gravarRegistro({formato: 1, transicoes: [...fechadas, ...abertas].sort((a, c) => Number(a.id.slice(1)) - Number(c.id.slice(1)))});
};

export const abertas = (r: RegistroTransicoes) => r.transicoes.filter((t) => t.estado === 'aberta');
/** A transição em curso (a última aberta): o estado_do_editor a mostra, e a tela põe a faixa "Concluir e voltar". */
export const transicaoEmCurso = (r: RegistroTransicoes) => abertas(r).pop();

const acharAberta = (b: BaseProjeto, id: string) => {
  const r = b.registro();
  const t = r.transicoes.find((x) => x.id === id);
  if (!t) throw new Error(`transição não achada: ${id}${abertas(r).length ? ` (abertas: ${abertas(r).map((x) => x.id).join(', ')})` : ' (nenhuma aberta)'}`);
  if (t.estado !== 'aberta') throw new Error(`a transição ${id} já foi ${t.estado}`);
  return {r, t};
};

// ---------- levar_para ----------
export type PedidoLevar = {
  modulo: AreaTransicao;
  alvo: {documento: string; caminho: string};
  intencao?: IntencaoTransicao;
  tempo?: {em_ms?: number; dur_ms?: number};
  /** "criar" na Música: o modelo da música nova (item 27); sem ele, uma bateria vazia. */
  modelo?: ModeloMusica;
  /** A tela diz onde a pessoa estava; sem isto, vale o estado.json (o que a IA vê). */
  de?: {area?: AreaTransicao; selecao?: string; tempo_ms?: number};
};
export type ResultadoLevar = {transicao: string; destino: {documento: string; selecao?: string}; criado: boolean; ja_aberta?: boolean};

/** Abre a Música com o alvo do vídeo: um clipe de áudio ("editar": o documento ligado a ele, ou um novo com o áudio do
 *  clipe) ou uma faixa ("criar": documento novo, trilha ou efeito pelo papel da faixa). */
export const levarPara = (b: BaseProjeto, p: PedidoLevar): ResultadoLevar => {
  if (p.modulo !== 'musica') throw new Error(`por enquanto só se leva para a Música (pedido: ${p.modulo}); os outros módulos entram no mesmo contrato depois`);
  const manifesto = b.manifesto();
  const entradaOrigem = manifesto.documentos.find((d) => d.id === p.alvo.documento || d.caminho === p.alvo.documento);
  if (!entradaOrigem) throw new Error(`documento não achado: ${p.alvo.documento}`);
  const {doc} = b.ler<unknown>(entradaOrigem.id);
  if (!ehDocCenas(doc)) throw new Error(`${entradaOrigem.id} não é um vídeo de cenas: a Música recebe clipes e faixas de áudio do vídeo de cenas`);
  const alvo = acharAlvoAudio(doc, p.alvo.caminho);
  if (!alvo) throw new Error(`não achei ${p.alvo.caminho} em ${entradaOrigem.id} (use /audio/faixas/@<faixa>/clipes/@<clipe> ou só a faixa)`);
  const intencao: IntencaoTransicao = p.intencao ?? (alvo.clipe ? 'editar' : 'criar');
  if (intencao !== 'criar' && !alvo.clipe) throw new Error('para editar, o alvo é um clipe (/audio/faixas/@<faixa>/clipes/@<clipe>); para uma faixa, use intencao "criar"');
  if (alvo.clipe && papelDe(alvo.faixa) === 'voz' && intencao !== 'criar') {
    throw new Error('a voz fica no vídeo (a limpeza, o medidor e as legendas leem o arquivo dela); na Música ela toca como guia. Leve um clipe de música ou de efeito');
  }
  const caminho = caminhoPorId(alvo.faixa.id, intencao === 'criar' ? undefined : alvo.clipe?.id);

  // mesma origem já aberta: devolve a mesma (a tela e a IA podem pedir duas vezes)
  const r = b.registro();
  const repetida = abertas(r).find((t) => t.origem.documento === entradaOrigem.id && t.origem.caminho === caminho && t.intencao === intencao);
  if (repetida) return {transicao: repetida.id, destino: {documento: repetida.destino.documento, selecao: repetida.destino.selecao}, criado: false, ja_aberta: true};

  // destino: o documento já ligado ao clipe, ou um novo
  let destino: EntradaDocumento | undefined;
  let criado = false;
  const ligado = intencao === 'editar' ? alvo.clipe?.musica : undefined;
  if (ligado) destino = manifesto.documentos.find((d) => d.id === ligado && d.modulo === 'musica');
  let selecao: string | undefined;
  if (destino) {
    const musica = b.ler<DocMusica>(destino.id).doc;
    const c = ehDocMusica(musica) ? musica.arranjo.clipes.find((x) => x.origem?.clipe === alvo.clipe?.id) ?? musica.arranjo.clipes[0] : undefined;
    selecao = c ? `/arranjo/clipes/@${c.id}` : undefined;
  } else {
    let conteudo: DocMusica;
    if (alvo.clipe && intencao !== 'criar') {
      conteudo = musicaDeClipe(alvo.clipe, {video: entradaOrigem.id});
    } else {
      const total = resolverCenas(doc).props.duracao_ms;
      const em = Math.max(0, Math.round(p.tempo?.em_ms ?? (b.estado()?.documento === entradaOrigem.id ? b.estado()?.tempo_ms ?? 0 : 0)));
      const papel = papelDe(alvo.faixa) === 'efeitos' ? 'efeitos' : 'musica';
      conteudo = musicaParaCriar({video: entradaOrigem.id, papel, em_ms: em, dur_ms: p.tempo?.dur_ms ?? (papel === 'musica' ? Math.max(1000, total - em) : 2000)});
      if (p.modelo && p.modelo !== 'vazio') {
        // o modelo enche a mesma duração em compassos inteiros, com o título e a ligação ao vídeo
        const dur_ms = p.tempo?.dur_ms ?? (papel === 'musica' ? Math.max(1000, total - em) : 2000);
        conteudo = musicaDoModelo(p.modelo, conteudo, {dur_s: dur_ms / 1000});
      }
    }
    destino = entradaDeMusica(manifesto, conteudo.titulo);
    b.adicionarDocumento(destino, conteudo);
    criado = true;
    selecao = '/arranjo/clipes/@c1';
  }

  const estado = b.estado();
  const naOrigem = estado?.documento === entradaOrigem.id;
  const pai = abertas(r).find((t) => t.destino.documento === entradaOrigem.id)?.id;
  const t: Transicao = {
    id: proximoId(r),
    estado: 'aberta',
    intencao,
    autor: b.autor,
    criada_em: agora(),
    origem: {
      modulo: entradaOrigem.modulo, documento: entradaOrigem.id, caminho,
      area: p.de?.area ?? (naOrigem && estado?.area ? estado.area : 'video'),
      selecao: p.de?.selecao ?? (naOrigem ? estado?.selecao : undefined) ?? (alvo.clipe ? `/audio/faixas/${alvo.fi}/clipes/${alvo.ci}` : undefined),
      tempo_ms: p.de?.tempo_ms ?? (naOrigem ? estado?.tempo_ms : undefined),
    },
    destino: {modulo: 'musica', documento: destino.id, arquivo: destino.caminho, selecao, criado},
    ...(p.tempo ? {tempo: p.tempo} : {}),
    ...(pai ? {pai} : {}),
  };
  r.transicoes.push(t);
  guardar(b, r);
  return {transicao: t.id, destino: {documento: destino.id, selecao}, criado};
};

// ---------- concluir_transicao ----------
export type ResultadoVolta = {area: AreaTransicao; documento: string; selecao?: string; tempo_ms?: number};
export type ResultadoConcluir = {
  transicao: string;
  seq?: number;
  documento: string;
  caminho?: string;
  seqs: number[];
  render?: {arquivo: string; duracao_ms: number};
  musica?: string;
  volta: ResultadoVolta;
  avisos: string[];
};

/** O clipe do vídeo que toca a música (a volta já aplicada numa tentativa anterior). */
const clipeDaMusica = (video: DocCenas, idMusica: string) => {
  const faixas = video.audio?.faixas ?? [];
  for (let fi = faixas.length - 1; fi >= 0; fi--) {
    const ci = (faixas[fi].clipes ?? []).findLastIndex((c) => c.musica === idMusica);
    if (ci >= 0) return {fi, ci, faixa: faixas[fi].id, clipe: faixas[fi].clipes[ci].id};
  }
  return undefined;
};

const seqsDa = (b: BaseProjeto, id: string) => b.diario().filter((e) => e.transicao === id).map((e) => e.seq);

/** Volta ao vídeo com a música no lugar: o clipe de origem passa a tocar o render (ligado ao documento), ou, na
 *  intenção "criar", nasce um clipe na faixa de origem. O render em si é de quem chama (o arquivo pode faltar por
 *  um instante: o caminho e a duração saem do documento). `aplicar: false` é voltar sem aplicar (o mesmo que cancelar). */
export const concluirTransicao = (b: BaseProjeto, p: {transicao: string; aplicar?: boolean; resultado?: {documento?: string; midia?: string}}): ResultadoConcluir => {
  if (p.aplicar === false) {
    const c = cancelarTransicao(b, {transicao: p.transicao});
    return {transicao: p.transicao, documento: c.volta.documento, seqs: [], volta: c.volta, avisos: ['voltou sem aplicar']};
  }
  const {r, t} = acharAberta(b, p.transicao);
  if (p.resultado?.midia) throw new Error('a Música devolve o documento (o render é refeito pelo app); "midia" fica para os módulos que devolvem um arquivo');
  const idMusica = p.resultado?.documento ?? t.destino.documento;
  const lido = b.ler<DocMusica>(idMusica);
  if (!ehDocMusica(lido.doc)) throw new Error(`${idMusica} não é um documento de música`);
  const render = renderDaMusica(idMusica, lido.doc, b.assinatura?.bind(b));
  const video = b.ler<DocCenas>(t.origem.documento);
  if (!ehDocCenas(video.doc)) throw new Error(`${t.origem.documento} não é mais um vídeo de cenas`);
  const avisos: string[] = [];
  const titulo = b.manifesto().documentos.find((d) => d.id === idMusica)?.titulo ?? idMusica;
  // lido antes de aplicar; uma tentativa anterior que pôs a música no vídeo e parou antes de fechar a transição (o
  // registro preso pelo OneDrive, por exemplo) não põe outro clipe: só fecha
  const feitas = b.diario().filter((e) => e.transicao === t.id);
  const jaAplicada = feitas.find((e) => e.documento === video.arquivo);
  let patch: OperacaoPatch[];
  let caminho: string;
  let selecao: string | undefined;
  const alvo = t.intencao === 'criar' ? null : acharAlvoAudio(video.doc, t.origem.caminho) ?? acharClipePorId(video.doc, t.origem.caminho.split('@').pop() ?? '');
  const ligado = jaAplicada ? clipeDaMusica(video.doc, idMusica) : undefined;
  if (ligado) {
    patch = [];
    caminho = caminhoPorId(ligado.faixa, ligado.clipe);
    selecao = `/audio/faixas/${ligado.fi}/clipes/${ligado.ci}`;
  } else if (alvo?.clipe && alvo.ci !== undefined) {
    patch = patchLigarClipe({...alvo, clipe: alvo.clipe, ci: alvo.ci}, idMusica, render, titulo);
    caminho = caminhoPorId(alvo.faixa.id, alvo.clipe.id);
    selecao = `/audio/faixas/${alvo.fi}/clipes/${alvo.ci}`;
  } else {
    if (t.intencao !== 'criar') avisos.push(`o clipe ${t.origem.caminho} não está mais no vídeo; a música entrou como um clipe novo`);
    const faixa = acharAlvoAudio(video.doc, t.origem.caminho.replace(/\/clipes\/.*$/, ''))?.faixa;
    const em_ms = t.tempo?.em_ms ?? lido.doc.video?.em_ms ?? 0;
    const novo = patchClipeNovo(video.doc, {idMusica, nome: titulo, faixa: faixa?.id, papel: faixa && papelDe(faixa) === 'efeitos' ? 'efeitos' : 'musica', em_ms, render});
    patch = novo.patch;
    caminho = novo.caminho;
    const fi = (video.doc.audio?.faixas ?? []).findIndex((f) => f.id === novo.faixa);
    const ci = fi >= 0 ? video.doc.audio!.faixas[fi].clipes.length : 0;
    selecao = `/audio/faixas/${fi >= 0 ? fi : video.doc.audio?.faixas.length ?? 0}/clipes/${ci}`;
  }
  const feito = jaAplicada ? {seq: jaAplicada.seq} : patch.some((o) => o.op !== 'test')
    ? b.aplicar({documento: t.origem.documento, versao_base: video.versao, patch, rotulo: `música "${titulo}" no vídeo`, transicao: t.id})
    : undefined;
  t.estado = 'concluida';
  t.fechada_em = agora();
  t.seqs = [...feitas.map((e) => e.seq), ...(feito && !jaAplicada ? [feito.seq] : [])];
  if (feito) t.resultado = {seq: feito.seq, documento: t.origem.documento, caminho};
  guardar(b, r);
  const volta: ResultadoVolta = {area: t.origem.area, documento: t.origem.documento, selecao: selecao ?? t.origem.selecao, tempo_ms: t.origem.tempo_ms};
  return {transicao: t.id, seq: feito?.seq, documento: t.origem.documento, caminho, seqs: t.seqs, render, musica: idMusica, volta, avisos};
};

// ---------- cancelar_transicao ----------
/** Volta sem mexer na origem. Com `descartar`, as mudanças feitas no destino durante a transição são desfeitas, da
 *  última para a primeira (o documento criado por ela fica, vazio de novo, no projeto). */
export const cancelarTransicao = (b: BaseProjeto, p: {transicao: string; descartar?: boolean}) => {
  const {r, t} = acharAberta(b, p.transicao);
  let revertidas = 0;
  const avisos: string[] = [];
  if (p.descartar) {
    const entradas = b.diario().filter((e) => e.transicao === t.id && e.documento === t.destino.arquivo && !e.rotulo.startsWith('descartar:')).reverse();
    for (const e of entradas) {
      try {
        b.aplicar({documento: e.documento, patch: e.inverso, rotulo: `descartar: ${e.rotulo}`, transicao: t.id});
        revertidas++;
      } catch (erro) {
        avisos.push(`parei em ${e.seq} (${e.rotulo}): ${(erro as Error).message}`);
        break;
      }
    }
  }
  t.estado = 'cancelada';
  t.fechada_em = agora();
  t.seqs = seqsDa(b, t.id);
  guardar(b, r);
  const volta: ResultadoVolta = {area: t.origem.area, documento: t.origem.documento, selecao: t.origem.selecao, tempo_ms: t.origem.tempo_ms};
  return {transicao: t.id, revertidas, volta, avisos};
};
