export function meta() {
  return [
    { title: "DramaCommerce AI" },
    {
      name: "description",
      content: "Turn product photos into short drama ads with AI.",
    },
  ];
}

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <section className="mx-auto flex min-h-screen max-w-6xl flex-col items-center justify-center px-6 py-20 text-center">
        <div className="mb-6 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-300">
          AI Showrunner for Product Videos
        </div>

        <h1 className="max-w-4xl text-5xl font-bold tracking-tight md:text-7xl">
          Turn one product photo into a short drama ad.
        </h1>

        <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300">
          DramaCommerce AI helps small merchants generate story concepts,
          scripts, storyboards, video prompts, voice-over, subtitles, and an
          editing timeline from a single product image.
        </p>

        <div className="mt-10 flex flex-col gap-4 sm:flex-row">
          <a
            href="/generate"
            className="rounded-xl bg-white px-6 py-3 font-semibold text-slate-950 transition hover:bg-slate-200"
          >
            Generate Product Drama
          </a>

          <a
            href="#how-it-works"
            className="rounded-xl border border-white/15 px-6 py-3 font-semibold text-white transition hover:bg-white/10"
          >
            See how it works
          </a>
        </div>
      </section>

      <section
        id="how-it-works"
        className="mx-auto grid max-w-6xl gap-6 px-6 pb-20 md:grid-cols-3"
      >
        <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <p className="text-sm font-semibold text-slate-400">Step 1</p>
          <h2 className="mt-3 text-xl font-bold">Upload a product</h2>
          <p className="mt-3 text-slate-300">
            Start with one product image, product name, audience, mood, and
            platform.
          </p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <p className="text-sm font-semibold text-slate-400">Step 2</p>
          <h2 className="mt-3 text-xl font-bold">AI directs the story</h2>
          <p className="mt-3 text-slate-300">
            Qwen-powered agents create the concept, script, storyboard, and
            scene-by-scene video prompts.
          </p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <p className="text-sm font-semibold text-slate-400">Step 3</p>
          <h2 className="mt-3 text-xl font-bold">Export the ad plan</h2>
          <p className="mt-3 text-slate-300">
            Get voice-over, subtitles, social caption, CTA, and editing timeline
            for TikTok, Reels, or Shorts.
          </p>
        </div>
      </section>
    </main>
  );
}
