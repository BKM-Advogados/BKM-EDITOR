// Processo principal do Estúdio: uma janela, o projeto aberto, os terminais, o servidor de mídia e a exportação.
import {app, BrowserWindow, dialog, ipcMain, net, shell, type IpcMainInvokeEvent} from 'electron';
import {execFile} from 'node:child_process';
import {copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {CANAL, type InfoProjeto, type Metricas, type NovoProjeto, type Perfil, type Preferencias, type Progresso, type ResultadoExportacao, type Retangulo} from '../compartilhado/api';
import {Conversas, contaClaude} from './conversa';
import type {Comentario, EstadoEditor, Manifesto, Modulo, OperacaoPatch} from '../nucleo/documentos';
import {aplicarMarcaAoPlano, dentroDoOneDrive, documentoNovo, gravarPlano, nomeDePasta, nomePadrao, pastaLivre, planoDoProjeto, regerarClaudeMd} from '../nucleo/criar-projeto';
import {MODELOS} from '../nucleo/modelos';
import {FORMATO_PADRAO, type Formato} from '../nucleo/formatos';
import {argumentosDoRender, destinoDoFormato, fontesDaMarcaDagua, FORMATOS_IMAGEM_SAIDA, legendasDasProps, marcaDaguaDoDestino, nomesDosArquivos, type OpcoesExportarImagem,
  type OpcoesExportarVideo} from '../nucleo/exportacao';
import {ErroProjeto, Projeto, serializar} from '../nucleo/projeto';
import {criarRede} from '../nucleo/ferramentas-mcp';
import {prepararRender, renderizarVideo} from './exportar';
import {registrarIpcMarcas} from './ipc-marcas';
import {registrarExportarPaginas} from './exportar-paginas';
import {McpHttp} from './mcp-http';
import {Memoria} from './memoria';
import {ServidorMidia} from './servidor-midia';
import {SessaoProjeto} from './sessao-projeto';
import {Terminais} from './terminais';
import {registrarIpcAudio} from './ipc-audio';
import {registrarIpcFala} from './ipc-fala'; // frente Fala
import {legendasNoDestino, type LegendasP} from '../nucleo/legendas'; // frente Fala: legendas no tamanho de cada destino
import {registrarPrefsExportacao} from './ipc-exportacao';
import {apagarLimposSemUso, registrarIpcLimpeza} from './limpeza-voz';
import {registrarIpcLoudness} from './loudness';
import {registrarRemoverFundo} from './remover-fundo';
import {aoAbrirMusica, registrarIpcMusica} from './ipc-musica'; // frente Música
import {criarPonteJanela} from './ponte-janela';

// o mesmo id do instalador (electron-builder.yml): a barra de tarefas agrupa a janela com o atalho
app.setAppUserModelId('br.com.bkmadvogados.estudio');

// teste de ponta a ponta: o script de e2e se conecta à janela pelo protocolo de depuração do Chromium
if (process.env.ESTUDIO_DEPURAR_PORTA) app.commandLine.appendSwitch('remote-debugging-port', process.env.ESTUDIO_DEPURAR_PORTA);

// Linux com gerenciador em mosaico: as janelas vêm sem moldura e sem minimizar, e se fecham pelo teclado (Super+W)
const MOSAICO = process.platform === 'linux'
  && (!!process.env.HYPRLAND_INSTANCE_SIGNATURE || /hyprland|sway|i3|river|niri/i.test(process.env.XDG_CURRENT_DESKTOP ?? ''));

const GB = os.totalmem() / 1024 ** 3;
const PERFIL: Perfil = GB <= 8.5
  ? {nome: 'leve', sessoes_claude: 2, escala_previa: 0.5, pixel_ratio: 1}
  : GB <= 16.5 ? {nome: 'padrao', sessoes_claude: 4, escala_previa: 0.75, pixel_ratio: 1.5} : {nome: 'forte', sessoes_claude: 8, escala_previa: 1, pixel_ratio: 2};

let janela: BrowserWindow | null = null;
let sessao: SessaoProjeto | null = null;
let avisoAbertura: string | undefined;
let claude = false;
// sem Git não há ponto de restauração (commit inicial, Ctrl+S): a tela inicial avisa
const gitInstalado = new Promise<boolean>((ok) => execFile('git', ['--version'], {windowsHide: true}, (e) => ok(!e)));
const desfeitos = new Set<number>();
const midia = new ServidorMidia();
// na pasta da pessoa e não em Documentos: com o OneDrive movendo Documentos, a sincronização trava a gravação atômica
// dos JSON e sobe o .git do projeto
const memoria = new Memoria(app.getPath('userData'), path.join(app.getPath('home'), 'Estudio'));
let mcpHttp: McpHttp | null = null;
let abasClaude = 0;
const enviar = (canal: string, ...a: unknown[]) => janela?.webContents.send(canal, ...a);
const terminais = new Terminais({dados: (id, d) => enviar(CANAL.terminalDados, id, d), saiu: (id, c) => enviar(CANAL.terminalSaiu, id, c)});
// teste da conversa sem login: ESTUDIO_CLAUDE_FALSO aponta para um claude falso (testes/fixtures/claude-falso.mjs),
// rodado pelo próprio Electron em modo Node
const claudeFalso = process.env.ESTUDIO_CLAUDE_FALSO;
const conversas = new Conversas({evento: (id, e) => enviar(CANAL.conversaEvento, id, e), vivas: () => terminais.vivas(),
  claude: () => (claudeFalso ? process.execPath : terminais.caminhoClaude),
  ...(claudeFalso ? {prefixo: [claudeFalso], ambienteExtra: {ELECTRON_RUN_AS_NODE: '1'}} : {})});

const recursos = (rel: string) => (app.isPackaged ? path.join(process.resourcesPath, rel) : path.join(app.getAppPath(), rel));
const pastaDoExemplo = () => recursos(path.join('exemplos', 'exemplo'));

const confiavel = (e: IpcMainInvokeEvent | Electron.IpcMainEvent) => {
  if (!janela || e.sender.id !== janela.webContents.id) throw new Error('chamada de IPC de origem desconhecida');
};
const exigirProjeto = () => {
  if (!sessao) throw new ErroProjeto('nenhum projeto aberto', 'nao_achado');
  return sessao.projeto;
};

const info = (): InfoProjeto | null => {
  if (!sessao) return null;
  let estado: EstadoEditor | null = null;
  try {
    estado = sessao.projeto.estado();
  } catch {
    estado = null;
  }
  return {raiz: sessao.projeto.raiz, manifesto: sessao.projeto.manifesto(), base_midia: midia.base, claude, perfil: PERFIL, git: sessao.temGit, estado,
    aviso: avisoAbertura};
};

const tituloDaJanela = (nome?: string) => janela?.setTitle(nome ? `${nome} — Estúdio` : 'Estúdio');

// ---------- miniatura do projeto (tela inicial) ----------
// A interface diz onde está o monitor; o processo principal fotografa só aquele retângulo da janela.
let pedidoMiniatura = 0;
const esperandoMiniatura = new Map<number, (r: Retangulo | null) => void>();
ipcMain.on(CANAL.miniatura, (e, n: number, r: Retangulo | null) => {
  confiavel(e);
  esperandoMiniatura.get(n)?.(r);
  esperandoMiniatura.delete(n);
});
const guardarMiniatura = async () => {
  if (!sessao || !janela || janela.isDestroyed() || janela.isMinimized() || !janela.isVisible()) return;
  const raiz = sessao.projeto.raiz;
  const n = ++pedidoMiniatura;
  const r = await new Promise<Retangulo | null>((ok) => {
    esperandoMiniatura.set(n, ok);
    enviar(CANAL.pedirMiniatura, n);
    setTimeout(() => esperandoMiniatura.delete(n) && ok(null), 600);
  });
  if (!r || r.width < 16 || r.height < 16) return;
  const foto = await janela.webContents.capturePage({x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height)});
  if (foto.isEmpty()) return;
  const {width, height} = foto.getSize();
  const escala = Math.min(1, 360 / Math.max(width, height));
  const menor = escala < 1 ? foto.resize({width: Math.round(width * escala), height: Math.round(height * escala), quality: 'good'}) : foto;
  mkdirSync(path.join(raiz, '.estudio'), {recursive: true});
  writeFileSync(path.join(raiz, '.estudio', 'miniatura.jpg'), menor.toJPEG(78));
};

