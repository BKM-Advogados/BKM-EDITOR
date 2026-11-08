// Gera os dados dos ícones do Estúdio a partir do Lucide (licença ISC): a geometria de cada ícone, um caminho SVG por
// elemento ([traços] ou [traços, preenchidos]), para a pintura em canvas (src/renderer/modulos/imagem/icones-geometria.json), e o índice de busca com as etiquetas do
// Lucide (src/nucleo/icones-indice.json). Os dois arquivos vão para o repositório; este script só roda quando o Lucide
// sobe de versão.
// Uso: node scripts/gerar-icones.mjs <pasta do pacote lucide-static descompactado> (a que tem icon-nodes.json e tags.json)
//   ex.: npm pack lucide-static@1.68.0 && tar -xzf lucide-static-1.68.0.tgz -C /tmp/lucide && node scripts/gerar-icones.mjs /tmp/lucide/package
import {readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const origem = process.argv[2];
if (!origem) {
  console.error('Uso: node scripts/gerar-icones.mjs <pasta do lucide-static com icon-nodes.json e tags.json>');
  process.exit(1);
}
const nos = JSON.parse(readFileSync(path.join(origem, 'icon-nodes.json'), 'utf-8'));
const etiquetas = JSON.parse(readFileSync(path.join(origem, 'tags.json'), 'utf-8'));
const versao = JSON.parse(readFileSync(path.join(origem, 'package.json'), 'utf-8')).version;

const n = (v) => String(Math.round(Number(v) * 1000) / 1000);
const elipse = (cx, cy, rx, ry) => `M${n(cx - rx)} ${n(cy)}a${n(rx)} ${n(ry)} 0 1 0 ${n(2 * rx)} 0a${n(rx)} ${n(ry)} 0 1 0 ${n(-2 * rx)} 0Z`;
const retangulo = (x, y, w, h, rx = 0, ry = rx) => {
  rx = Math.min(rx || ry || 0, w / 2);
  ry = Math.min(ry || rx || 0, h / 2);
  if (!rx && !ry) return `M${n(x)} ${n(y)}h${n(w)}v${n(h)}h${n(-w)}Z`;
  return `M${n(x + rx)} ${n(y)}h${n(w - 2 * rx)}a${n(rx)} ${n(ry)} 0 0 1 ${n(rx)} ${n(ry)}v${n(h - 2 * ry)}a${n(rx)} ${n(ry)} 0 0 1 ${n(-rx)} ${n(ry)}h${n(-(w - 2 * rx))}a${n(rx)} ${n(ry)} 0 0 1 ${n(-rx)} ${n(-ry)}v${n(-(h - 2 * ry))}a${n(rx)} ${n(ry)} 0 0 1 ${n(rx)} ${n(-ry)}Z`;
};
const pontos = (p, fechar) => {
  const v = String(p).trim().split(/[\s,]+/).map(Number);
  let d = '';
  for (let i = 0; i + 1 < v.length; i += 2) d += `${i ? 'L' : 'M'}${n(v[i])} ${n(v[i + 1])}`;
  return d + (fechar ? 'Z' : '');
};

/** Um elemento do Lucide → caminho SVG. */
const caminho = (tag, a) => {
  if (tag === 'path') return a.d;
  if (tag === 'circle') return elipse(+a.cx, +a.cy, +a.r, +a.r);
  if (tag === 'ellipse') return elipse(+a.cx, +a.cy, +a.rx, +a.ry);
  if (tag === 'rect') return retangulo(+a.x || 0, +a.y || 0, +a.width, +a.height, a.rx === undefined ? 0 : +a.rx, a.ry === undefined ? undefined : +a.ry);
  if (tag === 'line') return `M${n(a.x1)} ${n(a.y1)}L${n(a.x2)} ${n(a.y2)}`;
  if (tag === 'polyline') return pontos(a.points, false);
  if (tag === 'polygon') return pontos(a.points, true);
  throw new Error(`elemento ${tag} sem conversão`);
};

const icones = {};
const indice = {};
let bytes = 0;
for (const [nome, lista] of Object.entries(nos)) {
  const traco = [];
  const cheio = [];
  for (const [tag, a] of lista) (a.fill && a.fill !== 'none' ? cheio : traco).push(caminho(tag, a));
  // cada elemento fica no seu caminho: um `m` minúsculo no começo de um caminho é absoluto, e colado ao anterior viraria relativo
  icones[nome] = cheio.length ? [traco, cheio] : [traco];
  const palavras = [...new Set((etiquetas[nome] ?? []).flatMap((t) => String(t).toLowerCase().split(/\s+/)))].slice(0, 14);
  indice[nome] = palavras.join(' ');
  bytes += JSON.stringify(icones[nome]).length;
}
const nomes = Object.keys(icones).sort();
const ordenado = (o) => Object.fromEntries(nomes.map((k) => [k, o[k]]));
writeFileSync(path.join(raiz, 'src', 'renderer', 'modulos', 'imagem', 'icones-geometria.json'), `${JSON.stringify({lucide: versao, icones: ordenado(icones)})}\n`);
writeFileSync(path.join(raiz, 'src', 'nucleo', 'icones-indice.json'), `${JSON.stringify({lucide: versao, icones: ordenado(indice)})}\n`);
console.log(`${nomes.length} ícones do Lucide ${versao}; geometria ${(bytes / 1024).toFixed(0)} KB`);
