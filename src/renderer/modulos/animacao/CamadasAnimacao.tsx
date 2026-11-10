// Lista de camadas da Animação: ordem, visibilidade, travamento, renomear e "+ Camada"
import React, {useState} from "react";
import {
  ChevronDown, ChevronUp, Copy, Eye, EyeOff, Lock, LockOpen, Plus, Square,
  Trash2, Type, Image as ImageIcon, Grid,
} from "lucide-react";
import type {CamadaAnimacao, DocAnimacao, TipoCamadaAnimacao} from "../../../nucleo/animacao";
import {idLivreAnimacao, novaCamadaAnimacao} from "../../../nucleo/animacao";
import {aplicar, selecionar, useLoja} from "../../estado/loja";

const iconeTipo = (tipo: TipoCamadaAnimacao) => {
  switch (tipo) {
    case "forma": return <Square size={14} />;
    case "texto": return <Type size={14} />;
    case "imagem": return <ImageIcon size={14} />;
    case "pixel": return <Grid size={14} />;
  }
};

export const CamadasAnimacao: React.FC = () => {
  const ativo = useLoja((e) => e.ativo.animacao);
  const doc = useLoja((e) => (ativo ? (e.docs[ativo]?.doc as DocAnimacao | undefined) : undefined));
  const selecao = useLoja((e) => (e.selecao && e.selecao.documento === ativo ? e.selecao.caminho : null));
  const [editandoNome, setEditandoNome] = useState<string | null>(null);
  const [nomeTemp, setNomeTemp] = useState("");

  if (!ativo || !doc) return <div className="vazio">Nenhuma animação aberta.</div>;

  const camadas = doc.camadas ?? [];

  const adicionarCamada = (tipo: TipoCamadaAnimacao) => {
    const id = idLivreAnimacao(doc, tipo);
    const nova = novaCamadaAnimacao(tipo, id);
    const novasCamadas = [...camadas, nova];
    aplicar(ativo, [{op: "replace", path: "/camadas", value: novasCamadas}], `adicionar camada ${tipo}`);
    selecionar({documento: ativo, caminho: `/camadas/${novasCamadas.length - 1}`});
  };

  const alternarVisivel = (i: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const c = camadas[i];
    aplicar(ativo, [{op: "add", path: `/camadas/${i}/visivel`, value: !(c.visivel ?? true)}], "visibilidade da camada");
  };

  const alternarTravada = (i: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const c = camadas[i];
    aplicar(ativo, [{op: "add", path: `/camadas/${i}/travada`, value: !(c.travada ?? false)}], "travar camada");
  };

  const moverCamada = (de: number, para: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (para < 0 || para >= camadas.length) return;
    const lista = [...camadas];
    const [c] = lista.splice(de, 1);
    lista.splice(para, 0, c);
    aplicar(ativo, [{op: "replace", path: "/camadas", value: lista}], "reordenar camadas");
    selecionar({documento: ativo, caminho: `/camadas/${para}`});
  };

  const duplicarCamada = (i: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const c = camadas[i];
    const novoId = idLivreAnimacao(doc, c.tipo);
    const copia: CamadaAnimacao = {
      ...JSON.parse(JSON.stringify(c)),
      id: novoId,
      nome: `${c.nome} (cópia)`,
      x: c.x + 20,
      y: c.y + 20,
    };
    const lista = [...camadas];
    lista.splice(i + 1, 0, copia);
    aplicar(ativo, [{op: "replace", path: "/camadas", value: lista}], "duplicar camada");
    selecionar({documento: ativo, caminho: `/camadas/${i + 1}`});
  };

  const excluirCamada = (i: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const lista = camadas.filter((_, idx) => idx !== i);
    aplicar(ativo, [{op: "replace", path: "/camadas", value: lista}], "excluir camada");
    selecionar(null);
  };

  const salvarNome = (i: number) => {
    if (nomeTemp.trim()) {
      aplicar(ativo, [{op: "replace", path: `/camadas/${i}/nome`, value: nomeTemp.trim()}], "renomear camada");
    }
    setEditandoNome(null);
  };

  return (
    <div className="painel-camadas-animacao">
      <div className="pca-topo">
        <span className="pca-titulo">Camadas ({camadas.length})</span>
        <div className="pca-acoes">
          <button className="bt-acao-camada" onClick={() => adicionarCamada("forma")} title="Adicionar Forma">
            <Plus size={13} /><Square size={13} />
          </button>
          <button className="bt-acao-camada" onClick={() => adicionarCamada("texto")} title="Adicionar Texto">
            <Plus size={13} /><Type size={13} />
          </button>
          <button className="bt-acao-camada" onClick={() => adicionarCamada("imagem")} title="Adicionar Imagem">
            <Plus size={13} /><ImageIcon size={13} />
          </button>
          <button className="bt-acao-camada" onClick={() => adicionarCamada("pixel")} title="Adicionar Pixel">
            <Plus size={13} /><Grid size={13} />
          </button>
        </div>
      </div>

      <div className="pca-lista">
        {camadas.length === 0 ? (
          <div className="vazio">Nenhuma camada. Use os botões acima para adicionar.</div>
        ) : (
          // Exibe as camadas de cima para baixo (ordem visual de empilhamento)
          [...camadas].map((_, idxInvertido) => {
            const i = camadas.length - 1 - idxInvertido;
            const c = camadas[i];
            const caminho = `/camadas/${i}`;
            const selecionada = selecao === caminho;
            const visivel = c.visivel !== false;
            const travada = c.travada === true;

            return (
              <div
                key={c.id ?? i}
                className={`pca-item${selecionada ? " selecionado" : ""}${!visivel ? " oculta" : ""}`}
                onClick={() => selecionar({documento: ativo, caminho})}
              >
                <button
                  className="bt-olho"
                  onClick={(e) => alternarVisivel(i, e)}
                  title={visivel ? "Ocultar camada" : "Mostrar camada"}
                >
                  {visivel ? <Eye size={14} /> : <EyeOff size={14} />}
                </button>
                <button
                  className="bt-cadeado"
                  onClick={(e) => alternarTravada(i, e)}
                  title={travada ? "Destravar camada" : "Travar camada"}
                >
                  {travada ? <Lock size={14} /> : <LockOpen size={14} />}
                </button>
                <span className="pca-tipo-icone">{iconeTipo(c.tipo)}</span>

                <div className="pca-nome-wrapper">
                  {editandoNome === c.id ? (
                    <input
                      className="pca-input-nome"
                      value={nomeTemp}
                      autoFocus
                      onChange={(e) => setNomeTemp(e.target.value)}
                      onBlur={() => salvarNome(i)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") salvarNome(i);
                        if (e.key === "Escape") setEditandoNome(null);
                      }}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <span
                      className="pca-nome"
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        setEditandoNome(c.id);
                        setNomeTemp(c.nome);
                      }}
                      title="Clique duplo para renomear"
                    >
                      {c.nome}
                    </span>
                  )}
                </div>

                <div className="pca-botoes-item">
                  <button
                    className="bt-min"
                    disabled={i === camadas.length - 1}
                    onClick={(e) => moverCamada(i, i + 1, e)}
                    title="Trazer para frente"
                  >
                    <ChevronUp size={13} />
                  </button>
                  <button
                    className="bt-min"
                    disabled={i === 0}
                    onClick={(e) => moverCamada(i, i - 1, e)}
                    title="Enviar para trás"
                  >
                    <ChevronDown size={13} />
                  </button>
                  <button className="bt-min" onClick={(e) => duplicarCamada(i, e)} title="Duplicar">
                    <Copy size={13} />
                  </button>
                  <button className="bt-min perigo" onClick={(e) => excluirCamada(i, e)} title="Excluir">
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
