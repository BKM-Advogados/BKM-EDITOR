// Frente IA (rodada 3, docs/ia.md): monta as conversas de todos os provedores e o IPC da lista de provedores.
// Registrado no main.ts com uma linha. A chave nunca sai daqui para a tela: só "tem chave", a origem e o final.
import type {EstadoProvedor} from '../compartilhado/api';
import {acharChave, CofreMemoria, finalDaChave, type Cofre} from './ia/chaves';
import {textoDeSistema} from './ia/guia';
import {PROVEDORES} from './ia/provedores';
import {acharExecutavel, SessoesIA, type OpcoesSessoes} from './ia/sessoes';
import {ambienteLimpo, PATH_COM_LOCAL} from './terminais';

type Lidar = <A extends unknown[], R>(canal: string, f: (...a: A) => R | Promise<R>) => void;

// o cofre do Electron (safeStorage) entra com a tela de chaves; até lá, só as variáveis de ambiente do PC
let cofre: Cofre = new CofreMemoria();
export const definirCofre = (c: Cofre) => {
  cofre = c;
};

const ambienteAgente = () => ({...ambienteLimpo(), PATH: PATH_COM_LOCAL()});

export const criarSessoesIA = (o: Pick<OpcoesSessoes, 'evento' | 'vivasTerminal' | 'conexao' | 'claude'>) =>
  new SessoesIA({...o, cofre: {ler: (p) => cofre.ler(p), gravar: (p, c) => cofre.gravar(p, c), apagar: (p) => cofre.apagar(p)},
    sistema: textoDeSistema, ambiente: ambienteAgente});

/** Cada provedor do catálogo com o que falta para usar. Agentes ACP só entram quando o executável é achado. */
export const estadoDosProvedores = async (o: {claudeInstalado: boolean; acharExe?: (n: string) => Promise<unknown>}): Promise<EstadoProvedor[]> => {
  const achar = o.acharExe ?? ((n: string) => acharExecutavel(n, ambienteAgente()));
  const r: EstadoProvedor[] = [];
  for (const p of PROVEDORES) {
    const base = {id: p.id, nome: p.nome, via: p.via, servidor: p.servidor, experimental: p.experimental, modelo: p.modelo, base: p.base,
      paginaChave: p.paginaChave, chave: p.chave};
    if (p.via === 'claude-cli') {
      r.push({...base, pronto: o.claudeInstalado, falta: o.claudeInstalado ? undefined : 'não instalado'});
    } else if (p.via === 'acp') {
      if (await achar(p.exe!)) r.push({...base, pronto: true});
    } else {
      const c = acharChave(cofre, p.id);
      const falta = !p.base ? 'endereço' : p.chave === 'exigida' && !c.chave ? 'chave' : !p.modelo ? 'modelo' : undefined;
      r.push({...base, pronto: !falta, falta, chave_origem: c.origem, chave_final: finalDaChave(c.chave)});
    }
  }
  return r;
};

export const registrarIpcIa = (lidar: Lidar, canal: string, claudeInstalado: () => boolean) => {
  lidar(canal, () => estadoDosProvedores({claudeInstalado: claudeInstalado()}));
};
