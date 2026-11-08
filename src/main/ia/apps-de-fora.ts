// Apps de IA de fora (frente IA, rodada 3, "padrão Screenpipe"): Claude Desktop, Cursor, Cline, Windsurf e outros
// entram no MCP estudio do projeto aberto. Desligado por padrão. Ligado, o app abre uma porta fixa só em 127.0.0.1, só
// com /mcp, recusando pedido de página web (Origin) e Host estranho. Cada app tem um token próprio, guardado no cofre,
// que vira a origem no diário ("Cursor") e passa pelo mesmo portão de permissão das conversas. Revogar apaga o token.
import {randomBytes} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type {Cofre} from './chaves';

export const PORTA_PADRAO = 47815;

type Registro = {ligado: boolean; porta: number; apps: {id: string; nome: string; criado_em: string}[]};
export type ConfigsDoApp = {http: string; stdio: string};
type Mcp = {atender: (req: http.IncomingMessage, res: http.ServerResponse) => Promise<boolean>; registrarFixo: (t: string, o: string) => void;
  esquecerFixo: (t: string) => void};

const chaveDoToken = (id: string) => `app-de-fora:${id}`;

export class AppsDeFora {
  private servidor: http.Server | null = null;
  private erro: string | null = null;

  constructor(private readonly o: {pasta: string; cofre: Cofre; mcp: () => Mcp | null; ponte: () => {exe: string; script: string}}) {}

  private arquivo() {
    return path.join(this.o.pasta, 'apps-de-fora.json');
  }

  private ler(): Registro {
    try {
      if (existsSync(this.arquivo())) {
        const r = JSON.parse(readFileSync(this.arquivo(), 'utf-8')) as Registro;
        return {ligado: Boolean(r.ligado), porta: Number(r.porta) || PORTA_PADRAO, apps: Array.isArray(r.apps) ? r.apps : []};
      }
    } catch {
      /* arquivo estragado: tudo desligado */
    }
    return {ligado: false, porta: PORTA_PADRAO, apps: []};
  }

  private gravar(r: Registro) {
    mkdirSync(this.o.pasta, {recursive: true});
    writeFileSync(`${this.arquivo()}.tmp`, JSON.stringify(r, null, 2), 'utf-8');
    renameSync(`${this.arquivo()}.tmp`, this.arquivo());
  }

  estado() {
    const r = this.ler();
    return {ligado: r.ligado, porta: r.porta, ouvindo: this.servidor !== null, erro: this.erro ?? undefined,
      apps: r.apps.map(({id, nome, criado_em}) => ({id, nome, criado_em}))};
  }

  /** Na abertura do app: devolve os tokens dos apps ao MCP e, se estava ligado, abre a porta. */
  async iniciar() {
    const r = this.ler();
    for (const a of r.apps) {
      const t = this.o.cofre.ler(chaveDoToken(a.id));
      if (t) this.o.mcp()?.registrarFixo(t, a.nome);
    }
    if (r.ligado) await this.abrir(r.porta);
  }

  async ligar(ligado: boolean, porta?: number) {
    const r = this.ler();
    r.ligado = ligado;
    if (porta !== undefined) {
      if (!Number.isInteger(porta) || porta < 1024 || porta > 65535) throw new Error('a porta precisa ser um número entre 1024 e 65535');
      r.porta = porta;
    }
    this.gravar(r);
    await this.fechar();
    if (ligado) await this.abrir(r.porta);
    return this.estado();
  }

  novo(nome: string) {
    const limpo = String(nome ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
    if (!limpo) throw new Error('dê um nome ao app (ex.: Cursor)');
    const r = this.ler();
    const id = randomBytes(6).toString('hex');
    const token = randomBytes(24).toString('hex');
    this.o.cofre.gravar(chaveDoToken(id), token);
    r.apps.push({id, nome: limpo, criado_em: new Date().toISOString()});
    this.gravar(r);
    this.o.mcp()?.registrarFixo(token, limpo);
    return {id, configs: this.configs(id)};
  }

  /** A configuração pronta para colar no app de fora: por HTTP (Cursor, Cline, Windsurf, VS Code) e por stdio (Claude Desktop). */
  configs(id: string): ConfigsDoApp {
    const r = this.ler();
    const a = r.apps.find((x) => x.id === id);
    const token = a ? this.o.cofre.ler(chaveDoToken(id)) : undefined;
    if (!a || !token) throw new Error('app não achado (foi revogado?)');
    const url = `http://127.0.0.1:${r.porta}/mcp`;
    const {exe, script} = this.o.ponte();
    const http_ = {mcpServers: {estudio: {type: 'http', url, headers: {Authorization: `Bearer ${token}`}}}};
    const stdio = {mcpServers: {estudio: {command: exe, args: [script], env: {ELECTRON_RUN_AS_NODE: '1', ESTUDIO_MCP_URL: url, ESTUDIO_MCP_TOKEN: token}}}};
    return {http: JSON.stringify(http_, null, 2), stdio: JSON.stringify(stdio, null, 2)};
  }

  revogar(id: string) {
    const r = this.ler();
    const t = this.o.cofre.ler(chaveDoToken(id));
    if (t) this.o.mcp()?.esquecerFixo(t);
    this.o.cofre.apagar(chaveDoToken(id));
    r.apps = r.apps.filter((a) => a.id !== id);
    this.gravar(r);
    return this.estado();
  }

  async fechar() {
    const s = this.servidor;
    this.servidor = null;
    if (!s) return;
    // desligar corta na hora: as conexões que o app de fora deixou abertas (keep-alive) não seguram a porta
    const fechou = new Promise<void>((ok) => s.close(() => ok()));
    s.closeAllConnections();
    await fechou;
  }

  private abrir(porta: number) {
    this.erro = null;
    const s = http.createServer((req, res) => {
      // só o próprio PC, só /mcp, e nada vindo de página web (DNS rebinding, CSRF): Host exato e sem Origin
      const hostOk = req.headers.host === `127.0.0.1:${porta}` || req.headers.host === `localhost:${porta}`;
      if (!hostOk || req.headers.origin) return void res.writeHead(403, {'Content-Type': 'text/plain'}).end('recusado');
      const mcp = this.o.mcp();
      if (!mcp) return void res.writeHead(503).end();
      void mcp.atender(req, res).then((ok) => ok || res.writeHead(404).end());
    });
    return new Promise<void>((ok) => {
      s.once('error', (e: NodeJS.ErrnoException) => {
        this.erro = e.code === 'EADDRINUSE' ? `a porta ${porta} já está em uso por outro programa; escolha outra` : e.message;
        ok();
      });
      s.listen(porta, '127.0.0.1', () => {
        this.servidor = s;
        ok();
      });
    });
  }
}
