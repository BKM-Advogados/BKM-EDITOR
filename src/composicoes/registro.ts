// Registro dos tipos de vídeo: o `composicao` das props (que o resolvedor de cada tipo põe) escolhe o componente. A
// prévia (Player) e a exportação (Root, pelo id) passam por aqui, para os dois desenharem a mesma coisa.
import type React from 'react';
import {VideoCenas} from './cenas/VideoCenas';
import {CarrosselTema} from './cliente/CarrosselTema';

export type IdComposicao = 'VideoCenas' | 'CarrosselTema';

export const COMPOSICOES: Record<IdComposicao, React.FC<Record<string, unknown>>> = {
  VideoCenas: VideoCenas as unknown as React.FC<Record<string, unknown>>,
  CarrosselTema: CarrosselTema as unknown as React.FC<Record<string, unknown>>,
};

/** Id da composição pelas props; o que não for reconhecido é o carrossel da Cliente (documento antigo). */
export const composicaoDe = (props: Record<string, unknown> | null | undefined): IdComposicao =>
  props?.composicao === 'VideoCenas' ? 'VideoCenas' : 'CarrosselTema';
