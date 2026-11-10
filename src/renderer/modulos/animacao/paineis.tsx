// Módulo de animação 2D com quadros-chave e arte em pixel
import type {PaineisDoModulo} from "../../casca/contrato";
import {CamadasAnimacao} from "./CamadasAnimacao";
import {InspectorAnimacao} from "./InspectorAnimacao";
import {LinhaDoTempoAnimacao} from "./LinhaDoTempoAnimacao";
import {MonitorAnimacao} from "./MonitorAnimacao";
import "./animacao.css";

export const PaineisAnimacao: PaineisDoModulo = {
  tituloLista: "Camadas",
  Lista: CamadasAnimacao,
  Monitor: () => <MonitorAnimacao />,
  Inspector: InspectorAnimacao,
  Linha: LinhaDoTempoAnimacao,
};
