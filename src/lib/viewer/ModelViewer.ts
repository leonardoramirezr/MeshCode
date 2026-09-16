import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

export type NavigationMode = "orbit" | "walk";

const MOVE_KEYS: Record<string, [right: number, forward: number]> = {
  KeyW: [0, 1],
  KeyS: [0, -1],
  KeyA: [-1, 0],
  KeyD: [1, 0],
};
// "E" is accepted too since it sits right below "3" (and is Blender's walk-mode "up" key).
const UP_KEYS = new Set(["Digit3", "Numpad3", "KeyE"]);
const DOWN_KEYS = new Set(["KeyX"]);

const LOOK_SENSITIVITY = 0.0025;
const RUN_MULTIPLIER = 3;
const MAX_PITCH = Math.PI / 2 - 0.01;

/** three.js scene that shows a GLB model with orbit and first-person walk navigation. */
export class ModelViewer {
  onSpeedChange?: (factor: number) => void;
  onPointerLockChange?: (locked: boolean) => void;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly canvas: HTMLCanvasElement;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(50, 1, 0.01, 1000);
  private readonly orbit: OrbitControls;
  private readonly loader = new GLTFLoader();
  private readonly timer = new THREE.Timer();
  private readonly resizeObserver: ResizeObserver;
  private readonly environment: THREE.Texture;

  private model: THREE.Object3D | null = null;
  private grid: THREE.GridHelper | null = null;
  private modelCenter = new THREE.Vector3();
  private modelSize = 1;

  private mode: NavigationMode = "orbit";
  private yaw = 0;
  private pitch = 0;
  private dragging = false;
  private speedFactor = 1;
  private readonly pressed = new Set<string>();
  private disposed = false;

  constructor(private readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    // Blender's default view transform is AgX, so this looks closest to the viewport.
    this.renderer.toneMapping = THREE.AgXToneMapping;
    this.canvas = this.renderer.domElement;
    this.canvas.style.display = "block";
    this.canvas.style.outline = "none";
    // Focusable so clicking the viewport takes keyboard focus away from the explorer.
    this.canvas.tabIndex = -1;
    container.appendChild(this.canvas);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.environment = this.environment;
    this.scene.background = new THREE.Color(0x1f1f1f);

    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.position.set(1, 2, 1.5);
    this.scene.add(sun, new THREE.HemisphereLight(0xffffff, 0x444444, 0.4));

    this.orbit = new OrbitControls(this.camera, this.canvas);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.1;
    this.orbit.screenSpacePanning = true;
    this.camera.position.set(3, 2, 3);
    this.orbit.update();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();

    this.canvas.addEventListener("mousedown", this.handleMouseDown);
    this.canvas.addEventListener("wheel", this.handleWheel, { passive: false });
    window.addEventListener("mouseup", this.handleMouseUp);
    window.addEventListener("mousemove", this.handleMouseMove);
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
    window.addEventListener("blur", this.handleBlur);
    document.addEventListener("pointerlockchange", this.handlePointerLockChange);

    this.renderer.setAnimationLoop(() => this.tick());
  }

  /** Replaces the current model. The camera is only reframed when `frame` is true. */
  async setModel(glb: ArrayBuffer, frame: boolean): Promise<void> {
    const gltf = await this.loader.parseAsync(glb, "");
    if (this.disposed) {
      disposeObject(gltf.scene);
      return;
    }
    if (this.model) {
      this.scene.remove(this.model);
      disposeObject(this.model);
    }
    this.model = gltf.scene;
    this.scene.add(this.model);
    this.updateBounds();
    if (frame) this.frameModel();
  }

  setMode(mode: NavigationMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.pressed.clear();
    this.dragging = false;

    if (mode === "walk") {
      this.orbit.enabled = false;
      this.syncLookFromCamera();
    } else {
      if (document.pointerLockElement === this.canvas) document.exitPointerLock();
      // Orbit around a point ahead of the camera, roughly as deep as the model center.
      const direction = this.camera.getWorldDirection(new THREE.Vector3());
      const depth = this.modelCenter.clone().sub(this.camera.position).dot(direction);
      const distance = Math.max(depth, this.modelSize * 0.05);
      this.orbit.target.copy(this.camera.position).addScaledVector(direction, distance);
      this.orbit.enabled = true;
      this.orbit.update();
    }
  }

