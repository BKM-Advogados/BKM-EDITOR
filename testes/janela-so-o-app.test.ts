// A janela só mostra o app (auditoria do processo principal, P5): o will-navigate, o confiavel do IPC e as permissões
// aceitam só a própria página (o index.html do pacote ou a origem do Vite), e a tela só pede microfone, copiar e tela cheia.
import {pathToFileURL} from 'node:url';
import {afterEach, describe, expect, it} from 'vitest';
import {ehPaginaDoApp, permissaoLiberada} from '../src/main/janela-segura';

describe('só a página do app (P5)', () => {
  const linux = {indexHtml: '/opt/Estudio/resources/app.asar/.vite/renderer/main_window/index.html'};
  const windows = {indexHtml: 'C:\\Program Files\\Estúdio\\resources\\app.asar\\.vite\\renderer\\main_window\\index.html', windows: true};

  it('o index.html do pacote passa, com âncora e consulta (location.reload, rotas por hash)', () => {
    const url = pathToFileURL(linux.indexHtml).href;
    expect(ehPaginaDoApp(url, linux)).toBe(true);
    expect(ehPaginaDoApp(`${url}#/video`, linux)).toBe(true);
    expect(ehPaginaDoApp(`${url}?x=1`, linux)).toBe(true);
  });

  it('um arquivo solto na janela, outra página do disco ou da web não passam', () => {
    expect(ehPaginaDoApp('file:///home/pessoa/Imagens/foto.png', linux)).toBe(false);
    expect(ehPaginaDoApp('file:///home/pessoa/pagina.html', linux)).toBe(false);
    expect(ehPaginaDoApp(pathToFileURL('/opt/Estudio/resources/app.asar/.vite/renderer/main_window/../outra/index.html').href, linux)).toBe(false);
    expect(ehPaginaDoApp('https://exemplo.com/', linux)).toBe(false);
    expect(ehPaginaDoApp(undefined, linux)).toBe(false);
    expect(ehPaginaDoApp('não é url', linux)).toBe(false);
  });

  it('no Windows: sem diferenciar caixa nem a codificação da URL (espaço, acento)', () => {
    expect(ehPaginaDoApp('file:///c:/program%20files/est%C3%BAdio/resources/app.asar/.vite/renderer/main_window/index.html', windows)).toBe(true);
    expect(ehPaginaDoApp('file:///C:/Program Files/Estúdio/resources/app.asar/.vite/renderer/main_window/index.html', windows)).toBe(true);
    expect(ehPaginaDoApp('file:///C:/Users/pessoa/Desktop/foto.jpg', windows)).toBe(false);
  });

  describe('sem o indicador, segue o sistema (process.platform simulado)', () => {
    const real = process.platform;
    const como = (p: NodeJS.Platform) => Object.defineProperty(process, 'platform', {value: p, configurable: true});
    afterEach(() => como(real));
    const winHtml = 'D:\\a\\Estudio\\resources\\app.asar\\.vite\\renderer\\main_window\\index.html';

    it('Windows: letra da unidade, barras, caixa, prefixo \\\\?\\ e UNC', () => {
      como('win32');
      const app = {indexHtml: winHtml};
      expect(ehPaginaDoApp('file:///D:/a/Estudio/resources/app.asar/.vite/renderer/main_window/index.html#/video', app)).toBe(true);
      expect(ehPaginaDoApp('file:///d:/A/ESTUDIO/resources/app.asar/.vite/renderer/main_window/index.html?x=1', app)).toBe(true);
      expect(ehPaginaDoApp('file:///D:/a/Estudio/resources/app.asar/.vite/renderer/main_window/./sub/../index.html', app)).toBe(true);
      expect(ehPaginaDoApp('file:///D:/a/Estudio/resources/app.asar/.vite/renderer/main_window/index.html', {indexHtml: `\\\\?\\${winHtml}`})).toBe(true);
      expect(ehPaginaDoApp('file:///D:/a/Estudio/resources/app.asar/.vite/renderer/main_window/index.html', {indexHtml: winHtml.replaceAll('\\', '/')})).toBe(true);
      expect(ehPaginaDoApp('file:///C:/a/Estudio/resources/app.asar/.vite/renderer/main_window/index.html', app)).toBe(false);
      expect(ehPaginaDoApp('file:///D:/a/Estudio/resources/app.asar/.vite/renderer/outra/index.html', app)).toBe(false);
      const unc = {indexHtml: '\\\\servidor\\apps\\Estudio\\resources\\app.asar\\.vite\\renderer\\main_window\\index.html'};
      expect(ehPaginaDoApp('file://servidor/apps/Estudio/resources/app.asar/.vite/renderer/main_window/index.html', unc)).toBe(true);
      expect(ehPaginaDoApp('file:///D:/a/Estudio/resources/app.asar/.vite/renderer/main_window/index.html', {indexHtml: `\\\\?\\UNC\\servidor\\apps${winHtml.slice(2)}`})).toBe(false);
      expect(ehPaginaDoApp('file://servidor/apps/a/Estudio/resources/app.asar/.vite/renderer/main_window/index.html', {indexHtml: `\\\\?\\UNC\\servidor\\apps${winHtml.slice(2)}`})).toBe(true);
    });

    it('Mac: caminho do .app, acento composto ou decomposto, e a caixa conta', () => {
      como('darwin');
      const app = {indexHtml: '/Users/pessoa/Área de Trabalho/Estudio.app/Contents/Resources/app.asar/.vite/renderer/main_window/index.html'.normalize('NFD')};
      expect(ehPaginaDoApp('file:///Users/pessoa/%C3%81rea%20de%20Trabalho/Estudio.app/Contents/Resources/app.asar/.vite/renderer/main_window/index.html#/x', app)).toBe(true);
      expect(ehPaginaDoApp('file:///Users/pessoa/%C3%81rea%20de%20Trabalho/Estudio.app/Contents/Resources/app.asar/.vite/renderer/main_window/INDEX.html', app)).toBe(false);
      expect(ehPaginaDoApp('file:///Users/pessoa/Downloads/foto.png', app)).toBe(false);
    });
  });

  it('em desenvolvimento vale a origem do Vite (a recarga dele passa), e só ela', () => {
    const dev = {...linux, dev: 'http://localhost:5173'};
    expect(ehPaginaDoApp('http://localhost:5173/', dev)).toBe(true);
    expect(ehPaginaDoApp('http://localhost:5173/src/x.ts?import', dev)).toBe(true);
    expect(ehPaginaDoApp('http://localhost:5174/', dev)).toBe(false);
    expect(ehPaginaDoApp(pathToFileURL(linux.indexHtml).href, dev)).toBe(false);
  });

  it('permissões: microfone (só áudio), copiar e tela cheia; câmera, localização e notificações não', () => {
    expect(permissaoLiberada('media', {mediaTypes: ['audio']})).toBe(true);
    expect(permissaoLiberada('media', {})).toBe(true);
    expect(permissaoLiberada('media', {mediaTypes: ['audio', 'video']})).toBe(false);
    expect(permissaoLiberada('media', {mediaTypes: ['video']})).toBe(false);
    expect(permissaoLiberada('clipboard-sanitized-write', {})).toBe(true);
    expect(permissaoLiberada('fullscreen', {})).toBe(true);
    for (const p of ['geolocation', 'notifications', 'clipboard-read', 'display-capture', 'openExternal', 'midiSysex']) expect(permissaoLiberada(p, {})).toBe(false);
  });
});
