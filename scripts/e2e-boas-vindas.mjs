// O caminho de quem abre o app pela primeira vez: tela de boas-vindas → "Abrir o exemplo" → área de vídeo com o C2.
// Uso: com o app aberto sem ESTUDIO_PROJETO e com ESTUDIO_DEPURAR_PORTA (o exemplo vai para %USERPROFILE%\Estudio\exemplo).
import {chromium} from 'playwright';

const navegador = await chromium.connectOverCDP(`http://127.0.0.1:${process.env.ESTUDIO_DEPURAR_PORTA ?? '9471'}`);
const p = navegador.contexts().flatMap((c) => c.pages()).find((x) => /^(http:\/\/localhost:\d+|file:)/.test(x.url()));
const erros = [];
p.on('pageerror', (e) => erros.push(e.message));
p.on('console', (m) => m.type() === 'error' && erros.push(m.text().slice(0, 200)));

await p.locator('button', {hasText: 'Abrir o exemplo'}).click();
await p.locator('.areas').waitFor({timeout: 20000});
await p.waitForTimeout(5000);
// o quadro 0 é a abertura, ainda sem blocos na prévia: a linha do tempo mostra se o roteiro carregou
const gancho = await p.locator('text=gancho').count();
await p.screenshot({path: 'testes/saida/boas-vindas-exemplo.png'});
console.log(gancho ? '✔ exemplo aberto, roteiro na linha do tempo' : '✘ exemplo aberto sem o roteiro na linha do tempo');
console.log(erros.length ? `erros: ${erros.slice(0, 6).join(' | ')}` : '✔ sem erros na página');
await navegador.close().catch(() => undefined);
