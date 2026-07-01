import type { ReactNode } from "react";
import { Form, useActionData } from "react-router";
import type { ActionFunctionArgs } from "react-router";
import { generateShowPlan } from "~/services/showrunner.server";

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

    const productName = String(formData.get("productName") || "");
    const targetAudience = String(formData.get("targetAudience") || "");
    const mood = String(formData.get("mood") || "");
    const platform = String(formData.get("platform") || "");
    const duration = String(formData.get("duration") || "");
    const productImage = formData.get("productImage");

    const imageName =
        productImage &&
            typeof productImage === "object" &&
            "name" in productImage &&
            typeof productImage.name === "string" &&
            productImage.name
            ? productImage.name
            : "No image uploaded";

    const showPlan = await generateShowPlan({
        productName,
        targetAudience,
        mood,
        platform,
        duration,
        imageName,
    });

    return showPlan;
}

export default function Generate() {
        const result = useActionData<typeof action>();

        return (
            <main className="min-h-screen bg-slate-950 px-6 py-10 text-white">
                <div className="mx-auto max-w-6xl">
                    <a href="/" className="text-sm text-slate-400 hover:text-white">
                        ← Back to home
                    </a>

                    <div className="mt-10 grid gap-8 lg:grid-cols-[0.9fr_1.1fr]">
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
                                        className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-white outline-none placeholder:text-slate-500 focus:border-white/30"
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

                        <aside className="space-y-5">
                            {!result ? (
                                <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
                                    <h2 className="text-xl font-bold">Showrunner output</h2>
                                    <p className="mt-4 text-sm leading-6 text-slate-400">
                                        Your generated story concept, storyboard, video prompts,
                                        voice-over, caption, and editing timeline will appear here.
                                    </p>
                                </div>
                            ) : (
                                <>
                                    <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-5">
                                        <p className="text-sm font-semibold text-emerald-200">
                                            Mock AI pipeline generated successfully.
                                        </p>
                                        <p className="mt-2 text-sm text-emerald-100/80">
                                            Next step: replace this mock generator with Qwen-powered
                                            agents.
                                        </p>
                                    </div>

                                    <ResultCard title="Brief">
                                        <div className="grid gap-3 sm:grid-cols-2">
                                            <SmallItem label="Product" value={result.brief.productName} />
                                            <SmallItem label="Image" value={result.brief.imageName} />
                                            <SmallItem
                                                label="Audience"
                                                value={result.brief.targetAudience}
                                            />
                                            <SmallItem label="Mood" value={result.brief.mood} />
                                            <SmallItem label="Platform" value={result.brief.platform} />
                                            <SmallItem label="Duration" value={result.brief.duration} />
                                        </div>
                                    </ResultCard>

                                    <ResultCard title="Story Concept">
                                        <p className="text-slate-300">{result.concept}</p>
                                    </ResultCard>

                                    <ResultCard title="Hook">
                                        <p className="text-2xl font-bold leading-snug">
                                            “{result.hook}”
                                        </p>
                                    </ResultCard>

                                    <ResultCard title="Voice-over">
                                        <p className="leading-7 text-slate-300">{result.voiceOver}</p>
                                    </ResultCard>

                                    <ResultCard title="Storyboard">
                                        <div className="space-y-4">
                                            {result.storyboard.map((scene) => (
                                                <div
                                                    key={scene.scene}
                                                    className="rounded-xl border border-white/10 bg-slate-900 p-4"
                                                >
                                                    <div className="flex items-start justify-between gap-4">
                                                        <div>
                                                            <p className="text-xs uppercase tracking-wide text-slate-500">
                                                                Scene {scene.scene} · {scene.duration}
                                                            </p>
                                                            <h3 className="mt-1 font-bold">{scene.title}</h3>
                                                        </div>
                                                    </div>

                                                    <p className="mt-3 text-sm leading-6 text-slate-300">
                                                        {scene.visual}
                                                    </p>

                                                    <p className="mt-3 rounded-lg bg-white/5 p-3 text-sm text-slate-300">
                                                        <span className="font-semibold text-white">
                                                            Voice-over:
                                                        </span>{" "}
                                                        {scene.voiceOver}
                                                    </p>

                                                    <p className="mt-3 rounded-lg bg-indigo-400/10 p-3 text-sm leading-6 text-indigo-100">
                                                        <span className="font-semibold text-white">
                                                            Video prompt:
                                                        </span>{" "}
                                                        {scene.videoPrompt}
                                                    </p>
                                                </div>
                                            ))}
                                        </div>
                                    </ResultCard>

                                    <ResultCard title="Editing Timeline">
                                        <ol className="space-y-3">
                                            {result.timeline.map((item) => (
                                                <li
                                                    key={item}
                                                    className="rounded-xl border border-white/10 bg-slate-900 p-4 text-sm text-slate-300"
                                                >
                                                    {item}
                                                </li>
                                            ))}
                                        </ol>
                                    </ResultCard>

                                    <ResultCard title="Social Caption">
                                        <p className="leading-7 text-slate-300">{result.caption}</p>
                                        <p className="mt-4 text-lg font-bold">{result.cta}</p>
                                    </ResultCard>
                                </>
                            )}
                        </aside>
                    </div>
                </div>
            </main>
        );
    }

    function ResultCard({
        title,
        children,
    }: {
        title: string;
        children: ReactNode;
    }) {
        return (
            <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
                <h2 className="text-xl font-bold">{title}</h2>
                <div className="mt-4">{children}</div>
            </section>
        );
    }

    function SmallItem({ label, value }: { label: string; value: string }) {
        return (
            <div className="rounded-xl border border-white/10 bg-slate-900 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
                <p className="mt-1 text-sm font-medium text-slate-100">{value}</p>
            </div>
        );
    }
