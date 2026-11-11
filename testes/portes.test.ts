// Portes para Windows e Mac (docs/portes.md): as decisões por sistema, conferidas aqui nos três sistemas com a
// plataforma injetada. O que só uma máquina real confirma (a janela, o pedido de microfone, a assinatura) fica na lista
// de verificação do documento.
import {existsSync, readdirSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {caminhoDeBusca, comPath, decidirPermissao, ehMosaico, gitDoMac, nomeDoShell, opcoesDaBarra, pastasExtrasDoPath, projetoNosArgumentos,
  shellPadrao} from '../src/main/plataforma';
import {comando, comModificador, rotuloDoAtalho, teclaDeApagar} from '../src/renderer/teclas';
import {acaoDeArquivo} from '../src/renderer/casca/atalhos';
import {ehNomeReservado, nomeDeArquivo} from '../src/nucleo/nome-de-arquivo';
import {nomeDePasta} from '../src/nucleo/criar-projeto';
import {nomeDoArquivoDeLegenda} from '../src/nucleo/legendas';
import {nomeDeSaida} from '../src/main/musica-render';
import {acharWhisperCli, comoInstalarWhisper, whisperEmbutido} from '../src/main/transcricao';
import {avisoDoMicrofone, ehRecusaDoMicrofone, sistemaDoNavegador} from '../src/compartilhado/microfone';
import {modeloDoMenuDoMac} from '../src/main/menu-do-app';
import {assinaturaDoMac, ehBinarioFilho, ENTITLEMENTS_APP, ENTITLEMENTS_FILHOS, entitlementsDoArquivo, INFO_PLIST, notarizacaoDoMac,
  opcoesDoMac} from '../build/mac';
import {entraNoPacote, plataformaDoNavegador} from '../src/main/navegador-alvo';
import {getPackagedBrowserPaths} from '../src/main/packaged-browser';
import {getCompositorPackage} from '../src/nucleo/compositor-package';
import {garantirInstanciaUnica} from '../src/main/janela-segura';
import {ambienteDoFfmpeg, executavelDoFfmpeg, opcoesDoFfmpeg} from '../src/nucleo/ffmpeg-ambiente';

const tem = (...arquivos: string[]) => (a: string) => arquivos.includes(a);

describe('janela por sistema', () => {
  it('mosaico só no Linux com Hyprland, Sway, i3...', () => {
    expect(ehMosaico('linux', {HYPRLAND_INSTANCE_SIGNATURE: 'x'})).toBe(true);
    expect(ehMosaico('linux', {XDG_CURRENT_DESKTOP: 'sway'})).toBe(true);
    expect(ehMosaico('linux', {XDG_CURRENT_DESKTOP: 'GNOME'})).toBe(false);
    expect(ehMosaico('darwin', {HYPRLAND_INSTANCE_SIGNATURE: 'x'})).toBe(false);
    expect(ehMosaico('win32', {XDG_CURRENT_DESKTOP: 'sway'})).toBe(false);
  });

  it('Windows e Linux: botões à direita sobre a barra; mosaico sem botões; Mac: semáforos à esquerda pela WCO', () => {
    expect(opcoesDaBarra('win32', false)).toEqual({titleBarStyle: 'hidden', titleBarOverlay: {color: '#0f0f0f', symbolColor: '#b4b4b4', height: 36}});
    expect(opcoesDaBarra('linux', false)).toHaveProperty('titleBarOverlay');
    expect(opcoesDaBarra('linux', true)).toEqual({titleBarStyle: 'hidden'});
    const mac = opcoesDaBarra('darwin', false);
    expect(mac).toMatchObject({titleBarStyle: 'hidden', titleBarOverlay: true});
    expect(mac.trafficLightPosition?.y).toBe(11); // (36 − 14) / 2: no meio da barra
  });

  it('a casca contorna os semáforos pela env(titlebar-area-x)', () => {
    const css = readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'casca', 'casca.css'), 'utf-8');
    expect(css).toMatch(/padding-left: calc\(env\(titlebar-area-x, 0px\) \+ 10px\)/);
    expect(readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'inicio', 'inicio.css'), 'utf-8')).toMatch(/env\(titlebar-area-x, 0px\)/);
  });
});

