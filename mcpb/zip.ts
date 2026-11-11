// Zip mínimo para o .mcpb (um zip com manifest.json, server/ e o ícone), sem dependência: deflate do zlib do Node e o
// formato clássico (sem zip64; a extensão tem poucos KB). Nomes em UTF-8 (bit 11) e barra normal, como pede o formato.
import {crc32, deflateRawSync, inflateRawSync} from 'node:zlib';

export type Entrada = {nome: string; dados: Buffer};

const DATA_DOS = (() => {
  // 01/01/2026 00:00, fixa: o mesmo conteúdo dá o mesmo .mcpb
  const data = ((2026 - 1980) << 9) | (1 << 5) | 1;
  return {hora: 0, data};
})();

export const zipar = (entradas: Entrada[]): Buffer => {
  const locais: Buffer[] = [];
  const centrais: Buffer[] = [];
  let pos = 0;
  for (const e of entradas) {
    const nome = Buffer.from(e.nome.replace(/\\/g, '/'), 'utf-8');
    const comprimido = deflateRawSync(e.dados, {level: 9});
    const crc = crc32(e.dados) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // versão para extrair
    local.writeUInt16LE(0x0800, 6); // nome em UTF-8
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(DATA_DOS.hora, 10);
    local.writeUInt16LE(DATA_DOS.data, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comprimido.length, 18);
    local.writeUInt32LE(e.dados.length, 22);
    local.writeUInt16LE(nome.length, 26);
    local.writeUInt16LE(0, 28);
    locais.push(local, nome, comprimido);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x031e, 4); // feito no Unix, versão 3.0
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(DATA_DOS.hora, 12);
    central.writeUInt16LE(DATA_DOS.data, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comprimido.length, 20);
    central.writeUInt32LE(e.dados.length, 24);
    central.writeUInt16LE(nome.length, 28);
    central.writeUInt32LE(((0o100644 << 16) >>> 0), 38); // arquivo comum, rw-r--r--
    central.writeUInt32LE(pos, 42);
    centrais.push(central, nome);
    pos += local.length + nome.length + comprimido.length;
  }
  const diretorio = Buffer.concat(centrais);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(entradas.length, 8);
  fim.writeUInt16LE(entradas.length, 10);
  fim.writeUInt32LE(diretorio.length, 12);
  fim.writeUInt32LE(pos, 16);
  return Buffer.concat([...locais, diretorio, fim]);
};

/** Lê um zip pelo diretório central (stored e deflate): para os testes conferirem o .mcpb gerado. */
export const deszipar = (zip: Buffer): Entrada[] => {
  const fim = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (fim < 0) throw new Error('não é um zip (sem o fim do diretório central)');
  const total = zip.readUInt16LE(fim + 10);
  let p = zip.readUInt32LE(fim + 16);
  const r: Entrada[] = [];
  for (let i = 0; i < total; i++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error('diretório central estragado');
    const metodo = zip.readUInt16LE(p + 10);
    const crc = zip.readUInt32LE(p + 16);
    const tamanho = zip.readUInt32LE(p + 20);
    const nomeLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const comentLen = zip.readUInt16LE(p + 32);
    const local = zip.readUInt32LE(p + 42);
    const nome = zip.subarray(p + 46, p + 46 + nomeLen).toString('utf-8');
    const ini = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const bruto = zip.subarray(ini, ini + tamanho);
    const dados = metodo === 8 ? inflateRawSync(bruto) : Buffer.from(bruto);
    if ((crc32(dados) >>> 0) !== crc) throw new Error(`CRC errado em ${nome}`);
    r.push({nome, dados});
    p += 46 + nomeLen + extraLen + comentLen;
  }
  return r;
};
