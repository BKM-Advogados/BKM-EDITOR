// Limite de erro por painel (tres-efeitos-D1, D12): um painel que falha ao desenhar mostra o motivo e um botão para tentar
// de novo, e o resto do Estúdio (a janela, os outros painéis, o terminal) continua vivo. Sem ele, uma exceção ao desenhar
// desmonta a árvore inteira do React e a janela fica em branco. É genérico: serve a qualquer painel (a casca o usa para
// os painéis de todas as áreas). Tenta de novo sozinho quando `reiniciarCom` muda (por exemplo, a versão do documento: a
// pessoa, o Ctrl+Z ou a IA corrigiu o JSON).
import React from 'react';
import {TriangleAlert} from 'lucide-react';
import type {PaineisDoModulo} from '../casca/contrato';
import {avisar, useLoja} from '../estado/loja';
import './limite-erro.css';

type Props = {nome: string; reiniciarCom?: unknown; children: React.ReactNode};
type Estado = {erro: Error | null; detalhes: string};

/** O texto do erro, em uma linha, sem o nome interno do React nem a pilha. */
export const motivoDoErro = (erro: unknown): string => {
  const m = erro instanceof Error ? erro.message : String(erro);
  return m.replace(/\s+/g, ' ').trim().slice(0, 300) || 'erro sem mensagem';
};

export class LimiteDeErro extends React.Component<Props, Estado> {
  state: Estado = {erro: null, detalhes: ''};

  static getDerivedStateFromError(erro: unknown): Partial<Estado> {
    return {erro: erro instanceof Error ? erro : new Error(String(erro))};
  }

  componentDidCatch(erro: Error, info: React.ErrorInfo) {
    const detalhes = `${erro.stack ?? erro.message}\n\nComponentes:${info.componentStack ?? ''}`;
    this.setState({detalhes});
    console.error(`[painel ${this.props.nome}]`, erro, info.componentStack);
  }

  componentDidUpdate(anterior: Props) {
    if (this.state.erro && anterior.reiniciarCom !== this.props.reiniciarCom) this.setState({erro: null, detalhes: ''});
  }

  private tentar = () => this.setState({erro: null, detalhes: ''});

  private copiar = () => {
    const texto = `Painel ${this.props.nome}: ${motivoDoErro(this.state.erro)}\n\n${this.state.detalhes}`;
    navigator.clipboard?.writeText(texto).then(() => avisar('Detalhes do erro copiados.', 'ok'), () => avisar('Não consegui copiar.', 'erro'));
  };

  render() {
    const {erro} = this.state;
    if (!erro) return this.props.children;
    return (
      <div className="limite-erro" role="alert" data-limite-erro={this.props.nome}>
        <div className="limite-erro-titulo"><TriangleAlert size={14} />{this.props.nome} não abriu</div>
        <div className="limite-erro-motivo">{motivoDoErro(erro)}</div>
        <div className="limite-erro-dica">O resto do Estúdio continua funcionando. Se o problema está no documento, corrija ou desfaça (Ctrl+Z): o painel tenta de novo sozinho.</div>
        <div className="limite-erro-acoes">
          <button type="button" className="bt mini" onClick={this.tentar}>Tentar de novo</button>
          <button type="button" className="bt mini fantasma" onClick={this.copiar}>Copiar detalhes</button>
        </div>
      </div>
    );
  }
}

/** A chave que faz o limite tentar de novo: a seleção e a versão de cada documento aberto. */
const useChaveDeReinicio = () =>
  useLoja((e) => `${e.selecao?.documento ?? ''}${e.selecao?.caminho ?? ''}|${Object.values(e.docs).map((d) => d.versao).join(',')}`);

/** Um componente de painel dentro de um limite de erro (que tenta de novo quando a seleção ou um documento muda). */
export const comLimite = (nome: string, C: React.FC): React.FC => {
  const Painel: React.FC = () => {
    const chave = useChaveDeReinicio();
    return <LimiteDeErro nome={nome} reiniciarCom={chave}><C /></LimiteDeErro>;
  };
  Painel.displayName = `ComLimite(${nome})`;
  return Painel;
};

/** Os painéis de um módulo, cada um dentro do seu limite. A casca pode usar o mesmo em qualquer módulo:
 *  `comLimiteDeErro(PaineisVideo, 'Vídeo')`. */
export const comLimiteDeErro = (p: PaineisDoModulo, modulo: string): PaineisDoModulo => ({
  ...p,
  Lista: comLimite(`${p.tituloLista} (${modulo})`, p.Lista),
  Monitor: comLimite(`Monitor (${modulo})`, p.Monitor),
  Inspector: comLimite(`Inspetor (${modulo})`, p.Inspector),
  ...(p.Linha ? {Linha: comLimite(`Linha do tempo (${modulo})`, p.Linha)} : {}),
});
