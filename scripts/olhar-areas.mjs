// Fotografa as quatro áreas e exercita a Imagem (selecionar camada) e os Efeitos (aplicar o pré-ajuste Cinema).
import {chromium} from 'playwright';

const navegador = await chromium.connectOverCDP(`http://127.0.0.1:${process.env.ESTUDIO_DEPURAR_PORTA ?? '9471'}`);
const p = navegador.contexts().flatMap((c) => c.pages()).find((x) => /^(http:\/\/localhost:\d+|file:)/.test(x.url()));
const erros = [];
p.on('pageerror', (e) => erros.push(e.message));
p.on('console', (m) => m.type() === 'error' && erros.push(m.text().slice(0, 200)));
const area = async (i) => {
  await p.locator('.areas button').nth(i).click();
  await p.waitForTimeout(2000);
};

await area(1);
await p.locator('.dv-tab', {hasText: 'Camadas'}).first().click().catch(() => undefined);
await p.locator('text=Título').first().click().catch(() => undefined);
await p.waitForTimeout(800);
await p.screenshot({path: 'testes/saida/area-imagem.png'});

await area(3);
await p.locator('button', {hasText: 'Cinema'}).first().click();
await p.waitForTimeout(2500);
await p.screenshot({path: 'testes/saida/area-efeitos.png'});
console.log(erros.length ? `erros: ${erros.slice(0, 6).join(' | ')}` : 'sem erros na página');
await area(0);
await navegador.close().catch(() => undefined);
