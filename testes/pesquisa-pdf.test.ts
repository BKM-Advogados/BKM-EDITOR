// A pesquisa lê PDF (docs/pesquisa.md): a camada de texto do arquivo, sem OCR. Os PDFs são gerados aqui mesmo com o
// pdf-lib (texto conhecido, em páginas), servidos por um HTTP local em 127.0.0.1 e lidos pelo ler_fonte de verdade.
// Nada vem da internet. Confere: o texto extraído (linha por linha, "\f" entre as páginas, palavra partida no fim da
// linha volta inteira, cabeçalho e rodapé repetidos uma vez só), o fato exato que atravessa a quebra de linha e a de
// página, o PDF só de imagem com erro claro e sem gravar nada, e o sha256 e a regravação iguais aos do HTML.
import {cpSync, existsSync, mkdtempSync, readFileSync, rmSync} from 'node:fs';
import http from 'node:http';
import type {AddressInfo} from 'node:net';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {PDFDocument, StandardFonts, rgb} from 'pdf-lib';
import {criarRede, registrarFerramentas} from '../src/nucleo/ferramentas-mcp';
import {acharTrecho, hashTexto, type Fato, type Fonte} from '../src/nucleo/pesquisa';
import {montarTextoPdf, textoDoPdf} from '../src/nucleo/pdf-texto';
import {Projeto} from '../src/nucleo/projeto';
import {baixada, paginaPdfEm} from '../src/renderer/paineis/Pesquisa';

/** PDF com uma lista de linhas por página (Helvetica 11, uma linha a cada 14 pt; linha vazia vira espaço de parágrafo). */
const gerarPdf = async (paginas: string[][], titulo?: string): Promise<Uint8Array> => {
  const doc = await PDFDocument.create();
  const fonte = await doc.embedFont(StandardFonts.Helvetica);
  for (const linhas of paginas) {
    const p = doc.addPage([595, 842]);
    let y = 790;
    for (const l of linhas) {
      if (l) p.drawText(l, {x: 56, y, size: 11, font: fonte});
      y -= 14;
    }
  }
  if (titulo) doc.setTitle(titulo);
  return doc.save();
};

/** PDF só com desenho, sem texto: o que sai de um scanner. */
const gerarPdfSemTexto = async (): Promise<Uint8Array> => {
  const doc = await PDFDocument.create();
  for (let i = 0; i < 2; i++) doc.addPage([595, 842]).drawRectangle({x: 50, y: 50, width: 400, height: 600, color: rgb(0.8, 0.8, 0.8)});
  return doc.save();
};

// a página 1 termina no meio de uma frase que continua na página 2; "Previdên-" + "cia" é palavra partida
const PAGINA_1 = [
  'Art. 477. Na extinção do contrato de trabalho, o empregador',
  'deverá proceder à anotação na Carteira de Trabalho e Previdên-',
  'cia Social, comunicar a dispensa aos órgãos competentes e realizar',
  'o pagamento das verbas rescisórias no prazo e na forma estabelecidos.',
  '',
  '§ 6º A entrega ao empregado de documentos que comprovem a comunicação',
  'da extinção contratual aos órgãos competentes bem como o pagamento',
  'dos valores constantes do instrumento de rescisão ou recibo de quitação',
];
const PAGINA_2 = [
  'deverão ser efetuados até dez dias contados a partir do término do',
  'contrato. (Redação dada pela Lei nº 13.467, de 2017)',
  '',
  '§ 8º A inobservância do disposto no § 6º deste artigo sujeitará o infrator',
  'à multa a favor do empregado, em valor equivalente ao seu salário.',
];

let pasta = '';
let servidorHttp: http.Server;
let origem = '';
let pdfDuasPaginas: Uint8Array;
// o /muda.pdf troca de conteúdo no meio do teste, para ver a regravação
let pdfQueMuda: Uint8Array;
let textoPuro = '';
let meioDigitalizado: Uint8Array;

