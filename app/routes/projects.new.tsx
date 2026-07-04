import { useEffect, useState } from "react";
import { Form, redirect, useActionData, useNavigation } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { createShowrunnerJob } from "~/services/project-store.server";
import { enqueueShowrunnerGenerateJob } from "~/services/showrunner-queue.server";
import {
  assertValidProductImage,
  deleteUploadedFile,
  saveUploadedImage,
} from "~/services/image-upload.server";
import { checkGenerateRateLimit } from "~/services/rate-limit.server";
import { requireUser } from "~/services/auth.server";
import type { ProductBrief } from "~/types/showrunner";

const MOOD_OPTIONS = new Set([
  "Cinematic",
  "Funny",
  "Premium",
  "Emotional",
  "Fast-paced",
]);

const PLATFORM_OPTIONS = new Set([
  "TikTok",
  "Instagram Reels",
  "YouTube Shorts",
]);

const DURATION_OPTIONS = new Set([
  "15 seconds",
  "30 seconds",
  "45 seconds",
  "60 seconds",
]);

const ASPECT_RATIO_OPTIONS = new Set(["9:16", "1:1", "16:9"]);
const PRODUCT_REFERENCE_MODE_OPTIONS = new Set(["auto", "force", "disable"]);
const DEFAULT_TARGET_AUDIENCE = "General online shoppers";
type AspectRatio = NonNullable<ProductBrief["aspectRatio"]>;
type ProductReferenceMode = NonNullable<ProductBrief["productReferenceMode"]>;

const crew = [
  { role: "Analyze Agent", job: "Reads the product photo for category, colors, and quality" },
  { role: "Story Agent", job: "Writes the concept, hook, and voice-over" },
  { role: "Director Agent", job: "Blocks the five-scene storyboard" },
  { role: "Prompt Agent", job: "Writes Wan-ready video prompts per scene" },
  { role: "Critic Agent", job: "Reviews the storyboard before it goes to render" },
  { role: "Editor Agent", job: "Cuts the timeline, caption, and CTA" },
];

export function meta() {
  return [
    { title: "Generate Product Drama | DramaCommerce AI" },
    {
      name: "description",
      content: "Generate a short product drama ad from one product photo.",
    },
  ];
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requireUser(request);

  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  const user = await requireUser(request);
  const formData = await request.formData();

  const productName = getFormString(formData, "productName");
  const productDescription = getFormString(formData, "productDescription");
  const keySellingPoints = getFormString(formData, "keySellingPoints");
  const offer = getFormString(formData, "offer");
  const targetAudience =
    getFormString(formData, "targetAudience") || DEFAULT_TARGET_AUDIENCE;
  const mood = getFormString(formData, "mood");
  const platform = getFormString(formData, "platform");
  const duration = getFormString(formData, "duration");
  const aspectRatio = parseAspectRatio(getFormString(formData, "aspectRatio"));
  const showProductOverlay = formData.has("showProductOverlay");
  const productReferenceMode = parseProductReferenceMode(
    getFormString(formData, "productReferenceMode"),
  );

  const validationError = validateBriefFields({
    productName,
    productDescription,
    keySellingPoints,
    offer,
    targetAudience,
    mood,
    platform,
    duration,
    aspectRatio,
    productReferenceMode,
  });

  if (validationError) {
    return { error: validationError };
  }

  const productImage = formData.get("productImage");

  try {
    await assertValidProductImage(productImage);
  } catch (error) {
    return {
      error: getUploadErrorMessage(error),
    };
  }

  const rateLimitResult = await checkGenerateRateLimit(user.id);

  if (!rateLimitResult.allowed) {
    return { error: rateLimitResult.message };
  }

  const uploadedImage = await saveUploadedImage(productImage);

  const brief = {
    productName,
    productDescription: productDescription || undefined,
    keySellingPoints: keySellingPoints || undefined,
    offer: offer || undefined,
    targetAudience,
    mood,
    platform,
    duration,
    aspectRatio,
    imageName: uploadedImage.imageName,
    imageUrl: uploadedImage.imageUrl,
    showProductOverlay,
    productReferenceMode,
  };

  const showrunnerJobId = crypto.randomUUID();

  try {
    await createShowrunnerJob(showrunnerJobId, user.id, brief);
    await enqueueShowrunnerGenerateJob({
      showrunnerJobId,
      userId: user.id,
    });
  } catch (error) {
    console.error("Failed to queue show plan generation:", error);
    await deleteUploadedFile(uploadedImage.imageUrl);

    return {
      error:
        "Unable to queue generation. Check Redis/BullMQ configuration and try again.",
    };
  }

  return redirect(`/projects/new/${showrunnerJobId}`);
}

