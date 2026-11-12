// Lógica pura do seletor de fonte da camada de texto da imagem e do que acontece quando a fonte gravada no documento
// não existe mais (kit trocado, arquivo apagado de fontes/). Sem React e sem navegador: quem carrega as fontes de
// verdade é composicoes/fontes.ts; aqui só se decide o que listar, como rotular e para qual fonte cair.
import type {MarcaDoDocumento} from './documentos';

/** As quatro famílias que vêm dentro do app. */
export const FONTES_FIXAS = ['Archivo', 'IBM Plex Mono', 'IBM Plex Sans', 'Inter'] as const;
/** Para onde o texto cai quando a família pedida não existe. Uma das quatro fixas, que já vêm no app. */
export const FONTE_RESERVA = 'Inter';
/** Famílias do navegador que não precisam ser carregadas. */
export const FONTES_GENERICAS = ['system-ui', 'sans-serif', 'serif', 'monospace'];

/** Uma fonte que o carregador conhece. `arquivo` é a que veio do kit ou da pasta fontes/ do projeto. */
export type FonteConhecida = {nome: string; origem: 'google' | 'arquivo'};
export type OpcaoDeFonte = [valor: string, rotulo: string];
export type GrupoDeFontes = {rotulo: string; opcoes: OpcaoDeFonte[]};

const ehFixa = (nome: string) => (FONTES_FIXAS as readonly string[]).includes(nome);
export const ehReferencia = (nome: string) => nome.startsWith('@');
export const ehGenerica = (nome: string) => FONTES_GENERICAS.includes(nome);

/** A família existe para desenhar? Genérica, fixa ou de arquivo conhecida: sim. Referência do kit ("@titulo") não é
 *  família: é resolvida antes de desenhar, então não conta como faltando. */
export const fonteExiste = (nome: string, conhecidas: FonteConhecida[]) =>
  ehReferencia(nome) || ehGenerica(nome) || ehFixa(nome) || conhecidas.some((f) => f.nome === nome);

/** As famílias de arquivo (do kit aplicado e do projeto), sem repetir e em ordem alfabética. */
export const fontesDaMarca = (conhecidas: FonteConhecida[]): string[] =>
  [...new Set(conhecidas.filter((f) => f.origem === 'arquivo').map((f) => f.nome))]
    .filter((n) => !ehFixa(n))
    .sort((a, b) => a.localeCompare(b, 'pt-BR'));

/** O seletor em grupos: "Do kit" (as referências @titulo, @texto e @mono, só com kit), "Da marca" (as fontes de arquivo),
 *  "Do app" (as quatro fixas) e "Sistema". A fonte gravada na camada que não está em lugar nenhum entra num grupo
 *  próprio, com o nome guardado e o aviso, para a pessoa reconhecê-la em vez de ver o seletor em branco. */
export const montarGrupos = (marca: MarcaDoDocumento | undefined, conhecidas: FonteConhecida[], atual?: string): GrupoDeFontes[] => {
  const grupos: GrupoDeFontes[] = [];
  if (marca) {
    grupos.push({rotulo: 'Do kit', opcoes: [
      ['@titulo', `Título do kit · ${marca.fontes.titulo}`],
      ['@texto', `Texto do kit · ${marca.fontes.texto}`],
      ['@mono', `Mono do kit · ${marca.fontes.mono ?? marca.fontes.texto}`],
    ]});
  }
  const daMarca = fontesDaMarca(conhecidas);
  if (daMarca.length) grupos.push({rotulo: 'Da marca', opcoes: daMarca.map((n): OpcaoDeFonte => [n, n])});
  grupos.push({rotulo: 'Do app', opcoes: FONTES_FIXAS.map((n): OpcaoDeFonte => [n, n])});
  grupos.push({rotulo: 'Sistema', opcoes: [['system-ui', 'Fonte do sistema']]});
  if (atual && !grupos.some((g) => g.opcoes.some(([v]) => v === atual)) && !fonteExiste(atual, conhecidas)) {
    grupos.push({rotulo: 'Guardada no documento', opcoes: [[atual, `${atual} · não encontrada (desenha em ${FONTE_RESERVA})`]]});
  }
  return grupos;
};

/** Os grupos numa lista só para o seletor de uma coluna: o título de cada grupo vira uma linha que não se escolhe
 *  (`desligado`). Sem fonte de arquivo nem kit, a lista fica como era (só os títulos "Do app" e "Sistema" a mais). */
export const opcoesComTitulos = (grupos: GrupoDeFontes[]): {valor: string; rotulo: string; desligado?: boolean}[] =>
  grupos.flatMap((g) => [{valor: `\u0001${g.rotulo}`, rotulo: g.rotulo.toUpperCase(), desligado: true}, ...g.opcoes.map(([valor, rotulo]) => ({valor, rotulo}))]);

/** O font-family para desenhar: a família pedida e, atrás dela, a fixa de reserva. Se a família não existe, o navegador
 *  usa a reserva sozinho, sem quebrar. Nome genérico não leva reserva. */
export const pilhaDeFontes = (nome: string | undefined, padrao: string): string => {
  const n = nome || padrao;
  if (ehGenerica(n)) return n;
  return n === FONTE_RESERVA ? `"${n}", system-ui, sans-serif` : `"${n}", "${FONTE_RESERVA}", system-ui, sans-serif`;
};

/** Quais famílias esperar carregar antes de desenhar: as pedidas que não são genéricas e, se alguma não existe, também a
 *  reserva (é nela que o texto vai cair). */
export const familiasParaEsperar = (nomes: string[], conhecidas: FonteConhecida[]): string[] => {
  const reais = nomes.filter((n) => n && !ehGenerica(n) && !ehReferencia(n));
  const faltando = reais.some((n) => !fonteExiste(n, conhecidas));
  return [...new Set(faltando ? [...reais, FONTE_RESERVA] : reais)];
};
