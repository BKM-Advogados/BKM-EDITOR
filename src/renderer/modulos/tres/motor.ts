// Motor do monitor 3D em Three.js puro: renderer, câmera de vista, OrbitControls, gizmo (TransformControls) e raycast.
// Renderiza só quando algo muda; laço contínuo só com a prévia animada ligada. descartar() devolve memória e contexto.
import {PerspectiveCamera, PMREMGenerator, Raycaster, Texture, Vector2, Vector3, WebGLRenderer} from 'three';
import {RoomEnvironment} from 'three/examples/jsm/environments/RoomEnvironment.js';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import {TransformControls, type TransformControlsMode} from 'three/examples/jsm/controls/TransformControls.js';
import type {DocCena3D, Vetor3} from '../../../nucleo/documentos';
import {arred3, arredV, GRAU, vetor, type Transformacao} from './comum';
import {CenaDoc} from './cena';
import type {CameraDoc} from './vista';

const CAMERA_PADRAO: CameraDoc = {posicao: [4, 3, 6], alvo: [0, 0.5, 0], fov: 40};

export class Motor {
  readonly cena = new CenaDoc();
  readonly camera = new PerspectiveCamera(CAMERA_PADRAO.fov, 1, 0.05, 1000);
  private readonly renderer: WebGLRenderer;
  private readonly ambiente: Texture;
  private readonly orbita: OrbitControls;
  private readonly gizmo: TransformControls;
  private readonly raio = new Raycaster();
  private readonly ro: ResizeObserver;
  private quadro = 0;
  private laco = 0;
  private cameraAplicada = '';
  private selecionado: string | null = null;
  private semGizmo = false;
  private antes: Transformacao | null = null;
  private toque: {x: number; y: number; gizmo: boolean} | null = null;

  aoSoltar?: (id: string, antes: Transformacao, depois: Transformacao) => void;
  aoClicar?: (x: number, y: number) => void;
  aoRenderizar?: () => void;
  /** Leitura do valor durante o arrasto do gizmo ("X +0,50 · Y 0,00 · Z 0,00"); null quando solta. */
  aoLer?: (texto: string | null) => void;
  /** A vista mudou (órbita): quem ouve confere se ainda é a câmera do documento. */
  aoMudarVista?: () => void;

  constructor(private readonly hospedeiro: HTMLElement, pixelRatio: number) {
    this.renderer = new WebGLRenderer({antialias: true, powerPreference: 'low-power'});
    this.renderer.setPixelRatio(pixelRatio);
    const tela = this.renderer.domElement;
    tela.style.display = 'block';
    tela.style.outline = 'none';
    hospedeiro.appendChild(tela);

    // um ambiente suave (a "sala" do three) para o metálico ter o que refletir: sem mapa de ambiente, o metálico perto de 1 saía
    // quase preto (tres-efeitos-D16). Pouca intensidade, para o que não é metálico quase não mudar.
    const pmrem = new PMREMGenerator(this.renderer);
    this.ambiente = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.cena.cena.environment = this.ambiente;
    this.cena.cena.environmentIntensity = 0.45;

    this.orbita = new OrbitControls(this.camera, tela);
    this.orbita.addEventListener('change', this.pedir);
    this.gizmo = new TransformControls(this.camera, tela);
    this.gizmo.addEventListener('change', this.pedir);
    this.gizmo.addEventListener('dragging-changed', this.arrastando);
    this.gizmo.addEventListener('objectChange', this.lerArrasto);
    this.cena.cena.add(this.gizmo.getHelper());
    this.orbita.addEventListener('change', this.vistaMudou);

    // cores dos eixos e do eixo ativo pelos tokens do CSS (uma cor, um sentido; sem o RGB puro do three)
    const css = getComputedStyle(document.documentElement);
    const token = (n: string, padrao: string) => css.getPropertyValue(n).trim() || padrao;
    this.gizmo.setColors(token('--eixo-x', '#e5484d'), token('--eixo-y', '#46a758'), token('--eixo-z', '#3e63dd'), '#ffffff');
    // faixa compacta (notebook): gizmo um pouco menor
    if (window.innerWidth < 1600 || window.innerHeight < 800) this.gizmo.setSize(0.85);

    // depois dos controles, para ler o estado do gizmo já atualizado pelo pointerdown dele
    tela.addEventListener('pointerdown', this.apertou);
    tela.addEventListener('pointerup', this.soltou);

    this.aplicarCamera(CAMERA_PADRAO);
    this.ro = new ResizeObserver(() => this.redimensionar());
    this.ro.observe(hospedeiro);
  }

