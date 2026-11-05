// Conecta na janela do Estúdio em desenvolvimento (ESTUDIO_DEPURAR_PORTA) e tira uma foto da tela, com os erros do
// console. Uso: node scripts/olhar.mjs [nome] [espera_ms] [js para rodar antes da foto]
import {chromium} from 'playwright';

const [nome = 'tela', espera = '1500', js] = process.argv.slice(2);
const porta = process.env.ESTUDIO_DEPURAR_PORTA ?? '9471';
const navegador = await chromium.connectOverCDP(`http://127.0.0.1:${porta}`);
// só a janela do Estúdio (dev server do Vite ou arquivo empacotado), nunca outro navegador que use a mesma porta
const pagina = navegador.contexts().flatMap((c) => c.pages()).find((p) => /^(http:\/\/localhost:5173|file:)/.test(p.url()));
if (!pagina) throw new Error('janela do Estúdio não achada');
const erros = [];
pagina.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && erros.push(`${m.type()}: ${m.text()}`));
pagina.on('pageerror', (e) => erros.push(`pageerror: ${e.message}`));
if (js) console.log('js →', JSON.stringify(await pagina.evaluate(js)));
await pagina.waitForTimeout(Number(espera));
await pagina.screenshot({path: `testes/saida/${nome}.png`});
console.log(`foto: testes/saida/${nome}.png`, await pagina.evaluate(() => `${innerWidth}x${innerHeight}`));
if (erros.length) console.log(erros.slice(0, 20).join('\n'));
await navegador.close().catch(() => undefined);
process.exit(0);
