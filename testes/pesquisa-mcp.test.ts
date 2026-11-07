// A pesquisa de ponta a ponta pelo MCP (fase 1, visualizador): um servidor HTTP local serve o recorte real do Planalto
// em windows-1252, e o Claude de mentira lê a fonte, registra fatos, lista, pagina o texto e checa o texto do vídeo.
// A rede é a de verdade do MCP por stdio (fetch do Node), apontada para 127.0.0.1. Nada é recusado: o que não confere
// fica a_revisar; só a página de erro não vira fonte.
import {cpSync, mkdtempSync, readFileSync, rmSync} from 'node:fs';
import http from 'node:http';
import type {AddressInfo} from 'node:net';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {criarRede, registrarFerramentas, type Rede} from '../src/nucleo/ferramentas-mcp';
import {decodificar, hashTexto, limparHtml, normalizar, type Fato, type Fonte} from '../src/nucleo/pesquisa';
import {Projeto} from '../src/nucleo/projeto';

const FIXTURES = path.join(__dirname, 'fixtures', 'pesquisa');
const HTML = readFileSync(path.join(FIXTURES, 'planalto-art477.htm'));
const PARES = JSON.parse(readFileSync(path.join(FIXTURES, 'pares-c1.json'), 'utf8')) as {id: string; afirmacao: string; trecho: string; verdadeiro: boolean; localizador: string}[];

let pasta = '';
let servidorHttp: http.Server;
let origem = '';
// a página de /muda: o teste troca o conteúdo para ver o ler_fonte reconferir os fatos
let paginaQueMuda = '';
const PREAMBULO = `<p>${'Texto de enchimento para a página não parecer curta demais. '.repeat(12)}</p>`;