// ---------- abrir, fechar, criar ----------
const fecharSessao = async () => {
  await guardarMiniatura().catch(() => undefined);
  terminais.fecharTodos();
  conversas.fecharTodas();
  mcpHttp?.esquecerTudo();
  await sessao?.fechar();
  sessao = null;
  avisoAbertura = undefined;
  desfeitos.clear();
  midia.servir(null);
  tituloDaJanela();
};

const abrirProjeto = async (raiz: string) => {
  if (!existsSync(path.join(raiz, 'estudio.json'))) throw new Error(`Esta pasta não é um projeto do Estúdio (falta o estudio.json): ${raiz}`);
  const manifesto = new Projeto(raiz).manifesto(); // confere antes de fechar o que está aberto
  await fecharSessao();
  sessao = new SessaoProjeto(raiz, (arquivo) => {
    if (arquivo === 'estudio.json') {
      try {
        tituloDaJanela(sessao?.projeto.manifesto().nome);
      } catch {
        /* manifesto quebrado no meio de uma gravação: a próxima mudança acerta */
      }
      regerarClaudeMd(raiz); // documento de outro módulo criado depois: o CLAUDE.md ganha a seção dele
    }
    enviar(CANAL.mudou, {arquivo});
  });
  midia.servir(raiz);
  regerarClaudeMd(raiz); // o Claude conhece os campos desta versão também nos projetos criados antes dela
  apagarLimposSemUso(sessao.projeto); // frente Som: as versões limpas da voz que nem documento nem diário citam (limpeza-voz.ts)
  aoAbrirMusica(sessao.projeto); // frente Música: renders que faltam (pasta clonada) e os que sobraram (ipc-musica.ts)
  await sessao.abrir();
  memoria.lembrar(raiz, manifesto.nome);
  tituloDaJanela(manifesto.nome);
  avisoAbertura = dentroDoOneDrive(raiz)
    ? 'Este projeto está numa pasta do OneDrive. A sincronização pode travar a gravação: prefira a pasta Estudio (Preferências).'
    : undefined;
  return info()!;
};

