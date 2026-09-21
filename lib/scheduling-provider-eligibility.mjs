export const SCHEDULING_SERVICE_CODES = ["97151", "97153", "97155", "97156"];

const PROVIDER_ROLES_BY_SERVICE_CODE = new Map([
  ["97151", new Set(["bcba"])],
  ["97153", new Set(["rbt"])],
  ["97155", new Set(["bcba"])],
  ["97156", new Set(["bcba"])]
]);

export function providerRoleIsEligibleForService(role, serviceCode) {
  return PROVIDER_ROLES_BY_SERVICE_CODE.get(String(serviceCode || ""))
    ?.has(String(role || "").toLowerCase()) || false;
}

export function activeProvidersEligibleForService(users, serviceCode) {
  return (users || []).filter((user) => (
    user?.active !== false
    && providerRoleIsEligibleForService(user?.role, serviceCode)
  ));
}
