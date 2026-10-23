import { Vector3 } from "three";

/** Finite presentation-only movement. Manual controls retain ownership after cancel/settle. */
export class AtlasCameraTransition {
  private active = false;
  private readonly positionGoal = new Vector3();
  private readonly targetGoal = new Vector3();

  start(position: Vector3, target: Vector3) {
    this.positionGoal.copy(position);
    this.targetGoal.copy(target);
    this.active = true;
  }

  cancel() { this.active = false; }

  update(position: Vector3, target: Vector3, deltaSeconds: number, reducedMotion: boolean) {
    if (!this.active) return;
    const alpha = reducedMotion ? 1 : 1 - Math.exp(-Math.max(0, deltaSeconds) * 4.8);
    position.lerp(this.positionGoal, alpha);
    target.lerp(this.targetGoal, alpha);
    if (reducedMotion || (position.distanceToSquared(this.positionGoal) < 1e-8 && target.distanceToSquared(this.targetGoal) < 1e-8)) {
      position.copy(this.positionGoal);
      target.copy(this.targetGoal);
      this.active = false;
    }
  }
}
