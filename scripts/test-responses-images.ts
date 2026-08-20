import { normalizeImageUrl, normalizeResponsesImages, ResponseImageError } from "../src/lib/responses-images";

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const dataUrl = `data:image/png;base64,${png}`;

async function main() {
  const normalized = await normalizeImageUrl(dataUrl);
  if (normalized !== dataUrl) throw new Error("Data URL normalization changed a valid image unexpectedly.");

  const input = await normalizeResponsesImages([
    { type: "message", role: "user", content: [{ type: "input_text", text: "What is this?" }, { type: "input_image", image_url: dataUrl }] },
  ]);
  const content = (input as Array<{ content: Array<{ type: string; image_url?: { url: string } }> }>)[0]!.content;
  if (content[0]!.type !== "text" || content[1]!.type !== "image_url" || content[1]!.image_url?.url !== dataUrl) {
    throw new Error("Responses image content was not converted to Chat-compatible content.");
  }

  let rejected = false;
  try {
    await normalizeImageUrl("http://127.0.0.1/image.png");
  } catch (error) {
    rejected = error instanceof ResponseImageError;
  }
  if (!rejected) throw new Error("Private image URL was not rejected.");

  console.log("responses image normalization tests passed");
}

void main();
