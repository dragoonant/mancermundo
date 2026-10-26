// Camera hooks for e2e tests and dev tools (window.__ms.camera). Filled in by CameraRig while mounted.
/** An exact camera pose: where the camera sits and what it looks at (world inches). */
export interface CameraView {
  position: [number, number, number]
  target: [number, number, number]
}

export interface CameraApi {
  /** world point (inches) -> page pixel */
  project(x: number, y: number, z: number): { x: number; y: number }
  lookAt(x: number, z: number, distance: number): void
  get(): { x: number; z: number; distance: number }
  repaint(): void
  /** the exact current pose */
  snapshot(): CameraView
  /**
   * Eased tween to `view` over `ms`. Resolves true when it arrived and false when it was cancelled (any user camera
   * input, a preset or another flyTo), so the director never fights the player.
   */
  flyTo(view: CameraView, ms: number): Promise<boolean>
  /** a view looking at (x, z) from the current azimuth and tilt at `distance` (clamped to the camera limits) */
  focusView(x: number, z: number, distance: number): CameraView
  /**
   * The shot camera: `true` relaxes the camera limits (minimum distance, tilt, target above the ground) so a
   * third-person view fits, `false` restores them. Any camera input from the player ends it by itself.
   * Optional so a stand-in camera (tests) can leave it out.
   */
  cinematic?(on: boolean): void
  /** True from `cinematic(true)` until `cinematic(false)` or the player's own camera input took over. */
  cinematicActive?(): boolean
}

export const cameraApi: { current: CameraApi | null } = { current: null }

/** Wake the demand-driven render loop (no-op before the canvas exists). */
export function repaintBoard(): void {
  cameraApi.current?.repaint()
}
