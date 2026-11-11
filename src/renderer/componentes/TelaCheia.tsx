// Tela cheia do monitor (Vídeo, Imagem e Animação): o painel do monitor, marcado com data-monitor-tela-cheia, ocupa a tela
// inteira com o transporte junto. O botão fica no transporte; Ctrl+F alterna (fora do terminal e dos campos de texto,
// Casca.tsx) e Esc sai. A peça se reescala sozinha, porque cada monitor mede o próprio espaço com ResizeObserver.
import React, {useEffect, useState} from 'react';
import {rotuloDoAtalho} from '../teclas';
import {Maximize, Minimize} from 'lucide-react';

/** Atributo do elemento que vai para a tela cheia (o painel do monitor). */
export const MARCA_TELA_CHEIA = 'data-monitor-tela-cheia';

/** Entra na tela cheia com o monitor dado (ou o da área aberta) ou sai dela, se já estiver. */
export const alternarTelaCheia = (el?: Element | null) => {
  if (document.fullscreenElement) return void document.exitFullscreen().catch(() => undefined);
  const alvo = el ?? document.querySelector(`[${MARCA_TELA_CHEIA}]`);
  void alvo?.requestFullscreen().catch(() => undefined);
};

/** Sai da tela cheia, se estiver nela. Devolve se saiu. */
export const sairDaTelaCheia = () => {
  if (!document.fullscreenElement) return false;
  void document.exitFullscreen().catch(() => undefined);
  return true;
};

export const useTelaCheia = () => {
  const [cheia, setCheia] = useState(() => typeof document !== 'undefined' && Boolean(document.fullscreenElement));
  useEffect(() => {
    const mudou = () => setCheia(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', mudou);
    return () => document.removeEventListener('fullscreenchange', mudou);
  }, []);
  return cheia;
};

export const BotaoTelaCheia: React.FC = () => {
  const cheia = useTelaCheia();
  const rotulo = cheia ? `Sair da tela cheia (Esc ou ${rotuloDoAtalho('Ctrl+F')})` : `Ver o monitor em tela cheia (${rotuloDoAtalho('Ctrl+F')}) · Esc sai`;
  return (
    <button className={`bti tela-cheia${cheia ? ' ligado' : ''}`} aria-label={rotulo} title={rotulo} aria-pressed={cheia}
      onClick={(e) => alternarTelaCheia(e.currentTarget.closest(`[${MARCA_TELA_CHEIA}]`))}>
      {cheia ? <Minimize /> : <Maximize />}
    </button>
  );
};
