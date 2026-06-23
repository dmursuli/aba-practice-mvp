export function graphScopeVisibility(activeTab = "skills") {
  return {
    showSkillCharts: activeTab === "skills",
    showBehaviorGraphs: activeTab === "behaviors",
    showParentTrainingCharts: activeTab === "parent"
  };
}
