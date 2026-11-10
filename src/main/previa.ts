// O render das prévias do MCP (frente IDE; as ferramentas ficam em src/nucleo/mcp-previa.ts, docs/ide.md). O mesmo
// caminho da exportação e da medida de contraste: prepararRender (navegador e composições; o pacote fica em cache pela
// vida do processo, exportar.ts) e renderStill/renderMedia com as props de propsDoVideo. Sem Electron: roda no processo
// principal do app (a mídia vem do servidor local dele) e no MCP por stdio (mcp/nucleo.ts sobe um servidor de mídia só
// durante o render, com a pasta do projeto inteira: midia/ e as fontes do kit em fontes/). A folha de contato e a
// miniatura para a resposta passam pelo ffmpeg do compositor do Remotion, que só tem `scale` e `concat` e não lê nem grava
// rawvideo como arquivo: os pixels de cada quadro saem por image2pipe (como na medida de contraste), a grade é montada
// aqui e o PNG da folha é gravado pelo zlib do Node.
import {writeFileSync} from 'node:fs';
import {crc32, deflateSync} from 'node:zlib';
import type {Progresso} from '../compartilhado/api';
import {gradeDaFolha, type AvisoPrevia, type CenaDoVideo, type InfoVideo, type ServicoPrevia} from '../nucleo/mcp-previa';
import type {Projeto} from '../nucleo/projeto';
import {renderizarVideo, type Preparado} from './exportar';
import {rodarFfmpeg} from './ffmpeg-som';
import {propsDoVideo} from './sessao-projeto';

export type OpcoesPrevia = {
  /** Navegador e composições prontos (o mesmo da exportação). */
  preparar: (aviso: (p: Progresso) => void) => Promise<Preparado>;
  /** Roda `f` com o endereço que serve a pasta do projeto (base_midia das props). */
  comMidia: <T>(raiz: string, f: (base: string) => Promise<T>) => Promise<T>;
};

const idDaComposicao = (props: Record<string, unknown>) => (props.composicao === 'VideoCenas' ? 'VideoCenas' : props.composicao === 'Animacao' ? 'Animacao' : 'CarrosselTema');

/** O andamento do Remotion virando aviso das ferramentas (mensagem e fração). */
const paraAviso = (aviso?: AvisoPrevia) => (p: Progresso) => {
  if (p.tipo === 'status' && p.mensagem) aviso?.(p.mensagem);
  else if (p.progresso !== undefined) aviso?.(`${p.etapa ?? 'renderizando'} ${Math.round(p.progresso)}%`, p.progresso / 100);
};

const montar = (projeto: Projeto, documento: string, base: string) => {
  const r = propsDoVideo(projeto, documento, base);
  if ('erro' in r) throw new Error(r.erro);
  return r;
};

/** PNG de pixels RGB (8 bits, sem filtro): o que a folha de contato precisa, sem depender do ffmpeg para gravar. */
export const pngDeRgb = (largura: number, altura: number, rgb: Buffer) => {
  const pedaco = (tipo: string, dados: Buffer) => {
    const corpo = Buffer.concat([Buffer.from(tipo, 'ascii'), dados]);
    const tam = Buffer.alloc(4);
    tam.writeUInt32BE(dados.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(corpo));
    return Buffer.concat([tam, corpo, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largura, 0);
  ihdr.writeUInt32BE(altura, 4);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8 bits, RGB, deflate, filtro por linha, sem entrelaçar
  const linhas = Buffer.alloc((largura * 3 + 1) * altura);
  for (let y = 0; y < altura; y++) rgb.copy(linhas, y * (largura * 3 + 1) + 1, y * largura * 3, (y + 1) * largura * 3);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pedaco('IHDR', ihdr), pedaco('IDAT', deflateSync(linhas, {level: 6})), pedaco('IEND', Buffer.alloc(0))]);
};

const num = (v: unknown, padrao: number) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : padrao);

/** As cenas das props (vídeo de cenas e carrossel narrado têm `t_in` e `t_out`; a animação não tem cenas). */
const cenasDasProps = (props: Record<string, unknown>): CenaDoVideo[] => {
  const lista = Array.isArray(props.cenas) ? (props.cenas as Record<string, unknown>[]) : [];
  return lista.filter((c) => typeof c?.t_in === 'number' && typeof c?.t_out === 'number').map((c, i) => ({
    n: i + 1, t_in: c.t_in as number, t_out: c.t_out as number,
    ...(typeof c.id === 'string' ? {id: c.id} : {}), ...(typeof c.nome === 'string' ? {nome: c.nome} : typeof c.tipo === 'string' && c.tipo !== 'cena' ? {nome: c.tipo} : {}),
  }));
};

