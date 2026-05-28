import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import toIco from "to-ico";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");
const inputPng = join(
  projectRoot,
  "src",
  "frontend",
  "assets",
  "img",
  "logos",
  "c_spes.png"
);
const outputDir = join(projectRoot, "build");
const outputIco = join(outputDir, "icon.ico");

await mkdir(outputDir, { recursive: true });
const originalPng = await readFile(inputPng);
const resizedPng = await sharp(originalPng)
  .resize(256, 256, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toBuffer();
const icoBuffer = await toIco([resizedPng]);
await writeFile(outputIco, icoBuffer);

console.log(`Generated icon: ${outputIco}`);
