// Catálogo das fontes que abriram por programa na fase 0 (06/11/2026), copiado à mão de
// tasks/estudio-pesquisa-e-grosso-2026-11-06/fase-0/catalogo-fontes.json. Só dados (sem disco): o nível de uma fonte
// sai do host do endereço (pesquisa.ts, nivelDe). Nível 1 = norma, decisão e diário oficial; nível 2 = órgão de
// governo e agência pública de notícias (contexto e data do fato, nunca a regra); fora daqui o nível é 0 e a fonte
// continua valendo como visualização: o nível só informa.

export type FonteCatalogo = {
  id: string;
  nome: string;
  orgao: string;
  nivel: 1 | 2;
  hosts: string[]; // casa por sufixo de domínio: "stf.jus.br" vale para portal.stf.jus.br
};

export const CATALOGO_FONTES: FonteCatalogo[] = [
  {id: 'planalto', nome: 'Planalto — legislação federal compilada', orgao: 'Presidência da República — Casa Civil, Subchefia para Assuntos Jurídicos', nivel: 1, hosts: ['planalto.gov.br']},
  {id: 'camara-legin', nome: 'Câmara dos Deputados — LEGIN (legislação informatizada)', orgao: 'Câmara dos Deputados', nivel: 1, hosts: ['www2.camara.leg.br']},
  {id: 'senado-normas', nome: 'Senado Federal — Normas e Dados Abertos de legislação', orgao: 'Senado Federal', nivel: 1, hosts: ['legis.senado.leg.br']},
  {id: 'lexml', nome: 'LexML Brasil', orgao: 'Senado Federal (rede LexML)', nivel: 1, hosts: ['lexml.gov.br']},
  {id: 'dou', nome: 'Diário Oficial da União (Imprensa Nacional)', orgao: 'Imprensa Nacional — Presidência da República', nivel: 1, hosts: ['in.gov.br']},
  {id: 'tst', nome: 'Tribunal Superior do Trabalho', orgao: 'TST', nivel: 1, hosts: ['tst.jus.br']},
  {id: 'stf', nome: 'Supremo Tribunal Federal', orgao: 'STF', nivel: 1, hosts: ['stf.jus.br']},
  {id: 'stj', nome: 'Superior Tribunal de Justiça', orgao: 'STJ', nivel: 1, hosts: ['stj.jus.br']},
  {id: 'trt3', nome: 'TRT da 3ª Região (Minas Gerais)', orgao: 'TRT-3', nivel: 1, hosts: ['trt3.jus.br']},
  {id: 'djen', nome: 'DJEN — Diário de Justiça Eletrônico Nacional (API Comunica)', orgao: 'CNJ / PDPJ', nivel: 1, hosts: ['comunicaapi.pje.jus.br']},
  // gov.br inteiro seria largo demais (estados, prefeituras): só o portal federal www.gov.br (MTE, serviços, eSocial)
  {id: 'mte', nome: 'Ministério do Trabalho e Emprego e serviços do gov.br', orgao: 'MTE / Governo Federal', nivel: 2, hosts: ['www.gov.br']},
  {id: 'agencia-brasil', nome: 'Agência Brasil (EBC)', orgao: 'Empresa Brasil de Comunicação', nivel: 2, hosts: ['agenciabrasil.ebc.com.br']},
  {id: 'agencia-senado', nome: 'Agência Senado', orgao: 'Senado Federal', nivel: 2, hosts: ['www12.senado.leg.br']},
  {id: 'agencia-camara', nome: 'Agência Câmara de Notícias', orgao: 'Câmara dos Deputados', nivel: 2, hosts: ['www.camara.leg.br']},
];