describe('PATH e shell', () => {
  it('Mac: o PATH curto do Finder ganha ~/.local/bin, o Homebrew e o npm global, sem repetir', () => {
    const p = caminhoDeBusca({plataforma: 'darwin', PATH: '/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin', home: '/Users/ana'});
    const lista = p.split(':');
    expect(lista.slice(0, 4)).toEqual(['/usr/bin', '/bin', '/usr/sbin', '/sbin']);
    expect(lista).toContain('/Users/ana/.local/bin');
    expect(lista).toContain('/usr/local/bin');
    expect(lista.filter((d) => d === '/opt/homebrew/bin')).toHaveLength(1);
  });

  it('Windows: ; como separador, %USERPROFILE%\\.local\\bin e %APPDATA%\\npm, repetição sem olhar maiúsculas', () => {
    const p = caminhoDeBusca({plataforma: 'win32', PATH: 'C:\\Windows\\system32;c:\\users\\ana\\.local\\bin', home: 'C:\\Users\\Ana',
      env: {APPDATA: 'C:\\Users\\Ana\\AppData\\Roaming'}});
    expect(p.split(';')).toEqual(['C:\\Windows\\system32', 'c:\\users\\ana\\.local\\bin', 'C:\\Users\\Ana\\AppData\\Roaming\\npm']);
    expect(pastasExtrasDoPath('linux', '/home/ana')).toEqual(['/home/ana/.local/bin', '/home/ana/.claude/local']);
  });

  it('Windows: o PATH novo substitui o "Path" do sistema em vez de ficar ao lado dele', () => {
    const env = comPath({Path: 'C:\\velho', TEMP: 'C:\\t', path: 'x'}, 'C:\\novo', 'win32');
    expect(env).toEqual({TEMP: 'C:\\t', PATH: 'C:\\novo'});
    // fora do Windows as chaves diferem por maiúscula: só o PATH é trocado
    expect(comPath({PATH: '/a', Path: 'b'}, '/novo', 'linux')).toEqual({Path: 'b', PATH: '/novo'});
  });

  it('shell: PowerShell no Windows; o da pessoa (zsh) no Mac; /bin/sh no Linux sem SHELL nem conta', () => {
    expect(shellPadrao('win32', {SHELL: '/bin/bash'})).toEqual({arquivo: 'powershell.exe', args: ['-NoLogo']});
    expect(shellPadrao('darwin', {}, '/bin/zsh')).toEqual({arquivo: '/bin/zsh', args: ['-l']});
    expect(shellPadrao('darwin', {}, null).arquivo).toBe('/bin/zsh');
    expect(shellPadrao('darwin', {SHELL: '/opt/homebrew/bin/fish'}, '/bin/zsh').arquivo).toBe('/opt/homebrew/bin/fish');
    expect(shellPadrao('linux', {}).arquivo).toBe('/bin/sh');
    expect(nomeDoShell('win32', 'powershell.exe')).toBe('PowerShell');
    expect(nomeDoShell('darwin', '/bin/zsh')).toBe('zsh');
  });

  it('Mac: o git só é chamado quando existe de verdade (sem as ferramentas do Xcode, /usr/bin/git abre o instalador)', () => {
    expect(gitDoMac(tem(), false)).toBeNull();
    expect(gitDoMac(tem(), true)).toBe('/usr/bin/git');
    expect(gitDoMac(tem('/opt/homebrew/bin/git'), false)).toBe('/opt/homebrew/bin/git');
    expect(gitDoMac(tem('/usr/local/bin/git'), false)).toBe('/usr/local/bin/git');
  });
});

