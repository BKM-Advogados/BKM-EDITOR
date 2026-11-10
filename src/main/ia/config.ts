// O que não é segredo na configuração da IA, por pessoa e por PC (%APPDATA%\Estudio\ia\config.json): o provedor padrão
// das conversas novas e, por provedor, o modelo escolhido e o endereço (no compatível com OpenAI e nos locais).
// O uso do mês (tokens e custo estimado por provedor) fica em uso-AAAA-MM.json na mesma pasta.
import {existsSync, mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import type {UsoTokens} from './precos';

export type ConfigProvedor = {modelo?: string; base?: string};
export type ConfigIA = {padrao?: string; provedores: Record<string, ConfigProvedor>};
export type UsoDoMes = Record<string, {entrada: number; cache: number; saida: number; custo_usd: number; turnos: number}>;

const lerJson = <T>(arquivo: string, vazio: T): T => {
  try {
    return existsSync(arquivo) ? (JSON.parse(readFileSync(arquivo, 'utf-8')) as T) : vazio;
  } catch {
    return vazio;
  }
};
const gravarJson = (arquivo: string, dado: unknown) => {
  mkdirSync(path.dirname(arquivo), {recursive: true});
  writeFileSync(`${arquivo}.tmp`, JSON.stringify(dado, null, 2), 'utf-8');
  renameSync(`${arquivo}.tmp`, arquivo);
};

const ENDERECO_VALIDO = /^https?:\/\/[^\s"'<>]+$/i;

export class ConfiguracaoIA {
  constructor(private readonly pasta: string) {}

  ler(): ConfigIA {
    const c = lerJson<ConfigIA>(path.join(this.pasta, 'config.json'), {provedores: {}});
    return {padrao: c.padrao, provedores: c.provedores && typeof c.provedores === 'object' ? c.provedores : {}};
  }

  provedor(id: string): ConfigProvedor {
    return this.ler().provedores[id] ?? {};
  }

  configurar(id: string, o: ConfigProvedor) {
    if (o.base !== undefined && o.base !== '' && !ENDERECO_VALIDO.test(o.base)) throw new Error('o endereço precisa começar com http:// ou https://');
    const c = this.ler();
    const atual = {...c.provedores[id]};
    if (o.modelo !== undefined) atual.modelo = o.modelo.trim() || undefined;
    if (o.base !== undefined) atual.base = o.base.trim().replace(/\/+$/, '') || undefined;
    c.provedores[id] = atual;
    gravarJson(path.join(this.pasta, 'config.json'), c);
    return atual;
  }

  definirPadrao(id: string) {
    const c = this.ler();
    c.padrao = id;
    gravarJson(path.join(this.pasta, 'config.json'), c);
  }

  private arquivoDoMes(d = new Date()) {
    return path.join(this.pasta, `uso-${d.toISOString().slice(0, 7)}.json`);
  }

  usoDoMes(d = new Date()): UsoDoMes {
    return lerJson<UsoDoMes>(this.arquivoDoMes(d), {});
  }

  registrarUso(provedor: string, u: UsoTokens, custo_usd = 0, d = new Date()) {
    const mes = this.usoDoMes(d);
    const p = (mes[provedor] ??= {entrada: 0, cache: 0, saida: 0, custo_usd: 0, turnos: 0});
    p.entrada += u.entrada;
    p.cache += u.entrada_cache;
    p.saida += u.saida;
    p.custo_usd += custo_usd;
    p.turnos += 1;
    gravarJson(this.arquivoDoMes(d), mes);
  }
}
