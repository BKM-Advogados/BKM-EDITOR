// Estado da área Música na janela: a seleção dela (guardada à parte da do vídeo, então trocar de área não perde nem uma
// nem outra), o transporte (tocando, cabeça, loop, metrônomo), o zoom e o registro de transições lido do disco. A ida e
// volta com o vídeo passa pelas mesmas funções do MCP (window.estudio.musica → src/main/ipc-musica.ts); a janela
// acompanha o registro (.estudio/transicoes.json), então quando a IA abre ou fecha uma transição a área troca sozinha.
// Depois de qualquer mudança num documento de música (da pessoa ou da IA), os clipes do vídeo ligados a ele recebem o
// render novo (depoisDeMudar, com espera curta).
import {useRef, useSyncExternalStore} from 'react';
import type {OperacaoPatch} from '../../../nucleo/documentos';
import type {DocMusica} from '../../../nucleo/musica';
import type {PedidoEntrega} from '../../../nucleo/musica-entrega';
import type {PedidoLevar, ResultadoVolta, Transicao} from '../../../nucleo/transicoes';
import {abrirProjeto, aplicar, avisar, loja, mensagemDe, quandoTrocarProjeto} from '../../estado/loja';
import {atender} from '../../ponte-janela';

export type SelecaoMusica = {tipo: 'clipe' | 'canal' | 'faixa' | 'padrao' | 'documento'; id: string} | null;

export type EstadoMusica = {
  selecao: SelecaoMusica;
  tocando: boolean;
  cabeca_s: number; // posição da cabeça em segundos da música
  loop: boolean; // repete o trecho de loopDe a loopAte (batidas) ou, sem trecho, a música inteira
  loopDe?: number;
  loopAte?: number;
  metronomo: boolean;
  comoNoVideo: boolean; // "Ouvir como no vídeo": volume, fades e ducking do clipe ligado
  verVideo?: boolean; // o quadro do vídeo ligado na cabeça (item 25)
  pxPorBatida: number;
  aba: 'passos' | 'mixer';
  transicoes: Transicao[];
  renderizando: boolean;
  avisos: string[];
  autoAberta?: boolean; // a linha de automação de volume no pé do arranjo
  autoAlvo?: string; // 'master' ou o id de uma faixa do mixer
  focoNotas: boolean; // o piano roll tem notas selecionadas ou o teclado ligado: Delete, setas e letras são dele
};

let estado: EstadoMusica = {selecao: null, tocando: false, cabeca_s: 0, loop: false, metronomo: false, comoNoVideo: false, pxPorBatida: 28, aba: 'passos',
  transicoes: [], renderizando: false, avisos: [], focoNotas: false};
const ouvintes = new Set<() => void>();
export const musica = {
  get: () => estado,
  definir(p: Partial<EstadoMusica> | ((e: EstadoMusica) => Partial<EstadoMusica>)) {
    estado = {...estado, ...(typeof p === 'function' ? p(estado) : p)};
    ouvintes.forEach((f) => f());
  },
  assinar(f: () => void) {
    ouvintes.add(f);
    return () => {
      ouvintes.delete(f);
    };
  },
};

const igual = (a: unknown, b: unknown) => Object.is(a, b) || (Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => Object.is(x, b[i])));
export const useMusica = <T,>(sel: (e: EstadoMusica) => T): T => {
  const ultimo = useRef<{v: T} | null>(null);
  return useSyncExternalStore(musica.assinar, () => {
    const v = sel(estado);
    if (ultimo.current && igual(ultimo.current.v, v)) return ultimo.current.v;
    ultimo.current = {v};
    return v;
  });
};

// ---------- documento ativo ----------
export const idMusicaAtiva = () => loja.get().ativo.musica;
export const docMusica = (id = idMusicaAtiva()): DocMusica | undefined => (id ? (loja.get().docs[id]?.doc as DocMusica | undefined) : undefined);
export const selecionarMusica = (s: SelecaoMusica) => musica.definir({selecao: s});

/** Patch no documento de música ativo (diário, versão), e os clipes do vídeo ligados recebem o render novo. */
export const aplicarMusica = async (patch: OperacaoPatch[], rotulo: string, id = idMusicaAtiva()) => {
  if (!id || !patch.length) return false;
  const ok = await aplicar(id, patch, rotulo);
  if (ok) agendarVideo(id);
  return ok;
};

