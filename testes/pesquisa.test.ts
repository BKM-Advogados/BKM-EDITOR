// Núcleo puro da pesquisa (fase 1, visualizador): achar o trecho, conferir números, marcas de vigência, limpar o HTML
// do Planalto sem apagar nada e hash estável com o token aleatório do F5. O fixture é um recorte real da CLT (art. 477
// ao 477-B), em windows-1252 como o original.
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {CATALOGO_FONTES} from '../src/nucleo/catalogo-fontes';
import {
  acharTrecho, conferirDigitos, decodificar, decodificarComAviso, estadoDoFato, hashTexto, limparHtml, nivelDe, normalizar, numerosDe,
  paginar, pesquisaVazia, proximoId, sinaisDeVigencia, tituloDoHtml, TAMANHO_PAGINA,
} from '../src/nucleo/pesquisa';
import {checarTexto, REGRAS_CLIENTE, terminaComUltimaFrase} from '../src/nucleo/regras';

const PASTA = path.join(__dirname, 'fixtures', 'pesquisa');
const BYTES = new Uint8Array(readFileSync(path.join(PASTA, 'planalto-art477.htm')));
const PARES = JSON.parse(readFileSync(path.join(PASTA, 'pares-c1.json'), 'utf8')) as {id: string; afirmacao: string; trecho: string; verdadeiro: boolean; localizador: string}[];
const HTML = decodificar(BYTES, 'text/html'); // o Planalto não declara charset
const TEXTO = limparHtml(HTML);

describe('normalizar e acharTrecho', () => {
  it('normaliza espaços, U+00A0, aspas tipográficas e NFC', () => {
    expect(normalizar('a\u00a0\u00a0 b\t c')).toBe('a b c');
    expect(normalizar('“prazo” e ‘dez’')).toBe('"prazo" e \'dez\'');
    expect(normalizar('Sa\u0300o')).toBe('Sào'.normalize('NFC'));
    expect(normalizar('linha 1 \u00a0\n  linha 2  ')).toBe('linha 1\nlinha 2');
  });

  it('acha exato, parecido e não, com índices do texto gravado', () => {
    const texto = 'Art. 1º\u00a0 O prazo é de “dez dias”.\nFim.';
    const exato = acharTrecho(texto, 'O prazo é de "dez dias"');
    expect(exato.achado).toBe('exato');
    expect(texto.slice(exato.inicio, exato.fim)).toBe('O prazo é de “dez dias”');
    const nbsp = acharTrecho(texto, 'Art. 1º O prazo');
    expect(nbsp.achado).toBe('exato');
    expect(texto.slice(nbsp.inicio, nbsp.fim)).toBe('Art. 1º\u00a0 O prazo');
    const parecido = acharTrecho(texto, 'o PRAZO e de dez dias');
    expect(parecido.achado).toBe('parecido');
    expect(texto.slice(parecido.inicio, parecido.fim)).toBe('O prazo é de “dez dias');
    expect(acharTrecho(texto, 'quinze dias')).toEqual({achado: 'nao'});
    expect(acharTrecho(texto, '   ')).toEqual({achado: 'nao'});
  });

  it('no exato, quebra de linha vale espaço: trecho de dois parágrafos copiado numa linha só', () => {
    const texto = '§ 6o A entrega deverá ser feita\n  até dez dias contados.\r\nFim.';
    const r = acharTrecho(texto, 'deverá ser feita até dez dias contados.');
    expect(r.achado).toBe('exato');
    expect(texto.slice(r.inicio, r.fim)).toBe('deverá ser feita\n  até dez dias contados.');
    // e o contrário: o trecho com a quebra acha o texto numa linha só
    expect(acharTrecho('feita até dez dias', 'feita\naté dez dias').achado).toBe('exato');
  });

  it('acentos decompostos no texto não desalinham os índices', () => {
    const texto = 'rescisa\u0303o e ane\u0302mia';
    const r = acharTrecho(texto, 'rescisão');
    expect(r.achado).toBe('exato');
    expect(texto.slice(r.inicio, r.fim)).toBe('rescisa\u0303o');
  });
});

