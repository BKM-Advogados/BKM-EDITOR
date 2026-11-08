// Prévia da interface no navegador, sem Electron: uma ponte `window.estudio` em memória, com projetos de mentira, para
// olhar e fotografar a tela inicial e o editor quando o Electron não pode rodar (o antivírus bloqueia o de
// desenvolvimento neste PC). Não grava nada em disco; a exportação é de mentira (andamento simulado), só para o diálogo.
// Uso: npx vite --config vite.renderer.config.ts --port 5199 e abrir
// http://localhost:5199/scripts/previa-web/index.html
// Som: "escolher arquivo de áudio" devolve um WAV sintético (uma narração, depois uma música, alternando), como URL de
// blob que o <audio> e o Web Audio tocam de verdade; o envelope medido fica em memória e entra nas props como no app.
import jsonpatch, {type Operation} from 'fast-json-patch';
import type {ApiEstudio, InfoProjeto, MarcaInfo, Mudanca, NovoProjeto, Preferencias, Progresso, ProgressoTranscricao, Recente, ResultadoLimpezaVoz, Trilha} from '../../src/compartilhado/api';
import type {EntradaDocumento, Manifesto, Modulo} from '../../src/nucleo/documentos';
import type {Envelope, IntensidadeLimpeza} from '../../src/nucleo/audio';
import {LimpezaCancelada, limparVoz} from '../../src/nucleo/limpeza-voz';
import {medirMistura, type FonteAudio, type MedidasLoudness} from '../../src/nucleo/loudness';
import type {Fato, Fonte, Pesquisa} from '../../src/nucleo/pesquisa';
import {novoDocCenas, resolverCenas, type DocCenas} from '../../src/nucleo/cenas';
import {idDeMarca, MARCA_NEUTRO, MARCAS_INICIAIS, patchDaMarca, temaDaMarca, type Marca} from '../../src/nucleo/marca';
import {MODELOS} from '../../src/nucleo/modelos';
import {codificarWav, decodificarWav, musicaSintetica, narracaoSintetica, TAXA} from '../audio-sintetico';
import {argumentosDoRender, destinoDoFormato, nomesDosArquivos, normalizarPrefsExportacao, type OpcoesExportarVideo, type PrefsExportacao} from '../../src/nucleo/exportacao';
import {caminhoSemFundo, MODELO_FUNDO} from '../../src/nucleo/remover-fundo';

type Proj = {raiz: string; manifesto: Manifesto; docs: Record<string, unknown>; versao: number};
const projetos = new Map<string, Proj>();
let aberto: Proj | null = null;
const PASTA_MARCAS = 'C:\\Users\\pessoa\\Estudio\\marcas';
let prefs: Preferencias = {pasta_projetos: 'C:\\Users\\pessoa\\Estudio', ao_iniciar: 'inicio', formato_video: 'reels', formato_imagem: 'feed',
  boas_vindas_vista: new URLSearchParams(location.search).has('vista'), pasta_trilhas: 'C:\\Users\\pessoa\\Estudio\\trilhas', pasta_marcas: PASTA_MARCAS};

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
// kits de marca em memória: os três de fábrica, sem logo (não há servidor de mídia aqui), e um quarto com uma fonte de
// arquivo de verdade: o woff2 do JetBrains Mono que o Vite já serve de node_modules, para ver a fonte própria chegar à
// prévia pelo mesmo caminho do app (tema.fontes_arquivos → registro → @remotion/fonts). Vai como URL completa porque o
// Vite não entende o "@" codificado que o midia() produziria no caminho.
const comPasta = (m: Marca): MarcaInfo => ({...structuredClone(m), logo: undefined, pasta: `${PASTA_MARCAS}\\${m.id}`, url: location.origin});
const FONTE_EXEMPLO = {familia: 'JetBrains Mono Arquivo', arquivo: `${location.origin}/node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-600-normal.woff2`, peso: 600};
const marcas: MarcaInfo[] = [...MARCAS_INICIAIS.map(comPasta), comPasta({formato: 1, id: 'exemplo-fonte', nome: 'Exemplo · fonte própria',
  cores: {fundo: '#1B1F2A', texto: '#F6F1E7', destaque: '#E0B35A', suave: '#A9B0BE'}, fontes: {titulo: FONTE_EXEMPLO.familia, texto: FONTE_EXEMPLO.familia, arquivos: [FONTE_EXEMPLO]},
  notas: 'Só na prévia web: a fonte vem de node_modules pelo Vite.'})];
