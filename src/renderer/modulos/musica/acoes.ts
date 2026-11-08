// Ações da área Música: as edições de src/nucleo/musica-acoes.ts (as mesmas das ferramentas MCP) aplicadas no documento
// ativo, e os campos do mixer e do documento por patch. Tudo vai para o diário e o Ctrl+Z da pessoa desfaz.
import type {OperacaoPatch} from '../../../nucleo/documentos';
import {alternarNota, alternarPasso, aplicarEstilo, aplicarProgressao, criarPadrao, editarArranjo, escreverNotas, gerarNotas, novoCanalDeAudio, type Edicao, type EstiloGerado,
  type PedidoArranjo, type TipoGerado} from '../../../nucleo/musica-acoes';
import {idLivre, resolverMusica, type DocMusica, type FaixaMixer, type PecaBateria, type PresetSintetizador} from '../../../nucleo/musica';
import {avisar, mensagemDe, patchTrocar, valorEm} from '../../estado/loja';
import {aplicarMusica, docMusica, idMusicaAtiva, musica, selecionarMusica} from './estado';
import {motor, urlDaMidia} from './motor';

const fazer = async (f: (doc: DocMusica) => Edicao) => {
  const doc = docMusica();
  if (!doc) return null;
  try {
    const e = f(doc);
    for (const a of e.avisos ?? []) avisar(a, 'info');
    return (await aplicarMusica(e.patch, e.rotulo)) ? e : null;
  } catch (erro) {
    avisar(mensagemDe(erro), 'erro');
    return null;
  }
};

export const arranjar = (p: PedidoArranjo) => fazer((d) => editarArranjo(d, p));

export const dividirNaCabeca = async () => {
  const s = musica.get().selecao;
  const doc = docMusica();
  if (s?.tipo !== 'clipe' || !doc) return avisar('Selecione um clipe para dividir na cabeça', 'info');
  const em = musica.get().cabeca_s / (60 / doc.bpm);
  const e = await arranjar({acao: 'dividir', clipe: s.id, em});
  const novo = (e?.extra?.clipes as string[] | undefined)?.[1];
  if (novo) selecionarMusica({tipo: 'clipe', id: novo});
};

export const apagarSelecionado = async () => {
  const s = musica.get().selecao;
  if (s?.tipo !== 'clipe') return;
  if (await arranjar({acao: 'apagar', clipe: s.id})) selecionarMusica(null);
};

export const passo = (padrao: string, peca: PecaBateria, em: number, forca?: number) => fazer((d) => alternarPasso(d, padrao, peca, em, forca));
export const forcaDaNota = (padrao: string, peca: PecaBateria, em: number, forca: number) =>
  fazer((d) => escreverNotas(d, {padrao, notas: [{peca, em, forca: Math.min(127, Math.max(1, Math.round(forca)))}]}));
export const estilo = (padrao: string, id: string) => fazer((d) => aplicarEstilo(d, padrao, id));
export const novoPadrao = async (canal: string, o: {clonar?: string; estilo?: string; no_arranjo?: boolean; variar?: string} = {}) => {
  const e = await fazer((d) => criarPadrao(d, {canal, clonar: o.clonar, estilo: o.estilo, no_arranjo: o.no_arranjo ? {} : undefined, ...(o.variar ? {variar: {de: o.variar}} : {})}));
  const id = e?.extra?.padrao as string | undefined;
  if (id) selecionarMusica({tipo: 'padrao', id});
  return e;
};

/** "+ Bateria": canal novo com o estilo básico, já no arranjo, do começo ao fim da música (ao menos quatro compassos). */
export const novaBateria = async () => {
  const doc = docMusica();
  if (!doc) return;
  const canal = doc.canais.some((c) => c.id === 'bateria') ? idLivre('bateria-', doc.canais.map((c) => c.id)) : 'bateria';
  const m = resolverMusica(doc).musica;
  const dur = Math.max(4, Math.ceil(m.duracao_batidas / m.batidas_por_compasso - 1e-9)) * m.batidas_por_compasso;
  const e = await fazer((d) => criarPadrao(d, {canal, estilo: 'basico', no_arranjo: {em: 0, dur}}));
  if (e?.extra?.padrao) {
    selecionarMusica({tipo: 'padrao', id: e.extra.padrao as string});
    musica.definir({aba: 'passos'});
  }
};