const criarProjeto = async (o: NovoProjeto) => {
  const prefs = memoria.prefs();
  const nome = o.nome?.trim() || nomePadrao(new Date());
  const destino = pastaLivre(o.pasta || prefs.pasta_projetos, nome);
  const plano = planoDoProjeto({nome, modelo: o.modelo, formato: o.formato});
  if (o.marca) aplicarMarcaAoPlano(plano, marcas.ler(o.marca));
  gravarPlano(destino, plano, pastaDoExemplo());
  const modulo = MODELOS.find((m) => m.id === o.modelo)?.modulo;
  if (o.formato_id && modulo === 'video') memoria.gravarPrefs({formato_video: o.formato_id});
  if (o.formato_id && modulo === 'imagem') memoria.gravarPrefs({formato_imagem: o.formato_id});
  return abrirProjeto(destino);
};

/** Arquivo que ainda não existe em `pasta`: "Nome.mp4", "Nome (2).mp4"... */
const arquivoLivre = (pasta: string, nome: string, ext: string) => {
  const base = nomeDePasta(nome) || 'saida';
  let p = path.join(pasta, `${base}.${ext}`);
  for (let n = 2; existsSync(p); n++) p = path.join(pasta, `${base} (${n}).${ext}`);
  return p;
};
const tituloDoDocumento = (p: Projeto, id: string) => p.manifesto().documentos.find((d) => d.id === id)?.titulo ?? id;

const criarJanela = () => {
  janela = new BrowserWindow({
    width: 1600,
    height: 950,
    minWidth: 1100,
    minHeight: 640,
    show: false,
    // barra de título própria (a casca desenha nome, áreas e ações); os botões da janela continuam os do sistema, menos
    // nos gerenciadores em mosaico (Hyprland/Omarchy, Sway…), que não têm moldura nem minimizar
    titleBarStyle: 'hidden',
    ...(MOSAICO ? {} : {titleBarOverlay: {color: '#0f0f0f', symbolColor: '#b4b4b4', height: 36}}),
    backgroundColor: '#0f0f0f',
    title: 'Estúdio',
    autoHideMenuBar: true,
    webPreferences: {contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, 'preload.js')},
  });
  janela.webContents.setWindowOpenHandler(({url}) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return {action: 'deny'};
  });
  // recarregar a página (Ctrl+R) ou perder o renderer faz a interface esquecer as abas: fecha os terminais para não
  // sobrar claude órfão gastando memória por trás
  const largarTerminais = () => {
    terminais.fecharTodos();
    conversas.fecharTodas();
    mcpHttp?.esquecerTudo();
  };
  janela.webContents.on('did-start-navigation', (d) => {
    if (d.isMainFrame && !d.isSameDocument) largarTerminais();
  });
  janela.webContents.on('render-process-gone', largarTerminais);
  // ao fechar com um projeto aberto, a miniatura sai antes (meio segundo no máximo)
  let fechando = false;
  janela.on('close', (e) => {
    if (fechando || !sessao) return;
    e.preventDefault();
    fechando = true;
    void guardarMiniatura().catch(() => undefined).finally(() => janela?.close());
  });
  janela.once('ready-to-show', () => janela?.show());
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) void janela.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  else void janela.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
};

