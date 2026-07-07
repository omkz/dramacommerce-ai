import { redirect } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { getAuthSession } from "~/services/auth.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await getAuthSession(request);

  if (session?.user) {
    throw redirect("/dashboard");
  }

  return null;
}

export function meta() {
  return [
    { title: "DramaCommerce AI" },
    {
      name: "description",
      content: "Turn product photos into short product drama videos with AI.",
    },
  ];
}

const takes = [
  {
    take: "01",
    title: "Upload the product",
    body: "One photo plus product details, audience, mood, offer, and target platform.",
  },
  {
    take: "02",
    title: "Qwen directs the story",
    body: "A Story, Director, and Prompt agent write the concept, hook, voice-over, and a 5-scene storyboard.",
  },
  {
    take: "03",
    title: "Wan shoots every scene",
    body: "Each scene renders as video, gets a voice-over and product packshot, then stitches into one finished video.",
  },
];

export default function Home() {
  return (
    <main className="bg-ink text-bone">
      <section className="mx-auto max-w-6xl px-6 pb-20 pt-20 md:pt-28">
        <div className="flex items-center gap-3 font-mono text-xs uppercase tracking-[0.3em] text-ash">
          <span
            aria-hidden
            className="tally-dot h-2 w-2 rounded-full bg-flame"
          />
          Now Screening — AI Showrunner
        </div>

        <h1 className="mt-8 max-w-3xl font-display text-5xl font-medium leading-[1.05] tracking-tight text-bone md:text-7xl">
          One product photo.
          <br />
          <span className="text-gold italic">Five scenes</span> of drama.
        </h1>

        <p className="mt-6 max-w-xl text-lg leading-8 text-ash">
          DramaCommerce AI writes the story, storyboards the shots, and shoots
          the footage — turning a single product photo and brief into a short product drama video
          ready for TikTok, Reels, or Shorts.
        </p>

        <div className="mt-10 flex flex-wrap items-center gap-5">
          <a
            href="/projects/new"
            className="rounded bg-flame px-6 py-3 font-semibold text-bone transition hover:bg-flame/90"
          >
            Create Product Video
          </a>

          <a
            href="/projects"
            className="rounded border border-paper/20 px-6 py-3 font-semibold text-bone transition hover:bg-paper/5"
          >
            View Projects
          </a>

          <a
            href="#how-it-works"
            className="text-sm font-medium text-ash underline decoration-paper/20 underline-offset-4 transition hover:text-bone"
          >
            See the shot list
          </a>
        </div>

        <div className="mt-20 overflow-hidden rounded-lg border border-paper/10 bg-panel">
          <div className="sprockets" aria-hidden />

          <div className="grid grid-cols-5 divide-x divide-paper/10">
            {[1, 2, 3, 4, 5].map((scene) => (
              <div
                key={scene}
                className="flex aspect-9/16 flex-col items-center justify-center gap-3 bg-panel-raised/40 p-4"
              >
                <span className="font-mono text-[10px] uppercase tracking-widest text-ash">
                  Scene {String(scene).padStart(2, "0")}
                </span>
                <span className="h-8 w-8 rounded-full border border-gold/50" />
              </div>
            ))}
          </div>

          <div className="sprockets" aria-hidden />
        </div>
      </section>

      <section
        id="how-it-works"
        className="border-t border-paper/10 bg-panel/40"
      >
        <div className="mx-auto max-w-6xl px-6 py-20">
          <p className="font-mono text-xs uppercase tracking-[0.3em] text-ash">
            The Shot List
          </p>

          <h2 className="mt-3 font-display text-3xl font-medium text-bone md:text-4xl">
            Three takes to a finished video
          </h2>

          <div className="mt-12 grid gap-px overflow-hidden rounded-lg border border-paper/10 bg-paper/10 md:grid-cols-3">
            {takes.map((step) => (
              <div key={step.take} className="bg-ink p-8">
                <p className="font-mono text-sm text-gold">TAKE {step.take}</p>

                <h3 className="mt-4 font-display text-xl font-medium text-bone">
                  {step.title}
                </h3>

                <p className="mt-3 text-sm leading-6 text-ash">{step.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
