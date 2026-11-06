// Prévia da interface no navegador, sem Electron: uma ponte `window.estudio` em memória, com projetos de mentira, para
// olhar e fotografar a tela inicial e o editor quando o Electron não pode rodar (o antivírus bloqueia o de
// desenvolvimento neste PC). Não grava nada em disco. Uso: npx vite --config vite.renderer.config.ts --port 5199 e abrir
// http://localhost:5199/scripts/previa-web/index.html
// Som: "escolher arquivo de áudio" devolve um WAV sintético (uma narração, depois uma música, alternando), como URL de
// blob que o <audio> e o Web Audio tocam de verdade; o envelope medido fica em memória e entra nas props como no app.
import jsonpatch, {type Operation} from 'fast-json-patch';
import type {ApiEstudio, InfoProjeto, Mudanca, NovoProjeto, Preferencias, Recente, Trilha} from '../../src/compartilhado/api';
import type {EntradaDocumento, Manifesto, Modulo} from '../../src/nucleo/documentos';
import type {Envelope} from '../../src/nucleo/audio';
import {novoDocCenas, resolverCenas, type DocCenas} from '../../src/nucleo/cenas';
import {MODELOS} from '../../src/nucleo/modelos';
import {codificarWav, musicaSintetica, narracaoSintetica, TAXA} from '../audio-sintetico';

type Proj = {raiz: string; manifesto: Manifesto; docs: Record<string, unknown>; versao: number};
const projetos = new Map<string, Proj>();
let aberto: Proj | null = null;
let prefs: Preferencias = {pasta_projetos: 'C:\\Users\\pessoa\\Estudio', ao_iniciar: 'inicio', formato_video: 'reels', formato_imagem: 'feed',
  boas_vindas_vista: new URLSearchParams(location.search).has('vista'), pasta_trilhas: 'C:\\Users\\pessoa\\Estudio\\trilhas'};

// ---------- som sintético ----------
const audios = new Map<string, {url: string; nome: string}>(); // url do blob → nome que o clipe mostra
const envelopes: Record<string, Envelope | undefined> = {};
const wavSintetico = (tipo: 'narracao' | 'musica', nome: string) => {
  const amostras = tipo === 'narracao' ? narracaoSintetica(12) : musicaSintetica(14);
  const url = URL.createObjectURL(new Blob([codificarWav([amostras], TAXA)], {type: 'audio/wav'}));
  audios.set(url, {url, nome});
  return url;
};
let vez = 0;
const proximoAudio = () => (vez++ % 2 === 0 ? wavSintetico('narracao', 'narração sintética.wav') : wavSintetico('musica', 'música sintética.wav'));
const TRILHAS: Trilha[] = [
  {nome: 'Cama suave', caminho: 'C:\\Users\\pessoa\\Estudio\\trilhas\\calmas\\cama-suave.mp3', pasta: 'calmas', tamanho_kb: 3812},
  {nome: 'Pulso leve', caminho: 'C:\\Users\\pessoa\\Estudio\\trilhas\\pulso-leve.wav', pasta: '', tamanho_kb: 12040},
];
// o clipe que entra com um blob ganha o nome do áudio sintético (no app, o nome vem do arquivo em midia/)
const nomearClipes = (doc: unknown) => {
  const andar = (x: unknown) => {
    if (Array.isArray(x)) x.forEach(andar);
    else if (x && typeof x === 'object') {
      const o = x as Record<string, unknown>;
      if (typeof o.arquivo === 'string' && audios.has(o.arquivo) && !o.nome) o.nome = audios.get(o.arquivo)!.nome;
      Object.values(o).forEach(andar);
    }
  };
  andar(doc);
};
const recentes: Recente[] = new URLSearchParams(location.search).has('vazio') ? [] : [
  {raiz: 'C:\\Users\\pessoa\\Estudio\\Cliente C2', nome: 'Cliente · C2 · Transferência de cidade', aberto_em: new Date(Date.now() - 3 * 3600e3).toISOString(), existe: true, modulos: ['video', 'imagem', '3d']},
  {raiz: 'C:\\Users\\pessoa\\Estudio\\Ferias', nome: 'Férias proporcionais', aberto_em: new Date(Date.now() - 26 * 3600e3).toISOString(), existe: true, modulos: ['video']},
  {raiz: 'C:\\Users\\pessoa\\Estudio\\Capa', nome: 'Capa do C3', aberto_em: new Date(Date.now() - 5 * 86400e3).toISOString(), existe: false, modulos: ['imagem']},
];
const ouvintesMudou = new Set<(m: Mudanca) => void>();
const mudou = (arquivo: string) => setTimeout(() => ouvintesMudou.forEach((f) => f({arquivo})), 30);

