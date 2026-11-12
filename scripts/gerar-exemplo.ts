// Grava o projeto de exemplo ("Ver um exemplo") em exemplos/exemplo/ a partir de src/nucleo/exemplo-conteudo.ts.
// Uso: npm run exemplo. Apaga a pasta antes, para não sobrar arquivo de uma versão anterior. O forge.config.ts empacota
// exemplos/ com o app; o teste testes/exemplo.test.ts falha se a pasta versionada não for a que este script grava.
import {mkdirSync, rmSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {arquivosDoExemplo} from '../src/nucleo/exemplo-conteudo';
import {EXEMPLO} from '../src/nucleo/exemplo';

const destino = path.join(import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname), '..', 'exemplos', EXEMPLO.pasta);
rmSync(destino, {recursive: true, force: true});
for (const [rel, texto] of Object.entries(arquivosDoExemplo())) {
  const arq = path.join(destino, rel);
  mkdirSync(path.dirname(arq), {recursive: true});
  writeFileSync(arq, texto, 'utf-8');
  console.log(`✔ ${path.join('exemplos', EXEMPLO.pasta, rel)}`);
}
