import { knifeMesh, lightDirection, directionTile } from "./knife-mesh.mjs";
import { knifeCenterOffset } from "./knife-motion.mjs";
import { defaultRender } from "./themes.mjs";

const vertexSource = `#version 300 es
precision highp float;
layout(location=0) in vec3 position;
layout(location=1) in vec3 normal;
layout(location=2) in float material;
uniform float directions, grid, tilt;
out vec3 worldNormal;
flat out int surface;
vec3 pose(vec3 p,float a) {
  float c=cos(tilt),s=sin(tilt);
  vec3 q=vec3(p.x,c*p.y-s*p.z,s*p.y+c*p.z);
  return vec3(cos(a)*q.x+sin(a)*q.y,-sin(a)*q.x+cos(a)*q.y,q.z);
}
void main(){
  float id=float(gl_InstanceID),a=id/directions*6.283185307;
  vec3 p=pose(position,a);
  worldNormal=pose(normal,a);surface=int(material+.5);
  vec2 cell=vec2(mod(id,grid),grid-1.-floor(id/grid));
  gl_Position=vec4((p.xy/.6+cell*2.+1.)/grid-1.,-p.z,1.);
}`;
const fragmentSource = `#version 300 es
precision highp float;
in vec3 worldNormal;
flat in int surface;
uniform vec3 light,lightColor,blade,guard,grip;
uniform float ambient,intensity,roughness,metalness;
out vec4 color;
void main(){
  vec3 n=normalize(worldNormal);
  vec3 base=surface==0?blade:surface==1?guard:grip*(surface==3?.65:1.);
  base=pow(base,vec3(2.2));
  float metal=surface<2?metalness:0.;
  float diffuse=max(0.,dot(n,light));
  vec3 halfVector=normalize(light+vec3(0.,0.,1.));
  float exponent=mix(8.,256.,pow(1.-roughness,4.));
  float shine=pow(max(0.,dot(n,halfVector)),exponent)*step(0.,dot(n,light));
  float spec=surface<2?1.:.14;
  vec3 lit=base*(ambient+intensity*diffuse*(1.-metal*.35))*lightColor;
  lit+=mix(vec3(.65),base,metal)*shine*intensity*spec*lightColor;
  lit=lit/(1.+lit*.35);
  color=vec4(pow(lit,vec3(1./2.2)),1.);
}`;
const color3 = (s) =>
  [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16) / 255);
const materialKeys = ["knifeBlade", "knifeGuard", "knifeGrip", "knifeLight"];
const valueKeys = [
  "knife3DLightAzimuth",
  "knife3DLightElevation",
  "knife3DLightIntensity",
  "knife3DAmbient",
  "knife3DRoughness",
  "knife3DMetalness",
  "knife3DTilt",
  "knife3DWidth",
  "knife3DThickness",
  "knife3DDirections",
  "knife3DResolution",
];