  get tela() {
    return this.renderer.domElement;
  }

  /** Pede um quadro (no máximo um por frame do navegador; com a animação ligada, o laço já desenha). */
  pedir = () => {
    if (this.laco || this.quadro) return;
    this.quadro = requestAnimationFrame(() => {
      this.quadro = 0;
      this.renderizar();
    });
  };

  private renderizar() {
    this.renderer.render(this.cena.cena, this.camera);
    this.aoRenderizar?.();
  }

  private redimensionar() {
    const w = this.hospedeiro.clientWidth;
    const h = this.hospedeiro.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderizar(); // setSize limpa a tela: desenha já, sem esperar o próximo frame
  }

  sincronizar(doc: DocCena3D) {
    this.cena.sincronizar(doc, this.gizmo.dragging ? this.cena.malha(this.selecionado) : null);
    this.anexar();
    this.pedir();
  }

  /** Leva a vista à câmera do documento só quando a câmera do documento muda; o resto das mudanças não mexe na vista. */
  aplicarCamera(c: Partial<CameraDoc> | undefined) {
    const cam: CameraDoc = {
      posicao: vetor(c?.posicao, CAMERA_PADRAO.posicao),
      alvo: vetor(c?.alvo, CAMERA_PADRAO.alvo),
      fov: typeof c?.fov === 'number' && c.fov > 1 && c.fov < 179 ? c.fov : CAMERA_PADRAO.fov,
    };
    const chave = JSON.stringify(cam);
    if (chave === this.cameraAplicada) return;
    this.cameraAplicada = chave;
    this.camera.fov = cam.fov;
    this.camera.position.set(...cam.posicao);
    this.orbita.target.set(...cam.alvo);
    this.camera.updateProjectionMatrix();
    this.orbita.update();
    this.pedir();
  }

  /** A vista atual é a câmera do documento (a última aplicada)? */
  naCamera() {
    if (!this.cameraAplicada) return true;
    const c = JSON.parse(this.cameraAplicada) as CameraDoc;
    const v = this.lerVista();
    const perto = (a: readonly number[], b: readonly number[]) => a.every((x, i) => Math.abs(x - b[i]) < 0.005);
    return perto(v.posicao, c.posicao) && perto(v.alvo, c.alvo) && Math.abs(v.fov - c.fov) < 0.01;
  }

  /** Volta a vista para a câmera do documento. */
  voltarCamera() {
    const c = this.cameraAplicada;
    this.cameraAplicada = '';
    if (c) this.aplicarCamera(JSON.parse(c) as CameraDoc);
    this.aoMudarVista?.();
  }

  /** Ctrl encaixa: 0,1 ao mover, 15° ao girar, 0,1 na escala. */
  encaixe(ligado: boolean) {
    this.gizmo.setTranslationSnap(ligado ? 0.1 : null);
    this.gizmo.setRotationSnap(ligado ? 15 * GRAU : null);
    this.gizmo.setScaleSnap(ligado ? 0.1 : null);
  }

  private vistaMudou = () => this.aoMudarVista?.();

  private lerArrasto = () => {
    if (!this.gizmo.dragging || !this.antes) return;
    const d = this.transformacao();
    if (!d) return;
    const a = this.antes;
    const br = (n: number, casas = 2) => n.toFixed(casas).replace('.', ',').replace(/^-?0,00$/, '0,00');
    const sinal = (n: number) => `${n > 0 ? '+' : ''}${br(n)}`;
    const eixos = ['X', 'Y', 'Z'];
    const eixo = this.gizmo.axis ?? '';
    let texto: string;
    if (this.gizmo.mode === 'rotate') {
      const delta = d.rotacao.map((x, i) => x - a.rotacao[i]);
      const um = eixos.indexOf(eixo);
      texto = um >= 0 ? `Girar ${eixo} ${Math.round(delta[um])}°` : `Girar ${delta.map((x, i) => `${eixos[i]} ${Math.round(x)}°`).join(' · ')}`;
    } else if (this.gizmo.mode === 'scale') {
      const f = d.escala.map((x, i) => (a.escala[i] ? x / a.escala[i] : x));
      texto = f.every((x) => Math.abs(x - f[0]) < 1e-3) ? `Escala ${br(f[0])}×` : `Escala ${f.map((x, i) => `${eixos[i]} ${br(x)}×`).join(' · ')}`;
    } else texto = d.posicao.map((x, i) => `${eixos[i]} ${sinal(x - a.posicao[i])}`).join(' · ');
    this.aoLer?.(texto);
  };

