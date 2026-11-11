// Inspetor de propriedades da Animação, no desenho das outras áreas (cabeçalho, seções recolhíveis, linha de campo):
// valores na agulha, o losango ◆ de quadro-chave na frente de cada propriedade animável, curvas com nome e editor de pixel
import React, {useEffect, useState} from "react";
import {Clapperboard, Diamond} from "lucide-react";
import {
  CURVAS, TEMA_ANIMACAO_NEUTRO, valorEm, type CamadaAnimacao, type Curva, type DocAnimacao,
  type PropriedadeAnimavel, type QuadroChave,
} from "../../../nucleo/animacao";
import {aplicar, useLoja} from "../../estado/loja";
import {
  CabecalhoInspector, CampoCor, CampoDeslizante, CampoNumero, CampoSelecao, CampoTexto, numeroBr, Secao,
} from "../../componentes/Campos";
import {iconeTipoAnimacao, NOME_TIPO_ANIMACAO} from "./CamadasAnimacao";
import {EditorPixel} from "./EditorPixel";
import {aoQuadro, msAtual} from "./tocador";
import {MudancasNoInspetor} from "../../componentes/Agente";
import {DURACAO_PREAJUSTE_MS, modoAnimar, PREAJUSTES, trilhasComPreajuste} from "./preajustes";

