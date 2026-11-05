// Ponta a ponta com o Claude de verdade, pela conversa (usa a conta da pessoa logada no Claude Code): pede para
// resolver o comentário aberto e espera o comentário virar "resolvido" e o roteiro mudar pelo MCP do app.
// Uso: tsx scripts/e2e-claude.mjs   (com o app aberto em ESTUDIO_DEPURAR_PORTA e o projeto em ESTUDIO_PROJETO)
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright';

const projeto = process.env.ESTUDIO_PROJETO ?? path.resolve('testes/saida/exemplo');
const ler = (rel) => JSON.parse(readFileSync(path.join(projeto, rel), 'utf-8'));
const navegador = await chromium.connectOverCDP(`http://127.0.0.1:${process.env.ESTUDIO_DEPURAR_PORTA ?? '9471'}`);
const p = navegador.contexts().flatMap((c) => c.pages()).find((x) => /^(http:\/\/localhost:\d+|file:)/.test(x.url()));

const abertos = ler('comentarios.json').comentarios.filter((c) => c.estado === 'aberto');
if (!abertos.length) throw new Error('nenhum comentário aberto para o teste');
const c = abertos[0];

const caixa = p.locator('.conversa .caixa-pedido textarea');
await caixa.waitFor({timeout: 20000});
await caixa.fill(`Resolva o comentário ${c.id} do projeto usando as ferramentas do MCP estudio (ler_comentario, ler_documento, aplicar_patch com versao_base e test, responder_comentario e resolver_comentario). Seja breve.`);
await caixa.press('Enter');
console.log(`pedido enviado: ${c.id} "${c.texto}"`);
await p.screenshot({path: 'testes/saida/claude-1-pedido.png'});

const inicio = Date.now();
let resolvido = false;
while (Date.now() - inicio < 240000) {
  await p.waitForTimeout(5000);
  const permissao = p.locator('.permissao:not(.decidida) .bt.principal');
  if (await permissao.count()) {
    console.log(`pedido de permissão: ${await p.locator('.permissao:not(.decidida) .perm-topo').first().innerText()} → permitido`);
    await permissao.first().click();
  }
  const atual = ler('comentarios.json').comentarios.find((x) => x.id === c.id);
  if (atual?.estado === 'resolvido') {
    resolvido = true;
    console.log(`✔ ${c.id} resolvido em ${Math.round((Date.now() - inicio) / 1000)} s`);
    console.log(`  respostas: ${atual.respostas.map((r) => `${r.autor}: ${r.texto}`).join(' | ')}`);
    break;
  }
}
const diario = readFileSync(path.join(projeto, '.estudio/diario.jsonl'), 'utf-8').trim().split('\n').map((l) => JSON.parse(l));
const doAgente = diario.filter((e) => e.autor === 'agente' && e.origem.startsWith('Claude'));
console.log(doAgente.length ? `✔ ${doAgente.length} mudança(s) do agente no diário: ${doAgente.map((e) => e.rotulo).join('; ')}` : '✘ nenhuma mudança do agente no diário');
const cartoes = await p.locator('.conversa .acao').count();
console.log(cartoes ? `✔ ${cartoes} cartão(ões) de ação na conversa` : '✘ nenhum cartão de ação na conversa');
if (!resolvido) console.log('✘ o comentário não foi resolvido no tempo');
await p.waitForTimeout(1500);
await p.screenshot({path: 'testes/saida/claude-2-feito.png'});
await navegador.close().catch(() => undefined);