describe('abrir projeto vindo de fora', () => {
  it('a primeira pasta com estudio.json nos argumentos; opções e o caminho do app ficam de fora', () => {
    const alvo = path.resolve('/p/Video', 'estudio.json');
    const existe = (a: string) => path.resolve(a) === alvo; // no Windows o path.resolve põe a letra do disco
    expect(projetoNosArgumentos(['/app/Estudio', '--allow-file-access', '-psn_0_123', '/p/Video'], existe)).toBe('/p/Video');
    expect(projetoNosArgumentos(['electron', '.'], existe)).toBeNull();
    expect(projetoNosArgumentos(['/app/Estudio', 'Video'], existe, '/p')).toBe(path.resolve('/p', 'Video'));
    expect(projetoNosArgumentos([], existe)).toBeNull();
  });

  it('a segunda abertura entrega argv e pasta à primeira', () => {
    const eventos: Record<string, (...a: unknown[]) => void> = {};
    const app = {requestSingleInstanceLock: () => true, quit: () => undefined, on: (e: string, f: (...a: unknown[]) => void) => (eventos[e] = f)};
    const recebidos: [string[], string][] = [];
    garantirInstanciaUnica(app as never, (argv, cwd) => recebidos.push([argv, cwd]));
    eventos['second-instance']({}, ['Estudio.exe', 'C:\\p\\Video'], 'C:\\p');
    eventos['second-instance']();
    expect(recebidos).toEqual([[['Estudio.exe', 'C:\\p\\Video'], 'C:\\p'], [[], '']]);
  });
});

describe('microfone', () => {
  it('no Mac o pedido de áudio passa pelo sistema; o resto segue liberado', () => {
    expect(decidirPermissao('darwin', 'media', ['audio'])).toBe('perguntar_ao_mac');
    expect(decidirPermissao('darwin', 'media', ['video'])).toBe('permitir');
    expect(decidirPermissao('darwin', 'clipboard-read')).toBe('permitir');
    expect(decidirPermissao('win32', 'media', ['audio'])).toBe('permitir');
    expect(decidirPermissao('linux', 'media', ['audio'])).toBe('permitir');
  });

  it('recusa vira o caminho para liberar em cada sistema', () => {
    expect(sistemaDoNavegador('MacIntel')).toBe('darwin');
    expect(sistemaDoNavegador('Win32')).toBe('win32');
    expect(sistemaDoNavegador('Linux x86_64')).toBe('linux');
    expect(ehRecusaDoMicrofone(Object.assign(new Error('x'), {name: 'NotAllowedError'}))).toBe(true);
    expect(ehRecusaDoMicrofone(Object.assign(new Error('x'), {name: 'NotFoundError'}))).toBe(false);
    expect(avisoDoMicrofone('darwin')).toMatch(/Privacidade e Segurança › Microfone/);
    expect(avisoDoMicrofone('win32')).toMatch(/aplicativos da área de trabalho/);
  });

  it('o Info.plist do Mac traz o texto do pedido de microfone e aceita pasta arrastada no ícone', () => {
    expect(INFO_PLIST.NSMicrophoneUsageDescription).toMatch(/microfone/);
    expect(INFO_PLIST.CFBundleDocumentTypes[0].LSItemContentTypes).toEqual(['public.folder']);
    expect(opcoesDoMac()).toMatchObject({appBundleId: 'br.com.bkmadvogados.estudio', appCategoryType: 'public.app-category.video'});
  });
});

describe('atalhos: Ctrl no Windows e no Linux, Cmd no Mac', () => {
  const t = (o: Partial<{key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean}>) =>
    ({key: 'n', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...o});

  it('o modificador de comando', () => {
    expect(comando(t({ctrlKey: true}), false)).toBe(true);
    expect(comando(t({metaKey: true}), false)).toBe(false);
    expect(comando(t({metaKey: true}), true)).toBe(true);
    expect(comando(t({ctrlKey: true}), true)).toBe(false); // no Mac o Ctrl é do terminal
    expect(comModificador(t({metaKey: true}))).toBe(true);
    expect(comModificador(t({}))).toBe(false);
  });

  it('Cmd+N, Cmd+O e Cmd+W no Mac; fora do terminal, como no Windows', () => {
    expect(acaoDeArquivo(t({key: 'w', metaKey: true}), false, true)).toBe('fechar');
    expect(acaoDeArquivo(t({key: 'w', ctrlKey: true}), false, true)).toBeNull();
    expect(acaoDeArquivo(t({key: 'o', ctrlKey: true}), false, false)).toBe('abrir');
    expect(acaoDeArquivo(t({key: 'w', metaKey: true}), true, true)).toBeNull();
  });

  it('a tecla "delete" do Mac (Backspace) apaga a seleção só no Mac', () => {
    expect(teclaDeApagar({key: 'Delete'}, false)).toBe(true);
    expect(teclaDeApagar({key: 'Backspace'}, false)).toBe(false);
    expect(teclaDeApagar({key: 'Backspace'}, true)).toBe(true);
  });

  it('rótulos no jeito do Mac', () => {
    expect(rotuloDoAtalho('Ctrl+N', true)).toBe('⌘N');
    expect(rotuloDoAtalho('Ctrl+Shift+E', true)).toBe('⇧⌘E');
    expect(rotuloDoAtalho('Alt+1', true)).toBe('⌥1');
    expect(rotuloDoAtalho('Delete', true)).toBe('⌫');
    expect(rotuloDoAtalho('Ctrl+Shift+E', false)).toBe('Ctrl+Shift+E');
  });
});

