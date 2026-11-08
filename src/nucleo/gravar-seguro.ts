// Gravação atômica que aguenta arquivo preso (transversal-D8): projeto no OneDrive ou com o antivírus lendo o JSON faz o
// rename do Windows dar EPERM/EBUSY/EACCES por alguns milissegundos. Em vez de perder a edição, tenta de novo com espera
// curta (20, 40, 80, 160 e 320 ms: menos de 1 s no pior caso). Acabou o prazo, apaga o temporário e diz o que houve.
import {renameSync, rmSync, writeFileSync} from 'node:fs';

/** Erros do Windows e do OneDrive que passam sozinhos quando o outro processo solta o arquivo. */
export const CODIGOS_DE_ARQUIVO_PRESO = ['EPERM', 'EBUSY', 'EACCES'];
export const ESPERAS_MS = [20, 40, 80, 160, 320];

type Sistema = {
  renomear: (de: string, para: string) => void;
  esperar: (ms: number) => void;
};

const SISTEMA: Sistema = {
  renomear: renameSync,
  // a gravação do projeto é síncrona (o observador e o diário contam com isso): espera sem ocupar o processador
  esperar: (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms),
};

const preso = (e: unknown) => CODIGOS_DE_ARQUIVO_PRESO.includes((e as NodeJS.ErrnoException)?.code ?? '');

/** Troca `tmp` por `destino` tentando de novo enquanto o arquivo estiver preso; devolve quantas tentativas a mais precisou. */
export const renomearComRetry = (tmp: string, destino: string, sistema: Sistema = SISTEMA): number => {
  for (let tentativa = 0; ; tentativa++) {
    try {
      sistema.renomear(tmp, destino);
      return tentativa;
    } catch (e) {
      if (!preso(e) || tentativa >= ESPERAS_MS.length) throw e;
      sistema.esperar(ESPERAS_MS[tentativa]);
    }
  }
};

/** Escreve em `abs.<pid>.tmp` e troca pelo destino; se não der, o temporário não fica na pasta do projeto. */
export const gravarAtomico = (abs: string, texto: string, sistema: Sistema = SISTEMA, escrever: typeof writeFileSync = writeFileSync): void => {
  const tmp = `${abs}.${process.pid}.tmp`;
  try {
    escrever(tmp, texto, 'utf-8');
    renomearComRetry(tmp, abs, sistema);
  } catch (e) {
    try {
      rmSync(tmp, {force: true});
    } catch {
      /* o temporário também está preso: o .tmp está no .gitignore e o próximo salvamento o troca */
    }
    if (preso(e)) {
      throw new Error(`o arquivo está em uso por outro programa (OneDrive ou antivírus?) e não deu para gravar: ${abs}. Tente de novo em instantes`);
    }
    throw e;
  }
};