function getFormString(formData: FormData, key: string): string {
  return String(formData.get(key) || "").trim();
}

function validateBriefFields({
  productName,
  productDescription,
  keySellingPoints,
  offer,
  targetAudience,
  mood,
  platform,
  duration,
  aspectRatio,
  productReferenceMode,
}: {
  productName: string;
  productDescription: string;
  keySellingPoints: string;
  offer: string;
  targetAudience: string;
  mood: string;
  platform: string;
  duration: string;
  aspectRatio: string;
  productReferenceMode: string;
}): string | null {
  if (!productName) {
    return "Product name is required.";
  }

  if (productDescription.length > 500) {
    return "Product description must be 500 characters or fewer.";
  }

  if (keySellingPoints.length > 500) {
    return "Key selling points must be 500 characters or fewer.";
  }

  if (offer.length > 180) {
    return "Offer must be 180 characters or fewer.";
  }

  if (!MOOD_OPTIONS.has(mood)) {
    return "Choose a valid mood.";
  }

  if (!PLATFORM_OPTIONS.has(platform)) {
    return "Choose a valid platform.";
  }

  if (!DURATION_OPTIONS.has(duration)) {
    return "Choose a valid duration.";
  }

  if (!ASPECT_RATIO_OPTIONS.has(aspectRatio)) {
    return "Choose a valid aspect ratio.";
  }

  if (!PRODUCT_REFERENCE_MODE_OPTIONS.has(productReferenceMode)) {
    return "Choose a valid product reference mode.";
  }

  return null;
}

function parseAspectRatio(value: string): AspectRatio {
  return ASPECT_RATIO_OPTIONS.has(value) ? value as AspectRatio : "9:16";
}

function parseProductReferenceMode(value: string): ProductReferenceMode {
  return PRODUCT_REFERENCE_MODE_OPTIONS.has(value) ? value as ProductReferenceMode : "auto";
}

function getUploadErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unable to upload the product image.";
}

