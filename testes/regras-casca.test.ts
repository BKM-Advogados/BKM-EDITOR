// Regras de conteúdo no texto do vídeo (frente Casca, rodada 3): a frase de fecho não é aviso (transversal-D18), "R$500" sem
// espaço é avisado como "R$ 500" (D19) e o checar_texto lê as legendas do vídeo de cenas (N5).
import {cpSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {registrarFerramentas} from '../src/nucleo/ferramentas-mcp';
import {Projeto} from '../src/nucleo/projeto';
import {REGRAS_CONTEUDO, checarTexto, terminaComUltimaFrase} from '../src/nucleo/regras';

const termos = (texto: string) => checarTexto(texto).avisos.map((a) => `${a.tipo}:${a.termo}`);

describe('frase de fecho (transversal-D18)', () => {
  it('o fecho que as regras pedem não recebe o aviso de "advogado"', () => {
    expect(checarTexto(REGRAS_CONTEUDO.texto.ultima_frase).avisos).toEqual([]);
    expect(termos('Cinco meses sem receber? Ficou com alguma dúvida? Procure um advogado trabalhista.')).not.toContain('oab:advogado');
  });

  it('aceita o fecho sem o ponto final, sem acento e com a linha quebrada', () => {
    expect(termos('Ficou com alguma duvida? Procure um advogado trabalhista')).not.toContain('oab:advogado');
    expect(termos('Ficou com alguma dúvida?\nProcure um advogado trabalhista.')).not.toContain('oab:advogado');
  });

  it('advogado fora do fecho continua avisado, e o resto do texto também', () => {
    expect(termos('Fale com um advogado agora')).toEqual(expect.arrayContaining(['oab:advogado', 'oab:fale com']));
    // o fecho no fim não esconde a promessa que veio antes dele
    expect(termos('Consulta gratuita! Ficou com alguma dúvida? Procure um advogado trabalhista.')).toEqual(['oab:consulta gratuita', 'oab:gratuita']);
  });

  it('o fecho continua sendo reconhecido como fecho', () => {
    expect(terminaComUltimaFrase('Ficou com alguma dúvida? Procure um advogado trabalhista.')).toBe(true);
  });
});

describe('valor em reais (transversal-D19)', () => {
  it('"R$500" colado avisa como "R$ 500"', () => {
    expect(termos('Receba R$500 agora')).toContain('oab:r$');
    expect(termos('Receba R$ 500 agora')).toContain('oab:r$');
    expect(termos('Receba R$1.500,00')).toContain('oab:r$');
  });

  it('não confunde com palavra que só termina em "r$" nem avisa à toa', () => {
    expect(termos('Tem 100% de chance')).toContain('oab:100%');
    expect(termos('Sem número nenhum')).toEqual([]);
    expect(termos('1100% é outra coisa')).not.toContain('oab:100%');
  });
});

describe('sem travessão no texto do vídeo', () => {
  it('avisa o travessão, colado ou entre espaços, uma vez por texto com a contagem', () => {
    expect(termos('O prazo — em regra — é curto')).toEqual(['travessao:—']);
    expect(termos('O prazo—em regra—é curto')).toEqual(['travessao:—']);
    expect(checarTexto('a — b — c').avisos[0].nota).toMatch(/^2 /);
  });

  it('o meia-risca só avisa quando faz papel de travessão; intervalo fica', () => {
    expect(termos('O prazo – em regra – é curto')).toEqual(['travessao:–']);
    expect(termos('De 2020–2024 e das 8–12h')).toEqual([]);
    expect(termos('Um hífen-comum não avisa')).toEqual([]);
  });
});

describe('checar_texto lê as legendas do vídeo de cenas (transversal-N5)', () => {
  let pasta = '';
  beforeAll(() => {
    pasta = mkdtempSync(path.join(tmpdir(), 'estudio-regras-'));
    cpSync(path.join(__dirname, 'fixtures', 'projeto'), pasta, {recursive: true, filter: (f) => !f.endsWith('.mp4')});
  });
  afterAll(() => rmSync(pasta, {recursive: true, force: true}));

  const conectar = async () => {
    const servidor = new McpServer({name: 'estudio', version: '0'});
    registrarFerramentas(servidor, new Projeto(pasta), 'agente', 'teste');
    const [lado1, lado2] = InMemoryTransport.createLinkedPair();
    await servidor.connect(lado1);
    const cliente = new Client({name: 'teste', version: '0'});
    await cliente.connect(lado2);
    const chamar = async (name: string, args: Record<string, unknown> = {}) => {
      const r = (await cliente.callTool({name, arguments: args})) as {isError?: boolean; content: {text: string}[]};
      return {erro: Boolean(r.isError), dado: JSON.parse(r.content[0].text) as any};
    };
    return {cliente, chamar};
  };

  it('a legenda com "consulta gratuita" é avisada; o fecho dito só na última legenda vale como fecho', async () => {
    const {cliente, chamar} = await conectar();
    const criado = (await chamar('criar_documento', {modulo: 'video', titulo: 'Legendas', formato: 'reels'})).dado as {id: string};
    const lido = (await chamar('ler_documento', {documento: criado.id})).dado as {versao: string};
    const sem = (await chamar('checar_texto', {documento: criado.id})).dado as {ultima_frase: {termina: boolean}};
    expect(sem.ultima_frase.termina).toBe(false);

    const patch = [{op: 'add', path: '/legendas', value: {segmentos: [
      {id: 'l1', em: 0, sai: 2000, texto: 'Consulta\ngratuita para você'},
      {id: 'l2', em: 2000, sai: 5000, texto: 'Ficou com alguma dúvida? Procure um advogado trabalhista.'},
    ]}}];
    const aplicado = await chamar('aplicar_patch', {documento: criado.id, versao_base: lido.versao, patch});
    expect(aplicado.erro).toBe(false);

    const r = (await chamar('checar_texto', {documento: criado.id})).dado as {avisos: {tipo: string; termo: string; onde: string}[]; ultima_frase: {termina: boolean}};
    expect(r.avisos).toEqual(expect.arrayContaining([expect.objectContaining({tipo: 'oab', termo: 'consulta gratuita', onde: 'legenda l1'})]));
    expect(r.avisos.filter((a) => a.onde === 'legenda l2')).toEqual([]); // o fecho certo não avisa
    expect(r.ultima_frase.termina).toBe(true);
    await cliente.close();
  });
});
