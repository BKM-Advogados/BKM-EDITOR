// O ler-json da tela (auditoria do processo principal, P6). Arquivo opcional (transições, seleção pedida pela IA) ausente,
// ou nenhum projeto aberto, é null e não um erro no log a cada abertura; o caminho continua preso ao projeto.
import {ErroProjeto, type Projeto} from '../nucleo/projeto';

export const lerJsonDaTela = (projeto: Projeto | null, caminho: string, o?: {opcional?: boolean}): unknown => {
  if (o?.opcional && !projeto?.existe(caminho)) return null;
  if (!projeto) throw new ErroProjeto('nenhum projeto aberto', 'nao_achado');
  return projeto.lerJson(caminho).doc;
};