describe('menu do Mac', () => {
  const menu = modeloDoMenuDoMac({desenvolvimento: false});
  const papeis = menu.flatMap((m) => (Array.isArray(m.submenu) ? m.submenu.map((i) => i.role) : []));

  it('Editar com copiar e colar (sem ele, Cmd+C e Cmd+V não funcionam nos campos), Sobre e Sair', () => {
    for (const r of ['copy', 'paste', 'cut', 'selectAll', 'undo', 'redo', 'about', 'quit', 'hide', 'minimize']) expect(papeis).toContain(r);
  });

  it('sem Recarregar (derrubaria terminais e conversas) nem Fechar janela no Cmd+W; ferramentas só no desenvolvimento', () => {
    for (const r of ['reload', 'forceReload', 'close', 'toggleDevTools']) expect(papeis).not.toContain(r);
    const dev = modeloDoMenuDoMac({desenvolvimento: true}).flatMap((m) => (Array.isArray(m.submenu) ? m.submenu.map((i) => i.role) : []));
    expect(dev).toContain('toggleDevTools');
  });
});

describe('nomes de arquivo nos três sistemas', () => {
  it('nomes reservados do Windows, com e sem extensão', () => {
    for (const n of ['CON', 'nul', 'Com1', 'LPT9', 'nul.txt', 'CON.srt', 'aux.tar.gz', 'com¹', 'PRN. ']) expect(ehNomeReservado(n)).toBe(true);
    for (const n of ['console', 'nulo', 'CONTRATO.srt', 'com10', 'LPT']) expect(ehNomeReservado(n)).toBe(false);
  });

  it('proibidos, ponto no fim, tamanho e reservados', () => {
    expect(nomeDeArquivo('a<b>:c"d/e\\f|g?h*i')).toBe('a-b--c-d-e-f-g-h-i');
    expect(nomeDeArquivo('fim. . ')).toBe('fim');
    expect(nomeDeArquivo('x'.repeat(300))).toHaveLength(120);
    expect(nomeDeArquivo('NUL')).toBe('_NUL');
    expect(nomeDeArquivo('  ')).toBe('sem nome');
  });

  it('pasta do projeto, música e legendas não saem com nome que o Windows recusa', () => {
    expect(nomeDePasta('nul.x')).toBe('Projeto nul.x');
    expect(nomeDePasta('CON')).toBe('Projeto CON');
    expect(nomeDePasta('Vídeo: férias?')).toBe('Vídeoh férias-');
    expect(nomeDeSaida('CON')).toBe('_CON');
    expect(nomeDeSaida('Trilha: abertura.wav')).toBe('Trilha- abertura');
    expect(nomeDoArquivoDeLegenda('NUL', 'srt')).toBe('_NUL.srt');
    expect(nomeDoArquivoDeLegenda('Aula 1: CLT', 'vtt')).toBe('Aula 1 CLT.vtt');
  });
});

