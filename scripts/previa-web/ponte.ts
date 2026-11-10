// Prévia da interface no navegador, sem Electron: uma ponte `window.estudio` em memória, com projetos de mentira, para
// olhar e fotografar a tela inicial e o editor quando o Electron não pode rodar (o antivírus bloqueia o de
// desenvolvimento neste PC). Não grava nada em disco; a exportação é de mentira (andamento simulado), só para o diálogo.
// Uso: npx vite --config vite.renderer.config.ts --port 5199 e abrir
// http://localhost:5199/scripts/previa-web/index.html
// Som: "escolher arquivo de áudio" devolve um WAV sintético (uma narração, depois uma música, alternando), como URL de
// blob que o <audio> e o Web Audio tocam de verdade; o envelope medido fica em memória e entra nas props como no app.
import jsonpatch, {type Operation} from 'fast-json-patch';
import type {ApiEstudio, EstadoProvedor, InfoProjeto, PedidoPortaoTela, MarcaInfo, Mudanca, NovoProjeto, Preferencias, Progresso, ProgressoTranscricao, Recente, ResultadoLimpezaVoz, Trilha, RespostaJanela} from '../../src/compartilhado/api';
import type {EntradaDocumento, Manifesto, Modulo} from '../../src/nucleo/documentos';
import type {Envelope, IntensidadeLimpeza} from '../../src/nucleo/audio';
import {LimpezaCancelada, limparVoz} from '../../src/nucleo/limpeza-voz';
import {medirMistura, type FonteAudio, type MedidasLoudness} from '../../src/nucleo/loudness';
import type {Fato, Fonte, Pesquisa} from '../../src/nucleo/pesquisa';
import {novoDocCenas, resolverCenas, type DocCenas} from '../../src/nucleo/cenas';
import {novoDoc3d} from '../../src/nucleo/cena3d';
import {idDeMarca, MARCA_NEUTRO, MARCAS_INICIAIS, patchDaMarca, temaDaMarca, type Marca} from '../../src/nucleo/marca';
import {MODELOS} from '../../src/nucleo/modelos';
import {codificarWav, decodificarWav, musicaSintetica, narracaoSintetica, TAXA} from '../audio-sintetico';
import {argumentosDoRender, destinoDoFormato, nomesDosArquivos, normalizarPrefsExportacao, type OpcoesExportarVideo, type PrefsExportacao} from '../../src/nucleo/exportacao';
import {caminhoSemFundo, MODELO_FUNDO} from '../../src/nucleo/remover-fundo';
import {comMarca, marcasVazias, montarIndice, pastasDaMidia, type ArquivoBruto, type MarcasDeMidia} from '../../src/nucleo/midia'; // frente Casca
import {textoDeLegenda} from '../../src/nucleo/legendas'; // frente Fala: legenda em ANSI
import {arquivoCortado, palavrasDepoisDosCortes} from '../../src/nucleo/cortes-fala'; // frente Fala: cortes pela fala
import {ehDocMusica, novaMusica, type DocMusica} from '../../src/nucleo/musica'; // frente Música
import {renderizarMusica, TAXA_MUSICA} from '../../src/nucleo/musica-som';
import {patchAtualizarLigados, patchClipeNovo, renderDaMusica} from '../../src/nucleo/musica-video';
import {musicaParaMidi} from '../../src/nucleo/musica-midi'; // frente Música, marco 4
import {licencasDaMusica, textoDosCreditos} from '../../src/nucleo/musica-licencas'; // frente Música, marco 5
import type {EntregaEmBytes} from '../../src/nucleo/musica-entrega';
import type {PedidoExportarMusica, ResultadoExportarMusica} from '../../src/nucleo/musica-projeto';
import {cancelarTransicao, concluirTransicao, levarPara, registroVazio, type BaseProjeto, type RegistroTransicoes} from '../../src/nucleo/transicoes';
import {envelopeDeAmostras, type Envelope as EnvelopeMusica} from '../../src/nucleo/audio';
import type {EntradaDiario, OperacaoPatch} from '../../src/nucleo/documentos';
import {configDaNarracao, NOMES_PROVEDOR, VOZES_CHIRP, VOZES_GEMINI, type ProvedorNarracao} from '../../src/nucleo/narracao'; // narração por IA
import {escolherCenas, itensDaNarracao, patchDasFalas} from '../../src/nucleo/narracao-cenas';
import type {AndamentoNarracao, Previa, ResultadoNarracao} from '../../src/nucleo/narracao-servico';
import {custoNarracao} from '../../src/main/ia/precos';

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
  return {versao: String(p.versao), marca: m.id, nome: m.nome, copiados: [], atualizados: []};
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

const info = (): InfoProjeto | null => aberto && {raiz: aberto.raiz, manifesto: structuredClone(aberto.manifesto), base_midia: `${location.origin}/exemplos/exemplo`, claude: true, git: true,
  perfil: {nome: 'padrao', sessoes_claude: 4, escala_previa: 0.75, pixel_ratio: 1.5}, estado: null};

const docImagem = (l: number, a: number) => ({formato: 1, largura: l, altura: a, fundo: '#111418', camadas: [{id: 'titulo', nome: 'Título', tipo: 'texto',
  x: Math.round(l * 0.08), y: Math.round(a * 0.4), largura: Math.round(l * 0.84), altura: 200, texto: 'Seu título', fonte: 'Inter', tamanho: 90, peso: 700, cor: '#F2F2F2', alinhar: 'centro'}]});
