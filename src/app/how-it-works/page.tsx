import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "How it works",
  description:
    "How affinity. works: a free, neutral tool that checks your Medicaid/Marketplace eligibility and which plans actually keep your doctors and medications covered. No commissions, no ads, nothing stored.",
};

export default function HowItWorks() {
  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">How [affinity.] works</h1>
        <p className="page-subtitle">
          A free, neutral tool for people choosing health coverage — especially those losing Medicaid. No
          commissions, no broker funnel, no ads. It works for you, not an insurer. Your answers aren&rsquo;t stored.
        </p>
      </div>

      <div className="prose">
        <h2>1. First: Medicaid or Marketplace?</h2>
        <p>
          Many people losing Medicaid actually still qualify for it — or qualify for a subsidized plan. So the home
          page asks your state, ZIP, age, and income. In states served by the federal Marketplace feed, it checks
          <strong> HealthCare.gov&rsquo;s own estimate</strong>: you&rsquo;ll see whether you may qualify for
          <strong> free Medicaid</strong> or for a Marketplace subsidy. In states with their own marketplace, it
          avoids a federal-data guess and sends you to the state&rsquo;s official application instead.
        </p>

        <h2>2. Keep Medicaid through the rule changes</h2>
        <p>
          The <strong>Medicaid desk</strong> covers all 50 states and D.C. with the official application or renewal
          service, member phone number, and CMS change guide. It also explains the federal requirements scheduled
          for 2027 and keeps a closer watch on New York and Ohio. The state still makes the final decision.
        </p>

        <h2>3. If you&rsquo;re Marketplace-bound: your real plans</h2>
        <p>
          On <strong>See your plans</strong>, add your doctors and medications. We pull your real plans from the
          official Marketplace and show, for each one, the <strong>net premium after your subsidy</strong>, the
          deductible and out-of-pocket max, and — the part HealthCare.gov makes hard — <strong>which plans actually
          keep your doctors in-network and cover your meds</strong>. Plans that keep <em>all</em> your doctors rise to
          the top.
        </p>

        <h2>4. Coverage you can trust — and what to confirm</h2>
        <p>
          Provider directories are documented to be 30–40% wrong, so we never present &ldquo;in-network&rdquo; as a
          guarantee. Coverage shown here comes from the Marketplace&rsquo;s data; always confirm with the
          provider&rsquo;s office before you enroll. This is <strong>decision support, not insurance advice</strong> —
          the final word belongs to your state Medicaid office and the official Marketplace.
        </p>

        <h2>5. Verify other coverage</h2>
        <p>
          The verification tools extend the same honest answer shape beyond Marketplace plans. Employer-plan
          doctor checks use issuer Transparency-in-Coverage network files. Medicare drug checks use the CMS Part
          D formulary index and include the reported tier, prior authorization, step therapy, and quantity-limit
          flags. Each tool is available only when its source index is loaded.
        </p>

        <h2>Honest limits</h2>
        <p>
          Plan rankings here lead with net premium and whether your doctors/meds are covered; a fuller expected
          annual-cost estimate (deductible + copays + drug tiers) is coming. Medicaid results are screening or
          navigation—not a state eligibility determination—and special categories such as pregnancy, disability,
          long-term care, and CHIP require the official state application. Employer verification is doctors-only,
          and the Medicare tool checks formulary coverage rather than comparing plan costs. Subsidy figures are
          estimates — confirm on the official Marketplace.
        </p>
      </div>
    </div>
  );
}
