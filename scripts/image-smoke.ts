import "tsconfig-paths/register";
import { config } from "dotenv";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { requestOpenAiImage } from "@/ai/imageGenerator";

config({ path: ".env.local", quiet: true });

async function main() {
  const outDir = path.join(process.cwd(), "public/generated/smoke");
  const outFile = path.join(outDir, `image-${Date.now()}.png`);
  await mkdir(outDir, { recursive: true });

  const image = await requestOpenAiImage({
    width: 1024,
    height: 1024,
    prompt: [
      "A realistic cinematic investigation game asset.",
      "A sealed evidence envelope on a worn metal desk under cool office light.",
      "No readable text, no logo, no watermark, square crop.",
    ].join(" "),
  });

  await writeFile(outFile, image.buffer);
  console.log(
    JSON.stringify(
      {
        ok: true,
        file: outFile,
        publicUrl: `/generated/smoke/${path.basename(outFile)}`,
        model: image.model,
        baseURL: image.baseURL,
        width: image.width,
        height: image.height,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