describe('números', () => {
  it('lê algarismo, extenso e percentual', () => {
    expect(numerosDe('até 10 dias')).toEqual(['10']);
    expect(numerosDe('até dez dias')).toEqual(['10']);
    expect(numerosDe('40%, 20% ou 10%')).toEqual(['40%', '20%', '10%']);
    expect(numerosDe('quarenta por cento')).toEqual(['40%']);
    expect(numerosDe('40 (quarenta) por cento')).toEqual(['40%', '40']);
    expect(numerosDe('vinte e cinco dias, mil e quinhentos reais, dois mil')).toEqual(['25', '1500', '2000']);
    expect(numerosDe('Lei nº 13.467, R$ 1.500,00 e 3,4%')).toEqual(['13467', '1500', '3,4%']);
    expect(numerosDe('uma multa, um dos quais, cada um')).toEqual([]); // artigo, não número
    expect(numerosDe('1 (um) mês e 6 (seis) meses')).toEqual(['1', '6']);
    expect(numerosDe('por cento de dezembro e novembro')).toEqual([]);
    expect(numerosDe('5 mil reais, 1,5 milhão e 2 bilhões')).toEqual(['5000', '1500000', '2000000000']);
    expect(numerosDe('trezentos e sessenta e cinco dias; mil quatrocentos e doze reais')).toEqual(['365', '1412']);
  });

  it('confere os dígitos da afirmação no trecho', () => {
    expect(conferirDigitos('A empresa tem até 10 dias', 'efetuados até dez dias contados')).toEqual({afirmacao: ['10'], faltando: []});
    expect(conferirDigitos('A empresa tem até 15 dias', 'efetuados até dez dias contados')).toEqual({afirmacao: ['15'], faltando: ['15']});
    expect(conferirDigitos('adicional de 40%', 'quarenta por cento do salário mínimo').faltando).toEqual([]);
    expect(conferirDigitos('adicional de 30%', '40% (quarenta por cento), 20% e 10%').faltando).toEqual(['30%']);
    expect(conferirDigitos('sacar até 80 do saldo', 'até 80% do valor').faltando).toEqual([]);
    expect(conferirDigitos('sacar até 80%', 'até 80 do valor').faltando).toEqual(['80%']);
    expect(conferirDigitos('multa de 5 mil reais', 'multa de R$ 5.000,00').faltando).toEqual([]);
  });

  it('número que só aponta o dispositivo não precisa estar no trecho', () => {
    const trecho = 'deverão ser efetuados até dez dias contados a partir do término do contrato.';
    // depois de "art.", "§", "Súmula", "Lei nº": referência, não número da afirmação
    expect(conferirDigitos('Pelo art. 477, § 6º, da CLT, são 10 dias.', trecho)).toEqual({afirmacao: ['10'], faltando: []});
    expect(conferirDigitos('A Súmula 51 e a Lei nº 13.467 dizem 10 dias.', trecho).faltando).toEqual([]);
    // os números do localizador também saem da conta
    expect(conferirDigitos('A CLT 477 dá 10 dias.', trecho, 'CLT, art. 477, § 6º')).toEqual({afirmacao: ['10'], faltando: []});
    // o mesmo número usado como valor continua contando
    expect(conferirDigitos('O art. 15 dá 15 dias.', trecho).faltando).toEqual(['15']);
  });

  it('identificador de norma ou de reforma não entra na conta, nem o ano que o segue (C6-05, C7-05, C3-04)', () => {
    const trecho = 'deverão ser efetuados até dez dias contados';
    const identificadores = [
      'A Lei 13.467/2017', 'A Lei nº 13.467, de 13 de julho de 2017,', 'O Decreto-Lei nº 5.452, de 1º de maio de 1943,', 'A MP 1.045/2021',
      'A Medida Provisória nº 936, de 2020,', 'A PEC 8/2025', 'A EC 103/2019', 'A Emenda Constitucional nº 141, de 2026,', 'A Emenda 141',
      'A Resolução 225/2025', 'A Res. 225/2025', 'A Portaria 671', 'A Súmula 437', 'A SUM-429', 'A OJ 394 da SBDI-1', 'O Tema 1.046',
      'O Precedente Normativo 119', 'O art. 7º, inciso 2, alínea 3,', 'O artigo 477, § 6º,', 'A Reforma Trabalhista de 2017',
      'Antes da Reforma da Previdência de 2019, a regra',
    ];
    for (const id of identificadores) expect(conferirDigitos(`${id} dá 10 dias.`, trecho), id).toEqual({afirmacao: ['10'], faltando: []});
    // os casos do gabarito
    expect(conferirDigitos('Com a Emenda Constitucional 141, de 2026, o repouso semanal remunerado passa a ser de 2 dias, um deles de preferência no domingo.',
      'XV - repouso semanal remunerado de 2 (dois) dias, um dos quais preferencialmente aos domingos;')).toEqual({afirmacao: ['2'], faltando: []});
    expect(conferirDigitos('Dois meses depois da publicação da Emenda 141, a jornada normal passa a ter no máximo 42 horas por semana.',
      'I - 2 (dois) meses após a publicação desta Emenda Constitucional, a duração do trabalho normal não excederá a 42 (quarenta e duas) horas semanais').faltando).toEqual([]);
    // o ano que não vem logo depois do identificador continua sendo número: "Tema 152 em abril de 2019"
    expect(conferirDigitos('O STF julgou o Tema 152 em abril de 2019.', '30/04/2015 Julgado mérito de tema com repercussão geral: o tema 152')).toEqual({afirmacao: ['2019'], faltando: ['2019']});
    // e o número trocado ao lado do identificador também
    expect(conferirDigitos('Pela Emenda 141, o repouso de 2 dias vale 6 meses depois da publicação.', 'após decorridos 2 (dois) meses de sua publicação').faltando).toEqual(['6']);
  });

  it('ordinal com símbolo é nome, não quantidade; ordinal antes de unidade de tempo vale o número (P12-03, P12-04, P10-02)', () => {
    expect(numerosDe('o 13º salário, o 1º grau, a 2ª instância, o 1.º e o 1o')).toEqual([]);
    expect(numerosDe('o décimo terceiro salário; segundo a lei, na segunda vez')).toEqual([]);
    expect(numerosDe('até o vigésimo dia; décimo terceiro dia; quinto dia útil; o 7º dia; vigésimo primeiro dia')).toEqual(['20', '13', '5', '7', '21']);
    expect(numerosDe('52 minutos e 30 segundos')).toEqual(['52', '30']); // "segundos" não é ordinal
    expect(conferirDigitos('Na demissão sem justa causa, o 13º é pago de forma proporcional.', 'nos termos dos parágrafos 1º e 2º do art. 1º desta Lei')).toEqual({afirmacao: [], faltando: []});
    expect(conferirDigitos('Para o 13º, 15 dias ou mais trabalhados no mês contam como mês inteiro.', 'A fração igual ou superior a 15 (quinze) dias de trabalho')).toEqual({afirmacao: ['15'], faltando: []});
    expect(conferirDigitos('A empresa deve depositar até o dia 20.', 'depositar, até o vigésimo dia de cada mês')).toEqual({afirmacao: ['20'], faltando: []});
    // dia trocado continua pego
    expect(conferirDigitos('A empresa deve depositar até o dia 10.', 'depositar, até o vigésimo dia de cada mês').faltando).toEqual(['10']);
    expect(conferirDigitos('O pedido vai do 7º ao 120º dia.', 'de 3 (três) a 5 (cinco) meses').faltando).toEqual(['120']);
  });

  it('data é um token só, em dd/mm/aaaa, com qualquer separador (C8-05, P19-05)', () => {
    for (const d of ['11/11/2017', '11.11.2017', '11-11-2017', '11 de novembro de 2017']) expect(numerosDe(d), d).toEqual(['11/11/2017']);
    expect(numerosDe('1º de maio de 1943')).toEqual(['01/05/1943']);
    expect(numerosDe('Lei 13.467/2017, R$ 1.500,00, 30/04 e 32/01/2020')).toEqual(['13467', '2017', '1500', '30', '4', '32', '1', '2020']); // não são datas
    expect(conferirDigitos('Perdeu a eficácia a partir de 11/11/2017.', '(cancelada por perda de eficácia a partir de 11.11.2017, pela Lei 13.467/2017)')).toEqual({afirmacao: ['11/11/2017'], faltando: []});
    expect(conferirDigitos('Vale desde 2017.', 'a partir de 11.11.2017').faltando).toEqual([]); // o ano da data também está escrito
    expect(conferirDigitos('Vale a partir de 12/11/2017.', 'a partir de 11.11.2017').faltando).toEqual(['12/11/2017']);
  });

  it('"um"/"uma" antes de unidade é 1 (P13-02)', () => {
    expect(numerosDe('um ano, uma vez, um salário, um terço, uma parcela')).toEqual(['1']);
    expect(numerosDe('um mês, um dia, uma hora, uma semana, a metade, uma metade, um dobro')).toEqual(['1']);
    expect(conferirDigitos('Tem estabilidade até 1 ano depois do fim do mandato.', 'desde o registro de sua candidatura até um ano após o final de seu mandato')).toEqual({afirmacao: ['1'], faltando: []});
    expect(conferirDigitos('Tem estabilidade até 2 anos depois do fim do mandato.', 'até um ano após o final de seu mandato').faltando).toEqual(['2']);
    // "multa de um salário" contra "dois salários" agora fica com o 1 faltando
    expect(conferirDigitos('A multa é de um salário.', 'multa de dois salários').faltando).toEqual(['1']);
  });

  it('adjetivo de prazo é número: quinquenal 5, bienal 2, trienal 3, quadrienal 4, decenal 10, anual 1 (P19-05)', () => {
    expect(numerosDe('quinquenal, bienal, trienal, quadrienal, decenal, anual')).toEqual(['5', '2', '3', '4', '10', '1']);
    expect(numerosDe('prescrições quinquenais')).toEqual(['5']);
    expect(numerosDe('salário mensal, repouso semanal, registro diário')).toEqual([]);
    expect(conferirDigitos('Para FGTS não depositado, quando o problema foi descoberto a partir de 13/11/2014, o prazo é de 5 anos, respeitados os 2 anos depois do fim do contrato.',
      'I – Para os casos em que a ciência da lesão ocorreu a partir de 13.11.2014, é quinquenal a prescrição do direito de reclamar contra o não-recolhimento de contribuição para o FGTS, observado o prazo de dois anos após o término do contrato'))
      .toEqual({afirmacao: ['13/11/2014', '5', '2'], faltando: []});
  });

  it('estado é trecho_confere só com trecho exato e nenhum número faltando', () => {
    expect(estadoDoFato('exato', [])).toBe('trecho_confere');
    expect(estadoDoFato('exato', ['15'])).toBe('a_revisar');
    expect(estadoDoFato('parecido', [])).toBe('a_revisar');
    expect(estadoDoFato('nao', [])).toBe('a_revisar');
  });
});

