// Biblioteca de músicas livres com curadoria (rodada 3, frente Som). Cada faixa tem uma ficha (autor, página, licença,
// data da conferência) ao lado do arquivo (<arquivo>.ficha.json), e só entra na biblioteca a faixa cuja licença permite o uso
// comercial em vídeo: CC0, domínio público, CC BY. Nenhuma faixa NC (não comercial), ND (sem derivações) nem SA
// (compartilha igual), nem de "licença do site" que não dê para ler: a ficha com essas licenças é recusada com o motivo, e
// a faixa não é listada como escolhível nem usada pela ferramenta. A faixa sem ficha (o arquivo que a pessoa pôs na pasta
// de trilhas) continua valendo: a licença dela é da pessoa. Puro, sem disco.

export const LICENCAS_LIVRES = {
  'CC0-1.0': {nome: 'CC0 1.0', credito: false},
  'PDM-1.0': {nome: 'Domínio público', credito: false},
  'CC-BY-4.0': {nome: 'CC BY 4.0', credito: true},
  'CC-BY-3.0': {nome: 'CC BY 3.0', credito: true},
} as const;
export type IdLicenca = keyof typeof LICENCAS_LIVRES;
export const IDS_LICENCA = Object.keys(LICENCAS_LIVRES) as IdLicenca[];

export type RiscoContentId = 'alto' | 'medio' | 'baixo';
export type FichaFaixa = {
  id: string; // slug (macleod-inspired)
  titulo: string;
  autor: string;
  url_pagina: string; // a página em que a licença foi conferida
  licenca: IdLicenca;
  url_licenca: string; // o texto da licença (creativecommons.org/…)
  conferido_em: string; // AAAA-MM-DD
  atribuicao?: string; // o crédito que a licença pede (CC BY); vai nos créditos do vídeo
  url_arquivo?: string | null;
  sha256?: string; // do arquivo, para conferir o que foi baixado
  duracao_s?: number | null;
  genero?: string;
  humor?: string;
  bpm?: number | null;
  risco_content_id?: RiscoContentId; // chance de reclamação automática de direitos em plataformas
  observacoes?: string;
};

/** Por que uma licença (id ou texto, como "CC BY-NC 4.0") não serve, ou null se serve. */
export const recusaDaLicenca = (licenca: unknown): string | null => {
  const t = String(licenca ?? '').trim();
  if ((IDS_LICENCA as string[]).includes(t)) return null;
  const partes = t.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  if (partes.includes('NC')) return `a licença ${t} é só para uso não comercial (NC)`;
  if (partes.includes('ND')) return `a licença ${t} não permite derivações (ND): pôr a música sob uma narração, cortar e dar fade já é derivar`;
  if (partes.includes('SA')) return `a licença ${t} exige compartilhar igual (SA)`;
  return t ? `licença não aceita: ${t} (vale ${IDS_LICENCA.join(', ')})` : 'a ficha não diz a licença';
};

const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const https = (x: unknown): x is string => typeof x === 'string' && /^https:\/\/[^\s]+$/.test(x);
const texto = (x: unknown): x is string => typeof x === 'string' && x.trim().length > 0;

