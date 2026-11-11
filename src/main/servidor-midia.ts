// Servidor local da mídia do projeto, só em 127.0.0.1 e atrás de um token aleatório por sessão. A prévia (Player) e a
// exportação (Chrome Headless do Remotion) leem a narração, as fotos, as fontes próprias (fontes/) e os efeitos sonoros
// por aqui. Responde a Range, que o <audio>/<video> usa para buscar um trecho sem baixar o arquivo inteiro. Uma rota
// própria (~marcas/<id>/…) serve o logo e as fontes dos kits de marca, com ou sem projeto aberto, para o painel Marca.
import {randomBytes} from 'node:crypto';
import {closeSync, createReadStream, fstatSync, openSync, realpathSync} from 'node:fs';
import {pipeline} from 'node:stream';
import http from 'node:http';
import path from 'node:path';
import type {AddressInfo} from 'node:net';

const TIPOS: Record<string, string> = {
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.aac': 'audio/aac',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.gif': 'image/gif', '.avif': 'image/avif',
  '.json': 'application/json', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2',
};

/** Primeiro segmento depois do token que leva à pasta dos kits de marca, e não ao projeto. */
export const ROTA_MARCAS = '~marcas';
// da pasta dos kits só saem logo e fontes
const TIPOS_DE_MARCA = new Set(['.ttf', '.otf', '.woff', '.woff2', '.png', '.svg', '.jpg', '.jpeg', '.webp']);

// .git em qualquer caixa e nas grafias que o Windows aceita para a mesma pasta (".git." e ".git " e o nome curto GIT~1)
const ehGit = (segmento: string) => /^(\.git[. ]*|git~\d+)$/i.test(segmento);
// o que um link de midia/ para fora do projeto pode servir: só mídia (nada de .json, .gltf com caminhos, texto)
const TIPOS_DE_LINK = new Set(Object.keys(TIPOS).filter((ext) => !['.json', '.gltf'].includes(ext)));

type Rota = (req: http.IncomingMessage, res: http.ServerResponse) => Promise<boolean>;

export class ServidorMidia {
  private servidor: http.Server | null = null;
  private rotas: Rota[] = [];
  private raiz: string | null = null;
  private marcas: (() => string) | null = null;
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

  /** A pasta dos kits de marca (lida na hora: a pessoa pode trocá-la nas preferências). */
  servirMarcas(pasta: (() => string) | null) {
    this.marcas = pasta;
  }

  get base() {
    return `http://127.0.0.1:${this.porta}/${this.token}`;
  }

  /** Endereço da pasta de um kit: `${urlMarca(id)}/logo.png`, `${urlMarca(id)}/fontes/X.ttf`. */
  urlMarca(id: string) {
    return `${this.base}/${ROTA_MARCAS}/${encodeURIComponent(id)}`;
  }

  parar() {
    this.servidor?.close();
  }

  /** Pedido que passa por midia/ do projeto e acaba num arquivo de mídia fora dele (link simbólico só para leitura). */
  private linkDeMidia(raiz: string, pedido: string, real: string) {
    const primeiro = pedido.split(path.sep)[0];
    return raiz === this.raiz && (process.platform === 'win32' ? primeiro.toLowerCase() : primeiro) === 'midia'
      && TIPOS_DE_LINK.has(path.extname(real).toLowerCase()) && !real.split(path.sep).some(ehGit);
  }

  private responder(req: http.IncomingMessage, res: http.ServerResponse) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    const url = new URL(req.url ?? '/', 'http://x');
    const partes = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    if (req.method !== 'GET' && req.method !== 'HEAD') return void res.writeHead(405).end();
    if (partes[0] !== this.token) return void res.writeHead(404).end();
    let raiz: string | null;
    let rel: string[];
    if (partes[1] === ROTA_MARCAS) {
      raiz = this.marcas?.() ?? null;
      rel = partes.slice(2);
      if (rel.length < 2 || !TIPOS_DE_MARCA.has(path.extname(rel[rel.length - 1]).toLowerCase())) return void res.writeHead(404).end();
    } else {
      raiz = this.raiz;
      rel = partes.slice(1);
    }
    if (!raiz) return void res.writeHead(404).end();
    const abs = path.resolve(raiz, ...rel);
    const pedido = path.relative(raiz, abs);
    if (pedido.startsWith('..') || path.isAbsolute(pedido) || ehGit(pedido.split(path.sep)[0])) return void res.writeHead(403).end();
    // o caminho real (links resolvidos) tem de cair dentro da raiz real, com uma exceção decidida: um link em midia/ do
    // projeto para fora dele (a pasta de fotos de outro disco) serve para leitura, e só arquivo de mídia
    let real: string;
    let dentro: string;
    try {
      real = realpathSync(abs);
      dentro = path.relative(realpathSync(raiz), real);
    } catch {
      return void res.writeHead(404).end();
    }
    const fora = dentro.startsWith('..') || path.isAbsolute(dentro);
    if (fora ? !this.linkDeMidia(raiz, pedido, real) : ehGit(dentro.split(path.sep)[0])) return void res.writeHead(403).end();
    let fd: number;
    try {
      fd = openSync(real, 'r');
    } catch (e) {
      const codigo = (e as NodeJS.ErrnoException).code;
      return void res.writeHead(codigo === 'ENOENT' || codigo === 'EISDIR' ? 404 : 403).end(); // pasta no Windows: EISDIR
    }
    let tamanho: number;
    try {
      const st = fstatSync(fd);
      if (!st.isFile()) throw new Error('não é arquivo');
      tamanho = st.size;
    } catch {
      closeSync(fd);
      return void res.writeHead(404).end();
    }
    // pipeline fecha o arquivo quando o cliente desiste (busca no <video>) e não deixa 'error' solto
    const enviar = (o: {start?: number; end?: number}) => void pipeline(createReadStream('', {fd, ...o}), res, () => undefined);
    const tipo = TIPOS[path.extname(abs).toLowerCase()] ?? 'application/octet-stream';
    const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '');
    if (range) {
      const inicio = range[1] ? Number(range[1]) : Math.max(0, tamanho - Number(range[2]));
      const fim = range[1] && range[2] ? Math.min(Number(range[2]), tamanho - 1) : tamanho - 1;
      if (inicio >= tamanho || inicio > fim) return void (closeSync(fd), res.writeHead(416, {'Content-Range': `bytes */${tamanho}`}).end());
      res.writeHead(206, {'Content-Type': tipo, 'Content-Length': fim - inicio + 1, 'Content-Range': `bytes ${inicio}-${fim}/${tamanho}`, 'Accept-Ranges': 'bytes'});
      if (req.method === 'HEAD') return void (closeSync(fd), res.end());
      return enviar({start: inicio, end: fim});
    }
    res.writeHead(200, {'Content-Type': tipo, 'Content-Length': tamanho, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache'});
    if (req.method === 'HEAD') return void (closeSync(fd), res.end());
    enviar({});
  }
}
