// Licenças e créditos da música (item 24), puros. Cada som que se ouve tem uma origem: o kit da bateria (a licença vem da
// lista de kits, ou de doc.licencas para um kit importado), o sintetizador da casa (feito pelo Estúdio) ou um áudio do
// projeto (a licença vem de doc.licencas, pelo arquivo). Daqui saem a lista do licencas_do_projeto e da tela, o texto dos
// créditos e o comprovante que a exportação grava ao lado do arquivo. Som sem licença informada impede publicar: aviso,
// nunca erro (a exportação sai e o comprovante diz o que falta). Ver docs/musica.md, "Licenças e créditos".
import type {OperacaoPatch} from './documentos';
import {NOME_PRESET, resolverMusica, type DocMusica, type IdLicenca, type LicencaSom} from './musica';
import {KITS} from './musica-som';
import type {Edicao} from './musica-acoes';

/** livre: CC0, MIT ou próprio, publica sem crédito; credito: CC BY, publica com o crédito; declarado: a pessoa disse que
 *  tem o direito; sem_licenca: ninguém disse, impede publicar. */
export type ClasseLicenca = 'livre' | 'credito' | 'declarado' | 'sem_licenca';
export const LICENCAS: IdLicenca[] = ['proprio', 'CC0-1.0', 'MIT', 'CC-BY-4.0', 'uso_proprio', 'nao_sei'];
export const NOME_LICENCA: Record<IdLicenca, string> = {proprio: 'própria (Estúdio ou a pessoa)', 'CC0-1.0': 'CC0 1.0 (domínio público)', MIT: 'MIT', 'CC-BY-4.0': 'CC BY 4.0',
  uso_proprio: 'uso próprio declarado', nao_sei: 'não informada'};
const LINK_LICENCA: Partial<Record<IdLicenca, string>> = {'CC0-1.0': 'https://creativecommons.org/publicdomain/zero/1.0/', 'CC-BY-4.0': 'https://creativecommons.org/licenses/by/4.0/',
  MIT: 'https://opensource.org/license/mit'};
export const classeDaLicenca = (l: IdLicenca): ClasseLicenca => (l === 'CC-BY-4.0' ? 'credito' : l === 'uso_proprio' ? 'declarado' : l === 'nao_sei' ? 'sem_licenca' : 'livre');

export type InfoKit = (typeof KITS)[number];
export type SomUsado = {tipo: 'kit' | 'sintetizador' | 'audio'; id: string; nome: string; licenca: IdLicenca; classe: ClasseLicenca; canais: string[]; titulo?: string; autor?: string;
  link?: string; credito?: string; sha256?: string; impede?: string};
export type LicencasDaMusica = {sons: SomUsado[]; creditos: string[]; pode_publicar: boolean; impede: string[]};

/** A linha de crédito: o texto que a licença pede, se veio; senão título, autor, endereço e licença. */
export const textoDoCredito = (l: Pick<LicencaSom, 'titulo' | 'autor' | 'link' | 'credito' | 'licenca'>) => {
  if (l.credito?.trim()) return l.credito.trim();
  const partes = [l.titulo ? `"${l.titulo}"` : 'Som', l.autor ? `por ${l.autor}` : '', l.link ? `(${l.link})` : ''].filter(Boolean).join(' ');
  const url = LINK_LICENCA[l.licenca];
  return `${partes}, licença ${NOME_LICENCA[l.licenca]}${url ? ` (${url})` : ''}`;
};

/** Os sons que a música toca (canal e clipe não mudos) e a licença de cada um. `kits` e `hashes` (SHA-256 por arquivo)
 *  vêm de fora: o teste passa kits de exemplo, o processo principal passa os hashes dos áudios. */
