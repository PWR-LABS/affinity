/**
 * Official Medicaid application and renewal entry points for the 50 states plus D.C.
 *
 * Source: CMS's state Medicaid contact directory, reviewed 2026-08-21. These are navigation
 * resources, not encoded eligibility rules: states make final determinations and can change their
 * programs independently.
 */
export interface StateMedicaidResource {
  code: string;
  state: string;
  program: string;
  applyUrl: string;
  phone: string;
}

export const STATE_MEDICAID_RESOURCES: readonly StateMedicaidResource[] = [
  { code: "AL", state: "Alabama", program: "Alabama Medicaid", applyUrl: "https://medicaid.alabama.gov/content/3.0_Apply/", phone: "334-242-5000" },
  { code: "AK", state: "Alaska", program: "Alaska Medicaid", applyUrl: "https://www.medicaidalaska.com/portals/wps/portal/enterprise/memberpublic/", phone: "800-478-7778" },
  { code: "AZ", state: "Arizona", program: "Arizona Health Care Cost Containment System (AHCCCS)", applyUrl: "https://azahcccs.gov/Members/GetCovered/apply.html", phone: "800-654-8713" },
  { code: "AR", state: "Arkansas", program: "Arkansas Medicaid", applyUrl: "https://humanservices.arkansas.gov/apply-for-services/", phone: "800-482-8988" },
  { code: "CA", state: "California", program: "Medi-Cal", applyUrl: "https://www.dhcs.ca.gov/Pages/Keep-Your-Medi-Cal.aspx", phone: "800-541-5555" },
  { code: "CO", state: "Colorado", program: "Health First Colorado", applyUrl: "https://www.healthfirstcolorado.com/apply-now/", phone: "800-221-3943" },
  { code: "CT", state: "Connecticut", program: "HUSKY Health", applyUrl: "https://portal.ct.gov/DSS/Common-Elements/How-to-Apply-for-Services/How-to-Apply-for-Services", phone: "855-805-4325" },
  { code: "DE", state: "Delaware", program: "Delaware Medicaid & Medical Assistance", applyUrl: "https://assist.dhss.delaware.gov/", phone: "866-843-7212" },
  { code: "DC", state: "District of Columbia", program: "DC Medicaid", applyUrl: "https://www.dchealthlink.com/individuals/medicaid", phone: "855-532-5465" },
  { code: "FL", state: "Florida", program: "Florida Medicaid", applyUrl: "https://www.myflfamilies.com/services/public-assistance", phone: "888-419-3456" },
  { code: "GA", state: "Georgia", program: "Georgia Medicaid", applyUrl: "https://medicaid.georgia.gov/how-apply", phone: "877-423-4746" },
  { code: "HI", state: "Hawaii", program: "Hawaii Med-QUEST", applyUrl: "https://medical.mybenefits.hawaii.gov/web/kolea/home-page", phone: "800-316-8005" },
  { code: "ID", state: "Idaho", program: "Idaho Medicaid", applyUrl: "https://healthandwelfare.idaho.gov/services-programs/medicaid-health", phone: "877-456-1233" },
  { code: "IL", state: "Illinois", program: "Illinois Medicaid", applyUrl: "https://abe.illinois.gov/access/", phone: "800-843-6154" },
  { code: "IN", state: "Indiana", program: "Indiana Medicaid", applyUrl: "https://fssabenefits.in.gov/bp/#/", phone: "800-403-0864" },
  { code: "IA", state: "Iowa", program: "Iowa Medicaid", applyUrl: "https://hhsservices.iowa.gov/apspssp/ssp.portal", phone: "800-338-8366" },
  { code: "KS", state: "Kansas", program: "KanCare", applyUrl: "https://www.kancare.ks.gov/apply-now", phone: "800-792-4884" },
  { code: "KY", state: "Kentucky", program: "Kentucky Medicaid", applyUrl: "https://kynect.ky.gov/benefits/s/?language=en_US", phone: "855-306-8959" },
  { code: "LA", state: "Louisiana", program: "Healthy Louisiana", applyUrl: "https://ldh.la.gov/subhome/48", phone: "888-342-6207" },
  { code: "ME", state: "Maine", program: "MaineCare", applyUrl: "https://apps1.web.maine.gov/benefits/account/login.html", phone: "855-797-4357" },
  { code: "MD", state: "Maryland", program: "Maryland Medicaid", applyUrl: "https://health.maryland.gov/mmcp/eligibility/Pages/apply.aspx", phone: "855-642-8572" },
  { code: "MA", state: "Massachusetts", program: "MassHealth", applyUrl: "https://www.mass.gov/information-for-masshealth-applicants", phone: "800-841-2900" },
  { code: "MI", state: "Michigan", program: "Michigan Medicaid", applyUrl: "https://newmibridges.michigan.gov/s/isd-landing-page?language=en_US", phone: "833-599-6444" },
  { code: "MN", state: "Minnesota", program: "Minnesota Health Care Programs", applyUrl: "https://mn.gov/dhs/health-care/apply/", phone: "800-657-3672" },
  { code: "MS", state: "Mississippi", program: "Mississippi Medicaid", applyUrl: "https://medicaid.ms.gov/medicaid-coverage/how-to-apply/", phone: "800-421-2408" },
  { code: "MO", state: "Missouri", program: "MO HealthNet", applyUrl: "https://mydss.mo.gov/healthcare/apply", phone: "855-373-9994" },
  { code: "MT", state: "Montana", program: "Montana Medicaid", applyUrl: "https://apply.mt.gov/", phone: "800-362-8312" },
  { code: "NE", state: "Nebraska", program: "Nebraska Medicaid", applyUrl: "https://dhhs.ne.gov/pages/accessnebraska.aspx", phone: "855-632-7633" },
  { code: "NV", state: "Nevada", program: "Nevada Medicaid", applyUrl: "https://accessnevada.nv.gov/public/landing-page", phone: "877-638-3472" },
  { code: "NH", state: "New Hampshire", program: "New Hampshire Medicaid", applyUrl: "https://nheasy.nh.gov/", phone: "844-275-3447" },
  { code: "NJ", state: "New Jersey", program: "NJ FamilyCare", applyUrl: "https://www.njhelps.gov/", phone: "800-701-0710" },
  { code: "NM", state: "New Mexico", program: "Turquoise Care", applyUrl: "https://www.yes.state.nm.us/yesnm/home/index", phone: "800-283-4465" },
  { code: "NY", state: "New York", program: "New York State Medicaid", applyUrl: "https://nystateofhealth.ny.gov/", phone: "855-355-5777" },
  { code: "NC", state: "North Carolina", program: "NC Medicaid", applyUrl: "https://epass.nc.gov/", phone: "888-245-0179" },
  { code: "ND", state: "North Dakota", program: "North Dakota Medicaid", applyUrl: "https://www.hhs.nd.gov/healthcare/medicaid/apply", phone: "800-755-2604" },
  { code: "OH", state: "Ohio", program: "Ohio Medicaid", applyUrl: "https://ssp.benefits.ohio.gov/", phone: "800-324-8680" },
  { code: "OK", state: "Oklahoma", program: "SoonerCare", applyUrl: "https://oklahoma.gov/ohca/individuals/mysoonercare/apply-for-soonercare-online/where-to-apply.html", phone: "800-987-7767" },
  { code: "OR", state: "Oregon", program: "Oregon Health Plan", applyUrl: "https://one.oregon.gov/", phone: "800-699-9075" },
  { code: "PA", state: "Pennsylvania", program: "Medical Assistance", applyUrl: "https://www.compass.dhs.pa.gov/", phone: "800-692-7462" },
  { code: "RI", state: "Rhode Island", program: "Rhode Island Medicaid", applyUrl: "https://healthyrhode.ri.gov/", phone: "855-840-4774" },
  { code: "SC", state: "South Carolina", program: "Healthy Connections Medicaid", applyUrl: "https://apply.scdhhs.gov/CitizenPortal/application.do", phone: "888-549-0820" },
  { code: "SD", state: "South Dakota", program: "South Dakota Medicaid", applyUrl: "https://dss.sd.gov/applyonline/default.aspx", phone: "800-597-1603" },
  { code: "TN", state: "Tennessee", program: "TennCare", applyUrl: "https://tenncareconnect.tn.gov/", phone: "855-259-0701" },
  { code: "TX", state: "Texas", program: "Texas Medicaid", applyUrl: "https://yourtexasbenefits.com/", phone: "800-335-8957" },
  { code: "UT", state: "Utah", program: "Utah Medicaid", applyUrl: "https://medicaid.utah.gov/apply-medicaid/", phone: "866-435-7414" },
  { code: "VT", state: "Vermont", program: "Vermont Medicaid", applyUrl: "https://portal.healthconnect.vermont.gov/VTHBELand/welcome.action", phone: "855-899-9600" },
  { code: "VA", state: "Virginia", program: "Cardinal Care", applyUrl: "https://coverva.dmas.virginia.gov/apply/", phone: "833-522-5582" },
  { code: "WA", state: "Washington", program: "Washington Apple Health", applyUrl: "https://www.wahealthplanfinder.org/", phone: "800-562-3022" },
  { code: "WV", state: "West Virginia", program: "West Virginia Medicaid", applyUrl: "https://www.wvpath.wv.gov/", phone: "877-716-1212" },
  { code: "WI", state: "Wisconsin", program: "BadgerCare Plus", applyUrl: "https://access.wi.gov/", phone: "800-362-3002" },
  { code: "WY", state: "Wyoming", program: "Wyoming Medicaid", applyUrl: "https://health.wyo.gov/healthcarefin/apply/", phone: "855-294-2127" },
];

