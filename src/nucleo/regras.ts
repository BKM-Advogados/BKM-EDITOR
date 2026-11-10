// Regras de conteúdo da Cliente para o TEXTO DO VÍDEO (capa, blocos, falas), copiadas à mão de
// tasks/estudio-pesquisa-e-grosso-2026-11-06/fase-0/regras-cliente.json (perfil 'cliente' do conferir_capa.py do outro-projeto
// e regras comuns da campanha C2–C8). Tudo aqui é AVISO para a pessoa decidir (D2, 06/11/2026): nada bloqueia, e a
// saída não tem campo de reprovar. As fontes da pesquisa não passam por aqui: nome, parte, OAB e CNPJ ficam nelas como
// no original. A comparação é a mesma do conferir_capa.py: sem acento, minúsculas, palavra inteira.
import {numerosDe, type Fato} from './pesquisa';

export type Regras = {
  empresas: {
    reprova: string[]; // empregadoras do público da Cliente (nomes da fonte de origem; aqui só avisam)
    revisar: string[]; // também é palavra comum ("vale a pena"): avisa com nota
  };
  pessoas?: {nomes?: string[]}; // nomes a avisar sempre; além deles, a suspeita de nome próprio
  oab: {
    reprova: string[]; // Provimento 205/2021, art. 3º e § 1º, sem leitura informativa
    avisa: string[]; // depende do contexto
  };
  texto: {ultima_frase: string};
};

export const REGRAS_CLIENTE: Regras = {
  empresas: {
    reprova: ['Empresa', 'usiminas', 'arcelormittal', 'arcelor', 'samarco', 'csn', 'anglo american', 'anglogold', 'vallourec', 'aperam', 'cbmm', 'kinross', 'jaguar mining'],
    revisar: ['vale'],
  },
  pessoas: {nomes: []},
  oab: {
    reprova: ['honorario', 'honorarios', 'gratis', 'consulta gratuita', 'sem custo', 'custo zero', 'resultado garantido', 'garantimos', 'indenizacao garantida', 'dinheiro garantido', 'causa ganha', 'ganhe a causa', '100%', 'numero 1', 'imbativel', 'entre na justica', 'processe', 'processar a empresa', 'acione a empresa', 'contrate', 'contrate-nos', 'ligue ja', 'chame no whatsapp', 'receba ja', 'taxa de exito', 'ganhamos', 'vencemos', 'promocao', 'imperdivel', 'ultimas vagas', 'melhores advogados', 'melhor escritorio'],
    avisa: ['especialista', 'especialistas', 'especializado', 'especializada', 'gratuito', 'gratuita', 'gratuidade', 'desconto', 'garantido', 'garantida', 'r$', 'receber', 'indenizacao', 'fale com', 'fale conosco', 'advogado', 'advogados', 'urgente', 'vitoria', 'lider', 'o melhor', 'os melhores', 'exito'],
  },
  texto: {ultima_frase: 'Ficou com alguma dúvida? Procure um advogado trabalhista.'},
};

export type TipoAviso = 'oab' | 'empresa' | 'pessoa' | 'numero_sem_fato';
export type Aviso = {tipo: TipoAviso; termo: string; onde: string; nota?: string};

// conferir_capa.py:_norm: NFKD e fora tudo o que não é ASCII, em minúsculas
const norm = (s: string): string => s.normalize('NFKD').replace(/[^\x00-\x7f]/g, '').toLowerCase();

// conferir_capa.py:_acha: palavra inteira (sem letra, dígito, _ ou $ antes; sem letra, dígito ou _ depois). Termo que termina
// em símbolo ("r$", "100%") não pede fronteira depois: "R$500" tem dígito colado no "r$" e é o mesmo aviso de "R$ 500"
// (transversal-D19).
const acha = (textoNorm: string, termo: string): boolean => {
  const t = norm(termo);
  const depois = /\w$/.test(t) ? '(?!\\w)' : '';
  return new RegExp(`(?<![\\w$])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}${depois}`).test(textoNorm);
};

/** Texto sem acento, minúsculo e com os espaços e quebras de linha contados como um espaço só: legenda com "\n" no meio
 *  de "consulta\ngratuita" continua sendo "consulta gratuita". */
const normalizado = (s: string): string => norm(s).replace(/\s+/g, ' ').trim();

