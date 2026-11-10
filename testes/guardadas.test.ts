// Conversas guardadas por projeto (frente IA, F6, transversal-D9): o arquivo em .estudio/conversas/ fora do git, a
// lista da mais recente para a mais antiga, arquivo estragado fora da lista, e a conversa do laço próprio que volta
// com o histórico: a próxima chamada ao provedor leva o que já tinha sido dito.
import {cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import http from 'node:http';
import type {AddressInfo} from 'node:net';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import type {EventoConversa} from '../src/compartilhado/api';
import {CofreMemoria} from '../src/main/ia/chaves';
import {apagarGuardada, guardarConversa, lerGuardada, listarGuardadas} from '../src/main/ia/guardadas';
import {SessoesIA} from '../src/main/ia/sessoes';
import {McpHttp} from '../src/main/mcp-http';
import {Projeto} from '../src/nucleo/projeto';
import {criarApiFalsa} from './fixtures/api-falsa';

let pasta = '';
let servidor: http.Server;
let mcp: McpHttp;
let base = '';

beforeAll(async () => {
  pasta = mkdtempSync(path.join(tmpdir(), 'estudio-guardadas-'));
  cpSync(path.join(__dirname, 'fixtures', 'projeto'), pasta, {recursive: true, filter: (f) => !f.endsWith('.mp4')});
  const projeto = new Projeto(pasta);
  mcp = new McpHttp(path.join(pasta, '.config-teste'), () => projeto);
  servidor = http.createServer((req, res) => void mcp.atender(req, res).then((ok) => ok || res.writeHead(404).end()));
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});
afterAll(() => {
  servidor?.close();
  rmSync(pasta, {recursive: true, force: true, maxRetries: 10, retryDelay: 100});
});

describe('conversas guardadas', () => {
  it('grava fora do git, lista da mais recente, pula arquivo estragado e apaga', async () => {
    const p = new Projeto(pasta);
    guardarConversa(p, {sessao: 'a/../b', provedor: 'claude', titulo: 'Claude 1 · oi', itens: [{tipo: 'pessoa', texto: 'oi', anexos: []}]});
    await new Promise((ok) => setTimeout(ok, 15));
    guardarConversa(p, {sessao: 's2', provedor: 'deepseek', titulo: 'DeepSeek 1 · tudo', itens: [], historico: [{role: 'user', content: 'tudo'}]});
    writeFileSync(p.caminho('.estudio/conversas/estragada.json'), '{nada');
    expect(readFileSync(p.caminho('.gitignore'), 'utf-8')).toContain('.estudio/conversas/');
    const lista = listarGuardadas(p);
    expect(lista.map((c) => c.sessao)).toEqual(['s2', 'a/../b']);
    expect(lerGuardada(p, 'a/../b')?.titulo).toBe('Claude 1 · oi'); // nome do arquivo saneado, sem sair da pasta
    apagarGuardada(p, 's2');
    expect(listarGuardadas(p).map((c) => c.sessao)).toEqual(['a/../b']);
    // gravar de novo não repete a linha do .gitignore
    guardarConversa(p, {sessao: 's3', provedor: 'claude', titulo: 'x', itens: []});
    expect(readFileSync(p.caminho('.gitignore'), 'utf-8').split('.estudio/conversas/').length).toBe(2);
  });

  it('a conversa do laço volta com o histórico: a próxima chamada leva o que já foi dito', async () => {
    const api = await criarApiFalsa({chave: 'sk-guardada-123456', roteiro: [{texto: 'Primeira resposta.'}, {texto: 'Segunda resposta.'}]});
    const cofre = new CofreMemoria();
    cofre.gravar('deepseek', 'sk-guardada-123456');
    let fim: () => void = () => undefined;
    const montar = () => new SessoesIA({evento: (_id, e: EventoConversa) => e.tipo === 'fim' && fim(), claude: {claude: () => null}, vivasTerminal: () => 0,
      cofre, sistema: () => 's', conexao: (o) => mcp.novaConexao(base, o), ambiente: () => ({})});
    const s1 = montar();
    const a = s1.abrir({cwd: pasta, provedor: 'deepseek', base: api.url});
    await new Promise<void>((ok) => ((fim = ok), s1.enviar(a.id, 'olá', 4)));
    const p = new Projeto(pasta);
    guardarConversa(p, {...s1.exportar(a.id)!, titulo: 'DeepSeek 1 · olá', itens: []});
    s1.fecharTodas();
    // projeto reaberto: outra fachada, a mesma sessão
    const g = lerGuardada(p, a.sessao)!;
    expect(g.historico).toHaveLength(2);
    const s2 = montar();
    const b = s2.abrir({cwd: pasta, provedor: 'deepseek', base: api.url, sessao: g.sessao, retomar: {historico: g.historico}});
    expect(b.sessao).toBe(a.sessao);
    await new Promise<void>((ok) => ((fim = ok), s2.enviar(b.id, 'e agora?', 4)));
    s2.fecharTodas();
    await api.fechar();
    const segunda = api.pedidos[1].mensagens.filter((m) => m.role !== 'system').map((m) => m.content);
    expect(segunda).toEqual(['olá', 'Primeira resposta.', 'e agora?']);
  });
});
