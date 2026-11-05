// O que o app lembra fora dos projetos, na pasta de dados do usuário: preferências (pasta padrão dos projetos, o que
// abrir ao iniciar, últimos formatos) e a lista de recentes. Nada aqui é essencial: arquivo ausente ou quebrado volta
// ao padrão.
import {existsSync, mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import type {Preferencias, Recente} from '../compartilhado/api';
import type {Manifesto} from '../nucleo/documentos';

const MAX_RECENTES = 24;

type Guardado = {raiz: string; nome: string; aberto_em: string};

const lerJson = <T>(arq: string, padrao: T): T => {
  try {
    return existsSync(arq) ? (JSON.parse(readFileSync(arq, 'utf-8')) as T) : padrao;
  } catch {
    return padrao;
  }
};

const gravarJson = (arq: string, valor: unknown) => {
  mkdirSync(path.dirname(arq), {recursive: true});
  const tmp = `${arq}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(valor, null, 2)}\n`, 'utf-8');
  renameSync(tmp, arq);
};

export class Memoria {
  private readonly arqPrefs: string;
  private readonly arqRecentes: string;

  constructor(dir: string, private readonly pastaPadrao: string) {
    this.arqPrefs = path.join(dir, 'preferencias.json');
    this.arqRecentes = path.join(dir, 'recentes.json');
  }

  prefs(): Preferencias {
    const p = lerJson<Partial<Preferencias>>(this.arqPrefs, {});
    return {
      pasta_projetos: typeof p.pasta_projetos === 'string' && p.pasta_projetos ? p.pasta_projetos : this.pastaPadrao,
      ao_iniciar: p.ao_iniciar === 'ultimo' ? 'ultimo' : 'inicio',
      formato_video: p.formato_video ?? 'reels',
      formato_imagem: p.formato_imagem ?? 'feed',
      boas_vindas_vista: Boolean(p.boas_vindas_vista),
    };
  }

  gravarPrefs(mudanca: Partial<Preferencias>): Preferencias {
    const p = {...this.prefs(), ...mudanca};
    gravarJson(this.arqPrefs, p);
    return p;
  }

  private guardados(): Guardado[] {
    const l = lerJson<Guardado[]>(this.arqRecentes, []);
    return Array.isArray(l) ? l.filter((r) => r && typeof r.raiz === 'string') : [];
  }

  /** Recentes com o que a tela inicial mostra: miniatura (data URL), se a pasta ainda existe e os módulos. */
  recentes(): Recente[] {
    return this.guardados().map((r) => {
      const existe = existsSync(path.join(r.raiz, 'estudio.json'));
      let nome = r.nome;
      let modulos: Recente['modulos'] = [];
      if (existe) {
        const m = lerJson<Partial<Manifesto>>(path.join(r.raiz, 'estudio.json'), {});
        nome = typeof m.nome === 'string' ? m.nome : nome;
        modulos = [...new Set((m.documentos ?? []).map((d) => d.modulo))];
      }
      const arqMini = path.join(r.raiz, '.estudio', 'miniatura.jpg');
      let miniatura: string | undefined;
      try {
        if (existe && existsSync(arqMini)) miniatura = `data:image/jpeg;base64,${readFileSync(arqMini).toString('base64')}`;
      } catch {
        /* sem miniatura: o cartão mostra o ícone do módulo */
      }
      return {raiz: r.raiz, nome, aberto_em: r.aberto_em, existe, modulos, miniatura};
    });
  }

  lembrar(raiz: string, nome: string) {
    const outros = this.guardados().filter((r) => path.resolve(r.raiz) !== path.resolve(raiz));
    gravarJson(this.arqRecentes, [{raiz, nome, aberto_em: new Date().toISOString()}, ...outros].slice(0, MAX_RECENTES));
  }

  esquecer(raiz: string) {
    gravarJson(this.arqRecentes, this.guardados().filter((r) => path.resolve(r.raiz) !== path.resolve(raiz)));
  }

  ultimo(): string | null {
    const r = this.guardados().find((x) => existsSync(path.join(x.raiz, 'estudio.json')));
    return r?.raiz ?? null;
  }
}