// Palavras com maiúscula que não são nome de pessoa: começo de frase comum, instituição, lugar, norma.
const NAO_E_NOME = new Set(norm(
  'a o as os um uma na no nas nos em de da do das dos e se para pela pelo pelas pelos com sem por quem quando mesmo '
  + 'hoje ficou procure isso essa esse este esta mas ou que qual saiu sua seu voce depois antes ate entre so '
  + 'justica trabalho tribunal superior supremo federal regional constituicao lei leis sumula decreto codigo '
  + 'consolidacao ministerio publico fundo garantia tempo servico previdencia social carteira seguro desemprego '
  + 'brasil minas gerais espirito santo Cidade Exemplo vara turma secao orientacao jurisprudencial plano demissao '
  + 'voluntaria caixa economica receita instituto nacional republica estado governo presidencia camara senado '
  + 'deputados art artigo inciso paragrafo clt fgts inss tst stf stj trt cnj mte ks bkm usina').split(' '));

// Duas ou mais palavras seguidas com maiúscula ("João da Silva"), tirando as da lista acima.
const suspeitasDeNome = (texto: string): string[] => {
  const saida: string[] = [];
  const re = /\p{Lu}\p{Ll}+(?:\s+(?:(?:da|de|do|das|dos|e)\s+)?\p{Lu}\p{Ll}+)+/gu;
  for (const m of texto.match(re) ?? []) {
    let atual: string[] = [];
    const fechar = () => {
      const nomes = atual.filter((p) => /^\p{Lu}/u.test(p));
      while (atual.length && !/^\p{Lu}/u.test(atual[atual.length - 1])) atual.pop();
      if (nomes.length >= 2 && !saida.includes(atual.join(' '))) saida.push(atual.join(' '));
      atual = [];
    };
    for (const palavra of m.split(/\s+/)) {
      if (/^\p{Lu}/u.test(palavra) && NAO_E_NOME.has(norm(palavra))) fechar();
      else if (atual.length || /^\p{Lu}/u.test(palavra)) atual.push(palavra);
    }
    fechar();
  }
  return saida;
};

/** Avisos sobre um texto do vídeo. `onde` diz de onde o texto veio (id do bloco, "fala 3"); com `fatos`, cada número
 * do texto que não aparece em nenhuma afirmação de fato vira aviso 'numero_sem_fato'. Só informa. */
export const checarTexto = (texto: string, regras: Regras = REGRAS_CLIENTE, opcoes: {onde?: string; fatos?: Fato[]} = {}): {avisos: Aviso[]} => {
  const onde = opcoes.onde ?? 'texto';
  // a frase de fecho que as próprias regras pedem ("Procure um advogado trabalhista.") não é aviso da OAB: sem tirá-la, todo
  // vídeo que fecha certo recebia o aviso de 'advogado' (transversal-D18). Sem o ponto final também vale.
  const fecho = normalizado(regras.texto.ultima_frase).replace(/[.!?\s]+$/, '');
  const base = normalizado(texto);
  const t = fecho ? base.split(fecho).join(' ') : base;
  const avisos: Aviso[] = [];
  for (const termo of regras.empresas.reprova) if (acha(t, termo)) avisos.push({tipo: 'empresa', termo, onde});
  for (const termo of regras.empresas.revisar) {
    if (acha(t, termo)) avisos.push({tipo: 'empresa', termo, onde, nota: 'também é palavra comum ("vale a pena", "vale-transporte"): confira se é a empresa'});
  }
  for (const termo of [...regras.oab.reprova, ...regras.oab.avisa]) if (acha(t, termo)) avisos.push({tipo: 'oab', termo, onde});
  for (const termo of regras.pessoas?.nomes ?? []) if (acha(t, termo)) avisos.push({tipo: 'pessoa', termo, onde});
  for (const termo of suspeitasDeNome(texto)) {
    if (!avisos.some((a) => a.tipo === 'pessoa' && norm(a.termo) === norm(termo))) {
      avisos.push({tipo: 'pessoa', termo, onde, nota: 'parece nome de pessoa: no vídeo, use a função ("operador de alto-forno")'});
    }
  }
  if (opcoes.fatos) {
    const comFato = new Set(opcoes.fatos.flatMap((f) => numerosDe(f.afirmacao)));
    for (const n of numerosDe(texto)) {
      if (!comFato.has(n) && !(!n.endsWith('%') && comFato.has(`${n}%`))) avisos.push({tipo: 'numero_sem_fato', termo: n, onde});
    }
  }
  return {avisos};
};

/** O texto (a última fala ou o último bloco) termina com a frase de fecho das regras? */
export const terminaComUltimaFrase = (texto: string, regras: Regras = REGRAS_CLIENTE): boolean => {
  const limpo = (s: string) => norm(s).replace(/\s+/g, ' ').trim();
  return limpo(texto).endsWith(limpo(regras.texto.ultima_frase));
};
