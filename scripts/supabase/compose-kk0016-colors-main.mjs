#!/usr/bin/env node
/**
 * Build the KK-0016 "all colors" main photo from the per-color white-background shots.
 *   node scripts/supabase/compose-kk0016-colors-main.mjs
 * Output: tmp/new-listings-images/KK-0016/00-all-colors.jpg (1600x1600, 3-over-2 grid).
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const DIR = join(ROOT, "tmp/new-listings-images/KK-0016");
const COLORS = ["Black", "Black-White", "White-Pink", "Black-Red", "Black-Green"];
const SIZE = 1600;
const TILE = 515;
const GAP = 15;
const NEAR_WHITE = 232;

async function tile(color) {
  const { data, info } = await sharp(join(DIR, color, "01-main.jpg"))
    .trim({ background: "#ffffff", threshold: 18 })
    .resize(TILE, TILE, { fit: "contain", background: "#ffffff" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 3) {
    if (data[i] > NEAR_WHITE && data[i + 1] > NEAR_WHITE && data[i + 2] > NEAR_WHITE) {
      data[i] = data[i + 1] = data[i + 2] = 255;
    }
  }
  return sharp(data, { raw: info }).png().toBuffer();
}

const tiles = await Promise.all(COLORS.map(tile));
const rowWidth = (n) => n * TILE + (n - 1) * GAP;
const top = (SIZE - (2 * TILE + GAP)) / 2;
const left3 = (SIZE - rowWidth(3)) / 2;
const left2 = (SIZE - rowWidth(2)) / 2;

const composites = tiles.map((input, i) => {
  const row = i < 3 ? 0 : 1;
  const col = i < 3 ? i : i - 3;
  const left = (row === 0 ? left3 : left2) + col * (TILE + GAP);
  return { input, left: Math.round(left), top: Math.round(top + row * (TILE + GAP)) };
});

await sharp({ create: { width: SIZE, height: SIZE, channels: 3, background: "#ffffff" } })
  .composite(composites)
  .jpeg({ quality: 90, mozjpeg: true })
  .toFile(join(DIR, "00-all-colors.jpg"));
console.log("wrote", join(DIR, "00-all-colors.jpg"));
