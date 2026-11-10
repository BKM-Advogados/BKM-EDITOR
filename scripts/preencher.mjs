// Preenche o campo de Acordes da música ativa (ou qualquer input por rótulo) e dá blur. Uso com o app aberto.
import {chromium} from 'playwright';
const porta = process.env.ESTUDIO_DEPURAR_PORTA ?? '9484';
const [rotulo, texto] = process.argv.slice(2);
const navegador = await chromium.connectOverCDP(`http://127.0.0.1:${porta}`);
const pagina = navegador.contexts().flatMap((c) => c.pages()).find((p) => /^(http:\/\/localhost:\d+|file:)/.test(p.url()));
if (!pagina) throw new Error('janela não achada');
const inp = pagina.locator('label', {hasText: rotulo}).locator('input').first();
await inp.fill(texto);
await inp.blur();
await pagina.waitForTimeout(900);
console.log('preenchido:', rotulo, '=', texto);
await navegador.close().catch(() => undefined);
process.exit(0);
