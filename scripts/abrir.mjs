// Abre um projeto no app: chama window.estudio.abrirProjeto e recarrega a página (o boot relê o projetoAtual).
// Uso: ESTUDIO_DEPURAR_PORTA=9484 node scripts/abrir.mjs '<raiz>'
import {chromium} from 'playwright';

const porta = process.env.ESTUDIO_DEPURAR_PORTA ?? '9484';
const raiz = process.argv[2];
if (!raiz) throw new Error('use: node scripts/abrir.mjs <raiz>');
const navegador = await chromium.connectOverCDP(`http://127.0.0.1:${porta}`);
const pagina = navegador.contexts().flatMap((c) => c.pages()).find((p) => /^(http:\/\/localhost:\d+|file:)/.test(p.url()));
if (!pagina) throw new Error('janela do Estúdio não achada');
const r = await pagina.evaluate(async (x) => {
  const info = await window.estudio.abrirProjeto(x);
  return {raiz: info.raiz, docs: info.manifesto.documentos.map((d) => `${d.modulo}:${d.id}`)};
}, raiz);
console.log('aberto:', JSON.stringify(r));
await pagina.reload({waitUntil: 'load'});
await pagina.waitForTimeout(3000);
console.log('reaberto. area/texto:', JSON.stringify(await pagina.evaluate(() => document.body.innerText.slice(0, 120))));
await navegador.close().catch(() => undefined);
process.exit(0);