const info = (): InfoProjeto | null => aberto && {raiz: aberto.raiz, manifesto: structuredClone(aberto.manifesto), base_midia: '', claude: true, git: true,
  perfil: {nome: 'padrao', sessoes_claude: 4, escala_previa: 0.75, pixel_ratio: 1.5}, estado: null};

const docImagem = (l: number, a: number) => ({formato: 1, largura: l, altura: a, fundo: '#111418', camadas: [{id: 'titulo', nome: 'Título', tipo: 'texto',
  x: Math.round(l * 0.08), y: Math.round(a * 0.4), largura: Math.round(l * 0.84), altura: 200, texto: 'Seu título', fonte: 'Inter', tamanho: 90, peso: 700, cor: '#F2F2F2', alinhar: 'centro'}]});
const doc3d = () => ({formato: 1, fundo: '#111418', camera: {posicao: [4, 3, 6], alvo: [0, 0.5, 0], fov: 40}, luzes: [{id: 'a', tipo: 'ambiente', cor: '#fff', intensidade: 0.6}],
  objetos: [{id: 'caixa', nome: 'Caixa', tipo: 'caixa', posicao: [0, 0.75, 0], rotacao: [0, 25, 0], escala: [1.5, 1.5, 1.5], cor: '#70B8FF'}]});
const conteudo = (m: Modulo, f?: {largura: number; altura: number; fps?: number}) =>
  m === 'video' ? novoDocCenas({largura: f?.largura ?? 1080, altura: f?.altura ?? 1920, fps: f?.fps ?? 30}) : m === 'imagem' ? docImagem(f?.largura ?? 1080, f?.altura ?? 1350) : doc3d();

const novoDocumento = (p: Proj, modulo: Modulo, f?: {largura: number; altura: number; fps?: number}, titulo?: string): EntradaDocumento => {
  const base = modulo === '3d' ? 'cena3d' : modulo;
  let n = 1;
  while (p.manifesto.documentos.some((d) => d.id === (n === 1 ? base : `${base}-${n}`))) n++;
  const id = n === 1 ? base : `${base}-${n}`;
  const e: EntradaDocumento = {id, modulo, caminho: `${modulo}/${id}.json`, titulo: titulo || ({video: 'Vídeo', imagem: 'Imagem', '3d': 'Cena 3D'}[modulo] + (n > 1 ? ` ${n}` : ''))};
  p.manifesto.documentos.push(e);
  p.docs[id] = conteudo(modulo, f);
  return e;
};

const criar = (o: NovoProjeto): InfoProjeto => {
  const modelo = MODELOS.find((m) => m.id === o.modelo)!;
  if (modelo.exemplo) throw new Error('Na prévia web os modelos da Cliente não abrem (precisam do exemplo empacotado).');
  const nome = o.nome || 'Sem título · 05/11 14:32';
  const p: Proj = {raiz: `${prefs.pasta_projetos}\\${nome}`, manifesto: {formato: 1, nome, documentos: []}, docs: {}, versao: 1};
  novoDocumento(p, modelo.modulo, o.formato as never);
  projetos.set(p.raiz, p);
  aberto = p;
  recentes.unshift({raiz: p.raiz, nome, aberto_em: new Date().toISOString(), existe: true, modulos: [modelo.modulo]});
  return info()!;
};