describe('vigência', () => {
  it('acha as marcas sem caixa nem acento', () => {
    expect(sinaisDeVigencia('§ 1º (Revogado). (Redação dada pela Lei nº 13.467, de 2017) (Vide Lei 1)')).toEqual(['(Revogad', 'Redação dada pela', '(Vide']);
    expect(sinaisDeVigencia('Súmula CANCELADA; entra em vigor; DOU de 3/11; VIGENCIA')).toEqual(['cancelad', 'em vigor', 'DOU de', 'Vigência']);
    expect(sinaisDeVigencia('texto comum')).toEqual([]);
  });

  it('no art. 477 do Planalto aparecem revogação, redação e inclusão', () => {
    expect(sinaisDeVigencia(TEXTO)).toEqual(['(Revogad', 'Redação dada pela', '(Incluído']);
  });
});

describe('HTML', () => {
  it('decodifica windows-1252 sem charset e respeita o charset declarado', () => {
    expect(TEXTO).toContain('Na extinção do contrato de trabalho');
    expect(decodificar(Uint8Array.of(0x72, 0x65, 0x73, 0x63, 0x69, 0x73, 0xe3, 0x6f))).toBe('rescisão');
    expect(decodificar(new TextEncoder().encode('rescisão'))).toBe('rescisão');
    expect(decodificar(new TextEncoder().encode('rescisão'), 'text/html; charset=UTF-8')).toBe('rescisão');
    const meta = new TextEncoder().encode('<meta http-equiv="Content-Type" content="text/html; charset=iso-8859-1">');
    expect(decodificar(Uint8Array.from([...meta, 0xe7]))).toBe('<meta http-equiv="Content-Type" content="text/html; charset=iso-8859-1">ç');
  });

  it('charset declarado UTF-8 com bytes windows-1252: lê em windows-1252 e avisa, sem trocar acento por U+FFFD', () => {
    const cp1252 = Uint8Array.of(0x72, 0x65, 0x73, 0x63, 0x69, 0x73, 0xe3, 0x6f); // "rescisão" em windows-1252
    expect(decodificarComAviso(cp1252, 'text/html; charset=utf-8')).toEqual({texto: 'rescisão', aviso: expect.stringContaining('cabeçalho HTTP diz UTF-8')});
    const meta = new TextEncoder().encode('<meta charset="utf-8">');
    const pelaMeta = decodificarComAviso(Uint8Array.from([...meta, 0xe7]));
    expect(pelaMeta.texto.endsWith('ç')).toBe(true);
    expect(pelaMeta.aviso).toContain('<meta charset>');
    // UTF-8 de verdade: sem aviso
    expect(decodificarComAviso(new TextEncoder().encode('rescisão'), 'text/html; charset=utf-8')).toEqual({texto: 'rescisão'});
  });

  it('limpa o HTML: tira script, style, comentário e head; quebra parágrafos; decodifica entidades', () => {
    const html = '<html><head><title>T&iacute;tulo</title></head><body><style>p{}</style><!-- nota --><p>A&nbsp;&amp; B<br>C &#8212; &#150; &ordm;</p><div>D</div><script>x()</script></body></html>';
    expect(limparHtml(html)).toBe('A\u00a0& B\nC — – º\nD');
    expect(tituloDoHtml(html)).toBe('Título');
  });

  it('mantém o texto riscado com marcador, inclusive aninhado e por style', () => {
    expect(limparHtml('<p>Art. 1º <strike>prazo de 30 dias</strike> prazo de 10 dias</p>')).toBe('Art. 1º [riscado: prazo de 30 dias] prazo de 10 dias');
    expect(limparHtml('<p><span style="text-decoration: line-through">velho <span>meio</span> fim</span> novo</p>')).toBe('[riscado: velho meio fim] novo');
    expect(limparHtml('<s>a <del>b</del> c</s><del>d</del>')).toBe('[riscado: a b c][riscado: d]');
    expect(limparHtml('<p>x<strike> </strike>y</p><p><strike></strike>z</p>')).toBe('x y\nz'); // riscado vazio não vira marcador
  });

  it('o fixture do Planalto: script f5 some, U+00A0 fica, parágrafos em linhas', () => {
    expect(HTML).toContain('f5_cspm');
    expect(TEXTO).not.toContain('f5_cspm');
    expect(TEXTO).not.toContain('Del5452compilado');
    expect(TEXTO).toContain('\u00a0');
    expect(TEXTO.split('\n')[0]).toMatch(/^Art\. 477\. /);
    expect(TEXTO).toContain('Art. 477-B.');
    expect(TEXTO).not.toContain('Art. 478');
  });

  it('hash do texto limpo é o mesmo com e sem o script do F5, e com outro token', () => {
    const semScript = HTML.replace(/<SCRIPT id=f5_cspm>[\s\S]*?<\/SCRIPT>/, '');
    const outroToken = HTML.replace(/f5_p:'[A-Z]+'/, "f5_p:'ABCDEFGH'");
    const depoisDoHtml = `${semScript}<script id="f5_cspm">(function(){var f5_cspm={f5_p:'ZZZZ'}})();</script>`;
    expect(semScript).not.toBe(HTML);
    expect(outroToken).not.toBe(HTML);
    const h = hashTexto(TEXTO);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashTexto(limparHtml(semScript))).toBe(h);
    expect(hashTexto(limparHtml(outroToken))).toBe(h);
    expect(hashTexto(limparHtml(depoisDoHtml))).toBe(h);
    expect(hashTexto(`${TEXTO.replace(/ /g, '  ')}\n`)).toBe(h); // normalizado antes do hash
    expect(hashTexto(TEXTO.replace('dez dias', 'onze dias'))).not.toBe(h);
  });
});

