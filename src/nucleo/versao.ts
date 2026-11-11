// A versão do app, a do package.json (o empacotamento põe a mesma no executável), e o nome com que o Estúdio se
// apresenta aos sites de onde baixa alguma coisa (ler_fonte, modelos da transcrição e do remover fundo): o app e a
// versão, sem endereço de ninguém. Serve ao processo principal e ao MCP por stdio, dentro e fora do app.
import {version} from '../../package.json';

export const VERSAO_DO_APP: string = version;
export const USER_AGENT_ESTUDIO = `Estudio/${VERSAO_DO_APP}`;