// a mesma cena que o app cria (criar-projeto.ts: câmera, ambiente e sol, chão e caixa que gira), para a foto e o inspetor da prévia
// serem os de verdade (tres-efeitos-N3)
const doc3d = () => novoDoc3d();
const docVideo = (f?: {largura: number; altura: number; fps?: number}) => {
  const d = novoDocCenas({largura: f?.largura ?? 1080, altura: f?.altura ?? 1920, fps: f?.fps ?? 30});
  // o primeiro bloco já cita um fato da pesquisa de exemplo, para ver as etiquetas no inspetor
  const bloco = d.cenas[0]?.blocos[0];
  if (bloco) bloco.refs = ['F1'];
  return d;
};
const conteudo = (m: Modulo, f?: {largura: number; altura: number; fps?: number}) =>
  m === 'video' ? docVideo(f) : m === 'imagem' ? docImagem(f?.largura ?? 1080, f?.altura ?? 1350) : m === 'musica' ? novaMusica() : doc3d();

const novoDocumento = (p: Proj, modulo: Modulo, f?: {largura: number; altura: number; fps?: number}, titulo?: string): EntradaDocumento => {
  const base = modulo === '3d' ? 'cena3d' : modulo;
  let n = 1;
  while (p.manifesto.documentos.some((d) => d.id === (n === 1 ? base : `${base}-${n}`))) n++;
  const id = n === 1 ? base : `${base}-${n}`;
  const e: EntradaDocumento = {id, modulo, caminho: `${modulo}/${id}.json`, titulo: titulo || (({video: 'Vídeo', imagem: 'Imagem', '3d': 'Cena 3D', musica: 'Música', animacao: 'Animação'} as Record<Modulo, string>)[modulo] + (n > 1 ? ` ${n}` : ''))};
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
  // frente Música: o render da música fica num blob; a tela vê a URL dele, o documento guarda o caminho (paraTela/doDisco)
  lerDocumento: async <T,>(id: string) => ({doc: musicaPrevia.paraTela(structuredClone(aberto!.docs[id])) as T, versao: String(aberto!.versao)}),
  lerJson: async <T,>(caminho: string) => (caminho === '.estudio/transicoes.json' ? structuredClone(musicaPrevia.registro()) : []) as T,
  aplicarPatch: async ({documento, patch: patchDaTela, rotulo}) => {
    const patch = musicaPrevia.doDisco(patchDaTela);
    const antesDaTela = aberto!.docs[documento];
    const r = jsonpatch.applyPatch(structuredClone(aberto!.docs[documento]), patch as Operation[], true, false);
    musicaPrevia.anotar(documento, antesDaTela, r.newDocument, rotulo);
    nomearClipes(r.newDocument);
    aberto!.docs[documento] = r.newDocument;
    aberto!.versao++;
    return {versao: String(aberto!.versao), seq: aberto!.versao};
  },
  desfazer: async () => ({ok: false, mensagem: 'desfazer não funciona na prévia web'}),
  propsVideo: async (id) => {
    const d = aberto!.docs[id] as DocCenas;
    const {props, avisos} = resolverCenas(d, {envelopes});
    return {props: musicaPrevia.paraTela(props) as never, avisos};
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
    abrir: async (o) => ({id: Math.floor(Math.random() * 1000), sessao: 'previa', provedor: o?.provedor ?? 'claude', rotulo: o?.provedor === 'deepseek' ? 'DeepSeek 1' : 'Claude 1'}),
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
    // frente Som (rodada 3): na prévia web não há arquivo grande de verdade; o envelope do blob já está medido
    medirEnvelope: async (arquivo) => {
      const e = envelopes[arquivo];
      if (!e) throw new Error('a prévia web mede pela própria janela');
      return e;
    },
    // a tomada gravada vira um blob que o clipe toca, como o arquivo em midia/ no app
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
  narracao: narracaoSimulada(), // narração por IA: vozes do catálogo e falas sintéticas (no fim do arquivo)
  // exportação (frente C): a marca d'água por destino fica em memória, por projeto, como o .estudio/exportacao.json
  prefsExportacao: async () => structuredClone(prefsExportacao.get(aberto?.raiz ?? '') ?? {}),
  gravarPrefsExportacao: async (p) => {
    const atual = prefsExportacao.get(aberto?.raiz ?? '') ?? {};
    const novo = normalizarPrefsExportacao({...atual, marca_dagua: {...atual.marca_dagua, ...normalizarPrefsExportacao(p).marca_dagua}});
    prefsExportacao.set(aberto?.raiz ?? '', novo);
    return structuredClone(novo);
  },
  // contraste da marca d'água (frente C): na prévia web não há render; devolve uma medida de exemplo, 2,1:1 sem placa e 9:1 com ela
  medirContrasteMarca: async (_documento, pedido) => {
    await new Promise((r) => setTimeout(r, 600));
    const placa = Boolean(pedido.config.placa);
    const fundo: [number, number, number] = placa ? [23, 26, 25] : [200, 190, 180];
    const marca: [number, number, number] = [244, 240, 234];
    const contraste = placa ? 15 : 1.4;
    return {ok: true, avaliacao: {contraste, ok: contraste >= 3, quadro_ms: 2000, fundo, marca, medidas: [{quadro_ms: 2000, fundo, marca, contraste}]}};
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
  // frente Casca (rodada 3): painel de mídia, simulação no fim do arquivo
  midia: {
    indice: async () => midiaNaPrevia.indice(),
    marcar: async (caminho, mudanca) => midiaNaPrevia.marcar(caminho, mudanca),
  },
  // frente IA: catálogo simulado com estado (chave do DeepSeek no cofre, Gemini sem chave, Ollama sem modelo). Chave
  // que começa com "sk-" é aceita; outra é recusada como o provedor faria. Nada sai do navegador.
  ia: {
    provedores: async () => iaNaPrevia.lista(),
    gravarChave: async (id, chave) => {
      if (!/^sk-/.test(chave)) return {ok: false, mensagem: 'a chave foi recusada pelo provedor (401): Invalid API key'};
      iaNaPrevia.chaves.set(id, chave);
      return {ok: true, persistente: true, mensagem: 'chave aceita e guardada cifrada neste PC', modelos: iaNaPrevia.modelos[id] ?? []};
    },
    apagarChave: async (id) => void iaNaPrevia.chaves.delete(id),
    modelos: async (id) => ({ok: true as const, modelos: iaNaPrevia.modelos[id] ?? []}),
    configurar: async (id, c) => {
      const atual = {...iaNaPrevia.config[id], ...c};
      iaNaPrevia.config[id] = atual;
      return atual;
    },
    padrao: async (id) => void (iaNaPrevia.padrao = id),
    usoDoMes: async () => ({deepseek: {entrada: 182000, cache: 120000, saida: 9100, custo_usd: 0.0198, turnos: 14}}),
    modeloDaConversa: async () => undefined,
    aoPedidoPortao: (cb) => {
      iaNaPrevia.portao.add(cb);
      return () => iaNaPrevia.portao.delete(cb);
    },
    aoPortaoCancelado: () => nada,
    responderPortao: (id, permitir) => console.log(`[prévia] portão ${id}: ${permitir ? 'permitido' : 'negado'}`),
    reverter: async (seq) => ({ok: true as const, seq: seq + 1000, rotulo: `reverter: #${seq}`}),
    apps: async () => iaNaPrevia.estadoApps(),
    appsLigar: async (ligado, porta) => ((iaNaPrevia.appsLigado = ligado), porta && (iaNaPrevia.porta = porta), iaNaPrevia.estadoApps()),
    appsNovo: async (nome) => {
      const id = `app${iaNaPrevia.apps.length + 1}`;
      iaNaPrevia.apps.push({id, nome, criado_em: new Date().toISOString()});
      return {id, configs: iaNaPrevia.configs(id)};
    },
    appsConfigs: async (id) => iaNaPrevia.configs(id),
    appsRevogar: async (id) => ((iaNaPrevia.apps = iaNaPrevia.apps.filter((x) => x.id !== id)), iaNaPrevia.estadoApps()),
    guardar: async () => null,
    guardadas: async () => [],
    apagarGuardada: async () => undefined,
  },
  // carrossel em partes (rodada 3, B2): conta as páginas desenhadas, uma por vez; gravar não funciona aqui
  exportarPaginasEmPartes: (() => {
    const partes = new Map<string, {pdf: boolean; n: number}>();
    return {
      abrir: async (o: {documento: string; pdf: boolean}) => {
        const sessao = `previa-${partes.size + 1}`;
        partes.set(sessao, {pdf: o.pdf, n: 0});
        return {sessao};
      },
      parte: async (sessao: string) => {
        const s = partes.get(sessao);
        if (s) s.n++;
        return Boolean(s);
      },
      fechar: async (sessao: string) => {
        const s = partes.get(sessao);
        partes.delete(sessao);
        return {ok: false, mensagem: `exportar não funciona na prévia web (${s?.n ?? 0} página(s) desenhada(s), uma por vez${s?.pdf ? ', e o PDF' : ''})`};
      },
    };
  })(),
  // ponte com a janela (05 §0.1): o "processo principal" da prévia pede à janela pelo mesmo caminho do app
  janela: {
    aoPedido: (cb) => {
      ponteDaJanela.ouvintes.add(cb);
      return () => ponteDaJanela.ouvintes.delete(cb);
    },
    responder: (id, r) => ponteDaJanela.responder(id, r),
  },
  // frente Música: as mesmas funções do núcleo, sobre o projeto em memória (simulação no fim do arquivo)
  musica: {
    levar: async (p) => musicaPrevia.levar(p),
    concluir: async (t) => musicaPrevia.concluir(t),
    cancelar: async (t, descartar) => musicaPrevia.cancelar(t, descartar),
    depoisDeMudar: (documento) => musicaPrevia.depoisDeMudar(documento),
    porNoVideo: (o) => musicaPrevia.porNoVideo(o),
    exportar: (documento, pedido) => musicaPrevia.exportar(documento, pedido),
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
        void f.arrayBuffer().then((b) => ok({nome: f.name, ...textoDeLegenda(new Uint8Array(b))}));
      };
      entrada.click();
    }),
    // cortes pela fala: a prévia não grava áudio; devolve o nome e as palavras do arquivo emendado, para a tela seguir
    emendar: async ({fonte, cortes, palavras}) => {
      const arquivo = arquivoCortado(fonte, cortes);
      const ficam = palavrasDepoisDosCortes(palavras, cortes);
      palavrasSimuladas.set(`${arquivo}.palavras.json`, ficam.map((p) => ({...p, p: 1})));
      const tirado = cortes.reduce((s, c) => s + c.ate_ms - c.de_ms, 0);
      return {arquivo, palavras: `${arquivo}.palavras.json`, duracao_ms: 12_000 - tirado, antes_ms: 12_000,
        removidas: palavras.filter((p) => cortes.some((c) => p.s >= c.de_ms && p.e <= c.ate_ms)).map((p) => p.w)};
    },
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

// ---------- frente Casca: painel de mídia (docs/casca.md) ----------
// Os seis arquivos reais do exemplo da Cliente (o Vite os serve em /exemplos/exemplo/midia, e a base de mídia da prévia aponta para lá,
// então as miniaturas e a prévia tocam de verdade) e alguns de mentira com derivados e subpasta, para ver o agrupamento, as
// pastas, a busca e a marcação das tomadas. As marcas ficam em memória, como no resto da ponte.
const MB = 1024 * 1024;
const midiaNaPrevia = (() => {
  const hoje = Date.now();
  const arquivos: ArquivoBruto[] = [
    {rel: 'midia/video-exemplo.mp4', tamanho: 9_316_651, modificado_ms: hoje - 3 * 3600e3, duracao_ms: 38_000},
    {rel: 'midia/Cidade Exemplo.jpg', tamanho: 709_144, modificado_ms: hoje - 26 * 3600e3},
    {rel: 'midia/logo-exemplo.png', tamanho: 49_252, modificado_ms: hoje - 48 * 3600e3, largura: 512, altura: 512},
    {rel: 'midia/sfx/carimbo_0.wav', tamanho: 42_284, modificado_ms: hoje - 72 * 3600e3, duracao_ms: 960},
    {rel: 'midia/sfx/impacto_grave.wav', tamanho: 211_244, modificado_ms: hoje - 72 * 3600e3, duracao_ms: 2400},
    {rel: 'midia/sfx/papel_desliza_0.wav', tamanho: 53_804, modificado_ms: hoje - 72 * 3600e3, duracao_ms: 1220},
    {rel: 'midia/sfx/pop.wav', tamanho: 34_604, modificado_ms: hoje - 72 * 3600e3, duracao_ms: 780},
    {rel: 'midia/sfx/swell.wav', tamanho: 163_244, modificado_ms: hoje - 72 * 3600e3, duracao_ms: 3700},
    {rel: 'midia/sfx/whoosh.wav', tamanho: 105_644, modificado_ms: hoje - 72 * 3600e3, duracao_ms: 2400},
    // de mentira: sem o arquivo por trás, só para o agrupamento
    {rel: 'midia/narracao.wav', tamanho: 5 * MB, modificado_ms: hoje - 600e3, duracao_ms: 61_000},
    {rel: 'midia/narracao.wav.palavras.json', tamanho: 18_000, modificado_ms: hoje - 590e3},
    {rel: 'midia/narracao.wav.envelope.json', tamanho: 9_000, modificado_ms: hoje - 590e3},
    {rel: 'midia/narracao.wav.limpo.wav', tamanho: 5 * MB, modificado_ms: hoje - 300e3},
    {rel: 'midia/narracao.wav.limpo.wav.envelope.json', tamanho: 9_000, modificado_ms: hoje - 300e3},
    {rel: 'midia/tomadas/gancho-1.mp4', tamanho: 120 * MB, modificado_ms: hoje - 5 * 3600e3, duracao_ms: 42_000},
    {rel: 'midia/tomadas/gancho-2.mp4', tamanho: 118 * MB, modificado_ms: hoje - 5 * 3600e3, duracao_ms: 39_500},
    {rel: 'midia/tomadas/gancho-2.mp4.palavras.json', tamanho: 14_000, modificado_ms: hoje - 4 * 3600e3},
    {rel: 'midia/foto-ana.jpg', tamanho: 2 * MB, modificado_ms: hoje - 9 * 3600e3, largura: 3000, altura: 2000},
    {rel: caminhoSemFundo('midia/foto-ana.jpg'), tamanho: 1 * MB, modificado_ms: hoje - 8 * 3600e3, largura: 3000, altura: 2000},
  ];
  let marcas: MarcasDeMidia = comMarca(comMarca(marcasVazias(), 'midia/tomadas/gancho-2.mp4', {estado: 'boa', nota: 'Tomada com o gancho firme'}), 'midia/tomadas/gancho-1.mp4', {estado: 'descartada'});
  let seq = 100;
  const indice = () => {
    const entradas = montarIndice(arquivos, marcas);
    return {entradas, pastas: pastasDaMidia(entradas), total: entradas.length, tamanho_total: arquivos.reduce((s, a) => s + a.tamanho, 0)};
  };
  const marcar = (caminho: string, mudanca: {estado?: 'boa' | 'descartada' | null; nota?: string}) => {
    if (!indice().entradas.some((e) => e.caminho === caminho)) throw new Error(`arquivo não achado em midia/: ${caminho}`);
    marcas = comMarca(marcas, caminho, mudanca);
    return {seq: ++seq, documento: 'midia/marcas.json', caminho, marca: marcas.marcas[caminho] ?? null};
  };
  return {indice, marcar};
})();
// ---------- frente IA: estado da simulação de Configurações › IA ----------
const iaNaPrevia = {
  padrao: 'claude',
  portao: new Set<(p: PedidoPortaoTela) => void>(),
  appsLigado: false,
  porta: 47815,
  apps: [] as {id: string; nome: string; criado_em: string}[],
  estadoApps() {
    return {ligado: this.appsLigado, porta: this.porta, ouvindo: this.appsLigado, apps: this.apps.slice()};
  },
  configs(id: string) {
    const url = `http://127.0.0.1:${this.porta}/mcp`;
    const token = `token-da-previa-${id}`;
    return {http: JSON.stringify({mcpServers: {estudio: {type: 'http', url, headers: {Authorization: `Bearer ${token}`}}}}, null, 2),
      stdio: JSON.stringify({mcpServers: {estudio: {command: String.raw`C:\Users\pessoa\AppData\Local\Programs\Estudio\Estudio.exe`,
        args: [String.raw`C:\Users\pessoa\AppData\Local\Programs\Estudio\resources\dist-mcp\ponte.cjs`],
        env: {ELECTRON_RUN_AS_NODE: '1', ESTUDIO_MCP_URL: url, ESTUDIO_MCP_TOKEN: token}}}}, null, 2)};
  },
  chaves: new Map<string, string>([['deepseek', 'sk-previa-a1f9']]),
  config: {} as Record<string, {modelo?: string; base?: string}>,
  modelos: {deepseek: ['deepseek-flash', 'deepseek-v4-pro'], gemini: ['gemini-3.5-flash-lite', 'gemini-3.6-flash', 'gemini-3.8-flash'],
    ollama: ['llama3.2', 'qwen2.5:7b']} as Record<string, string[]>,
  lista(): EstadoProvedor[] {
    const base: EstadoProvedor[] = [
      {id: 'claude', nome: 'Claude (sua conta)', via: 'claude-cli', servidor: 'EUA (Anthropic)', chave: 'nenhuma', pronto: true},
      {id: 'deepseek', nome: 'DeepSeek', via: 'openai', servidor: 'China', chave: 'exigida', modelo: 'deepseek-flash', base: 'https://api.deepseek.com', pronto: true,
        paginaChave: 'https://platform.deepseek.com/api_keys'},
      {id: 'gemini', nome: 'Gemini (chave)', via: 'openai', servidor: 'EUA (Google)', chave: 'exigida', modelo: 'gemini-3.6-flash', pronto: false,
        base: 'https://generativelanguage.googleapis.com/v1beta/openai', paginaChave: 'https://aistudio.google.com/apikey'},
      {id: 'ollama', nome: 'Ollama (neste PC)', via: 'openai', servidor: 'neste PC', chave: 'nenhuma', base: 'http://127.0.0.1:11434/v1', pronto: false, local: true},
      {id: 'compativel', nome: 'Outro endereço compatível com OpenAI', via: 'openai', servidor: 'o do endereço', chave: 'opcional', pronto: false},
    ];
    return base.map((p) => {
      const c = this.config[p.id] ?? {};
      const k = this.chaves.get(p.id);
      const modelo = c.modelo ?? p.modelo;
      const end = c.base ?? p.base;
      const falta = p.via !== 'openai' ? undefined : !end ? 'endereço' : p.chave === 'exigida' && !k ? 'chave' : !modelo ? 'modelo' : undefined;
      return {...p, modelo, base: end, pronto: !falta, falta, padrao: this.padrao === p.id, cofre_persistente: true,
        ...(p.via === 'openai' ? {chave_origem: k ? 'cofre' as const : 'nenhuma' as const, chave_final: k?.slice(-4)} : {})};
    });
  },
};
// na prévia, um pedido do portão sai pelo console: window.__portaoNaPrevia({origem: 'DeepSeek 1', ferramenta: 'ler_fonte', …})
(window as unknown as {__portaoNaPrevia: (p: Partial<PedidoPortaoTela>) => void}).__portaoNaPrevia = (p) =>
  iaNaPrevia.portao.forEach((f) => f({id: `previa-${Date.now()}`, origem: 'Claude 1', ferramenta: 'ler_fonte', motivo: 'abrir uma página da internet',
    entrada: {url: 'https://www.planalto.gov.br/ccivil_03/decreto-lei/del5452.htm'}, ...p}));
// ---------- frente Música: ida e volta e render ligado, em memória (docs/musica.md) ----------
// levar_para, concluir_transicao e cancelar_transicao são as do núcleo, sobre uma BaseProjeto em memória com um diário
// (seq, inverso, transição), então o "Cancelar e desfazer" desfaz como no app. O render é o mesmo renderizarMusica do
// app; o WAV vai para um blob, e a tela recebe a URL dele no lugar do caminho midia/musica/... (paraTela), que volta a
// ser caminho quando a tela manda um patch (doDisco).
const ponteDaJanela = (() => {
  const ouvintes = new Set<(id: string, acao: string, dados: unknown) => void>();
  const esperando = new Map<string, (r: RespostaJanela) => void>();
  let n = 0;
  return {
    ouvintes,
    responder: (id: string, r: RespostaJanela) => {
      esperando.get(id)?.(r);
      esperando.delete(id);
    },
    pedir: (acao: string, dados: unknown) => new Promise<RespostaJanela>((ok) => {
      if (!ouvintes.size) return ok({ok: false, mensagem: 'sem janela'});
      const id = `p${++n}`;
      esperando.set(id, ok);
      ouvintes.forEach((f) => f(id, acao, dados));
    }),
  };
})();
let renderFeitoPor = '';
/** Para conferir na prévia: quem fez o último render para o vídeo ("janela" = o Web Worker). */
(window as unknown as {renderDaMusicaFeitoPor: () => string}).renderDaMusicaFeitoPor = () => renderFeitoPor;

const exportadas = new Map<string, {bytes: number; lufs?: number | null; pico_dbtp?: number | null}>();
(window as unknown as {exportacoesDaMusica: () => unknown}).exportacoesDaMusica = () => Object.fromEntries(exportadas);

const musicaPrevia = (() => {
  let registro: RegistroTransicoes = registroVazio();
  const diario: EntradaDiario[] = [];
  const blobDe = new Map<string, string>(); // caminho do render → URL do blob
  const caminhoDe = new Map<string, string>(); // URL do blob → caminho
  const trocar = <T,>(x: T, mapa: Map<string, string>): T => {
    if (!mapa.size) return x;
    const andar = (v: unknown): unknown => {
      if (typeof v === 'string') return mapa.get(v) ?? v;
      if (Array.isArray(v)) return v.map(andar);
      if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, w]) => [k, andar(w)]));
      return v;
    };
    return andar(x) as T;
  };
  // a janela decodifica pelo endereço que a tela usa (a URL do blob), não pelo caminho do disco
  const paraTelaDoc = (d: DocMusica) => trocar(d, blobDe);
  const entrada = (documento: string) => {
    const e = aberto!.manifesto.documentos.find((d) => d.id === documento || d.caminho === documento);
    if (!e) throw new Error(`documento não achado: ${documento}`);
    return e;
  };
  const anotar = (caminho: string, antes: unknown, depois: unknown, quem: {autor: string; origem: string; rotulo: string; transicao?: string; patch?: OperacaoPatch[]}) => {
    const aberta = registro.transicoes.filter((t) => t.estado === 'aberta' && t.destino.arquivo === caminho).pop()?.id;
    const seq = (diario[diario.length - 1]?.seq ?? 0) + 1;
    const transicao = quem.transicao ?? aberta;
    diario.push({seq, em: new Date().toISOString(), documento: caminho, autor: quem.autor, origem: quem.origem, rotulo: quem.rotulo, versao_antes: '', versao_depois: '',
      patch: quem.patch ?? (jsonpatch.compare(antes as object, depois as object) as OperacaoPatch[]), inverso: jsonpatch.compare(depois as object, antes as object) as OperacaoPatch[],
      ...(transicao ? {transicao} : {})});
    return seq;
  };
  const base = (autor: string): BaseProjeto => ({
    autor,
    manifesto: () => aberto!.manifesto,
    ler: <T,>(documento: string) => {
      const e = entrada(documento);
      return {doc: structuredClone(aberto!.docs[e.id]) as T, versao: String(aberto!.versao), arquivo: e.caminho};
    },
    aplicar: (x) => {
      const e = entrada(x.documento);
      const antes = aberto!.docs[e.id];
      const depois = jsonpatch.applyPatch(structuredClone(antes), x.patch as Operation[], true, false).newDocument;
      aberto!.docs[e.id] = depois;
      aberto!.versao++;
      const seq = anotar(e.caminho, antes, depois, {autor: x.autor ?? autor, origem: 'previa', rotulo: x.rotulo, transicao: x.transicao, patch: x.patch.filter((o) => o.op !== 'test')});
      mudou(e.caminho);
      return {versao: String(aberto!.versao), seq};
    },
    adicionarDocumento: (e, c) => {
      aberto!.manifesto.documentos.push(e);
      aberto!.docs[e.id] = c;
      mudou('estudio.json');
    },
    registro: () => structuredClone(registro),
    gravarRegistro: (r) => {
      registro = structuredClone(r);
      mudou('.estudio/transicoes.json');
    },
    estado: () => null,
    diario: () => diario,
  });
  const renderizar = async (id: string) => {
    const doc = aberto!.docs[id] as DocMusica;
    const r = renderDaMusica(id, doc);
    if (blobDe.has(r.arquivo)) return r;
    const fontes: Record<string, {canais: Float32Array[]; taxa: number} | undefined> = {};
    for (const c of doc.arranjo.clipes) {
      if (!c.audio || c.audio in fontes) continue;
      try {
        fontes[c.audio] = await amostrasDe(blobDe.get(c.audio) ?? c.audio);
      } catch {
        fontes[c.audio] = undefined;
      }
    }
    // como no app: a janela faz no Web Worker dela; sem quem atenda, a conta é feita aqui
    const daJanela = await ponteDaJanela.pedir('musica:render', {doc: paraTelaDoc(doc)});
    const feito = daJanela.ok ? (daJanela.dados as {wav?: Uint8Array<ArrayBuffer>; envelope?: EnvelopeMusica}) : null;
    let wav: Uint8Array<ArrayBuffer>;
    if (feito?.wav && feito.envelope) {
      wav = feito.wav;
      envelopes[r.arquivo] = feito.envelope;
    } else {
      const som = renderizarMusica(doc, fontes, {taxa: TAXA_MUSICA});
      wav = codificarWav(som.canais, TAXA_MUSICA);
      envelopes[r.arquivo] = envelopeDeAmostras(som.canais, TAXA_MUSICA);
    }
    const url = URL.createObjectURL(new Blob([wav], {type: 'audio/wav'}));
    blobDe.set(r.arquivo, url);
    caminhoDe.set(url, r.arquivo);
    audios.set(url, {url, nome: `${id}.wav`});
    renderFeitoPor = feito ? 'janela' : 'ponte';
    return r;
  };
  const depoisDeMudar = async (id: string) => {
    if (!aberto || !ehDocMusica(aberto.docs[id])) return {trocados: [], renderizado: false};
    const r = await renderizar(id);
    const trocados: {video: string; clipe: string}[] = [];
    for (const d of aberto.manifesto.documentos.filter((x) => x.modulo === 'video')) {
      const v = aberto.docs[d.id] as DocCenas;
      const {patch, clipes} = patchAtualizarLigados(v, id, r, () => undefined);
      if (!patch.length) continue;
      base('sistema').aplicar({documento: d.id, patch, rotulo: `trilha atualizada (${id})`});
      trocados.push(...clipes.map((clipe) => ({video: d.id, clipe})));
    }
    return {trocados, renderizado: true};
  };
  return {
    paraTela: <T,>(x: T) => trocar(x, blobDe),
    doDisco: <T,>(x: T) => trocar(x, caminhoDe),
    registro: () => registro,
    levar: (p: Parameters<typeof levarPara>[1]) => levarPara(base('pessoa'), p),
    concluir: async (t: string) => {
      const r = concluirTransicao(base('pessoa'), {transicao: t});
      if (r.musica) await depoisDeMudar(r.musica);
      return r;
    },
    cancelar: (t: string, descartar?: boolean) => cancelarTransicao(base('pessoa'), {transicao: t, descartar}),
    depoisDeMudar,
    porNoVideo: async (o: {musica: string; video?: string; faixa?: string; em_ms?: number}) => {
      const doc = aberto!.docs[o.musica] as DocMusica;
      const video = o.video ?? doc.video?.documento ?? aberto!.manifesto.documentos.find((d) => d.modulo === 'video')?.id;
      if (!video) throw new Error('o projeto não tem vídeo');
      if (!doc.video) base('pessoa').aplicar({documento: o.musica, patch: [{op: 'add', path: '/video', value: {documento: video, em_ms: Math.round(o.em_ms ?? 0), voz_guia: true}}],
        rotulo: `música ligada ao vídeo ${video}`}); // como o porNoVideo do núcleo (marco 4)
      const r = renderDaMusica(o.musica, aberto!.docs[o.musica] as DocMusica);
      const novo = patchClipeNovo(aberto!.docs[video] as DocCenas, {idMusica: o.musica, faixa: o.faixa, em_ms: o.em_ms ?? doc.video?.em_ms ?? 0, render: r,
        nome: aberto!.manifesto.documentos.find((d) => d.id === o.musica)?.titulo});
      base('pessoa').aplicar({documento: video, patch: novo.patch, rotulo: `música ${o.musica} no vídeo`});
      await depoisDeMudar(o.musica);
      return {documento: video, caminho: novo.caminho};
    },
    /** Exportar (item 23): a conta é a do worker da janela, como no app; os bytes ficam em memória (sem ffmpeg na prévia,
     *  o M4A e o Opus ficam no WAV) e window.exportacoesDaMusica() mostra o que saiu. */
    exportar: async (documento: string, pedido: PedidoExportarMusica): Promise<ResultadoExportarMusica> => {
      const doc = aberto!.docs[documento] as DocMusica;
      const titulo = (pedido.nome?.trim() || aberto!.manifesto.documentos.find((d) => d.id === documento)?.titulo || doc.titulo || documento).replace(/[\\/:*?"<>|]+/g, '-');
      const base = `saidas/${titulo}`;
      if (pedido.formato === 'mid') {
        const r = musicaParaMidi(doc);
        exportadas.set(`${base}.mid`, {bytes: r.bytes.length});
        return {arquivos: [`${base}.mid`], avisos: r.avisos, feito_por: 'janela', trilhas: r.trilhas, notas: r.notas};
      }
      const daJanela = await ponteDaJanela.pedir('musica:exportar', {doc: paraTelaDoc(doc), pedido: {stems: pedido.stems, alvo_lufs: pedido.alvo_lufs, folga_db: pedido.formato === 'wav' ? 0 : 0.5}});
      if (!daJanela.ok) throw new Error(daJanela.mensagem);
      const e = daJanela.dados as EntregaEmBytes;
      const arquivos = [`${base}.${pedido.formato}`, ...(e.stems ?? []).map((x) => `${base} - stems/${x.nome}.wav`)];
      exportadas.set(arquivos[0], {bytes: e.mistura.length, lufs: e.medida.lufs, pico_dbtp: e.medida.pico_dbtp});
      (e.stems ?? []).forEach((x, i) => exportadas.set(arquivos[i + 1], {bytes: x.wav.length}));
      // créditos e comprovante (marco 5), como no processo principal (sem o SHA-256: a prévia não lê o disco)
      const lic = licencasDaMusica(doc);
      exportadas.set(`${base}.licencas.json`, {bytes: JSON.stringify(lic).length});
      arquivos.push(`${base}.licencas.json`);
      if (lic.creditos.length) {
        exportadas.set(`${base} - créditos.txt`, {bytes: textoDosCreditos(titulo, lic).length});
        arquivos.push(`${base} - créditos.txt`);
      }
      return {arquivos, avisos: [...e.avisos, ...lic.impede.map((x) => `antes de publicar: ${x}`), ...(pedido.formato === 'wav' ? [] : ['na prévia web não há ffmpeg: o arquivo ficou em WAV'])],
        feito_por: 'janela', duracao_s: e.duracao_s, medida: e.medida, pode_publicar: lic.pode_publicar, creditos: lic.creditos};
    },
    /** O que a tela grava (pelo aplicarPatch da ponte) também vai para o diário, com a transição aberta. */
    anotar: (documento: string, antes: unknown, depois: unknown, rotulo?: string) => {
      const e = aberto?.manifesto.documentos.find((d) => d.id === documento);
      if (e) anotar(e.caminho, antes, depois, {autor: 'pessoa', origem: 'interface', rotulo: rotulo ?? 'mudança'});
    },
  };
})();