beforeAll(async () => {
  pasta = mkdtempSync(path.join(tmpdir(), 'estudio-pesquisa-pdf-'));
  cpSync(path.join(__dirname, 'fixtures', 'projeto'), pasta, {recursive: true, filter: (f) => !f.endsWith('.mp4')});
  pdfDuasPaginas = await gerarPdf([PAGINA_1, PAGINA_2], 'CLT, art. 477 (recorte)');
  pdfQueMuda = pdfDuasPaginas;
  const semTexto = await gerarPdfSemTexto();
  // a página 1 com texto, a 2 só com um desenho (o anexo digitalizado de uma decisão)
  const meio = await PDFDocument.load(await gerarPdf([PAGINA_1]));
  meio.addPage([595, 842]).drawRectangle({x: 50, y: 50, width: 400, height: 600, color: rgb(0.8, 0.8, 0.8)});
  meioDigitalizado = await meio.save();
  servidorHttp = http.createServer((req, res) => {
    if (req.url === '/clt.pdf') return void res.writeHead(200, {'Content-Type': 'application/pdf'}).end(Buffer.from(pdfDuasPaginas));
    // sem Content-Type de PDF: o "%PDF" do começo do arquivo basta
    if (req.url === '/download?id=7') return void res.writeHead(200, {'Content-Type': 'application/octet-stream'}).end(Buffer.from(pdfDuasPaginas));
    if (req.url === '/muda.pdf') return void res.writeHead(200, {'Content-Type': 'application/pdf'}).end(Buffer.from(pdfQueMuda));
    if (req.url === '/digitalizado.pdf') return void res.writeHead(200, {'Content-Type': 'application/pdf'}).end(Buffer.from(semTexto));
    if (req.url === '/meio-digitalizado.pdf') return void res.writeHead(200, {'Content-Type': 'application/pdf'}).end(Buffer.from(meioDigitalizado));
    if (req.url === '/quebrado.pdf') return void res.writeHead(200, {'Content-Type': 'application/pdf'}).end('%PDF-1.7\nisto não é um PDF de verdade');
    if (req.url === '/clt.txt') return void res.writeHead(200, {'Content-Type': 'text/plain; charset=utf-8'}).end(textoPuro);
    res.writeHead(404).end();
  });
  await new Promise<void>((ok) => servidorHttp.listen(0, '127.0.0.1', ok));
  origem = `http://127.0.0.1:${(servidorHttp.address() as AddressInfo).port}`;
});

afterAll(() => {
  servidorHttp?.closeAllConnections();
  servidorHttp?.close();
  rmSync(pasta, {recursive: true, force: true});
});

const conectar = async () => {
  const servidor = new McpServer({name: 'estudio', version: '0'});
  registrarFerramentas(servidor, new Projeto(pasta), 'agente', 'teste', criarRede());
  const [lado1, lado2] = InMemoryTransport.createLinkedPair();
  await servidor.connect(lado1);
  const cliente = new Client({name: 'teste', version: '0'});
  await cliente.connect(lado2);
  const chamar = async (name: string, args: Record<string, unknown> = {}) => {
    const r = (await cliente.callTool({name, arguments: args})) as {isError?: boolean; content: {text: string}[]};
    const t = r.content[0].text;
    let dado: unknown = t;
    try {
      dado = JSON.parse(t);
    } catch {
      /* mensagem de erro */
    }
    return {erro: Boolean(r.isError), dado};
  };
  return {cliente, chamar};
};

