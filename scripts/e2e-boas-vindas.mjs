// O caminho de quem abre o app pela primeira vez: tela de boas-vindas → "Ver um exemplo" → área de vídeo com o exemplo.
// Uso: com o app aberto sem ESTUDIO_PROJETO e com ESTUDIO_DEPURAR_PORTA (o exemplo vai para a pasta de projetos, com o
// nome de src/nucleo/exemplo.ts). Sem o exemplo empacotado o botão não aparece, e o script diz isso. Depois abre o exemplo
// de novo (agora pelo app, como faz o menu do ícone) e confere que a segunda vez é outra pasta: cada clique, uma cópia.
import {chromium} from 'playwright';

const navegador = await chromium.connectOverCDP(`http://127.0.0.1:${process.env.ESTUDIO_DEPURAR_PORTA ?? '9471'}`);
const p = navegador.contexts().flatMap((c) => c.pages()).find((x) => /^(http:\/\/localhost:\d+|file:)/.test(x.url()));
const erros = [];
p.on('pageerror', (e) => erros.push(e.message));
p.on('console', (m) => m.type() === 'error' && erros.push(m.text().slice(0, 200)));

// o botão aparece em mais de um lugar da tela inicial (transversal-D21: antes se chamava "Abrir o exemplo"): vale o primeiro
if (!(await p.locator('button', {hasText: 'Ver um exemplo'}).count())) {
  console.log('✘ esta instalação não traz o projeto de exemplo (exemplos/, src/nucleo/exemplo.ts): "Ver um exemplo" não aparece');
  await navegador.close().catch(() => undefined);
  process.exit(1);
}
await p.locator('button', {hasText: 'Ver um exemplo'}).first().click();
await p.locator('.areas').waitFor({timeout: 20000});
await p.waitForTimeout(5000);
// as cenas do exemplo (src/nucleo/exemplo-conteudo.ts) aparecem pelo nome na linha do tempo
const abertura = await p.locator('text=Abertura').count();
await p.screenshot({path: 'testes/saida/boas-vindas-exemplo.png'});
console.log(abertura ? '✔ exemplo aberto, cenas na linha do tempo' : '✘ exemplo aberto sem as cenas na linha do tempo');
const primeira = await p.evaluate(() => window.estudio.projetoAtual().then((i) => i?.raiz));
const segunda = await p.evaluate(() => window.estudio.abrirExemplo().then((i) => i.raiz));
console.log(primeira && segunda && primeira !== segunda ? `✔ cada clique cria uma cópia nova (${segunda})` : `✘ o exemplo abriu a mesma pasta duas vezes (${segunda})`);
console.log(erros.length ? `erros: ${erros.slice(0, 6).join(' | ')}` : '✔ sem erros na página');
await navegador.close().catch(() => undefined);
