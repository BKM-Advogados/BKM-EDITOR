// Registro dos tipos de vídeo: o `composicao` das props (que o resolvedor de cada tipo põe) escolhe o componente. A
// prévia (Player) e a exportação (Root, pelo id) passam por aqui, para os dois desenharem a mesma coisa. Cada componente
// vem embrulhado: antes de desenhar, as fontes próprias que o tema cita (tema.fontes_arquivos, copiadas de um kit de
// marca para fontes/) são registradas no carregador, que as busca no servidor de mídia e segura o render até chegarem;
// e, quando as props trazem `marca_dagua` (só a exportação e a miniatura do diálogo põem), a MarcaDagua vai por cima.
import React from 'react';
import type {FonteArquivo} from '../nucleo/marca';
import {VideoCenas} from './cenas/VideoCenas';
import {deFonteArquivo, registrarFontesDeArquivo} from './fontes';
import {CarrosselTema} from './carrossel/CarrosselTema';
import {definirBaseMidia, midia} from './midia';
import {Animacao} from './animacao/Animacao';
import type {MarcaDaguaP} from '../nucleo/exportacao';
import {MarcaDagua} from './MarcaDagua';

export type IdComposicao = 'VideoCenas' | 'CarrosselTema' | 'Animacao';

type Props = Record<string, unknown> & {base_midia?: string; tema?: {fontes_arquivos?: FonteArquivo[]}; marca_dagua?: MarcaDaguaP};

const comFontesDoTema = (Componente: React.FC<Record<string, unknown>>): React.FC<Record<string, unknown>> => {
  const Embrulho: React.FC<Props> = (p) => {
    const fontes = p.tema?.fontes_arquivos;
    if (Array.isArray(fontes) && fontes.length) {
      definirBaseMidia(p.base_midia);
      registrarFontesDeArquivo(fontes.map((f) => deFonteArquivo(f, midia(f.arquivo))));
    }
    // marca d'água da exportação (frente C): por cima de tudo, só quando as props trazem uma
    if (p.marca_dagua) return React.createElement(React.Fragment, null, React.createElement(Componente, p), React.createElement(MarcaDagua, {m: p.marca_dagua, base_midia: p.base_midia}));
    return React.createElement(Componente, p);
  };
  Embrulho.displayName = Componente.displayName ?? Componente.name;
  return Embrulho as React.FC<Record<string, unknown>>;
};

export const COMPOSICOES: Record<IdComposicao, React.FC<Record<string, unknown>>> = {
  VideoCenas: comFontesDoTema(VideoCenas as unknown as React.FC<Record<string, unknown>>),
  CarrosselTema: comFontesDoTema(CarrosselTema as unknown as React.FC<Record<string, unknown>>),
  Animacao: Animacao as unknown as React.FC<Record<string, unknown>>,
};

/** Id da composição pelas props; o que não for reconhecido é o carrossel narrado (roteiro.json). */
export const composicaoDe = (props: Record<string, unknown> | null | undefined): IdComposicao =>
  props?.composicao === 'VideoCenas' ? 'VideoCenas' : props?.composicao === 'Animacao' ? 'Animacao' : 'CarrosselTema';
