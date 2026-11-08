// Marca d'água da exportação: o logo ou a assinatura do kit de marca por cima da composição inteira (fora da pilha de
// efeitos), na caixa que o núcleo já posicionou fora das zonas seguras do destino (nucleo/exportacao.ts,
// marcaDaguaDoDestino). Entra pelo registro.ts quando as props trazem `marca_dagua`, o que só a exportação e a
// miniatura do diálogo põem: o documento e a prévia normal não a veem. O logo vai como está, sem sombra nem filtro (o
// manual da Cliente não deixa o logo levar efeito); a assinatura sai em branco com uma sombra curta para ler em fundo claro.
import React from 'react';
import {AbsoluteFill, Img, useVideoConfig} from 'remotion';
import type {MarcaDaguaP} from '../nucleo/exportacao';
import {fonte} from './fontes';
import {definirBaseMidia, midia} from './midia';

export const MarcaDagua: React.FC<{m: MarcaDaguaP; base_midia?: string}> = ({m, base_midia}) => {
  const {width: W, height: H} = useVideoConfig();
  definirBaseMidia(base_midia);
  const direita = m.alinhar === 'direita';
  const altura = m.altura * H;
  // com placa (contraste de 3:1 com o fundo), a caixa inteira é a placa e a marca fica dentro, com o respiro `pad`
  const pad = m.placa ? m.placa.pad * Math.min(W, H) : 0;
  return (
    <AbsoluteFill style={{pointerEvents: 'none'}} data-marca-dagua="">
      <div style={{position: 'absolute', top: m.y * H, height: altura, width: m.largura * W, ...(direita ? {right: (1 - m.x - m.largura) * W} : {left: m.x * W}),
        boxSizing: 'border-box', padding: pad, ...(m.placa ? {background: m.placa.cor, borderRadius: pad * 1.2} : {}),
        display: 'flex', alignItems: 'center', justifyContent: direita ? 'flex-end' : 'flex-start', opacity: m.opacidade}}>
        {m.logo ? <Img src={midia(m.logo)} style={{height: '100%', maxWidth: '100%', objectFit: 'contain', objectPosition: direita ? 'right center' : 'left center', display: 'block'}} />
          : <span style={{fontFamily: fonte(m.fonte || 'Inter'), fontSize: (altura - 2 * pad) * 0.8, fontWeight: 600, lineHeight: 1, color: '#FFFFFF', whiteSpace: 'nowrap',
            textShadow: m.placa ? 'none' : `0 ${Math.max(1, altura * 0.04)}px ${Math.max(2, altura * 0.12)}px rgba(0, 0, 0, 0.55)`}}>{m.texto}</span>}
      </div>
    </AbsoluteFill>
  );
};