export class Knife3D {
  constructor() {
    this.canvas = document.createElement("canvas");
    this.atlas = document.createElement("canvas");
    this.key = "";
    this.rebuilds = 0;
    this.ready = false;
    this.lost = false;
    this.failed = false;
    this.status = "3D尚未启用";
    this.canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      this.lost = true;
      this.ready = false;
      this.key = "";
      this.status = "3D图形上下文已丢失，暂用2D飞刀";
    });
    this.canvas.addEventListener("webglcontextrestored", () => {
      this.lost = false;
      this.failed = false;
      this.gl = null;
      this.key = "";
    });
  }
  init() {
    this.gl = this.canvas.getContext("webgl2", {
      alpha: true,
      antialias: true,
      premultipliedAlpha: true,
      preserveDrawingBuffer: true,
    });
    if (!this.gl) throw Error("设备不支持WebGL2");
    const gl = this.gl,
      program = gl.createProgram(),
      shaders = [];
    try {
      for (const [type, source] of [
        [gl.VERTEX_SHADER, vertexSource],
        [gl.FRAGMENT_SHADER, fragmentSource],
      ]) {
        const shader = gl.createShader(type);
        shaders.push(shader);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
          throw Error(gl.getShaderInfoLog(shader));
        gl.attachShader(program, shader);
      }
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS))
        throw Error(gl.getProgramInfoLog(program));
    } finally {
      for (const shader of shaders) gl.deleteShader(shader);
    }
    this.program = program;
    this.buffer = gl.createBuffer();
    this.uniforms = {};
    for (const name of [
      "directions",
      "grid",
      "tilt",
      "light",
      "lightColor",
      "blade",
      "guard",
      "grip",
      "ambient",
      "intensity",
      "roughness",
      "metalness",
    ])
      this.uniforms[name] = gl.getUniformLocation(program, name);
  }
  prepare(config, palette = {}) {
    if (this.failed || this.lost) return false;
    const colors = materialKeys.map(
      (key) => palette[key] || defaultRender[key],
    );
    const key = [...valueKeys.map((key) => config[key]), ...colors].join("|");
    if (this.ready && key === this.key) return true;
    try {
      if (!this.gl) this.init();
      const gl = this.gl;
      if (gl.isContextLost()) return false;
      this.count = Math.round(config.knife3DDirections);
      this.grid = Math.ceil(Math.sqrt(this.count));
      const max = Math.min(
        gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
        ...gl.getParameter(gl.MAX_VIEWPORT_DIMS),
      );
      this.tile = Math.min(
        Math.round(config.knife3DResolution),
        Math.floor(max / this.grid),
      );
      this.canvas.width = this.canvas.height = this.grid * this.tile;
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.useProgram(this.program);
      gl.enable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      const mesh = knifeMesh(config.knife3DWidth, config.knife3DThickness);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
      gl.bufferData(gl.ARRAY_BUFFER, mesh, gl.STATIC_DRAW);
      for (const [index, size, offset] of [
        [0, 3, 0],
        [1, 3, 12],
        [2, 1, 24],
      ]) {
        gl.enableVertexAttribArray(index);
        gl.vertexAttribPointer(index, size, gl.FLOAT, false, 28, offset);
      }
      const floats = {
        directions: this.count,
        grid: this.grid,
        tilt: (config.knife3DTilt * Math.PI) / 180,
        ambient: config.knife3DAmbient,
        intensity: config.knife3DLightIntensity,
        roughness: config.knife3DRoughness,
        metalness: config.knife3DMetalness,
      };
      for (const [name, value] of Object.entries(floats))
        gl.uniform1f(this.uniforms[name], value);
      gl.uniform3fv(
        this.uniforms.light,
        lightDirection(
          config.knife3DLightAzimuth,
          config.knife3DLightElevation,
        ),
      );
      for (const [i, name] of [
        "blade",
        "guard",
        "grip",
        "lightColor",
      ].entries())
        gl.uniform3fv(this.uniforms[name], color3(colors[i]));
      gl.drawArraysInstanced(gl.TRIANGLES, 0, mesh.length / 7, this.count);
      if (gl.getError() !== gl.NO_ERROR) throw Error("3D绘制失败");
      // One GPU->Canvas copy per settings change, never one readback for every flying knife.
      this.atlas.width = this.canvas.width;
      this.atlas.height = this.canvas.height;
      this.atlas.getContext("2d").drawImage(this.canvas, 0, 0);
      this.key = key;
      this.rebuilds++;
      this.ready = true;
      this.status = `3D统一灯光已启用 · ${this.count}方向 / ${this.tile}px`;
      return true;
    } catch (e) {
      this.failed = true;
      this.ready = false;
      this.status = `3D不可用，已回退2D：${e.message}`;
      return false;
    }
  }
  draw(ctx, x, y, angle, length, scale, meta, config, palette) {
    if (!this.prepare(config, palette)) return false;
    const tile = directionTile(angle, this.count),
      offset = knifeCenterOffset(meta, length, scale, angle),
      size = length * scale * 1.2;
    ctx.save();
    ctx.translate(x + offset.x, y + offset.y);
    ctx.rotate(tile.residual);
    ctx.drawImage(
      this.atlas,
      (tile.index % this.grid) * this.tile,
      Math.floor(tile.index / this.grid) * this.tile,
      this.tile,
      this.tile,
      -size / 2,
      -size / 2,
      size,
      size,
    );
    ctx.restore();
    return true;
  }
}
let shared;
export const getKnife3D = () => (shared ??= new Knife3D());
export const knife3DStatus = () => shared?.status || "3D尚未启用";