const BY_CODE = new Map(STATE_MEDICAID_RESOURCES.map((resource) => [resource.code, resource]));

export function medicaidResourceByCode(code?: string): StateMedicaidResource | undefined {
  return code ? BY_CODE.get(code.toUpperCase()) : undefined;
}

export function medicaidChangeUrl(code: string): string {
  return `https://www.medicaid.gov/renew-info/${code.toUpperCase()}`;
}

export interface FeaturedMedicaidChange {
  code: "NY" | "OH";
  timing: string;
  dek: string;
  facts: readonly string[];
  action: string;
  sourceUrl: string;
}

export const FEATURED_MEDICAID_CHANGES: readonly FeaturedMedicaidChange[] = [
  {
    code: "NY",
    timing: "Renewal changes now · federal rules January 1, 2027",
    dek: "Renewal protections are narrowing.",
    facts: [
      "Most adults are returning to standard renewal checks after twelve-month continuous eligibility ended.",
      "Some children under six are also returning to standard renewals.",
      "The new federal work and community-engagement rules are scheduled for January 1, 2027.",
    ],
    action: "Update your contact information and respond to every NY State of Health renewal notice.",
    sourceUrl: "https://www.health.ny.gov/health_care/medicaid/program/update/2026/no07_2026-06.htm",
  },
  {
    code: "OH",
    timing: "Six-month review law enacted · federal rules January 1, 2027",
    dek: "More frequent eligibility checks are coming.",
    facts: [
      "Ohio law calls for expansion eligibility to be reviewed every six months when federal law allows.",
      "CMS says affected adults should prepare to document work, school, training, or volunteer hours.",
      "People who meet an exclusion should gather medical, caregiving, or other supporting records.",
    ],
    action: "Update your Ohio Benefits account, save monthly records, and watch for a state notice.",
    sourceUrl: "https://codes.ohio.gov/ohio-revised-code/section-5163.11",
  },
];

export function featuredMedicaidChange(code?: string): FeaturedMedicaidChange | undefined {
  return code ? FEATURED_MEDICAID_CHANGES.find((change) => change.code === code.toUpperCase()) : undefined;
}
