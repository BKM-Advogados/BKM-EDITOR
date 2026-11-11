// Processo principal do Estúdio: uma janela, o projeto aberto, os terminais, o servidor de mídia e a exportação.
import {app, BrowserWindow, dialog, ipcMain, Menu, net, safeStorage, shell, systemPreferences, type IpcMainInvokeEvent} from 'electron';
import {copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {CANAL, type InfoProjeto, type Metricas, type NovoProjeto, type Perfil, type Preferencias, type Progresso, type ResultadoExportacao, type Retangulo} from '../compartilhado/api';
import {contaClaude} from './conversa';
import type {Comentario, EstadoEditor, Manifesto, Modulo, OperacaoPatch} from '../nucleo/documentos';
import {aplicarMarcaAoPlano, dentroDoOneDrive, documentoNovo, gravarPlano, nomePadrao, pastaLivre, planoDoExemplo, planoDoProjeto, regerarClaudeMd} from '../nucleo/criar-projeto';
import {EXEMPLO} from '../nucleo/exemplo';
import {MODELOS} from '../nucleo/modelos';
import {FORMATO_PADRAO, type Formato} from '../nucleo/formatos';
import {argumentosDoRender, destinoDoFormato, estimarExportacao, fontesDaMarcaDagua, FORMATOS_IMAGEM_SAIDA, legendasDasProps, marcaDaguaDoDestino, nomesDosArquivos,
  type OpcoesExportarImagem, type OpcoesExportarVideo} from '../nucleo/exportacao';
import {ErroProjeto, Projeto, serializar} from '../nucleo/projeto';
import {criarRede} from '../nucleo/ferramentas-mcp';
import {discoCheio, encerrarRender, faltaEspaco, prepararRender, renderizarVideo, type Preparado} from './exportar';
import {registrarIpcMarcas} from './ipc-marcas';
import {arquivoLivre, registrarExportarPaginas} from './exportar-paginas';
import {lerJsonDaTela} from './ler-json';
import {McpHttp} from './mcp-http';
import {Memoria} from './memoria';
import {ServidorMidia} from './servidor-midia';
import {SessaoProjeto} from './sessao-projeto';
import {Terminais} from './terminais';
import {decidirPermissao, ehMosaico, opcoesDaBarra, projetoNosArgumentos} from './plataforma'; // portes Windows e Mac
import {gitDoApp} from './git';
import {modeloDoMenuDoMac} from './menu-do-app';
import {registrarIpcAudio} from './ipc-audio';
import {registrarIpcGravacao} from './ipc-gravacao'; // frente Som (rodada 3)
import {definirPastaTrilhas} from '../nucleo/pasta-trilhas';
import {somAcompanhaCenas} from '../nucleo/som-com-cenas';
import {cancelarFala, registrarIpcFala} from './ipc-fala'; // frente Fala
import {legendasNoDestino, type LegendasP} from '../nucleo/legendas'; // frente Fala: legendas no tamanho de cada destino
import {arquivosDeLegendaDoVideo, planoDasLegendas} from '../nucleo/legendas-exportacao'; // frente Fala: queimar ou SRT por destino
import {registrarPrefsExportacao} from './ipc-exportacao';
import {registrarContrasteMarca} from './contraste-marca';
import {apagarLimposSemUso, registrarIpcLimpeza} from './limpeza-voz';
import {registrarIpcLoudness} from './loudness';
import {registrarRemoverFundo} from './remover-fundo';
import {avisoDeQuedaEmLaco, decidirRecarga, ehPaginaDoApp, garantirInstanciaUnica, permissaoLiberada, trazerParaFrente} from './janela-segura'; // frente Casca
import {registrarIpcMidia} from './ipc-midia'; // frente Casca: painel de mídia
import {lojaDeSenhasLinux} from './loja-de-senhas'; // frente IA
import {criarSessoesIA, fecharAppsDeFora, iniciarAppsDeFora, perguntarAPessoa, registrarIpcIa, retomadaDe} from './ipc-ia'; // frente IA
import {registrarIpcNarracao} from './ipc-narracao'; // narração por IA (docs/narracao.md)
import {aoAbrirMusica, registrarIpcMusica} from './ipc-musica'; // frente Música
import {criarPonteJanela} from './ponte-janela';
import {definirServicoPrevia} from '../nucleo/mcp-previa'; // frente IDE: prévias do MCP
import {criarServicoPrevia} from './previa'; // frente IDE
import {criarIde} from './ide'; // frente IDE: projetos prontos para IDE de agentes
import {scriptDoMcp} from '../nucleo/ide'; // frente IDE

// o mesmo id do instalador (electron-builder.yml): a barra de tarefas agrupa a janela com o atalho
app.setAppUserModelId('br.com.bkmadvogados.estudio');

// teste de ponta a ponta: o script de e2e se conecta à janela pelo protocolo de depuração do Chromium
if (process.env.ESTUDIO_DEPURAR_PORTA) app.commandLine.appendSwitch('remote-debugging-port', process.env.ESTUDIO_DEPURAR_PORTA);

// Linux: o chaveiro do safeStorage (cofre das chaves de IA) precisa ser escolhido antes do app abrir; ver loja-de-senhas.ts
const LOJA_DE_SENHAS = process.platform === 'linux' ? lojaDeSenhasLinux(process.env, process.argv) : undefined;
if (LOJA_DE_SENHAS) app.commandLine.appendSwitch('password-store', LOJA_DE_SENHAS);

// Linux com gerenciador em mosaico: as janelas vêm sem moldura e sem minimizar, e se fecham pelo teclado (Super+W)
const MOSAICO = ehMosaico(process.platform, process.env);

const GB = os.totalmem() / 1024 ** 3;
const PERFIL: Perfil = GB <= 8.5
  ? {nome: 'leve', sessoes_claude: 2, escala_previa: 0.5, pixel_ratio: 1}
  : GB <= 16.5 ? {nome: 'padrao', sessoes_claude: 4, escala_previa: 0.75, pixel_ratio: 1.5} : {nome: 'forte', sessoes_claude: 8, escala_previa: 1, pixel_ratio: 2};

let janela: BrowserWindow | null = null;
// frente Casca (transversal-D5): um Estúdio só por pasta de dados. A segunda abertura traz a primeira para a frente e sai.
// ESTUDIO_VARIAS_INSTANCIAS=1 libera uma instância de desenvolvimento ao lado da instalada.
// A segunda abertura com uma pasta de projeto (arrastada no atalho, "Abrir com") abre a pasta na primeira.
const primeiraInstancia = process.env.ESTUDIO_VARIAS_INSTANCIAS === '1' || garantirInstanciaUnica(app, (argv, cwd) => {
  trazerParaFrente(janela);
  const pasta = projetoNosArgumentos(argv, existsSync, cwd);
  if (pasta) abrirDeFora(pasta);
});
let sessao: SessaoProjeto | null = null;
let avisoAbertura: string | undefined;
let claude = false;
// sem Git não há ponto de restauração (commit inicial, Ctrl+S): a tela inicial avisa (git.ts: no Mac, só o git de verdade)
const gitInstalado = gitDoApp().then((g) => g !== null);
const midia = new ServidorMidia();
// na pasta da pessoa e não em Documentos: com o OneDrive movendo Documentos, a sincronização trava a gravação atômica
// dos JSON e sobe o .git do projeto
const memoria = new Memoria(app.getPath('userData'), path.join(app.getPath('home'), 'Estudio'));
let mcpHttp: McpHttp | null = null;
// com a janela já destruída (a espera do commit ao fechar o app), webContents.send lançaria "Object has been destroyed"
const enviar = (canal: string, ...a: unknown[]) => janela && !janela.isDestroyed() && janela.webContents.send(canal, ...a);
const terminais = new Terminais({dados: (id, d) => enviar(CANAL.terminalDados, id, d), saiu: (id, c) => enviar(CANAL.terminalSaiu, id, c)});
// teste da conversa sem login: ESTUDIO_CLAUDE_FALSO aponta para um claude falso (testes/fixtures/claude-falso.mjs),
// rodado pelo próprio Electron em modo Node
const claudeFalso = process.env.ESTUDIO_CLAUDE_FALSO;
// frente IA (rodada 3): conversas de qualquer provedor (src/main/ia/sessoes.ts); o Claude segue pelo conversa.ts
const conversas = criarSessoesIA({evento: (id, e) => enviar(CANAL.conversaEvento, id, e), vivasTerminal: () => terminais.vivas(),
  conexao: (origem) => mcpHttp!.novaConexao(midia.origem, origem),
  claude: {claude: () => (claudeFalso ? process.execPath : terminais.caminhoClaude),
    ...(claudeFalso ? {prefixo: [claudeFalso], ambienteExtra: {ELECTRON_RUN_AS_NODE: '1'}} : {})}});

const recursos = (rel: string) => (app.isPackaged ? path.join(process.resourcesPath, rel) : path.join(app.getAppPath(), rel));
// frente IDE (docs/ide.md): .mcp.json, .claude/settings.local.json e t3.json em cada projeto, com o MCP por stdio deste app
const ide = criarIde({executavel: process.execPath, script: scriptDoMcp({empacotado: app.isPackaged, recursos: process.resourcesPath, raizApp: app.getAppPath()}),
  ligado: () => memoria.prefs().projetos_ide !== false});
const pastaDoExemplo = () => recursos(path.join('exemplos', EXEMPLO.pasta));
const temExemplo = () => existsSync(path.join(pastaDoExemplo(), 'estudio.json'));

const paginaDoApp = (url?: string) => ehPaginaDoApp(url, {dev: MAIN_WINDOW_VITE_DEV_SERVER_URL || undefined,
  indexHtml: path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`), windows: process.platform === 'win32'});
// a mesma janela não basta: uma página que entrasse no lugar do app (P5) herdaria o preload; o quadro tem de ser o do app
const confiavel = (e: IpcMainInvokeEvent | Electron.IpcMainEvent) => {
  if (!janela || e.sender.id !== janela.webContents.id || !paginaDoApp(e.senderFrame?.url)) throw new Error('chamada de IPC de origem desconhecida');
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
// uma troca de projeto por vez (duplo clique no recente, clique enquanto o projeto inicial abre): sem isso o abrir() que
// ainda esperava o git criava um observador que ninguém mais fechava. Só nos handlers: as funções chamam umas às outras.
let filaProjeto: Promise<unknown> = Promise.resolve();
const emFila = <T>(f: () => Promise<T>): Promise<T> => {
  const vez = filaProjeto.then(() => f());
  filaProjeto = vez.catch(() => undefined);
  return vez;
};

const fecharSessao = async () => {
  cancelarFala(); // frente Fala: o whisper para junto com o projeto (transversal-N4)
  await guardarMiniatura().catch(() => undefined);
  terminais.fecharTodos();
  conversas.fecharTodas();
  mcpHttp?.esquecerTudo();
  await sessao?.fechar();
  sessao = null;
  avisoAbertura = undefined;
  midia.servir(null);
  tituloDaJanela();
};

const abrirProjeto = async (raiz: string) => {
  if (!existsSync(path.join(raiz, 'estudio.json'))) throw new Error(`Esta pasta não é um projeto do Estúdio (falta o estudio.json): ${raiz}`);
  const manifesto = new Projeto(raiz).manifesto(); // confere antes de fechar o que está aberto
  await fecharSessao();
  const nova = new SessaoProjeto(raiz, (arquivo) => {
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
  sessao = nova;
  try {
    midia.servir(raiz);
    regerarClaudeMd(raiz); // o Claude conhece os campos desta versão também nos projetos criados antes dela
    ide.preparar(raiz, nova.projeto); // frente IDE: os arquivos da IDE antes do primeiro commit do projeto novo
    nova.projeto.adicionarAjuste(somAcompanhaCenas); // frente Som: a narração presa às cenas (som-com-cenas.ts)
    apagarLimposSemUso(nova.projeto); // frente Som: as versões limpas da voz que nem documento nem diário citam (limpeza-voz.ts)
    aoAbrirMusica(nova.projeto); // frente Música: renders que faltam (pasta clonada) e os que sobraram (ipc-musica.ts)
    await nova.abrir();
    nova.publicarMcp(mcpHttp?.novaConexao(midia.origem, 'mcp', {ide: true})); // o MCP da IDE passa pelo app enquanto o projeto está aberto (mcp-app.ts)
  } catch (e) {
    await fecharSessao(); // nada de projeto meio aberto (mídia e MCP servindo, sem observador)
    throw e;
  }
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
  gravarPlano(destino, plano);
  const modulo = MODELOS.find((m) => m.id === o.modelo)?.modulo;
  if (o.formato_id && modulo === 'video') memoria.gravarPrefs({formato_video: o.formato_id});
  if (o.formato_id && modulo === 'imagem') memoria.gravarPrefs({formato_imagem: o.formato_id});
  return abrirProjeto(destino);
};

const tituloDoDocumento = (p: Projeto, id: string) => p.manifesto().documentos.find((d) => d.id === id)?.titulo ?? id;

const criarJanela = () => {
  janela = new BrowserWindow({
    width: 1600,
    height: 950,
    minWidth: 1100,
    minHeight: 640,
    show: false,
    // barra de título própria (a casca desenha nome, áreas e ações); os botões da janela continuam os do sistema (no Mac,
    // os semáforos à esquerda), menos nos gerenciadores em mosaico (Hyprland/Omarchy, Sway…), que não têm moldura nem
    // minimizar (plataforma.ts)
    ...opcoesDaBarra(process.platform, MOSAICO),
    backgroundColor: '#0f0f0f',
    title: 'Estúdio',
    autoHideMenuBar: true,
    webPreferences: {contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, 'preload.js')},
  });
  janela.webContents.setWindowOpenHandler(({url}) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return {action: 'deny'};
  });
  // a janela só mostra o app: um arquivo solto nela (o Chromium navega para file://…) ou um link sem target não trocam a
  // página, que levaria junto o preload com window.estudio. A própria página passa (location.reload, recarga do Vite).
  janela.webContents.on('will-navigate', (e, url) => {
    if (paginaDoApp(url)) return;
    e.preventDefault();
    if (url.startsWith('https://')) void shell.openExternal(url);
  });
  // câmera, localização, notificações etc.: a tela só usa o microfone (gravação da narração), a área de transferência e a
  // tela cheia da prévia
  // tela cheia da prévia. No Mac o microfone ainda passa pelo pedido do sistema (Ajustes › Privacidade › Microfone, plataforma.ts)
  janela.webContents.session.setPermissionRequestHandler((wc, permissao, ok, d) => {
    const detalhes: {mediaTypes?: string[]} = 'mediaTypes' in d ? d : {};
    if (!(wc === janela?.webContents && paginaDoApp(d.requestingUrl) && permissaoLiberada(permissao, detalhes))) return ok(false);
    if (decidirPermissao(process.platform, permissao, detalhes.mediaTypes ?? []) === 'permitir') return ok(true);
    if (systemPreferences.getMediaAccessStatus('microphone') === 'granted') return ok(true);
    systemPreferences.askForMediaAccess('microphone').then(ok, () => ok(false));
  });
  // recarregar a página (Ctrl+R) ou perder o renderer faz a interface esquecer as abas: fecha os terminais para não
  // sobrar claude órfão gastando memória por trás
  const largarTerminais = () => {
    terminais.fecharTodos();
    conversas.fecharTodas();
    mcpHttp?.esquecerTudo();
    // o esquecerTudo revoga também o token do MCP da IDE, que não é aba da tela (e o did-navigate do primeiro
    // carregamento pode vir depois de o projeto inicial abrir): ele segue passando pelo app com um token novo
    sessao?.publicarMcp(mcpHttp?.novaConexao(midia.origem, 'mcp', {ide: true}));
  };
  // did-navigate (a página nova entrou) e não did-start-navigation: este vem ANTES do will-navigate, e um arquivo solto na
  // janela, mesmo barrado lá, derrubaria todas as conversas
  janela.webContents.on('did-navigate', () => largarTerminais());
  // o <title> da página não passa por cima do nome do projeto (o projeto pode abrir antes de a página carregar)
  janela.on('page-title-updated', (e) => e.preventDefault());
  // frente Casca (transversal-D6): o renderer que cai (falta de memória no perfil leve) recarrega a janela em vez de ficar
  // branca; o projeto segue aberto aqui e a tela o relê. Depois de quedas em laço, avisa em vez de recarregar de novo.
  let recargas: number[] = [];
  janela.webContents.on('render-process-gone', (_e, detalhes) => {
    largarTerminais();
    const decisao = decidirRecarga(detalhes.reason, recargas, Date.now());
    recargas = decisao.recargas;
    if (decisao.recarregar) janela?.webContents.reload();
    else if (decisao.motivo === 'cai_em_laco' && janela && !janela.isDestroyed()) {
      void dialog.showMessageBox(janela, {type: 'error', title: 'Estúdio', message: avisoDeQuedaEmLaco(detalhes.reason)});
    }
  });
  // ao fechar com um projeto aberto, a miniatura sai antes (meio segundo no máximo)
  let fechando = false;
  janela.on('close', (e) => {
    if (fechando || !sessao) return;
    e.preventDefault();
    fechando = true;
    void guardarMiniatura().catch(() => undefined).finally(() => janela?.close());
  });
  janela.once('ready-to-show', () => janela?.show());
  janela.once('closed', () => (janela = null));
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
  return r.canceled || !r.filePaths[0] ? null : emFila(() => abrirProjeto(r.filePaths[0]));
});
// o exemplo sempre em cópia nova: editar não estraga o "ver um pronto" da próxima vez
lidar(CANAL.temExemplo, () => temExemplo());
lidar(CANAL.abrirExemplo, () => emFila(() => {
  if (!temExemplo()) throw new Error('Esta instalação não traz um projeto de exemplo.');
  const destino = pastaLivre(memoria.prefs().pasta_projetos, EXEMPLO.nome);
  gravarPlano(destino, planoDoExemplo(EXEMPLO.nome), pastaDoExemplo());
  return abrirProjeto(destino);
}));
lidar(CANAL.abrirProjeto, (raiz: string) => emFila(() => abrirProjeto(raiz)));
lidar(CANAL.projetoAtual, () => info());
lidar(CANAL.criarProjeto, (o: NovoProjeto) => emFila(() => criarProjeto(o)));
lidar(CANAL.fecharProjeto, () => emFila(() => fecharSessao()));
lidar(CANAL.duplicarProjeto, (o: {raiz?: string; nome: string}) => emFila(async () => {
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
}));
lidar(CANAL.renomearProjeto, (nome: string) => {
  const m = exigirProjeto().renomear(nome);
  memoria.lembrar(sessao!.projeto.raiz, m.nome);
  tituloDaJanela(m.nome);
  return m;
});
lidar(CANAL.criarDocumento, (o: {modulo: Modulo; formato?: Formato | {largura: number; altura: number}; titulo?: string}) => {
  const p = exigirProjeto();
  const {entrada, conteudo} = documentoNovo(p.manifesto(), o.modulo, {formato: o.formato, titulo: o.titulo, existe: (rel) => p.existe(rel)});
  return p.adicionarDocumento(entrada, conteudo);
});
lidar(CANAL.renomearDocumento, (id: string, titulo: string) => exigirProjeto().renomearDocumento(id, titulo));
lidar(CANAL.ambiente, async () => ({perfil: PERFIL, git: await gitInstalado, claude, versao: app.getVersion(), pasta_padrao: path.join(app.getPath('home'), 'Estudio')}));
lidar(CANAL.recentes, () => memoria.recentes());
lidar(CANAL.esquecerRecente, (raiz: string) => memoria.esquecer(raiz));
lidar(CANAL.preferencias, () => memoria.prefs());
lidar(CANAL.gravarPreferencias, (p: Partial<Preferencias>) => {
  const r = memoria.gravarPrefs(p);
  if (p.projetos_ide === true && sessao) ide.preparar(sessao.projeto.raiz, sessao.projeto); // frente IDE: ligar vale já para o projeto aberto
  return r;
});
lidar(CANAL.ideEstado, () => ide.estado(sessao?.projeto.raiz)); // frente IDE
lidar(CANAL.ideAbrirNoT3, () => {
  const p = exigirProjeto();
  return ide.abrirNoT3(p.raiz, p.manifesto().nome);
});
lidar(CANAL.escolherPasta, async (titulo?: string) => {
  const r = await dialog.showOpenDialog(janela!, {properties: ['openDirectory', 'createDirectory'], title: titulo ?? 'Escolher pasta'});
  return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
});
lidar(CANAL.marcarVersao, async () => {
  exigirProjeto();
  const ok = await sessao!.marcarVersao();
  if (ok) return {ok, mensagem: 'Ponto de restauração criado'};
  return {ok, mensagem: sessao?.temGit ? 'O Git não conseguiu criar o ponto de restauração agora; o histórico continua no diário'
    : 'Sem o Git instalado não há pontos de restauração; o histórico continua no diário'};
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
  p.caminhoParaGravar(path.relative(p.raiz, destino)); // midia/ ligada para fora por link: só leitura, não copia para lá
  mkdirSync(path.dirname(destino), {recursive: true});
  copyFileSync(arq, destino);
  return path.relative(p.raiz, destino).split(path.sep).join('/');
});
lidar(CANAL.lerDocumento, (documento: string) => {
  const p = exigirProjeto();
  return p.lerJson(p.arquivoDoDocumento(documento));
});
// opcional (transições, seleção pedida pela IA): ausente, ou sem projeto aberto, é null e não um erro no log a cada abertura
lidar(CANAL.lerJson, (caminho: string, o?: {opcional?: boolean}) => lerJsonDaTela(sessao?.projeto ?? null, caminho, o));
lidar(CANAL.aplicarPatch, (o: {documento: string; versao_base?: string; patch: OperacaoPatch[]; rotulo?: string}) => {
  const r = exigirProjeto().aplicarPatch({...o, autor: 'pessoa', origem: 'interface'});
  return {versao: r.versao, seq: r.entrada.seq};
});
// frente IA (transversal-D1): o desfazer sai do diário (projeto.ts): lembra o que já foi desfeito mesmo depois de reabrir,
// e uma entrada que a IA mudou depois não trava as seguintes; o Histórico tem o Reverter de cada entrada
lidar(CANAL.desfazer, () => {
  const r = exigirProjeto().desfazerUltima({autor: 'pessoa', origem: 'interface', como: {autor: 'pessoa', origem: 'desfazer'}});
  if (r.ok) return {ok: true, mensagem: `desfeito: ${r.alvo.rotulo}`};
  return {ok: false, mensagem: 'mudou_depois' in r && r.mudou_depois ? `${r.mensagem}; reverta pelo Histórico` : r.mensagem};
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
// frente IA (transversal-D2); auditoria N7: o fim do diário pelo índice leve, sem os patches (Projeto.resumoDoDiario)
lidar(CANAL.diario, (desde?: number) => exigirProjeto().resumoDoDiario(desde ?? 0));
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
    arquivoMcp: o.tipo === 'claude' ? mcpHttp!.novaAba(midia.origem, conversas.novoRotulo('claude')) : undefined}));
lidar(CANAL.conversaConta, () => contaClaude(terminais.caminhoClaude));
lidar(CANAL.conversaAbrir, (o: {sessao?: string; provedor?: string; modelo?: string}) =>
  conversas.abrir({cwd: exigirProjeto().raiz, sessao: o.sessao, provedor: o.provedor, modelo: o.modelo, retomar: retomadaDe(exigirProjeto(), o.sessao)}));
lidar(CANAL.conversaEnviar, (id: number, texto: string) => conversas.enviar(id, texto, PERFIL.sessoes_claude));
lidar(CANAL.conversaHibernar, (id: number) => conversas.hibernar(id));
// ---------- exportação: um ou mais arquivos em saidas/, com andamento na interface e na barra de tarefas, e Cancelar ----------
// Sem opções (chamada antiga), sai o MP4 H.264 no formato do documento. Com elas, um arquivo por destino: o vídeo de cenas
// é relativo ao quadro, então basta trocar largura e altura nas props; o carrossel narrado é fixo em 1080×1920 e só
// aceita escala. O diálogo mostra os arquivos e "Mostrar na pasta" ao fim, então a pasta não abre sozinha.
let cancelarExportacao: (() => void) | null = null;
lidar(CANAL.exportar, async (documento: string, opcoes?: OpcoesExportarVideo): Promise<ResultadoExportacao> => {
  const p = exigirProjeto();
  if (cancelarExportacao) return {ok: false, mensagem: 'já há uma exportação em andamento'};
  const montado = sessao!.propsVideo(documento, midia.base);
  if ('erro' in montado) return {ok: false, mensagem: montado.erro};
  const props = montado.props;
  const formato: Formato = {largura: Number(props.largura) || FORMATO_PADRAO.largura, altura: Number(props.altura) || FORMATO_PADRAO.altura, fps: Number(props.fps) || FORMATO_PADRAO.fps};
  // a animação, como o carrossel, tem tamanho fixo (camadas em pixels): o diálogo só oferece o tamanho dela e a escala vai no `scale` do render
  const fixo = props.composicao !== 'VideoCenas';
  const o: OpcoesExportarVideo = {codec: 'h264', qualidade: 'alta', escala: 1, ...opcoes, destinos: fixo || !opcoes?.destinos?.length ? [destinoDoFormato(formato)] : opcoes.destinos};
  const pasta = p.pastaDeSaidas(); // saidas/ por link para outro disco grava lá (a exceção, em Projeto.pastaDeSaidas)
  mkdirSync(pasta, {recursive: true});
  const planos = nomesDosArquivos(o.nome?.trim() || tituloDoDocumento(p, documento), o.destinos, formato);
  const comAudio = fixo || Boolean(['audio', 'trilha', 'narracao', 'sons'].some((k) => (Array.isArray(props[k]) ? (props[k] as unknown[]).length > 0 : Boolean(props[k]))));
  const {makeCancelSignal} = await import('@remotion/renderer');
  const {cancelSignal, cancel} = makeCancelSignal();
  cancelarExportacao = cancel;
  const arquivos: string[] = [];
  const avisos: string[] = [];
  let parcial: string | undefined;
  // o andamento de cada arquivo vai à interface com o nome dele; a barra de tarefas mostra o andamento geral
  const avisoDe = (indice: number, arquivo: string) => (x: Progresso) => {
    enviar(CANAL.progresso, {...x, arquivo, indice: indice + 1, total: planos.length});
    if (x.tipo === 'progresso' && x.progresso !== undefined) janela?.setProgressBar((indice + x.progresso / 100) / planos.length);
  };
  const fontesMarca = fontesDaMarcaDagua(props);
  let preparado: Preparado | null = null;
  try {
    // dentro do try: a trava de "já há uma exportação" já vale, e a mensagem chega como as outras falhas
    const semEspaco = await faltaEspaco(pasta, estimarExportacao(o, formato, Number(props.duracao_ms) || 0, comAudio).porDestino.map((d) => d.bytes), comAudio);
    if (semEspaco) throw new Error(semEspaco);
    const pronto = await prepararRender({raizApp: app.getAppPath(), empacotado: app.isPackaged, aviso: avisoDe(0, '')});
    preparado = pronto;
    for (const [i, plano] of planos.entries()) {
      const args = argumentosDoRender(o, plano.destino, formato, Number(props.duracao_ms) || 0);
      const destino = arquivoLivre(pasta, plano.nome, args.ext);
      parcial = destino;
      // legendas na área segura e na quebra do destino, não do documento (frente Fala; a área fica em legendas_cenas.area)
      // queimar, só o SRT ou os dois, por destino (frente Fala); no 16:9 com o SRT junto, acima das legendas do YouTube
      const planoLeg = planoDasLegendas(o.legendas?.[plano.destino.id], args);
      const legendas = !fixo && props.legendas_cenas ? legendasNoDestino(props.legendas_cenas as LegendasP, args.largura, args.altura, formato,
        {legendas_youtube: planoLeg.legendas_youtube}) : undefined;
      const propsDestino = {...(fixo ? props : {...props, largura: args.largura, altura: args.altura}),
        ...(legendas ? {legendas_cenas: planoLeg.queimar ? legendas : {...legendas, oculto: true}} : {})};
      // marca d'água do destino, se ligada: posicionada no tamanho do destino, em frações (vale com qualquer escala), fora
      // da legenda que vai neste render (a das props do destino, já recalculada acima)
      const marca = marcaDaguaDoDestino(o.marca_dagua?.[plano.destino.id], plano.destino, fontesMarca, o.proporcao_logo, legendasDasProps(propsDestino), o.proporcao_texto);
      await renderizarVideo(pronto, {
        props: {...propsDestino, ...(marca ? {marca_dagua: marca} : {})},
        arquivo: destino, codec: args.codec, videoBitrate: args.videoBitrate, escala: fixo ? args.escala : 1, quadros: args.frameRange, cancelSignal, avisos,
      }, avisoDe(i, path.basename(destino)));
      arquivos.push(destino);
      parcial = undefined;
      // o SRT ao lado do vídeo, com o mesmo nome (e o .pt_BR.srt do Facebook e o .vtt), sem gravar por cima (frente Fala)
      if (planoLeg.srt && legendas && !legendas.oculto) {
        for (const a of arquivosDeLegendaDoVideo(path.basename(destino, `.${args.ext}`), legendas.segmentos, args.frameRange ? o.trecho : null, (n) => existsSync(path.join(pasta, n)))) {
          writeFileSync(path.join(pasta, a.nome), a.texto, 'utf-8');
          arquivos.push(path.join(pasta, a.nome));
        }
      }
    }
    enviar(CANAL.progresso, {tipo: 'status', mensagem: `Exportado: ${arquivos.map((a) => path.relative(p.raiz, a)).join(', ')}${avisos.length ? `. Atenção: ${avisos.join('; ')}` : ''}`});
    return {ok: true, arquivo: arquivos[0], arquivos, pasta, ...(avisos.length ? {avisos} : {})};
  } catch (e) {
    const mensagem = discoCheio((e as Error).message) ? 'o disco encheu durante a exportação; libere espaço e tente de novo' : (e as Error).message;
    const cancelado = /cancel/i.test(mensagem);
    if (parcial) rmSync(parcial, {force: true}); // o arquivo pela metade não fica em saidas/
    enviar(CANAL.progresso, {tipo: 'status', mensagem: cancelado ? 'Exportação cancelada' : `Falhou: ${mensagem}`});
    return {ok: false, cancelado, mensagem: cancelado ? 'Exportação cancelada' : mensagem, arquivos, pasta, ...(avisos.length ? {avisos} : {})};
  } finally {
    await encerrarRender(preparado); // o Chrome que serviu a todos os destinos
    cancelarExportacao = null;
    janela?.setProgressBar(-1);
  }
});
// a interface manda a imagem já desenhada (PNG, JPG ou WebP em data URL); aqui só grava com o nome livre em saidas/
lidar(CANAL.exportarImagem, (documento: string, dados: string, opcoes?: OpcoesExportarImagem) => {
  const p = exigirProjeto();
  const pasta = p.pastaDeSaidas(); // saidas/ por link para outro disco grava lá (a exceção, em Projeto.pastaDeSaidas)
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
registrarIpcGravacao(lidar, exigirProjeto); // frente Som (rodada 3): salvar a narração gravada
definirPastaTrilhas(() => memoria.prefs().pasta_trilhas); // frente Som (rodada 3): o MCP lê a pasta de trilhas das preferências
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
  if (!alvo || !existsSync(alvo)) return;
  // openPath abre com o programa padrão, e no Windows isso executa .exe/.bat/.lnk: arquivo só é mostrado na pasta
  if (statSync(alvo).isDirectory()) void shell.openPath(alvo);
  else shell.showItemInFolder(alvo);
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
const marcas = registrarIpcMarcas({lidar, janela: () => janela, memoria, midia, exigirProjeto});

registrarPrefsExportacao(lidar, exigirProjeto); // marca d'água por destino, lembrada no projeto (frente C)
registrarContrasteMarca(lidar, exigirProjeto, (documento) => (exigirProjeto(), sessao!.propsVideo(documento, midia.base)), (aviso) => prepararRender({raizApp: app.getAppPath(), empacotado: app.isPackaged, aviso})); // contraste 3:1 da marca (frente C)
// frente IDE: ver_quadro, ver_cenas e ver_trecho pelo MCP do app, com o render da exportação e a mídia do servidor local
definirServicoPrevia(criarServicoPrevia({preparar: (aviso) => prepararRender({raizApp: app.getAppPath(), empacotado: app.isPackaged, aviso}), comMidia: (_raiz, f) => f(midia.base)}));
// frente Som (rodada 2): limpeza de voz (limpeza-voz.ts) e medidor de loudness da mistura (loudness.ts)
registrarIpcLimpeza(lidar, exigirProjeto, enviar);
registrarIpcLoudness(lidar, exigirProjeto, (documento) => (exigirProjeto(), sessao!.propsVideo(documento, midia.base)));
registrarIpcMidia(lidar, exigirProjeto); // frente Casca: painel de mídia (lista de midia/ e marcas das tomadas)
// frente IA: Configurações › IA (provedores, chaves cifradas pelo safeStorage em userData/ia, modelos, uso do mês)
registrarIpcIa({lidar, claudeInstalado: () => claude, pasta: path.join(app.getPath('userData'), 'ia'), conversas: () => conversas,
  enviar, ouvir: (canal, f) => ipcMain.on(canal, (e, ...a) => (confiavel(e), f(...a))), projeto: exigirProjeto,
  mcp: () => mcpHttp, ponte: () => ({exe: process.execPath, script: recursos(path.join('dist-mcp', 'ponte.cjs'))}),
  cifra: {disponivel: () => safeStorage.isEncryptionAvailable(), cifrar: (t) => safeStorage.encryptString(t), decifrar: (b) => safeStorage.decryptString(b),
    loja: () => (process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : undefined)},
  canais: {provedores: CANAL.iaProvedores, gravarChave: CANAL.iaGravarChave, apagarChave: CANAL.iaApagarChave, modelos: CANAL.iaModelos,
    configurar: CANAL.iaConfigurar, padrao: CANAL.iaPadrao, usoDoMes: CANAL.iaUsoDoMes, conversaModelo: CANAL.conversaModelo,
    portaoPedido: CANAL.iaPortaoPedido, portaoResposta: CANAL.iaPortaoResposta, portaoCancelado: CANAL.iaPortaoCancelado, reverter: CANAL.iaReverter,
    apps: CANAL.iaApps, appsLigar: CANAL.iaAppsLigar, appsNovo: CANAL.iaAppsNovo, appsConfigs: CANAL.iaAppsConfigs, appsRevogar: CANAL.iaAppsRevogar,
    guardar: CANAL.iaGuardar, guardadas: CANAL.iaGuardadas, apagarGuardada: CANAL.iaApagarGuardada}});
// narração por IA (docs/narracao.md): Gemini TTS e Google Cloud TTS com a chave do cofre (depois do registrarIpcIa, que monta o cofre)
registrarIpcNarracao({lidar, enviar, projeto: exigirProjeto, pasta: path.join(app.getPath('userData'), 'ia'), buscar: (u, i) => net.fetch(String(u), i),
  ouvir: (canal, f) => ipcMain.on(canal, (e, ...a) => (confiavel(e), f(...a))),
  canais: {estado: CANAL.narracaoEstado, gravarChave: CANAL.narracaoGravarChave, apagarChave: CANAL.narracaoApagarChave, vozes: CANAL.narracaoVozes,
    previa: CANAL.narracaoPrevia, gerar: CANAL.narracaoGerar, cancelar: CANAL.narracaoCancelar, andamento: CANAL.narracaoAndamento, amostra: CANAL.narracaoAmostra}});
// frente Música: ida e volta com o vídeo e o render ligado, feito no Web Worker da janela pela ponte com a janela
registrarIpcMusica(lidar, exigirProjeto, criarPonteJanela({enviar, temJanela: () => Boolean(janela && !janela.isDestroyed()),
  ouvir: (canal, f) => ipcMain.on(canal, (e, ...a) => (confiavel(e), f(...(a as never[]))))}));

// ---------- abrir uma pasta de projeto vinda de fora (argumento, segunda abertura, ícone do Dock) ----------
let pastaDeFora: string | null = null;
function abrirDeFora(pasta: string) {
  if (!janela) {
    pastaDeFora = pasta; // o app ainda está abrindo: vale como o projeto inicial
    return;
  }
  // a tela pode estar no início (sem projeto): recarregar faz ela abrir o projeto, como na partida; terminais e conversas
  // do projeto anterior já foram fechados pelo abrirProjeto
  emFila(() => abrirProjeto(pasta)).then(() => janela?.webContents.reload(), (e: Error) => {
    if (janela && !janela.isDestroyed()) void dialog.showMessageBox(janela, {type: 'warning', title: 'Estúdio', message: e.message});
  });
}
// Mac: pasta solta no ícone do Dock ou "Abrir com" (Info.plist, build/mac.ts). Chega antes do ready quando é ela que abre o app.
app.on('open-file', (e, caminho) => {
  e.preventDefault();
  if (existsSync(path.join(caminho, 'estudio.json'))) abrirDeFora(caminho);
});

app.on('ready', async () => {
  if (!primeiraInstancia) return; // a segunda instância já pediu para sair (garantirInstanciaUnica)
  // Mac: barra de menu do sistema com Editar (copiar e colar nos campos) e sem Recarregar (menu-do-app.ts)
  if (process.platform === 'darwin') {
    app.setAboutPanelOptions({applicationName: 'Estúdio', applicationVersion: app.getVersion(), copyright: 'BKM Advogados'});
    Menu.setApplicationMenu(Menu.buildFromTemplate(modeloDoMenuDoMac({desenvolvimento: !app.isPackaged})));
  }
  await midia.iniciar();
  // a rede do ler_fonte no app: net.fetch do Electron (proxy e certificados do sistema), assíncrono, 40 s e 20 MB no máximo
  mcpHttp = new McpHttp(path.join(app.getPath('userData'), 'mcp'), () => sessao?.projeto ?? null, criarRede((url, init) => net.fetch(url, init)),
    perguntarAPessoa); // frente IA: o portão de permissão pergunta à pessoa pela tela
  await iniciarAppsDeFora(); // frente IA: apps de IA de fora (tokens de volta ao MCP e, se ligada, a porta fixa)
  midia.rota((req, res) => mcpHttp!.atender(req, res));
  claude = await terminais.preparar();
  criarJanela();
  // a pasta pedida de fora (variável, argumento, ícone do Dock) vem antes do "abrir o último" das preferências
  const deFora = process.env.ESTUDIO_PROJETO ? path.resolve(process.env.ESTUDIO_PROJETO) : (pastaDeFora ?? projetoNosArgumentos(process.argv, existsSync));
  const inicial = deFora ?? (memoria.prefs().ao_iniciar === 'ultimo' ? memoria.ultimo() : null);
  if (inicial) await emFila(() => abrirProjeto(inicial)).catch(() => undefined);
});

app.on('window-all-closed', async () => {
  terminais.fecharTodos();
  conversas.fecharTodas({agora: true}); // sem os 1,5 s: o processo principal sairia antes e o agente ficaria órfão
  mcpHttp?.esquecerTudo();
  // o commit da última edição (relógio de 8 s) antes de sair, com teto para nunca prender o fechamento
  await Promise.race([Promise.allSettled([fecharAppsDeFora(), sessao?.fechar()]), new Promise((ok) => setTimeout(ok, 5000))]);
  midia.parar();
  app.quit();
});

// frente Fala: transcrição local e legendas (ipc-fala.ts); o mesmo transcritor atende a ferramenta transcrever do MCP
registrarIpcFala({lidar, confiavel, janela: () => janela, projeto: exigirProjeto, enviar, raizApp: app.getAppPath(), empacotado: app.isPackaged, buscar: (u, i) => net.fetch(u, i)});