const aplicarMarca = (p: Proj, idMarca: string, documento: string) => {
  const m = marcas.find((k) => k.id === idMarca);
  if (!m) throw new Error(`kit de marca não achado: ${idMarca}`);
  // sem disco não há cópia para fontes/: o tema aponta para o arquivo onde ele está
  const patch = patchDaMarca(p.docs[documento], m, temaDaMarca(m, {fontes_arquivos: m.fontes.arquivos}));
  if (!patch.length) throw new Error(`o documento ${documento} não recebe kit de marca (só vídeo de cenas e imagem)`);
  p.docs[documento] = jsonpatch.applyPatch(structuredClone(p.docs[documento]), patch as Operation[], true, false).newDocument;
  p.versao++;
  return {versao: String(p.versao), marca: m.id, nome: m.nome, copiados: []};
};
const recentes: Recente[] = new URLSearchParams(location.search).has('vazio') ? [] : [
  {raiz: 'C:\\Users\\pessoa\\Estudio\\Cliente C2', nome: 'Cliente · C2 · Transferência de cidade', aberto_em: new Date(Date.now() - 3 * 3600e3).toISOString(), existe: true, modulos: ['video', 'imagem', '3d']},
  {raiz: 'C:\\Users\\pessoa\\Estudio\\Ferias', nome: 'Férias proporcionais', aberto_em: new Date(Date.now() - 26 * 3600e3).toISOString(), existe: true, modulos: ['video']},
  {raiz: 'C:\\Users\\pessoa\\Estudio\\Capa', nome: 'Capa do C3', aberto_em: new Date(Date.now() - 5 * 86400e3).toISOString(), existe: false, modulos: ['imagem']},
];
// ---------- pesquisa de exemplo ----------
// Duas fontes e três fatos, à mão (pesquisa.ts usa node:crypto e não roda aqui): um fato que confere, um com número
// que não está no trecho e um com o trecho só parecido. Os textos são recortes do art. 477 da CLT; inicio e fim saem
// do próprio texto, como o registrar_fato faria. O sha256 é de mentira.
const TEXTO_CLT = [
  'Art. 477.  Na extinção do contrato de trabalho, o empregador deverá proceder à anotação na Carteira de Trabalho e Previdência Social, comunicar a dispensa aos órgãos competentes e realizar o pagamento das verbas rescisórias no prazo e na forma estabelecidos neste artigo.  (Redação dada pela Lei nº 13.467, de 2017)',
  '§ 1o (Revogado).   (Redação dada pela Lei nº 13.467, de 2017)',
  '§ 6o  A entrega ao empregado de documentos que comprovem a comunicação da extinção contratual aos órgãos competentes bem como o pagamento dos valores constantes do instrumento de rescisão ou recibo de quitação deverão ser efetuados até dez dias contados a partir do término do contrato.  (Redação dada pela Lei nº 13.467, de 2017)',
  'a) (revogado);  (Redação dada pela Lei nº 13.467, de 2017)',
  'b) (revogado).  (Redação dada pela Lei nº 13.467, de 2017)',
  '§ 8º - A inobservância do disposto no § 6º deste artigo sujeitará o infrator à multa de 160 BTN, por trabalhador, bem assim ao pagamento da multa a favor do empregado, em valor equivalente ao seu salário, devidamente corrigido pelo índice de variação do BTN, salvo quando, comprovadamente, o trabalhador der causa à mora.  (Incluído pela Lei nº 7.855, de 24.10.1989)',
].join('\n');
const TEXTO_CAMARA = [
  '§ 4º O pagamento a que fizer jus o empregado será efetuado: (Redação dada pela Lei nº 13.467, de 2017)',
  'I - em dinheiro, depósito bancário ou cheque visado, conforme acordem as partes; ou (Incluído pela Lei nº 13.467, de 2017)',
  'II - em dinheiro ou depósito bancário quando o empregado for analfabeto. (Incluído pela Lei nº 13.467, de 2017)',
].join('\n');
const textosFonte: Record<string, string> = {f1: TEXTO_CLT, f2: TEXTO_CAMARA};
const TRECHO_PRAZO = 'deverão ser efetuados até dez dias contados a partir do término do contrato.';
const TRECHO_ANALFABETO = 'II - em dinheiro ou depósito bancário quando o empregado for analfabeto.';
const fatoDeExemplo = (f: Omit<Fato, 'inicio' | 'fim' | 'criado_em' | 'autor'>, texto: string, achado: string): Fato => ({
  ...f, ...(texto.includes(achado) ? {inicio: texto.indexOf(achado), fim: texto.indexOf(achado) + achado.length} : {}), criado_em: new Date(Date.now() - 40 * 60e3).toISOString(), autor: 'Claude 1',
});
const fontesDeExemplo: Fonte[] = [
  {id: 'f1', url: 'https://www.planalto.gov.br/ccivil_03/decreto-lei/del5452compilado.htm', titulo: 'Del5452compilado', orgao: 'Presidência da República — Casa Civil, Subchefia para Assuntos Jurídicos',
    nivel: 1, catalogo: 'planalto', acessado_em: new Date(Date.now() - 50 * 60e3).toISOString(), http: 200, bytes: 1512334, sha256: '0'.repeat(64),
    arquivo: 'pesquisa/fontes/f1.txt', sinais_vigencia: ['(Revogad', 'Redação dada pela', '(Incluído'],
    observacao: '06/11/2026 10:12 · Claude 1: texto compilado da CLT, baixado pelo servidor do escritório (o Planalto recusa o IP do escritório).', autor: 'Claude 1'},
  {id: 'f2', url: 'https://www2.camara.leg.br/legin/fed/declei/1940-1949/decreto-lei-5452-1-maio-1943-415500-publicacaooriginal-1-pe.html',
    titulo: 'Decreto-Lei nº 5.452, de 1º de maio de 1943', orgao: 'Câmara dos Deputados', nivel: 1, catalogo: 'camara-legin',
    acessado_em: new Date(Date.now() - 45 * 60e3).toISOString(), http: 200, bytes: 48211, sha256: '1'.repeat(64), arquivo: 'pesquisa/fontes/f2.txt',
    sinais_vigencia: ['Redação dada pela', '(Incluído'], autor: 'Claude 1'},
];
const fatosDeExemplo: Fato[] = [
  fatoDeExemplo({id: 'F1', afirmacao: 'A empresa tem até 10 dias, contados do fim do contrato, para pagar a rescisão.', fonte_id: 'f1',
    localizador: 'CLT, art. 477, § 6º', trecho: TRECHO_PRAZO, achado: 'exato', digitos: {afirmacao: ['10'], faltando: []},
    vigencia: ['(Revogad', 'Redação dada pela'], estado: 'trecho_confere'}, TEXTO_CLT, TRECHO_PRAZO),
  fatoDeExemplo({id: 'F2', afirmacao: 'A empresa tem até 15 dias, contados do fim do contrato, para pagar a rescisão.', fonte_id: 'f1',
    localizador: 'CLT, art. 477, § 6º', trecho: TRECHO_PRAZO, achado: 'exato', digitos: {afirmacao: ['15'], faltando: ['15']},
    vigencia: ['(Revogad', 'Redação dada pela'], estado: 'a_revisar', nota: 'o trecho fala em dez dias'}, TEXTO_CLT, TRECHO_PRAZO),
  fatoDeExemplo({id: 'F3', afirmacao: 'Trabalhador analfabeto recebe a rescisão em dinheiro ou depósito no banco.', fonte_id: 'f2',
    localizador: 'CLT, art. 477, § 4º, II', trecho: 'II – em dinheiro ou deposito bancario quando o empregado for analfabeto', achado: 'parecido',
    digitos: {afirmacao: [], faltando: []}, vigencia: ['(Incluído'], estado: 'a_revisar'}, TEXTO_CAMARA, TRECHO_ANALFABETO),
];
const pesquisaDeExemplo: Pesquisa = {formato: 1, fontes: fontesDeExemplo, fatos: fatosDeExemplo};

