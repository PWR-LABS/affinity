const directory = [
  { name: "CareSource", search: "care source", group: "Ohio Medicaid", href: "https://mylife.caresource.com/" },
  { name: "AmeriHealth Caritas Ohio", search: "ameri health", group: "Ohio Medicaid", href: "https://www.amerihealthcaritasoh.com/member/eng/index.aspx" },
  { name: "Anthem Blue Cross and Blue Shield", search: "bcbs anthem", group: "Ohio Medicaid", href: "https://www.anthem.com/oh/medicaid" },
  { name: "Buckeye Health Plan", search: "", group: "Ohio Medicaid", href: "https://www.buckeyehealthplan.com/members.html" },
  { name: "Humana Healthy Horizons", search: "", group: "Ohio Medicaid", href: "https://www.humana.com/medicaid/ohio" },
  { name: "Molina Healthcare of Ohio", search: "my molina", group: "Ohio Medicaid", href: "https://www.molinahealthcare.com/members/oh/en-us/mem/medicaid/contact.aspx" },
  { name: "UnitedHealthcare Community Plan", search: "united health care uhc", group: "Ohio Medicaid", href: "https://www.uhc.com/communityplan/ohio" },
  { name: "Ohio Medicaid Consumer Hotline", search: "unknown plan", group: "Ohio Medicaid", href: "https://www.ohiomh.com/" },
  { name: "Next Generation MyCare", search: "my care dual medicaid medicare", group: "Medicare + Ohio Medicaid", href: "https://medicaid.ohio.gov/families-and-individuals/citizen-programs-and-initiatives/mycareohio/" },
  { name: "Medicare.gov account", search: "original medicare part a part b medicare advantage part d", group: "Medicare", href: "https://www.medicare.gov/account/login" },
] as const;

function words(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function findOhioCoverageResources(query: string) {
  const terms = words(query).split(" ").filter(Boolean);
  return directory.filter(entry => {
    const index = words(`${entry.name} ${entry.group} ${entry.search}`);
    return terms.every(term => index.includes(term));
  });
}