/** "+ Áudio…": escolhe um arquivo (vai para midia/), mede a duração e põe num canal novo. */
export const novoAudio = async () => {
  const arquivo = await window.estudio.escolherMidia('audio');
  if (!arquivo) return;
  let dur = 4;
  try {
    const r = await fetch(urlDaMidia(arquivo));
    dur = (await motor.contexto().decodeAudioData(await r.arrayBuffer())).duration;
  } catch {
    avisar('Não deu para medir o áudio: o clipe ficou com 4 s; ajuste a duração no inspetor', 'info');
  }
  const e = await fazer((d) => novoCanalDeAudio(d, arquivo, dur));
  if (e?.extra?.clipe) selecionarMusica({tipo: 'clipe', id: e.extra.clipe as string});
};

// ---------- campos por patch ----------
/** Troca um campo do documento de música ativo (com test no valor antigo). */
export const campo = (caminho: string, valor: unknown, rotulo: string) => {
  const id = idMusicaAtiva();
  const doc = docMusica(id);
  if (!id || !doc) return Promise.resolve(false);
  return aplicarMusica(patchTrocar(doc, caminho, valor), rotulo, id);
};

/** Campo de uma faixa do mixer; a faixa que só existe implícita (um canal pede e o documento não tem) entra no documento. */
export const campoFaixa = (faixa: string, chave: keyof FaixaMixer | string, valor: unknown, rotulo: string) => {
  const doc = docMusica();
  if (!doc) return Promise.resolve(false);
  const i = doc.mixer.faixas.findIndex((f) => f.id === faixa);
  if (i >= 0) return campo(`/mixer/faixas/${i}/${chave}`, valor, rotulo);
  const nova: Record<string, unknown> = {id: faixa, nome: doc.canais.find((c) => (c.faixa_mixer || c.id) === faixa)?.nome ?? faixa};
  const partes = String(chave).split('/');
  if (partes.length === 1) nova[partes[0]] = valor;
  else nova[partes[0]] = {[partes[1]]: valor};
  const patch: OperacaoPatch[] = [{op: 'add', path: '/mixer/faixas/-', value: nova}];
  return aplicarMusica(patch, rotulo);
};

/** Campo dentro de um objeto que pode faltar (eq, compressor, ajuste de peça): cria o objeto se preciso. */
export const campoEmObjeto = (base: string, chave: string, valor: unknown, rotulo: string) => {
  const doc = docMusica();
  if (!doc) return Promise.resolve(false);
  if (valorEm(doc, base) === undefined) return campo(base, valor === undefined ? undefined : {[chave]: valor}, rotulo);
  return campo(`${base}/${chave}`, valor, rotulo);
};


// ---------- sintetizadores, tom e acordes ----------
export const nota = (padrao: string, midi: number, em: number, dur: number) => fazer((d) => alternarNota(d, padrao, midi, em, dur));

/** "+ Instrumento": canal de sintetizador com um padrão vazio, já no arranjo do começo ao fim da música. */
export const novoSintetizador = async (preset: PresetSintetizador) => {
  const doc = docMusica();
  if (!doc) return;
  const canal = doc.canais.some((c) => c.id === preset) ? idLivre(`${preset}-`, doc.canais.map((c) => c.id)) : preset;
  const m = resolverMusica(doc).musica;
  const dur = Math.max(4, Math.ceil(m.duracao_batidas / m.batidas_por_compasso - 1e-9)) * m.batidas_por_compasso;
  const e = await fazer((d) => criarPadrao(d, {canal, instrumento: preset, no_arranjo: {em: 0, dur}}));
  if (e?.extra?.padrao) {
    selecionarMusica({tipo: 'padrao', id: e.extra.padrao as string});
    musica.definir({aba: 'passos'});
  }
};

/** Acordes digitados ("I vi IV V" ou "C Am F G"), um por compasso, a partir do começo. */
export const progressao = (texto: string) => fazer((d) => aplicarProgressao(d, {acordes: texto.split(/[\s,|]+/).filter(Boolean)}));

export const gerar = async (tipo: TipoGerado, estilo?: EstiloGerado) => {
  const e = await fazer((d) => gerarNotas(d, {tipo, estilo}));
  if (e?.extra?.padrao) {
    selecionarMusica({tipo: 'padrao', id: e.extra.padrao as string});
    musica.definir({aba: 'passos'});
  }
};
