// A conversa com o Claude (src/main/conversa.ts) contra um claude falso que fala o mesmo protocolo stream-json:
// eventos na ordem certa, pedido de permissão respondido pelo canal, e a sessão retomada com --resume depois de hibernar.
import path from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import type {EventoConversa} from '../src/compartilhado/api';
import {Conversas} from '../src/main/conversa';

const FALSO = path.join(__dirname, 'fixtures', 'claude-falso.mjs');
let conversas: Conversas | null = null;
afterEach(() => conversas?.fecharTodas());

const montar = () => {
  const eventos: EventoConversa[] = [];
  const esperas: {tipo: string; ok: (e: EventoConversa) => void}[] = [];
  conversas = new Conversas({
    claude: () => process.execPath,
    prefixo: [FALSO],
    vivas: () => 0,
    evento: (_id, e) => {
      eventos.push(e);
      for (const w of esperas.filter((x) => x.tipo === e.tipo)) {
        esperas.splice(esperas.indexOf(w), 1);
        w.ok(e);
      }
    },
  });
  const esperar = <T extends EventoConversa['tipo']>(tipo: T) =>
    new Promise<Extract<EventoConversa, {tipo: T}>>((ok, falha) => {
      const ja = eventos.find((e) => e.tipo === tipo && !(e as {visto?: boolean}).visto);
      if (ja) return ok(ja as Extract<EventoConversa, {tipo: T}>);
      esperas.push({tipo, ok: ok as (e: EventoConversa) => void});
      setTimeout(() => falha(new Error(`sem evento ${tipo}; recebidos: ${eventos.map((e) => e.tipo).join(', ')}`)), 8000);
    });
  return {eventos, esperar};
};

describe('conversa com o claude -p (stream-json)', () => {
  it('abre, recebe texto e ações, pede permissão e termina', async () => {
    const {eventos, esperar} = montar();
    const {id, sessao} = conversas!.abrir({cwd: __dirname});
    conversas!.enviar(id, 'resolva o comentário', 4);

    const pronto = await esperar('pronto');
    expect(pronto.sessao).toBe(sessao);
    expect(pronto.modelo).toBe('falso-novo');

    const pedido = await esperar('permissao');
    expect(pedido).toMatchObject({ferramenta: 'Bash', entrada: {command: 'echo oi'}, pode_sempre: true});
    conversas!.permitir(id, pedido.pedido, 'permitir', true);

    const fim = await esperar('fim');
    expect(fim.erro).toBe(false);
    expect(fim.duracao_ms).toBe(1234);
    const tipos = eventos.map((e) => e.tipo);
    expect(tipos).toEqual(expect.arrayContaining(['estado', 'texto', 'mensagem', 'ferramenta', 'resultado']));
    expect(eventos.filter((e) => e.tipo === 'texto').map((e) => (e as {delta: string}).delta).join('')).toBe('Vou ver o comentário.');
    expect(eventos.filter((e) => e.tipo === 'ferramenta').map((e) => (e as {nome: string}).nome)).toEqual(['mcp__estudio__ler_comentario', 'Bash']);
    expect(eventos.find((e) => e.tipo === 'resultado')).toMatchObject({uso: 't1', ok: true});
  });

  it('negar a permissão chega ao claude e ele segue sem a ação', async () => {
    const {eventos, esperar} = montar();
    const {id} = conversas!.abrir({cwd: __dirname});
    conversas!.enviar(id, 'oi', 4);
    const pedido = await esperar('permissao');
    conversas!.permitir(id, pedido.pedido, 'negar');
    await esperar('fim');
    expect(eventos.filter((e) => e.tipo === 'ferramenta').map((e) => (e as {nome: string}).nome)).toEqual(['mcp__estudio__ler_comentario']);
    expect(eventos.some((e) => e.tipo === 'mensagem' && e.texto === 'Tudo bem, não rodei.')).toBe(true);
  });

  it('hibernar encerra o processo e a próxima mensagem retoma a mesma sessão', async () => {
    const {eventos, esperar} = montar();
    const {id, sessao} = conversas!.abrir({cwd: __dirname});
    conversas!.enviar(id, 'primeira', 4);
    const p1 = await esperar('permissao');
    conversas!.permitir(id, p1.pedido, 'permitir');
    await esperar('fim');
    expect(conversas!.vivas()).toBe(1);
    expect(conversas!.hibernar(id)).toBe(sessao);
    expect(conversas!.vivas()).toBe(0);

    eventos.length = 0;
    conversas!.enviar(id, 'segunda', 4);
    const pronto = await esperar('pronto');
    expect(pronto).toMatchObject({sessao, modelo: 'falso-retomado'});
  });

  it('respeita o limite de sessões do perfil de RAM', () => {
    montar();
    const a = conversas!.abrir({cwd: __dirname});
    const b = conversas!.abrir({cwd: __dirname});
    conversas!.enviar(a.id, 'oi', 1);
    expect(() => conversas!.enviar(b.id, 'oi', 1)).toThrow(/limite de 1 sessões/);
  });
});
