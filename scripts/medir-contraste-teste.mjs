// Contraste da marca d'água fora do Electron (rodada 3, frente C): um vídeo claro com o logo claro do kit no canto, medido pelo
// mesmo caminho do app (src/main/contraste-marca.ts: dois quadros renderizados, sem a marca e com ela). Mostra o contraste sem
// placa (abaixo de 3:1), com a placa que a medida sugere (acima de 3:1) e com uma assinatura em branco sobre o fundo claro.
// Uso: npx tsx scripts/medir-contraste-teste.mjs   (usa quadros pequenos; leva uns 40 s neste PC)
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {medirContrasteDaMarca} from '../src/main/contraste-marca';
import {prepararRender} from '../src/main/exportar';
import {novoDocCenas, resolverCenas} from '../src/nucleo/cenas';
import {placaParaMarca, quadrosParaMedir, CONTRASTE_MINIMO} from '../src/nucleo/contraste';
import {configPadraoMarca, fontesDaMarcaDagua, marcaDaguaDoDestino} from '../src/nucleo/exportacao';
import {temaDaMarca} from '../src/nucleo/marca';
import {KIT_TESTE} from '../testes/fixtures/kit-teste';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const t0 = Date.now();
const log = (m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(5)} s] ${m}`);
const svg = (s) => `data:image/svg+xml;utf8,${encodeURIComponent(s)}`;
// logo claro (osso) com letras claras: some em fundo claro
const LOGO = svg('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="200" viewBox="0 0 600 200"><rect width="600" height="200" rx="24" fill="#EDE7DD"/>'
  + '<text x="40" y="138" font-family="sans-serif" font-size="110" font-weight="800" fill="#F8F5EF">LOGO</text></svg>');

const doc = {
  ...novoDocCenas({largura: 1080, altura: 1920, fps: 30}),
  tema: {...temaDaMarca(KIT_TESTE, {logo: LOGO, fontes_arquivos: []}), fundo: '#F4F0EA'},
  cenas: [{id: 'a', duracao_ms: 4000, fundo: '#F4F0EA', blocos: [{id: 'a-t', tipo: 'titulo', x: 0.1, y: 0.45, largura: 0.8, em: 0, texto: 'Fundo claro', cor: '#171A19'}]}],
};
const {props} = resolverCenas(doc);
const destino = {id: 'reels', largura: 1080, altura: 1920};
const fontes = fontesDaMarcaDagua(props);
const base = {...configPadraoMarca(destino, fontes), ligada: true};
const preparado = await prepararRender({raizApp: raiz, empacotado: false, aviso: () => undefined});
const medir = async (config, rotulo) => {
  const marca = marcaDaguaDoDestino(config, destino, fontes, 3);
  const r = await medirContrasteDaMarca(preparado, {props: {...props, largura: 1080, altura: 1920}, marca, quadros_ms: quadrosParaMedir(props.duracao_ms), fps: 30});
  log(`${rotulo}: contraste ${r.contraste?.toFixed(2)}:1 (mínimo ${CONTRASTE_MINIMO}) ${r.ok ? 'ok' : 'ABAIXO'} · fundo ${r.fundo?.map(Math.round)} · marca ${r.marca?.map(Math.round)} · quadros ${r.medidas.length}`);
  return r;
};
const sem = await medir(base, 'logo claro em fundo claro, sem placa');
const placa = sem.marca ? placaParaMarca(sem.marca) : 'escura';
log(`placa sugerida: ${placa}`);
const com = await medir({...base, placa}, `logo claro com placa ${placa}`);
// assinatura em branco no fundo claro: o texto branco com sombra mal aparece
const so = await medir({...base, conteudo: 'assinatura'}, 'assinatura branca em fundo claro, sem placa').catch((e) => log(`assinatura: ${e.message}`));
void so;
log(sem.ok ? 'ATENÇÃO: o caso sem placa deveria ficar abaixo de 3:1' : com.ok ? 'pronto: sem placa abaixo de 3:1, com placa acima' : 'ATENÇÃO: com placa continua abaixo de 3:1');
process.exit(sem.ok || !com.ok ? 1 : 0);
