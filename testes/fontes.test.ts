// Fontes da exportação (rodada 3, frente Marca): video-D9 (as quatro famílias do app vêm dentro do app, sem internet),
// video-D10 (fonte de arquivo que não carrega não cancela: vira apelido de uma fonte do sistema) e imagem-D7 (a
// exportação da imagem espera as fontes carregarem). O FontFace e o document.fonts são falsos aqui; o navegador de
// verdade roda em scripts/exportar-teste-fontes.mjs (Remotion fora do Electron) e na prévia web.
import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest';

type Face = {familia: string; fonte: string; descritores: Record<string, string | undefined>};
const adicionadas: Face[] = [];
const pedidas: Face[] = [];
let demoraMs = 0;

class FaceFalsa {
  constructor(public familia: string, public fonte: string, public descritores: Record<string, string | undefined> = {}) {
    pedidas.push(this);
  }

  async load() {
    if (/quebrada|nao-existe/.test(this.fonte)) throw new Error('A network error occurred.');
    if (demoraMs) await new Promise((ok) => setTimeout(ok, demoraMs));
    return this;
  }
}

beforeAll(() => {
  (globalThis as unknown as {FontFace: unknown}).FontFace = FaceFalsa;
  (globalThis as unknown as {document: unknown}).document = {fonts: {add: (f: Face) => adicionadas.push(f)}};
});
afterAll(() => {
  delete (globalThis as unknown as {FontFace?: unknown}).FontFace;
  delete (globalThis as unknown as {document?: unknown}).document;
});

const carregar = async () => import('../src/composicoes/fontes');
const daFamilia = (nome: string) => adicionadas.filter((f) => f.familia === nome);

