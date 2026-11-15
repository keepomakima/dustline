// DUSTLINE look plan: a dusk desert yard — warm sand, dark steel, one amber accent.
// Six colours only; lighting and fog make every shade the game needs.
export const PALETTE = {
  canvas: '#1a1712',
  surface: '#2b2620',
  hairline: '#4a4238',
  ink: '#efe8d8',
  muted: '#9a8f7a',
  accent: '#f0a830',
  enemy: '#c8452c',
};

export function shade(name) {
  return PALETTE[name];
}
