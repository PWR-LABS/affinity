export const PART_D_STATE_ERROR = "Enter a valid two-letter U.S. state or territory code.";

const PDP_REGION_STATES: Record<string, readonly string[]> = {
  "1": ["NH", "ME"],
  "2": ["CT", "MA", "RI", "VT"],
  "3": ["NY"],
  "4": ["NJ"],
  "5": ["DE", "DC", "MD"],
  "6": ["PA", "WV"],
  "7": ["VA"],
  "8": ["NC"],
  "9": ["SC"],
  "10": ["GA"],
  "11": ["FL"],
  "12": ["AL", "TN"],
  "13": ["MI"],
  "14": ["OH"],
  "15": ["IN", "KY"],
  "16": ["WI"],
  "17": ["IL"],
  "18": ["MO"],
  "19": ["AR"],
  "20": ["MS"],
  "21": ["LA"],
  "22": ["TX"],
  "23": ["OK"],
  "24": ["KS"],
  "25": ["IA", "MN", "MT", "NE", "ND", "SD", "WY"],
  "26": ["NM"],
  "27": ["CO"],
  "28": ["AZ"],
  "29": ["NV"],
  "30": ["OR", "WA"],
  "31": ["ID", "UT"],
  "32": ["CA"],
  "33": ["HI"],
  "34": ["AK"],
  "35": ["AS"],
  "36": ["GU"],
  "37": ["MP"],
  "38": ["PR"],
  "39": ["VI"],
};

export function pdpRegionCodeForState(state: string): string | null {
  const normalized = state.trim().toUpperCase();
  for (const [regionCode, states] of Object.entries(PDP_REGION_STATES)) {
    if (states.includes(normalized)) return regionCode;
  }
  return null;
}