describe('fontes empacotadas (video-D9)', () => {
  it('Inter, Archivo e as duas IBM Plex carregam de arquivos do app, nunca da internet', async () => {
    const {aguardarFontes, fonte} = await carregar();
    expect(fonte('Archivo')).toBe('Archivo');
    await aguardarFontes(['Inter', 'Archivo', 'IBM Plex Sans', 'IBM Plex Mono']);
    for (const nome of ['Inter', 'Archivo', 'IBM Plex Sans', 'IBM Plex Mono']) expect(daFamilia(nome).length, nome).toBeGreaterThan(0);
    expect(adicionadas.some((f) => /gstatic|googleapis|https?:\/\//.test(f.fonte))).toBe(false);
    // as variáveis servem a todos os pesos; a Plex tem um arquivo por peso
    expect(daFamilia('Inter')[0].descritores.weight).toBe('100 900');
    expect(daFamilia('Archivo')[0].descritores.weight).toBe('100 900');
    expect(daFamilia('IBM Plex Sans').map((f) => f.descritores.weight)).toEqual(['100', '200', '300', '400', '500', '600', '700']);
    expect(daFamilia('IBM Plex Mono')).toHaveLength(7);
    expect(daFamilia('Inter')[0].fonte).toMatch(/format\("woff2"\)/);
  });

  it('pedir de novo não carrega de novo', async () => {
    const {aguardarFontes} = await carregar();
    const antes = pedidas.length;
    await aguardarFontes(['Inter', 'Archivo']);
    expect(pedidas.length).toBe(antes);
  });

  it('a lista da interface traz as quatro do app e as de arquivo registradas, em ordem', async () => {
    const {listarFontes, registrarFontesDeArquivo} = await carregar();
    registrarFontesDeArquivo([{familia: 'Zebra', url: 'http://127.0.0.1:1/z.ttf'}, {familia: 'Abelha', url: 'http://127.0.0.1:1/a.ttf'}]);
    const nomes = listarFontes().map((f) => `${f.nome}:${f.origem}`);
    expect(nomes.slice(0, 4)).toEqual(['Archivo:google', 'IBM Plex Mono:google', 'IBM Plex Sans:google', 'Inter:google']);
    expect(nomes.slice(-2)).toEqual(['Abelha:arquivo', 'Zebra:arquivo']);
  });
});

describe('fonte de arquivo (video-D10, imagem-D14)', () => {
  it('fonte variável pede a faixa de peso, não um peso só', async () => {
    const {aguardarFontes, deFonteArquivo, registrarFontesDeArquivo} = await carregar();
    registrarFontesDeArquivo([deFonteArquivo({familia: 'Variavel', peso: 200, peso_max: 800}, 'http://127.0.0.1:1/v.ttf'), {familia: 'Fixa', url: 'http://127.0.0.1:1/f.ttf', peso: 700, estilo: 'italic'}]);
    await aguardarFontes(['Variavel', 'Fixa']);
    expect(daFamilia('Variavel')[0].descritores).toEqual({weight: '200 800', style: undefined});
    expect(daFamilia('Variavel')[0].fonte).toBe('url("http://127.0.0.1:1/v.ttf") format("truetype")');
    expect(daFamilia('Fixa')[0].descritores).toEqual({weight: '700', style: 'italic'});
  });

  it('arquivo que não carrega não derruba: a família vira apelido de uma fonte do sistema, com aviso', async () => {
    const {aguardarFontes, registrarFontesDeArquivo} = await carregar();
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    registrarFontesDeArquivo([{familia: 'Fantasma', url: 'http://127.0.0.1:1/nao-existe/Fantasma-Bold.ttf', peso: 700}, {familia: 'Fantasma', url: 'http://127.0.0.1:1/fantasma-regular.ttf', peso: 400}]);
    await expect(aguardarFontes(['Fantasma'])).resolves.toBeUndefined();
    const f = daFamilia('Fantasma');
    expect(f).toHaveLength(2); // a que carregou e o apelido da que não veio
    const apelido = f.find((x) => /local\(/.test(x.fonte))!;
    expect(apelido.descritores.weight).toBe('700');
    expect(apelido.fonte).toContain('local("Segoe UI Bold")'); // peso 700: o negrito do sistema
    expect(f.find((x) => !/local\(/.test(x.fonte))!.descritores.weight).toBe('400');
    expect(aviso).toHaveBeenCalledTimes(1);
    expect(String(aviso.mock.calls[0][0])).toMatch(/Fantasma não carregou.*fonte do sistema/);
    aviso.mockRestore();
  });

  it('o apelido de peso normal usa a fonte do sistema comum', async () => {
    const {aguardarFontes, registrarFontesDeArquivo} = await carregar();
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    registrarFontesDeArquivo([{familia: 'Quebrada', url: 'http://127.0.0.1:1/quebrada.woff2', peso: 400}]);
    await aguardarFontes(['Quebrada']);
    expect(daFamilia('Quebrada')[0].fonte).toBe('local("Segoe UI"), local("Helvetica Neue"), local("Arial"), local("Roboto"), local("DejaVu Sans")');
    aviso.mockRestore();
  });

  it('a mesma fonte sob duas famílias carrega para as duas', async () => {
    const {aguardarFontes, registrarFontesDeArquivo} = await carregar();
    registrarFontesDeArquivo([{familia: 'Gemea A', url: 'http://127.0.0.1:1/g.ttf', peso: 400}, {familia: 'Gemea B', url: 'http://127.0.0.1:1/g.ttf', peso: 400}]);
    await aguardarFontes(['Gemea A', 'Gemea B']);
    expect(daFamilia('Gemea A')).toHaveLength(1);
    expect(daFamilia('Gemea B')).toHaveLength(1);
  });
});

describe('exportar espera as fontes (imagem-D7)', () => {
  it('aguardarFontes só resolve quando a fonte de arquivo terminou de carregar', async () => {
    const {aguardarFontes, registrarFontesDeArquivo} = await carregar();
    demoraMs = 60;
    registrarFontesDeArquivo([{familia: 'Lenta', url: 'http://127.0.0.1:1/lenta.ttf', peso: 400}]);
    const t0 = Date.now();
    await aguardarFontes(['Lenta']);
    demoraMs = 0;
    expect(Date.now() - t0).toBeGreaterThanOrEqual(55);
    expect(daFamilia('Lenta')).toHaveLength(1);
  });

  it('nome que não é fonte de arquivo (do sistema, desconhecido) não espera nada', async () => {
    const {aguardarFontes} = await carregar();
    const antes = pedidas.length;
    await aguardarFontes(['system-ui', 'Nunca Registrada']);
    expect(pedidas.length).toBe(antes);
  });
});