const ouvintesMudou = new Set<(m: Mudanca) => void>();
const mudou = (arquivo: string) => setTimeout(() => ouvintesMudou.forEach((f) => f({arquivo})), 30);

// exportação de mentira: andamento em pouco mais de 1 s por destino, cancelável, nada gravado
const ouvintesProgresso = new Set<(p: Progresso) => void>();
let exportacaoCancelada = false;
const progresso = (p: Progresso) => ouvintesProgresso.forEach((f) => f(p));
const esperar = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const pastaSaidas = () => `${aberto!.raiz}\\saidas`;

const info = (): InfoProjeto | null => aberto && {raiz: aberto.raiz, manifesto: structuredClone(aberto.manifesto), base_midia: '', claude: true, git: true,
  perfil: {nome: 'padrao', sessoes_claude: 4, escala_previa: 0.75, pixel_ratio: 1.5}, estado: null};

const docImagem = (l: number, a: number) => ({formato: 1, largura: l, altura: a, fundo: '#111418', camadas: [{id: 'titulo', nome: 'Título', tipo: 'texto',
  x: Math.round(l * 0.08), y: Math.round(a * 0.4), largura: Math.round(l * 0.84), altura: 200, texto: 'Seu título', fonte: 'Inter', tamanho: 90, peso: 700, cor: '#F2F2F2', alinhar: 'centro'}]});
