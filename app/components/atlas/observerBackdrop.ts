import * as THREE from "three";
import { altAzToWorld } from "../../../lib/atlas/constellations";

/** Readability backdrop only. It never creates celestial objects or local terrain. */
export function addObserverBackdrop(group: THREE.Group, sunAltitude: number, cardinals: boolean) {
  const dome = new THREE.Mesh(new THREE.SphereGeometry(18, 48, 24), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { daylight: { value: THREE.MathUtils.smoothstep(sunAltitude, -18, 8) } },
    vertexShader: "varying float height; void main(){ height=normalize(position).y; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }",
    fragmentShader: `varying float height; uniform float daylight;
      void main(){
        vec3 top=mix(vec3(.006,.012,.03),vec3(.025,.08,.16),daylight);
        vec3 edge=mix(vec3(.035,.075,.11),vec3(.12,.18,.23),daylight);
        vec3 sky=mix(top,edge,exp(-max(height,0.)*7.));
        vec3 ground=mix(vec3(.012,.022,.022),vec3(.025,.045,.04),exp(min(height,0.)*8.));
        gl_FragColor=vec4(height<0.?ground:sky,1.);
      }`,
  }));
  dome.renderOrder = -10;
  group.add(dome);
  if (!cardinals) return;
  for (const [text, azimuth] of [["N · NORTE", 0], ["L · LESTE", 90], ["S · SUL", 180], ["O · OESTE", 270]] as const) {
    const canvas = document.createElement("canvas");
    canvas.width = 256; canvas.height = 64;
    const context = canvas.getContext("2d");
    if (!context) continue;
    context.font = "bold 32px sans-serif";
    context.textAlign = "center"; context.textBaseline = "middle";
    context.fillStyle = "#f6dca0";
    context.fillText(text, 128, 32);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false }));
    label.position.set(...altAzToWorld({ altitude_deg: 3, azimuth_deg: azimuth }, 13.7));
    label.scale.set(4.8, 1.2, 1);
    label.name = "observer-cardinal-label";
    label.renderOrder = 3;
    group.add(label);
  }
}
