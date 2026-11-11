// Imagem de qualquer formato → PNG, pelo ffmpeg do compositor do Remotion (o mesmo binário que o render, o som e a
// transcrição usam). Serve ao pixelizar_imagem, que só lê PNG: JPG (foto), PNG entrelaçado, de 16 bits ou grande demais
// passam por aqui, já reduzidos (a grade tem no máximo 128 células de lado, então 1024 px sobram). Sem Electron: roda no
// app (processo principal), no MCP por stdio (dist-mcp/nucleo.cjs) e no vitest.
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {getCompositorPackage} from './compositor-package';

const executavel = () => (process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');

/** Caminho do ffmpeg, ou null. Procura no app empacotado (app.asar.unpacked), ao lado do bundle (dist-mcp/ e .vite/app/
 *  ficam na raiz do app) e pelo require do node_modules, como a transcrição faz. */
export const acharFfmpeg = (): string | null => {
  let pacote: string;
  try {
    pacote = getCompositorPackage({arch: process.arch, platform: process.platform});
  } catch {
    return null;
  }
  const exe = executavel();
  const recursos = (process as {resourcesPath?: string}).resourcesPath;
  const aqui = typeof __dirname === 'string' ? __dirname : undefined;
  const candidatos = [
    recursos && path.join(recursos, 'app.asar.unpacked', 'node_modules', pacote, exe),
    aqui && path.resolve(aqui, '..', 'node_modules', pacote, exe), // dist-mcp/ → raiz
    aqui && path.resolve(aqui, '..', '..', 'node_modules', pacote, exe), // .vite/app/ ou src/main/ → raiz
  ].filter((c): c is string => Boolean(c));
  for (const base of [aqui, process.cwd()]) {
    if (!base) continue;
    try {
      candidatos.push(path.join(path.dirname(createRequire(path.join(base, 'package.json')).resolve(`${pacote}/package.json`)), exe));
    } catch {
      /* sem o pacote a partir daqui */
    }
  }
  return candidatos.find((c) => existsSync(c)) ?? null;
};

/** Lado máximo da imagem convertida. */
export const LADO_CONVERTIDO = 1024;

/** Converte o primeiro quadro de `arquivo` num PNG RGBA de 8 bits, reduzido para caber em LADO_CONVERTIDO. */
export const converterParaPng = (arquivo: string, o: {ffmpeg?: string | null} = {}) => new Promise<Buffer>((ok, falha) => {
  const ffmpeg = o.ffmpeg === undefined ? acharFfmpeg() : o.ffmpeg;
  if (!ffmpeg) return falha(new Error('não achei o ffmpeg do Remotion (@remotion/compositor) para converter a imagem: converta para PNG (8 bits, sem entrelaçamento, até 4096 px) ou reinstale o app'));
  const pasta = path.dirname(ffmpeg);
  const escala = `scale=w='min(${LADO_CONVERTIDO},iw)':h='min(${LADO_CONVERTIDO},ih)':force_original_aspect_ratio=decrease`;
  const filho = spawn(ffmpeg, ['-hide_banner', '-nostdin', '-v', 'error', '-i', arquivo, '-frames:v', '1', '-vf', escala, '-pix_fmt', 'rgba', '-c:v', 'png', '-f', 'image2pipe', 'pipe:1'],
    {cwd: pasta, env: {...process.env, LD_LIBRARY_PATH: pasta, DYLD_LIBRARY_PATH: pasta}, windowsHide: true});
  const saida: Buffer[] = [];
  let erro = '';
  filho.stdout.on('data', (d: Buffer) => saida.push(d));
  filho.stderr.on('data', (d: Buffer) => (erro = (erro + d.toString('utf-8')).slice(-4000)));
  filho.on('error', falha);
  filho.on('close', (codigo) => {
    const png = Buffer.concat(saida);
    if (codigo !== 0 || !png.length) return falha(new Error(`o ffmpeg não conseguiu ler a imagem ${path.basename(arquivo)}: ${erro.trim().split('\n').slice(-2).join(' | ') || `código ${codigo}`}`));
    ok(png);
  });
});