const doc3d = () => ({formato: 1, fundo: '#111418', camera: {posicao: [4, 3, 6], alvo: [0, 0.5, 0], fov: 40}, luzes: [{id: 'a', tipo: 'ambiente', cor: '#fff', intensidade: 0.6}],
  objetos: [{id: 'caixa', nome: 'Caixa', tipo: 'caixa', posicao: [0, 0.75, 0], rotacao: [0, 25, 0], escala: [1.5, 1.5, 1.5], cor: '#70B8FF'}]});
const docVideo = (f?: {largura: number; altura: number; fps?: number}) => {
  const d = novoDocCenas({largura: f?.largura ?? 1080, altura: f?.altura ?? 1920, fps: f?.fps ?? 30});
  // o primeiro bloco já cita um fato da pesquisa de exemplo, para ver as etiquetas no inspetor
  const bloco = d.cenas[0]?.blocos[0];
  if (bloco) bloco.refs = ['F1'];
  return d;
};
const conteudo = (m: Modulo, f?: {largura: number; altura: number; fps?: number}) =>
  m === 'video' ? docVideo(f) : m === 'imagem' ? docImagem(f?.largura ?? 1080, f?.altura ?? 1350) : doc3d();

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
  const doc = novoDocumento(p, modelo.modulo, o.formato as never);
  if (o.marca) aplicarMarca(p, o.marca, doc.id);
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
  ambiente: async () => ({perfil: {nome: 'padrao', sessoes_claude: 4, escala_previa: 0.75, pixel_ratio: 1.5}, git: true, claude: true, versao: '0.3.0',
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
  exportarVideo: async (documento, opcoes) => {
    exportacaoCancelada = false;
    const {props} = resolverCenas(aberto!.docs[documento] as DocCenas);
    const formato = {largura: props.largura, altura: props.altura, fps: props.fps};
    const o: OpcoesExportarVideo = {codec: 'h264', qualidade: 'alta', escala: 1, ...opcoes, destinos: opcoes?.destinos?.length ? opcoes.destinos : [destinoDoFormato(formato)]};
    const base = o.nome?.trim() || aberto!.manifesto.documentos.find((d) => d.id === documento)?.titulo || documento;
    const planos = nomesDosArquivos(base, o.destinos, formato);
    const arquivos: string[] = [];
    progresso({tipo: 'status', mensagem: 'Preparando o navegador de render… (prévia web: nada é gravado)'});
    await esperar(500);
    for (const [i, plano] of planos.entries()) {
      const a = argumentosDoRender(o, plano.destino, formato, props.duracao_ms);
      const nome = `${plano.nome}.${a.ext}`;
      progresso({tipo: 'status', mensagem: `Renderizando ${a.quadros} quadros…`, arquivo: nome, indice: i + 1, total: planos.length});
      for (let p = 0; p <= 100; p += 4) {
        if (exportacaoCancelada) return {ok: false, cancelado: true, mensagem: 'Exportação cancelada', arquivos, pasta: pastaSaidas()};
        progresso({tipo: 'progresso', etapa: 'renderizando', progresso: p, arquivo: nome, indice: i + 1, total: planos.length});
        await esperar(50);
      }
      arquivos.push(`${pastaSaidas()}\\${nome}`);
    }
    return {ok: true, arquivo: arquivos[0], arquivos, pasta: pastaSaidas()};
  },
  exportarImagem: async (documento, _dados, opcoes) => ({ok: true, arquivo: `${pastaSaidas()}\\${opcoes?.nome || documento}${opcoes?.sufixo ?? ''}.${opcoes?.formato ?? 'png'}`, pasta: pastaSaidas()}),
  aoProgresso: (cb) => {
    ouvintesProgresso.add(cb);
    return () => {
      ouvintesProgresso.delete(cb);
    };
  },
  metricas: async () => ({memoria_mb: 312, processos: []}),
  audio: {
    gravarEnvelope: async (arquivo, envelope) => {
      envelopes[arquivo] = envelope;
      mudou(`${arquivo}.envelope.json`);
      return `${arquivo}.envelope.json`;
    },
    listarTrilhas: async () => ({pasta: prefs.pasta_trilhas, trilhas: TRILHAS}),
    importarTrilha: async (caminho) => wavSintetico('musica', `${TRILHAS.find((t) => t.caminho === caminho)?.nome ?? 'trilha'}.wav`),
    // frente Som (rodada 2): simulação no fim do arquivo
    limparVoz: (arquivo, intensidade) => limparNaPrevia(arquivo, intensidade),
    cancelarLimpeza: async () => cancelarLimpezaNaPrevia(),
    aoProgressoLimpeza: (cb) => {
      ouvintesLimpeza.add(cb);
      return () => {
        ouvintesLimpeza.delete(cb);
      };
    },
    medirLoudness: (documento) => medirNaPrevia(documento),
    // frente Som (rodada 3): a tomada gravada vira um blob que o clipe toca, como o arquivo em midia/ no app
    salvarTomada: async (wav) => {
      const url = URL.createObjectURL(new Blob([wav], {type: 'audio/wav'}));
      audios.set(url, {url, nome: 'narração gravada.wav'});
      return url;
    },
  },
  marcas: {
    listar: async () => structuredClone(marcas),
    gravar: async (m) => {
      const i = marcas.findIndex((k) => k.id === m.id);
      const salvo = {...comPasta(m), logo: m.logo};
      if (i >= 0) marcas[i] = salvo;
      else marcas.push(salvo);
      return structuredClone(salvo);
    },
    criar: async (nome) => {
      const base = idDeMarca(nome);
      let id = base;
      for (let n = 2; marcas.some((k) => k.id === id); n++) id = `${base}-${n}`;
      const novo = comPasta({...MARCA_NEUTRO, id, nome: nome.trim() || 'Nova marca', notas: undefined});
      marcas.push(novo);
      return structuredClone(novo);
    },
    duplicar: async (id, nome) => {
      const origem = marcas.find((k) => k.id === id);
      if (!origem) throw new Error(`kit não achado: ${id}`);
      return api.marcas.gravar({...structuredClone(origem), id: idDeMarca(nome), nome});
    },
    importarLogo: async () => {
      throw new Error('Na prévia web não há diálogo de arquivo.');
    },
    importarFonte: async () => {
      throw new Error('Na prévia web não há diálogo de arquivo.');
    },
    aplicar: async (id, documento) => {
      const r = aplicarMarca(aberto!, id, documento);
      mudou(aberto!.manifesto.documentos.find((d) => d.id === documento)!.caminho);
      return r;
    },
    fontesDoProjeto: async () => [],
  },
  exportarPaginas: async (o) => ({ok: false, mensagem: `exportar não funciona na prévia web (${o.paginas.length} página(s) desenhada(s)${o.pdf ? ' e o PDF' : ''})`}),
  cancelarExportacao: () => {
    exportacaoCancelada = true;
  },
  mostrarArquivo: nada,
  pesquisa: async () => structuredClone(pesquisaDeExemplo),
  textoFonte: async (fonteId, inicio, fim) => {
    const texto = textosFonte[fonteId];
    if (texto === undefined) throw new Error(`o texto da fonte ${fonteId} não está nesta pasta`);
    return inicio === undefined && fim === undefined ? texto : texto.slice(inicio ?? 0, fim ?? texto.length);
  },
  abrirFonte: async (url) => {
    if (!/^https?:\/\//i.test(url)) return false;
    window.open(url, '_blank', 'noopener');
    return true;
  },
  fala: falaSimulada(), // frente Fala: transcrição simulada (no fim do arquivo)
  // exportação (frente C): a marca d'água por destino fica em memória, por projeto, como o .estudio/exportacao.json
  prefsExportacao: async () => structuredClone(prefsExportacao.get(aberto?.raiz ?? '') ?? {}),
  gravarPrefsExportacao: async (p) => {
    const atual = prefsExportacao.get(aberto?.raiz ?? '') ?? {};
    const novo = normalizarPrefsExportacao({...atual, marca_dagua: {...atual.marca_dagua, ...normalizarPrefsExportacao(p).marca_dagua}});
    prefsExportacao.set(aberto?.raiz ?? '', novo);
    return structuredClone(novo);
  },
  // acabamento da imagem (rodada 2, B2): simulação no fim do arquivo
  removerFundo: {
    modelo: async () => fundoNaPrevia.estado(),
    baixar: () => fundoNaPrevia.baixar(),
    ler: async () => fundoNaPrevia.ler(),
    gravar: (src, png) => fundoNaPrevia.gravar(src, png),
    aoProgresso: (cb) => {
      fundoNaPrevia.ouvintes.add(cb);
      return () => fundoNaPrevia.ouvintes.delete(cb);
    },
    aoPedido: () => nada,
    responder: nada,
  },
};

(window as unknown as {estudio: ApiEstudio}).estudio = api;

// ---------- frente Fala: transcrição simulada (docs/legendas.md) ----------
// "Transcrever" anda de mentira (baixando, tirando o áudio, transcrevendo) e grava em memória palavras em pt-BR no ritmo
// da narração sintética (frases de 2,3 a 3,2 s com pausa de 1 s, as mesmas de audio-sintetico.ts), para a lista, a faixa
// e a composição terem o que mostrar. Exportar SRT/VTT baixa o arquivo pelo navegador; importar abre o seletor de arquivo.
const palavrasSimuladas = new Map<string, {w: string; s: number; e: number; p: number}[]>();
const FRASES_SIMULADAS = ['Recebeu proposta para mudar de cidade?', 'Antes de responder, entenda as regras.', 'A mudança depende da sua concordância.',
  'Mas existem exceções importantes.', 'O empregador paga transporte e frete.', 'Peça a proposta por escrito.'];
function falaSimulada(): ApiEstudio['fala'] {
  const ouvintes = new Set<(p: ProgressoTranscricao & {arquivo: string}) => void>();
  let cancelada = false;
  const avisar = (p: ProgressoTranscricao & {arquivo: string}) => ouvintes.forEach((f) => f(p));
  return {
    estado: async () => ({pasta: 'C:\\Users\\pessoa\\Estudio\\modelos\\whisper', modelo: 'small', pronto: false, ffmpeg: true, plataforma: true,
      falta: ['whisper.cpp v1.9.5 (b5454) (9 MB)', 'modelo ggml-small-q5_1.bin (190 MB)'],
      modelos: [{id: 'small', nome: 'Small', mb: 190, instalado: false}, {id: 'base', nome: 'Base', mb: 60, instalado: false}]}),
    transcrever: async ({arquivo}) => {
      cancelada = false;
      const etapas: [ProgressoTranscricao['etapa'], string, number][] = [['baixando', 'Baixando o modelo ggml-small-q5_1.bin (190 MB)', 12], ['audio', 'Tirando o áudio', 3],
        ['transcrevendo', 'Transcrevendo com o modelo ggml-small-q5_1.bin', 20]];
      for (const [etapa, mensagem, passos] of etapas) {
        for (let i = 0; i <= passos; i++) {
          if (cancelada) {
            avisar({etapa: 'cancelado', mensagem: 'Transcrição cancelada', arquivo});
            return {ok: false, arquivo, cancelado: true, mensagem: 'Transcrição cancelada'};
          }
          avisar({etapa, mensagem, progresso: (i / passos) * 100, arquivo});
          await esperar(60);
        }
      }
      const palavras: {w: string; s: number; e: number; p: number}[] = [];
      for (let t = 0.3, k = 0; t < 12 - 0.4 && k < FRASES_SIMULADAS.length; k++) {
        const fim = Math.min(12 - 0.2, t + 2.3 + (k % 3) * 0.45);
        const ws = FRASES_SIMULADAS[k].split(' ');
        const passo = (fim - t) / ws.length;
        ws.forEach((w, i) => palavras.push({w, s: Math.round((t + i * passo) * 1000), e: Math.round((t + (i + 0.85) * passo) * 1000), p: 0.97}));
        t = fim + 1 + (k % 2) * 0.2;
      }
      palavrasSimuladas.set(`${arquivo}.palavras.json`, palavras);
      mudou(`${arquivo}.palavras.json`);
      avisar({etapa: 'pronto', mensagem: `${palavras.length} palavras`, progresso: 100, arquivo});
      return {ok: true, arquivo, palavras: `${arquivo}.palavras.json`, n: palavras.length, modelo: 'small', duracao_s: 2.1, texto: palavras.map((p) => p.w).join(' ')};
    },
    cancelar: () => {
      cancelada = true;
    },
    aoProgresso: (cb) => {
      ouvintes.add(cb);
      return () => {
        ouvintes.delete(cb);
      };
    },
    gravarSaida: async (nome, texto) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([texto], {type: 'text/plain;charset=utf-8'}));
      a.download = nome;
      a.click();
      return `${pastaSaidas()}\\${nome}`;
    },
    escolherLegenda: () => new Promise((ok) => {
      const entrada = document.createElement('input');
      entrada.type = 'file';
      entrada.accept = '.srt,.vtt';
      entrada.onchange = () => {
        const f = entrada.files?.[0];
        if (!f) return ok(null);
        void f.text().then((texto) => ok({nome: f.name, texto}));
      };
      entrada.click();
    }),
    // a transcrição simulada é sempre do áudio como ele está
    conferir: async (arquivos) => Object.fromEntries(arquivos.map((a) => [a, palavrasSimuladas.has(`${a}.palavras.json`) ? 'em_dia' : 'falta'] as const)),
  };
}
const lerJsonSemFala = api.lerJson;
api.lerJson = (async (caminho: string) => (palavrasSimuladas.has(caminho) ? structuredClone(palavrasSimuladas.get(caminho)) : lerJsonSemFala(caminho))) as ApiEstudio['lerJson'];
// ---------- vídeo curto (frente C): fotos e logo de mentira ----------
// "Escolher imagem" devolve uma de três fotos sintéticas (SVG em data URL, com céu, sol, morros e uma grade fina para
// o Ken Burns ficar visível); o kit da Cliente aplicado ganha um logo de exemplo no tema, para a marca d'água ter o que pôr.
const svg = (s: string) => `data:image/svg+xml;utf8,${encodeURIComponent(s)}`;
const FOTOS = [['#3E6FA8', '#F2C46B', '#2E5E3A'], ['#7A4E8C', '#F28C6B', '#3D3A5E'], ['#1F7A8C', '#F5E6A8', '#5E4A2E']].map(([ceu, sol, morro], i) => svg(
  `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000" viewBox="0 0 1600 1000"><defs><linearGradient id="c" x1="0" y1="0" x2="0" y2="1">`
  + `<stop offset="0" stop-color="${ceu}"/><stop offset="1" stop-color="${sol}"/></linearGradient></defs><rect width="1600" height="1000" fill="url(#c)"/>`
  + `<circle cx="${400 + i * 400}" cy="380" r="120" fill="${sol}"/><path d="M0 720 Q400 520 800 700 T1600 640 V1000 H0Z" fill="${morro}"/>`
  + `<path d="M0 820 Q500 700 1000 840 T1600 800 V1000 H0Z" fill="#000" opacity="0.25"/>`
  + Array.from({length: 15}, (_, k) => `<path d="M${(k + 1) * 100} 0V1000" stroke="#fff" stroke-opacity="0.12"/>`).join('')
  + Array.from({length: 9}, (_, k) => `<path d="M0 ${(k + 1) * 100}H1600" stroke="#fff" stroke-opacity="0.12"/>`).join('')
  + `<text x="60" y="110" font-family="sans-serif" font-size="64" font-weight="700" fill="#fff">Foto ${i + 1}</text></svg>`));
