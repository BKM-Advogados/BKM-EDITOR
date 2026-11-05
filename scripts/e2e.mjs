// Ponta a ponta na janela do Estúdio em desenvolvimento (ESTUDIO_DEPURAR_PORTA): seleciona o bloco do 25%, edita no
// inspector, comenta na tela e confere que tudo virou arquivo e diário; depois muda o roteiro "por fora" (como o agente
// faz) e confere que a tela acompanha. Fotos em testes/saida/e2e-*.png.
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright';

const porta = process.env.ESTUDIO_DEPURAR_PORTA ?? '9471';
const projeto = process.env.ESTUDIO_PROJETO ?? path.resolve('testes/saida/exemplo');
const ler = (rel) => JSON.parse(readFileSync(path.join(projeto, rel), 'utf-8'));
const navegador = await chromium.connectOverCDP(`http://127.0.0.1:${porta}`);
const p = navegador.contexts().flatMap((c) => c.pages()).find((x) => /^(http:\/\/localhost:5173|file:)/.test(x.url()));
if (!p) throw new Error('janela do Estúdio não achada');
const erros = [];
p.on('pageerror', (e) => erros.push(e.message));
const foto = (n) => p.screenshot({path: `testes/saida/e2e-${n}.png`});
const passo = (t) => console.log(`✔ ${t}`);
const falha = (t) => {
  console.log(`✘ ${t}`);
  process.exitCode = 1;
};

await p.evaluate(() => localStorage.clear());
await p.reload();
await p.waitForSelector('.dockview-theme-estudio', {timeout: 20000});
await p.waitForTimeout(2500);

// 1. lista → bloco numero (25%) selecionado e a prévia vai ao tempo dele
await p.locator('.dv-tab', {hasText: 'Cenas e blocos'}).first().click();
await p.locator('.lista li.sub', {hasText: 'numero'}).first().click();
await p.waitForTimeout(1500);
const sel = await p.locator('.caixa-sel').count();
sel ? passo('bloco do 25% selecionado na prévia') : falha('sem caixa de seleção na prévia');
await foto('1-selecao');

// 2. propriedades: y 860 → 900 grava no roteiro e no diário
await p.locator('.dv-tab', {hasText: 'Propriedades'}).first().click();
const campoY = p.locator('label.linha-campo', {hasText: /^y$/}).locator('input');
await campoY.fill('900');
await campoY.press('Enter');
await p.waitForTimeout(800);
const y = ler('video/roteiro.json').cenas[2].blocos[1].y;
y === 900 ? passo('edição no inspector gravou y=900 no roteiro.json') : falha(`y no arquivo = ${y}`);
const ultimo = readFileSync(path.join(projeto, '.estudio/diario.jsonl'), 'utf-8').trim().split('\n').pop();
JSON.parse(ultimo).autor === 'pessoa' ? passo('diário registrou a pessoa') : falha('diário sem a edição');

// 3. comentário na tela (M + clique + texto + Ctrl+Enter)
await p.keyboard.press('Escape');
await p.locator('.palco').click({position: {x: 5, y: 5}});
await p.keyboard.press('m');
const palco = await p.locator('.palco').boundingBox();
await p.mouse.click(palco.x + palco.width * 0.5, palco.y + palco.height * 0.5);
await p.locator('.balao textarea').fill('o 25% entra cedo demais');
await p.keyboard.press('Control+Enter');
await p.waitForTimeout(800);
const cmts = ler('comentarios.json').comentarios;
cmts.length === 1 && cmts[0].alvo.tempo_ms > 0 ? passo(`comentário ${cmts[0].id} gravado com tempo ${cmts[0].alvo.tempo_ms} ms e objeto ${cmts[0].alvo.objeto ?? '—'}`) : falha('comentário não gravado');
await foto('2-comentario');

// 4. mudança por fora (como o agente): o texto do bloco muda no arquivo e a tela relê
const {Projeto} = await import('../src/nucleo/projeto.ts');
if (Projeto) {
  const pr = new Projeto(projeto);
  const {versao} = pr.lerJson('video/roteiro.json');
  pr.aplicarPatch({documento: 'carrossel', versao_base: versao, autor: 'agente', origem: 'e2e', rotulo: 'rótulo do 25% pelo agente',
    patch: [{op: 'replace', path: '/cenas/2/blocos/1/rotulo', value: 'DE ADICIONAL (AGENTE)'}]});
  await p.waitForTimeout(1500);
  const visto = await p.locator('.palco').innerText();
  visto.includes('DE ADICIONAL (AGENTE)') ? passo('mudança feita por fora apareceu na prévia') : falha('a prévia não acompanhou a mudança de fora');
  await foto('3-agente');
}

// 5. troca de área: 2, 3, 4 e volta
for (const [tecla, nome] of [['2', 'imagem'], ['3', '3d'], ['4', 'efeitos'], ['1', 'video']]) {
  await p.locator('.barra').click({position: {x: 300, y: 10}});
  await p.keyboard.press(tecla);
  await p.waitForTimeout(nome === '3d' ? 2500 : 1200);
  await foto(`4-area-${nome}`);
}
passo('áreas trocadas (fotos e2e-4-*)');
if (erros.length) falha(`erros na página: ${erros.slice(0, 5).join(' | ')}`);
await navegador.close().catch(() => undefined);