export default function Generate() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isGenerating = navigation.state !== "idle";
  const [advancedOpen, setAdvancedOpen] = useState(Boolean(actionData?.error));

  useEffect(() => {
    if (actionData?.error) {
      setAdvancedOpen(true);
    }
  }, [actionData]);

  return (
    <main className="min-h-screen bg-ink px-6 py-10 text-bone">
      <div className="mx-auto max-w-6xl">
        <a href="/dashboard" className="text-sm text-ash hover:text-bone">
          ← Back to Dashboard
        </a>

        <div className="mt-10 grid gap-8 lg:grid-cols-[1fr_0.8fr]">
          <section>
            <p className="font-mono text-xs uppercase tracking-[0.3em] text-gold">
              Product Brief
            </p>

            <h1 className="mt-4 font-display text-4xl font-medium tracking-tight text-bone md:text-5xl">
              Create a product drama ad
            </h1>

            <p className="mt-4 max-w-xl text-ash">
              Upload one product photo and describe the product, audience,
              offer, mood, and platform. Six Qwen agents analyze the photo and
              turn the brief into a story, storyboard, Wan prompts, and edit plan.
            </p>

            <Form
              method="post"
              encType="multipart/form-data"
              className="mt-8 space-y-6 rounded-sm border border-paper-dim bg-paper p-8 text-ink shadow-2xl"
            >
              <div className="flex items-center justify-between border-b border-ink/10 pb-4 font-mono text-[11px] uppercase tracking-[0.25em] text-ink/50">
                <span>Product Inputs</span>
                <span>Scene Count · 05</span>
              </div>

              <div>
                <label
                  htmlFor="productName"
                  className="block font-mono text-xs uppercase tracking-widest text-ink/60"
                >
                  Product name
                </label>
                <input
                  id="productName"
                  name="productName"
                  type="text"
                  placeholder="Urban Runner Black Shoes"
                  required
                  className="mt-2 w-full border-b-2 border-ink/15 bg-transparent px-1 py-2 text-ink outline-none placeholder:text-ink/30 focus:border-flame"
                />
              </div>

              <div>
                <label
                  htmlFor="productImage"
                  className="block font-mono text-xs uppercase tracking-widest text-ink/60"
                >
                  Product image
                </label>
                <input
                  id="productImage"
                  name="productImage"
                  type="file"
                  accept="image/*"
                  required
                  className="mt-2 w-full text-sm text-ink/70 file:mr-4 file:rounded-sm file:border-0 file:bg-ink file:px-4 file:py-2 file:font-semibold file:text-bone"
                />
              </div>

              <div>
                <label
                  htmlFor="productDescription"
                  className="block font-mono text-xs uppercase tracking-widest text-ink/60"
                >
                  Product description
                </label>
                <textarea
                  id="productDescription"
                  name="productDescription"
                  rows={3}
                  maxLength={500}
                  placeholder="Lightweight running shoes with breathable mesh, cushioned sole, and a clean all-black look."
                  className="mt-2 w-full resize-y border-b-2 border-ink/15 bg-transparent px-1 py-2 text-ink outline-none placeholder:text-ink/30 focus:border-flame"
                />
              </div>

              <div>
                <button
                  type="button"
                  onClick={() => setAdvancedOpen((open) => !open)}
                  aria-expanded={advancedOpen}
                  className="flex w-full items-center justify-between border-b border-ink/10 pb-3 font-mono text-xs uppercase tracking-widest text-ink/60 transition hover:text-ink"
                >
                  <span>Advanced settings</span>
                  <span className="flex items-center gap-2 text-ink/40">
                    <span>Optional controls</span>
                    <span aria-hidden>{advancedOpen ? "−" : "+"}</span>
                  </span>
                </button>

                <div className={advancedOpen ? "mt-6 space-y-6" : "hidden"}>
                  <div>
                    <label
                      htmlFor="targetAudience"
                      className="block font-mono text-xs uppercase tracking-widest text-ink/60"
                    >
                      Target audience
                    </label>
                    <input
                      id="targetAudience"
                      name="targetAudience"
                      type="text"
                      placeholder="Office workers, commuters, young professionals"
                      className="mt-2 w-full border-b-2 border-ink/15 bg-transparent px-1 py-2 text-ink outline-none placeholder:text-ink/30 focus:border-flame"
                    />
                    <p className="mt-2 text-xs leading-5 text-ink/50">
                      Optional. If left blank, the showrunner targets general
                      online shoppers.
                    </p>
                  </div>

                  <div>
                    <label
                      htmlFor="keySellingPoints"
                      className="block font-mono text-xs uppercase tracking-widest text-ink/60"
                    >
                      Key selling points
                    </label>
                    <textarea
                      id="keySellingPoints"
                      name="keySellingPoints"
                      rows={3}
                      maxLength={500}
                      placeholder="Comfortable for long commutes, minimal style, durable outsole, easy to pair with workwear."
                      className="mt-2 w-full resize-y border-b-2 border-ink/15 bg-transparent px-1 py-2 text-ink outline-none placeholder:text-ink/30 focus:border-flame"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="offer"
                      className="block font-mono text-xs uppercase tracking-widest text-ink/60"
                    >
                      Offer or CTA context
                    </label>
                    <input
                      id="offer"
                      name="offer"
                      type="text"
                      maxLength={180}
                      placeholder="Launch week: 20% off, free shipping today"
                      className="mt-2 w-full border-b-2 border-ink/15 bg-transparent px-1 py-2 text-ink outline-none placeholder:text-ink/30 focus:border-flame"
                    />
                  </div>

                  <div className="grid gap-5 sm:grid-cols-3">
                    <div>
                      <label
                        htmlFor="mood"
                        className="block font-mono text-xs uppercase tracking-widest text-ink/60"
                      >
                        Mood
                      </label>
                      <select
                        id="mood"
                        name="mood"
                        className="mt-2 w-full border-b-2 border-ink/15 bg-transparent px-1 py-2 text-ink outline-none focus:border-flame"
                      >
                        <option>Cinematic</option>
                        <option>Funny</option>
                        <option>Premium</option>
                        <option>Emotional</option>
                        <option>Fast-paced</option>
                      </select>
                    </div>

                    <div>
                      <label
                        htmlFor="platform"
                        className="block font-mono text-xs uppercase tracking-widest text-ink/60"
                      >
                        Platform
                      </label>
                      <select
                        id="platform"
                        name="platform"
                        className="mt-2 w-full border-b-2 border-ink/15 bg-transparent px-1 py-2 text-ink outline-none focus:border-flame"
                      >
                        <option>TikTok</option>
                        <option>Instagram Reels</option>
                        <option>YouTube Shorts</option>
                      </select>
                    </div>

                    <div>
                      <label
                        htmlFor="duration"
                        className="block font-mono text-xs uppercase tracking-widest text-ink/60"
                      >
                        Duration
                      </label>
                      <select
                        id="duration"
                        name="duration"
                        defaultValue="30 seconds"
                        className="mt-2 w-full border-b-2 border-ink/15 bg-transparent px-1 py-2 text-ink outline-none focus:border-flame"
                      >
                        <option>15 seconds</option>
                        <option>30 seconds</option>
                        <option>45 seconds</option>
                        <option>60 seconds</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="aspectRatio"
                      className="block font-mono text-xs uppercase tracking-widest text-ink/60"
                    >
                      Aspect Ratio
                    </label>
                    <select
                      id="aspectRatio"
                      name="aspectRatio"
                      defaultValue="9:16"
                      className="mt-2 w-full border-b-2 border-ink/15 bg-transparent px-1 py-2 text-ink outline-none focus:border-flame"
                    >
                      <option value="9:16">
                        9:16 — TikTok, Reels, Shorts · Default
                      </option>
                      <option value="1:1">1:1 — Instagram Feed</option>
                      <option value="16:9">16:9 — YouTube</option>
                    </select>
                    <p className="mt-2 text-xs leading-5 text-ink/50">
                      Portrait renders at 720x1280 by default, or 1080x1920
                      on accounts configured for 1080p output.
                    </p>
                  </div>

                  <label className="flex items-start gap-3 text-sm text-ink/70">
                    <input
                      type="checkbox"
                      name="showProductOverlay"
                      defaultChecked
                      className="mt-1 h-4 w-4 shrink-0 accent-flame"
                    />
                    <span>
                      Show the product photo as a small overlay on scenes
                      that don't already use it as a reference frame.
                      Turn off if you'd rather let generated scenes stand
                      on their own.
                    </span>
                  </label>

                  <div>
                    <label
                      htmlFor="productReferenceMode"
                      className="block font-mono text-xs uppercase tracking-widest text-ink/60"
                    >
                      Product reference mode
                    </label>
                    <select
                      id="productReferenceMode"
                      name="productReferenceMode"
                      defaultValue="auto"
                      className="mt-2 w-full border-b-2 border-ink/15 bg-transparent px-1 py-2 text-ink outline-none focus:border-flame"
                    >
                      <option value="auto">
                        Auto — use AI recommendation
                      </option>
                      <option value="force">
                        Use as packshot — force hero reference
                      </option>
                      <option value="disable">
                        Disable — text-to-video only
                      </option>
                    </select>
                    <p className="mt-2 text-xs leading-5 text-ink/50">
                      Auto lets the Analyze Agent decide. Use as packshot is
                      for clean centered product photos. Disable avoids
                      image-to-video reference frames.
                    </p>
                  </div>
                </div>
              </div>

              <button
                type="submit"
                disabled={isGenerating}
                className="w-full rounded-sm bg-flame px-6 py-3 font-semibold text-bone transition hover:bg-flame/90"
              >
                {isGenerating ? "Queuing generation..." : "Generate Product Ad"}
              </button>

              {isGenerating ? (
                <div className="rounded-sm border border-ink/15 bg-ink/5 p-4 text-sm leading-6 text-ink/70">
                  Queuing your brief for the production crew. You'll land on a
                  live status page showing each agent as it runs.
                </div>
              ) : null}

              {actionData?.error ? (
                <p className="rounded-sm border border-flame/40 bg-flame/10 p-4 text-sm leading-6 text-flame">
                  {actionData.error}
                </p>
              ) : null}
            </Form>
          </section>

          <aside className="space-y-5">
            <div className="rounded-lg border border-paper/10 bg-panel p-6">
              <p className="font-mono text-xs uppercase tracking-[0.3em] text-gold">
                Pipeline
              </p>

              <h2 className="mt-3 font-display text-xl font-medium text-bone">
                The crew
              </h2>

              <p className="mt-3 text-sm leading-6 text-ash">
                Successful Qwen generations are saved as projects and opened
                automatically. If Qwen is unavailable, no mock project is
                created.
              </p>

              <div className="mt-6 space-y-3">
                {crew.map((member, index) => (
                  <div
                    key={member.role}
                    className="flex items-start gap-3 rounded-sm border border-paper/10 bg-panel-raised p-3"
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-gold/40 font-mono text-xs font-semibold text-gold">
                      {index + 1}
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-bone">
                        {member.role}
                      </p>
                      <p className="mt-0.5 text-xs leading-5 text-ash">
                        {member.job}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