const LOGO_EXEMPLO = svg('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="200" viewBox="0 0 600 200"><rect width="600" height="200" rx="24" fill="#C88155"/>'
  + '<text x="40" y="138" font-family="sans-serif" font-size="110" font-weight="800" fill="#F4F0EA">Cliente</text>'
  + '<text x="230" y="125" font-family="sans-serif" font-size="46" font-weight="600" fill="#F4F0EA">ADVOGADOS</text></svg>');
const prefsExportacao = new Map<string, PrefsExportacao>();
let vezFoto = 0;
const escolherMidiaOriginal = api.escolherMidia;
api.escolherMidia = async (tipo) => (tipo === 'imagem' ? FOTOS[vezFoto++ % FOTOS.length] : escolherMidiaOriginal(tipo));
const aplicarOriginal = api.marcas.aplicar;
api.marcas.aplicar = async (id, documento) => {
  const r = await aplicarOriginal(id, documento);
  const tema = (aberto!.docs[documento] as {tema?: Record<string, unknown>}).tema;
  if (id === 'cliente' && tema) tema.logo = LOGO_EXEMPLO;
  return r;
};
// ---------- frente Som (rodada 2): limpeza de voz e medidor de loudness, com o mesmo núcleo do app ----------
// A limpeza roda de verdade sobre o WAV sintético (a narração tem um pouco de "sala" nas pausas): o resultado vira outro
// blob, com o envelope já medido, como o processo principal grava midia/<arquivo>.limpo.wav. O medidor mixa os blobs à
// taxa deles (22,05 kHz) com o medirMistura do núcleo, como o loudness.ts faz com os arquivos decodificados a 48 kHz.
const ouvintesLimpeza = new Set<(p: {arquivo: string; progresso: number}) => void>();
let limpando: {parar: boolean} | null = null;
const amostrasDe = async (url: string) => decodificarWav(new Uint8Array(await (await fetch(url)).arrayBuffer()));
const vez0 = () => new Promise<void>((ok) => setTimeout(ok, 0));

