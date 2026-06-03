// One-off script: converts every .svg in this folder to .png at 80x80.
// Re-run after editing/adding SVGs. Requires sharp (`npm i --save-dev sharp`).
//
//   node public/images/email-icons/convert.cjs
//
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const svgs = fs.readdirSync(dir).filter(f => f.endsWith('.svg'));

(async () => {
  for (const file of svgs) {
    const name = path.basename(file, '.svg');
    const inPath = path.join(dir, file);
    const outPath = path.join(dir, name + '.png');
    // Fit inside 200x200 max while preserving the SVG's aspect ratio
    // (no padding). Square icons → 200x200; wide illustrations like
    // announcement-hero → 200x<auto>. Chips displayed at 22-24px just
    // downscale crisply; hero images keep their natural proportions.
    await sharp(inPath, { density: 300 })
      .resize(200, 200, { fit: 'inside', withoutEnlargement: false })
      .png()
      .toFile(outPath);
  }
})();