const nada = () => undefined;
const api: ApiEstudio = {
  abrirPasta: async () => null,
  abrirExemplo: async () => {
    throw new Error('Na prévia web o exemplo da Cliente não abre (precisa do exemplo empacotado).');
  },
  abrirProjeto: async (raiz) => {
    const p = projetos.get(raiz);
    if (!p) throw new Error(`Na prévia web só abrem os projetos criados nesta sessão: ${raiz}`);
    aberto = p;
    return info()!;
  },
  projetoAtual: async () => info(),
  criarProjeto: async (o) => criar(o),
  fecharProjeto: async () => {
    aberto = null;
  },
  duplicarProjeto: async () => {
    throw new Error('Duplicar não funciona na prévia web.');
  },
  renomearProjeto: async (nome) => {
    aberto!.manifesto.nome = nome;
    mudou('estudio.json');
    return structuredClone(aberto!.manifesto);
  },
  criarDocumento: async (o) => {
    const e = novoDocumento(aberto!, o.modulo, o.formato as never, o.titulo);
    mudou('estudio.json');
    return e;
  },
  renomearDocumento: async (id, titulo) => {
    const d = aberto!.manifesto.documentos.find((x) => x.id === id)!;
    d.titulo = titulo;
    return d;
  },
  ambiente: async () => ({perfil: {nome: 'padrao', sessoes_claude: 4, escala_previa: 0.75, pixel_ratio: 1.5}, git: true, claude: true, versao: '0.2.0',
    pasta_padrao: 'C:\\Users\\pessoa\\Estudio'}),
  recentes: async () => structuredClone(recentes),
  esquecerRecente: async (raiz) => {
    const i = recentes.findIndex((r) => r.raiz === raiz);
    if (i >= 0) recentes.splice(i, 1);
  },
  preferencias: async () => prefs,
  gravarPreferencias: async (p) => (prefs = {...prefs, ...p}),
  escolherPasta: async () => null,
  mostrarNaPasta: nada,
  marcarVersao: async () => ({ok: true, mensagem: 'Ponto de restauração criado'}),
  escolherMidia: async (tipo) => (tipo === 'audio' ? proximoAudio() : null),
  aoPedirMiniatura: () => nada,
  lerDocumento: async <T,>(id: string) => ({doc: structuredClone(aberto!.docs[id]) as T, versao: String(aberto!.versao)}),
  lerJson: async <T,>() => [] as T,
  aplicarPatch: async ({documento, patch}) => {
    const r = jsonpatch.applyPatch(structuredClone(aberto!.docs[documento]), patch as Operation[], true, false);
    nomearClipes(r.newDocument);
    aberto!.docs[documento] = r.newDocument;
    aberto!.versao++;
    return {versao: String(aberto!.versao), seq: aberto!.versao};
  },
  desfazer: async () => ({ok: false, mensagem: 'desfazer não funciona na prévia web'}),
  propsVideo: async (id) => {
    const d = aberto!.docs[id] as DocCenas;
    const {props, avisos} = resolverCenas(d, {envelopes});
    return {props: props as never, avisos};
  },
  comentarios: async () => [],
  novoComentario: async () => {
    throw new Error('comentários não funcionam na prévia web');
  },
  responder: async () => {
    throw new Error('não');
  },
  resolverComentario: async () => {
    throw new Error('não');
  },
  reabrir: async () => {
    throw new Error('não');
  },
  diario: async () => [],
  gravarEstado: nada,
  aoMudar: (cb) => {
    ouvintesMudou.add(cb);
    return () => ouvintesMudou.delete(cb);
  },
  terminal: {criar: async () => ({id: 99}), escrever: nada, tamanho: nada, fechar: nada, aoReceber: () => nada, aoSair: () => nada},
  conversa: {
    conta: async () => ({instalado: true, logado: true, metodo: 'claude.ai', email: 'pessoa@exemplo.com.br', chave_api: false}),
    abrir: async () => ({id: Math.floor(Math.random() * 1000), sessao: 'previa'}),
    enviar: async () => undefined,
    permitir: nada,
    parar: nada,
    hibernar: async () => null,
    fechar: nada,
    aoEvento: () => nada,
  },
  exportarVideo: async () => ({ok: false, mensagem: 'exportar não funciona na prévia web'}),
  exportarImagem: async () => ({ok: false}),
  aoProgresso: () => nada,
  metricas: async () => ({memoria_mb: 312, processos: []}),
  audio: {
    gravarEnvelope: async (arquivo, envelope) => {
      envelopes[arquivo] = envelope;
      mudou(`${arquivo}.envelope.json`);
      return `${arquivo}.envelope.json`;
    },
    listarTrilhas: async () => ({pasta: prefs.pasta_trilhas, trilhas: TRILHAS}),
    importarTrilha: async (caminho) => wavSintetico('musica', `${TRILHAS.find((t) => t.caminho === caminho)?.nome ?? 'trilha'}.wav`),
  },
};

(window as unknown as {estudio: ApiEstudio}).estudio = api;