async function limparNaPrevia(arquivo: string, intensidade: IntensidadeLimpeza): Promise<ResultadoLimpezaVoz> {
  if (limpando) throw new Error('já há uma limpeza de voz em andamento');
  if (!audios.has(arquivo)) throw new Error('na prévia web só limpa o áudio sintético desta sessão');
  const eu = (limpando = {parar: false});
  try {
    const {canais, taxa} = await amostrasDe(arquivo);
    const r = await limparVoz(canais, taxa, intensidade, {pausar: vez0, cancelado: () => eu.parar,
      aoProgresso: (f) => ouvintesLimpeza.forEach((cb) => cb({arquivo, progresso: Math.round(f * 100)}))});
    const url = URL.createObjectURL(new Blob([codificarWav(r.canais, taxa)], {type: 'audio/wav'}));
    audios.set(url, {url, nome: `${audios.get(arquivo)!.nome} (limpa)`});
    envelopes[url] = r.envelope;
    mudou(`${url}.envelope.json`);
    return {arquivo: url, medidas: r.medidas, duracao_ms: r.envelope.duracao_ms};
  } catch (e) {
    if (e instanceof LimpezaCancelada) return {cancelado: true};
    throw e;
  } finally {
    limpando = null;
  }
}

function cancelarLimpezaNaPrevia() {
  if (limpando) limpando.parar = true;
  return Boolean(limpando);
}

