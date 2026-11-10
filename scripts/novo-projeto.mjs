// Cria um projeto de teste (modelo video-branco) em testes/saida/projetos e o abre no app. Uso: node scripts/novo-projeto.mjs "Nome"
import {chromium} from 'playwright';
const nav = await chromium.connectOverCDP(`http://127.0.0.1:${process.env.ESTUDIO_DEPURAR_PORTA ?? '9484'}`);
const p = nav.contexts().flatMap((c) => c.pages()).find((x) => /^(http:\/\/localhost:\d+|file:)/.test(x.url()));
const nome = process.argv[2] ?? 'Batida Teste';
const r = await p.evaluate(async ({nome, pasta}) => {
  const info = await window.estudio.criarProjeto({modelo: 'video-branco', pasta, nome});
  return info?.raiz ?? info;
}, {nome, pasta: `${process.cwd()}/testes/saida/projetos`});
console.log('criado:', JSON.stringify(r));
await nav.close().catch(() => undefined);
process.exit(0);
