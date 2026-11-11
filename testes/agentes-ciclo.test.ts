// Ciclo de vida dos agentes (auditoria do processo principal, P1, P9 e P10): fechar a conversa ACP com o "Permitir?"
// aberto não solta exceção no processo principal; um agente que não sobe (ENOENT) não fica contado como vivo nem preso
// num cliente morto; fechar o app encerra na hora o agente no meio de um turno, em vez de deixá-lo órfão.
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterAll, describe, expect, it} from 'vitest';
import type {EventoConversa} from '../src/compartilhado/api';
import {Conversas} from '../src/main/conversa';
import {SessaoAcp} from '../src/main/ia/motor-acp';

const AGENTE = path.join(__dirname, 'fixtures', 'acp-permissao.mjs');
const OCUPADO = path.join(__dirname, 'fixtures', 'claude-ocupado.mjs');
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
const capturar = () => {
  const lista: string[] = [];
  const h = (e: unknown) => lista.push(String((e as Error)?.message ?? e));
  process.on('uncaughtException', h);
  process.on('unhandledRejection', h);
  return {lista, soltar: () => (process.off('uncaughtException', h), process.off('unhandledRejection', h))};
};
const vivo = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const pastas: string[] = [];
afterAll(() => {
  for (const p of pastas) rmSync(p, {recursive: true, force: true});
});
const ambiente = process.env as Record<string, string>;
const mcp = {url: 'http://127.0.0.1:1/mcp', headers: {}};

describe('agentes (P1, P9, P10)', () => {
  it('P1: fechar a conversa ACP com permissão pendente não solta exceção', async () => {
    const t = capturar();
    const s: SessaoAcp = new SessaoAcp({
      comando: async () => ({arquivo: process.execPath, args: [AGENTE]}),
      cwd: os.tmpdir(), mcp, ambiente,
      evento: (e) => e.tipo === 'permissao' && s.fechar(),
    });
    void s.enviar('oi').catch(() => undefined);
    await esperar(2000);
    t.soltar();
    expect(t.lista).toEqual([]);
  });

  it('P9: claude que não sobe (ENOENT) não fica contado como vivo', async () => {
    const c = new Conversas({evento: () => undefined, claude: () => '/nao/existe/claude', vivas: () => 0});
    const {id} = c.abrir({cwd: os.tmpdir()});
    c.enviar(id, 'oi', 4);
    await esperar(500);
    expect(c.vivas()).toBe(0);
    c.fecharTodas();
  });

  it('P9: agente ACP ausente e depois reinstalado responde na mensagem seguinte (sem "conexão encerrada")', async () => {
    let existe = false;
    const eventos: string[] = [];
    const s = new SessaoAcp({
      comando: async () => (existe ? {arquivo: process.execPath, args: [AGENTE]} : {arquivo: '/nao/existe/agente', args: []}),
      cwd: os.tmpdir(), mcp, ambiente,
      evento: (e: EventoConversa) => (e.tipo === 'permissao' || e.tipo === 'fim') && eventos.push(e.tipo === 'fim' ? `fim:${e.texto}` : 'permissao'),
    });
    await Promise.race([s.enviar('oi').catch(() => undefined), esperar(1500)]);
    expect(s.vivo()).toBe(false);
    existe = true;
    void s.enviar('de novo').catch(() => undefined);
    await esperar(1500);
    s.fechar();
    expect(eventos.slice(1)).toEqual(['permissao']); // o agente de volta chegou a pedir permissão
  });

  it.skipIf(process.platform === 'win32')('P10: fechar todas "agora" (fechar o app) encerra o agente ocupado na hora', async () => {
    const pasta = mkdtempSync(path.join(os.tmpdir(), 'estudio-orfao-'));
    pastas.push(pasta);
    const pidArq = path.join(pasta, 'pid');
    const c = new Conversas({evento: () => undefined, claude: () => process.execPath, vivas: () => 0, prefixo: [OCUPADO, pidArq]});
    const {id} = c.abrir({cwd: os.tmpdir()});
    c.enviar(id, 'oi', 4);
    let pid = 0;
    for (let i = 0; i < 40 && !pid; i++) {
      await esperar(100);
      try {
        pid = Number(readFileSync(pidArq, 'utf-8'));
      } catch {
        /* ainda subindo */
      }
    }
    expect(pid).toBeGreaterThan(0);
    c.fecharTodas({agora: true});
    await esperar(300); // bem antes dos 1,5 s do encerramento agendado
    const sobrou = vivo(pid);
    if (sobrou) process.kill(pid);
    expect(sobrou).toBe(false);
  });
});
