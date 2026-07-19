import { and, desc, eq, gte, sql } from "drizzle-orm";
import { subscriptions, usageEvents } from "~/db/schema";
import { db } from "~/services/db.server";

export type SubscriptionPlan = "free" | "pro" | "studio";
export type UsageEventType =
  | "showrunner_generation"
  | "scene_render"
  | "final_stitch";

export type PlanQuota = {
  showrunnerGenerations: number;
  sceneRenders: number;
  finalStitches: number;
};

export type BillingPlan = {
  id: SubscriptionPlan;
  name: string;
  price: string;
  description: string;
  quota: PlanQuota;
  checkoutUrl?: string;
};

export type BillingSummary = {
  plan: BillingPlan;
  subscription?: {
    provider: string;
    status: string;
    currentPeriodEnd?: string;
    cancelAtPeriodEnd: boolean;
  };
  usage: PlanQuota;
};

const PLAN_CATALOG: Record<SubscriptionPlan, BillingPlan> = {
  free: {
    id: "free",
    name: "Free",
    price: "$0",
    description: "For testing the production flow with tight render limits.",
    quota: {
      showrunnerGenerations: 3,
      sceneRenders: 5,
      finalStitches: 1,
    },
  },
  pro: {
    id: "pro",
    name: "Pro",
    price: "$29/mo",
    description: "For solo merchants producing weekly product videos.",
    quota: {
      showrunnerGenerations: 50,
      sceneRenders: 250,
      finalStitches: 50,
    },
    checkoutUrl: process.env.LEMONSQUEEZY_PRO_CHECKOUT_URL,
  },
  studio: {
    id: "studio",
    name: "Studio",
    price: "$99/mo",
    description: "For agencies and stores producing at higher volume.",
    quota: {
      showrunnerGenerations: 200,
      sceneRenders: 1_000,
      finalStitches: 200,
    },
    checkoutUrl: process.env.LEMONSQUEEZY_STUDIO_CHECKOUT_URL,
  },
};

const ACTIVE_SUBSCRIPTION_STATUSES = new Set(["trialing", "active", "past_due"]);

export function getBillingPlans(): BillingPlan[] {
  return [PLAN_CATALOG.free, PLAN_CATALOG.pro, PLAN_CATALOG.studio];
}

export async function getBillingSummary(userId: string): Promise<BillingSummary> {
  const subscription = await getCurrentSubscription(userId);
  const plan = subscription ? PLAN_CATALOG[subscription.plan] : PLAN_CATALOG.free;
  const usage = await getCurrentUsage(userId);

  return {
    plan,
    subscription: subscription
      ? {
          provider: subscription.provider,
          status: subscription.status,
          currentPeriodEnd:
            subscription.currentPeriodEnd?.toISOString() ?? undefined,
          cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
        }
      : undefined,
    usage,
  };
}

export async function checkUsageQuota(
  userId: string,
  eventType: UsageEventType,
  units = 1,
): Promise<{ allowed: true } | { allowed: false; message: string }> {
  const billing = await getBillingSummary(userId);
  const current = getUsageValue(billing.usage, eventType);
  const limit = getQuotaValue(billing.plan.quota, eventType);

  if (current + units <= limit) {
    return { allowed: true };
  }

  return {
    allowed: false,
    message: `Your ${billing.plan.name} plan has reached its monthly ${getUsageLabel(eventType)} quota (${current}/${limit}). Upgrade your plan or wait until the next billing period.`,
  };
}

export async function recordUsageEvent({
  userId,
  eventType,
  units = 1,
  sourceId,
}: {
  userId: string;
  eventType: UsageEventType;
  units?: number;
  sourceId?: string;
}): Promise<void> {
  await db.insert(usageEvents).values({
    userId,
    eventType,
    units,
    sourceId,
    createdAt: new Date(),
  });
}

async function getCurrentSubscription(userId: string) {
  const rows = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .orderBy(desc(subscriptions.updatedAt));

  return (
    rows.find((row) => ACTIVE_SUBSCRIPTION_STATUSES.has(row.status)) ?? null
  );
}

async function getCurrentUsage(userId: string): Promise<PlanQuota> {
  const periodStart = getCurrentMonthStart();
  const rows = await db
    .select({
      eventType: usageEvents.eventType,
      total: sql<number>`coalesce(sum(${usageEvents.units}), 0)`,
    })
    .from(usageEvents)
    .where(
      and(eq(usageEvents.userId, userId), gte(usageEvents.createdAt, periodStart)),
    )
    .groupBy(usageEvents.eventType);

  const usage: PlanQuota = {
    showrunnerGenerations: 0,
    sceneRenders: 0,
    finalStitches: 0,
  };

  for (const row of rows) {
    const total = Number(row.total);

    if (row.eventType === "showrunner_generation") {
      usage.showrunnerGenerations = total;
    } else if (row.eventType === "scene_render") {
      usage.sceneRenders = total;
    } else if (row.eventType === "final_stitch") {
      usage.finalStitches = total;
    }
  }

  return usage;
}

function getCurrentMonthStart(): Date {
  const now = new Date();

  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function getUsageValue(usage: PlanQuota, eventType: UsageEventType): number {
  if (eventType === "showrunner_generation") {
    return usage.showrunnerGenerations;
  }

  if (eventType === "scene_render") {
    return usage.sceneRenders;
  }

  return usage.finalStitches;
}

function getQuotaValue(quota: PlanQuota, eventType: UsageEventType): number {
  if (eventType === "showrunner_generation") {
    return quota.showrunnerGenerations;
  }

  if (eventType === "scene_render") {
    return quota.sceneRenders;
  }

  return quota.finalStitches;
}

function getUsageLabel(eventType: UsageEventType): string {
  if (eventType === "showrunner_generation") {
    return "showrunner generation";
  }

  if (eventType === "scene_render") {
    return "scene render";
  }

  return "final stitch";
}
