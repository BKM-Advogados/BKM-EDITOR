// "Inserir linha ou seta" do trilho: predefinições de linha, linha tracejada, setas (triângulo, aberta, dupla, tracejada), ponto e
// seta e medida com barras. Cada uma mostra o desenho que a pintura faz de verdade (o mesmo código da prévia e do PNG). A
// camada nasce horizontal, no centro; o ângulo é o Giro dela, e o inspector muda espessura, estilo, pontas e setas.
import React, {useEffect, useRef} from 'react';
import type {DocImagem} from '../../../nucleo/documentos';
import {PREDEFINICOES_LINHA, linhaNova} from '../../../nucleo/linha';
import {usarFora} from '../../componentes/Menu';
import {novaLinha} from './acoes';
import {desenharLinha} from './linha';
import './icones.css';

const Amostra: React.FC<{id: string}> = ({id}) => {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = ref.current;
    const ctx = el?.getContext('2d');
    const p = PREDEFINICOES_LINHA.find((x) => x.id === id);
    if (!el || !ctx || !p) return;
    const dpr = window.devicePixelRatio || 1;
    el.width = 120 * dpr;
    el.height = 28 * dpr;
    ctx.scale(dpr, dpr);
    const c = linhaNova({x1: 8, y1: 14, x2: 112, y2: 14, ...p.opcoes, espessura: Math.min(p.opcoes.espessura ?? 3, 3), tamanho_seta: 11});
    desenharLinha(ctx, {largura: c.largura, altura: c.altura, linha: c.linha}, getComputedStyle(el).color || '#ffffff');
  }, [id]);
  return <canvas ref={ref} className="amostra-linha" width={120} height={28} aria-hidden />;
};

export const InserirLinha: React.FC<{documento: string; doc: DocImagem; fechar: () => void}> = ({documento, doc, fechar}) => {
  const caixa = usarFora(true, fechar);
  return (
    <div ref={caixa} className="flutuante pop-trilho inserir-linha" style={{top: 160}}>
      {PREDEFINICOES_LINHA.map((p) => (
        <button key={p.id} type="button" className="inserir-linha-item" title={p.nome} onClick={() => void novaLinha(documento, doc, p.id).then((ok) => ok && fechar())}>
          <Amostra id={p.id} />
          <span>{p.nome}</span>
        </button>
      ))}
    </div>
  );
};
