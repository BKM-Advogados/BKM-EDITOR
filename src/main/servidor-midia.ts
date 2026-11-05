// Servidor local da mídia do projeto, só em 127.0.0.1 e atrás de um token aleatório por sessão. A prévia (Player) e a
// exportação (Chrome Headless do Remotion) leem a narração, as fotos e os efeitos sonoros por aqui. Responde a Range,
// que o <audio>/<video> usa para buscar um trecho sem baixar o arquivo inteiro.
import {randomBytes} from 'node:crypto';
import {createReadStream, statSync} from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type {AddressInfo} from 'node:net';

const TIPOS: Record<string, string> = {
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.aac': 'audio/aac',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.gif': 'image/gif', '.avif': 'image/avif',
  '.json': 'application/json', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
};

type Rota = (req: http.IncomingMessage, res: http.ServerResponse) => Promise<boolean>;

export class ServidorMidia {
  private servidor: http.Server | null = null;
  private rotas: Rota[] = [];
  private raiz: string | null = null;
  private readonly token = randomBytes(16).toString('hex');
  private porta = 0;

  async iniciar() {
    this.servidor = http.createServer((req, res) => void this.despachar(req, res));
    await new Promise<void>((ok) => this.servidor!.listen(0, '127.0.0.1', ok));
    this.porta = (this.servidor.address() as AddressInfo).port;
  }

  /** Outra rota no mesmo servidor (o MCP por HTTP); a primeira que aceitar o pedido responde. */
  rota(r: Rota) {
    this.rotas.push(r);
  }

  get origem() {
    return `http://127.0.0.1:${this.porta}`;
  }

  private async despachar(req: http.IncomingMessage, res: http.ServerResponse) {
    try {
      for (const r of this.rotas) if (await r(req, res)) return;
      this.responder(req, res);
    } catch (e) {
      if (!res.headersSent) res.writeHead(500).end(String((e as Error).message));
    }
  }

  servir(raiz: string | null) {
    this.raiz = raiz;
  }

  get base() {
    return `http://127.0.0.1:${this.porta}/${this.token}`;
  }

  parar() {
    this.servidor?.close();
  }

  private responder(req: http.IncomingMessage, res: http.ServerResponse) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    const url = new URL(req.url ?? '/', 'http://x');
    const partes = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    if (req.method !== 'GET' && req.method !== 'HEAD') return void res.writeHead(405).end();
    if (!this.raiz || partes[0] !== this.token) return void res.writeHead(404).end();
    const abs = path.resolve(this.raiz, ...partes.slice(1));
    const rel = path.relative(this.raiz, abs);
    if (rel.startsWith('..') || path.isAbsolute(rel) || rel.split(path.sep)[0] === '.git') return void res.writeHead(403).end();
    let tamanho: number;
    try {
      const st = statSync(abs);
      if (!st.isFile()) return void res.writeHead(404).end();
      tamanho = st.size;
    } catch {
      return void res.writeHead(404).end();
    }
    const tipo = TIPOS[path.extname(abs).toLowerCase()] ?? 'application/octet-stream';
    const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '');
    if (range) {
      const inicio = range[1] ? Number(range[1]) : Math.max(0, tamanho - Number(range[2]));
      const fim = range[1] && range[2] ? Math.min(Number(range[2]), tamanho - 1) : tamanho - 1;
      if (inicio >= tamanho || inicio > fim) return void res.writeHead(416, {'Content-Range': `bytes */${tamanho}`}).end();
      res.writeHead(206, {'Content-Type': tipo, 'Content-Length': fim - inicio + 1, 'Content-Range': `bytes ${inicio}-${fim}/${tamanho}`, 'Accept-Ranges': 'bytes'});
      if (req.method === 'HEAD') return void res.end();
      return void createReadStream(abs, {start: inicio, end: fim}).pipe(res);
    }
    res.writeHead(200, {'Content-Type': tipo, 'Content-Length': tamanho, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache'});
    if (req.method === 'HEAD') return void res.end();
    createReadStream(abs).pipe(res);
  }
}