describe('texto do PDF', () => {
  it('lê a camada de texto: uma linha por linha, "\\f" entre as páginas, palavra partida inteira, título do PDF', async () => {
    const lido = await textoDoPdf(pdfDuasPaginas);
    expect(lido.paginas).toBe(2);
    expect(lido.titulo).toBe('CLT, art. 477 (recorte)');
    expect(lido.sem_texto).toEqual([]);
    const [p1, p2] = lido.texto.split('\n\f\n');
    expect(p1.startsWith('Art. 477. Na extinção do contrato de trabalho, o empregador\n')).toBe(true);
    // "Previdên-" + "cia" volta a ser uma palavra, e o resto da linha de baixo fica onde estava
    expect(p1).toContain('Carteira de Trabalho e Previdência\nSocial, comunicar a dispensa');
    expect(p1).not.toContain('Previdên-');
    // a linha vazia entre o caput e o § 6º vira linha em branco (parágrafo)
    expect(p1).toContain('forma estabelecidos.\n\n§ 6º A entrega');
    expect(p2.startsWith('deverão ser efetuados até dez dias')).toBe(true);
    expect(lido.texto.endsWith('equivalente ao seu salário.')).toBe(true);
  });

  it('o trecho que atravessa a quebra de linha e a de página é exato', async () => {
    const {texto} = await textoDoPdf(pdfDuasPaginas);
    // copiado do PDF numa linha só, como faz quem seleciona e cola
    const linha = acharTrecho(texto, 'o empregador deverá proceder à anotação na Carteira de Trabalho e Previdência Social');
    expect(linha.achado).toBe('exato');
    expect(texto.slice(linha.inicio, linha.fim)).toBe('o empregador\ndeverá proceder à anotação na Carteira de Trabalho e Previdência\nSocial');
    const pagina = acharTrecho(texto, 'recibo de quitação deverão ser efetuados até dez dias contados a partir do término do contrato.');
    expect(pagina.achado).toBe('exato');
    expect(texto.slice(pagina.inicio, pagina.fim)).toContain('\f');
  });

  it('PDF só de imagem dá erro claro (sem OCR); arquivo que não abre também', async () => {
    await expect(textoDoPdf(await gerarPdfSemTexto())).rejects.toThrow(/2 páginas e nenhum texto: parece digitalizado.*não faz OCR/);
    await expect(textoDoPdf(new TextEncoder().encode('%PDF-1.7\nnada'))).rejects.toThrow(/não abriu/);
  });

  it('cabeçalho e rodapé repetidos ficam uma vez só, e o trecho entre as páginas continua exato', async () => {
    const pag = (n: number, corpo: string[]) => ['DIÁRIO OFICIAL DA UNIÃO - Seção 1', ...corpo, `Página ${n} de 3`];
    const pdf = await gerarPdf([
      pag(1, ['A primeira página termina no meio', 'de uma frase que']),
      pag(2, ['continua aqui e termina. Outra frase', 'começa e segue']),
      pag(3, ['até a última página.']),
    ]);
    const lido = await textoDoPdf(pdf);
    expect(lido.repetidos).toEqual(expect.arrayContaining(['DIÁRIO OFICIAL DA UNIÃO - Seção 1', 'Página 1 de 3']));
    expect(lido.texto.match(/DIÁRIO OFICIAL/g)).toHaveLength(1);
    expect(lido.texto.startsWith('DIÁRIO OFICIAL DA UNIÃO - Seção 1\n')).toBe(true);
    expect(lido.texto.endsWith('Página 3 de 3')).toBe(true);
    expect(acharTrecho(lido.texto, 'de uma frase que continua aqui e termina.').achado).toBe('exato');
    expect(acharTrecho(lido.texto, 'Outra frase começa e segue até a última página.').achado).toBe('exato');
  });

  it('linha que só muda de número e também aparece no meio das páginas é texto, não cabeçalho', () => {
    const it = (str: string, y: number) => ({str, hasEOL: true, transform: [11, 0, 0, 11, 56, y], height: 11});
    // cada página só com itens numerados "Item N da lista." (no alto, no meio e no pé) e um rodapé de verdade
    const pagina = (p: number) => [...Array.from({length: 6}, (_, k) => it(`Item ${p * 6 + k + 1} da lista.`, 790 - k * 14)), it(`Página ${p + 1} de 4`, 40)];
    const {texto, repetidos} = montarTextoPdf([0, 1, 2, 3].map(pagina));
    expect(repetidos).toEqual(['Página 1 de 4']);
    for (let n = 1; n <= 24; n++) expect(texto).toContain(`Item ${n} da lista.`);
    expect(texto.match(/Página \d de 4/g)).toEqual(['Página 4 de 4']);
  });

  it('hífen do fim da linha: some na palavra partida, fica na palavra que o documento escreve com hífen', () => {
    const it = (str: string, y: number) => ({str, hasEOL: true, transform: [11, 0, 0, 11, 56, y], height: 11});
    const {texto} = montarTextoPdf([[
      it('O benefício de auxílio-doença é pago pelo INSS; o auxílio-', 790),
      it('doença, segundo a lei, tem conti-', 776),
      it('nuidade enquanto durar a incapacidade.', 762),
    ]]);
    expect(texto).toBe('O benefício de auxílio-doença é pago pelo INSS; o auxílio-doença,\nsegundo a lei, tem continuidade\nenquanto durar a incapacidade.');
  });
});

