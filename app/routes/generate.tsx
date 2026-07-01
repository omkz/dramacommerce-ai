import { Form, useActionData } from "react-router";
import type { ActionFunctionArgs } from "react-router";

export function meta() {
  return [
    { title: "Generate Product Drama | DramaCommerce AI" },
    {
      name: "description",
      content: "Generate a short product drama ad from one product photo.",
    },
  ];
}

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();

  const productImage = formData.get("productImage");

  return {
    productName: String(formData.get("productName") || ""),
    targetAudience: String(formData.get("targetAudience") || ""),
    mood: String(formData.get("mood") || ""),
    platform: String(formData.get("platform") || ""),
    duration: String(formData.get("duration") || ""),
    imageName:
      productImage instanceof File && productImage.name
        ? productImage.name
        : "No image uploaded",
  };
}

export default function Generate() {
  const result = useActionData<typeof action>();

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-10 text-white">
      <div className="mx-auto max-w-5xl">
        <a href="/" className="text-sm text-slate-400 hover:text-white">
          ← Back to home
        </a>

        <div className="mt-10 grid gap-8 lg:grid-cols-[1fr_0.9fr]">
          <section>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">
              DramaCommerce AI
            </p>

            <h1 className="mt-4 text-4xl font-bold tracking-tight md:text-5xl">
              Generate a product drama ad
            </h1>

            <p className="mt-4 max-w-2xl text-slate-300">
              Upload one product photo and describe the audience, mood, and
              platform. The AI showrunner will turn it into a story, storyboard,
              video prompts, voice-over, subtitles, and editing timeline.
            </p>

            <Form
              method="post"
              encType="multipart/form-data"
              className="mt-8 space-y-5 rounded-2xl border border-white/10 bg-white/5 p-6"
            >
              <div>
                <label
                  htmlFor="productName"
                  className="block text-sm font-medium text-slate-200"
                >
                  Product name
                </label>
                <input
                  id="productName"
                  name="productName"
                  type="text"
                  placeholder="Urban Runner Black Shoes"
                  required
                  className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-white outline-none ring-0 placeholder:text-slate-500 focus:border-white/30"
                />
              </div>

              <div>
                <label
                  htmlFor="productImage"
                  className="block text-sm font-medium text-slate-200"
                >
                  Product image
                </label>
                <input
                  id="productImage"
                  name="productImage"
                  type="file"
                  accept="image/*"
                  className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-slate-300 file:mr-4 file:rounded-lg file:border-0 file:bg-white file:px-4 file:py-2 file:font-semibold file:text-slate-950"
                />
              </div>

              <div>
                <label
                  htmlFor="targetAudience"
                  className="block text-sm font-medium text-slate-200"
                >
                  Target audience
                </label>
                <input
                  id="targetAudience"
                  name="targetAudience"
                  type="text"
                  placeholder="Office workers, commuters, young professionals"
                  required
                  className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-white outline-none placeholder:text-slate-500 focus:border-white/30"
                />
              </div>

              <div className="grid gap-5 sm:grid-cols-3">
                <div>
                  <label
                    htmlFor="mood"
                    className="block text-sm font-medium text-slate-200"
                  >
                    Mood
                  </label>
                  <select
                    id="mood"
                    name="mood"
                    className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-white outline-none focus:border-white/30"
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
                    className="block text-sm font-medium text-slate-200"
                  >
                    Platform
                  </label>
                  <select
                    id="platform"
                    name="platform"
                    className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-white outline-none focus:border-white/30"
                  >
                    <option>TikTok</option>
                    <option>Instagram Reels</option>
                    <option>YouTube Shorts</option>
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="duration"
                    className="block text-sm font-medium text-slate-200"
                  >
                    Duration
                  </label>
                  <select
                    id="duration"
                    name="duration"
                    className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-white outline-none focus:border-white/30"
                  >
                    <option>15 seconds</option>
                    <option>30 seconds</option>
                    <option>45 seconds</option>
                    <option>60 seconds</option>
                  </select>
                </div>
              </div>

              <button
                type="submit"
                className="w-full rounded-xl bg-white px-6 py-3 font-semibold text-slate-950 transition hover:bg-slate-200"
              >
                Generate Show Plan
              </button>
            </Form>
          </section>

          <aside className="rounded-2xl border border-white/10 bg-white/5 p-6">
            <h2 className="text-xl font-bold">Preview</h2>

            {result ? (
              <div className="mt-6 space-y-4 text-sm">
                <PreviewItem label="Product" value={result.productName} />
                <PreviewItem label="Image" value={result.imageName} />
                <PreviewItem
                  label="Audience"
                  value={result.targetAudience}
                />
                <PreviewItem label="Mood" value={result.mood} />
                <PreviewItem label="Platform" value={result.platform} />
                <PreviewItem label="Duration" value={result.duration} />

                <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-4 text-emerald-200">
                  Form works. Next step: connect this input to our AI
                  showrunner pipeline.
                </div>
              </div>
            ) : (
              <p className="mt-4 text-sm leading-6 text-slate-400">
                Your generated show plan will appear here after submitting the
                product brief.
              </p>
            )}
          </aside>
        </div>
      </div>
    </main>
  );
}

function PreviewItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-slate-900 p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 font-medium text-slate-100">{value}</p>
    </div>
  );
}