const lidar = <A extends unknown[], R>(canal: string, f: (...a: A) => R | Promise<R>) =>
  ipcMain.handle(canal, async (e, ...a) => {
    confiavel(e);
    return f(...(a as A));
  });

lidar(CANAL.abrirPasta, async () => {
  const r = await dialog.showOpenDialog(janela!, {properties: ['openDirectory'], title: 'Abrir projeto do Estúdio'});
  return r.canceled || !r.filePaths[0] ? null : abrirProjeto(r.filePaths[0]);
});
// o exemplo sempre em cópia nova: editar não estraga o "ver um pronto" da próxima vez
lidar(CANAL.abrirExemplo, () => criarProjeto({modelo: 'modelo-carrossel', nome: 'Exemplo · Cliente C2'}));
lidar(CANAL.abrirProjeto, (raiz: string) => abrirProjeto(raiz));
lidar(CANAL.projetoAtual, () => info());
lidar(CANAL.criarProjeto, (o: NovoProjeto) => criarProjeto(o));
lidar(CANAL.fecharProjeto, () => fecharSessao());
lidar(CANAL.duplicarProjeto, async (o: {raiz?: string; nome: string}) => {
  const origem = o.raiz ?? exigirProjeto().raiz;
  if (!existsSync(path.join(origem, 'estudio.json'))) throw new Error(`a pasta do projeto não existe mais: ${origem}`);
  if (sessao && path.resolve(sessao.projeto.raiz) === path.resolve(origem)) await sessao.marcarVersao('estúdio: antes de duplicar');
  const nome = o.nome.trim() || `${new Projeto(origem).manifesto().nome} (cópia)`;
  const destino = pastaLivre(path.dirname(origem), nome);
  // sem histórico, diário, estado e saídas: a cópia começa limpa
  cpSync(origem, destino, {recursive: true, filter: (src) => !['.git', '.estudio', 'saidas'].includes(path.relative(origem, src).split(path.sep)[0])});
  const arq = path.join(destino, 'estudio.json');
  writeFileSync(arq, serializar({...(JSON.parse(readFileSync(arq, 'utf-8')) as Manifesto), nome}), 'utf-8');
  return abrirProjeto(destino);
});
lidar(CANAL.renomearProjeto, (nome: string) => {
  const m = exigirProjeto().renomear(nome);
  memoria.lembrar(sessao!.projeto.raiz, m.nome);
  tituloDaJanela(m.nome);
  return m;
});
lidar(CANAL.criarDocumento, (o: {modulo: Modulo; formato?: Formato | {largura: number; altura: number}; titulo?: string}) => {
  const p = exigirProjeto();
  const {entrada, conteudo} = documentoNovo(p.manifesto(), o.modulo, {formato: o.formato, titulo: o.titulo});
  return p.adicionarDocumento(entrada, conteudo);
});
lidar(CANAL.renomearDocumento, (id: string, titulo: string) => exigirProjeto().renomearDocumento(id, titulo));
lidar(CANAL.ambiente, async () => ({perfil: PERFIL, git: await gitInstalado, claude, versao: app.getVersion(), pasta_padrao: path.join(app.getPath('home'), 'Estudio')}));
lidar(CANAL.recentes, () => memoria.recentes());
lidar(CANAL.esquecerRecente, (raiz: string) => memoria.esquecer(raiz));
lidar(CANAL.preferencias, () => memoria.prefs());
lidar(CANAL.gravarPreferencias, (p: Partial<Preferencias>) => memoria.gravarPrefs(p));
lidar(CANAL.escolherPasta, async (titulo?: string) => {
  const r = await dialog.showOpenDialog(janela!, {properties: ['openDirectory', 'createDirectory'], title: titulo ?? 'Escolher pasta'});
  return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
});
lidar(CANAL.marcarVersao, async () => {
  exigirProjeto();
  const ok = await sessao!.marcarVersao();
  return ok ? {ok, mensagem: 'Ponto de restauração criado'} : {ok, mensagem: 'Sem o Git instalado não há pontos de restauração; o histórico continua no diário'};
});
lidar(CANAL.escolherMidia, async (tipo: 'imagem' | 'audio' | 'video') => {
  const p = exigirProjeto();
  const filtros = {
    imagem: {name: 'Imagens', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'avif']},
    audio: {name: 'Áudio', extensions: ['wav', 'mp3', 'm4a', 'ogg', 'aac']},
    video: {name: 'Vídeo', extensions: ['mp4', 'webm', 'mov']},
  };
  const r = await dialog.showOpenDialog(janela!, {properties: ['openFile'], title: 'Escolher arquivo', filters: [filtros[tipo]]});
  const arq = r.filePaths[0];
  if (r.canceled || !arq) return null;
  // o que já está dentro do projeto é usado no lugar; o que vem de fora é copiado para midia/
  const dentro = path.relative(p.raiz, arq);
  if (!dentro.startsWith('..') && !path.isAbsolute(dentro)) return dentro.split(path.sep).join('/');
  const ext = path.extname(arq).slice(1).toLowerCase();
  const destino = arquivoLivre(p.caminho('midia'), path.basename(arq, path.extname(arq)), ext);
  mkdirSync(path.dirname(destino), {recursive: true});
  copyFileSync(arq, destino);
  return path.relative(p.raiz, destino).split(path.sep).join('/');
});
lidar(CANAL.lerDocumento, (documento: string) => {
  const p = exigirProjeto();
  return p.lerJson(p.arquivoDoDocumento(documento));
});
lidar(CANAL.lerJson, (caminho: string) => exigirProjeto().lerJson(caminho).doc);
lidar(CANAL.aplicarPatch, (o: {documento: string; versao_base?: string; patch: OperacaoPatch[]; rotulo?: string}) => {
  const r = exigirProjeto().aplicarPatch({...o, autor: 'pessoa', origem: 'interface'});
  return {versao: r.versao, seq: r.entrada.seq};
});
lidar(CANAL.desfazer, () => {
  const p = exigirProjeto();
  const minhas = p.diario().filter((e) => e.autor === 'pessoa' && e.origem === 'interface' && !desfeitos.has(e.seq));
  const ultima = minhas[minhas.length - 1];
  if (!ultima) return {ok: false, mensagem: 'nada seu para desfazer'};
  try {
    p.aplicarPatch({documento: ultima.documento, versao_base: ultima.versao_depois, patch: ultima.inverso, autor: 'pessoa', origem: 'desfazer', rotulo: `desfazer: ${ultima.rotulo}`});
    desfeitos.add(ultima.seq);
    return {ok: true, mensagem: `desfeito: ${ultima.rotulo}`};
  } catch {
    return {ok: false, mensagem: 'o documento mudou depois (talvez pelo Claude); desfaça pelo histórico'};
  }
});
lidar(CANAL.propsVideo, (documento: string) => {
  exigirProjeto();
  return sessao!.propsVideo(documento, midia.base);
});
lidar(CANAL.comentarios, () => exigirProjeto().comentarios());
lidar(CANAL.novoComentario, (c: Pick<Comentario, 'documento' | 'texto' | 'alvo'>) => exigirProjeto().novoComentario({...c, autor: 'pessoa'}));
lidar(CANAL.responder, (id: string, texto: string) => exigirProjeto().responder(id, 'pessoa', texto));
lidar(CANAL.resolverComentario, (id: string) => exigirProjeto().resolver(id, 'pessoa'));
lidar(CANAL.reabrir, (id: string) => exigirProjeto().reabrir(id));
lidar(CANAL.diario, (desde?: number) => exigirProjeto().diario(desde ?? 0).slice(-200));
// pesquisa (docs/pesquisa.md): a interface só lê; o Claude grava pelo MCP e o observador da pasta avisa a tela
lidar(CANAL.pesquisa, () => exigirProjeto().pesquisa());
// o texto de uma fonte passa de 600 KB (a CLT inteira): lido sem travar o processo principal
lidar(CANAL.textoFonte, async (fonteId: string, inicio?: number, fim?: number) => {
  const texto = await exigirProjeto().lerTextoFonteSemTravar(fonteId);
  return inicio === undefined && fim === undefined ? texto : texto.slice(inicio ?? 0, fim ?? texto.length);
});
lidar(CANAL.abrirFonte, async (url: string) => {
  let endereco: URL;
  try {
    endereco = new URL(url);
  } catch {
    return false;
  }
  if (endereco.protocol !== 'http:' && endereco.protocol !== 'https:') return false;
  await shell.openExternal(endereco.href);
  return true;
});
lidar(CANAL.terminalCriar, (o: {tipo: 'claude' | 'shell'; colunas: number; linhas: number; sessao?: string}) =>
  terminais.criar({...o, cwd: exigirProjeto().raiz, limiteClaude: PERFIL.sessoes_claude, outrasVivas: conversas.vivas(),
    arquivoMcp: o.tipo === 'claude' ? mcpHttp!.novaAba(midia.origem, `Claude ${++abasClaude}`) : undefined}));
