import test from "node:test";
import assert from "node:assert/strict";
import {
  activeProvidersEligibleForService,
  providerRoleIsEligibleForService,
  serviceCodesEligibleForProviderRole
} from "../lib/scheduling-provider-eligibility.mjs";

test("shared Scheduling eligibility permits both active RBT and BCBA providers for 97153", () => {
  assert.equal(providerRoleIsEligibleForService("rbt", "97153"), true);
  assert.equal(providerRoleIsEligibleForService("bcba", "97153"), true);
  const users = [
    { id: "active-rbt", role: "rbt", active: true },
    { id: "active-bcba", role: "bcba", active: true },
    { id: "inactive-rbt", role: "rbt", active: false },
    { id: "inactive-bcba", role: "bcba", active: false }
  ];
  assert.deepEqual(
    activeProvidersEligibleForService(users, "97153").map((user) => user.id),
    ["active-rbt", "active-bcba"]
  );
});

test("shared Scheduling eligibility keeps 97151, 97155, and 97156 BCBA-only", () => {
  for (const serviceCode of ["97151", "97155", "97156"]) {
    assert.equal(providerRoleIsEligibleForService("rbt", serviceCode), false);
    assert.equal(providerRoleIsEligibleForService("bcba", serviceCode), true);
  }
  assert.deepEqual(serviceCodesEligibleForProviderRole("rbt"), ["97153"]);
  assert.deepEqual(serviceCodesEligibleForProviderRole("bcba"), ["97151", "97153", "97155", "97156"]);
});
