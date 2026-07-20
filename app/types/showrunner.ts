// Type-only re-exports of the canonical Zod-inferred shapes defined in
// ~/services/domain/schemas.server.ts. This file itself stays free of any
// `.server.ts` dependency at the VALUE level — every export below is
// `export type`, which `verbatimModuleSyntax` erases completely at compile
// time (zero runtime code, so nothing from the server-only schema module
// ever reaches a client bundle) — so route components can keep importing
// types from this stable path exactly as before, while the actual
// validation logic lives in one place instead of being hand-duplicated here.
export type {
  ProductBrief,
  ProductAnalysis,
  StoryPackage,
  DramaticBeat,
  DirectedScene,
  StoryboardScene,
  CriticResult,
  EditorPackage,
  AgentTokenUsage,
  ShowPlan,
} from "~/services/domain/schemas.server";

// StoryBible has no AI-facing schema (it's an internal compaction of
// brief+analysis+story built once per pipeline run, never parsed from
// external input) — kept as a hand-written type here, unchanged.
import type { ProductAnalysis, ProductBrief, StoryPackage } from "~/services/domain/schemas.server";

export type StoryBible = {
  productFacts: {
    name: string;
    category: string;
    colors: string[];
    material: string;
    audience: string;
    keySellingPoints?: string;
    offer?: string;
  };
  visualStyle: {
    mood: string;
    platform: string;
    aspectRatio: "9:16" | "1:1" | "16:9";
    quality: ProductAnalysis["quality"];
    canUseAsReference: boolean;
    productReferenceMode: NonNullable<ProductBrief["productReferenceMode"]>;
  };
  storyCore: {
    concept: string;
    conflict: string;
    hook: string;
    voiceOver: string;
  };
  constraints: {
    duration: string;
  };
};
