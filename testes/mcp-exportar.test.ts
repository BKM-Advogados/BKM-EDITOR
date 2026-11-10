// Rodada 3, frente C: as ferramentas do MCP da exportação. marca_dagua lê e muda a marca d'água de um destino em
// .estudio/exportacao.json (com diário), e medir_contraste_marca pede a medida a quem renderiza (o app) e conta em texto. O
// medidor de verdade (renderiza quadros do Remotion) fica em scripts/medir-contraste-teste.mjs; aqui ele é de mentira.
import {mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {registrarFerramentas} from '../src/nucleo/ferramentas-mcp';
import {definirMedidorDeContraste, textoDoContraste, type PedidoContrasteDestino, type ResultadoContraste} from '../src/nucleo/contraste';
import {novoDocCenas} from '../src/nucleo/cenas';
import {lerPrefsExportacao} from '../src/nucleo/prefs-exportacao';
import {Projeto} from '../src/nucleo/projeto';

let pasta = '';
let projeto: Projeto;

const conectar = async () => {
  const servidor = new McpServer({name: 'estudio', version: 'teste'});
  registrarFerramentas(servidor, projeto, 'agente', 'teste');
  const [a, b] = InMemoryTransport.createLinkedPair();
  const cliente = new Client({name: 'teste', version: '1'});
  await Promise.all([servidor.connect(a), cliente.connect(b)]);
  return cliente;
};
const chamar = async (cliente: Client, name: string, args: Record<string, unknown>) => {
  const r = (await cliente.callTool({name, arguments: args})) as {isError?: boolean; content: {text: string}[]};
  const texto = r.content[0]?.text ?? '';
  let json: any = null;
  try {
    json = JSON.parse(texto);
  } catch {
    /* texto simples */
  }
  return {erro: Boolean(r.isError), texto, json};
};

beforeAll(() => {
  pasta = mkdtempSync(path.join(tmpdir(), 'estudio-mcp-exportar-'));
  mkdirSync(path.join(pasta, 'video'), {recursive: true});
  writeFileSync(path.join(pasta, 'estudio.json'), JSON.stringify({formato: 1, nome: 'Exportar', documentos: [{id: 'video', modulo: 'video', caminho: 'video/video.json', titulo: 'Vídeo'}]}));
  writeFileSync(path.join(pasta, 'video', 'video.json'), JSON.stringify({...novoDocCenas({largura: 1080, altura: 1920, fps: 30}), cenas: [{id: 'c1', duracao_ms: 8000, blocos: []}]}));
  projeto = new Projeto(pasta);
});
afterEach(() => definirMedidorDeContraste(null));
afterAll(() => rmSync(pasta, {recursive: true, force: true}));

describe('marca_dagua', () => {
  it('sem campo de mudança, mostra o padrão do destino (desligada) e não grava nada', async () => {
    const c = await conectar();
    const r = await chamar(c, 'marca_dagua', {destino: 'feed'});
    expect(r.erro).toBe(false);
    expect(r.json).toMatchObject({destino: 'feed', gravada: false, marca: {ligada: false, conteudo: 'logo', tamanho: 0.06, opacidade: 0.85}});
    expect(lerPrefsExportacao(projeto)).toEqual({});
  });

  it('liga a marca com canto, tamanho, opacidade e placa; grava no arquivo e no diário', async () => {
    const c = await conectar();
    const r = await chamar(c, 'marca_dagua', {destino: 'reels', ligada: true, conteudo: 'assinatura', canto: 'inf-dir', tamanho: 0.08, opacidade: 0.7, placa: 'escura'});
    expect(r.erro).toBe(false);
    expect(r.json.marca).toEqual({ligada: true, conteudo: 'assinatura', canto: 'inf-dir', tamanho: 0.08, opacidade: 0.7, placa: 'escura'});
    expect(r.json.antes.ligada).toBe(false);
    expect(r.json.proximo_passo).toMatch(/medir_contraste_marca/);
    expect(lerPrefsExportacao(projeto).marca_dagua?.reels).toEqual(r.json.marca);
    expect(JSON.parse(readFileSync(path.join(pasta, '.estudio', 'exportacao.json'), 'utf-8')).marca_dagua.reels.placa).toBe('escura');
    const entrada = projeto.diario().at(-1)!;
    expect(entrada).toMatchObject({documento: '.estudio/exportacao.json', autor: 'agente', origem: 'teste', rotulo: "marca d'água de reels"});
    expect(entrada.inverso.length).toBeGreaterThan(0);
  });

  it('muda só o que foi pedido, tira a placa com "nenhuma" e relê o que está gravado', async () => {
    const c = await conectar();
    const r = await chamar(c, 'marca_dagua', {destino: 'reels', opacidade: 0.5, placa: 'nenhuma'});
    expect(r.json.marca).toEqual({ligada: true, conteudo: 'assinatura', canto: 'inf-dir', tamanho: 0.08, opacidade: 0.5});
    expect(r.json.antes.placa).toBe('escura'); // para desfazer chamando de novo com o que estava
    const lida = await chamar(c, 'marca_dagua', {destino: 'reels'});
    expect(lida.json).toMatchObject({gravada: true, marca: {opacidade: 0.5}});
    expect(lida.json.marca.placa).toBeUndefined();
  });

  it('um destino não mexe no outro, e o que a pessoa gravou no diálogo é lido igual', async () => {
    const c = await conectar();
    expect((await chamar(c, 'marca_dagua', {destino: 'youtube', ligada: true})).json.marca.ligada).toBe(true);
    expect(lerPrefsExportacao(projeto).marca_dagua?.reels?.ligada).toBe(true);
    expect(Object.keys(lerPrefsExportacao(projeto).marca_dagua ?? {}).sort()).toEqual(['reels', 'youtube']);
  });

  it('valor fora da faixa ou destino que não existe é recusado, sem gravar', async () => {
    const c = await conectar();
    const antes = JSON.stringify(lerPrefsExportacao(projeto));
    expect((await chamar(c, 'marca_dagua', {destino: 'reels', tamanho: 0.5})).erro).toBe(true);
    expect((await chamar(c, 'marca_dagua', {destino: 'reels', opacidade: 0})).erro).toBe(true);
    expect((await chamar(c, 'marca_dagua', {destino: 'tiktok', ligada: true})).erro).toBe(true);
    expect((await chamar(c, 'marca_dagua', {destino: 'reels', canto: 'meio'})).erro).toBe(true);
    expect(JSON.stringify(lerPrefsExportacao(projeto))).toBe(antes);
  });
});

describe('medir_contraste_marca', () => {
  const avaliacao = (contraste: number, marca: [number, number, number] = [240, 240, 240]) => ({
    contraste, ok: contraste >= 3, quadro_ms: 4000, fundo: [235, 235, 235] as [number, number, number], marca,
    medidas: [{quadro_ms: 2000, fundo: [235, 235, 235] as [number, number, number], marca, contraste: contraste + 1}, {quadro_ms: 4000, fundo: [235, 235, 235] as [number, number, number], marca, contraste}],
  });

  it('só com o app aberto: sem quem renderize, avisa em vez de inventar a medida', async () => {
    const c = await conectar();
    const r = await chamar(c, 'medir_contraste_marca', {documento: 'video', destino: 'reels'});
    expect(r.erro).toBe(true);
    expect(r.texto).toContain('só funciona com o app do Estúdio aberto');
  });

  it('pede a medida do destino com a marca gravada, ligada, e devolve o pior quadro; abaixo de 3:1 sugere a placa', async () => {
    const pedidos: {documento: string; pedido: PedidoContrasteDestino}[] = [];
    definirMedidorDeContraste(async (documento, pedido): Promise<ResultadoContraste> => (pedidos.push({documento, pedido}), {ok: true, avaliacao: avaliacao(1.4)}));
    const c = await conectar();
    await chamar(c, 'marca_dagua', {destino: 'reels', placa: 'nenhuma', ligada: false});
    const r = await chamar(c, 'medir_contraste_marca', {documento: 'video', destino: 'reels'});
    expect(r.erro).toBe(false);
    expect(pedidos[0]).toMatchObject({documento: 'video', pedido: {destino: {id: 'reels', largura: 1080, altura: 1920}, config: {ligada: true, conteudo: 'assinatura', canto: 'inf-dir'}}});
    expect(r.texto).toContain('1,4:1 no pior quadro (4,0 s)');
    expect(r.texto).toContain('NÃO passa');
    expect(r.texto).toContain('placa "escura"'); // marca clara: placa escura atrás
    expect(r.texto).not.toContain('não foi gravada');
  });

  it('com a escolha de teste (placa), mede essa e não grava; passando de 3:1 diz que passa', async () => {
    let config: PedidoContrasteDestino['config'] | undefined;
    definirMedidorDeContraste(async (_d, pedido) => ((config = pedido.config), {ok: true, avaliacao: avaliacao(15.2)}));
    const c = await conectar();
    const antes = JSON.stringify(lerPrefsExportacao(projeto));
    const r = await chamar(c, 'medir_contraste_marca', {documento: 'video', destino: 'reels', placa: 'escura', tamanho: 0.1});
    expect(config).toMatchObject({ligada: true, placa: 'escura', tamanho: 0.1});
    expect(r.texto).toContain('15,2:1');
    expect(r.texto).toContain('passa');
    expect(r.texto).toContain('não foi gravada');
    expect(JSON.stringify(lerPrefsExportacao(projeto))).toBe(antes);
  });

  it('erro de quem mede (sem logo no kit, por exemplo) volta como erro, e documento ou destino errado também', async () => {
    definirMedidorDeContraste(async () => ({ok: false, mensagem: 'Sem logo nem assinatura no kit: não há marca para medir.'}));
    const c = await conectar();
    expect((await chamar(c, 'medir_contraste_marca', {documento: 'video', destino: 'reels'})).texto).toContain('Sem logo nem assinatura');
    expect((await chamar(c, 'medir_contraste_marca', {documento: 'nao-existe', destino: 'reels'})).erro).toBe(true);
    expect((await chamar(c, 'medir_contraste_marca', {documento: 'video', destino: 'personalizado'})).erro).toBe(true);
  });
});

describe('textoDoContraste', () => {
  it('marca que não apareceu não vira número', () => {
    const texto = textoDoContraste({contraste: null, ok: false, quadro_ms: null, fundo: null, marca: null, medidas: []}, 'feed');
    expect(texto).toMatch(/não deu para medir/);
  });

  it('com a placa já posta e ainda abaixo, sugere a outra placa', () => {
    const texto = textoDoContraste(avaliacaoFraca(), 'reels', 'escura');
    expect(texto).toContain('Mesmo com a placa escura');
    expect(texto).toContain('"clara"');
  });
});

function avaliacaoFraca() {
  const m: [number, number, number] = [40, 40, 40];
  return {contraste: 2.2, ok: false, quadro_ms: 1000, fundo: [20, 20, 20] as [number, number, number], marca: m, medidas: [{quadro_ms: 1000, fundo: [20, 20, 20] as [number, number, number], marca: m, contraste: 2.2}]};
}
