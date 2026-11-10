// Driver CDP do Estúdio (frente Música). Ações em ordem: --reload, --press, --click, --js, --foto, --texto.
// Uso: node scripts/est.mjs '<js>' [--reload] [--press 'k'] [--click 'texto'|@seletor] [--foto nome] [--texto] [--wait ms]
import {chromium} from 'playwright';
const porta = process.env.ESTUDIO_DEPURAR_PORTA ?? '9484';
const navegador = await chromium.connectOverCDP(`http://127.0.0.1:${porta}`);
const pagina = navegador.contexts().flatMap((c) => c.pages()).find((p) => /^(http:\/\/localhost:\d+|file:)/.test(p.url()));
if (!pagina) throw new Error('janela do Estúdio não achada');
const erros = [];
pagina.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && erros.push(`${m.type()}: ${m.text()}`));
pagina.on('pageerror', (e) => erros.push(`pageerror: ${e.message}`));
const arg = (n) => process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : undefined;
const tem = (n) => process.argv.includes(`--${n}`);
const espera = Number(arg('wait') ?? 800);

if (tem('reload')) {
  await pagina.reload({waitUntil: 'load'});
  await pagina.waitForTimeout(2200);
}
if (tem('press')) {
  await pagina.keyboard.press(arg('press'));
  await pagina.waitForTimeout(500);
}
if (tem('click')) {
  const alvo = arg('click');
  if (alvo.startsWith('@')) {
    await pagina.locator(alvo.slice(1)).first().click();
  } else {
    await pagina.evaluate((t) => {
      const el = [...document.querySelectorAll('button, [role="button"], .aba, .item')]
        .find((b) => b.textContent?.trim().startsWith(t) || b.textContent?.trim() === t);
      if (el) el.click();
    }, alvo);
  }
  await pagina.waitForTimeout(600);
}
const js = process.argv[2];
if (js) {
  try {
    const r = await pagina.evaluate(js);
    console.log('RESULT:', JSON.stringify(r, null, 2));
  } catch (e) {
    console.log('JSERR:', e.message);
  }
  await pagina.waitForTimeout(espera);
}
if (tem('foto')) await pagina.screenshot({path: `testes/saida/${arg('foto')}.png`});
if (tem('texto')) console.log('TEXTO:', JSON.stringify(await pagina.evaluate(() => document.body.innerText.slice(0, 8000))));
console.log('ERROS:', erros.length ? erros.slice(0, 40).join(' | ') : 'nenhum');
await navegador.close().catch(() => undefined);
await new Promise((r) => setTimeout(r, 50));
