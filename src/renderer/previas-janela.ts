// A janela desenha as prévias que o MCP pede (frente 3: ver_imagem e ver_cena_3d, src/nucleo/mcp-previa-janela.ts). O
// processo principal manda o documento lido do disco pela ponte (ponte-janela.ts); a imagem passa pelo mesmo canvas da
// exportação (desenharDocumento, exportarPng.ts), página a página pela vistaDaPagina do carrossel, e a cena 3D por um
// WebGLRenderer só dela, com a CenaDoc e o ambiente do monitor 3D (motor.ts), descartado ao fim. O Three.js e o código da
// imagem vêm sob demanda: a janela que nunca recebe o pedido não os carrega. Devolve o PNG e uma miniatura em JPEG, em
// bytes. As ações ("previa:imagem", "previa:cena3d") são as de src/main/previa-janela.ts. Ligada uma vez no App.
import type {DocCena3D, DocImagem, Vetor3} from '../nucleo/documentos';
import {loja} from './estado/loja';
import {atender} from './ponte-janela';

type Camera = {posicao: Vetor3; alvo: Vetor3; fov: number};
type PedidoImagem = {raiz: string; documento: string; doc: DocImagem; pagina?: number; escala: number; lado_miniatura: number};
type PedidoCena = {raiz: string; documento: string; doc: DocCena3D; camera: Camera; largura: number; altura: number; lado_miniatura: number};

const normalizar = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
/** O pedido é do projeto aberto nesta janela? A mídia vem do servidor dela, que serve só esse projeto. */
const conferirProjeto = (raiz: string) => {
  const aberto = loja.get().info?.raiz;
  if (!aberto) throw new Error('sem janela do Estúdio aberta num projeto');
  if (normalizar(aberto) !== normalizar(raiz)) throw new Error('a janela do Estúdio está com outro projeto aberto');
};

const blobDe = (c: HTMLCanvasElement, tipo: string, qualidade?: number) =>
  new Promise<Blob>((ok, falha) => c.toBlob((b) => (b ? ok(b) : falha(new Error('o canvas não gerou a imagem'))), tipo, qualidade));
const bytesDe = async (c: HTMLCanvasElement, tipo: string, qualidade?: number) => new Uint8Array(await (await blobDe(c, tipo, qualidade)).arrayBuffer());

/** JPEG pequeno (lado maior até `lado`) para a resposta do MCP; null se não der (a prévia em PNG vale assim mesmo). */
const miniaturaDe = async (fonte: HTMLCanvasElement, lado: number) => {
  const k = Math.min(1, lado / Math.max(fonte.width, fonte.height));
  const m = document.createElement('canvas');
  m.width = Math.max(1, Math.round(fonte.width * k));
  m.height = Math.max(1, Math.round(fonte.height * k));
  try {
    const ctx = m.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#ffffff'; // o JPEG não tem transparência
    ctx.fillRect(0, 0, m.width, m.height);
    ctx.drawImage(fonte, 0, 0, m.width, m.height);
    return await bytesDe(m, 'image/jpeg', 0.85);
  } catch {
    return null;
  } finally {
    m.width = 0;
    m.height = 0;
  }
};

const desenharImagem = async (d: PedidoImagem) => {
  conferirProjeto(d.raiz);
  const [{desenharDocumento}, {vistaDaPagina}] = await Promise.all([import('./modulos/imagem/exportarPng'), import('../nucleo/carrossel')]);
  const doc = d.pagina !== undefined ? vistaDaPagina(d.doc, d.pagina) : d.doc;
  const {canvas, faltaram} = await desenharDocumento(doc, d.escala);
  try {
    return {png: await bytesDe(canvas, 'image/png'), miniatura: await miniaturaDe(canvas, d.lado_miniatura), largura: canvas.width, altura: canvas.height, faltaram};
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
};

const desenharCena = async (d: PedidoCena) => {
  conferirProjeto(d.raiz);
  const [{PerspectiveCamera, PMREMGenerator, WebGLRenderer}, {RoomEnvironment}, {CenaDoc}] = await Promise.all([
    import('three'), import('three/examples/jsm/environments/RoomEnvironment.js'), import('./modulos/tres/cena'),
  ]);
  // preserveDrawingBuffer: o toBlob é assíncrono e lê a tela depois do render
  const renderer = new WebGLRenderer({antialias: true, preserveDrawingBuffer: true, powerPreference: 'low-power'});
  const cena = new CenaDoc();
  const sala = new RoomEnvironment();
  let ambiente: {dispose: () => void} | null = null;
  try {
    renderer.setPixelRatio(1);
    renderer.setSize(d.largura, d.altura, false);
    // o mesmo ambiente do monitor 3D (motor.ts), para o metálico refletir igual
    const pmrem = new PMREMGenerator(renderer);
    const textura = pmrem.fromScene(sala, 0.04).texture;
    ambiente = textura;
    pmrem.dispose();
    cena.cena.environment = textura;
    cena.cena.environmentIntensity = 0.45;
    cena.sincronizar(d.doc);
    const camera = new PerspectiveCamera(d.camera.fov, d.largura / d.altura, 0.05, 1000);
    camera.position.set(...d.camera.posicao);
    camera.lookAt(...d.camera.alvo);
    camera.updateProjectionMatrix();
    renderer.render(cena.cena, camera);
    const tela = renderer.domElement;
    return {png: await bytesDe(tela, 'image/png'), miniatura: await miniaturaDe(tela, d.lado_miniatura), largura: tela.width, altura: tela.height};
  } finally {
    cena.descartar();
    ambiente?.dispose();
    (sala as {dispose?: () => void}).dispose?.();
    renderer.dispose();
    renderer.forceContextLoss(); // o contexto WebGL volta já: o Chromium segura poucos por página
  }
};

/** Registra quem desenha as prévias do MCP; devolve o que desfaz. */
export const ligarPreviasDaJanela = () => {
  const largarImagem = atender('previa:imagem', (dados) => desenharImagem(dados as PedidoImagem));
  const largarCena = atender('previa:cena3d', (dados) => desenharCena(dados as PedidoCena));
  return () => {
    largarImagem();
    largarCena();
  };
};
