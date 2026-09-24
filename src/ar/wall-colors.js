// A wall's confirmed orientation is stable across panning and artwork changes.
// Six 30-degree bins over 180 degrees keep perpendicular walls three colors apart.
const PALETTE = [
  { fill: 0x2acbbb, rim: 0x78ffdf, grid: 0xbaffee },
  { fill: 0x4f8ef5, rim: 0x99c4ff, grid: 0xc5dfff },
  { fill: 0xad78e8, rim: 0xd6afff, grid: 0xead4ff },
  { fill: 0xf3a346, rim: 0xffd18b, grid: 0xffe4bb },
  { fill: 0xe574a5, rim: 0xffafce, grid: 0xffd5e6 },
  { fill: 0xa2c94c, rim: 0xd9f58e, grid: 0xedffbe },
]

export function wallColors(wall) {
  const angle = Math.atan2(wall.normal.x, wall.normal.z)
  const index = ((Math.round(angle / (Math.PI / 6)) % 6) + 6) % 6
  return PALETTE[index]
}