/** A ficha lida do disco: a normalizada, ou a lista do que está errado (licença NC/ND/SA entre eles). */
export const validarFicha = (x: unknown): {ficha: FichaFaixa; erros: []} | {ficha?: undefined; erros: string[]} => {
  const o = x as Partial<Record<keyof FichaFaixa, unknown>> | null;
  if (!o || typeof o !== 'object' || Array.isArray(o)) return {erros: ['a ficha não é um objeto']};
  const erros: string[] = [];
  if (typeof o.id !== 'string' || !slug.test(o.id)) erros.push('id: um slug em minúsculas (macleod-inspired)');
  if (!texto(o.titulo)) erros.push('título em falta');
  if (!texto(o.autor)) erros.push('autor em falta');
  if (!https(o.url_pagina)) erros.push('url_pagina: o endereço https da página em que a licença foi conferida');
  const recusa = recusaDaLicenca(o.licenca);
  if (recusa) erros.push(recusa);
  if (!https(o.url_licenca)) erros.push('url_licenca: o endereço https do texto da licença');
  if (typeof o.conferido_em !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.conferido_em) || Number.isNaN(Date.parse(o.conferido_em))) erros.push('conferido_em: AAAA-MM-DD');
  const lic = (IDS_LICENCA as string[]).includes(String(o.licenca)) ? LICENCAS_LIVRES[o.licenca as IdLicenca] : null;
  if (lic?.credito && !texto(o.atribuicao)) erros.push(`atribuicao: a licença ${lic.nome} exige o crédito, e a ficha não traz o texto dele`);
  if (o.url_arquivo !== undefined && o.url_arquivo !== null && !https(o.url_arquivo)) erros.push('url_arquivo: https ou vazio');
  if (o.sha256 !== undefined && !(typeof o.sha256 === 'string' && /^[0-9a-f]{64}$/.test(o.sha256))) erros.push('sha256: 64 caracteres hexadecimais');
  if (o.risco_content_id !== undefined && !['alto', 'medio', 'baixo'].includes(String(o.risco_content_id))) erros.push('risco_content_id: alto, medio ou baixo');
  if (erros.length) return {erros};
  const ficha: FichaFaixa = {id: o.id as string, titulo: (o.titulo as string).trim(), autor: (o.autor as string).trim(), url_pagina: o.url_pagina as string, licenca: o.licenca as IdLicenca,
    url_licenca: o.url_licenca as string, conferido_em: o.conferido_em as string};
  for (const k of ['atribuicao', 'url_arquivo', 'sha256', 'genero', 'humor', 'observacoes'] as const) if (typeof o[k] === 'string' && (o[k] as string).trim()) (ficha as Record<string, unknown>)[k] = o[k];
  for (const k of ['duracao_s', 'bpm'] as const) if (typeof o[k] === 'number' && Number.isFinite(o[k])) (ficha as Record<string, unknown>)[k] = o[k];
  if (o.risco_content_id) ficha.risco_content_id = o.risco_content_id as RiscoContentId;
  return {ficha, erros: []};
};

/** Um catálogo (lista de fichas): as que servem e as recusadas, com o motivo. Id repetido recusa a segunda. */
export const validarCatalogo = (x: unknown): {faixas: FichaFaixa[]; recusadas: {id: string; erros: string[]}[]} => {
  const lista = Array.isArray((x as {faixas?: unknown} | null)?.faixas) ? (x as {faixas: unknown[]}).faixas : Array.isArray(x) ? x : [];
  const faixas: FichaFaixa[] = [];
  const recusadas: {id: string; erros: string[]}[] = [];
  const vistos = new Set<string>();
  lista.forEach((f, i) => {
    const r = validarFicha(f);
    const id = typeof (f as {id?: unknown} | null)?.id === 'string' ? (f as {id: string}).id : `#${i + 1}`;
    if (r.ficha && vistos.has(r.ficha.id)) recusadas.push({id, erros: ['id repetido no catálogo']});
    else if (r.ficha) {
      vistos.add(r.ficha.id);
      faixas.push(r.ficha);
    } else recusadas.push({id, erros: r.erros});
  });
  return {faixas, recusadas};
};

/** O arquivo da ficha ao lado da faixa: midia/cama.mp3 → midia/cama.mp3.ficha.json. */
export const arquivoDaFicha = (arquivo: string) => `${arquivo}.ficha.json`;

/** A linha de crédito da faixa para a descrição do vídeo; null quando a licença não pede crédito. */
export const linhaDeCredito = (f: FichaFaixa): string | null => {
  const lic = LICENCAS_LIVRES[f.licenca];
  if (!lic.credito) return null;
  return `${f.atribuicao!.trim()} (${lic.nome}: ${f.url_licenca})`;
};

export type Credito = {arquivo: string; titulo: string; autor: string; licenca: string; linha: string | null; url_pagina: string};

/** Os créditos das fichas das músicas usadas, sem repetir a mesma faixa. `linha` é null nas que não pedem crédito. */
export const creditosDas = (fichas: {arquivo: string; ficha: FichaFaixa}[]): {creditos: Credito[]; texto: string} => {
  const vistos = new Set<string>();
  const creditos: Credito[] = [];
  for (const {arquivo, ficha} of fichas) {
    if (vistos.has(ficha.id)) continue;
    vistos.add(ficha.id);
    creditos.push({arquivo, titulo: ficha.titulo, autor: ficha.autor, licenca: LICENCAS_LIVRES[ficha.licenca].nome, linha: linhaDeCredito(ficha), url_pagina: ficha.url_pagina});
  }
  return {creditos, texto: creditos.flatMap((c) => (c.linha ? [c.linha] : [])).join('\n')};
};