describe('gabarito C1 no art. 477', () => {
  it('todo trecho do gabarito é achado como exato no texto limpo, e nos verdadeiros os dígitos conferem', () => {
    expect(PARES).toHaveLength(8);
    for (const par of PARES) {
      const r = acharTrecho(TEXTO, par.trecho);
      expect(r.achado, par.id).toBe('exato');
      expect(normalizar(TEXTO.slice(r.inicio, r.fim)), par.id).toBe(normalizar(par.trecho));
      if (par.verdadeiro && par.id !== 'C1-02') expect(conferirDigitos(par.afirmacao, par.trecho).faltando, par.id).toEqual([]);
    }
  });

  it('C1-02, "multa no valor de um salário" × "equivalente ao seu salário": o 1 não está escrito no trecho e o fato vai para a revisão', () => {
    const c102 = PARES.find((p) => p.id === 'C1-02')!;
    expect(conferirDigitos(c102.afirmacao, c102.trecho).faltando).toEqual(['1']);
  });

  it('os falsos com número trocado ficam com dígito faltando', () => {
    const c106 = PARES.find((p) => p.id === 'C1-06')!;
    expect(conferirDigitos(c106.afirmacao, c106.trecho).faltando).toEqual(['15']);
  });
});

describe('catálogo, ids e páginas', () => {
  it('nível pelo host, o mais específico vence', () => {
    expect(nivelDe('https://www.planalto.gov.br/ccivil_03/decreto-lei/del5452compilado.htm')).toEqual({nivel: 1, catalogo: 'planalto'});
    expect(nivelDe('https://portal.stf.jus.br/processos')).toEqual({nivel: 1, catalogo: 'stf'});
    expect(nivelDe('https://www2.camara.leg.br/legin/fed/declei')).toEqual({nivel: 1, catalogo: 'camara-legin'});
    expect(nivelDe('https://www.camara.leg.br/noticias/1')).toEqual({nivel: 2, catalogo: 'agencia-camara'});
    expect(nivelDe('https://www.gov.br/trabalho-e-emprego/pt-br')).toEqual({nivel: 2, catalogo: 'mte'});
    expect(nivelDe('https://pt.wikipedia.org/wiki/CLT')).toEqual({nivel: 0});
    expect(nivelDe('https://planalto.gov.br.exemplo.com/')).toEqual({nivel: 0});
    expect(nivelDe('não é url')).toEqual({nivel: 0});
    expect(new Set(CATALOGO_FONTES.map((f) => f.id)).size).toBe(CATALOGO_FONTES.length);
  });

  it('ids seguem f1, f2 e F1, F2 sem reaproveitar buracos', () => {
    const p = pesquisaVazia();
    expect(proximoId(p, 'fonte')).toBe('f1');
    expect(proximoId(p, 'fato')).toBe('F1');
    p.fontes.push({id: 'f3'} as never, {id: 'f1'} as never);
    expect(proximoId(p, 'fonte')).toBe('f4');
  });

  it('pagina em 6.000 caracteres', () => {
    const texto = 'x'.repeat(TAMANHO_PAGINA * 2 + 5);
    expect(paginar(texto)).toMatchObject({pagina: 1, paginas: 3});
    expect(paginar(texto, 3).texto).toHaveLength(5);
    expect(paginar('', 9)).toEqual({texto: '', pagina: 1, paginas: 1});
  });
});