describe('whisper-cli no Mac', () => {
  it('acha o do Homebrew mesmo com o PATH curto do Finder', () => {
    expect(acharWhisperCli('/m', {plataforma: 'darwin', arq: 'arm64', PATH: '/usr/bin:/bin', home: '/Users/ana', existe: tem('/opt/homebrew/bin/whisper-cli')}))
      .toBe('/opt/homebrew/bin/whisper-cli');
    expect(acharWhisperCli('/m', {plataforma: 'darwin', arq: 'x64', PATH: '/usr/bin', home: '/Users/ana', existe: tem('/usr/local/bin/whisper-cli')}))
      .toBe('/usr/local/bin/whisper-cli');
  });

  it('o que vem no app vale antes do PATH; o da pasta do whisper (bin/) vale antes de tudo; no Windows x64 só o baixado', () => {
    const embutidos = whisperEmbutido({raizApp: '/Apps/Estudio.app/Contents/Resources/app.asar', plataforma: 'darwin'});
    expect(embutidos[0]).toBe(path.join('/Apps/Estudio.app/Contents/Resources', 'whisper', 'whisper-cli'));
    const o = {plataforma: 'darwin', arq: 'arm64', PATH: '/opt/homebrew/bin', home: '/Users/ana', embutidos};
    expect(acharWhisperCli('/m', {...o, existe: tem(embutidos[0], '/opt/homebrew/bin/whisper-cli')})).toBe(embutidos[0]);
    expect(acharWhisperCli('/m', {...o, existe: tem('/m/bin/whisper-cli', embutidos[0])})).toBe('/m/bin/whisper-cli');
    expect(acharWhisperCli('C:/m', {plataforma: 'win32', arq: 'x64', PATH: '', embutidos: ['C:/r/whisper/whisper-cli.exe'], existe: tem('C:/r/whisper/whisper-cli.exe')}))
      .toBeNull();
    expect(whisperEmbutido({})).toEqual([]);
  });

  it('sem whisper-cli no Mac, o aviso manda ao Homebrew; no Linux, a compilar', () => {
    expect(comoInstalarWhisper('/m', 'darwin')).toMatch(/brew install whisper-cpp/);
    expect(comoInstalarWhisper('/m', 'linux')).toMatch(/cmake/);
  });

  it('o ffmpeg do Remotion recebe a pasta das bibliotecas (no Mac elas vêm pelo nome curto)', () => {
    expect(ambienteDoFfmpeg('/b', {HOME: '/h'})).toEqual({HOME: '/h', LD_LIBRARY_PATH: '/b', DYLD_LIBRARY_PATH: '/b'});
    expect(opcoesDoFfmpeg('/b')).toMatchObject({cwd: '/b', windowsHide: true, env: {LD_LIBRARY_PATH: '/b', DYLD_LIBRARY_PATH: '/b'}});
    expect(executavelDoFfmpeg('win32')).toBe('ffmpeg.exe');
    expect(executavelDoFfmpeg('darwin')).toBe('ffmpeg');
    expect(executavelDoFfmpeg('linux')).toBe('ffmpeg');
  });

  it('todo spawn do ffmpeg (app e testes) passa pelo ambiente das bibliotecas', () => {
    // no Mac, um ffmpeg rodado sem o DYLD_LIBRARY_PATH aborta (SIGABRT) antes de começar: a regra vale para o código e
    // para as fixtures dos testes, que o CI do Mac roda
    const raiz = path.join(__dirname, '..');
    const arquivos = (pasta: string): string[] => readdirSync(pasta, {withFileTypes: true}).flatMap((e) =>
      e.isDirectory() ? arquivos(path.join(pasta, e.name)) : /\.(ts|tsx|mjs|cjs)$/.test(e.name) ? [path.join(pasta, e.name)] : []);
    const chamadas: string[] = [];
    const semAmbiente: string[] = [];
    for (const a of [...arquivos(path.join(raiz, 'src')), ...arquivos(path.join(raiz, 'testes')), ...arquivos(path.join(raiz, 'mcp'))]) {
      const texto = readFileSync(a, 'utf-8');
      for (const m of texto.matchAll(/\b(?:spawn|spawnSync|execFile|execFileSync|rodar)\(/g)) {
        const fim = texto.indexOf(');', m.index);
        const chamada = texto.slice(m.index, fim < 0 ? undefined : fim);
        const primeiro = chamada.slice(chamada.indexOf('(') + 1).split('[')[0]; // o executável: o que vem antes da lista de argumentos
        if (!/ffmpeg|executavel\(\)/i.test(primeiro)) continue;
        const onde = `${path.relative(raiz, a)}:${texto.slice(0, m.index).split('\n').length}`;
        chamadas.push(onde);
        if (!/opcoesDoFfmpeg\(|ambienteDoFfmpeg\(/.test(chamada)) semAmbiente.push(onde);
      }
    }
    expect(chamadas.length).toBeGreaterThanOrEqual(7); // ffmpeg-som (2), imagem-ffmpeg, transcrição e as fixtures (3)
    expect(semAmbiente).toEqual([]);
    const variaveis = arquivos(path.join(raiz, 'src')).filter((a) => /DYLD_LIBRARY_PATH:/.test(readFileSync(a, 'utf-8')));
    expect(variaveis.map((a) => path.relative(raiz, a).split(path.sep).join('/'))).toEqual(['src/nucleo/ffmpeg-ambiente.ts']);
  });
});

describe('empacotamento por sistema', () => {
  it('compositor e navegador de cada alvo', () => {
    expect(getCompositorPackage({platform: 'win32', arch: 'x64'})).toBe('@remotion/compositor-win32-x64-msvc');
    expect(getCompositorPackage({platform: 'darwin', arch: 'arm64'})).toBe('@remotion/compositor-darwin-arm64');
    expect(getCompositorPackage({platform: 'darwin', arch: 'x64'})).toBe('@remotion/compositor-darwin-x64');
    expect(() => getCompositorPackage({platform: 'win32', arch: 'arm64'})).toThrow(/Unsupported/);
    expect(plataformaDoNavegador('win32', 'x64')).toBe('win64');
    expect(plataformaDoNavegador('darwin', 'arm64')).toBe('mac-arm64');
    expect(plataformaDoNavegador('darwin', 'x64')).toBe('mac-x64');
    expect(plataformaDoNavegador('win32', 'arm64')).toBeNull();
  });

  it('o navegador empacotado fica onde o app procura em cada sistema', () => {
    const win = getPackagedBrowserPaths({platform: 'win32', arch: 'x64', projectRoot: 'R:/app', buildPath: 'B:/b'})!;
    expect(win.downloadedBrowserFolder).toBe(path.join('R:/app', 'node_modules', '.remotion', 'chrome-headless-shell', 'win64'));
    expect(win.packagedBrowserCopyDestination).toBe(path.join('B:/b', 'remotion-browser', 'win64'));
    const mac = getPackagedBrowserPaths({platform: 'darwin', arch: 'arm64', projectRoot: '/x'})!;
    expect(mac.downloadedBrowserFolder).toMatch(/chrome-headless-shell[\\/]mac-arm64$/);
  });

  it('as sobras do build do Chromium (gen/, pyproto/) ficam fora do pacote', () => {
    const p = '/n/.remotion/chrome-headless-shell/mac-arm64';
    expect(entraNoPacote(p, `${p}/chrome-headless-shell-mac-arm64/chrome-headless-shell`)).toBe(true);
    expect(entraNoPacote(p, `${p}/chrome-headless-shell-mac-arm64/Helpers/chrome_crashpad_handler`)).toBe(true);
    expect(entraNoPacote(p, `${p}/chrome-headless-shell-mac-arm64/gen/third_party/x.js`)).toBe(false);
    expect(entraNoPacote(p, `${p}/chrome-headless-shell-mac-arm64/pyproto`)).toBe(false);
    expect(entraNoPacote(p, p)).toBe(true);
  });
});

describe('assinatura e notarização do Mac (de verdade só com as variáveis da Apple)', () => {
  const ID = 'Developer ID Application: Nome da Conta (ABCDE12345)';

  it('fora do Mac nada; no Mac sem identidade, só ad hoc (sem hardened runtime) e nada de notarizar', () => {
    expect(assinaturaDoMac({ESTUDIO_MAC_IDENTIDADE: ID}, 'linux')).toEqual({});
    expect(assinaturaDoMac({}, 'win32')).toEqual({});
    const adhoc = assinaturaDoMac({}, 'darwin') as {osxSign: {identity: string; identityValidation: boolean; optionsForFile: (f: string) => unknown}};
    expect(adhoc.osxSign.identity).toBe('-');
    expect(adhoc.osxSign.identityValidation).toBe(false);
    expect(adhoc.osxSign.optionsForFile('/x/Estudio.app')).toEqual({hardenedRuntime: false, timestamp: 'none'});
    expect(assinaturaDoMac({ESTUDIO_MAC_ADHOC: '0'}, 'darwin')).toEqual({});
    expect(notarizacaoDoMac({APPLE_ID: 'a', APPLE_APP_SPECIFIC_PASSWORD: 'b', APPLE_TEAM_ID: 'c'}, 'darwin')).toEqual({});
  });

  it('com identidade no Mac: hardened runtime e entitlements por arquivo', () => {
    const r = assinaturaDoMac({ESTUDIO_MAC_IDENTIDADE: ID}, 'darwin') as {osxSign: {identity: string; optionsForFile: (f: string) => unknown}};
    expect(r.osxSign.identity).toBe(ID);
    expect(r.osxSign.optionsForFile('/x/Estudio.app/Contents/MacOS/Estudio')).toEqual({hardenedRuntime: true, entitlements: ENTITLEMENTS_APP});
    const ffmpeg = '/x/Estudio.app/Contents/Resources/app.asar.unpacked/node_modules/@remotion/compositor-darwin-arm64/ffmpeg';
    expect(r.osxSign.optionsForFile(ffmpeg)).toEqual({hardenedRuntime: true, entitlements: ENTITLEMENTS_FILHOS});
  });

  it('notarização pela chave da API (preferida) ou pelo Apple ID', () => {
    const base = {ESTUDIO_MAC_IDENTIDADE: ID};
    expect(notarizacaoDoMac({...base, APPLE_API_KEY: 'k.p8', APPLE_API_KEY_ID: 'K', APPLE_API_ISSUER: 'I', APPLE_ID: 'a', APPLE_APP_SPECIFIC_PASSWORD: 'b',
      APPLE_TEAM_ID: 'c'}, 'darwin')).toEqual({osxNotarize: {appleApiKey: 'k.p8', appleApiKeyId: 'K', appleApiIssuer: 'I'}});
    expect(notarizacaoDoMac({...base, APPLE_ID: 'a', APPLE_APP_SPECIFIC_PASSWORD: 'b', APPLE_TEAM_ID: 'c'}, 'darwin'))
      .toEqual({osxNotarize: {appleId: 'a', appleIdPassword: 'b', teamId: 'c'}});
    expect(notarizacaoDoMac({...base, APPLE_ID: 'a'}, 'darwin')).toEqual({});
  });

  it('os binários filhos (compositor, navegador, whisper) levam os entitlements do DYLD; o resto, os do app', () => {
    expect(ehBinarioFilho('/A/Estudio.app/Contents/Resources/app.asar.unpacked/remotion-browser/mac-arm64/chrome-headless-shell-mac-arm64/chrome-headless-shell')).toBe(true);
    expect(ehBinarioFilho('/A/Estudio.app/Contents/Resources/whisper/whisper-cli')).toBe(true);
    expect(ehBinarioFilho('/A/Estudio.app/Contents/Frameworks/Estudio Helper (Renderer).app')).toBe(false);
    expect(entitlementsDoArquivo('/A/Estudio.app/Contents/Resources/app.asar.unpacked/node_modules/@lydell/node-pty-darwin-arm64/pty.node')).toBe(ENTITLEMENTS_APP);
    const app = readFileSync(ENTITLEMENTS_APP, 'utf-8');
    const filhos = readFileSync(ENTITLEMENTS_FILHOS, 'utf-8');
    for (const k of ['allow-jit', 'device.audio-input']) expect(app).toContain(`com.apple.security.${k.includes('.') ? k : `cs.${k}`}`);
    for (const k of ['allow-dyld-environment-variables', 'disable-library-validation', 'allow-jit']) expect(filhos).toContain(`com.apple.security.cs.${k}`);
  });

  it('o ícone do Mac existe e é um ICNS com o 1024 px', () => {
    const icns = path.join(__dirname, '..', 'build', 'icone.icns');
    expect(existsSync(icns)).toBe(true);
    const d = readFileSync(icns);
    expect(d.toString('ascii', 0, 4)).toBe('icns');
    expect(d.readUInt32BE(4)).toBe(d.length);
    expect(d.includes(Buffer.from('ic10'))).toBe(true);
  });
});
