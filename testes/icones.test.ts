// Ícones do Lucide (rodada 3, frente Marca): a busca em português com sinônimos (balança, contrato, prazo), a geometria
// gerada, a forma "icone" no acabamento e a inserção pelo MCP. A pintura em canvas (nítida em 1x, 2x e 4x) é conferida na
// prévia web; aqui entram as regras.
import jsonpatch, {type Operation} from 'fast-json-patch';
import {describe, expect, it} from 'vitest';
import {caixaPintada, ehIcone, temAcabamento} from '../src/nucleo/acabamento';
import {docCarrossel} from '../src/nucleo/carrossel';
import {iconeNovo} from '../src/nucleo/camadas-novas';
import {novoDocImagem} from '../src/nucleo/criar-projeto';
import type {CamadaImagem, DocImagem, OperacaoPatch} from '../src/nucleo/documentos';
import {buscarIcones, etiquetasDoIcone, existeIcone, LEXICO, NOMES_DE_ICONES, semAcento, sugerirIcones, VERSAO_LUCIDE} from '../src/nucleo/icones';
import {MARCA_BKM, marcaDoKit} from '../src/nucleo/marca';
import {patchInserirIcone} from '../src/nucleo/mcp-marca';
import geometria from '../src/renderer/modulos/imagem/icones-geometria.json';

const nomes = (consulta: string, n = 8) => buscarIcones(consulta, n).map((r) => r.nome);
const aplicar = (doc: DocImagem, patch: OperacaoPatch[]): DocImagem => jsonpatch.applyPatch(structuredClone(doc), patch as Operation[], true, false).newDocument;

describe('índice e geometria do Lucide', () => {
  it('traz os ícones da versão do Lucide instalada, e a geometria tem os mesmos nomes', () => {
    expect(VERSAO_LUCIDE).toMatch(/^\d+\.\d+\.\d+$/);
    expect(NOMES_DE_ICONES.length).toBeGreaterThan(1900);
    const g = geometria as unknown as {lucide: string; icones: Record<string, [string[], string[]?]>};
    expect(g.lucide).toBe(VERSAO_LUCIDE);
    expect(Object.keys(g.icones).sort()).toEqual([...NOMES_DE_ICONES].sort());
    // todo ícone tem ao menos um traço, e cada caminho começa com um comando de movimento
    for (const [nome, [tracos, cheios = []]] of Object.entries(g.icones)) {
      expect(tracos.length + cheios.length, nome).toBeGreaterThan(0);
      for (const d of [...tracos, ...cheios]) expect(d, nome).toMatch(/^[Mm]/);
    }
  });

  it('cada elemento fica no seu caminho: o `m` do começo é absoluto e não se cola ao anterior (balança)', () => {
    const g = (geometria as unknown as {icones: Record<string, [string[]]>}).icones;
    expect(g.scale[0]).toHaveLength(5);
    expect(g.scale[0][1]).toMatch(/^m19 8/);
    expect(g.circle[0][0]).toBe('M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0Z'); // círculo → dois arcos
  });

  it('o léxico só cita ícones que existem', () => {
    const faltam = Object.entries(LEXICO).flatMap(([palavra, lista]) => lista.filter((n) => !existeIcone(n)).map((n) => `${palavra}→${n}`));
    expect(faltam).toEqual([]);
    expect(Object.keys(LEXICO).length).toBeGreaterThan(200);
  });
});

describe('busca em português com sinônimos', () => {
  it('balança acha a balança de dois pratos primeiro', () => {
    expect(nomes('balança')[0]).toBe('scale');
    expect(nomes('balanca')[0]).toBe('scale'); // sem acento
    expect(nomes('BALANÇA ')[0]).toBe('scale');
    expect(nomes('justiça').slice(0, 3)).toEqual(expect.arrayContaining(['scale', 'gavel']));
  });

  it('contrato acha documento, aperto de mão e caneta', () => {
    const r = nomes('contrato', 6);
    expect(r).toEqual(expect.arrayContaining(['file-text', 'handshake', 'file-pen']));
    expect(nomes('contratos', 6)).toEqual(expect.arrayContaining(['file-text', 'handshake'])); // plural
    expect(nomes('assinatura', 4)).toContain('signature');
  });

  it('prazo acha relógio, calendário e ampulheta', () => {
    const r = nomes('prazo', 6);
    expect(r).toEqual(expect.arrayContaining(['clock', 'calendar-clock', 'hourglass']));
    expect(nomes('prazos', 6)).toContain('calendar-clock');
    expect(nomes('vencimento', 6)).toContain('calendar-clock');
  });

  it('outras palavras do direito e do trabalho do dia a dia', () => {
    expect(nomes('férias', 4)).toContain('tree-palm');
    expect(nomes('demissão', 5)).toEqual(expect.arrayContaining(['door-open', 'log-out']));
    expect(nomes('dinheiro', 4)).toContain('banknote');
    expect(nomes('atenção', 3)).toContain('triangle-exclamation-point');
    expect(nomes('decisões', 3)).toContain('gavel'); // decisões → decisão
    expect(nomes('FGTS', 2)).toContain('piggy-bank');
  });

  it('palavra em inglês e nome exato também valem; mais de uma palavra soma; lixo não acha nada', () => {
    expect(nomes('clock')[0]).toBe('clock');
    expect(nomes('file-text')[0]).toBe('file-text');
    expect(nomes('arrow right')).toContain('arrow-right');
    expect(nomes('relógio prazo')[0]).toBe('clock'); // as duas palavras levam ao relógio
    expect(nomes('xyzqwk')).toEqual([]);
    expect(nomes('   ')).toEqual([]);
    expect(buscarIcones('seta', 3)).toHaveLength(3);
    expect(buscarIcones('seta', 3)[0].etiquetas.length).toBeGreaterThan(0);
  });

  it('sugere parecidos quando o nome não existe', () => {
    expect(existeIcone('scale')).toBe(true);
    expect(existeIcone('balanca')).toBe(false);
    expect(sugerirIcones('balanca')).toContain('scale');
    expect(sugerirIcones('file text')).toContain('file-text');
    expect(semAcento('Ação')).toBe('acao');
    expect(etiquetasDoIcone('scale')).toMatch(/justice/);
  });
});