  lerVista = (): CameraDoc => ({posicao: arredV(this.camera.position.toArray()), alvo: arredV(this.orbita.target.toArray()), fov: arred3(this.camera.fov)});

  selecionar(id: string | null, semGizmo: boolean) {
    this.selecionado = id;
    this.semGizmo = semGizmo;
    this.anexar();
  }

  modo(m: TransformControlsMode) {
    this.gizmo.setMode(m);
    this.pedir();
  }

  private anexar() {
    if (this.gizmo.dragging) return;
    const m = this.cena.malha(this.selecionado);
    if (m && m.visible && !this.semGizmo && !this.laco) {
      if (this.gizmo.object !== m) this.gizmo.attach(m);
    } else if (this.gizmo.object) this.gizmo.detach();
    this.pedir();
  }

  animar(ligar: boolean) {
    if (ligar && !this.laco) {
      let anterior = performance.now();
      const passo = (agora: number) => {
        this.cena.girar(Math.min(0.1, (agora - anterior) / 1000));
        anterior = agora;
        this.renderizar();
        this.laco = requestAnimationFrame(passo);
      };
      cancelAnimationFrame(this.quadro);
      this.quadro = 0;
      this.laco = requestAnimationFrame(passo);
      this.gizmo.detach();
    } else if (!ligar && this.laco) {
      cancelAnimationFrame(this.laco);
      this.laco = 0;
      this.cena.pararGiro();
      this.anexar();
    }
  }

  /** Malha sob o ponto da tela (coordenadas do cliente). */
  tocar(x: number, y: number) {
    const r = this.tela.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    this.raio.setFromCamera(new Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1), this.camera);
    return this.cena.tocar(this.raio);
  }

  /** Ponto do mundo na tela, de 0 a 1; null se estiver atrás da câmera. */
  projetar(p: Vetor3): {x: number; y: number} | null {
    const v = new Vector3(...p).project(this.camera);
    if (v.z < -1 || v.z > 1) return null;
    return {x: (v.x + 1) / 2, y: (1 - v.y) / 2};
  }

  private transformacao(): Transformacao | null {
    const m = this.gizmo.object;
    if (!m) return null;
    return {posicao: arredV(m.position.toArray()), rotacao: arredV([m.rotation.x / GRAU, m.rotation.y / GRAU, m.rotation.z / GRAU]), escala: arredV(m.scale.toArray())};
  }

  private arrastando = (e: {value: unknown}) => {
    this.orbita.enabled = !e.value;
    if (e.value) {
      this.antes = this.transformacao();
      return;
    }
    const antes = this.antes;
    const depois = this.transformacao();
    this.antes = null;
    this.aoLer?.(null);
    if (antes && depois && this.selecionado) this.aoSoltar?.(this.selecionado, antes, depois);
  };

  private apertou = (e: PointerEvent) => {
    if (e.button !== 0) return;
    this.toque = {x: e.clientX, y: e.clientY, gizmo: this.gizmo.dragging || this.gizmo.axis !== null};
  };

  private soltou = (e: PointerEvent) => {
    const t = this.toque;
    this.toque = null;
    if (!t || t.gizmo || e.button !== 0 || Math.hypot(e.clientX - t.x, e.clientY - t.y) > 4) return;
    this.aoClicar?.(e.clientX, e.clientY);
  };

  descartar() {
    cancelAnimationFrame(this.quadro);
    cancelAnimationFrame(this.laco);
    this.quadro = this.laco = 0;
    this.ro.disconnect();
    const tela = this.tela;
    tela.removeEventListener('pointerdown', this.apertou);
    tela.removeEventListener('pointerup', this.soltou);
    this.orbita.removeEventListener('change', this.pedir);
    this.gizmo.removeEventListener('change', this.pedir);
    this.gizmo.removeEventListener('dragging-changed', this.arrastando);
    this.gizmo.removeEventListener('objectChange', this.lerArrasto);
    this.orbita.removeEventListener('change', this.vistaMudou);
    this.gizmo.detach();
    this.cena.cena.remove(this.gizmo.getHelper());
    this.gizmo.dispose(); // desliga os eventos e descarta geometrias e materiais do gizmo
    this.orbita.dispose();
    this.cena.descartar();
    this.ambiente.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    tela.remove();
    this.aoSoltar = this.aoClicar = this.aoRenderizar = this.aoLer = this.aoMudarVista = undefined;
  }
}