describe('ler_fonte com PDF', () => {
  it('grava o texto do PDF como faz com HTML: arquivo, sha256, tipo, páginas, e o fato confere no texto limpo', async () => {
    const {cliente, chamar} = await conectar();
    const url = `${origem}/clt.pdf`;
    const r = await chamar('ler_fonte', {url, observacao: 'recorte gerado no teste'});
    expect(r.erro, String(r.dado)).toBe(false);
    const fonte = r.dado as Fonte & {texto: string; caracteres: number; paginas: number; aviso?: string};
    const {texto} = await textoDoPdf(pdfDuasPaginas);
    expect(fonte).toMatchObject({id: 'f1', url, tipo: 'pdf', paginas_pdf: 2, http: 200, bytes: pdfDuasPaginas.byteLength,
      titulo: 'CLT, art. 477 (recorte)', arquivo: 'pesquisa/fontes/f1.txt', caracteres: texto.length, paginas: 1});
    expect(fonte.aviso).toBeUndefined();
    expect(fonte.sha256).toBe(hashTexto(texto));
    expect(fonte.sinais_vigencia).toContain('Redação dada pela');
    expect(readFileSync(path.join(pasta, 'pesquisa', 'fontes', 'f1.txt'), 'utf8')).toBe(texto);
    expect(fonte.texto).toBe(texto.slice(0, 3000));

    // o fato que atravessa a quebra de linha (e a palavra partida) é exato, e os números conferem
    const fato = (await chamar('registrar_fato', {
      afirmacao: 'A empresa tem 10 dias para pagar as verbas rescisórias.',
      fonte_id: 'f1',
      trecho: 'recibo de quitação deverão ser efetuados até dez dias contados a partir do término do contrato',
      localizador: 'CLT, art. 477, § 6º',
    })).dado as Fato;
    expect(fato).toMatchObject({achado: 'exato', estado: 'trecho_confere', digitos: {afirmacao: ['10'], faltando: []}});
    expect(fato.vigencia).toContain('Redação dada pela');
    const linha = (await chamar('registrar_fato', {
      afirmacao: 'Na extinção do contrato, o empregador anota a carteira.',
      fonte_id: 'f1',
      trecho: 'deverá proceder à anotação na Carteira de Trabalho e Previdência Social, comunicar a dispensa',
    })).dado as Fato;
    expect(linha).toMatchObject({achado: 'exato', estado: 'trecho_confere'});
    expect(texto.slice(linha.inicio, linha.fim)).toBe('deverá proceder à anotação na Carteira de Trabalho e Previdência\nSocial, comunicar a dispensa');

    // texto_da_fonte devolve o mesmo texto, com o "\f" entre as páginas
    const pagina = (await chamar('texto_da_fonte', {fonte_id: 'f1'})).dado as {texto: string};
    expect(pagina.texto).toBe(texto);
    expect(pagina.texto).toContain('\f');
    await cliente.close();
  });

  it('PDF sem Content-Type de PDF também é lido (o "%PDF" do começo basta)', async () => {
    const {cliente, chamar} = await conectar();
    const r = await chamar('ler_fonte', {url: `${origem}/download?id=7`});
    expect(r.erro, String(r.dado)).toBe(false);
    expect(r.dado).toMatchObject({tipo: 'pdf', paginas_pdf: 2, sha256: hashTexto((await textoDoPdf(pdfDuasPaginas)).texto)});
    await cliente.close();
  });

  it('o mesmo texto dá o mesmo sha256 em PDF e em texto puro; a regravação segue a do HTML', async () => {
    const {cliente, chamar} = await conectar();
    const {texto} = await textoDoPdf(pdfDuasPaginas);
    // o mesmo texto em .txt, com linha em branco no lugar da quebra de página: o hash é do texto normalizado
    textoPuro = texto.replace('\n\f\n', '\n\n');
    const txt = (await chamar('ler_fonte', {url: `${origem}/clt.txt`})).dado as Fonte;
    const pdfLido = (await chamar('ler_fonte', {url: `${origem}/muda.pdf`})).dado as Fonte;
    expect(txt.tipo).toBe('texto');
    expect(pdfLido.sha256).toBe(txt.sha256);

    // o fato no PDF; a mesma url de novo com o mesmo PDF: mesmo id, mesmo sha256, nada reconferido
    const fato = (await chamar('registrar_fato', {afirmacao: 'A multa é de um salário.', fonte_id: pdfLido.id,
      trecho: 'à multa a favor do empregado, em valor equivalente ao seu salário.'})).dado as Fato;
    expect(fato.achado).toBe('exato');
    const deNovo = (await chamar('ler_fonte', {url: `${origem}/muda.pdf`})).dado as Fonte & {fatos_reconferidos?: string[]; texto_anterior?: string};
    expect(deNovo).toMatchObject({id: pdfLido.id, sha256: pdfLido.sha256});
    expect(deNovo.fatos_reconferidos).toBeUndefined();
    expect(deNovo.texto_anterior).toBeUndefined();

    // o PDF muda (o § 8º sai): o fato é procurado de novo e o texto antigo fica ao lado, como no HTML
    pdfQueMuda = await gerarPdf([PAGINA_1, PAGINA_2.slice(0, 2)]);
    const mudou = (await chamar('ler_fonte', {url: `${origem}/muda.pdf`})).dado as Fonte & {fatos_reconferidos?: string[]; texto_anterior?: string};
    expect(mudou.id).toBe(pdfLido.id);
    expect(mudou.sha256).not.toBe(pdfLido.sha256);
    expect(mudou.fatos_reconferidos).toEqual([fato.id]);
    expect(mudou.texto_anterior).toBe(`pesquisa/fontes/${pdfLido.id}.${pdfLido.sha256.slice(0, 8)}.txt`);
    expect(readFileSync(path.join(pasta, mudou.texto_anterior!), 'utf8')).toBe(texto);
    const lista = (await chamar('listar_pesquisa', {fonte_id: pdfLido.id})).dado as {fatos: Fato[]};
    expect(lista.fatos.find((f) => f.id === fato.id)).toMatchObject({achado: 'nao', estado: 'a_revisar'});
    await cliente.close();
  });

  it('PDF com uma página só de imagem: grava o que tem texto e avisa a página que não foi lida', async () => {
    const {cliente, chamar} = await conectar();
    const r = await chamar('ler_fonte', {url: `${origem}/meio-digitalizado.pdf`});
    expect(r.erro, String(r.dado)).toBe(false);
    const fonte = r.dado as Fonte & {aviso?: string};
    expect(fonte).toMatchObject({tipo: 'pdf', paginas_pdf: 2});
    expect(fonte.aviso).toContain('a página 2 do PDF não tem texto (parece imagem, e o Estúdio não faz OCR)');
    await cliente.close();
  });

  it('PDF só de imagem: erro claro, nada gravado', async () => {
    const {cliente, chamar} = await conectar();
    const antes = (await chamar('listar_pesquisa')).dado as {fontes: Fonte[]};
    const r = await chamar('ler_fonte', {url: `${origem}/digitalizado.pdf`});
    expect(r.erro).toBe(true);
    expect(String(r.dado)).toMatch(/nenhum texto: parece digitalizado \(só imagem\), e o Estúdio não faz OCR/);
    expect(String(r.dado)).toContain('Nada foi gravado');
    const quebrado = await chamar('ler_fonte', {url: `${origem}/quebrado.pdf`});
    expect(quebrado.erro).toBe(true);
    expect(String(quebrado.dado)).toContain('não abriu');
    const depois = (await chamar('listar_pesquisa')).dado as {fontes: Fonte[]};
    expect(depois.fontes).toHaveLength(antes.fontes.length);
    expect(depois.fontes.some((f) => f.url.endsWith('/digitalizado.pdf'))).toBe(false);
    expect(existsSync(path.join(pasta, 'pesquisa', 'fontes', `f${antes.fontes.length + 1}.txt`))).toBe(false);
    await cliente.close();
  });
});

describe('painel Pesquisa com PDF', () => {
  it('diz que a fonte é PDF e em que página do PDF cada posição do texto cai', () => {
    expect(baixada({tipo: 'pdf', paginas_pdf: 12, bytes: 1_468_006, http: 200})).toBe('baixada · PDF de 12 páginas · 1,4 MB');
    expect(baixada({tipo: 'pdf', paginas_pdf: 1, bytes: 2048, http: 200})).toBe('baixada · PDF de 1 página · 2 KB');
    expect(baixada({tipo: 'html', bytes: 2048, http: 200})).toBe('baixada · 2 KB');
    const texto = 'um\n\f\ndois\n\f\ntrês';
    expect(paginaPdfEm(texto, 0)).toBe(1);
    expect(paginaPdfEm(texto, texto.indexOf('dois'))).toBe(2);
    expect(paginaPdfEm(texto, texto.indexOf('três'))).toBe(3);
  });
});