  /** Moves the camera so the whole model is in view. */
  frameModel(): void {
    const distance = (this.modelSize / 2 / Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2)) * 1.1;
    const offset = new THREE.Vector3(1, 0.7, 1).normalize().multiplyScalar(distance);
    this.camera.position.copy(this.modelCenter).add(offset);
    this.camera.lookAt(this.modelCenter);
    this.orbit.target.copy(this.modelCenter);
    this.orbit.update();
    this.syncLookFromCamera();
  }

  /** Jumps to the model center: walk mode stands the camera there, orbit mode pivots around it. */
  goToCenter(): void {
    if (this.mode === "walk") {
      this.camera.position.copy(this.modelCenter);
    } else {
      const offset = this.camera.position.clone().sub(this.orbit.target);
      this.orbit.target.copy(this.modelCenter);
      this.camera.position.copy(this.modelCenter).add(offset);
      this.orbit.update();
    }
  }

  dispose(): void {
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener("mousedown", this.handleMouseDown);
    this.canvas.removeEventListener("wheel", this.handleWheel);
    window.removeEventListener("mouseup", this.handleMouseUp);
    window.removeEventListener("mousemove", this.handleMouseMove);
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
    window.removeEventListener("blur", this.handleBlur);
    document.removeEventListener("pointerlockchange", this.handlePointerLockChange);
    this.orbit.dispose();
    if (this.model) disposeObject(this.model);
    if (this.grid) disposeObject(this.grid);
    this.environment.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }

  private tick(): void {
    this.timer.update();
    // Clamp so a stalled frame (e.g. while a model is parsed) doesn't teleport the camera.
    const delta = Math.min(this.timer.getDelta(), 0.1);
    if (this.mode === "walk") this.walk(delta);
    else this.orbit.update();
    this.renderer.render(this.scene, this.camera);
  }

  private walk(delta: number): void {
    let right = 0;
    let forward = 0;
    let up = 0;
    for (const code of this.pressed) {
      const move = MOVE_KEYS[code];
      if (move) {
        right += move[0];
        forward += move[1];
      }
      if (UP_KEYS.has(code)) up += 1;
      if (DOWN_KEYS.has(code)) up -= 1;
    }
    if (right === 0 && forward === 0 && up === 0) return;

    // Walking stays on the horizontal plane regardless of where the camera is looking.
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    const direction = new THREE.Vector3(right * cos - forward * sin, 0, -right * sin - forward * cos);
    if (direction.lengthSq() > 0) direction.normalize();
    direction.y = Math.sign(up);

    const running = this.pressed.has("ShiftLeft") || this.pressed.has("ShiftRight");
    const speed = this.baseWalkSpeed() * this.speedFactor * (running ? RUN_MULTIPLIER : 1);
    this.camera.position.addScaledVector(direction, speed * delta);
  }

  private baseWalkSpeed(): number {
    // Scale with the model so a house and a teacup are both comfortable to walk around.
    return THREE.MathUtils.clamp(this.modelSize / 8, 0.05, 20);
  }

  private syncLookFromCamera(): void {
    const euler = new THREE.Euler().setFromQuaternion(this.camera.quaternion, "YXZ");
    this.yaw = euler.y;
    this.pitch = euler.x;
  }

  private updateBounds(): void {
    const box = new THREE.Box3();
    if (this.model) box.setFromObject(this.model);
    if (box.isEmpty()) box.set(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));

    this.modelSize = Math.max(box.getSize(new THREE.Vector3()).length(), 0.001);
    box.getCenter(this.modelCenter);
    this.camera.near = this.modelSize / 2000;
    this.camera.far = this.modelSize * 50;
    this.camera.updateProjectionMatrix();
    this.orbit.maxDistance = this.modelSize * 20;

    if (this.grid) {
      this.scene.remove(this.grid);
      disposeObject(this.grid);
    }
    this.grid = new THREE.GridHelper(this.modelSize * 2, 20, 0x555555, 0x333333);
    this.grid.position.set(this.modelCenter.x, box.min.y, this.modelCenter.z);
    this.scene.add(this.grid);
  }

  private resize(): void {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (width === 0 || height === 0) return;
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private handleMouseDown = (event: MouseEvent): void => {
    if (this.mode !== "walk" || event.button !== 0) return;
    event.preventDefault();
    this.canvas.focus();
    this.dragging = true;
    // Pointer lock isn't available in every webview; dragging to look works as a fallback.
    try {
      const request = this.canvas.requestPointerLock() as Promise<void> | undefined;
      request?.catch(() => {});
    } catch {
      // Ignore: drag-to-look still works.
    }
  };

  private handleMouseUp = (): void => {
    this.dragging = false;
  };

  private handleMouseMove = (event: MouseEvent): void => {
    if (this.mode !== "walk") return;
    if (!this.dragging && document.pointerLockElement !== this.canvas) return;
    // Inverted: moving the mouse drags the scene rather than pointing the camera.
    this.yaw += event.movementX * LOOK_SENSITIVITY;
    this.pitch = THREE.MathUtils.clamp(this.pitch + event.movementY * LOOK_SENSITIVITY, -MAX_PITCH, MAX_PITCH);
    this.camera.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, "YXZ"));
  };

  private handleWheel = (event: WheelEvent): void => {
    if (this.mode !== "walk") return;
    event.preventDefault();
    const factor = this.speedFactor * (event.deltaY < 0 ? 1.15 : 1 / 1.15);
    this.speedFactor = THREE.MathUtils.clamp(factor, 0.05, 50);
    this.onSpeedChange?.(this.speedFactor);
  };

  private handleKeyDown = (event: KeyboardEvent): void => {
    if (this.mode !== "walk" || event.metaKey || event.ctrlKey || event.altKey) return;
    if (isTextInput(event.target)) return;
    const isWalkKey =
      event.code in MOVE_KEYS || UP_KEYS.has(event.code) || DOWN_KEYS.has(event.code) || event.code.startsWith("Shift");
    if (!isWalkKey) return;
    event.preventDefault();
    this.pressed.add(event.code);
  };

  private handleKeyUp = (event: KeyboardEvent): void => {
    this.pressed.delete(event.code);
  };

  private handleBlur = (): void => {
    this.pressed.clear();
    this.dragging = false;
  };

  private handlePointerLockChange = (): void => {
    this.onPointerLockChange?.(document.pointerLockElement === this.canvas);
  };
}

function isTextInput(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

function disposeObject(root: THREE.Object3D): void {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    mesh.geometry?.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) value.dispose();
      }
      material.dispose();
    }
  });
}