describe('regras da Cliente (só avisos)', () => {
  it('avisa empresa, OAB, pessoa e número sem fato; nada reprova', () => {
    const fatos = [{afirmacao: 'A empresa tem até 10 dias para pagar a rescisão.'}] as never;
    const {avisos} = checarTexto('Na Empresa, João da Silva tem 10 dias e 15 dias. Vale a pena: honorários grátis!', REGRAS_CLIENTE, {onde: 'cena-1-texto', fatos});
    expect(avisos).toContainEqual({tipo: 'empresa', termo: 'Empresa', onde: 'cena-1-texto'});
    expect(avisos.find((a) => a.termo === 'vale')).toMatchObject({tipo: 'empresa', nota: expect.stringContaining('palavra comum')});
    expect(avisos).toContainEqual({tipo: 'oab', termo: 'honorarios', onde: 'cena-1-texto'});
    expect(avisos).toContainEqual({tipo: 'oab', termo: 'gratis', onde: 'cena-1-texto'});
    expect(avisos.find((a) => a.tipo === 'pessoa')?.termo).toBe('João da Silva');
    expect(avisos.filter((a) => a.tipo === 'numero_sem_fato').map((a) => a.termo)).toEqual(['15']);
    for (const a of avisos) expect(Object.keys(a).sort().join()).toMatch(/^(nota,)?onde,termo,tipo$/);
  });

  it('palavra inteira, sem acento: "avaliação" não é "vale" e "Justiça do Trabalho" não é pessoa', () => {
    expect(checarTexto('Na Justiça do Trabalho, a avaliação do Tribunal Superior do Trabalho.').avisos).toEqual([]);
    expect(checarTexto('100% de chance').avisos.map((a) => a.termo)).toEqual(['100%']);
  });

  it('confere a frase de fecho', () => {
    expect(terminaComUltimaFrase('... Ficou com alguma duvida?  Procure um advogado trabalhista.')).toBe(true);
    expect(terminaComUltimaFrase('Procure um advogado.')).toBe(false);
  });
});
