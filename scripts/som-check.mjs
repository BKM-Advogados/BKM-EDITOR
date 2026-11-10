// Mede o som da Música no app: aperta Espaço, amostra posição e níveis do motor, e a latência até o medidor andar.
// Uso: ESTUDIO_DEPURAR_PORTA=9484 node scripts/som-check.mjs
import {chromium} from 'playwright';

const porta = process.env.ESTUDIO_DEPURAR_PORTA ?? '9484';
const navegador = await chromium.connectOverCDP(`http://127.0.0.1:${porta}`);
const pagina = navegador.contexts().flatMap((c) => c.pages()).find((p) => /^(http:\/\/localhost:\d+|file:)/.test(p.url()));
if (!pagina) throw new Error('janela do Estúdio não achada');

const motor = async () => {
  const m = await import('/src/renderer/modulos/musica/motor.ts');
  const mo = m.motor;
  return {
    ctxState: mo.ctx?.state ?? null,
    tocando: Boolean(mo.tocando),
    posicao: mo.posicao(),
    estaTocando: mo.estaTocando(),
    nivelMaster: mo.nivelEm(mo.posicao()),
    nivelBateria: mo.nivelEm(mo.posicao(), 'bateria'),
    nivelBaixo: mo.nivelEm(mo.posicao(), 'baixo'),
    nivelPad: mo.nivelEm(mo.posicao(), 'acordes'),
    sampleRate: mo.ctx?.sampleRate ?? null,
    outputLatency: mo.ctx?.outputLatency ?? null,
    baseLatency: mo.ctx?.baseLatency ?? null,
  };
};

console.log('antes de tocar:', JSON.stringify(await pagina.evaluate(motor)));

// aperta Espaço e amostra
const t0 = Date.now();
await pagina.keyboard.press('Space');

const amostras = [];
for (let i = 0; i < 40; i++) {
  const t = Date.now() - t0;
  const s = await pagina.evaluate(motor);
  amostras.push({t, posicao: s.posicao, tocando: s.tocando, nivelMaster: s.nivelMaster});
  await pagina.waitForTimeout(50);
}

// primeira amostra com posição > 0 (o medidor anda quando a posição anda e há nível)
const andou = amostras.find((a) => a.posicao > 0.005);
const nivelou = amostras.find((a) => a.nivelMaster !== null && a.nivelMaster > -48);
console.log('primeira posição andou em (ms):', andou ? andou.t : null);
console.log('primeiro nível medido em (ms):', nivelou ? nivelou.t : null);
console.log('amostras (t, posicao, nivelMaster):');
for (const a of amostras.filter((_, i) => i % 4 === 0)) console.log(`  ${a.t}ms  pos=${a.posicao.toFixed(3)}  ${a.tocando ? 'tocando' : 'parado'}  m=${a.nivelMaster === null ? 'null' : a.nivelMaster.toFixed(1)}`);

// para
await pagina.keyboard.press('Space');
await pagina.waitForTimeout(300);
console.log('depois de parar:', JSON.stringify(await pagina.evaluate(motor)));
await navegador.close().catch(() => undefined);
process.exit(0);
