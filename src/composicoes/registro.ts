// Registro dos tipos de vídeo: o `composicao` das props (que o resolvedor de cada tipo põe) escolhe o componente. A
// prévia (Player) e a exportação (Root, pelo id) passam por aqui, para os dois desenharem a mesma coisa. Cada componente
// vem embrulhado: antes de desenhar, as fontes próprias que o tema cita (tema.fontes_arquivos, copiadas de um kit de
// marca para fontes/) são registradas no carregador, que as busca no servidor de mídia e segura o render até chegarem.
import React from 'react';
import type {FonteArquivo} from '../nucleo/marca';
import {VideoCenas} from './cenas/VideoCenas';
import {registrarFontesDeArquivo} from './fontes';
import {CarrosselTema} from './cliente/CarrosselTema';
import {definirBaseMidia, midia} from './midia';

export type IdComposicao = 'VideoCenas' | 'CarrosselTema';

type Props = Record<string, unknown> & {base_midia?: string; tema?: {fontes_arquivos?: FonteArquivo[]}};

const comFontesDoTema = (Componente: React.FC<Record<string, unknown>>): React.FC<Record<string, unknown>> => {
  const Embrulho: React.FC<Props> = (p) => {
    const fontes = p.tema?.fontes_arquivos;
    if (Array.isArray(fontes) && fontes.length) {
      definirBaseMidia(p.base_midia);
      registrarFontesDeArquivo(fontes.map((f) => ({familia: f.familia, url: midia(f.arquivo), peso: f.peso, estilo: f.estilo})));
    }
    return React.createElement(Componente, p);
  };
  Embrulho.displayName = Componente.displayName ?? Componente.name;
  return Embrulho as React.FC<Record<string, unknown>>;
};

export const COMPOSICOES: Record<IdComposicao, React.FC<Record<string, unknown>>> = {
  VideoCenas: comFontesDoTema(VideoCenas as unknown as React.FC<Record<string, unknown>>),
  CarrosselTema: comFontesDoTema(CarrosselTema as unknown as React.FC<Record<string, unknown>>),
};

/** Id da composição pelas props; o que não for reconhecido é o carrossel da Cliente (documento antigo). */
export const composicaoDe = (props: Record<string, unknown> | null | undefined): IdComposicao =>
  props?.composicao === 'VideoCenas' ? 'VideoCenas' : 'CarrosselTema';
