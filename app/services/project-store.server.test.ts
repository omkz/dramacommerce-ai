// Runs against a real local Postgres (DATABASE_URL, loaded via
// --env-file-if-exists=.env in package.json's test script) — same
// convention as this repo's other DB-backed behavior, no ORM mocking.
// Exercises the "corrupted/legacy JSON loaded from Postgres" boundary
// directly: rows are inserted bypassing project-store.server.ts's own
// validated write paths, simulating data written before this validation
// layer existed (or by a hypothetical buggy future write path), and
// asserting the read path degrades to a controlled schemaStatus rather than
// crashing.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "~/services/db.server";
import { projects, users } from "~/db/schema";
import { getProject, listProjects } from "~/services/project-store.server";

const testUserId = randomUUID();

function validShowPlanFixture(overrides: Record<string, unknown> = {}) {
  const beats = ["setup", "tension", "turning_point", "climax", "resolution"];
  const storyboard = [1, 2, 3, 4, 5].map((n) => ({
    scene: n,
    duration: "0-4s",
    title: `Scene ${n}`,
    visual: "A visual description.",
    voiceOver: "Short line.",
    camera: "close-up",
    emotion: "curious",
    beat: beats[n - 1],
    useProductReference: false,
    videoPrompt: "A detailed Wan prompt.",
  }));

  return {
    schemaVersion: 1,
    source: "qwen",
    brief: {
      productName: "Test Product",
      targetAudience: "Everyone",
      mood: "Cinematic",
      platform: "TikTok",
      duration: "30 seconds",
      aspectRatio: "9:16",
      imageName: "photo.jpg",
      imageUrl: "product-images/test.jpg",
      showProductOverlay: false,
      productReferenceMode: "auto",
    },
    analysis: {
      category: "test",
      colors: ["black"],
      material: "fabric",
      brandingVisible: null,
      quality: "good",
      canUseAsReference: true,
      issues: [],
    },
    concept: "A concept.",
    conflict: "A conflict.",
    hook: "A hook.",
    voiceOver: "An overall voice-over.",
    storyboard,
    timeline: ["Scene 1: open", "Scene 5: cta"],
    caption: "A caption.",
    cta: "Shop now",
    tokenUsage: [],
    ...overrides,
  };
}

before(async () => {
  await db.insert(users).values({ id: testUserId, email: `project-store-test-${testUserId}@example.test` });
});

after(async () => {
  // Cascades (projects.user_id has onDelete: "cascade") to every project
  // row inserted by these tests — no separate per-project cleanup needed.
  await db.delete(users).where(eq(users.id, testUserId));
});

async function insertRawProject(showPlan: unknown): Promise<string> {
  const id = randomUUID();

  await db.insert(projects).values({
    id,
    userId: testUserId,
    createdAt: new Date(),
    // Bypasses project-store.server.ts's validated write paths on purpose —
    // this is simulating data that predates (or otherwise bypassed) schema
    // validation, exactly the scenario parsePersistedShowPlan exists for.
    showPlan: showPlan as never,
  });

  return id;
}

test("getProject: a corrupted show_plan produces a controlled schemaStatus 'invalid' instead of crashing", async () => {
  const id = await insertRawProject({ totally: "the wrong shape", storyboard: "not-an-array" });

  const project = await getProject(id, testUserId);

  assert.ok(project);
  assert.equal(project?.schemaStatus, "invalid");
  assert.ok(project?.schemaError && project.schemaError.length > 0);
});

test("getProject: a legacy record with no schemaVersion field but an otherwise-current shape still parses as 'ok'", async () => {
  const legacy = validShowPlanFixture();
  delete (legacy as Record<string, unknown>).schemaVersion;
  const id = await insertRawProject(legacy);

  const project = await getProject(id, testUserId);

  assert.ok(project);
  assert.equal(project?.schemaStatus, "ok");
  assert.equal(project?.showPlan.schemaVersion, 1, "should be lazily normalized to the current version");
});

test("getProject: a fully valid, current show_plan parses as 'ok'", async () => {
  const id = await insertRawProject(validShowPlanFixture());

  const project = await getProject(id, testUserId);

  assert.ok(project);
  assert.equal(project?.schemaStatus, "ok");
  assert.equal(project?.showPlan.storyboard.length, 5);
});

test("listProjects: a mix of valid and corrupted projects is returned without throwing", async () => {
  const validId = await insertRawProject(validShowPlanFixture());
  const invalidId = await insertRawProject({ broken: true });

  const all = await listProjects(testUserId);
  const byId = new Map(all.map((p) => [p.id, p]));

  assert.equal(byId.get(validId)?.schemaStatus, "ok");
  assert.equal(byId.get(invalidId)?.schemaStatus, "invalid");
});
