// As fontes próprias do projeto aberto (pasta fontes/, copiadas de um kit de marca) entram no carregador das composições
// assim que o projeto abre: o monitor da imagem e o PNG exportado as desenham pelo nome da família, e a prévia do vídeo
// as acha pelo tema. Sem projeto, nada a fazer.
import {registrarFontesDeArquivo} from '../../composicoes/fontes';

export const registrarFontesDoProjeto = (raiz?: string, base?: string) => {
  if (!raiz || !base) return;
  void window.estudio.marcas.fontesDoProjeto()
    .then((lista) => registrarFontesDeArquivo(lista.map((f) => ({familia: f.familia, url: `${base}/${f.arquivo.split('/').map(encodeURIComponent).join('/')}`, peso: f.peso, estilo: f.estilo}))))
    .catch(() => undefined);
};
