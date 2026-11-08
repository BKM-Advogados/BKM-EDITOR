// Faixa da ida e volta, logo abaixo da barra da casca, enquanto há uma transição aberta. Na Música: "Editando o áudio do
// vídeo · Concluir e voltar · Cancelar". Em outra área (a pessoa trocou com Alt+1 no meio): "Edição na Música aberta ·
// Voltar à Música · Concluir". Quem abriu pela IA aparece na cor do agente.
import React from 'react';
import {Check, CornerUpLeft, Music, X} from 'lucide-react';
import {loja, useLoja} from '../../estado/loja';
import {cancelarTransicao, concluirTransicao, transicaoAberta, useMusica} from './estado';
import {BotaoMenu} from '../../componentes/Menu';

export const FaixaTransicao: React.FC = () => {
  const t = useMusica((e) => transicaoAberta(e));
  const area = useLoja((e) => e.area);
  const ativo = useLoja((e) => e.ativo.musica);
  const titulos = useLoja((e) => e.info?.manifesto.documentos);
  const renderizando = useMusica((e) => e.renderizando);
  if (!t) return null;
  const nome = (id: string) => titulos?.find((d) => d.id === id)?.titulo ?? id;
  const daIA = t.autor !== 'pessoa';
  const aqui = area === 'musica' && ativo === t.destino.documento;
  const oQue = t.intencao === 'criar' ? `Criando para a faixa ${t.origem.caminho.split('@')[1] ?? ''} de "${nome(t.origem.documento)}"` : `Editando o áudio de "${nome(t.origem.documento)}"`;
  return (
    <div className={`faixa-transicao${aqui ? '' : ' fora'}`} role="status">
      <Music size={14} />
      <span className="txt">
        {aqui ? oQue : `Edição na Música aberta: "${nome(t.destino.documento)}"`}
        {daIA && <span className="agente"> · aberta pela IA</span>}
      </span>
      {!aqui && (
        <button className="bt" onClick={() => loja.definir((e) => ({area: 'musica', ativo: {...e.ativo, musica: t.destino.documento}}))}><CornerUpLeft size={14} />Voltar à Música</button>
      )}
      <button className="bt principal" disabled={renderizando} onClick={() => void concluirTransicao(t.id)} title="Põe a música no vídeo e volta ao ponto de onde saiu">
        <Check size={14} />{aqui ? 'Concluir e voltar' : 'Concluir'}
      </button>
      <BotaoMenu titulo="Cancelar" className="bt" rotulo="Cancelar" icone={<X size={14} />} itens={[
        {rotulo: 'Cancelar (o vídeo fica como estava)', acao: () => void cancelarTransicao(t.id)},
        {rotulo: 'Cancelar e desfazer o que fiz na música', acao: () => void cancelarTransicao(t.id, true)},
      ]} />
    </div>
  );
};