lidar(CANAL.conversaConta, () => contaClaude(terminais.caminhoClaude));
lidar(CANAL.conversaAbrir, (o: {sessao?: string}) =>
  conversas.abrir({cwd: exigirProjeto().raiz, sessao: o.sessao, arquivoMcp: mcpHttp!.novaAba(midia.origem, `Claude ${++abasClaude}`)}));
lidar(CANAL.conversaEnviar, (id: number, texto: string) => conversas.enviar(id, texto, PERFIL.sessoes_claude));
lidar(CANAL.conversaHibernar, (id: number) => conversas.hibernar(id));
// ---------- exportação: um ou mais arquivos em saidas/, com andamento na interface e na barra de tarefas, e Cancelar ----------
// Sem opções (chamada antiga), sai o MP4 H.264 no formato do documento. Com elas, um arquivo por destino: o vídeo de cenas
// é relativo ao quadro, então basta trocar largura e altura nas props; o carrossel da Cliente é fixo em 1080×1920 e só
// aceita escala. O diálogo mostra os arquivos e "Mostrar na pasta" ao fim, então a pasta não abre sozinha.
let cancelarExportacao: (() => void) | null = null;
lidar(CANAL.exportar, async (documento: string, opcoes?: OpcoesExportarVideo): Promise<ResultadoExportacao> => {
  const p = exigirProjeto();
  if (cancelarExportacao) return {ok: false, mensagem: 'já há uma exportação em andamento'};
  const montado = sessao!.propsVideo(documento, midia.base);
  if ('erro' in montado) return {ok: false, mensagem: montado.erro};
  const props = montado.props;
  const formato: Formato = {largura: Number(props.largura) || FORMATO_PADRAO.largura, altura: Number(props.altura) || FORMATO_PADRAO.altura, fps: Number(props.fps) || FORMATO_PADRAO.fps};
  const fixo = props.composicao !== 'VideoCenas';
  const o: OpcoesExportarVideo = {codec: 'h264', qualidade: 'alta', escala: 1, ...opcoes, destinos: fixo || !opcoes?.destinos?.length ? [destinoDoFormato(formato)] : opcoes.destinos};
  const pasta = p.caminho('saidas');
  mkdirSync(pasta, {recursive: true});
  const planos = nomesDosArquivos(o.nome?.trim() || tituloDoDocumento(p, documento), o.destinos, formato);
  const {makeCancelSignal} = await import('@remotion/renderer');
  const {cancelSignal, cancel} = makeCancelSignal();
  cancelarExportacao = cancel;
  const arquivos: string[] = [];
  let parcial: string | undefined;
  // o andamento de cada arquivo vai à interface com o nome dele; a barra de tarefas mostra o andamento geral
  const avisoDe = (indice: number, arquivo: string) => (x: Progresso) => {
    enviar(CANAL.progresso, {...x, arquivo, indice: indice + 1, total: planos.length});
    if (x.tipo === 'progresso' && x.progresso !== undefined) janela?.setProgressBar((indice + x.progresso / 100) / planos.length);
  };
  const fontesMarca = fontesDaMarcaDagua(props);
  try {
    const preparado = await prepararRender({raizApp: app.getAppPath(), empacotado: app.isPackaged, aviso: avisoDe(0, '')});
    for (const [i, plano] of planos.entries()) {
      const args = argumentosDoRender(o, plano.destino, formato, Number(props.duracao_ms) || 0);
      const destino = arquivoLivre(pasta, plano.nome, args.ext);
      parcial = destino;
      // legendas na área segura e na quebra do destino, não do documento (frente Fala; a área fica em legendas_cenas.area)
      const legendas = !fixo && props.legendas_cenas ? legendasNoDestino(props.legendas_cenas as LegendasP, args.largura, args.altura, formato) : undefined;
      const propsDestino = {...(fixo ? props : {...props, largura: args.largura, altura: args.altura}), ...(legendas ? {legendas_cenas: legendas} : {})};
      // marca d'água do destino, se ligada: posicionada no tamanho do destino, em frações (vale com qualquer escala), fora
      // da legenda que vai neste render (a das props do destino, já recalculada acima)
      const marca = marcaDaguaDoDestino(o.marca_dagua?.[plano.destino.id], plano.destino, fontesMarca, o.proporcao_logo, legendasDasProps(propsDestino));
      await renderizarVideo(preparado, {
        props: {...propsDestino, ...(marca ? {marca_dagua: marca} : {})},
        arquivo: destino, codec: args.codec, videoBitrate: args.videoBitrate, escala: fixo ? args.escala : 1, quadros: args.frameRange, cancelSignal,
      }, avisoDe(i, path.basename(destino)));
      arquivos.push(destino);
      parcial = undefined;
    }
    enviar(CANAL.progresso, {tipo: 'status', mensagem: `Exportado: ${arquivos.map((a) => path.relative(p.raiz, a)).join(', ')}`});
    return {ok: true, arquivo: arquivos[0], arquivos, pasta};
  } catch (e) {
    const mensagem = (e as Error).message;
    const cancelado = /cancel/i.test(mensagem);
    if (parcial) rmSync(parcial, {force: true}); // o arquivo pela metade não fica em saidas/
    enviar(CANAL.progresso, {tipo: 'status', mensagem: cancelado ? 'Exportação cancelada' : `Falhou: ${mensagem}`});
    return {ok: false, cancelado, mensagem: cancelado ? 'Exportação cancelada' : mensagem, arquivos, pasta};
  } finally {
    cancelarExportacao = null;
    janela?.setProgressBar(-1);
  }
});
// a interface manda a imagem já desenhada (PNG, JPG ou WebP em data URL); aqui só grava com o nome livre em saidas/
lidar(CANAL.exportarImagem, (documento: string, dados: string, opcoes?: OpcoesExportarImagem) => {
  const p = exigirProjeto();
  const pasta = p.caminho('saidas');
  mkdirSync(pasta, {recursive: true});
  const ext = FORMATOS_IMAGEM_SAIDA.find((f) => f.id === opcoes?.formato)?.ext ?? 'png';
  const destino = arquivoLivre(pasta, `${opcoes?.nome?.trim() || tituloDoDocumento(p, documento)}${opcoes?.sufixo ?? ''}`, ext);
  writeFileSync(destino, Buffer.from(dados.replace(/^data:image\/[\w.+-]+;base64,/, ''), 'base64'));
  return {ok: true, arquivo: destino, pasta};
});
lidar(CANAL.metricas, (): Metricas => {
  const processos = app.getAppMetrics().map((m) => ({tipo: m.type, memoria_mb: Math.round(m.memory.workingSetSize / 1024), cpu: Math.round(m.cpu.percentCPUUsage)}));
  return {memoria_mb: processos.reduce((s, x) => s + x.memoria_mb, 0), processos};
});
registrarExportarPaginas(lidar, CANAL.exportarPaginas, {projeto: exigirProjeto, mostrar: (arquivo) => shell.showItemInFolder(arquivo)});

