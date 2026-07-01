import { Form, redirect, useActionData } from "react-router";
import type { ActionFunctionArgs } from "react-router";
import { ZodError } from "zod";
import { saveProject } from "~/services/project-store.server";
import { generateShowPlan } from "~/services/showrunner.server";
import { saveUploadedImage } from "~/services/image-upload.server";
import {
    QwenApiError,
    QwenConfigurationError,
    QwenResponseError,
} from "~/services/qwen.server";

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

    const productName = getFormString(formData, "productName");
    const targetAudience = getFormString(formData, "targetAudience");
    const mood = getFormString(formData, "mood");
    const platform = getFormString(formData, "platform");
    const duration = getFormString(formData, "duration");

    const validationError = validateBriefFields({
        productName,
        targetAudience,
        mood,
        platform,
        duration,
    });

    if (validationError) {
        return { error: validationError };
    }

    const productImage = formData.get("productImage");
    let uploadedImage: Awaited<ReturnType<typeof saveUploadedImage>>;

    try {
        uploadedImage = await saveUploadedImage(productImage);
    } catch (error) {
        return {
            error: getUploadErrorMessage(error),
        };
    }

    const brief = {
        productName,
        targetAudience,
        mood,
        platform,
        duration,
        imageName: uploadedImage.imageName,
        imageUrl: uploadedImage.imageUrl,
    };

    let showPlan: Awaited<ReturnType<typeof generateShowPlan>>;

    try {
        showPlan = await generateShowPlan(brief);
    } catch (error) {
        console.error("Failed to generate show plan:", error);

        return {
            error: getQwenErrorMessage(error),
        };
    }

    const project = await saveProject(showPlan);

    return redirect(`/projects/${project.id}`);
}

function getFormString(formData: FormData, key: string): string {
    return String(formData.get(key) || "").trim();
}

function validateBriefFields({
    productName,
    targetAudience,
    mood,
    platform,
    duration,
}: {
    productName: string;
    targetAudience: string;
    mood: string;
    platform: string;
    duration: string;
}): string | null {
    if (!productName) {
        return "Product name is required.";
    }

    if (!targetAudience) {
        return "Target audience is required.";
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

    return null;
}

function getUploadErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }

    return "Unable to upload the product image.";
}

function getQwenErrorMessage(error: unknown): string {
    if (error instanceof QwenConfigurationError) {
        return "Qwen is not configured. Set DASHSCOPE_API_KEY and QWEN_BASE_URL before generating.";
    }

    if (error instanceof QwenApiError) {
        return `Qwen request failed with status ${error.status}. Check the API key, base URL, model, or provider status.`;
    }

    if (error instanceof QwenResponseError) {
        return "Qwen returned an invalid response. Try again, or adjust the prompt/schema if this keeps happening.";
    }

    if (error instanceof ZodError) {
        return "Qwen returned a show plan that does not match the required schema.";
    }

    return "Unable to generate a show plan with Qwen. Try again later.";
}

export default function Generate() {
    const actionData = useActionData<typeof action>();

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

                            {actionData?.error ? (
                                <p className="rounded-xl border border-red-400/20 bg-red-400/10 p-4 text-sm leading-6 text-red-100">
                                    {actionData.error}
                                </p>
                            ) : null}
                        </Form>
                    </section>

                    <aside className="space-y-5">
                        <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
                            <h2 className="text-xl font-bold">Showrunner output</h2>
                            <p className="mt-4 text-sm leading-6 text-slate-400">
                                Successful Qwen generations are saved as projects and opened
                                automatically. If Qwen is unavailable, no mock project is created.
                            </p>
                        </div>
                    </aside>
                </div>
            </div>
        </main>
    );
}