// ---------- a música chega ao vídeo ----------
const esperas = new Map<string, ReturnType<typeof setTimeout>>();
/** Espera curta depois da última edição e leva o render aos clipes ligados (idempotente: render pelo código). */
export const agendarVideo = (id: string, ms = 700) => {
  clearTimeout(esperas.get(id));
  esperas.set(id, setTimeout(() => {
    esperas.delete(id);
    musica.definir({renderizando: true});
    void window.estudio.musica.depoisDeMudar(id)
      .then((r) => {
        if (r.aviso) avisar(`Música: ${r.aviso}`, 'info');
        else if (r.trocados.length) avisar(`Trilha atualizada no vídeo (${r.trocados.length} ${r.trocados.length === 1 ? 'clipe' : 'clipes'})`, 'ok');
      })
      .catch((e: unknown) => avisar(mensagemDe(e), 'erro'))
      .finally(() => musica.definir({renderizando: false}));
  }, ms));
};

// ---------- ida e volta ----------
const feitasAqui = new Set<string>(); // transições abertas ou fechadas por esta janela: a área já trocou

const irParaMusica = (documento: string, selecao?: string) => {
  loja.definir((e) => ({area: 'musica', ativo: {...e.ativo, musica: documento}}));
  const id = selecao?.match(/@([^/]+)$/)?.[1];
  musica.definir({selecao: id ? {tipo: 'clipe', id} : null, cabeca_s: 0});
};

const voltarPara = (v: ResultadoVolta) => {
  const modulo = v.area === 'efeitos' || v.area === 'musica' ? undefined : v.area;
  loja.definir((e) => ({
    area: v.area,
    ...(modulo ? {ativo: {...e.ativo, [modulo]: v.documento}} : {}),
    ...(v.selecao ? {selecao: {documento: v.documento, caminho: v.selecao}} : {}),
    ...(v.tempo_ms !== undefined ? {tempo_ms: v.tempo_ms} : {}),
  }));
};

const relerProjeto = async () => {
  const info = await window.estudio.projetoAtual();
  if (info) await abrirProjeto(info);
};

/** "Editar em Música" / "Criar em Música": abre a Música com o alvo do vídeo. */
export const levarParaMusica = async (p: Omit<PedidoLevar, 'modulo' | 'de'>) => {
  try {
    const e = loja.get();
    const r = await window.estudio.musica.levar({...p, modulo: 'musica', de: {area: e.area, selecao: e.selecao?.documento === p.alvo.documento ? e.selecao.caminho : undefined, tempo_ms: e.tempo_ms}});
    feitasAqui.add(r.transicao);
    if (r.criado) await relerProjeto();
    irParaMusica(r.destino.documento, r.destino.selecao);
    await lerTransicoes();
    return r;
  } catch (e) {
    avisar(mensagemDe(e), 'erro');
    return null;
  }
};

export const concluirTransicao = async (id: string) => {
  try {
    feitasAqui.add(id);
    musica.definir({renderizando: true, tocando: false});
    const r = await window.estudio.musica.concluir(id);
    voltarPara(r.volta);
    for (const a of r.avisos) avisar(a, 'info');
    avisar('Música no vídeo', 'ok');
    await lerTransicoes();
  } catch (e) {
    avisar(mensagemDe(e), 'erro');
  } finally {
    musica.definir({renderizando: false});
  }
};

export const cancelarTransicao = async (id: string, descartar = false) => {
  try {
    feitasAqui.add(id);
    musica.definir({tocando: false});
    const r = await window.estudio.musica.cancelar(id, descartar);
    voltarPara(r.volta);
    avisar(descartar ? `Voltou sem mudar o vídeo; ${r.revertidas} ${r.revertidas === 1 ? 'mudança desfeita' : 'mudanças desfeitas'} na música` : 'Voltou sem mudar o vídeo', 'info');
    await lerTransicoes();
  } catch (e) {
    avisar(mensagemDe(e), 'erro');
  }
};

/** O que a IA lê no estado_do_editor quando a pessoa está na Música: a seleção como caminho no documento e a cabeça
 *  (só parada: tocando, o estado não é regravado a cada quadro). */
export const estadoDaMusica = () => {
  const doc = docMusica();
  const s = estado.selecao;
  const lista = s?.tipo === 'clipe' ? doc?.arranjo.clipes : s?.tipo === 'canal' ? doc?.canais : s?.tipo === 'padrao' ? doc?.padroes : s?.tipo === 'faixa' ? doc?.mixer.faixas : undefined;
  const i = s && lista ? lista.findIndex((x) => x.id === s.id) : -1;
  const raiz = {clipe: '/arranjo/clipes', canal: '/canais', padrao: '/padroes', faixa: '/mixer/faixas', documento: ''}[s?.tipo ?? 'documento'];
  return {selecao: i >= 0 ? `${raiz}/${i}` : undefined, tempo_ms: estado.tocando ? undefined : Math.round(estado.cabeca_s * 1000)};
};

/** A transição aberta (a última), se houver. */
export const transicaoAberta = (e: EstadoMusica = estado) => e.transicoes.filter((t) => t.estado === 'aberta').pop();

