// Lista de modelos de um endereço no formato da OpenAI (GET /models), usada para testar a chave sem gastar token e
// para o seletor de modelo. A Anthropic testa no /v1/models nativo, com x-api-key: a camada compatível não documenta a
// lista. Nunca devolve a chave no texto do erro.
import {erroDaApi} from './laco';

export type ResultadoModelos = {ok: true; modelos: string[]} | {ok: false; status?: number; rede?: boolean; mensagem: string};

export const listarModelos = async (o: {base: string; chave?: string; provedor?: string; cabecalhos?: Record<string, string>; fetch?: typeof fetch}):
  Promise<ResultadoModelos> => {
  const f = o.fetch ?? fetch;
  const auth: Record<string, string> = !o.chave ? {}
    : o.provedor === 'anthropic' ? {'x-api-key': o.chave, 'anthropic-version': '2023-06-01'} : {Authorization: `Bearer ${o.chave}`};
  let r: Response;
  try {
    r = await f(`${o.base.replace(/\/+$/, '')}/models`, {headers: {...o.cabecalhos, ...auth}, signal: AbortSignal.timeout(15000)});
  } catch (e) {
    const msg = String((e as Error).message ?? e).replaceAll(o.chave ?? '\u0000', '…');
    return {ok: false, rede: true, mensagem: `não deu para falar com ${o.base} agora: ${msg}`};
  }
  if (!r.ok) return {ok: false, status: r.status, mensagem: erroDaApi(r.status, (await r.text().catch(() => '')).replaceAll(o.chave ?? '\u0000', '…'))};
  try {
    const j = (await r.json()) as {data?: {id?: string; name?: string}[]; models?: {id?: string; name?: string}[]};
    const ids = (j.data ?? j.models ?? []).map((m) => m.id ?? m.name ?? '').filter(Boolean).map((id) => id.replace(/^models\//, ''));
    return {ok: true, modelos: [...new Set(ids)].sort()};
  } catch {
    return {ok: false, status: r.status, mensagem: 'o endereço respondeu, mas não com uma lista de modelos'};
  }
};