registrarIpcAudio(lidar, exigirProjeto, () => memoria.prefs()); // som do vídeo de cenas
// acabamento da imagem (rodada 2, B2): remover fundo, com o modelo em ~/Estudio/modelos e o pedido do MCP à janela
registrarRemoverFundo(lidar, {enviar, projeto: exigirProjeto, pasta: path.join(app.getPath('home'), 'Estudio', 'modelos'), buscar: (u, i) => net.fetch(u, i),
  ouvir: (canal, f) => ipcMain.on(canal, (e, ...a) => (confiavel(e), f(...(a as never[]))))});

ipcMain.on(CANAL.gravarEstado, (e, estado: Omit<EstadoEditor, 'atualizado_em'>) => {
  confiavel(e);
  try {
    sessao?.projeto.gravarEstado({...estado, atualizado_em: new Date().toISOString()});
  } catch {
    /* estado é só conveniência para o agente e para reabrir onde parou */
  }
});
ipcMain.on(CANAL.mostrarNaPasta, (e, caminho?: string) => {
  confiavel(e);
  const alvo = caminho ?? sessao?.projeto.raiz;
  if (alvo && existsSync(alvo)) void shell.openPath(alvo);
});
ipcMain.on(CANAL.terminalEscrever, (e, id: number, d: string) => (confiavel(e), terminais.escrever(id, d)));
ipcMain.on(CANAL.terminalTamanho, (e, id: number, c: number, l: number) => (confiavel(e), terminais.tamanho(id, c, l)));
ipcMain.on(CANAL.terminalFechar, (e, id: number) => (confiavel(e), terminais.fechar(id)));
ipcMain.on(CANAL.conversaPermitir, (e, id: number, pedido: string, decisao: 'permitir' | 'negar', sempre?: boolean) => (confiavel(e), conversas.permitir(id, pedido, decisao, sempre)));
ipcMain.on(CANAL.conversaParar, (e, id: number) => (confiavel(e), conversas.parar(id)));
ipcMain.on(CANAL.conversaFechar, (e, id: number) => (confiavel(e), conversas.fechar(id)));
ipcMain.on(CANAL.exportarCancelar, (e) => (confiavel(e), cancelarExportacao?.()));
ipcMain.on(CANAL.mostrarArquivo, (e, caminho: string) => {
  confiavel(e);
  if (typeof caminho === 'string' && existsSync(caminho)) shell.showItemInFolder(caminho);
});

