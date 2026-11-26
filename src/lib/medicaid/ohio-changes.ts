import { FEDERAL_MEDICAID_CHANGES } from "./federal";

export const OHIO_MEDICAID_CHANGE_PATH = "/medicaid/ohio/changes";
export const OHIO_CHANGE_REVIEWED = "November 26, 2026";
const REVIEWED_AT = Date.parse("2026-11-26T00:00:00Z");
const REVIEW_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export const OHIO_MEDICAID_HELP = {
  portal: "https://ssp.benefits.ohio.gov/",
  phone: "1-800-324-8680",
  phoneHref: "tel:+18003248680",
};

export const OHIO_CHANGE_SOURCES = {
  overview: "https://dam.assets.ohio.gov/image/upload/medicaid.ohio.gov/Families%2C%20Individuals/Programs/Community/Group_VIII_Partner_Packet_08132026.pdf",
  work: "https://dam.assets.ohio.gov/image/upload/medicaid.ohio.gov/Providers/group-viii/HR1_Required_Outreach_LanguageODM.pdf",
  renewal: FEDERAL_MEDICAID_CHANGES[0].sourceUrl,
};

export function ohioChangeGuidanceCurrent(now = Date.now()) {
  return now >= REVIEWED_AT && now - REVIEWED_AT < REVIEW_WINDOW_MS;
}

export const OHIO_COVERAGE_GROUPS = {
  expansion: {
    label: "Group VIII, MAGI Adult, or Ribicoff",
    title: "These changes may affect your coverage",
    renewal: "Ohio says Group VIII renewals move to every six months under the 2027 rules. Use your Ohio Benefits account or official notice for your own renewal date.",
    work: "Ohio says the work and community engagement rule starts January 1, 2027 for some Group VIII adults. An exemption may apply to the work requirement. You may still need to renew every six months.",
    next: "Check your renewal date and contact details",
    action: "Sign in to Ohio Benefits to review your case and make sure Ohio has your current mailing address. If you cannot find your renewal date, call Ohio Medicaid or your county Job and Family Services office.",
  },
  other: {
    label: "A different Ohio Medicaid group",
    title: "Keep following the rules for your Medicaid group",
    renewal: "Keep following the renewal schedule and any instructions for the group Ohio lists for you.",
    work: "Ohio’s 2027 work and community engagement rule described here applies to certain Group VIII adults. Follow any notice Ohio sends about your own case.",
    next: "Look for your group’s renewal instructions",
    action: "Check Ohio Benefits or your latest notice for your own renewal date. If your coverage group changes, check these rules again.",
  },
  unsure: {
    label: "I’m not sure",
    title: "Find your Ohio Medicaid group first",
    renewal: "The six-month schedule generally applies to Group VIII. Your coverage group and official notice help you find the schedule that applies to you.",
    work: "Your insurer name alone does not tell you whether you are in Group VIII. Ohio can confirm your coverage group and whether it needs information about work or an exemption.",
    next: "Look for your group in Ohio Benefits",
    action: "Open View My Benefits or read a recent Ohio Medicaid notice. Look for Group VIII, MAGI Adult, or Ribicoff. If you cannot find it, call Ohio Medicaid or your county Job and Family Services office.",
  },
} as const;

export const OHIO_NOTICE_OPTIONS = {
  request: { label: "Ohio asked me to renew or send information" },
  decision: { label: "Ohio says my coverage will end or has ended" },
  none: { label: "I haven’t seen one, or I’m not sure" },
} as const;

export type OhioCoverageGroup = keyof typeof OHIO_COVERAGE_GROUPS;
export type OhioNotice = keyof typeof OHIO_NOTICE_OPTIONS;

export function ohioChangeResult(group: OhioCoverageGroup, notice: OhioNotice) {
  const result = OHIO_COVERAGE_GROUPS[group];

  if (notice === "request") {
    return {
      ...result,
      next: "Respond by the date on your notice",
      action: "Use the instructions on your notice to send what Ohio asked for. If the instructions are unclear or the date has passed, contact your county Job and Family Services office as soon as you can.",
    };
  }

  if (notice === "decision") {
    return {
      ...result,
      next: "Check the reason and hearing instructions on your notice",
      action: "Read the date coverage ends and the deadline to ask for a state hearing if you disagree. Contact your county Job and Family Services office promptly if you need help understanding the decision.",
    };
  }

  return result;
}
