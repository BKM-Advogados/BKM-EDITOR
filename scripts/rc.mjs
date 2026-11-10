// Mini-driver: node scripts/rc.mjs <passos.json|js inline> — executa ações reais (mouse/teclado) por Playwright/CDP.
// Ações: {click:[x,y]} {dbl:[x,y]} {texto:"botão"} {press:"Space"} {type:"txt"} {wait:ms} {foto:"nome"} {js:"..."} {drag:[x1,y1,x2,y2]} {move:[x,y]}
import {chromium} from 'playwright';
const porta = process.env.ESTUDIO_DEPURAR_PORTA ?? '9484';
const nav = await chromium.connectOverCDP(`http://127.0.0.1:${porta}`);
const p = nav.contexts().flatMap((c) => c.pages()).find((x) => /^(http:\/\/localhost:\d+|file:)/.test(x.url()));
const erros = [];
p.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && erros.push(`${m.type()}: ${m.text().slice(0, 300)}`));
p.on('pageerror', (e) => erros.push(`pageerror: ${e.message}`));
const passos = JSON.parse(process.argv[2]);
const K = await p.evaluate(() => devicePixelRatio); // coordenadas são as da foto (pixels da tela); o mouse usa px CSS
const S = (v) => v / K;
for (const a of passos) {
  if (a.click) await p.mouse.click(S(a.click[0]), S(a.click[1]));
  else if (a.dbl) await p.mouse.dblclick(S(a.dbl[0]), S(a.dbl[1]));
  else if (a.rclick) await p.mouse.click(S(a.rclick[0]), S(a.rclick[1]), {button: 'right'});
  else if (a.move) await p.mouse.move(S(a.move[0]), S(a.move[1]));
  else if (a.drag) {
    const [x1, y1, x2, y2] = a.drag.map(S);
    await p.mouse.move(x1, y1); await p.mouse.down();
    for (let i = 1; i <= 10; i++) await p.mouse.move(x1 + ((x2 - x1) * i) / 10, y1 + ((y2 - y1) * i) / 10);
    await p.mouse.up();
  }
  else if (a.texto) {
    const ok = await p.evaluate((t) => {
      const els = [...document.querySelectorAll('button, [role="button"], [role="tab"], .aba, .item, label, summary, a')];
      const el = els.find((b) => b.textContent?.trim() === t) ?? els.find((b) => b.textContent?.trim().startsWith(t));
      if (!el) return false; el.scrollIntoView({block: 'center'}); el.click(); return true;
    }, a.texto);
    if (!ok) console.log('NÃO ACHEI botão:', a.texto);
  }
  else if (a.title) { const ok = await p.evaluate((t) => { const el = [...document.querySelectorAll('[title],[aria-label]')].find((e) => (e.title || e.getAttribute('aria-label') || '').startsWith(t)); if (!el) return false; el.click(); return true; }, a.title); if (!ok) console.log('NÃO ACHEI title:', a.title); }
  else if (a.sel) { await p.locator('select').nth(a.sel[0]).selectOption({label: a.sel[1]}); }
  else if (a.press) await p.keyboard.press(a.press);
  else if (a.type) await p.keyboard.type(a.type, {delay: 20});
  else if (a.js) { try { console.log('JS:', JSON.stringify(await p.evaluate(a.js))); } catch (e) { console.log('JSERR', e.message); } }
  else if (a.foto) await p.screenshot({path: `testes/saida/fotos/${a.foto}.png`});
  else if (a.textoPagina) console.log('TEXTO:', (await p.evaluate(() => document.body.innerText)).slice(0, a.textoPagina));
  await p.waitForTimeout(a.wait ?? 500);
}
console.log('ERROS:', erros.length ? erros.slice(0, 30).join(' | ') : 'nenhum');
await nav.close().catch(() => undefined);
process.exit(0);