// kits de marca e fontes próprias (ipc-marcas.ts): a pasta das preferências, servida também pelo servidor de mídia
const marcas = registrarIpcMarcas({lidar, janela: () => janela, memoria, midia, exigirProjeto, exemplo: pastaDoExemplo()});

registrarPrefsExportacao(lidar, exigirProjeto); // marca d'água por destino, lembrada no projeto (frente C)
// frente Som (rodada 2): limpeza de voz (limpeza-voz.ts) e medidor de loudness da mistura (loudness.ts)
registrarIpcLimpeza(lidar, exigirProjeto, enviar);
registrarIpcLoudness(lidar, exigirProjeto, (documento) => (exigirProjeto(), sessao!.propsVideo(documento, midia.base)));
// frente Música: ida e volta com o vídeo e o render ligado, feito no Web Worker da janela pela ponte com a janela
registrarIpcMusica(lidar, exigirProjeto, criarPonteJanela({enviar, temJanela: () => Boolean(janela && !janela.isDestroyed()),
  ouvir: (canal, f) => ipcMain.on(canal, (e, ...a) => (confiavel(e), f(...(a as never[]))))}));

app.on('ready', async () => {
  await midia.iniciar();
  // a rede do ler_fonte no app: net.fetch do Electron (proxy e certificados do sistema), assíncrono, 40 s e 20 MB no máximo
  mcpHttp = new McpHttp(path.join(app.getPath('userData'), 'mcp'), () => sessao?.projeto ?? null, criarRede((url, init) => net.fetch(url, init)));
  midia.rota((req, res) => mcpHttp!.atender(req, res));
  claude = await terminais.preparar();
  criarJanela();
  const inicial = process.env.ESTUDIO_PROJETO ? path.resolve(process.env.ESTUDIO_PROJETO) : memoria.prefs().ao_iniciar === 'ultimo' ? memoria.ultimo() : null;
  if (inicial) await abrirProjeto(inicial).catch(() => undefined);
});

app.on('window-all-closed', () => {
  terminais.fecharTodos();
  conversas.fecharTodas();
  mcpHttp?.esquecerTudo();
  void sessao?.fechar();
  midia.parar();
  app.quit();
});

// frente Fala: transcrição local e legendas (ipc-fala.ts); o mesmo transcritor atende a ferramenta transcrever do MCP
registrarIpcFala({lidar, confiavel, janela: () => janela, projeto: exigirProjeto, enviar, raizApp: app.getAppPath(), empacotado: app.isPackaged, buscar: (u, i) => net.fetch(u, i)});