beforeAll(async () => {
  pasta = mkdtempSync(path.join(tmpdir(), 'estudio-pesquisa-'));
  cpSync(path.join(__dirname, '..', 'exemplos', 'exemplo'), pasta, {recursive: true, filter: (f) => !f.endsWith('.mp4')});
  servidorHttp = http.createServer((req, res) => {
    if (req.url === '/del5452compilado.htm') return void res.writeHead(200, {'Content-Type': 'text/html; charset=windows-1252'}).end(HTML);
    if (req.url === '/antigo') return void res.writeHead(302, {Location: '/del5452compilado.htm'}).end();
    if (req.url === '/negado') return void res.writeHead(403, {'Content-Type': 'text/html'}).end('<html><body><h1>Acesso Negado!</h1></body></html>');
    if (req.url === '/negado.pdf') return void res.writeHead(403, {'Content-Type': 'application/pdf'}).end('%PDF-1.4 nada');
    if (req.url === '/bloqueio') return void res.writeHead(200, {'Content-Type': 'text/html'}).end('<html><body>Request Rejected. Your support ID is: 123</body></html>');
    if (req.url === '/muda') return void res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'}).end(paginaQueMuda);
    // o fixture em dois pedaços, sem Content-Length (Transfer-Encoding: chunked): o limite vale na leitura
    if (req.url === '/em-pedacos') {
      res.writeHead(200, {'Content-Type': 'text/html; charset=windows-1252'});
      res.write(HTML.subarray(0, 1000));
      return void res.end(HTML.subarray(1000));
    }
    // diz UTF-8 e manda windows-1252, como alguns sites de governo
    if (req.url === '/charset-errado') {
      return void res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'}).end(HTML);
    }
    if (req.url === '/mudo') return; // nunca responde
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

/** Cliente MCP ligado em memória a um servidor com as ferramentas do Estúdio sobre a pasta de teste. */
const conectar = async (rede?: Rede) => {
  const servidor = new McpServer({name: 'estudio', version: '0'});
  registrarFerramentas(servidor, new Projeto(pasta), 'agente', 'teste', rede);
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
      /* texto simples: mensagem de erro */
    }
    return {erro: Boolean(r.isError), dado};
  };
  return {cliente, chamar};
};

describe('pesquisa pelo MCP', () => {
  it('ler_fonte → registrar_fato → listar_pesquisa → texto_da_fonte → checar_texto', async () => {
    const {cliente, chamar} = await conectar(criarRede());
    const url = `${origem}/del5452compilado.htm`;

    // ler_fonte: texto limpo gravado fora do git, hash do texto limpo, vigência, observação de quem baixou
    const lida = await chamar('ler_fonte', {url, observacao: 'recorte do art. 477 servido localmente'});
    expect(lida.erro).toBe(false);
    const fonte = lida.dado as Fonte & {texto: string; paginas: number; caracteres: number};
    const textoLimpo = limparHtml(decodificar(new Uint8Array(HTML), 'text/html; charset=windows-1252'));
    expect(fonte).toMatchObject({id: 'f1', url, nivel: 0, http: 200, bytes: HTML.byteLength, arquivo: 'pesquisa/fontes/f1.txt', autor: 'agente', paginas: 1});
    expect(fonte.sha256).toBe(hashTexto(textoLimpo));
    expect(fonte.sinais_vigencia).toEqual(expect.arrayContaining(['Redação dada pela', '(Incluído', '(Revogad']));
    expect(fonte.observacao).toMatch(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2} · agente: recorte do art\. 477 servido localmente$/);
    expect(fonte.texto.startsWith('Art. 477.')).toBe(true);
    expect(fonte.texto.length).toBeLessThanOrEqual(3000);
    expect(fonte.caracteres).toBe(textoLimpo.length);
    expect(readFileSync(path.join(pasta, 'pesquisa', 'fontes', 'f1.txt'), 'utf8')).toBe(textoLimpo);
    // o exemplo não tinha .gitignore com a pasta: o primeiro texto gravado acrescenta a linha
    expect(readFileSync(path.join(pasta, '.gitignore'), 'utf8')).toContain('pesquisa/fontes/');

    // a mesma url de novo: a mesma fonte, a observação mantida
    const deNovo = (await chamar('ler_fonte', {url})).dado as Fonte;
    expect(deNovo.id).toBe('f1');
    expect(deNovo.observacao).toBe(fonte.observacao);

    // redirecionamento: url_final guardada, fonte nova
    const redir = (await chamar('ler_fonte', {url: `${origem}/antigo`, titulo: 'CLT pelo endereço antigo'})).dado as Fonte;
    expect(redir).toMatchObject({id: 'f2', url_final: url, titulo: 'CLT pelo endereço antigo'});

    // registrar_fato: todo trecho do gabarito sai exato; nos verdadeiros os dígitos conferem e o estado é
    // "trecho_confere", menos no C1-02 ("um salário" × "equivalente ao seu salário": o 1 da afirmação não está no trecho)
    for (const par of PARES) {
      const r = await chamar('registrar_fato', {afirmacao: par.afirmacao, fonte_id: 'f1', trecho: par.trecho, localizador: par.localizador});
      expect(r.erro, par.id).toBe(false);
      const fato = r.dado as Fato;
      expect(fato.achado, par.id).toBe('exato');
      expect(normalizar(textoLimpo.slice(fato.inicio, fato.fim)), par.id).toBe(normalizar(par.trecho));
      if (par.verdadeiro) expect(fato.estado, par.id).toBe(par.id === 'C1-02' ? 'a_revisar' : 'trecho_confere');
    }
    // C1-06 diz 15 dias; o trecho diz dez: exato, mas com dígito faltando, então a_revisar
    const quinze = PARES.findIndex((p) => p.id === 'C1-06');
    const listado = (await chamar('listar_pesquisa')).dado as {fontes: Fonte[]; fatos: Fato[]};
    expect(listado.fatos[quinze]).toMatchObject({id: `F${quinze + 1}`, estado: 'a_revisar', digitos: {afirmacao: ['15'], faltando: ['15']}});
    expect(listado.fatos[0].vigencia.length).toBeGreaterThan(0);

    // trecho que não está na fonte: gravado do mesmo jeito, nunca recusado
    const naoHa = await chamar('registrar_fato', {afirmacao: 'O prazo é de 30 dias.', fonte_id: 'f1', trecho: 'no prazo de trinta dias corridos'});
    expect(naoHa.erro).toBe(false);
    expect(naoHa.dado).toMatchObject({achado: 'nao', estado: 'a_revisar', vigencia: []});
    expect((naoHa.dado as Fato).inicio).toBeUndefined();

    // anotar_fonte acrescenta, não apaga
    const anotada = (await chamar('anotar_fonte', {fonte_id: 'f1', observacao: 'conferir com a Câmara (LEGIN)'})).dado as {observacao: string};
    expect(anotada.observacao.split('\n')).toHaveLength(2);
    expect(anotada.observacao.startsWith(fonte.observacao!)).toBe(true);

    // listar_pesquisa: fontes sem texto, todos os fatos
    const tudo = (await chamar('listar_pesquisa')).dado as {fontes: (Fonte & {texto?: string})[]; fatos: Fato[]};
    expect(tudo.fontes.map((f) => f.id)).toEqual(['f1', 'f2']);
    expect(tudo.fontes[0].texto).toBeUndefined();
    expect(tudo.fatos).toHaveLength(PARES.length + 1);
    const info = (await chamar('projeto_info')).dado as {fontes: number; fatos: number};
    expect(info).toMatchObject({fontes: 2, fatos: PARES.length + 1});

    // texto_da_fonte: a página e o recorte de um fato
    const pagina = (await chamar('texto_da_fonte', {fonte_id: 'f1'})).dado as {texto: string; pagina: number; paginas: number};
    expect(pagina).toMatchObject({pagina: 1, paginas: 1, texto: textoLimpo});
    const f1 = tudo.fatos[0];
    const recorte = (await chamar('texto_da_fonte', {fonte_id: 'f1', inicio: f1.inicio, fim: f1.fim})).dado as {texto: string};
    expect(normalizar(recorte.texto)).toBe(normalizar(f1.trecho));
    expect((await chamar('texto_da_fonte', {fonte_id: 'f9'})).erro).toBe(true);

    // checar_texto: só avisos, sobre o texto dado
    const checado = (await chamar('checar_texto', {texto: 'Fale com um advogado: na Empresa o prazo é de 30 dias.'})).dado as {avisos: {tipo: string; termo: string}[]};
    expect(checado.avisos).toEqual(expect.arrayContaining([
      expect.objectContaining({tipo: 'empresa', termo: 'Empresa'}),
      expect.objectContaining({tipo: 'oab', termo: 'advogado'}),
    ]));
    expect(JSON.stringify(checado)).not.toMatch(/reprov|bloque/);

    // diário: uma entrada por fonte lida e por fato registrado, com quem e de onde
    const diario = new Projeto(pasta).diario().filter((e) => e.documento === 'pesquisa/pesquisa.json');
    expect(diario).toHaveLength(3 + PARES.length + 1 + 1);
    expect(diario[0]).toMatchObject({autor: 'agente', origem: 'teste', rotulo: 'fonte lida: 127.0.0.1'});
    await cliente.close();
  });

  it('checar_texto num vídeo de cenas lista os blocos com número e sem refs', async () => {
    const {cliente, chamar} = await conectar(criarRede());
    const criado = (await chamar('criar_documento', {modulo: 'video', titulo: 'Prazo', formato: 'reels'})).dado as {id: string};
    const lido = (await chamar('ler_documento', {documento: criado.id})).dado as {versao: string; conteudo: {cenas: {blocos: {id: string}[]}[]}};
    const bloco = lido.conteudo.cenas[0].blocos[0].id;
    await chamar('aplicar_patch', {documento: criado.id, versao_base: lido.versao, patch: [{op: 'replace', path: '/cenas/0/blocos/0/texto', value: 'A empresa tem 10 dias para pagar'}]});
    const sem = (await chamar('checar_texto', {documento: criado.id})).dado as {blocos_sem_refs: string[]};
    expect(sem.blocos_sem_refs).toEqual([bloco]);
    const depois = (await chamar('ler_documento', {documento: criado.id})).dado as {versao: string};
    await chamar('aplicar_patch', {documento: criado.id, versao_base: depois.versao, patch: [{op: 'add', path: '/cenas/0/blocos/0/refs', value: ['F1']}]});
    const com = (await chamar('checar_texto', {documento: criado.id})).dado as {blocos_sem_refs: string[]};
    expect(com.blocos_sem_refs).toEqual([]);
    await cliente.close();
  });

  it('checar_texto no roteiro da Cliente olha as linhas do gancho, as etiquetas e a narração', async () => {
    const {cliente, chamar} = await conectar(criarRede());
    const lido = (await chamar('ler_documento', {documento: 'carrossel'})).dado as {versao: string};
    await chamar('aplicar_patch', {documento: 'carrossel', versao_base: lido.versao, patch: [
      {op: 'replace', path: '/cenas/0/linhas/0/t', value: 'Trabalha na Empresa?'},
      {op: 'replace', path: '/cenas/0/tag', value: 'Usiminas · MG'},
    ]});
    const r = (await chamar('checar_texto', {documento: 'carrossel'})).dado as {avisos: {tipo: string; termo: string; onde: string}[]; ultima_frase: {frase: string; termina: boolean}};
    expect(r.avisos).toEqual(expect.arrayContaining([
      expect.objectContaining({tipo: 'empresa', termo: 'Empresa', onde: '/cenas/0/linhas/0/t'}),
      expect.objectContaining({tipo: 'empresa', termo: 'usiminas', onde: '/cenas/0/tag'}),
      // a narração (video/palavras.json) termina em "Procure um advogado trabalhista."
      expect.objectContaining({tipo: 'oab', termo: 'advogado', onde: 'narração'}),
    ]));
    expect(r.ultima_frase).toEqual({frase: 'Ficou com alguma dúvida? Procure um advogado trabalhista.', termina: true});
    await cliente.close();
  });

  it('a mesma url com texto novo: os fatos da fonte são procurados de novo no texto novo', async () => {
    const {cliente, chamar} = await conectar(criarRede());
    const url = `${origem}/muda`;
    paginaQueMuda = `<html><body>${PREAMBULO}<p>O pagamento será feito até dez dias depois do fim do contrato.</p></body></html>`;
    const primeira = (await chamar('ler_fonte', {url})).dado as Fonte & {aviso?: string};
    expect(primeira.aviso).toBeUndefined();
    const fato = (await chamar('registrar_fato', {afirmacao: 'São 10 dias para pagar.', fonte_id: primeira.id, trecho: 'até dez dias depois do fim do contrato'})).dado as Fato;
    expect(fato).toMatchObject({achado: 'exato', estado: 'trecho_confere'});

    // texto novo antes do trecho: o lugar muda, o fato continua exato e aponta para o lugar novo
    paginaQueMuda = `<html><body><h1>Seção nova</h1>${PREAMBULO}<p>O pagamento será feito até dez dias depois do fim do contrato.</p></body></html>`;
    const segunda = (await chamar('ler_fonte', {url})).dado as Fonte & {fatos_reconferidos?: string[]};
    expect(segunda.id).toBe(primeira.id);
    expect(segunda.fatos_reconferidos).toEqual([fato.id]);
    // o texto antigo, em que o fato foi conferido, fica guardado ao lado, com o começo do sha256 antigo no nome
    const anterior = (segunda as {texto_anterior?: string}).texto_anterior;
    expect(anterior).toBe(`pesquisa/fontes/${primeira.id}.${primeira.sha256.slice(0, 8)}.txt`);
    expect(readFileSync(path.join(pasta, anterior!), 'utf8')).toContain('O pagamento será feito até dez dias');
    expect(readFileSync(path.join(pasta, anterior!), 'utf8')).not.toContain('Seção nova');
    const texto = ((await chamar('texto_da_fonte', {fonte_id: primeira.id})).dado as {texto: string}).texto;
    const depois = ((await chamar('listar_pesquisa')).dado as {fatos: Fato[]}).fatos.find((f) => f.id === fato.id)!;
    expect(depois.inicio).toBeGreaterThan(fato.inicio!);
    expect(texto.slice(depois.inicio, depois.fim)).toBe('até dez dias depois do fim do contrato');

    // o trecho saiu do texto: o fato fica, como não encontrado e a revisar
    paginaQueMuda = `<html><body>${PREAMBULO}<p>Revogado.</p></body></html>`;
    await chamar('ler_fonte', {url});
    const sumiu = ((await chamar('listar_pesquisa')).dado as {fatos: Fato[]}).fatos.find((f) => f.id === fato.id)!;
    expect(sumiu).toMatchObject({achado: 'nao', estado: 'a_revisar', vigencia: [], afirmacao: 'São 10 dias para pagar.'});
    expect(sumiu.inicio).toBeUndefined();

    // a mesma página de novo, sem mudar: nada a reconferir
    const igual = (await chamar('ler_fonte', {url})).dado as {fatos_reconferidos?: string[]};
    expect(igual.fatos_reconferidos).toBeUndefined();
    await cliente.close();
  });

  it('registrar_fato nunca recusa, nem com uma fonte que não está na pesquisa', async () => {
    const {cliente, chamar} = await conectar(criarRede());
    const r = await chamar('registrar_fato', {afirmacao: 'São 10 dias.', fonte_id: 'f99', trecho: 'dez dias'});
    expect(r.erro).toBe(false);
    expect(r.dado).toMatchObject({fonte_id: 'f99', achado: 'nao', estado: 'a_revisar'});
    expect((r.dado as {aviso: string}).aviso).toContain('não está na pesquisa');
    await cliente.close();
  });

  it('página de erro não vira fonte, página de bloqueio vira com aviso, e sem rede o erro é claro', async () => {
    const {cliente, chamar} = await conectar(criarRede());
    const antes = new Projeto(pasta).pesquisa().fontes.length;
    const negado = await chamar('ler_fonte', {url: `${origem}/negado`});
    expect(negado.erro).toBe(true);
    expect(String(negado.dado)).toContain('HTTP 403');
    expect(String(negado.dado)).toContain('Acesso Negado!');
    // o erro do site vem antes do "é PDF"
    const pdf = await chamar('ler_fonte', {url: `${origem}/negado.pdf`});
    expect(String(pdf.dado)).toContain('HTTP 403');
    expect(new Projeto(pasta).pesquisa().fontes).toHaveLength(antes);
    // bloqueio com HTTP 200: a pesquisa só mostra, então grava, mas avisa
    const bloqueio = await chamar('ler_fonte', {url: `${origem}/bloqueio`});
    expect(bloqueio.erro).toBe(false);
    expect((bloqueio.dado as {aviso?: string}).aviso).toContain('bloqueio');
    await cliente.close();

    const semRede = await conectar();
    const r = await semRede.chamar('ler_fonte', {url: `${origem}/del5452compilado.htm`});
    expect(r.erro).toBe(true);
    expect(String(r.dado)).toContain('este MCP não tem acesso à rede');
    await semRede.cliente.close();
  });

  it('a rede desiste acima do limite de tamanho', async () => {
    const rede = criarRede(undefined, {limite_bytes: 100});
    await expect(rede(`${origem}/del5452compilado.htm`)).rejects.toThrow(/limite/);
    await expect(rede('file:///c:/windows/win.ini')).rejects.toThrow(/http ou https/);
    // no limite exato ainda lê
    const justa = await criarRede(undefined, {limite_bytes: HTML.byteLength})(`${origem}/del5452compilado.htm`);
    expect(justa.bytes.byteLength).toBe(HTML.byteLength);
  });

  it('sem Content-Length o limite vale na leitura em pedaços, e quem não responde cai no tempo limite', async () => {
    const inteira = await criarRede()(`${origem}/em-pedacos`);
    expect(Buffer.from(inteira.bytes).equals(HTML)).toBe(true);
    await expect(criarRede(undefined, {limite_bytes: 1500})(`${origem}/em-pedacos`)).rejects.toThrow(/passa do limite/);
    await expect(criarRede(undefined, {tempo_ms: 200})(`${origem}/mudo`)).rejects.toThrow(/não respondeu em/);
  });

  it('charset UTF-8 declarado com texto windows-1252: a fonte sai com os acentos certos e um aviso', async () => {
    const {cliente, chamar} = await conectar(criarRede());
    const lida = (await chamar('ler_fonte', {url: `${origem}/charset-errado`})).dado as Fonte & {texto: string; aviso?: string};
    expect(lida.texto).toContain('Na extinção do contrato de trabalho');
    expect(lida.texto).not.toContain('�');
    expect(lida.aviso).toContain('não é UTF-8 válido');
    await cliente.close();
  });

  it('registrar_fato aceita trecho vazio, e listar_pesquisa filtra por fonte', async () => {
    const {cliente, chamar} = await conectar(criarRede());
    const fonte = ((await chamar('ler_fonte', {url: `${origem}/del5452compilado.htm`})).dado as Fonte).id;
    const vazio = await chamar('registrar_fato', {afirmacao: 'São 10 dias.', fonte_id: fonte, trecho: ''});
    expect(vazio.erro).toBe(false);
    expect(vazio.dado).toMatchObject({achado: 'nao', estado: 'a_revisar', trecho: ''});
    // afirmação vazia não vira fato, e o erro diz por quê
    const semAfirmacao = await chamar('registrar_fato', {afirmacao: '', fonte_id: fonte, trecho: 'dez dias'});
    expect(semAfirmacao.erro).toBe(true);
    expect(String(semAfirmacao.dado)).toContain('afirmacao vazia: diga o que o trecho sustenta');
    const so = (await chamar('listar_pesquisa', {fonte_id: fonte})).dado as {fontes: Fonte[]; fatos: Fato[]};
    expect(so.fontes.map((f) => f.id)).toEqual([fonte]);
    expect(so.fatos.length).toBeGreaterThan(0);
    expect(so.fatos.every((f) => f.fonte_id === fonte)).toBe(true);
    const nenhuma = (await chamar('listar_pesquisa', {fonte_id: 'f999'})).dado as {fontes: Fonte[]; fatos: Fato[]};
    expect(nenhuma).toEqual({fontes: [], fatos: []});
    await cliente.close();
  });
});
