// Se a instalação traz o projeto de exemplo (src/nucleo/exemplo.ts): sem ele, "Ver um pronto" não aparece. Pergunta ao
// processo principal uma vez por janela.
import {useEffect, useState} from 'react';

let sabido: boolean | null = null;

export const usarTemExemplo = () => {
  const [tem, setTem] = useState(sabido ?? false);
  useEffect(() => {
    if (sabido !== null) return;
    void window.estudio.temExemplo().then((t) => {
      sabido = t;
      setTem(t);
    }).catch(() => setTem(false));
  }, []);
  return tem;
};