export const licencasDaMusica = (doc: DocMusica, o: {kits?: InfoKit[]; hashes?: Record<string, string>} = {}): LicencasDaMusica => {
  const {musica: m} = resolverMusica(doc);
  const kits = o.kits ?? KITS;
  const declaradas = Array.isArray(doc.licencas) ? doc.licencas.filter((x) => x && typeof x.licenca === 'string') : [];
  const porId = new Map<string, SomUsado>();
  const somar = (chave: string, novo: Omit<SomUsado, 'canais' | 'classe'>, canal: string) => {
    const ja = porId.get(chave);
    if (ja) {
      if (!ja.canais.includes(canal)) ja.canais.push(canal);
      return;
    }
    const licenca = LICENCAS.includes(novo.licenca) ? novo.licenca : 'nao_sei';
    const classe = classeDaLicenca(licenca);
    porId.set(chave, {...novo, licenca, classe, canais: [canal],
      ...(classe === 'sem_licenca' ? {impede: `${novo.nome}: licença não informada (diga no inspetor do clipe ou em /licencas)`} : {})});
  };
  for (const canal of m.canais) {
    if (canal.mudo) continue;
    const clipes = m.clipes.filter((c) => c.canal === canal.id && !c.mudo);
    if (!clipes.length) continue;
    if (canal.tipo === 'bateria') {
      const k = kits.find((x) => x.id === canal.kit);
      const d = declaradas.find((x) => x.kit === canal.kit);
      const fonte = d ?? (k ? {licenca: k.spdx, titulo: k.titulo, autor: k.autor, link: k.link, credito: k.credito} : {licenca: 'nao_sei' as IdLicenca});
      somar(`kit:${canal.kit}`, {tipo: 'kit', id: canal.kit, nome: `kit ${k?.nome ?? canal.kit}`, ...limpo(fonte)}, canal.nome);
    } else if (canal.tipo === 'sintetizador') {
      somar(`sint:${canal.preset}`, {tipo: 'sintetizador', id: canal.preset, nome: `sintetizador ${NOME_PRESET[canal.preset]}`, licenca: 'proprio'}, canal.nome);
    } else {
      for (const c of clipes) {
        if (!c.audio) continue;
        const d = declaradas.find((x) => x.arquivo === c.audio);
        somar(`audio:${c.audio}`, {tipo: 'audio', id: c.audio, nome: c.audio.split('/').pop() ?? c.audio, ...limpo(d ?? {licenca: 'nao_sei'}),
          ...(o.hashes?.[c.audio] ? {sha256: o.hashes[c.audio]} : {})}, canal.nome);
      }
    }
  }
  const sons = [...porId.values()];
  const creditos = sons.filter((x) => x.classe === 'credito' || x.credito?.trim()).map((x) => textoDoCredito(x));
  const impede = sons.flatMap((x) => (x.impede ? [x.impede] : []));
  return {sons, creditos: [...new Set(creditos)], pode_publicar: !impede.length, impede};
};
const limpo = (l: Partial<LicencaSom> & {licenca: IdLicenca}) => Object.fromEntries(Object.entries({licenca: l.licenca, titulo: l.titulo, autor: l.autor, link: l.link, credito: l.credito})
  .filter(([, v]) => v !== undefined && v !== '')) as Pick<LicencaSom, 'licenca' | 'titulo' | 'autor' | 'link' | 'credito'>;

/** O arquivo de créditos que vai ao lado da música exportada (ou na descrição do vídeo). */
export const textoDosCreditos = (titulo: string, l: LicencasDaMusica) => {
  const linhas = [`Créditos · ${titulo}`, ''];
  if (l.creditos.length) linhas.push('Sons usados com licença que pede crédito:', ...l.creditos.map((c) => `- ${c}`), '');
  const proprios = l.sons.filter((x) => x.classe === 'livre').map((x) => x.nome);
  if (proprios.length) linhas.push(`Sons sem exigência de crédito: ${proprios.join(', ')}.`);
  const declarados = l.sons.filter((x) => x.classe === 'declarado').map((x) => x.nome);
  if (declarados.length) linhas.push(`Declarados de uso próprio por quem fez o projeto: ${declarados.join(', ')}.`);
  if (l.impede.length) linhas.push('', 'Antes de publicar, confira a licença de:', ...l.impede.map((x) => `- ${x}`));
  linhas.push('', 'Feito no Estúdio.');
  return `${linhas.join('\n')}\n`;
};

/** O comprovante (JSON) gravado ao lado do arquivo exportado: cada som, a licença, a classe e o SHA-256 do áudio. */
export const comprovanteDeLicencas = (o: {musica: string; titulo: string; arquivo?: string; licencas: LicencasDaMusica; gerado_em: string}) => ({
  formato: 1, musica: o.musica, titulo: o.titulo, ...(o.arquivo ? {arquivo: o.arquivo} : {}), gerado_em: o.gerado_em, pode_publicar: o.licencas.pode_publicar,
  impede: o.licencas.impede, creditos: o.licencas.creditos, sons: o.licencas.sons,
});

/** Diz a licença de um áudio da música (ou de um kit): troca a que havia para o mesmo arquivo ou kit. */
export const definirLicenca = (doc: DocMusica, l: LicencaSom): Edicao => {
  if (!l.arquivo === !l.kit) throw new Error('diga o "arquivo" (um áudio da música) ou o "kit", um dos dois');
  if (!LICENCAS.includes(l.licenca)) throw new Error(`licença desconhecida: ${l.licenca} (${LICENCAS.join(', ')})`);
  const lista = Array.isArray(doc.licencas) ? doc.licencas : [];
  const i = lista.findIndex((x) => (l.arquivo ? x.arquivo === l.arquivo : x.kit === l.kit));
  const valor = {...(l.arquivo ? {arquivo: l.arquivo} : {kit: l.kit}), ...limpo(l)} as LicencaSom;
  const patch: OperacaoPatch[] = doc.licencas === undefined ? [{op: 'add', path: '/licencas', value: [valor]}]
    : i >= 0 ? [{op: 'replace', path: `/licencas/${i}`, value: valor}] : [{op: 'add', path: '/licencas/-', value: valor}];
  return {patch, rotulo: `licença ${NOME_LICENCA[l.licenca]} em ${l.arquivo?.split('/').pop() ?? `kit ${l.kit}`}`, caminho: `/licencas/${i >= 0 ? i : lista.length}`};
};

// ---- Origens estendidas e política de dependências (N-10, decisão A6 de docs/musica-daw.md) ----
// Só tipos, constantes e funções puras novas: nada do que está acima muda, então documentos antigos soam e licenciam igual.