let primeiraLeitura = true;
/** Relê o registro; transição aberta ou fechada por outra mão (a IA, outro app) leva a área junto. */
export const lerTransicoes = async () => {
  let lista: Transicao[] = [];
  try {
    const r = await window.estudio.lerJson<{transicoes?: Transicao[]}>('.estudio/transicoes.json');
    lista = Array.isArray(r?.transicoes) ? r.transicoes : [];
  } catch {
    lista = [];
  }
  const antes = new Map(estado.transicoes.map((t) => [t.id, t.estado]));
  musica.definir({transicoes: lista});
  if (primeiraLeitura) {
    primeiraLeitura = false;
    return;
  }
  for (const t of lista) {
    if (feitasAqui.has(t.id)) continue;
    const eraAberta = antes.get(t.id) === 'aberta';
    if (t.estado === 'aberta' && !antes.has(t.id)) {
      // (sem feitasAqui: quando a IA fecha esta transição, a tela também volta com ela)
      await relerProjeto();
      irParaMusica(t.destino.documento, t.destino.selecao);
      avisar('A IA abriu a Música com o áudio do vídeo', 'agente');
    } else if (eraAberta && t.estado !== 'aberta') {
      feitasAqui.add(t.id);
      voltarPara({area: t.origem.area, documento: t.origem.documento, selecao: t.origem.selecao, tempo_ms: t.origem.tempo_ms});
      avisar(t.estado === 'concluida' ? 'A IA concluiu a música e voltou ao vídeo' : 'A IA cancelou a edição na Música', 'agente');
    }
  }
};

/** Liga a área ao disco: registro de transições e mudanças nos documentos de música (para levar o render ao vídeo). */
export const observarMusica = () => {
  const comecar = () => {
    primeiraLeitura = true;
    feitasAqui.clear();
    musica.definir({transicoes: [], selecao: null, tocando: false, cabeca_s: 0});
    void lerTransicoes();
  };
  comecar();
  const largarTroca = quandoTrocarProjeto(() => setTimeout(comecar, 300));
  // o render que vai para o vídeo: o processo principal pede, o Web Worker da janela faz (motor.ts carrega só aqui)
  const largarRender = atender('musica:render', async (dados) => {
    const {doc, porFaixa, sohMedir} = dados as {doc: DocMusica; porFaixa?: boolean; sohMedir?: boolean};
    const r = await (await import('./motor')).motor.renderParaVideo(doc, porFaixa);
    if (!r.ok) throw new Error(r.mensagem);
    return {duracao_s: r.duracao_s, avisos: r.avisos, faltando: r.faltando, medida: r.medida, faixas: r.faixas, ...(sohMedir ? {} : {wav: r.wav, envelope: r.envelope})};
  });
  // exportar a música em arquivo (item 23): a conta no worker; o processo principal grava e codifica
  const largarEntrega = atender('musica:exportar', async (dados) => {
    const {doc, pedido} = dados as {doc: DocMusica; pedido: PedidoEntrega};
    const r = await (await import('./motor')).motor.entregaParaArquivo(doc, pedido);
    if (!r.ok) throw new Error(r.mensagem);
    return r.entrega;
  });
  const largar = window.estudio.aoMudar(({arquivo}) => {
    if (arquivo === '.estudio/transicoes.json') return void lerTransicoes();
    const d = loja.get().info?.manifesto.documentos.find((x) => x.caminho === arquivo && x.modulo === 'musica');
    if (d) agendarVideo(d.id);
  });
  return () => {
    largar();
    largarTroca();
    largarRender();
    largarEntrega();
  };
};

// ---------- cor por canal (ux/pesquisa-ux-visual.md, item 15) ----------
// Cada canal ganha uma cor de faixa automática pela ordem (a mesma no arranjo, na lista, no inspetor e no mixer), da paleta
// de faixa dos tokens, que não coincide com os sinais (âmbar, violeta, vermelho). Não grava nada no documento.
export const CORES_CANAL = ['var(--faixa-azul)', 'var(--faixa-verde)', 'var(--faixa-rosa)', 'var(--faixa-areia)', 'var(--faixa-ciano)', 'var(--faixa-lima)'];
export const corDoCanal = (indice: number) => CORES_CANAL[((indice % CORES_CANAL.length) + CORES_CANAL.length) % CORES_CANAL.length];
/** A cor da faixa do mixer: a do canal que toca nela (faixa sem canal, a do fim da lista). */
export const corDaFaixa = (canais: {faixa_mixer?: string; id: string}[], faixa: string) => {
  const i = canais.findIndex((c) => (c.faixa_mixer ?? c.id) === faixa);
  return corDoCanal(i >= 0 ? i : canais.length);
};
