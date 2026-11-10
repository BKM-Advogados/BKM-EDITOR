// Latência real: do keydown do Espaço (event.timeStamp) até (a) posição andar, (b) o medidor do master ter largura > 0 no DOM
// e (c) pixels do medidor pintados. Usa Space de verdade pelo CDP.
import {chromium} from 'playwright';
const nav = await chromium.connectOverCDP(`http://127.0.0.1:${process.env.ESTUDIO_DEPURAR_PORTA ?? '9484'}`);
const p = nav.contexts().flatMap((c) => c.pages()).find((x) => /^(http:\/\/localhost:\d+|file:)/.test(x.url()));
await p.keyboard.press('Home'); await p.waitForTimeout(300);
await p.evaluate(() => {
  window.__lat = {};
  addEventListener('keydown', (e) => { if (e.code === 'Space') { window.__lat.t0 = e.timeStamp; window.__lat.fim = false; } }, {capture: true, once: false});
  const m = () => import('/src/renderer/modulos/musica/motor.ts');
  (async () => {
    const {motor} = await m();
    const olhar = () => {
      const L = window.__lat;
      if (L.t0 !== undefined && !L.fim) {
        const medidores = [...document.querySelectorAll('.nivel-vivo > span')];
        if (L.pos === undefined && motor.estaTocando() && motor.posicao() > 0.001) L.pos = performance.now() - L.t0;
        if (L.estado === undefined && motor.estaTocando()) L.estado = performance.now() - L.t0;
        if (L.medidor === undefined && medidores.some((s) => s.getBoundingClientRect().width > 1 && s.getBoundingClientRect().height > 0)) { L.medidor = performance.now() - L.t0; L.fim = true; }
      }
      requestAnimationFrame(olhar);
    };
    olhar();
  })();
});
await p.evaluate(() => document.querySelectorAll('button').forEach((b) => b.title.startsWith('Mixer')));
await p.getByText('Mixer', {exact: true}).first().click();
await p.waitForTimeout(500);
const medidas = [];
for (let i = 0; i < 5; i++) {
  await p.evaluate(() => { window.__lat = {}; });
  await p.keyboard.press('Space');
  await p.waitForTimeout(1500);
  medidas.push(await p.evaluate(() => ({...window.__lat})));
  await p.keyboard.press('Space');
  await p.waitForTimeout(400);
  await p.keyboard.press('Home');
  await p.waitForTimeout(300);
}
console.log(JSON.stringify(medidas.map((m) => ({estado_ms: Math.round(m.estado), pos_ms: Math.round(m.pos), medidor_ms: Math.round(m.medidor)}))));
await nav.close().catch(() => undefined);
process.exit(0);