export const InspectorAnimacao: React.FC = () => {
  const ativo = useLoja((e) => e.ativo.animacao);
  const doc = useLoja((e) => (ativo ? (e.docs[ativo]?.doc as DocAnimacao | undefined) : undefined));
  const selecao = useLoja((e) => (e.selecao && e.selecao.documento === ativo ? e.selecao.caminho : null));
  const [tempoMs, setTempoMs] = useState(msAtual());
  const [grande, setGrande] = useState(false); // editor de pixel grande, num diálogo

  useEffect(() => {
    return aoQuadro((ms) => setTempoMs(ms));
  }, []);

  if (!ativo || !doc) return <div className="painel"><div className="vazio">Nenhuma animação aberta.</div></div>;

  // Se nenhuma camada selecionada, inspeciona as propriedades da cena / documento
  const matchCamada = selecao?.match(/^\/camadas\/(\d+)$/);
  const indiceCamada = matchCamada ? Number(matchCamada[1]) : -1;
  const camada: CamadaAnimacao | undefined = indiceCamada >= 0 ? doc.camadas?.[indiceCamada] : undefined;

  if (!camada || indiceCamada < 0) {
    return (
      <div className="painel">
        <CabecalhoInspector icone={<Clapperboard />} nome="Animação" sub={`${doc.largura} × ${doc.altura} · ${doc.fps} qps · ${numeroBr(doc.duracao_ms / 1000, 1)} s`} />
        <div className="insp-corpo">
          <Secao titulo="Cena">
            <CampoNumero rotulo="Largura" valor={doc.largura} unidade="px"
              aoMudar={(v) => aplicar(ativo, [{op: "replace", path: "/largura", value: Math.max(16, v)}], "largura da cena")} />
            <CampoNumero rotulo="Altura" valor={doc.altura} unidade="px"
              aoMudar={(v) => aplicar(ativo, [{op: "replace", path: "/altura", value: Math.max(16, v)}], "altura da cena")} />
            <CampoNumero rotulo="Quadros/s" valor={doc.fps} unidade="qps"
              aoMudar={(v) => aplicar(ativo, [{op: "replace", path: "/fps", value: Math.max(1, v)}], "fps da cena")} />
            <CampoNumero rotulo="Duração" valor={Math.round(doc.duracao_ms / 100) / 10} unidade="s"
              aoMudar={(v) => aplicar(ativo, [{op: "replace", path: "/duracao_ms", value: Math.max(100, Math.round(v * 1000))}], "duração da cena")} />
            <CampoCor rotulo="Fundo" valor={doc.fundo} aoMudar={(v) => aplicar(ativo, [{op: "replace", path: "/fundo", value: v}], "fundo da animação")} />
          </Secao>
          <div className="resumo">Clique numa camada no monitor, na lista ou na linha do tempo para editar.</div>
        </div>
      </div>
    );
  }

  const origem = `/camadas/${indiceCamada}`;

  // Auxiliar para verificar se há quadro-chave exatamente no tempo atual (margem de 25ms)
  const quadroChaveNoTempo = (prop: PropriedadeAnimavel): QuadroChave | undefined => {
    const trilha = camada.trilhas?.[prop];
    return trilha?.find((k) => Math.abs(k.t_ms - tempoMs) < 25);
  };

  const alternarQuadroChave = (prop: PropriedadeAnimavel) => {
    const trilhas = {...(camada.trilhas ?? {})};
    const lista = [...(trilhas[prop] ?? [])];
    const k = quadroChaveNoTempo(prop);

    if (k) {
      // Remove o quadro-chave no tempo
      const nova = lista.filter((item) => item !== k);
      if (nova.length > 0) trilhas[prop] = nova;
      else delete trilhas[prop];
    } else {
      // Adiciona quadro-chave com o valor atual
      const val = valorEm(camada, prop, tempoMs);
      const novoK: QuadroChave = {
        t_ms: Math.round(tempoMs),
        valor: val,
        curva: "suave",
      };
      lista.push(novoK);
      lista.sort((a, b) => a.t_ms - b.t_ms);
      trilhas[prop] = lista;
    }

    aplicar(ativo, [{op: "add", path: `${origem}/trilhas`, value: trilhas}], `alternar quadro-chave ${prop}`);
  };

  const mudarValorPropriedade = (prop: PropriedadeAnimavel, novoValor: number | string) => {
    const trilhas = {...(camada.trilhas ?? {})};
    const lista = trilhas[prop] ?? [];
    if (lista.length > 0 || modoAnimar.get()) {
      // propriedade já animada, ou o modo animar ligado: cria ou atualiza o quadro-chave na cabeça de reprodução
      const k = quadroChaveNoTempo(prop);
      if (k) {
        k.valor = novoValor;
      } else {
        lista.push({t_ms: Math.round(tempoMs), valor: novoValor, curva: "suave"});
        lista.sort((a, b) => a.t_ms - b.t_ms);
      }
      trilhas[prop] = lista;
      aplicar(ativo, [{op: "add", path: `${origem}/trilhas`, value: trilhas}], `animar ${prop}`);
    } else {
      // Altera o valor base da camada
      aplicar(ativo, [{op: "add", path: `${origem}/${prop}`, value: novoValor}], `mudar ${prop}`);
    }
  };

  const mudarCurvaDoQuadro = (prop: PropriedadeAnimavel, curva: Curva) => {
    const trilhas = {...(camada.trilhas ?? {})};
    const lista = trilhas[prop];
    if (!lista || lista.length === 0) return;
    // Modifica o quadro-chave ativo ou o mais recente antes do tempo
    const ks = [...lista].sort((a, b) => a.t_ms - b.t_ms);
    const k = ks.find((item) => Math.abs(item.t_ms - tempoMs) < 25) ??
      [...ks].reverse().find((item) => item.t_ms <= tempoMs) ?? ks[0];
    if (k) {
      k.curva = curva;
      aplicar(ativo, [{op: "add", path: `${origem}/trilhas`, value: trilhas}], `curva de ${prop}`);
    }
  };

  // Valores avaliados no tempo corrente
  const x = Number(valorEm(camada, "x", tempoMs));
  const y = Number(valorEm(camada, "y", tempoMs));
  const escala = Number(valorEm(camada, "escala", tempoMs));
  const rotacao = Number(valorEm(camada, "rotacao", tempoMs));
  const opacidade = Number(valorEm(camada, "opacidade", tempoMs));
  const cor = String(valorEm(camada, "cor", tempoMs));

  const BotaoLosango = (prop: PropriedadeAnimavel) => {
    const ativoK = Boolean(quadroChaveNoTempo(prop));
    const temTrilha = Boolean(camada.trilhas?.[prop]?.length);
    return (
      <button
        type="button"
        className={`bt-losango${ativoK ? " ativo" : temTrilha ? " animado" : ""}`}
        onClick={(e) => (e.preventDefault(), alternarQuadroChave(prop))}
        title={ativoK ? "Tirar o quadro-chave deste tempo" : temTrilha ? "Animado: pôr um quadro-chave neste tempo" : "Pôr um quadro-chave neste tempo (K)"}
        aria-label={ativoK ? `Tirar o quadro-chave de ${prop}` : `Pôr um quadro-chave de ${prop}`}
        aria-pressed={ativoK}
      >
        <Diamond fill={ativoK ? "currentColor" : "none"} />
      </button>
    );
  };
  const nomeCurva = (c: Curva) => CURVAS.find((x) => x.id === c)?.nome ?? c;

  return (
    <div className="painel">
      <CabecalhoInspector icone={iconeTipoAnimacao(camada.tipo)} nome={camada.nome} sub={`${NOME_TIPO_ANIMACAO[camada.tipo]} · ${camada.id}`} />
      <MudancasNoInspetor documento={ativo} objeto={origem} />
      <div className="insp-corpo">
        <Secao titulo="Transformação" acao={<span className="rotulo" title="O losango põe ou tira um quadro-chave no tempo da agulha">◆ = quadro-chave</span>}>
          <CampoNumero rotulo="Posição X" valor={x} unidade="px" marcador={BotaoLosango("x")} aoMudar={(v) => mudarValorPropriedade("x", v)} />
          <CampoNumero rotulo="Posição Y" valor={y} unidade="px" marcador={BotaoLosango("y")} aoMudar={(v) => mudarValorPropriedade("y", v)} />
          <CampoNumero rotulo="Escala" valor={escala} passo={0.1} marcador={BotaoLosango("escala")} aoMudar={(v) => mudarValorPropriedade("escala", v)} />
          <CampoNumero rotulo="Rotação" valor={rotacao} unidade="°" marcador={BotaoLosango("rotacao")} aoMudar={(v) => mudarValorPropriedade("rotacao", v)} />
          <CampoDeslizante rotulo="Opacidade" valor={opacidade} min={0} max={1} passo={0.05} formatar={(v) => `${Math.round(v * 100)}%`}
            marcador={BotaoLosango("opacidade")} aoMudar={(v) => mudarValorPropriedade("opacidade", v)} />
        </Secao>

        <Secao titulo="Entrar e sair" acao={<span className="rotulo">a partir da agulha</span>}>
          <div className="preajustes-anim">
            <span className="rot">Entrada</span>
            <div className="chips-anim">
              {PREAJUSTES.map((p) => (
                <button key={p.id} type="button" className="bt mini" title={`${p.nome} ao entrar: ${DURACAO_PREAJUSTE_MS} ms a partir da agulha`}
                  onClick={() => aplicar(ativo, [{op: "add", path: `${origem}/trilhas`, value: trilhasComPreajuste(camada, p, "entrada", tempoMs, doc.duracao_ms)}], `entrada: ${p.nome.toLowerCase()}`)}>
                  {p.nome}
                </button>
              ))}
            </div>
            <span className="rot">Saída</span>
            <div className="chips-anim">
              {PREAJUSTES.map((p) => (
                <button key={p.id} type="button" className="bt mini" title={`${p.nome} ao sair: termina ${DURACAO_PREAJUSTE_MS} ms depois da agulha`}
                  onClick={() => aplicar(ativo, [{op: "add", path: `${origem}/trilhas`, value: trilhasComPreajuste(camada, p, "saida", tempoMs, doc.duracao_ms)}], `saída: ${p.nome.toLowerCase()}`)}>
                  {p.nome}
                </button>
              ))}
            </div>
          </div>
        </Secao>

        {camada.tipo === "forma" && (
          <Secao titulo="Forma">
            <CampoSelecao rotulo="Tipo" valor={camada.forma ?? "retangulo"} opcoes={[["retangulo", "Retângulo"], ["elipse", "Elipse"]]}
              aoMudar={(v) => aplicar(ativo, [{op: "add", path: `${origem}/forma`, value: v}], "tipo de forma")} />
            <CampoCor rotulo="Cor" valor={cor} marcador={BotaoLosango("cor")} aoMudar={(v) => mudarValorPropriedade("cor", v)} />
            {camada.forma !== "elipse" && (
              <CampoNumero rotulo="Cantos" valor={camada.raio ?? 0} unidade="px" aoMudar={(v) => aplicar(ativo, [{op: "add", path: `${origem}/raio`, value: v}], "raio cantos")} />
            )}
            <CampoNumero rotulo="Largura" valor={camada.largura} unidade="px"
              aoMudar={(v) => aplicar(ativo, [{op: "replace", path: `${origem}/largura`, value: Math.max(10, v)}], "largura")} />
            <CampoNumero rotulo="Altura" valor={camada.altura} unidade="px"
              aoMudar={(v) => aplicar(ativo, [{op: "replace", path: `${origem}/altura`, value: Math.max(10, v)}], "altura")} />
          </Secao>
        )}

        {camada.tipo === "texto" && (
          <Secao titulo="Texto">
            <CampoTexto rotulo="Texto" valor={camada.texto ?? ""} multilinha aoMudar={(v) => aplicar(ativo, [{op: "add", path: `${origem}/texto`, value: v}], "texto")} />
            <CampoNumero rotulo="Tamanho" valor={Number(valorEm(camada, "tamanho", tempoMs))} unidade="px" marcador={BotaoLosango("tamanho")}
              aoMudar={(v) => mudarValorPropriedade("tamanho", v)} />
            <CampoCor rotulo="Cor" valor={cor} marcador={BotaoLosango("cor")} aoMudar={(v) => mudarValorPropriedade("cor", v)} />
            <CampoSelecao rotulo="Alinhar" valor={camada.alinhar ?? "centro"} opcoes={[["esquerda", "Esquerda"], ["centro", "Centro"], ["direita", "Direita"]]}
              aoMudar={(v) => aplicar(ativo, [{op: "add", path: `${origem}/alinhar`, value: v}], "alinhar")} />
          </Secao>
        )}

        {camada.tipo === "pixel" && (
          <Secao titulo="Arte em pixel">
            <CampoDeslizante rotulo="Revelação" valor={Number(valorEm(camada, "progresso", tempoMs))} min={0} max={1} passo={0.05}
              formatar={(v) => `${Math.round(v * 100)}%`} marcador={BotaoLosango("progresso")} aoMudar={(v) => mudarValorPropriedade("progresso", v)} />
            <CampoNumero rotulo="Pixel" valor={Number(valorEm(camada, "tamanho_pixel", tempoMs))} unidade="px" marcador={BotaoLosango("tamanho_pixel")}
              aoMudar={(v) => mudarValorPropriedade("tamanho_pixel", v)} />
            <EditorPixel documento={ativo} camada={camada} origem={origem} tema={doc.tema ?? TEMA_ANIMACAO_NEUTRO} aoAbrirGrande={() => setGrande(true)} />
            {grande && (
              <div className="dialogo-fundo" onPointerDown={(e) => e.target === e.currentTarget && setGrande(false)} onKeyDown={(e) => e.key === "Escape" && setGrande(false)}>
                <div className="dialogo editor-grande" role="dialog" aria-label={`Desenhar: ${camada.nome}`}>
                  <div className="dialogo-titulo">Desenhar · {camada.nome}</div>
                  <EditorPixel documento={ativo} camada={camada} origem={origem} tema={doc.tema ?? TEMA_ANIMACAO_NEUTRO} tamanho={560} />
                  <div className="dialogo-botoes"><button className="bt principal" onClick={() => setGrande(false)} autoFocus>Pronto</button></div>
                </div>
              </div>
            )}
          </Secao>
        )}

        {camada.trilhas && Object.values(camada.trilhas).some((ks) => ks && ks.length > 0) && (
          <Secao titulo="Curvas">
            {Object.entries(camada.trilhas).map(([p, ks]) => {
              if (!ks || ks.length === 0) return null;
              const prop = p as PropriedadeAnimavel;
              const k = ks.find((item) => Math.abs(item.t_ms - tempoMs) < 25) ?? ks[0];
              return (
                <CampoSelecao key={prop} rotulo={NOME_PROPRIEDADE[prop] ?? prop} valor={k.curva ?? "suave"}
                  opcoes={CURVAS.map((c): [Curva, string] => [c.id, nomeCurva(c.id)])} aoMudar={(v) => mudarCurvaDoQuadro(prop, v)} />
              );
            })}
          </Secao>
        )}
      </div>
    </div>
  );
};

const NOME_PROPRIEDADE: Partial<Record<PropriedadeAnimavel, string>> = {
  x: "Posição X", y: "Posição Y", escala: "Escala", rotacao: "Rotação", opacidade: "Opacidade", cor: "Cor", tamanho: "Tamanho",
  progresso: "Revelação", tamanho_pixel: "Pixel",
};
