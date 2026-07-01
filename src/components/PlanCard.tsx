import type { MatchedSubject } from "@/lib/matching/types";
import type { PlanDecision } from "@/lib/decision/types";

const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;

const STATUS_LABEL: Record<string, string> = {
  covered: "covered",
  covered_unverified: "covered (one source)",
  not_covered: "not covered",
  not_covered_unverified: "not covered (one source)",
  disputed: "conflict",
  unknown: "unknown",
};

function CoveragePill({ s }: { s: MatchedSubject }) {
  const short = (s.label ?? s.subjectKey).replace(/\s*\(.*\)$/, "");
  return (
    <span className="cov-pill" data-status={s.status} title={`${s.label ?? s.subjectKey}: ${STATUS_LABEL[s.status]}`}>
      {short}
    </span>
  );
}

/** One ranked plan: true cost + breakdown, doctor/med coverage, network-confidence grade, confirm list. */
export function PlanCard({ decision, rank }: { decision: PlanDecision; rank: number }) {
  const { trueCost: c, match, verify } = decision;
  const drugOrMed = match.summary;

  return (
    <article className="plan-card" data-rank={rank}>
      <div className="plan-card-head">
        <div>
          <span className="plan-rank" data-rank={rank}>
            {rank === 1 ? "★ Best true cost" : `#${rank}`}
          </span>
          <h3 className="plan-name">{decision.label}</h3>
          <span className="plan-metal">{decision.metalLevel}</span>
        </div>
        <div className="truecost">
          <div className="truecost-figure">{usd(c.trueAnnualCostUsd)}</div>
          <span className="truecost-label">true cost / yr</span>
        </div>
      </div>

      <dl className="cost-breakdown">
        <dt>Premium (after subsidy)</dt>
        <dd>{usd(c.netAnnualPremiumUsd)}</dd>
        <dt>Expected medical OOP</dt>
        <dd>{usd(c.expectedMedicalOOPUsd)}</dd>
        <dt>Expected drug OOP</dt>
        <dd>{usd(c.expectedDrugOOPUsd)}</dd>
        <div style={{ display: "contents" }} className="is-total">
          <dt>Estimated annual total</dt>
          <dd>{usd(c.trueAnnualCostUsd)}</dd>
        </div>
      </dl>

      <div className="coverage-rows">
        <div className="coverage-row">
          <span className="coverage-row-label">
            Doctors {drugOrMed.doctorsCovered}/{drugOrMed.doctorsTotal}
          </span>
          <span className="cov-pills">
            {match.providers.map((p) => (
              <CoveragePill key={p.subjectKey} s={p} />
            ))}
          </span>
        </div>
        <div className="coverage-row">
          <span className="coverage-row-label">
            Meds {drugOrMed.drugsOnFormulary}/{drugOrMed.drugsTotal}
          </span>
          <span className="cov-pills">
            {match.drugs.map((d) => (
              <CoveragePill key={d.subjectKey} s={d} />
            ))}
          </span>
        </div>
      </div>

      <div className="row" style={{ margin: 0, justifyContent: "space-between" }}>
        <span className="grade-badge" data-grade={verify.grade} title={verify.headline}>
          <span className="grade-badge-letter">{verify.grade}</span>
          Network confidence · {Math.round(verify.networkConfidenceScore * 100)}%
        </span>
        <span className="confidence-line">
          {verify.agreeCount}/{verify.totalClaims} corroborated
          {verify.freshness.newestSourceDate ? ` · data ${verify.freshness.newestSourceDate}` : ""}
        </span>
      </div>

      {verify.checklist.length > 0 ? (
        <div>
          <p className="checklist-title">Confirm before enrolling</p>
          <ul className="checklist">
            {verify.checklist.map((item) => (
              <li key={`${item.kind}-${item.subjectKey}`} className="checklist-item" data-reason={item.reason}>
                <span>
                  <span className="checklist-reason">{item.reason}</span>
                  {item.action}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="checklist-empty">No conflicts flagged — still confirm with the provider before enrolling.</p>
      )}
    </article>
  );
}
