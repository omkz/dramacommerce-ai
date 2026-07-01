import type {
  DirectedScene,
  ProductBrief,
  StoryboardScene,
} from "~/types/showrunner";

export function runPromptAgent(
  brief: ProductBrief,
  scenes: DirectedScene[],
): StoryboardScene[] {
  return scenes.map((scene) => ({
    ...scene,
    videoPrompt: createVideoPrompt(brief, scene),
  }));
}

function createVideoPrompt(
  brief: ProductBrief,
  scene: DirectedScene,
): string {
  const { productName, mood, platform } = brief;
  const moodStyle = mood.toLowerCase();

  if (scene.scene === 1) {
    return `Vertical ${platform} video, ${moodStyle} lighting, young professional rushing out of apartment, urban morning atmosphere, fast camera movement, realistic commercial style.`;
  }

  if (scene.scene === 2) {
    return `Cinematic close-up of ${productName}, hands tying the shoes, premium product detail shot, shallow depth of field, realistic lighting, vertical video.`;
  }

  if (scene.scene === 3) {
    return `Urban commuter walking fast through city street, subtle rain reflections, stylish outfit, dynamic tracking shot, ${moodStyle} commercial video, vertical frame.`;
  }

  if (scene.scene === 4) {
    return `Young professional entering modern office building confidently, soft cinematic lighting, emotional shift, product visible but natural, premium ad style.`;
  }

  return `Hero shot of ${productName}, clean dark background, dramatic light sweep, bold text overlay, premium e-commerce advertisement, vertical ${platform} ending shot.`;
}
