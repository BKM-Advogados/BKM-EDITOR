// Gera build/icone.icns (o ícone do Estudio.app) a partir de build/icone.png (1024×1024), sem precisar de Mac: cada
// tamanho sai em PNG pelo ImageMagick (magick) e o contêiner ICNS é montado aqui (cabeçalho "icns" + blocos tipo,
// tamanho e PNG, os mesmos tipos que o iconutil da Apple grava). O .icns vai para o repositório, como o .ico; este script
// só roda quando o ícone muda.
//   node scripts/gerar-icns.mjs
// No Mac dá para conferir com: iconutil -c iconset build/icone.icns
import {execFileSync} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const origem = path.join(raiz, 'build', 'icone.png');
const destino = path.join(raiz, 'build', 'icone.icns');

// tipo ICNS → lado em pixels (os "@2x" do iconset são os ic11 a ic14 e o ic10)
const TIPOS = [['icp4', 16], ['icp5', 32], ['ic11', 32], ['ic12', 64], ['ic07', 128], ['ic13', 256], ['ic08', 256], ['ic14', 512], ['ic09', 512],
  ['ic10', 1024]];

const png = (lado) => (lado === 1024 ? readFileSync(origem)
  : execFileSync('magick', [origem, '-filter', 'Lanczos', '-resize', `${lado}x${lado}`, '-strip', 'png32:-'], {maxBuffer: 64 << 20}));

const blocos = TIPOS.map(([tipo, lado]) => {
  const dados = png(lado);
  const cabeca = Buffer.alloc(8);
  cabeca.write(tipo, 0, 'ascii');
  cabeca.writeUInt32BE(dados.length + 8, 4);
  return Buffer.concat([cabeca, dados]);
});
const total = 8 + blocos.reduce((s, b) => s + b.length, 0);
const cabeca = Buffer.alloc(8);
cabeca.write('icns', 0, 'ascii');
cabeca.writeUInt32BE(total, 4);
writeFileSync(destino, Buffer.concat([cabeca, ...blocos]));
console.log(`${path.relative(raiz, destino)}: ${TIPOS.length} tamanhos, ${Math.round(total / 1024)} KB`);
