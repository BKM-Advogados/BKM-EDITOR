// Um "escritor" (o app ou o MCP por stdio da IDE) gravando no mesmo projeto que outro processo (testes/trava-escrita.test.ts).
// Uso: tsx corrida-escrita.ts <pasta> <n> <livre|versao> <nome>
import {Projeto} from '../../src/nucleo/projeto';

const [pasta, nStr, modo, nome] = process.argv.slice(2);
const p = new Projeto(pasta);
let ok = 0;
let conflitos = 0;
let outros = 0;
for (let i = 0; i < Number(nStr); i++) {
  try {
    const versao_base = modo === 'versao' ? p.lerJson('d.json').versao : undefined;
    p.aplicarPatch({documento: 'd', versao_base, patch: [{op: 'add', path: '/itens/-', value: `${nome}-${i}`}], autor: nome, origem: nome});
    ok++;
  } catch (e) {
    if ((e as {codigo?: string}).codigo === 'conflito') conflitos++;
    else {
      outros++;
      process.stderr.write(`${(e as Error).message}\n`);
    }
  }
}
process.stdout.write(JSON.stringify({nome, ok, conflitos, outros}));
