/** Direct CMS metadata for bounded source-pair checks; do not assume a profile stays federal forever. */
type Json = Record<string, unknown>;
export async function sourceStateRoute(read: (path: string) => Promise<Json>, year: number | undefined, state: string) {
  if (!Number.isInteger(year)) throw new Error("cms_state_route_invalid");
  const data = await read(`/states?year=${year}`);
  const matches = Array.isArray(data.states) ? data.states.filter((row) => row?.abbrev === state) as Json[] : [];
  if (matches.length !== 1) throw new Error("cms_state_route_invalid");
  const row = matches[0];
  if (row.marketplace_model === "SBM") {
    if (typeof row.hix_name !== "string" || !row.hix_name.trim() || typeof row.hix_url !== "string") throw new Error("cms_state_route_invalid");
    const url = new URL(row.hix_url);
    if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new Error("cms_state_route_invalid");
    return { model: "SBM", marketplace: { name: row.hix_name, url: url.href, hostname: url.hostname.replace(/^www\./, "") } };
  }
  if (!["FFM", "FFMPartnership", "SupportedSBM"].includes(String(row.marketplace_model))) throw new Error("cms_state_route_invalid");
  return { model: String(row.marketplace_model), marketplace: undefined };
}