async function medirNaPrevia(documento: string): Promise<MedidasLoudness | {erro: string}> {
  const {props} = resolverCenas(aberto!.docs[documento] as DocCenas, {envelopes});
  if (!props.audio?.faixas.length) return {erro: 'este vídeo não tem som'};
  const fontes: Record<string, FonteAudio | undefined> = {};
  // o WAV de 16 bits chega ao ffmpeg do render em pacotes de 4096 bytes: o volume muda a cada um (FonteAudio.pacote)
  for (const f of props.audio.faixas) {
    for (const c of f.clipes) {
      if (c.arquivo in fontes || !audios.has(c.arquivo)) continue;
      const a = await amostrasDe(c.arquivo);
      fontes[c.arquivo] = {...a, pacote: 4096 / (2 * a.canais.length)};
    }
  }
  return medirMistura(props.audio, fontes, {duracao_ms: props.duracao_ms, fps: props.fps, taxa: TAXA, pausar: vez0});
}

// ---------- remover fundo (acabamento da imagem, rodada 2, B2) ----------
// O modelo vem de testes/saida/modelos/modnet/model.onnx quando está ali (o Vite serve a pasta) ou do mesmo endereço do
// app, em memória, com o mesmo SHA-256 conferido. O PNG sem fundo fica num blob em memória: o fetch da página é
// embrulhado para devolver o blob a quem busca o caminho dele (a prévia e a exportação buscam a mídia por fetch).
const fundoNaPrevia = (() => {
  const semFundo = new Map<string, Blob>();
  const ouvintes = new Set<(p: {recebidos: number; total: number}) => void>();
  let bytes: Uint8Array | null = null;
  const buscar = window.fetch.bind(window);
  window.fetch = (entrada, init) => {
    const url = typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
    const caminho = decodeURIComponent(new URL(url, location.href).pathname).replace(/^\/+/, '');
    const b = semFundo.get(caminho);
    return b ? Promise.resolve(new Response(b, {headers: {'Content-Type': 'image/png'}})) : buscar(entrada, init);
  };
  const LOCAL = `/testes/saida/modelos/${MODELO_FUNDO.id}/${MODELO_FUNDO.arquivo}`;
  const estado = () => ({pronto: Boolean(bytes), id: MODELO_FUNDO.id, nome: MODELO_FUNDO.nome, licenca: MODELO_FUNDO.licenca, bytes: MODELO_FUNDO.bytes,
    pasta: `C:\\Users\\pessoa\\Estudio\\modelos\\${MODELO_FUNDO.id}`});
  const baixar = async () => {
    if (bytes) return estado();
    let r = await buscar(LOCAL).catch(() => null);
    if (!r?.ok || Number(r.headers.get('content-length')) !== MODELO_FUNDO.bytes) r = await buscar(MODELO_FUNDO.url);
    if (!r.ok || !r.body) throw new Error(`o download do modelo respondeu ${r.status}`);
    const partes: Uint8Array[] = [];
    let recebidos = 0;
    const leitor = r.body.getReader();
    for (;;) {
      const {done, value} = await leitor.read();
      if (done) break;
      partes.push(value);
      recebidos += value.byteLength;
      ouvintes.forEach((f) => f({recebidos, total: MODELO_FUNDO.bytes}));
    }
    const tudo = new Uint8Array(recebidos);
    let k = 0;
    for (const p of partes) {
      tudo.set(p, k);
      k += p.byteLength;
    }
    const sha = [...new Uint8Array(await crypto.subtle.digest('SHA-256', tudo))].map((x) => x.toString(16).padStart(2, '0')).join('');
    if (sha !== MODELO_FUNDO.sha256) throw new Error(`o modelo baixado não confere (SHA-256 ${sha.slice(0, 12)}…)`);
    bytes = tudo;
    return estado();
  };
  const ler = () => {
    if (!bytes) throw new Error('o modelo de remover fundo ainda não foi baixado');
    return bytes.slice();
  };
  const gravar = async (src: string, png: string) => {
    const caminho = caminhoSemFundo(src);
    semFundo.set(caminho, await (await buscar(png)).blob());
    return caminho;
  };
  return {estado, baixar, ler, gravar, ouvintes};
})();
