// Trava de escrita entre processos (auditoria do núcleo, N1). O app e o MCP por stdio da IDE (um ou vários processos)
// gravam na mesma pasta; sem exclusão, o "ler → conferir versão → gravar → número no diário" de um se misturava com o do
// outro e mudanças sumiam do arquivo com o diário dizendo que gravou. Cada operação de escrita do Projeto passa por aqui:
//  - a trava é o arquivo .estudio/escrita.lock, criado com O_EXCL ('wx'), com o pid, a máquina, a hora e uma marca dentro;
//  - é velha se o dono morreu (mesma máquina, process.kill(pid, 0) dá ESRCH) ou se passou de 10 s;
//  - a velha sai por rename atômico (só um processo a leva) e a própria trava é solta por rename e depois apagada: no
//    Windows, apagar um arquivo aberto pelo antivírus deixa o nome preso, e o rename o libera na hora;
//  - quem espera dorme de 2 a ~20 ms com variação, até 3 s; depois desiste com "conflito";
//  - é reentrante no mesmo processo (reverter → aplicar), e a seção dura milissegundos (~1 ms por gravação).
import {randomBytes} from 'node:crypto';
import {closeSync, openSync, readFileSync, renameSync, rmSync, statSync, writeSync} from 'node:fs';
import os from 'node:os';
import {CODIGOS_DE_ARQUIVO_PRESO, ESPERAS_MS} from './gravar-seguro';

export const TRAVA_VELHA_MS = 10_000;
export const TRAVA_PRAZO_MS = 3_000;

const donos = new Map<string, {n: number; marca: string}>();

const dormir = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const codigo = (e: unknown) => (e as NodeJS.ErrnoException)?.code ?? '';

const vivo = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return codigo(e) === 'EPERM'; // existe, só não é nosso
  }
};

const lerTrava = (lock: string) => {
  const [pid, host, em, marca] = readFileSync(lock, 'utf-8').split('\n');
  return {pid: Number(pid), host, em, marca};
};

/** A trava é de um processo que morreu, ou ficou mais de `velhaMs` sem soltar (dono travado, outra máquina, pid
 *  reaproveitado). Arquivo sumido ou ainda sem conteúdo: não é velha, tenta de novo. */
const ehVelha = (lock: string, velhaMs: number) => {
  try {
    const idade = Date.now() - statSync(lock).mtimeMs;
    const d = lerTrava(lock);
    if (d.host === os.hostname() && d.pid > 0 && d.pid !== process.pid && !vivo(d.pid)) return true;
    return idade > velhaMs;
  } catch {
    return false;
  }
};

/** Renomeia e apaga; o rename tenta de novo enquanto o arquivo estiver preso (antivírus, OneDrive). */
const tirar = (lock: string, motivo: string) => {
  const lixo = `${lock}.${motivo}.${process.pid}.${Date.now()}`;
  for (let i = 0; ; i++) {
    try {
      renameSync(lock, lixo);
      break;
    } catch (e) {
      if (!CODIGOS_DE_ARQUIVO_PRESO.includes(codigo(e)) || i >= ESPERAS_MS.length) throw e;
      dormir(ESPERAS_MS[i]);
    }
  }
  try {
    rmSync(lixo, {force: true});
  } catch {
    /* preso: o nome já está livre, o resto sai na próxima */
  }
};

const pegar = (lock: string, o: OpcoesTrava): string => {
  const marca = randomBytes(6).toString('hex');
  const ini = Date.now();
  let presos = 0;
  for (let i = 0; ; i++) {
    let fd: number;
    try {
      fd = openSync(lock, 'wx');
    } catch (e) {
      const c = codigo(e);
      // no Windows, uma trava recém-apagada que o antivírus segura dá EPERM por instantes
      if (c !== 'EEXIST' && !(CODIGOS_DE_ARQUIVO_PRESO.includes(c) && presos++ < ESPERAS_MS.length)) throw e;
      if (c === 'EEXIST' && ehVelha(lock, o.velhaMs ?? TRAVA_VELHA_MS)) {
        try {
          tirar(lock, 'velha');
        } catch {
          /* outro processo levou antes */
        }
        continue;
      }
      if (Date.now() - ini > (o.prazoMs ?? TRAVA_PRAZO_MS)) throw o.ocupada();
      dormir(2 + Math.random() * Math.min(20, 2 + i));
      continue;
    }
    try {
      writeSync(fd, `${process.pid}\n${os.hostname()}\n${new Date().toISOString()}\n${marca}\n`);
    } finally {
      closeSync(fd);
    }
    return marca;
  }
};

const soltar = (lock: string, marca: string) => {
  try {
    if (lerTrava(lock).marca !== marca) return; // ficamos tempo demais e outro levou a trava como velha: ela é dele
    tirar(lock, 'solta');
  } catch {
    /* sumiu ou presa: a regra da idade a leva */
  }
};

export type OpcoesTrava = {prazoMs?: number; velhaMs?: number; ocupada: () => Error};

/** Roda `f` com a trava `lock` (síncrono: `f` não pode devolver Promise). Reentrante no mesmo processo. */
export const comTrava = <T>(lock: string, f: () => T, o: OpcoesTrava): T => {
  const meu = donos.get(lock);
  if (meu) {
    meu.n++;
    try {
      return f();
    } finally {
      meu.n--;
    }
  }
  const marca = pegar(lock, o);
  donos.set(lock, {n: 1, marca});
  try {
    return f();
  } finally {
    donos.delete(lock);
    soltar(lock, marca);
  }
};

/** Este processo está com a trava agora (para conferir em teste e em quem precisa dela). */
export const comATrava = (lock: string) => donos.has(lock);