/** Origens de conteúdo que a DAW vai ter além do kit, do sintetizador da casa e do áudio do projeto. */
export type TipoOrigem = 'amostra' | 'ir' | 'preset' | 'modelo_nam' | 'modulo_wasm';
export const TIPOS_ORIGEM: TipoOrigem[] = ['amostra', 'ir', 'preset', 'modelo_nam', 'modulo_wasm'];
export const NOME_TIPO_ORIGEM: Record<TipoOrigem, string> = {amostra: 'amostra', ir: 'resposta ao impulso (IR)', preset: 'preset', modelo_nam: 'modelo NAM', modulo_wasm: 'módulo WASM'};

/** Origem de um conteúdo de terceiros: `spdx` é o identificador SPDX da licença, `sha256` o hash do arquivo (64 hex). */
export type OrigemConteudo = {tipo: TipoOrigem; id: string; nome: string; spdx: string; sha256: string; autor?: string; titulo?: string; link?: string; credito?: string};

/** A política A6. `permitida`: pode ir no bundle; `separada`: só como módulo separado e substituível, com parecer;
 *  `proibida`: fora do bundle e do WASM. */
export type ClassePolitica = 'permitida' | 'separada' | 'proibida' | 'desconhecida';
export const POLITICA_LICENCAS = {
  permitidas: ['MIT', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', 'CC0-1.0', 'CC-BY-4.0'],
  separada: ['LGPL-2.1', 'LGPL-3.0'],
  proibidas: ['GPL-2.0', 'GPL-3.0', 'AGPL-3.0'],
} as const;
const BASE_SPDX = (s: string) => s.trim().replace(/-(only|or-later)$/i, '').replace(/\+$/, '');
export const classeDaPolitica = (spdx: string): ClassePolitica => {
  const b = BASE_SPDX(spdx).toLowerCase();
  const tem = (l: readonly string[]) => l.some((x) => x.toLowerCase() === b);
  if (tem(POLITICA_LICENCAS.permitidas)) return 'permitida';
  if (tem(POLITICA_LICENCAS.separada) || /^lgpl-/.test(b)) return 'separada';
  if (tem(POLITICA_LICENCAS.proibidas) || /^a?gpl-/.test(b)) return 'proibida';
  return 'desconhecida';
};
/** Pode ir no bundle? `modulo_separado` diz que o conteúdo entra como módulo à parte (único caso em que LGPL passa). */
export const podeEntrarNoBundle = (spdx: string, o: {modulo_separado?: boolean} = {}) => {
  const c = classeDaPolitica(spdx);
  return c === 'permitida' || (c === 'separada' && !!o.modulo_separado);
};

const SHA256 = /^[0-9a-f]{64}$/;
/** Confere uma origem: campos obrigatórios, hash SHA-256 e a política A6. Devolve os problemas em português (vazio = ok). */
export const conferirOrigem = (o: OrigemConteudo, opcoes: {modulo_separado?: boolean} = {}): string[] => {
  const p: string[] = [];
  if (!TIPOS_ORIGEM.includes(o.tipo)) p.push(`tipo desconhecido: ${String(o.tipo)}`);
  if (!o.id?.trim()) p.push('falta o id');
  if (!o.nome?.trim()) p.push('falta o nome');
  if (!o.spdx?.trim()) p.push(`${o.nome || o.id}: falta a licença (SPDX)`);
  else if (classeDaPolitica(o.spdx) === 'desconhecida') p.push(`${o.nome || o.id}: licença ${o.spdx} fora da política (conferir antes de adotar)`);
  else if (!podeEntrarNoBundle(o.spdx, opcoes)) p.push(`${o.nome || o.id}: licença ${o.spdx} não pode ir no bundle (${classeDaPolitica(o.spdx) === 'separada' ? 'LGPL só em módulo separado' : 'GPL e AGPL são proibidas'})`);
  if (!SHA256.test(o.sha256 ?? '')) p.push(`${o.nome || o.id}: SHA-256 ausente ou inválido`);
  if (o.spdx === 'CC-BY-4.0' && !(o.credito?.trim() || o.autor?.trim())) p.push(`${o.nome || o.id}: CC BY pede autor ou crédito`);
  return p;
};

/** A linha de crédito de uma origem estendida (reaproveita textoDoCredito quando a licença é uma das já conhecidas). */
export const creditoDaOrigem = (o: OrigemConteudo) => {
  if (o.credito?.trim()) return o.credito.trim();
  const conhecida = (LICENCAS as string[]).includes(o.spdx) ? (o.spdx as IdLicenca) : undefined;
  if (conhecida) return textoDoCredito({licenca: conhecida, titulo: o.titulo ?? `${NOME_TIPO_ORIGEM[o.tipo]} ${o.nome}`, autor: o.autor, link: o.link});
  return [`${NOME_TIPO_ORIGEM[o.tipo]} "${o.titulo ?? o.nome}"`, o.autor ? `por ${o.autor}` : '', o.link ? `(${o.link})` : '', `licença ${o.spdx}`].filter(Boolean).join(' ');
};
