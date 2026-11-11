// "claude" no meio de um turno longo (testes/agentes-ciclo.test.ts): não sai no fim do stdin, como uma ferramenta demorada
import {writeFileSync} from 'node:fs';
writeFileSync(process.argv[2], String(process.pid));
process.stdin.resume();
process.stdin.on('end', () => { /* termina o turno antes de sair */ });
setTimeout(() => process.exit(0), 20000);
