// Cofre das chaves de IA num arquivo do perfil da pessoa (userData/ia/chaves.json: %APPDATA%\Estudio no Windows,
// ~/.config/estudio no Linux), cifrado pelo safeStorage do Electron (DPAPI no Windows, chaveiro do sistema no Linux).
// Fora do projeto, do git e do OneDrive. Sem cifra disponível (no Linux, sem chaveiro ativo), a chave vale só enquanto o
// app estiver aberto: fica em memória e nada é gravado, nem em texto puro.
import {existsSync, mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import type {Cofre} from './chaves';

export type Cifra = {disponivel: () => boolean; cifrar: (texto: string) => Buffer; decifrar: (dado: Buffer) => string; loja?: () => string | undefined};
type Arquivo = {versao: 1; chaves: Record<string, {dado: string; em: string}>};

export class CofreArquivo implements Cofre {
  private soNestaSessao = new Map<string, string>();

  constructor(private readonly arquivo: string, private readonly cifra: Cifra) {}

  /** Se a chave vai para o disco (cifrada) ou só fica nesta sessão. */
  persistente() {
    try {
      return this.cifra.disponivel();
    } catch {
      return false;
    }
  }

  /** Qual chaveiro está em uso (no Linux: gnome_libsecret, kwallet6, basic_text...). */
  loja() {
    try {
      return this.cifra.loja?.();
    } catch {
      return undefined;
    }
  }

  ler(provedor: string) {
    const s = this.soNestaSessao.get(provedor);
    if (s) return s;
    const e = this.lerArquivo().chaves[provedor];
    if (!e || !this.persistente()) return undefined;
    try {
      return this.cifra.decifrar(Buffer.from(e.dado, 'base64'));
    } catch {
      return undefined; // outra conta do sistema, outro chaveiro, ou o arquivo veio de outro PC
    }
  }

  gravar(provedor: string, chave: string) {
    if (!this.persistente()) {
      this.soNestaSessao.set(provedor, chave);
      return;
    }
    const a = this.lerArquivo();
    a.chaves[provedor] = {dado: this.cifra.cifrar(chave).toString('base64'), em: new Date().toISOString()};
    this.gravarArquivo(a);
    this.soNestaSessao.delete(provedor);
  }

  apagar(provedor: string) {
    this.soNestaSessao.delete(provedor);
    const a = this.lerArquivo();
    if (!a.chaves[provedor]) return;
    delete a.chaves[provedor];
    this.gravarArquivo(a);
  }

  private lerArquivo(): Arquivo {
    try {
      if (existsSync(this.arquivo)) {
        const j = JSON.parse(readFileSync(this.arquivo, 'utf-8'));
        if (j?.versao === 1 && j.chaves && typeof j.chaves === 'object') return j;
      }
    } catch {
      /* arquivo estragado: começa vazio; só é regravado quando a pessoa gravar ou apagar uma chave */
    }
    return {versao: 1, chaves: {}};
  }

  private gravarArquivo(a: Arquivo) {
    mkdirSync(path.dirname(this.arquivo), {recursive: true});
    const tmp = `${this.arquivo}.tmp`;
    writeFileSync(tmp, JSON.stringify(a, null, 2), {encoding: 'utf-8', mode: 0o600});
    renameSync(tmp, this.arquivo);
  }
}