describe('forma "icone" no acabamento', () => {
  const base = novoDocImagem(1080, 1350);
  const icone = (extra: Partial<CamadaImagem> = {}): CamadaImagem => ({id: 'i', ...iconeNovo(base, 'scale'), ...extra});

  it('é um ícone só com forma icone e nome; vai sempre pelo canvas', () => {
    expect(ehIcone(icone())).toBe(true);
    expect(ehIcone(icone({icone: ''}))).toBe(false);
    expect(ehIcone(icone({forma: 'retangulo'}))).toBe(false);
    expect(temAcabamento(icone())).toBe(true); // sem sombra, contorno nem degradê
    expect(temAcabamento({...icone(), forma: 'retangulo', icone: undefined})).toBe(false);
  });

  it('nasce quadrado, no centro, com 16% do menor lado e na cor de destaque do kit', () => {
    const c = iconeNovo(base, 'scale');
    expect(c).toMatchObject({tipo: 'forma', forma: 'icone', icone: 'scale', preenchimento: '@destaque', largura: 173, altura: 173});
    expect(c.x).toBe(Math.round((1080 - 173) / 2));
    expect(c.y).toBe(Math.round((1350 - 173) / 2));
    expect(iconeNovo(base, 'clock', {x: 10, y: 20, tamanho: 64, cor: '#FFFFFF', espessura: 3})).toMatchObject({x: 10, y: 20, largura: 64, altura: 64, preenchimento: '#FFFFFF', icone_espessura: 3});
  });

  it('a caixa pintada acompanha o contorno como a de qualquer forma', () => {
    const c = icone({x: 100, y: 100, largura: 100, altura: 100, contorno: {espessura: 6, posicao: 'fora'}});
    expect(caixaPintada(c)).toEqual({x: 94, y: 94, w: 112, h: 112});
  });
});

describe('MCP: inserir_icone', () => {
  const carrossel = () => docCarrossel({largura: 1080, altura: 1350, paginas: 3, marca: marcaDoKit(MARCA_BKM)});

  it('insere na primeira página, na cor de destaque do kit, com id livre', () => {
    const doc = carrossel();
    const r = patchInserirIcone(doc, {icone: 'scale'});
    expect(r.patch).toHaveLength(1);
    expect(r.patch[0]).toMatchObject({op: 'add', path: '/paginas/0/camadas/-'});
    expect(r).toMatchObject({id: 'icone-1', icone: 'scale', pagina: 'capa', avisos: []});
    const depois = aplicar(doc, r.patch);
    const novo = depois.paginas![0].camadas.at(-1)!;
    expect(novo).toMatchObject({id: 'icone-1', forma: 'icone', icone: 'scale', preenchimento: '@destaque'});
    expect(r.caminho).toBe(`/paginas/0/camadas/${depois.paginas![0].camadas.length - 1}`);
    // o segundo recebe outro id
    expect(patchInserirIcone(depois, {icone: 'clock'}).id).toBe('icone-2');
  });

  it('página, posição, tamanho, cor do kit ou hexadecimal e espessura', () => {
    const doc = carrossel();
    const r = patchInserirIcone(doc, {icone: 'Calendar Clock', pagina: 'pagina-2', x: 50, y: 60, tamanho: 90, cor: 'suave', espessura: 1.5});
    expect(r).toMatchObject({icone: 'calendar-clock', pagina: 'pagina-2'});
    expect((r.patch[0] as {path: string}).path).toBe('/paginas/1/camadas/-');
    expect((r.patch[0] as unknown as {value: CamadaImagem}).value).toMatchObject({x: 50, y: 60, largura: 90, altura: 90, preenchimento: '@suave', icone_espessura: 1.5});
    expect((patchInserirIcone(doc, {icone: 'clock', cor: '#112233'}).patch[0] as unknown as {value: CamadaImagem}).value.preenchimento).toBe('#112233');
  });

  it('recusa ícone que não existe (com parecidos), página que não existe e cor que o kit não tem', () => {
    const doc = carrossel();
    expect(() => patchInserirIcone(doc, {icone: 'balanca'})).toThrow(/ícone não achado: balanca \(parecidos: scale/);
    expect(() => patchInserirIcone(doc, {icone: 'scale', pagina: 'nao-existe'})).toThrow(/página não achada.*capa, pagina-2, final/);
    expect(() => patchInserirIcone(doc, {icone: 'scale', cor: 'cobre'})).toThrow(/o kit não tem a cor "cobre"/);
  });

  it('imagem sem kit avisa, e documento de uma prancheta só (sem páginas) recebe em /camadas', () => {
    const r = patchInserirIcone(novoDocImagem(1080, 1080), {icone: 'scale'});
    expect(r.avisos[0]).toMatch(/ainda não tem kit/);
    expect((r.patch[0] as {path: string}).path).toBe('/camadas/-');
    expect(patchInserirIcone(novoDocImagem(1080, 1080), {icone: 'scale', cor: '#FFFFFF'}).avisos).toEqual([]);
  });
});