// ---------- narração por IA (docs/narracao.md): sem rede, sem chave de verdade ----------
// A chave do Gemini aparece como vinda do cofre; a do Cloud TTS, que começa com "AIza", é aceita. "Gerar" faz uma narração
// sintética do tamanho do texto (60 ms por caractere), como blob, e põe na faixa de voz pela mesma conta do app.
function narracaoSimulada(): ApiEstudio['narracao'] {
  const ouvintes = new Set<(a: AndamentoNarracao) => void>();
  let chaveTts: string | null = null;
  let cancelar = false;
  const chaves = () => ({gemini: {pronto: true, origem: 'cofre' as const, final: 'k9Qe'},
    'google-tts': chaveTts ? {pronto: true, origem: 'cofre' as const, final: chaveTts.slice(-4)} : {pronto: false, origem: 'nenhuma' as const}});
  const blobDeFala = (ms: number) => {
    const amostras = narracaoSintetica(Math.max(0.5, ms / 1000));
    const wav = codificarWav([amostras], TAXA);
    const url = URL.createObjectURL(new Blob([wav], {type: 'audio/wav'}));
    audios.set(url, {url, nome: 'fala gerada.wav'});
    envelopes[url] = envelopeDeAmostras([amostras], TAXA);
    return {url, wav, duracao_ms: Math.round((amostras.length / TAXA) * 1000)};
  };
  const previa = (documento: string, o: {cenas?: string[]; refazer?: boolean} = {}): Previa => {
    const doc = aberto!.docs[documento] as DocCenas;
    const cfg = configDaNarracao(doc.narracao);
    const itens = itensDaNarracao(doc);
    const ids = escolherCenas(doc, o.cenas).ids;
    const alvo = itens.filter((i) => ids.includes(i.cena) && i.estado !== 'sem_texto' && (o.refazer || o.cenas?.length || i.estado !== 'gerada'));
    const custo = (i: (typeof itens)[number]) => custoNarracao(cfg.provedor, cfg.modelo, i.medida!)?.usd ?? 0;
    return {documento, provedor: cfg.provedor, modelo: cfg.modelo, voz: cfg.voz, tem_chave: chaves()[cfg.provedor].pronto,
      itens: alvo.map((i) => ({cena: i.cena, n: i.n, estado: i.estado, texto_final: i.texto_final, hash: i.hash, arquivo: i.arquivo, caracteres: i.medida!.caracteres,
        segundos_estimados: i.medida!.segundos, em_cache: false, vai_a_api: true, custo_usd: custo(i)})),
      total: {cenas: itens.length, a_gerar: alvo.length, vao_a_api: alvo.length, caracteres: alvo.reduce((s, i) => s + i.medida!.caracteres, 0),
        segundos_estimados: Math.round(alvo.reduce((s, i) => s + i.medida!.segundos, 0) * 10) / 10, custo_usd: alvo.reduce((s, i) => s + custo(i), 0), tabela: '10/11/2026',
        fonte: 'prévia web'},
      sem_texto: itens.filter((i) => ids.includes(i.cena) && i.estado === 'sem_texto').map((i) => i.n)};
  };
  return {
    estado: async () => ({...chaves(), cofre_persistente: true, cofre_texto: 'guardada cifrada neste PC (prévia web: em memória)'}),
    gravarChave: async (chave) => {
      if (!/^AIza/.test(chave)) return {ok: false, mensagem: 'a chave do Google Cloud TTS foi recusada pelo Google (400): API key not valid.'};
      chaveTts = chave;
      return {ok: true, persistente: true, mensagem: `chave aceita (${VOZES_CHIRP.length} vozes Chirp 3: HD em português) e guardada (prévia web)`};
    },
    apagarChave: async () => void (chaveTts = null),
    vozes: async (provedor: ProvedorNarracao) => ({provedor, vozes: provedor === 'gemini' ? VOZES_GEMINI : VOZES_CHIRP,
      aviso: `prévia web: o catálogo de ${NOMES_PROVEDOR[provedor]}, sem a lista da API`}),
    previa: async (documento, o) => previa(documento, o),
    gerar: async (documento, o = {}) => {
      cancelar = false;
      const p = previa(documento, o);
      const r: ResultadoNarracao = {ok: true, documento, provedor: p.provedor, modelo: p.modelo, voz: p.voz, geradas: [], avisos: [], sem_texto: p.sem_texto};
      if (!p.tem_chave) throw new Error(`falta a chave do ${NOMES_PROVEDOR[p.provedor]}: ponha em Configurações › IA`);
      const feitas: {cena: string; arquivo: string; duracao_ms: number; hash: string}[] = [];
      for (const [k, i] of p.itens.entries()) {
        if (cancelar) {
          r.ok = false;
          r.cancelado = true;
          r.erro = `cancelado depois de ${k} de ${p.itens.length}`;
          break;
        }
        ouvintes.forEach((f) => f({documento, feitas: k, total: p.itens.length, cena: i.cena, n: i.n, fase: 'gerando'}));
        await new Promise((ok) => setTimeout(ok, 500));
        const b = blobDeFala(i.caracteres * 60);
        feitas.push({cena: i.cena, arquivo: b.url, duracao_ms: b.duracao_ms, hash: i.hash!});
        r.geradas.push({cena: i.cena, n: i.n, arquivo: b.url, duracao_ms: b.duracao_ms, do_cache: false});
      }
      if (feitas.length) {
        const x = patchDasFalas(aberto!.docs[documento] as DocCenas, feitas);
        r.avisos.push(...x.avisos);
        await api.aplicarPatch({documento, patch: x.patch, rotulo: `narração por IA: ${feitas.length} cenas`});
        mudou(aberto!.manifesto.documentos.find((d) => d.id === documento)?.caminho ?? documento);
      }
      ouvintes.forEach((f) => f({documento, feitas: feitas.length, total: p.itens.length, fase: 'pronto'}));
      return r;
    },
    cancelar: () => void (cancelar = true),
    aoAndamento: (cb) => {
      ouvintes.add(cb);
      return () => ouvintes.delete(cb);
    },
    amostra: async () => {
      const b = blobDeFala(3000);
      return {wav: b.wav.buffer.slice(0) as ArrayBuffer, do_cache: false, custo_usd: 0.0007};
    },
  };
}
