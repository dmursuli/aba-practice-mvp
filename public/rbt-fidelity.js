export function setRbtFidelityResponse(responses = {}, areaId, value) {
  const next = { ...responses };
  const id = String(areaId || "");
  if (!id) return next;
  if (value === "yes" || value === "no") next[id] = value;
  else delete next[id];
  return next;
}

export function calculateRbtFidelity(areas = [], responses = {}) {
  const checklistResponses = areas.map((area) => ({
    areaId: String(area.id || ""),
    label: String(area.label || ""),
    response: responses[area.id] === "yes" || responses[area.id] === "no" ? responses[area.id] : null
  }));
  const answered = checklistResponses.filter((item) => item.response);
  const yesItems = answered.filter((item) => item.response === "yes");
  const noItems = answered.filter((item) => item.response === "no");
  return {
    responses: checklistResponses,
    total: answered.length,
    answeredCount: answered.length,
    yesCount: yesItems.length,
    noCount: noItems.length,
    noItems: noItems.map((item) => item.label),
    percent: answered.length ? Math.round((yesItems.length / answered.length) * 100) : null
  };
}
