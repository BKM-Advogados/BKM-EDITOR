// A janela só mostra o app (auditoria do processo principal, P5): o will-navigate, o confiavel do IPC e as permissões
// aceitam só a própria página (o index.html do pacote ou a origem do Vite), e a tela só pede microfone, copiar e tela cheia.
import {pathToFileURL} from 'node:url';
import {describe, expect, it} from 'vitest';
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
