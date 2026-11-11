// As prévias no MCP por stdio (mcp/nucleo.ts; frente IDE, docs/ide.md): sem o app aberto, o processo do MCP renderiza
// sozinho com o app de onde veio o nucleo.cjs. No Estúdio instalado o nucleo.cjs fica em resources/dist-mcp, ao lado do
// app.asar com as composições já empacotadas e do navegador de render (app.asar.unpacked); no repositório, em dist-mcp/,
// e as composições se empacotam uma vez por processo (o @remotion/bundler fica fora do nucleo.cjs e vem do node_modules).
// A mídia chega ao render por um servidor local aberto só durante cada prévia, com a pasta do projeto inteira (midia/ e
// as fontes do kit em fontes/), o mesmo que o app usa.
import {existsSync} from 'node:fs';
import path from 'node:path';
import {getCompositorPackage} from '../nucleo/compositor-package';
import {prepararRender} from './exportar';
import {criarServicoPrevia} from './previa';
import {ServidorMidia} from './servidor-midia';

/** De onde renderizar, pela pasta acima de dist-mcp/: `resources` do app instalado (tem o app.asar) ou a raiz do repositório. */
export const appDoNucleo = (acima: string, existe: (p: string) => boolean = existsSync) => {
  const asar = path.join(acima, 'app.asar');
  return existe(asar) ? {raizApp: asar, empacotado: true} : {raizApp: acima, empacotado: false};
};

/** O compositor do Remotion (ffmpeg e o binário do render) no node_modules do repositório, para o desenvolvimento. */
const compositorDoRepositorio = (raiz: string) => {
  const p = path.join(raiz, 'node_modules', getCompositorPackage({arch: process.arch, platform: process.platform}));
  return existsSync(p) ? p : null;
};

export const servicoDePreviaStdio = (acima: string) => {
  const {raizApp, empacotado} = appDoNucleo(acima);
  let naRaiz = false;
  return criarServicoPrevia({
    preparar: async (aviso) => {
      if (empacotado && !process.versions.electron) {
        throw new Error('as prévias do Estúdio instalado rodam pelo executável dele com ELECTRON_RUN_AS_NODE=1, como no .mcp.json que o app escreve');
      }
      // em desenvolvimento o Remotion acha o navegador e a raiz pelo package.json mais perto da pasta de trabalho: a do
      // repositório, como no app (na do projeto, ele baixaria um navegador para dentro dela)
      if (!empacotado && !naRaiz) {
        process.chdir(raizApp);
        naRaiz = true;
      }
      const p = await prepararRender({raizApp, empacotado, aviso});
      return p.binariesDirectory ? p : {...p, binariesDirectory: compositorDoRepositorio(raizApp)};
    },
    comMidia: async (raiz, f) => {
      const midia = new ServidorMidia();
      await midia.iniciar();
      midia.servir(raiz);
      try {
        return await f(midia.base);
      } finally {
        midia.parar();
      }
    },
  });
};
