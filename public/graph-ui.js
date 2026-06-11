export function graphScopeVisibility(activeTab = "skills") {
  return {
    showSkillCharts: activeTab !== "behaviors",
    showBehaviorGraphs: activeTab === "behaviors"
  };
}
