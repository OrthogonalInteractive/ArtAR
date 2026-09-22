import { writeFileSync } from 'node:fs'
const base = (body, w = 600, h = 800) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><filter id="paper"><feTurbulence type="fractalNoise" baseFrequency=".5" numOctaves="3" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope=".07"/></feComponentTransfer><feBlend in="SourceGraphic" mode="multiply"/></filter></defs><g filter="url(#paper)">${body}</g></svg>`
const works = {
  'still-blue': base(
    `<rect width="600" height="800" fill="#eae5d8"/><path d="M75 80h320v365H75z" fill="#203f6f"/><path d="M162 195h354v493H162z" fill="#86a3b8"/><path d="M162 195h233v250H162z" fill="#436885"/><path d="M0 598c133-28 226-10 325 6s180 2 275-16v212H0z" fill="#cdc7b6"/><path d="M83 469h4v207h-4z" fill="#2b3d4d"/><circle cx="463" cy="125" r="32" fill="#cfab6b"/>`,
  ),
  'sun-study': base(
    `<rect width="600" height="600" fill="#eee2c8"/><circle cx="304" cy="259" r="184" fill="#cc632e"/><path d="M0 319h600v281H0z" fill="#dfb677"/><path d="M65 319h181v222H65z" fill="#a34128"/><path d="M375 128h87v369h-87z" fill="#eacb95"/><path d="M246 319h129v144H246z" fill="#7f4937"/>`,
    600,
    600,
  ),
  botanical: base(
    `<rect width="600" height="800" fill="#e6e8dd"/><path d="M267 751c37-190 39-365 64-620" fill="none" stroke="#465343" stroke-width="5"/><g fill="#6a7961"><path d="M316 316C105 284 94 123 135 87c178 75 195 129 181 229z"/><path d="M318 405c-2-193 134-244 213-220-14 154-94 205-213 220z"/><path d="M300 510C99 502 48 380 81 330c153 1 237 71 219 180z"/><path d="M289 620c35-168 146-210 237-161-42 133-125 163-237 161z"/></g><g fill="none" stroke="#b7bea7" stroke-width="2"><path d="M315 315 147 112M322 395 508 205M299 505 100 349M291 614 504 473"/></g>`,
  ),
  tidelines: base(
    `<rect width="800" height="500" fill="#d5deda"/><path d="M0 179q230 30 400 0t400 15v306H0z" fill="#95aeb0"/><path d="M0 237q160-45 380 1t420-7v269H0z" fill="#587a88"/><path d="M0 343q200-50 350 12t450-3v148H0z" fill="#d9d0b9"/><path d="M0 363q200-38 357 15t443-7" fill="none" stroke="#f5f2e7" stroke-width="9"/><circle cx="591" cy="89" r="32" fill="#ececd9"/>`,
    800,
    500,
  ),
  balance: base(
    `<rect width="600" height="800" fill="#e7dfd2"/><ellipse cx="307" cy="687" rx="193" ry="29" fill="#c9bda7"/><path d="M168 670V430h277v240z" fill="#c76f45"/><path d="M128 401c8-162 335-162 348 0z" fill="#303f42"/><circle cx="305" cy="197" r="104" fill="#b8af8c"/><path d="M248 670V430h67v240z" fill="#ba5a35"/>`,
  ),
  'line-garden': base(
    `<rect width="600" height="600" fill="#eae8df"/><circle cx="372" cy="219" r="147" fill="#c5d0bd"/><g fill="none" stroke="#394847" stroke-width="3">${Array.from({ length: 13 }, (_, i) => `<path d="M${75 + i * 22} 555C${20 + i * 22} 322 ${370 + i * 10} 418 ${227 + i * 18} 71"/>`).join('')}</g><path d="M106 509h380" stroke="#ad7754" stroke-width="10"/>`,
    600,
    600,
  ),
}
for (const [name, svg] of Object.entries(works))
  writeFileSync(new URL(`../public/art/${name}.svg`, import.meta.url), svg)
