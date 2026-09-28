/** Public guidance only. State Medicaid agencies make individual eligibility decisions. */
export const MEDICAID_GUIDANCE_REVIEWED = "September 28, 2026";

export const FEDERAL_MEDICAID_CHANGES = [
  {
    id: "renewals",
    kicker: "Renewals scheduled on or after January 1, 2027",
    title: "Six-month renewals for most expansion adults",
    summary:
      "Most people in the Medicaid adult expansion group will have their eligibility renewed every six months instead of every twelve. This does not apply to every Medicaid member.",
    nextStep:
      "Keep your contact information current. Your state may renew you using information it already has; if it sends a renewal form, follow the notice and its deadline.",
    sourceLabel: "CMS renewal guidance",
    sourceUrl: "https://www.medicaid.gov/federal-policy-guidance/downloads/smd26001.pdf",
  },
  {
    id: "community-engagement",
    kicker: "Generally required by January 1, 2027",
    title: "Community-engagement checks for certain adults",
    summary:
      "Some adults will need to meet a community-engagement requirement. Qualifying routes include 80 hours a month of work, a work program or community service, or half-time education; exemptions also apply. This rule has different scope from the six-month renewal rule.",
    nextStep:
      "If you are applying, check your state’s current requirements. If you are enrolled, watch for official notices and follow any documentation deadline.",
    sourceLabel: "CMS community-engagement rule",
    sourceUrl:
      "https://www.cms.gov/newsroom/fact-sheets/medicaid-community-engagement-requirement-certain-individuals-interim-final-rule-comment-period-cms",
  },
] as const;
