// Clica num item da lista de cenas e fotografa a prévia depois de um tempo, para depurar a busca do Player.
// Uso: node scripts/olhar-acao.mjs <texto do item> <espera_ms> <nome>
import {chromium} from 'playwright';

const [texto = 'numero', espera = '3000', nome = 'acao'] = process.argv.slice(2);
const navegador = await chromium.connectOverCDP(`http://127.0.0.1:${process.env.ESTUDIO_DEPURAR_PORTA ?? '9471'}`);
const p = navegador.contexts().flatMap((c) => c.pages()).find((x) => /^(http:\/\/localhost:5173|file:)/.test(x.url()));
const msgs = [];
p.on('console', (m) => msgs.push(`${m.type()}: ${m.text().slice(0, 300)}`));
p.on('pageerror', (e) => msgs.push(`pageerror: ${e.message}`));
await p.locator('.dv-tab', {hasText: 'Cenas e blocos'}).first().click();
await p.locator('.lista li', {hasText: texto}).first().click();
await p.waitForTimeout(Number(espera));
const info = await p.evaluate(() => {
  const palco = document.querySelector('.palco');
  return {texto: palco?.innerText.slice(0, 200), origens: palco?.querySelectorAll('[data-origem]').length, tempo: document.querySelector('.controles .tempo')?.textContent};
});
console.log(JSON.stringify(info));
await p.screenshot({path: `testes/saida/${nome}.png`});
console.log(msgs.filter((m) => !m.includes('acknowledge')).slice(0, 15).join('\n'));
await navegador.close().catch(() => undefined);
