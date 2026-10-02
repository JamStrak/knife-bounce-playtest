// Unit-length mesh pointing along +X. World Z faces the camera; not a textured billboard.
const subtract = (a, b) => a.map((v, i) => v - b[i]);
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const normalize3 = (a) => {
  const l = Math.hypot(...a) || 1;
  return a.map((v) => v / l);
};
export function lightDirection(azimuth, elevation) {
  const a = (azimuth * Math.PI) / 180,
    e = (elevation * Math.PI) / 180;
  return [Math.cos(a) * Math.cos(e), -Math.sin(a) * Math.cos(e), Math.sin(e)];
}
export function rotateKnife(vector, angle, tilt) {
  const t = (tilt * Math.PI) / 180,
    [x, y, z] = vector,
    yy = y * Math.cos(t) - z * Math.sin(t),
    zz = y * Math.sin(t) + z * Math.cos(t);
  return [
    x * Math.cos(angle) + yy * Math.sin(angle),
    -x * Math.sin(angle) + yy * Math.cos(angle),
    zz,
  ];
}
export function knifeMesh(width = 1, thickness = 1) {
  const vertices = [];
  function tri(a, b, c, material) {
    const normal = normalize3(cross(subtract(b, a), subtract(c, a)));
    if (Math.hypot(...cross(subtract(b, a), subtract(c, a))) < 1e-9) return;
    for (const p of [a, b, c]) vertices.push(...p, ...normal, material);
  }
  function connect(rings, material) {
    for (let i = 0; i < rings.length - 1; i++)
      for (let j = 0; j < rings[i].length; j++) {
        const next = (j + 1) % rings[i].length;
        tri(rings[i][j], rings[i + 1][next], rings[i + 1][j], material);
        tri(rings[i][j], rings[i][next], rings[i + 1][next], material);
      }
    for (const [ring, reverse] of [
      [rings[0], true],
      [rings.at(-1), false],
    ]) {
      const center = [ring[0][0], 0, 0];
      for (let j = 0; j < ring.length; j++) {
        const a = ring[j],
          b = ring[(j + 1) % ring.length];
        tri(center, reverse ? b : a, reverse ? a : b, material);
      }
    }
  }
  // Diamond cross section supplies a physical central ridge and independently lit bevels.
  connect(
    [
      [-0.145, 0.038, 0.019],
      [-0.055, 0.072, 0.034],
      [0.29, 0.057, 0.026],
      [0.5, 0, 0],
    ].map(([x, w, z]) => [
      [x, w * width, 0],
      [x, w * width * 0.86, z * thickness * 0.3],
      [x, 0, z * thickness],
      [x, -w * width * 0.86, z * thickness * 0.3],
      [x, -w * width, 0],
      [x, -w * width * 0.86, -z * thickness * 0.3],
      [x, 0, -z * thickness],
      [x, w * width * 0.86, -z * thickness * 0.3],
    ]),
    0,
  );
  function lathe(profile, material, segments = 16) {
    connect(
      profile.map(([x, r]) =>
        Array.from({ length: segments }, (_, i) => {
          const a = (i / segments) * Math.PI * 2;
          return [x, Math.cos(a) * r * width, Math.sin(a) * r * thickness];
        }),
      ),
      material,
    );
  }
  // Leather grip, raised dark bands, gold collar and pommel.
  lathe(
    [
      [-0.465, 0.032],
      [-0.445, 0.04],
      [-0.245, 0.036],
      [-0.218, 0.043],
    ],
    2,
  );
  for (let i = 0; i < 6; i++) {
    const x = -0.438 + i * 0.033;
    lathe(
      [
        [x, 0.039],
        [x + 0.007, 0.044],
        [x + 0.014, 0.039],
      ],
      3,
    );
  }
  lathe(
    [
      [-0.225, 0.042],
      [-0.208, 0.065],
      [-0.188, 0.092],
      [-0.165, 0.085],
      [-0.145, 0.035],
    ],
    1,
  );
  lathe(
    [
      [-0.5, 0.021],
      [-0.493, 0.041],
      [-0.473, 0.05],
      [-0.449, 0.041],
    ],
    1,
  );
  return new Float32Array(vertices);
}
export function directionTile(angle, count) {
  const tau = Math.PI * 2,
    positive = ((angle % tau) + tau) % tau;
  const index = Math.round((positive / tau) * count) % count,
    sampled = (index / count) * tau;
  return {
    index,
    angle: sampled,
    residual: Math.atan2(Math.sin(angle - sampled), Math.cos(angle - sampled)),
  };
}
