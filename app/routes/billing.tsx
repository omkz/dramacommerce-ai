import { Link, useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import {
  getBillingPlans,
  getBillingSummary,
  type BillingPlan,
  type PlanQuota,
} from "~/services/billing.server";
import { requireUser } from "~/services/auth.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);

  return {
    billing: await getBillingSummary(user.id),
    plans: getBillingPlans(),
  };
}

export function meta() {
  return [
    { title: "Billing | DramaCommerce AI" },
    {
      name: "description",
      content: "Manage SaaS plan, quotas, and checkout for DramaCommerce AI.",
    },
  ];
}

export default function Billing() {
  const { billing, plans } = useLoaderData<typeof loader>();

  return (
    <main className="min-h-screen bg-ink px-6 py-10 text-bone">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.3em] text-gold">
              Billing
            </p>
            <h1 className="mt-3 font-display text-4xl font-medium tracking-tight text-bone md:text-5xl">
              Plan and usage
            </h1>
            <p className="mt-4 max-w-2xl text-ash">
              DramaCommerce is wired for Lemon Squeezy checkout links, with
              internal monthly quota checks before expensive AI jobs are queued.
            </p>
          </div>

          <Link
            to="/projects/new"
            className="rounded bg-flame px-5 py-3 font-semibold text-bone transition hover:bg-flame/90"
          >
            Create Product Video
          </Link>
        </div>

        <section className="mt-10 grid gap-4 md:grid-cols-3">
          <UsageCard
            label="Showrunner Generations"
            used={billing.usage.showrunnerGenerations}
            limit={billing.plan.quota.showrunnerGenerations}
          />
          <UsageCard
            label="Scene Renders"
            used={billing.usage.sceneRenders}
            limit={billing.plan.quota.sceneRenders}
          />
          <UsageCard
            label="Final Stitches"
            used={billing.usage.finalStitches}
            limit={billing.plan.quota.finalStitches}
          />
        </section>

        <section className="mt-6 rounded-sm border border-paper/10 bg-panel p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.25em] text-ash">
                Current Plan
              </p>
              <h2 className="mt-2 font-display text-2xl font-medium text-bone">
                {billing.plan.name}
              </h2>
            </div>

            {billing.subscription ? (
              <div className="rounded-sm border border-gold/25 bg-gold/10 px-4 py-3 text-sm text-gold">
                {billing.subscription.provider} · {billing.subscription.status}
                {billing.subscription.currentPeriodEnd
                  ? ` · renews ${new Date(
                      billing.subscription.currentPeriodEnd,
                    ).toLocaleDateString()}`
                  : ""}
              </div>
            ) : (
              <div className="rounded-sm border border-paper/15 px-4 py-3 text-sm text-ash">
                No paid subscription connected yet.
              </div>
            )}
          </div>
        </section>

        <section className="mt-6 grid gap-5 lg:grid-cols-3">
          {plans.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              currentPlanId={billing.plan.id}
            />
          ))}
        </section>
      </div>
    </main>
  );
}

function UsageCard({
  label,
  used,
  limit,
}: {
  label: string;
  used: number;
  limit: number;
}) {
  const percent = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;

  return (
    <div className="rounded-sm border border-paper/10 bg-panel p-5">
      <p className="font-mono text-xs uppercase tracking-[0.25em] text-ash">
        {label}
      </p>
      <p className="mt-3 font-display text-3xl font-medium text-bone">
        {used}/{limit}
      </p>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-paper/10">
        <div className="h-full rounded-full bg-gold" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function PlanCard({
  plan,
  currentPlanId,
}: {
  plan: BillingPlan;
  currentPlanId: string;
}) {
  const isCurrent = plan.id === currentPlanId;

  return (
    <div
      className={
        isCurrent
          ? "rounded-sm border border-gold/35 bg-gold/10 p-6"
          : "rounded-sm border border-paper/10 bg-panel p-6"
      }
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-medium text-bone">
            {plan.name}
          </h2>
          <p className="mt-2 text-sm leading-6 text-ash">{plan.description}</p>
        </div>
        {isCurrent ? (
          <span className="rounded-full border border-gold/35 px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-gold">
            Current
          </span>
        ) : null}
      </div>

      <p className="mt-6 font-display text-4xl font-medium text-bone">
        {plan.price}
      </p>

      <QuotaList quota={plan.quota} />

      {plan.id === "free" ? (
        <p className="mt-6 rounded-sm border border-paper/10 bg-panel-raised px-4 py-3 text-center text-sm font-semibold text-ash">
          Included by default
        </p>
      ) : plan.checkoutUrl ? (
        <a
          href={plan.checkoutUrl}
          className="mt-6 inline-flex w-full justify-center rounded bg-flame px-5 py-3 font-semibold text-bone transition hover:bg-flame/90"
        >
          Upgrade to {plan.name}
        </a>
      ) : (
        <p className="mt-6 rounded-sm border border-flame/25 bg-flame/10 px-4 py-3 text-center text-sm text-flame">
          Set LEMONSQUEEZY_{plan.id.toUpperCase()}_CHECKOUT_URL to enable checkout.
        </p>
      )}
    </div>
  );
}

function QuotaList({ quota }: { quota: PlanQuota }) {
  const items = [
    ["Showrunner generations", quota.showrunnerGenerations],
    ["Scene renders", quota.sceneRenders],
    ["Final stitches", quota.finalStitches],
  ] as const;

  return (
    <div className="mt-6 space-y-3">
      {items.map(([label, value]) => (
        <div
          key={label}
          className="flex items-center justify-between gap-4 border-t border-paper/10 pt-3 text-sm"
        >
          <span className="text-ash">{label}</span>
          <span className="font-mono text-bone">{value}/mo</span>
        </div>
      ))}
    </div>
  );
}
