import "tsconfig-paths/register";
import { config } from "dotenv";
import { requestOpenAiImage } from "@/ai/imageGenerator";
import { saveVisualObject } from "@/ai/visualStorage";

config({ path: ".env.local", quiet: true });

async function main() {
  const image = await requestOpenAiImage({
    width: 1024,
    height: 1024,
    prompt: [
      "A realistic cinematic investigation game asset.",
      "A sealed evidence envelope on a worn metal desk under cool office light.",
      "No readable text, no logo, no watermark, square crop.",
    ].join(" "),
  });
  const saved = await saveVisualObject({
    relativePath: `smoke/image-${Date.now()}.png`,
    body: image.buffer,
    contentType: "image/png",
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        publicUrl: saved.url,
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