export const criarServicoPrevia = (o: OpcoesPrevia): ServicoPrevia => ({
  info: (projeto, documento): InfoVideo => {
    const {props, avisos} = montar(projeto, documento, '');
    return {composicao: idDaComposicao(props), largura: num(props.largura, 1080), altura: num(props.altura, 1920), fps: num(props.fps, 30),
      duracao_ms: num(props.duracao_ms, 1000), cenas: cenasDasProps(props), avisos};
  },

  quadros: async (projeto, p) => {
    const preparado = await o.preparar(paraAviso(p.aviso));
    await o.comMidia(projeto.raiz, async (base) => {
      const {props} = montar(projeto, p.documento, base);
      const {openBrowser, renderStill, selectComposition} = await import('@remotion/renderer');
      const comum = {serveUrl: preparado.serveUrl, binariesDirectory: preparado.binariesDirectory, browserExecutable: preparado.browserExecutable};
      // um navegador só para todos os quadros (abrir um por quadro custa segundos cada vez), como no contraste da marca
      const navegador = await openBrowser('chrome', {browserExecutable: preparado.browserExecutable});
      try {
        const composition = await selectComposition({...comum, id: idDaComposicao(props), inputProps: props, puppeteerInstance: navegador});
        for (const [i, ms] of p.tempos_ms.entries()) {
          p.aviso?.(`quadro ${i + 1} de ${p.tempos_ms.length}`, i / p.tempos_ms.length);
          const frame = Math.max(0, Math.min(composition.durationInFrames - 1, Math.round((ms / 1000) * composition.fps)));
          await renderStill({...comum, composition, output: p.arquivos[i], frame, inputProps: props, imageFormat: 'png', scale: p.escala,
            puppeteerInstance: navegador, timeoutInMilliseconds: 60_000});
        }
      } finally {
        await navegador.close({silent: true}).catch(() => undefined);
      }
    });
  },

  trecho: async (projeto, p) => {
    const aviso = paraAviso(p.aviso);
    const preparado = await o.preparar(aviso);
    await o.comMidia(projeto.raiz, async (base) => {
      const {props} = montar(projeto, p.documento, base);
      const fps = num(props.fps, 30);
      const total = Math.max(1, Math.ceil((num(props.duracao_ms, 1000) / 1000) * fps));
      const de = Math.min(total - 1, Math.floor((p.de_ms / 1000) * fps));
      const ate = Math.max(de, Math.min(total - 1, Math.ceil((p.ate_ms / 1000) * fps) - 1));
      // o mesmo render da exportação: a mistura do som e o alvo de loudness (sem a marca d'água, que é por destino)
      await renderizarVideo(preparado, {props, arquivo: p.arquivo, codec: 'h264', escala: p.escala, quadros: [de, ate]}, aviso);
    });
  },

  folha: async (p) => {
    const {largura, altura, cantos} = gradeDaFolha(p.arquivos.length, p.colunas, p.celula, p.margem);
    const tela = Buffer.alloc(largura * altura * 3, 0x2a); // cinza entre as células: separa também as cenas de fundo escuro
    const binarios = (await o.preparar(() => undefined)).binariesDirectory;
    const cel = p.celula;
    for (const [i, arquivo] of p.arquivos.entries()) {
      const {saida} = await rodarFfmpeg(['-v', 'error', '-i', arquivo, '-vf', `scale=${cel.largura}:${cel.altura}`, '-frames:v', '1', '-f', 'image2pipe', '-c:v', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
        {binarios});
      const {x, y} = cantos[i];
      for (let l = 0; l < cel.altura; l++) {
        const de = l * cel.largura * 3;
        if (de >= saida.length) break;
        saida.copy(tela, ((y + l) * largura + x) * 3, de, Math.min(saida.length, de + cel.largura * 3));
      }
    }
    writeFileSync(p.destino, pngDeRgb(largura, altura, tela));
  },

  miniatura: async (arquivo, t) => {
    const binarios = (await o.preparar(() => undefined)).binariesDirectory;
    const par = (n: number) => Math.max(2, Math.round(n / 2) * 2);
    const {saida} = await rodarFfmpeg(['-v', 'error', '-i', arquivo, '-vf', `scale=${par(t.largura)}:${par(t.altura)}`, '-frames:v', '1', '-f', 'image2pipe', '-c:v', 'mjpeg', '-q:v', '4', '-'],
      {binarios});
    return saida.length ? new Uint8Array(saida) : null;
  },
});
