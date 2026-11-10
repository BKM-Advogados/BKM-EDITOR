// O lado do vídeo da ida e volta: no inspetor do clipe de música ou de efeito, "Editar em Música" (ou, já ligado,
// "Abrir na Música" e "Voltar ao original"); no inspetor da faixa, "Criar em Música" a partir da cabeça. A voz fica no
// vídeo (a limpeza, o medidor e as legendas leem o arquivo dela) e na Música toca como guia.
import React from 'react';
import {Music, Undo2} from 'lucide-react';
import {papelDe, type ClipeAudio, type FaixaAudio} from '../../../nucleo/audio';
import type {DocCenas} from '../../../nucleo/cenas';
import {acharAlvoAudio, patchVoltarAoOriginal} from '../../../nucleo/musica-video';
import {aplicar, loja, useLoja} from '../../estado/loja';
import {CampoLeitura, Secao} from '../../componentes/Campos';
import {levarParaMusica} from './estado';

export const MusicaDoClipe: React.FC<{documento: string; caminho: string; c: ClipeAudio; faixa: FaixaAudio}> = ({documento, caminho, c, faixa}) => {
  const titulo = useLoja((e) => (c.musica ? e.info?.manifesto.documentos.find((d) => d.id === c.musica)?.titulo : undefined));
  const alvo = {documento, caminho: `/audio/faixas/@${faixa.id}/clipes/@${c.id}`};
  const voltar = () => {
    const doc = loja.get().docs[documento]?.doc as DocCenas | undefined;
    const a = doc ? acharAlvoAudio(doc, caminho) : null;
    if (a?.clipe && a.ci !== undefined) void aplicar(documento, patchVoltarAoOriginal({...a, clipe: a.clipe, ci: a.ci}), `${c.id} volta ao áudio de antes da música`);
  };
  return (
    <Secao titulo="Música" chave="audio:musica">
      {c.musica ? (
        <>
          <CampoLeitura rotulo="Toca" dica="O clipe acompanha cada mudança da música, sem exportar arquivo">a música "{titulo ?? c.musica}"</CampoLeitura>
          <div style={{padding: '2px 8px 6px', display: 'flex', gap: 6, flexWrap: 'wrap'}}>
            <button className="bt principal" onClick={() => void levarParaMusica({alvo, intencao: 'editar'})}><Music size={14} />Abrir na Música</button>
            {c.musica_original && <button className="bt" onClick={voltar}><Undo2 size={14} />Voltar ao original</button>}
          </div>
        </>
      ) : (
        <div style={{padding: '2px 8px 6px'}}>
          <button className="bt principal" onClick={() => void levarParaMusica({alvo, intencao: 'editar'})} title="Abre este áudio na Música; ao concluir, ele volta para cá">
            <Music size={14} />Editar em Música</button>
        </div>
      )}
    </Secao>
  );
};

export const CriarEmMusica: React.FC<{documento: string; faixa: FaixaAudio}> = ({documento, faixa}) => {
  // o modelo segue o papel da faixa (item 27): trilha para vídeo na faixa de música, efeito sonoro na de efeitos
  const modelo = papelDe(faixa) === 'efeitos' ? 'efeito_sonoro' : 'trilha_video';
  const criar = (m: 'vazio' | 'trilha_video' | 'efeito_sonoro') =>
    void levarParaMusica({alvo: {documento, caminho: `/audio/faixas/@${faixa.id}`}, intencao: 'criar', tempo: {em_ms: loja.get().tempo_ms}, modelo: m});
  return (
    <Secao titulo="Música" chave="audio:criar-musica">
      <div style={{padding: '2px 8px 6px', display: 'flex', gap: 6, flexWrap: 'wrap'}}>
        <button className="bt principal" title={`Abre a Música com ${modelo === 'efeito_sonoro' ? 'um efeito sonoro' : 'uma trilha'} pronta, do tamanho do vídeo; ao concluir, ela entra nesta faixa, na cabeça`}
          onClick={() => criar(modelo)}><Music size={14} />Criar em Música</button>
        <button className="bt" title="Abre a Música com uma bateria vazia" onClick={() => criar('vazio')}>Vazia</button>
      </div>
    </Secao>
  );
};
