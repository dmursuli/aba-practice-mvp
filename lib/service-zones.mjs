export const SERVICE_ZONE_VALUES = [
  "Homestead", "Florida City", "Princeton", "Goulds", "Cutler Bay", "Palmetto Bay",
  "Kendall", "West Kendall", "Tamiami", "Fontainebleau",
  "Coral Gables", "South Miami", "Westchester", "Flagami", "Little Havana",
  "Hialeah", "Hialeah Gardens", "Miami Lakes", "Doral", "Medley",
  "North Miami", "North Miami Beach", "Aventura", "Sunny Isles Beach", "Bal Harbour",
  "Bay Harbor Islands", "Surfside", "Downtown Miami", "Brickell", "Edgewater", "Wynwood",
  "Midtown", "Design District", "Miami Beach", "Key Biscayne"
];

export const SERVICE_ZONE_SET = new Set(SERVICE_ZONE_VALUES);

export function sanitizeProviderZoneInput(value = {}) {
  const errors = [];
  const primaryZone = String(value.primaryZone || "").trim();
  if (!SERVICE_ZONE_SET.has(primaryZone)) errors.push("Choose an approved primary zone.");
  if (!Array.isArray(value.acceptableZones)) errors.push("acceptableZones must be an array.");
  const input = Array.isArray(value.acceptableZones) ? value.acceptableZones : [];
  const acceptableZones = [...new Set(input.map((zone) => String(zone || "").trim()))];
  if (acceptableZones.some((zone) => !SERVICE_ZONE_SET.has(zone))) {
    errors.push("Every acceptable zone must be an approved geographic zone.");
  }
  if (acceptableZones.includes(primaryZone)) {
    errors.push("Primary zone cannot also be an acceptable zone.");
  }
  acceptableZones.sort((left, right) => SERVICE_ZONE_VALUES.indexOf(left) - SERVICE_ZONE_VALUES.indexOf(right));
  return { profile: { primaryZone, acceptableZones }, errors: [...new Set(errors)] };
}
