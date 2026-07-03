import pg from "pg";

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required.");
}

const userEmail = process.env.DEMO_USER_EMAIL || "demo@dramacommerce.ai";
const userId = process.env.DEMO_USER_ID || "demo-user";
const projectId = process.env.DEMO_PROJECT_ID || "demo-product-drama";
const now = new Date();

const showPlan = {
  source: "qwen",
  brief: {
    productName: "Urban Runner Black Shoes",
    productDescription:
      "Lightweight running shoes with breathable mesh, cushioned sole, and a clean all-black look.",
    keySellingPoints:
      "Comfortable for commutes, minimal styling, durable outsole, easy to pair with workwear.",
    offer: "Launch week: 20% off and free shipping today.",
    targetAudience: "Office workers, commuters, young professionals",
    mood: "Premium",
    platform: "TikTok",
    duration: "30 seconds",
    imageName: "demo-product-reference.jpg",
  },
  analysis: {
    category: "Running shoes",
    colors: ["black", "charcoal", "white sole highlight"],
    material: "breathable knit mesh and rubber outsole",
    brandingVisible: "subtle side logo",
    quality: "good",
    canUseAsReference: true,
    issues: [],
  },
  concept:
    "A commuter transforms a rushed morning into a polished, confident arrival by switching into shoes that look clean and feel ready for the whole day.",
  hook: "Your workday starts before you reach the desk.",
  voiceOver:
    "For mornings that move fast, Urban Runner keeps every step light, clean, and ready.",
  storyboard: [
    {
      scene: 1,
      duration: "0-5s",
      title: "The rush",
      visual: "Fast close-ups of a commuter stepping out into a busy morning.",
      voiceOver: "Your day does not wait.",
      camera: "Handheld push-in on feet moving through the doorway.",
      emotion: "urgent",
      useProductReference: false,
      videoPrompt:
        "Vertical 9:16 cinematic ad shot of a commuter leaving home in a fast morning routine, dynamic foot-level movement, premium lighting, no text.",
    },
    {
      scene: 2,
      duration: "5-10s",
      title: "Comfort reveal",
      visual: "The shoes flex naturally while crossing a station platform.",
      voiceOver: "So every step has to feel lighter.",
      camera: "Low tracking shot beside the shoes.",
      emotion: "relief",
      useProductReference: false,
      videoPrompt:
        "Vertical 9:16 low tracking shot of black running shoes walking across a modern train platform, clean product-ad lighting, smooth motion.",
    },
    {
      scene: 3,
      duration: "10-15s",
      title: "All-day style",
      visual: "The shoes pair with smart casual trousers in an office lobby.",
      voiceOver: "Clean enough for work. Built for the commute.",
      camera: "Slow tilt from shoes to confident stride.",
      emotion: "polished",
      useProductReference: false,
      videoPrompt:
        "Vertical 9:16 premium office lobby shot, black commuter shoes with smart casual outfit, slow tilt, cinematic product commercial style.",
    },
    {
      scene: 4,
      duration: "15-20s",
      title: "The proof",
      visual: "A macro detail shot highlights breathable texture and sole grip.",
      voiceOver: "Breathable mesh. Cushioned grip. No extra noise.",
      camera: "Macro dolly across material and outsole.",
      emotion: "assured",
      useProductReference: true,
      videoPrompt:
        "Vertical 9:16 image-to-video product macro animation from the uploaded shoe photo, subtle camera dolly, breathable mesh detail, outsole grip, premium lighting.",
    },
    {
      scene: 5,
      duration: "20-30s",
      title: "Hero offer",
      visual: "The product lands in a clean hero frame with a confident final step.",
      voiceOver: "Urban Runner. Launch week: 20 percent off today.",
      camera: "Locked hero shot with slight push-in.",
      emotion: "decisive",
      useProductReference: true,
      videoPrompt:
        "Vertical 9:16 image-to-video hero shot from the uploaded shoe photo, clean premium background, subtle push-in, confident final step, no text.",
    },
  ],
  timeline: [
    "Open with morning urgency.",
    "Show comfort in motion.",
    "Connect style to workday use.",
    "Prove materials with close detail.",
    "End on hero product and offer.",
  ],
  caption:
    "Commute-ready comfort with a clean office look. Urban Runner is 20% off this launch week.",
  cta: "Shop Urban Runner today",
};

const pool = new Pool({ connectionString });

try {
  await pool.query(
    `
      insert into users (id, email, name)
      values ($1, $2, $3)
      on conflict (email) do update set name = excluded.name
    `,
    [userId, userEmail, "Demo Merchant"],
  );

  await pool.query(
    `
      insert into projects (id, user_id, created_at, show_plan)
      values ($1, $2, $3, $4)
      on conflict (id) do update
      set user_id = excluded.user_id,
          created_at = excluded.created_at,
          show_plan = excluded.show_plan
    `,
    [projectId, userId, now, showPlan],
  );

  console.log(`Seeded demo project ${projectId} for ${userEmail}.`);
} finally {
  await pool.end();
}
