// Estado vazio com ação: a área sem documento diz o que falta e cria com um clique, no formato escolhido pelo nome do
// destino. Aparece no monitor de cada área (e em Efeitos, que precisa de um vídeo ou de uma imagem).
import React from 'react';
import {Box, Film, Image as ImageIcon, LayoutGrid, Sparkles} from 'lucide-react';
import type {Modulo} from '../../nucleo/documentos';
import {FORMATOS_IMAGEM, FORMATOS_VIDEO} from '../../nucleo/formatos';
import {criarDocumento} from '../estado/loja';
import {novoCarrossel} from '../modulos/imagem/acoes';

// carrossel de várias páginas (LinkedIn e Instagram): só nos tamanhos de post
const FORMATOS_CARROSSEL = FORMATOS_IMAGEM.filter((f) => f.id === 'feed' || f.id === 'quadrado');

const TEXTO: Record<Modulo, {titulo: string; icone: React.ReactNode}> = {
  video: {titulo: 'Este projeto ainda não tem vídeo', icone: <Film size={28} />},
  imagem: {titulo: 'Este projeto ainda não tem imagem', icone: <ImageIcon size={28} />},
  '3d': {titulo: 'Este projeto ainda não tem cena 3D', icone: <Box size={28} />},
  animacao: {titulo: 'Este projeto ainda não tem animação', icone: <Sparkles size={28} />},
};

export const SemDocumento: React.FC<{modulo: Modulo; compacto?: boolean}> = ({modulo, compacto}) => {
  const t = TEXTO[modulo];
  const formatos = modulo === 'video' || modulo === 'animacao' ? FORMATOS_VIDEO : modulo === 'imagem' ? FORMATOS_IMAGEM.slice(0, 4) : [];
  return (
    <div className={`sem-documento${compacto ? ' compacto' : ''}`}>
      {!compacto && <span className="sd-icone">{t.icone}</span>}
      <div className="sd-titulo">{t.titulo}</div>
      {formatos.length ? (
        <>
          <div className="sd-texto">{modulo === 'video' ? 'Novo vídeo em branco, no formato do destino:' : modulo === 'animacao' ? 'Nova animação em branco, no formato do destino:' : 'Nova imagem em branco:'}</div>
          <div className="sd-botoes">
            {formatos.map((f, i) => (
              <button key={f.id} className={`bt${i === 0 ? ' principal' : ''}`} onClick={() => void criarDocumento(modulo, {largura: f.largura, altura: f.altura, fps: 30})}
                title={`${f.nome} · ${f.largura}×${f.altura} · ${f.destino}`}>
                {f.nome} <span className="sd-prop">{f.proporcao}</span>
              </button>
            ))}
          </div>
          {modulo === 'imagem' && (
            <>
              <div className="sd-texto" style={{marginTop: 6}}>Ou um carrossel de várias páginas (PNG por página e PDF para o LinkedIn):</div>
              <div className="sd-botoes">
                {FORMATOS_CARROSSEL.map((f) => (
                  <button key={f.id} className="bt" onClick={() => void novoCarrossel({largura: f.largura, altura: f.altura})}
                    title={`Capa, páginas de conteúdo e final em ${f.largura}×${f.altura}`}>
                    <LayoutGrid size={13} />Novo carrossel <span className="sd-prop">{f.proporcao}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </>
      ) : (
        <div className="sd-botoes"><button className="bt principal" onClick={() => void criarDocumento('3d')}>Nova cena 3D</button></div>
      )}
    </div>
  );
};
