import { createAuditEvent, createClient, createSession, createUser, deleteClientDocument, deleteSession, getAuditLog, getCurrentUser, getData, getPracticeBackup, getUsers, login, logout, restorePracticeBackup, updateClientPlan, updateClientProfile, updateNote, updateUser, uploadClientDocument } from "./api.js";
import { drawLineChart } from "./charts.js";
import { generateSoapNote } from "./soap.js";

const state = {
  clients: [],
  programs: [],
  behaviors: [],
  sessions: [],
  auditLog: [],
  healthIssues: [],
  users: [],
  selectedSessionId: null,
  activeDomain: "",
  activePlanDomain: "",
  currentUser: null
};

const roleViews = {
  admin: ["clients", "users", "session", "intake", "plan", "parent", "graphs", "report", "soap", "billing", "health", "audit"],
  bcba: ["session", "intake", "plan", "parent", "graphs", "report", "soap", "billing", "health", "audit"],
  rbt: ["session", "graphs", "soap"],
  "read-only": ["graphs", "report", "soap"]
};

const domainOptions = [
  "Functional Communication",
  "Visual Perceptual Skills",
  "Transition Tolerance",
  "Listener Responding"
];

const defaultRbtPerformanceAreas = [
  { id: "prepared", label: "Arrived prepared and followed the session plan" },
  { id: "targets", label: "Implemented acquisition targets as written" },
  { id: "prompting", label: "Used prompting and prompt fading correctly" },
  { id: "reinforcement", label: "Delivered reinforcement appropriately" },
  { id: "behavior", label: "Implemented behavior intervention procedures" },
  { id: "data", label: "Collected accurate session data" },
  { id: "engagement", label: "Maintained client engagement and instructional pace" },
  { id: "professional", label: "Responded to feedback and communicated professionally" }
];

const loginScreen = document.querySelector("#login-screen");
const loginForm = document.querySelector("#login-form");
const loginMessage = document.querySelector("#login-message");
const appRoot = document.querySelector("#app-root");
const currentUserLabel = document.querySelector("#current-user-label");
const logoutButton = document.querySelector("#logout-button");
const newUserForm = document.querySelector("#new-user-form");
const userList = document.querySelector("#user-list");
const newUserMessage = document.querySelector("#new-user-message");
const userManagementMessage = document.querySelector("#user-management-message");
const refreshUsersButton = document.querySelector("#refresh-users");
const form = document.querySelector("#session-form");
const clientProfileForm = document.querySelector("#client-profile-form");
const clientDocumentForm = document.querySelector("#client-document-form");
const newClientForm = document.querySelector("#new-client-form");
const intakeForm = document.querySelector("#intake-form");
const bcbaSessionForm = document.querySelector("#bcba-session-form");
const parentTrainingForm = document.querySelector("#parent-training-form");
const rbtFeedbackSection = document.querySelector("#rbt-feedback-section");
const rbtFidelityScore = document.querySelector("#rbt-fidelity-score");
const rbtWrittenFeedback = document.querySelector("#rbt-written-feedback");
const rbtFeedbackHelp = document.querySelector("#rbt-feedback-help");
const rbtFidelityRows = document.querySelector("#rbt-fidelity-rows");
const addRbtPerformanceAreaButton = document.querySelector("#add-rbt-performance-area");
const clientSelect = document.querySelector("#client-select");
const managementClientSelect = document.querySelector("#management-client-select");
const bcbaClientSelect = document.querySelector("#bcba-client-select");
const parentClientSelect = document.querySelector("#parent-client-select");
const intakeClientSelect = document.querySelector("#intake-client-select");
const programList = document.querySelector("#program-list");
const parentGoalList = document.querySelector("#parent-goal-list");
const domainTabs = document.querySelector("#domain-tabs");
const behaviorList = document.querySelector("#behavior-list");
const skillCharts = document.querySelector("#skill-charts");
const behaviorCharts = document.querySelector("#behavior-charts");
const graphsClientSummary = document.querySelector("#graphs-client-summary");
const reportClientSummary = document.querySelector("#report-client-summary");
const reportForm = document.querySelector("#funder-report-form");
const reportPreview = document.querySelector("#funder-report-preview");
const fadePlanRows = document.querySelector("#fade-plan-rows");
const addFadeRowButton = document.querySelector("#add-fade-row");
const serviceHourRows = document.querySelector("#service-hour-rows");
const addServiceHourRowButton = document.querySelector("#add-service-hour-row");
const printFunderReportButton = document.querySelector("#print-funder-report");
const downloadFunderTextButton = document.querySelector("#download-funder-text");
const downloadFunderHtmlButton = document.querySelector("#download-funder-html");
const funderExportStatus = document.querySelector("#funder-export-status");
const soapClientSummary = document.querySelector("#soap-client-summary");
const planReview = document.querySelector("#plan-review");
const planDomainTabs = document.querySelector("#plan-domain-tabs");
const clientManagementSummary = document.querySelector("#client-management-summary");
const clientProfileMessage = document.querySelector("#client-profile-message");
const clientDocumentMessage = document.querySelector("#client-document-message");
const clientDocumentList = document.querySelector("#client-document-list");
const exportClientPackageButton = document.querySelector("#export-client-package");
const downloadPracticeBackupButton = document.querySelector("#download-practice-backup");
const restorePracticeBackupButton = document.querySelector("#restore-practice-backup");
const newClientMessage = document.querySelector("#new-client-message");
const intakeMessage = document.querySelector("#intake-message");
const intakeSummary = document.querySelector("#intake-summary");
const planClientSummary = document.querySelector("#plan-client-summary");
const parentClientSummary = document.querySelector("#parent-client-summary");
const addProgramForm = document.querySelector("#add-program-form");
const addDomainButton = document.querySelector("#add-domain");
const note97155Editor = document.querySelector("#note-97155");
const note97155Status = document.querySelector("#note-97155-status");
const generate97155Button = document.querySelector("#generate-97155-note");
const planMessage = document.querySelector("#plan-message");
const parentMessage = document.querySelector("#parent-message");
const formMessage = document.querySelector("#form-message");
const noteStatus = document.querySelector("#note-status");
const soapEditor = document.querySelector("#soap-note");
const selectedSoapNoteTitle = document.querySelector("#selected-soap-note-title");
const finalizeButton = document.querySelector("#finalize-note");
const printSoapNoteButton = document.querySelector("#print-soap-note");
const downloadSoapTextButton = document.querySelector("#download-soap-text");
const downloadSoapHtmlButton = document.querySelector("#download-soap-html");
const auditClientFilter = document.querySelector("#audit-client-filter");
const auditUserFilter = document.querySelector("#audit-user-filter");
const auditActionFilter = document.querySelector("#audit-action-filter");
const auditStartFilter = document.querySelector("#audit-start-filter");
const auditEndFilter = document.querySelector("#audit-end-filter");
const auditMessage = document.querySelector("#audit-message");
const auditLogTable = document.querySelector("#audit-log-table");
const refreshAuditLogButton = document.querySelector("#refresh-audit-log");
const exportAuditCsvButton = document.querySelector("#export-audit-csv");
const exportAuditJsonButton = document.querySelector("#export-audit-json");
const billingClientFilter = document.querySelector("#billing-client-filter");
const billingProviderFilter = document.querySelector("#billing-provider-filter");
const billingCodeFilter = document.querySelector("#billing-code-filter");
const billingStartFilter = document.querySelector("#billing-start-filter");
const billingEndFilter = document.querySelector("#billing-end-filter");
const billingReadyFilter = document.querySelector("#billing-ready-filter");
const refreshBillingExportButton = document.querySelector("#refresh-billing-export");
const exportBillingCsvButton = document.querySelector("#export-billing-csv");
const billingMessage = document.querySelector("#billing-message");
const billingSummary = document.querySelector("#billing-summary");
const billingTable = document.querySelector("#billing-table");
const healthMessage = document.querySelector("#health-message");
const healthSummary = document.querySelector("#health-summary");
const healthReportTable = document.querySelector("#health-report-table");
const runHealthCheckButton = document.querySelector("#run-health-check");
const exportHealthCsvButton = document.querySelector("#export-health-csv");
const exportHealthJsonButton = document.querySelector("#export-health-json");
const intakeVbMappLevelSelect = document.querySelector("#intake-vbmapp-level");
const intakeDraftFields = [
  "interviewDate",
  "interviewedBy",
  "autismDiagnosis",
  "diagnosisSourceDate",
  "priorEvaluations",
  "recentCdeDate",
  "vbMappLevel",
  "caregiversPresent",
  "householdMembers",
  "primaryCaregivers",
  "pregnancyBirthComplications",
  "milestones",
  "earlyDevelopmentNotes",
  "communicationMethod",
  "strengths",
  "concerningBehaviors",
  "behaviorDescription",
  "behaviorWhen",
  "behaviorTriggers",
  "behaviorAfter",
  "behaviorResponse",
  "topPriorityBehavior",
  "currentServices",
  "serviceFrequency",
  "serviceProgress",
  "schoolAttendance",
  "schoolSetting",
  "teacherConcerns",
  "peerInteraction",
  "schoolChallenges",
  "previousAba",
  "previousAbaDetails",
  "previousAbaFocus",
  "previousAbaEnded",
  "medicalHistory",
  "seizuresAllergiesMedications",
  "sleepQuality",
  "feedingConcerns",
  "painTolerance",
  "level1Manding",
  "level1Listener",
  "level1Imitation",
  "level1Play",
  "level1Social",
  "level2Manding",
  "level2Tacting",
  "level2Listener",
  "level2Intraverbals",
  "level2Play",
  "level2Social",
  "level3Manding",
  "level3Tacting",
  "level3Intraverbals",
  "level3Listener",
  "level3PlaySocial",
  "level3SchoolReadiness",
  "preferredInterests",
  "interviewNotes"
];
const sessionDraftFields = [
  "date",
  "therapist",
  "setting",
  "startTime",
  "endTime",
  "caregiverPresent",
  "caregiverTraining",
  "affect",
  "transitions",
  "barriers",
  "barrierText",
  "notes",
  "providerSignature",
  "providerCredential"
];

init();

async function init() {
  setDefaultDate();
  bindEvents();
  await restoreSession();
}

async function restoreSession() {
  try {
    const { user } = await getCurrentUser();
    state.currentUser = user;
    await startAuthenticatedApp();
  } catch {
    showLogin();
  }
}

async function startAuthenticatedApp() {
  showApp();
  await refreshData();
  preloadTargetRows();
  preloadBehaviorRows();
  preloadParentRows();
  preloadFadePlanRows();
  preloadServiceHourRows();
  render();
}

async function refreshData() {
  const data = await getData();
  Object.assign(state, data);
  if (!clientSelect.value && state.clients[0]) clientSelect.value = state.clients[0].id;
  populateDomainSelect(addProgramForm.elements.programDomain);
  if (state.currentUser?.role === "admin") {
    await refreshUsers(false);
  }
  if (["admin", "bcba"].includes(state.currentUser?.role)) {
    await refreshAuditLog(false);
  }
}

async function refreshUsers(showMessage = true) {
  if (state.currentUser?.role !== "admin") return;
  try {
    const payload = await getUsers();
    state.users = payload.users || [];
    renderUsers();
    if (showMessage) userManagementMessage.textContent = "Users refreshed.";
  } catch (error) {
    userManagementMessage.textContent = error.message;
  }
}

function bindEvents() {
  loginForm.addEventListener("submit", handleLogin);
  logoutButton.addEventListener("click", handleLogout);
  newUserForm.addEventListener("submit", handleCreateUser);
  userList.addEventListener("click", handleUserListClick);
  userList.addEventListener("change", handleUserListChange);
  refreshUsersButton.addEventListener("click", refreshUsers);
  document.querySelectorAll("[data-view-button]").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.viewButton));
  });
  document.querySelector("#add-program").addEventListener("click", () => addFirstAvailableTargetRow());
  document.querySelector("#add-maintenance-target").addEventListener("click", () => addFirstAvailableTargetRow("maintenance"));
  document.querySelector("#add-behavior").addEventListener("click", () => addFirstAvailableBehaviorRow());
  document.querySelector("#add-parent-goal").addEventListener("click", () => addParentGoalRow());
  managementClientSelect.addEventListener("change", () => {
    clientSelect.value = managementClientSelect.value;
    state.selectedSessionId = null;
    state.activeDomain = "";
    state.activePlanDomain = "";
    syncSettingFromClient();
    resetRows();
    render();
  });
  clientSelect.addEventListener("change", () => {
    state.selectedSessionId = null;
    state.activeDomain = "";
    state.activePlanDomain = "";
    syncSettingFromClient();
    resetRows();
    render();
  });
  form.addEventListener("input", (event) => {
    const row = event.target.closest(".program-row");
    if (row) updateProgramIndependence(row);
    saveSessionDraft();
  });
  form.addEventListener("change", (event) => {
    if (event.target.matches('[data-field="programId"]')) {
      syncTargetOptions(event.target.closest(".program-row"));
      renderDomainTabs();
      refreshTargetAvailability();
    }
    if (event.target.matches('[data-field="targetId"]')) {
      refreshTargetAvailability();
    }
    if (event.target.matches('[data-field="behaviorId"]')) {
      refreshBehaviorAvailability();
    }
    saveSessionDraft();
  });
  form.addEventListener("submit", handleSubmit);
  clientProfileForm.addEventListener("submit", handleClientProfileSubmit);
  clientDocumentForm.addEventListener("submit", handleClientDocumentSubmit);
  clientDocumentList.addEventListener("click", handleClientDocumentClick);
  exportClientPackageButton.addEventListener("click", handleExportClientPackage);
  downloadPracticeBackupButton.addEventListener("click", handleDownloadPracticeBackup);
  restorePracticeBackupButton.addEventListener("click", handleRestorePracticeBackup);
  newClientForm.addEventListener("submit", handleNewClientSubmit);
  intakeClientSelect.addEventListener("change", () => {
    clientSelect.value = intakeClientSelect.value;
    state.selectedSessionId = null;
    state.activeDomain = "";
    state.activePlanDomain = "";
    syncSettingFromClient();
    resetRows();
    render();
  });
  intakeVbMappLevelSelect.addEventListener("change", updateVbMappVisibility);
  intakeVbMappLevelSelect.addEventListener("input", updateVbMappVisibility);
  intakeForm.addEventListener("input", saveIntakeDraft);
  intakeForm.addEventListener("submit", handleIntakeSubmit);
  parentTrainingForm.addEventListener("input", (event) => {
    const row = event.target.closest(".parent-goal-row");
    if (row) updateParentGoalScore(row);
  });
  parentTrainingForm.addEventListener("submit", handleParentTrainingSubmit);
  bcbaSessionForm.elements.rbtPresent.addEventListener("change", toggleRbtFeedbackSection);
  rbtFeedbackSection.addEventListener("change", updateRbtFidelityScore);
  rbtFeedbackSection.addEventListener("focusout", handleRbtPerformanceAreaEdit);
  rbtFeedbackSection.addEventListener("click", handleRbtPerformanceAreaClick);
  addRbtPerformanceAreaButton.addEventListener("click", handleAddRbtPerformanceArea);
  addProgramForm.addEventListener("submit", handleAddProgram);
  addDomainButton.addEventListener("click", handleAddDomain);
  reportForm.addEventListener("submit", handleGenerateFunderReport);
  reportForm.addEventListener("change", renderReportSummary);
  addFadeRowButton.addEventListener("click", () => addFadePlanRow());
  addServiceHourRowButton.addEventListener("click", () => addServiceHourRow());
  printFunderReportButton.addEventListener("click", () => window.print());
  downloadFunderTextButton.addEventListener("click", () => handleDownloadFunderReport("txt"));
  downloadFunderHtmlButton.addEventListener("click", () => handleDownloadFunderReport("html"));
  generate97155Button.addEventListener("click", handleGenerate97155Note);
  note97155Editor.addEventListener("blur", handleSave97155Note);
  planReview.addEventListener("change", handlePlanStatusChange);
  planReview.addEventListener("click", handlePlanClick);
  finalizeButton.addEventListener("click", handleFinalize);
  printSoapNoteButton.addEventListener("click", handlePrintSoapNote);
  downloadSoapTextButton.addEventListener("click", () => handleDownloadSoapNote("txt"));
  downloadSoapHtmlButton.addEventListener("click", () => handleDownloadSoapNote("html"));
  [auditClientFilter, auditUserFilter, auditActionFilter, auditStartFilter, auditEndFilter].forEach((field) => {
    field.addEventListener("input", renderAuditLog);
  });
  refreshAuditLogButton.addEventListener("click", refreshAuditLog);
  exportAuditCsvButton.addEventListener("click", () => exportAuditLog("csv"));
  exportAuditJsonButton.addEventListener("click", () => exportAuditLog("json"));
  [billingClientFilter, billingProviderFilter, billingCodeFilter, billingStartFilter, billingEndFilter, billingReadyFilter].forEach((field) => {
    field.addEventListener("input", renderBillingExport);
  });
  refreshBillingExportButton.addEventListener("click", renderBillingExport);
  exportBillingCsvButton.addEventListener("click", exportBillingCsv);
  runHealthCheckButton.addEventListener("click", runDataHealthCheck);
  exportHealthCsvButton.addEventListener("click", () => exportHealthReport("csv"));
  exportHealthJsonButton.addEventListener("click", () => exportHealthReport("json"));
  window.addEventListener("resize", renderCharts);
}

async function handleLogin(event) {
  event.preventDefault();
  loginMessage.textContent = "";
  const values = new FormData(loginForm);
  try {
    const { user } = await login(values.get("username"), values.get("password"));
    state.currentUser = user;
    loginForm.reset();
    await startAuthenticatedApp();
  } catch (error) {
    loginMessage.textContent = error.message;
  }
}

async function handleLogout() {
  await logout().catch(() => {});
  state.currentUser = null;
  state.clients = [];
  state.sessions = [];
  showLogin();
}

async function handleCreateUser(event) {
  event.preventDefault();
  newUserMessage.textContent = "";
  const values = new FormData(newUserForm);
  try {
    await createUser({
      name: values.get("name"),
      username: values.get("username"),
      role: values.get("role"),
      password: values.get("password")
    });
    newUserForm.reset();
    newUserMessage.textContent = "User created.";
    await refreshUsers(false);
    await refreshAuditLog(false);
  } catch (error) {
    newUserMessage.textContent = error.message;
  }
}

async function handleUserListChange(event) {
  const row = event.target.closest("[data-user-row]");
  if (!row || !event.target.matches("[data-user-field]")) return;
  await saveUserRow(row, false);
}

async function handleUserListClick(event) {
  const row = event.target.closest("[data-user-row]");
  if (!row) return;
  const reset = event.target.closest("[data-reset-password]");
  const save = event.target.closest("[data-save-user]");
  if (reset) {
    const password = window.prompt("Temporary password");
    if (!password) return;
    await saveUserRow(row, true, password);
  }
  if (save) await saveUserRow(row, false);
}

async function saveUserRow(row, resetPassword, password = "") {
  userManagementMessage.textContent = "";
  try {
    await updateUser(row.dataset.userRow, {
      name: row.querySelector('[data-user-field="name"]').value,
      role: row.querySelector('[data-user-field="role"]').value,
      active: row.querySelector('[data-user-field="active"]').value === "true",
      password: resetPassword ? password : ""
    });
    userManagementMessage.textContent = resetPassword ? "Password reset." : "User updated.";
    await refreshUsers(false);
    await refreshAuditLog(false);
  } catch (error) {
    userManagementMessage.textContent = error.message;
  }
}

function showLogin() {
  loginScreen.classList.remove("hidden");
  appRoot.classList.add("hidden");
}

function showApp() {
  loginScreen.classList.add("hidden");
  appRoot.classList.remove("hidden");
  currentUserLabel.textContent = `${state.currentUser?.name || "User"} (${roleLabel(state.currentUser?.role)})`;
  applyRoleAccess();
}

function setDefaultDate() {
  const today = new Date();
  const todayValue = today.toISOString().slice(0, 10);
  const sixMonthsAgo = new Date(today);
  sixMonthsAgo.setMonth(today.getMonth() - 6);
  form.elements.date.value = todayValue;
  bcbaSessionForm.elements.date.value = todayValue;
  parentTrainingForm.elements.date.value = todayValue;
  reportForm.elements.endDate.value = todayValue;
  reportForm.elements.startDate.value = sixMonthsAgo.toISOString().slice(0, 10);
  toggleRbtFeedbackSection();
}

function populateSelect(select, items, selected = "") {
  select.innerHTML = items.map((item) => (
    `<option value="${item.id}">${item.name}${item.status === "archived" ? " (archived)" : ""}</option>`
  )).join("");
  if (selected) select.value = selected;
}

function addProgramRow(programId = "", targetId = "", values = {}) {
  const node = document.querySelector("#program-template").content.cloneNode(true);
  const row = node.querySelector(".program-row");
  populateSelect(row.querySelector('[data-field="programId"]'), clientPrograms(), programId);
  syncTargetOptions(row, targetId);
  updateRowDomain(row);
  row.querySelector('[data-field="trials"]').value = values.trials ?? 10;
  row.querySelector('[data-field="correct"]').value = values.correct ?? 0;
  row.querySelector('[data-field="incorrect"]').value = values.incorrect ?? 0;
  row.querySelector('[data-field="promptLevel"]').value = values.promptLevel || "independent";
  row.querySelector('[data-field="phase"]').value = values.phase || "intervention";
  row.querySelector("[data-remove]").addEventListener("click", () => {
    row.remove();
    renderDomainTabs();
    refreshTargetAvailability();
    saveSessionDraft();
  });
  row.querySelectorAll("input, select").forEach((input) => {
    input.addEventListener("input", () => {
      updateProgramIndependence(row);
      saveSessionDraft();
    });
  });
  programList.append(row);
  updateProgramIndependence(row);
  renderDomainTabs();
  refreshTargetAvailability();
  saveSessionDraft();
}

function preloadTargetRows() {
  programList.innerHTML = "";
  clientPrograms().forEach((program) => {
    (program.targets || []).filter((target) => target.status === "active").forEach((target) => addProgramRow(program.id, target.id));
  });
}

function addFirstAvailableTargetRow(status = "active") {
  const used = selectedTargetKeys();
  const available = clientPrograms().flatMap((program) => (
    (program.targets || []).filter((target) => target.status === status).map((target) => ({ program, target }))
  )).find(({ program, target }) => !used.has(targetKey(program.id, target.id)));

  if (!available) {
    formMessage.textContent = status === "maintenance"
      ? "No maintenance targets are available to add."
      : "All active targets are already on this session.";
    return;
  }
  addProgramRow(available.program.id, available.target.id);
}

function addBehaviorRow(behaviorId = "", values = {}) {
  const node = document.querySelector("#behavior-template").content.cloneNode(true);
  const row = node.querySelector(".behavior-row");
  populateSelect(row.querySelector('[data-field="behaviorId"]'), clientBehaviors().filter((behavior) => behavior.status !== "inactive"), behaviorId);
  row.querySelector('[data-field="frequency"]').value = values.frequency ?? 0;
  row.querySelector('[data-field="duration"]').value = values.duration || "";
  row.querySelector('[data-field="intensity"]').value = values.intensity || "";
  row.querySelector('[data-field="phase"]').value = values.phase || "intervention";
  row.querySelector("[data-remove]").addEventListener("click", () => {
    row.remove();
    refreshBehaviorAvailability();
    saveSessionDraft();
  });
  row.querySelectorAll("input, select").forEach((input) => {
    input.addEventListener("input", saveSessionDraft);
  });
  behaviorList.append(row);
  refreshBehaviorAvailability();
  saveSessionDraft();
}

function preloadBehaviorRows() {
  behaviorList.innerHTML = "";
  clientBehaviors().filter((behavior) => behavior.status !== "inactive").forEach((behavior) => addBehaviorRow(behavior.id));
}

function addFirstAvailableBehaviorRow() {
  const used = selectedBehaviorKeys();
  const available = clientBehaviors().filter((behavior) => behavior.status !== "inactive").find((behavior) => !used.has(behavior.id));
  if (!available) {
    formMessage.textContent = "All active behaviors are already on this session.";
    return;
  }
  addBehaviorRow(available.id);
}

function addParentGoalRow(goal = {}) {
  const node = document.querySelector("#parent-goal-template").content.cloneNode(true);
  const row = node.querySelector(".parent-goal-row");
  row.querySelector('[data-field="goalName"]').value = goal.goalName || "";
  row.querySelector('[data-field="targetName"]').value = goal.targetName || "";
  row.querySelector('[data-field="opportunities"]').value = goal.opportunities ?? 5;
  row.querySelector('[data-field="independent"]').value = goal.independent ?? 0;
  row.querySelector('[data-field="prompted"]').value = goal.prompted ?? 0;
  row.querySelector('[data-field="promptLevel"]').value = goal.promptLevel || "verbal";
  row.querySelector("[data-remove]").addEventListener("click", () => row.remove());
  row.querySelectorAll("input, select").forEach((input) => {
    input.addEventListener("input", () => updateParentGoalScore(row));
  });
  parentGoalList.append(row);
  updateParentGoalScore(row);
}

function preloadParentRows() {
  parentGoalList.innerHTML = "";
  const goals = currentParentTrainingGoals();
  if (goals.length) {
    goals.forEach((goal) => addParentGoalRow(goal));
    return;
  }
  addParentGoalRow();
}

function addFadePlanRow(rowData = {}) {
  const node = document.querySelector("#fade-plan-row-template").content.cloneNode(true);
  const row = node.querySelector(".fade-plan-row");
  Object.entries({
    phase: rowData.phase || "",
    actionStep: rowData.actionStep || "",
    criteria: rowData.criteria || "",
    timeFrame: rowData.timeFrame || "",
    bcbaReduction: rowData.bcbaReduction || "",
    rbtReduction: rowData.rbtReduction || ""
  }).forEach(([field, value]) => {
    row.querySelector(`[data-field="${field}"]`).value = value;
  });
  row.querySelector("[data-remove]").addEventListener("click", () => row.remove());
  fadePlanRows.append(row);
}

function preloadFadePlanRows() {
  fadePlanRows.innerHTML = "";
  defaultFadePlanRows().forEach((row) => addFadePlanRow(row));
}

function addServiceHourRow(rowData = {}) {
  const node = document.querySelector("#service-hour-row-template").content.cloneNode(true);
  const row = node.querySelector(".service-hours-row");
  Object.entries({
    serviceCode: rowData.serviceCode || "",
    provider: rowData.provider || "",
    hours: rowData.hours || "",
    setting: rowData.setting || ""
  }).forEach(([field, value]) => {
    row.querySelector(`[data-field="${field}"]`).value = value;
  });
  row.querySelector("[data-remove]").addEventListener("click", () => row.remove());
  serviceHourRows.append(row);
}

function preloadServiceHourRows() {
  serviceHourRows.innerHTML = "";
  defaultServiceHourRows().forEach((row) => addServiceHourRow(row));
}

function updateParentGoalScore(row) {
  const opportunities = Number(row.querySelector('[data-field="opportunities"]').value || 0);
  const independent = Number(row.querySelector('[data-field="independent"]').value || 0);
  const prompted = Number(row.querySelector('[data-field="prompted"]').value || 0);
  const denominator = opportunities || independent + prompted;
  const score = denominator > 0 ? Math.round((independent / denominator) * 100) : 0;
  row.querySelector("[data-parent-goal-score]").textContent = `${score}%`;
}

function updateProgramIndependence(row) {
  const correct = Number(row.querySelector('[data-field="correct"]').value || 0);
  const incorrect = Number(row.querySelector('[data-field="incorrect"]').value || 0);
  const trials = Number(row.querySelector('[data-field="trials"]').value || 0);
  const denominator = trials || correct + incorrect;
  const independence = denominator > 0 ? Math.round((correct / denominator) * 100) : 0;
  row.querySelector("[data-independence]").textContent = `${independence}%`;
}

async function handleSubmit(event) {
  event.preventDefault();
  formMessage.textContent = "";

  try {
    const payload = buildSessionPayload();
    payload.soapNote = generateSoapNote(payload, lookups());
    const saved = await createSession(payload);
    state.selectedSessionId = saved.id;
    clearSessionDraft(payload.clientId);
    formMessage.textContent = "Session saved. Graphs and SOAP note updated.";
    await refreshData();
    resetRows();
    render();
  } catch (error) {
    formMessage.textContent = error.message;
  }
}

async function handleClientProfileSubmit(event) {
  event.preventDefault();
  clientProfileMessage.textContent = "";
  const client = currentClient();
  if (!client) return;

  try {
    const updated = await updateClientProfile(client.id, readClientProfileForm());
    const index = state.clients.findIndex((item) => item.id === updated.id);
    if (index >= 0) state.clients[index] = updated;
    clientSelect.value = updated.id;
    clientProfileMessage.textContent = "Client profile saved.";
    render();
  } catch (error) {
    clientProfileMessage.textContent = error.message;
  }
}

async function handleNewClientSubmit(event) {
  event.preventDefault();
  newClientMessage.textContent = "";
  const values = new FormData(newClientForm);

  try {
    const client = await createClient({
      name: values.get("name"),
      dob: values.get("dob"),
      defaultSetting: values.get("defaultSetting"),
      diagnosis: values.get("diagnosis")
    });
    newClientForm.reset();
    await refreshData();
    clientSelect.value = client.id;
    state.selectedSessionId = null;
    state.activeDomain = "";
    state.activePlanDomain = "";
    resetRows();
    render();
    newClientMessage.textContent = "Client created. Add programs and behaviors under Treatment plan.";
  } catch (error) {
    newClientMessage.textContent = error.message;
  }
}

async function handleClientDocumentSubmit(event) {
  event.preventDefault();
  clientDocumentMessage.textContent = "";
  const client = currentClient();
  const file = clientDocumentForm.elements.documentFile.files[0];
  if (!client || !file) return;

  try {
    const dataUrl = await readFileAsDataUrl(file);
    await uploadClientDocument(client.id, {
      documentType: clientDocumentForm.elements.documentType.value,
      documentDate: clientDocumentForm.elements.documentDate.value,
      notes: clientDocumentForm.elements.documentNotes.value,
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      dataUrl
    });
    clientDocumentForm.reset();
    clientDocumentMessage.textContent = "Document uploaded.";
    await refreshData();
    render();
  } catch (error) {
    clientDocumentMessage.textContent = error.message;
  }
}

async function handleClientDocumentClick(event) {
  const remove = event.target.closest("[data-delete-document]");
  if (!remove) return;
  const client = currentClient();
  const document = client?.profile?.documents?.find((item) => item.id === remove.dataset.deleteDocument);
  if (!client || !document) return;
  if (!window.confirm(`Delete ${document.fileName || "this document"}?`)) return;

  try {
    await deleteClientDocument(client.id, document.id);
    clientDocumentMessage.textContent = "Document deleted.";
    await refreshData();
    render();
  } catch (error) {
    clientDocumentMessage.textContent = error.message;
  }
}

function handleExportClientPackage() {
  const client = currentClient();
  if (!client) {
    clientProfileMessage.textContent = "Select a client before exporting.";
    return;
  }
  const reportDocument = reportPreview.querySelector(".report-document");
  const payload = {
    exportedAt: new Date().toISOString(),
    app: "ABA Practice MVP",
    client: structuredClone(client),
    treatmentPlan: {
      domains: client.domains || [],
      programs: client.programs || [],
      behaviors: client.behaviors || [],
      planChangeLog: client.planChangeLog || [],
      rbtPerformanceAreas: client.rbtPerformanceAreas || []
    },
    sessions: currentSessions(),
    notes: {
      note97155: client.note97155 || "",
      soapNotes: currentSessions().map((session) => ({
        sessionId: session.id,
        serviceType: session.serviceType || "97153",
        date: session.date,
        finalized: Boolean(session.finalized),
        soapNote: session.soapNote || ""
      }))
    },
    documents: client.profile?.documents || [],
    generatedFunderReport: reportDocument ? {
      text: reportDocument.innerText,
      html: reportDocument.outerHTML
    } : null
  };
  downloadFile(
    `${safeFilename(client.name)}-client-package-${new Date().toISOString().slice(0, 10)}.json`,
    JSON.stringify(payload, null, 2),
    "application/json"
  );
  createAuditEvent({
    action: "client-package-exported",
    clientId: client.id,
    details: { sessions: currentSessions().length, documents: (client.profile?.documents || []).length }
  }).then(() => refreshAuditLog(false)).catch(() => {});
  clientProfileMessage.textContent = "Client package exported.";
}

async function handleDownloadPracticeBackup() {
  clientProfileMessage.textContent = "Preparing practice backup...";
  try {
    const backup = await getPracticeBackup();
    downloadFile(
      `aba-practice-backup-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(backup, null, 2),
      "application/json"
    );
    await refreshAuditLog(false);
    clientProfileMessage.textContent = "Practice backup downloaded.";
  } catch (error) {
    clientProfileMessage.textContent = error.message;
  }
}

function handleRestorePracticeBackup() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json,.json";
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const backup = JSON.parse(await readFileAsText(file));
      validateBackupFile(backup);
      const clients = backup.data.clients.length;
      const sessions = backup.data.sessions.length;
      const confirmed = window.confirm(
        `Restore ${file.name}?\n\nThis will replace current clients, sessions, treatment plans, notes, reports, and audit entries with the backup data.\n\nCurrent login users and passwords will be preserved. Uploaded file contents are not restored by this browser backup.\n\nBackup contains ${clients} client(s) and ${sessions} session(s).`
      );
      if (!confirmed) {
        clientProfileMessage.textContent = "Restore canceled.";
        return;
      }
      clientProfileMessage.textContent = "Restoring practice backup...";
      await restorePracticeBackup(backup);
      await refreshData();
      if (state.clients.length && !state.clients.some((client) => client.id === clientSelect.value)) clientSelect.value = state.clients[0].id;
      await refreshAuditLog(false);
      render();
      clientProfileMessage.textContent = "Practice backup restored.";
    } catch (error) {
      clientProfileMessage.textContent = error.message || "Could not restore backup.";
    }
  });
  input.click();
}

function validateBackupFile(backup) {
  if (!backup || backup.app !== "ABA Practice MVP" || !backup.data) {
    throw new Error("That file is not a valid ABA Practice MVP backup.");
  }
  if (!Array.isArray(backup.data.clients) || !Array.isArray(backup.data.sessions)) {
    throw new Error("Backup must include clients and sessions.");
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result));
    reader.addEventListener("error", () => reject(new Error("Could not read the selected file.")));
    reader.readAsDataURL(file);
  });
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result));
    reader.addEventListener("error", () => reject(new Error("Could not read the selected file.")));
    reader.readAsText(file);
  });
}

function readClientProfileForm() {
  const values = new FormData(clientProfileForm);
  return {
    name: values.get("name"),
    dob: values.get("dob"),
    defaultSetting: values.get("defaultSetting"),
    status: values.get("status"),
    caregivers: values.get("caregivers"),
    school: values.get("school"),
    diagnosis: values.get("diagnosis"),
    communication: values.get("communication"),
    profileNotes: values.get("profileNotes"),
    authorizationNumber: values.get("authorizationNumber"),
    funder: values.get("funder"),
    authorizationStart: values.get("authorizationStart"),
    authorizationEnd: values.get("authorizationEnd"),
    authorizationNotes: values.get("authorizationNotes"),
    auth97153Hours: values.get("auth97153Hours"),
    auth97153Units: values.get("auth97153Units"),
    auth97155Hours: values.get("auth97155Hours"),
    auth97155Units: values.get("auth97155Units"),
    auth97156Hours: values.get("auth97156Hours"),
    auth97156Units: values.get("auth97156Units"),
    auth97151Hours: values.get("auth97151Hours"),
    auth97151Units: values.get("auth97151Units"),
    assessmentType: values.get("assessmentType"),
    assessmentDate: values.get("assessmentDate"),
    assessmentConductedBy: values.get("assessmentConductedBy"),
    assessmentFileName: clientProfileForm.elements.assessmentFile.files[0]?.name || currentClient()?.profile?.assessment?.fileName || "",
    assessmentNotes: values.get("assessmentNotes"),
    intakeInterview: structuredClone(currentClient()?.profile?.intakeInterview || {}),
    parentTrainingGoals: structuredClone(currentClient()?.profile?.parentTrainingGoals || [])
  };
}

function readIntakeInterviewForm() {
  const values = new FormData(intakeForm);
  return {
    interviewDate: values.get("interviewDate"),
    interviewedBy: values.get("interviewedBy"),
    autismDiagnosis: values.get("autismDiagnosis"),
    diagnosisSourceDate: values.get("diagnosisSourceDate"),
    priorEvaluations: values.get("priorEvaluations"),
    recentCdeDate: values.get("recentCdeDate"),
    vbMappLevel: values.get("vbMappLevel"),
    caregiversPresent: values.get("caregiversPresent"),
    householdMembers: values.get("householdMembers"),
    primaryCaregivers: values.get("primaryCaregivers"),
    pregnancyBirthComplications: values.get("pregnancyBirthComplications"),
    milestones: values.get("milestones"),
    earlyDevelopmentNotes: values.get("earlyDevelopmentNotes"),
    communicationMethod: values.get("communicationMethod"),
    strengths: values.get("strengths"),
    concerningBehaviors: values.get("concerningBehaviors"),
    behaviorDescription: values.get("behaviorDescription"),
    behaviorWhen: values.get("behaviorWhen"),
    behaviorTriggers: values.get("behaviorTriggers"),
    behaviorAfter: values.get("behaviorAfter"),
    behaviorResponse: values.get("behaviorResponse"),
    topPriorityBehavior: values.get("topPriorityBehavior"),
    currentServices: values.get("currentServices"),
    serviceFrequency: values.get("serviceFrequency"),
    serviceProgress: values.get("serviceProgress"),
    schoolAttendance: values.get("schoolAttendance"),
    schoolSetting: values.get("schoolSetting"),
    teacherConcerns: values.get("teacherConcerns"),
    peerInteraction: values.get("peerInteraction"),
    schoolChallenges: values.get("schoolChallenges"),
    previousAba: values.get("previousAba"),
    previousAbaDetails: values.get("previousAbaDetails"),
    previousAbaFocus: values.get("previousAbaFocus"),
    previousAbaEnded: values.get("previousAbaEnded"),
    medicalHistory: values.get("medicalHistory"),
    seizuresAllergiesMedications: values.get("seizuresAllergiesMedications"),
    sleepQuality: values.get("sleepQuality"),
    feedingConcerns: values.get("feedingConcerns"),
    painTolerance: values.get("painTolerance"),
    level1Manding: values.get("level1Manding"),
    level1Listener: values.get("level1Listener"),
    level1Imitation: values.get("level1Imitation"),
    level1Play: values.get("level1Play"),
    level1Social: values.get("level1Social"),
    level2Manding: values.get("level2Manding"),
    level2Tacting: values.get("level2Tacting"),
    level2Listener: values.get("level2Listener"),
    level2Intraverbals: values.get("level2Intraverbals"),
    level2Play: values.get("level2Play"),
    level2Social: values.get("level2Social"),
    level3Manding: values.get("level3Manding"),
    level3Tacting: values.get("level3Tacting"),
    level3Intraverbals: values.get("level3Intraverbals"),
    level3Listener: values.get("level3Listener"),
    level3PlaySocial: values.get("level3PlaySocial"),
    level3SchoolReadiness: values.get("level3SchoolReadiness"),
    preferredInterests: values.get("preferredInterests"),
    interviewNotes: values.get("interviewNotes")
  };
}

function intakeDraftStorageKey(clientId) {
  return `aba-intake-draft:${clientId || "unknown"}`;
}

function intakeDraftPayload() {
  return intakeDraftFields.reduce((draft, field) => {
    draft[field] = intakeForm.elements[field]?.value || "";
    return draft;
  }, {});
}

function saveIntakeDraft() {
  const clientId = intakeClientSelect.value || currentClient()?.id;
  if (!clientId || !intakeForm) return;
  window.localStorage.setItem(intakeDraftStorageKey(clientId), JSON.stringify(intakeDraftPayload()));
}

function loadIntakeDraft(clientId) {
  if (!clientId) return null;
  try {
    const raw = window.localStorage.getItem(intakeDraftStorageKey(clientId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function clearIntakeDraft(clientId) {
  if (!clientId) return;
  window.localStorage.removeItem(intakeDraftStorageKey(clientId));
}

function sessionDraftStorageKey(clientId) {
  return `aba-session-draft:${clientId || "unknown"}`;
}

function sessionDraftPayload() {
  const fields = sessionDraftFields.reduce((draft, field) => {
    draft[field] = form.elements[field]?.value || "";
    return draft;
  }, {});
  return {
    fields,
    programs: [...programList.querySelectorAll(".program-row")].map((row) => readDataRow(row)),
    behaviors: [...behaviorList.querySelectorAll(".behavior-row")].map((row) => readDataRow(row))
  };
}

function saveSessionDraft() {
  const clientId = clientSelect.value || currentClient()?.id;
  if (!clientId || !form) return;
  window.localStorage.setItem(sessionDraftStorageKey(clientId), JSON.stringify(sessionDraftPayload()));
}

function loadSessionDraft(clientId) {
  if (!clientId) return null;
  try {
    const raw = window.localStorage.getItem(sessionDraftStorageKey(clientId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function clearSessionDraft(clientId) {
  if (!clientId) return;
  window.localStorage.removeItem(sessionDraftStorageKey(clientId));
}

function restoreSessionDraft() {
  const client = currentClient();
  if (!client || !form) return;
  const draft = loadSessionDraft(client.id);
  if (!draft) return;
  Object.entries(draft.fields || {}).forEach(([field, value]) => {
    if (form.elements[field]) form.elements[field].value = value || "";
  });
  if (Array.isArray(draft.programs)) {
    programList.innerHTML = "";
    draft.programs.forEach((row) => addProgramRow(row.programId, row.targetId, row));
  }
  if (Array.isArray(draft.behaviors)) {
    behaviorList.innerHTML = "";
    draft.behaviors.forEach((row) => addBehaviorRow(row.behaviorId, row));
  }
  formMessage.textContent = "Unsaved session draft restored.";
}

function syncClientProfileForm() {
  const client = currentClient();
  clientProfileForm.querySelectorAll("input, select, textarea, button").forEach((field) => {
    field.disabled = !client;
  });
  if (!client) return;
  managementClientSelect.value = client.id;
  clientProfileForm.elements.status.value = client.status === "archived" ? "archived" : "active";
  clientProfileForm.elements.name.value = client.name || "";
  clientProfileForm.elements.dob.value = client.dob || "";
  clientProfileForm.elements.defaultSetting.value = client.defaultSetting || "";
  clientProfileForm.elements.caregivers.value = client.profile?.caregivers || client.caregivers || "";
  clientProfileForm.elements.school.value = client.profile?.school || client.school || "";
  clientProfileForm.elements.diagnosis.value = client.profile?.diagnosis || client.diagnosis || "Autism Spectrum Disorder";
  clientProfileForm.elements.communication.value = client.profile?.communication || "";
  clientProfileForm.elements.profileNotes.value = client.profile?.notes || client.profileNotes || "";
  clientProfileForm.elements.authorizationNumber.value = client.profile?.authorization?.number || "";
  clientProfileForm.elements.funder.value = client.profile?.authorization?.funder || "";
  clientProfileForm.elements.authorizationStart.value = client.profile?.authorization?.startDate || "";
  clientProfileForm.elements.authorizationEnd.value = client.profile?.authorization?.endDate || "";
  clientProfileForm.elements.authorizationNotes.value = client.profile?.authorization?.notes || "";
  clientProfileForm.elements.auth97153Hours.value = client.profile?.authorization?.services?.["97153"]?.hours || "";
  clientProfileForm.elements.auth97153Units.value = client.profile?.authorization?.services?.["97153"]?.units || "";
  clientProfileForm.elements.auth97155Hours.value = client.profile?.authorization?.services?.["97155"]?.hours || "";
  clientProfileForm.elements.auth97155Units.value = client.profile?.authorization?.services?.["97155"]?.units || "";
  clientProfileForm.elements.auth97156Hours.value = client.profile?.authorization?.services?.["97156"]?.hours || "";
  clientProfileForm.elements.auth97156Units.value = client.profile?.authorization?.services?.["97156"]?.units || "";
  clientProfileForm.elements.auth97151Hours.value = client.profile?.authorization?.services?.["97151"]?.hours || "";
  clientProfileForm.elements.auth97151Units.value = client.profile?.authorization?.services?.["97151"]?.units || "";
  clientProfileForm.elements.assessmentType.value = client.profile?.assessment?.type || "";
  clientProfileForm.elements.assessmentDate.value = client.profile?.assessment?.date || "";
  clientProfileForm.elements.assessmentConductedBy.value = client.profile?.assessment?.conductedBy || "";
  clientProfileForm.elements.assessmentNotes.value = client.profile?.assessment?.notes || "";
  clientProfileForm.elements.assessmentFile.value = "";
}

function syncIntakeInterviewForm() {
  const client = currentClient();
  if (!intakeForm) return;
  intakeForm.querySelectorAll("input, select, textarea, button").forEach((field) => {
    field.disabled = !client;
  });
  if (!client) {
    if (intakeSummary) intakeSummary.innerHTML = "";
    return;
  }
  intakeClientSelect.value = client.id;
  const interview = client.profile?.intakeInterview || {};
  Object.entries(interview).forEach(([key, value]) => {
    if (intakeForm.elements[key]) intakeForm.elements[key].value = value || "";
  });
  Object.keys(readIntakeInterviewForm()).forEach((key) => {
    if (intakeForm.elements[key] && !(key in interview)) intakeForm.elements[key].value = "";
  });
  const draft = loadIntakeDraft(client.id);
  if (draft) {
    Object.entries(draft).forEach(([key, value]) => {
      if (intakeForm.elements[key]) intakeForm.elements[key].value = value || "";
    });
    intakeMessage.textContent = "Unsaved intake draft restored.";
  }
  updateVbMappVisibility();
  if (intakeSummary) {
    intakeSummary.innerHTML = `
      <div><strong>${client.name}</strong><span>Client</span></div>
      <div><strong>${interview.interviewDate ? formatDate(interview.interviewDate) : "Not saved"}</strong><span>Interview date</span></div>
      <div><strong>${interview.interviewedBy || "Not entered"}</strong><span>Interviewed by</span></div>
    `;
  }
}

function updateVbMappVisibility() {
  const selectedLevel = Number(intakeVbMappLevelSelect?.value || 0);
  document.querySelectorAll("[data-vbmapp-section]").forEach((section) => {
    const level = Number(section.dataset.vbmappSection || 0);
    const shouldHide = selectedLevel > 0 && level > selectedLevel;
    section.classList.toggle("hidden", shouldHide);
    section.hidden = shouldHide;
  });
}

async function handleIntakeSubmit(event) {
  event.preventDefault();
  intakeMessage.textContent = "";
  const client = currentClient();
  if (!client) return;
  try {
    const updated = await updateClientProfile(client.id, {
      ...currentClientProfilePayload(client),
      intakeInterview: readIntakeInterviewForm()
    });
    replaceClient(updated);
    clearIntakeDraft(client.id);
    applyIntakeInterviewToReport(true);
    render();
    intakeMessage.textContent = "Intake interview saved and report narrative refreshed.";
  } catch (error) {
    intakeMessage.textContent = error.message;
  }
}

async function handleParentTrainingSubmit(event) {
  event.preventDefault();
  parentMessage.textContent = "";

  try {
    const payload = buildParentTrainingPayload();
    const client = currentClient();
    if (client) {
      const updatedClient = await updateClientProfile(client.id, {
        ...currentClientProfilePayload(client),
        parentTrainingGoals: payload.parentGoals.map((goal) => ({
          goalName: goal.goalName,
          targetName: goal.targetName,
          opportunities: goal.opportunities,
          independent: goal.independent,
          prompted: goal.prompted,
          promptLevel: goal.promptLevel
        }))
      });
      replaceClient(updatedClient);
    }
    payload.soapNote = generateParentTrainingNote(payload, lookups());
    const saved = await createSession(payload);
    state.selectedSessionId = saved.id;
    parentMessage.textContent = "97156 SOAP note generated and parent training session saved.";
    await refreshData();
    preloadParentRows();
    render();
  } catch (error) {
    parentMessage.textContent = error.message;
  }
}

function buildParentTrainingPayload() {
  const values = new FormData(parentTrainingForm);
  const parentGoals = [...parentGoalList.querySelectorAll(".parent-goal-row")].map((row) => normalizeParentGoal(readDataRow(row)));
  if (!parentGoals.length) throw new Error("At least one parent training goal is required.");
  return {
    clientId: clientSelect.value,
    date: values.get("date"),
    therapist: values.get("bcba"),
    startTime: values.get("startTime"),
    endTime: values.get("endTime"),
    setting: values.get("setting"),
    caregiverPresent: true,
    caregiverTraining: true,
    affect: "engaged",
    transitions: "typical",
    barriers: "none",
    barrierText: "",
    notes: values.get("notes"),
    serviceType: "parent-training",
    parentTraining: {
      caregiverName: values.get("caregiverName"),
      trainingFocus: values.get("trainingFocus")
    },
    parentGoals,
    providerSignature: values.get("providerSignature"),
    providerCredential: values.get("providerCredential"),
    programs: [],
    behaviors: []
  };
}

function normalizeParentGoal(goal) {
  const opportunities = Number(goal.opportunities || 0);
  const independent = Number(goal.independent || 0);
  const prompted = Number(goal.prompted || 0);
  const denominator = opportunities || independent + prompted;
  return {
    goalName: goal.goalName?.trim() || "Parent training goal",
    targetName: goal.targetName?.trim() || "Caregiver target",
    opportunities,
    independent,
    prompted,
    promptLevel: goal.promptLevel || "verbal",
    fidelity: denominator > 0 ? Math.round((independent / denominator) * 100) : 0
  };
}

function generateParentTrainingNote(session, lookups) {
  const clientName = lookups.clientName(session.clientId);
  const parentGoals = session.parentGoals || [];
  const goalText = parentGoals.length
    ? parentGoals.map((goal) => `${goal.goalName} - ${goal.targetName}: ${goal.fidelity}% caregiver fidelity (${goal.independent}/${goal.opportunities || goal.independent + goal.prompted} independent), prompt level ${goal.promptLevel}`).join("; ")
    : "No parent training goal data were collected.";
  const averageFidelity = parentGoals.length
    ? Math.round(parentGoals.reduce((sum, goal) => sum + Number(goal.fidelity || 0), 0) / parentGoals.length)
    : 0;
  return [
    `S: ${session.therapist} completed a parent training session for ${clientName} on ${formatDate(session.date)} from ${session.startTime} to ${session.endTime} in the ${session.setting} setting. Caregiver trained: ${session.parentTraining?.caregiverName || "caregiver"}. Training focus was ${session.parentTraining?.trainingFocus || "caregiver training"}.`,
    "",
    `O: Parent training goal data: ${goalText}.${session.notes ? ` Session note: ${session.notes}` : ""}`,
    "",
    `A: Caregiver training was completed with direct BCBA coaching. Average caregiver fidelity during the session was ${averageFidelity}%. Parent training goals should be reviewed separately from client skill-acquisition programming.`,
    "",
    `P: Continue caregiver coaching on ${session.parentTraining?.trainingFocus || "current treatment goals"}. Continue updating goals and targets as caregiver performance, client progress, and behavior data indicate.`,
    "",
    signatureBlock(session.providerSignature, session.providerCredential, session.date)
  ].join("\n");
}

function buildSessionPayload() {
  const values = new FormData(form);
  const targets = [...programList.querySelectorAll(".program-row")].map((row) => normalizeTarget(readDataRow(row)));
  const behaviors = [...behaviorList.querySelectorAll(".behavior-row")].map((row) => normalizeBehavior(readDataRow(row)));
  const duplicates = duplicateTargetNames(targets);
  if (duplicates.length) {
    throw new Error(`Each target can only appear once per session. Remove duplicate: ${duplicates.join(", ")}.`);
  }
  const duplicateBehaviors = duplicateBehaviorNames(behaviors);
  if (duplicateBehaviors.length) {
    throw new Error(`Each behavior can only appear once per session. Remove duplicate: ${duplicateBehaviors.join(", ")}.`);
  }
  return {
    clientId: values.get("clientId"),
    date: values.get("date"),
    therapist: values.get("therapist"),
    startTime: values.get("startTime"),
    endTime: values.get("endTime"),
    setting: values.get("setting"),
    caregiverPresent: values.get("caregiverPresent") === "true",
    caregiverTraining: values.get("caregiverTraining") === "true",
    affect: values.get("affect"),
    transitions: values.get("transitions"),
    barriers: values.get("barriers"),
    barrierText: values.get("barrierText"),
    notes: values.get("notes"),
    providerSignature: values.get("providerSignature"),
    providerCredential: values.get("providerCredential"),
    programs: groupTargetsByProgram(targets),
    behaviors
  };
}

function readDataRow(row) {
  return [...row.querySelectorAll("[data-field]")].reduce((data, field) => {
    data[field.dataset.field] = field.value;
    return data;
  }, {});
}

function normalizeTarget(target) {
  const trials = Number(target.trials || 0);
  const correct = Number(target.correct || 0);
  const incorrect = Number(target.incorrect || 0);
  const denominator = trials || correct + incorrect;
  return {
    programId: target.programId,
    targetId: target.targetId,
    trials,
    correct,
    incorrect,
    promptLevel: target.promptLevel,
    phase: target.phase === "baseline" ? "baseline" : "intervention",
    independence: denominator > 0 ? Math.round((correct / denominator) * 100) : 0
  };
}

function groupTargetsByProgram(targets) {
  return targets.reduce((programs, target) => {
    let program = programs.find((item) => item.programId === target.programId);
    if (!program) {
      program = { programId: target.programId, targets: [] };
      programs.push(program);
    }
    program.targets.push({
      targetId: target.targetId,
      trials: target.trials,
      correct: target.correct,
      incorrect: target.incorrect,
      promptLevel: target.promptLevel,
      phase: target.phase,
      independence: target.independence
    });
    return programs;
  }, []);
}

function normalizeBehavior(behavior) {
  return {
    behaviorId: behavior.behaviorId,
    frequency: Number(behavior.frequency || 0),
    duration: behavior.duration || "",
    intensity: behavior.intensity || "",
    phase: behavior.phase === "baseline" ? "baseline" : "intervention"
  };
}

function resetRows() {
  preloadTargetRows();
  preloadBehaviorRows();
  preloadParentRows();
}

function render() {
  populateSelect(clientSelect, state.clients, clientSelect.value || state.clients[0]?.id);
  populateSelect(managementClientSelect, state.clients, clientSelect.value || state.clients[0]?.id);
  populateSelect(bcbaClientSelect, state.clients, clientSelect.value || state.clients[0]?.id);
  populateSelect(parentClientSelect, state.clients, clientSelect.value || state.clients[0]?.id);
  populateSelect(intakeClientSelect, state.clients, clientSelect.value || state.clients[0]?.id);
  populateDomainSelect(addProgramForm.elements.programDomain, addProgramForm.elements.programDomain.value || clientDomains()[0]);
  syncSettingFromClient();
  restoreSessionDraft();
  syncBcbaSessionDefaults();
  syncParentTrainingDefaults();
  syncClientProfileForm();
  syncIntakeInterviewForm();
  renderClientManagementSummary();
  renderClientDocuments();
  renderSummary();
  renderSoapSummary();
  renderDomainTabs();
  renderGraphsSummary();
  renderReportSummary();
  renderPlanReview();
  renderParentSummary();
  renderRbtFidelityRows();
  render97155Note();
  renderHistory();
  renderCharts();
  renderNote();
  renderAuditFilters();
  renderAuditLog();
  renderDataHealth();
  renderUsers();
}

function syncBcbaSessionDefaults() {
  const client = currentClient();
  bcbaSessionForm.elements.clientId.value = client?.id || "";
  if (client && !bcbaSessionForm.elements.setting.value) {
    bcbaSessionForm.elements.setting.value = client.defaultSetting;
  }
}

function syncParentTrainingDefaults() {
  const client = currentClient();
  parentTrainingForm.elements.clientId.value = client?.id || "";
  if (client && !parentTrainingForm.elements.setting.value) {
    parentTrainingForm.elements.setting.value = client.defaultSetting;
  }
}

function currentParentTrainingGoals() {
  return structuredClone(currentClient()?.profile?.parentTrainingGoals || []);
}

function switchView(view) {
  if (!allowedViews().includes(view)) {
    view = allowedViews()[0] || "session";
  }
  document.querySelectorAll("[data-view-button]").forEach((button) => {
    button.classList.toggle("active", button.dataset.viewButton === view);
  });
  document.querySelectorAll("[data-view-panel]").forEach((panel) => {
    panel.classList.toggle("hidden", panel.dataset.viewPanel !== view);
  });
  if (view === "graphs") renderCharts();
  if (view === "report" && reportPreview.innerHTML) drawFunderReportCharts(filteredReportSessions());
  if (view === "billing") renderBillingExport();
  if (view === "audit") refreshAuditLog(false);
  if (view === "health") runDataHealthCheck();
  if (view === "users") refreshUsers(false);
}

function applyRoleAccess() {
  const views = allowedViews();
  document.querySelectorAll("[data-view-button]").forEach((button) => {
    button.classList.toggle("hidden", !views.includes(button.dataset.viewButton));
  });
  document.querySelectorAll("[data-view-panel]").forEach((panel) => {
    if (!views.includes(panel.dataset.viewPanel)) panel.classList.add("hidden");
  });
  const active = document.querySelector("[data-view-button].active:not(.hidden)");
  switchView(active?.dataset.viewButton || views[0] || "session");
}

function allowedViews() {
  return roleViews[state.currentUser?.role] || [];
}

function canEditAdmin() {
  return state.currentUser?.role === "admin";
}

function canEditClinical() {
  return ["admin", "bcba"].includes(state.currentUser?.role);
}

function roleLabel(role) {
  return {
    admin: "Admin",
    bcba: "BCBA",
    rbt: "RBT",
    "read-only": "Read-only"
  }[role] || "User";
}

function syncSettingFromClient() {
  const client = currentClient();
  if (client && !form.elements.setting.value) form.elements.setting.value = client.defaultSetting;
}

function renderSummary() {
  const client = currentClient();
  const sessions = currentSessions();
  const activeTargets = clientPrograms().flatMap((program) => program.targets || []).filter((target) => target.status === "active").length;
  const maintenanceTargets = clientPrograms().flatMap((program) => program.targets || []).filter((target) => target.status === "maintenance").length;
  document.querySelector("#client-summary").innerHTML = client
    ? `
      <div><strong>${client.name}</strong><span>Client</span></div>
      <div><strong>${sessions.length}</strong><span>Sessions</span></div>
      <div><strong>${activeTargets} / ${maintenanceTargets}</strong><span>Active / maintenance targets</span></div>
    `
    : "<p>No client selected.</p>";
}

function renderGraphsSummary() {
  const client = currentClient();
  const sessions = currentSessions();
  const targetCount = clientPrograms().flatMap((program) => program.targets || []).length;
  graphsClientSummary.innerHTML = client
    ? `
      <div><strong>${client.name}</strong><span>Client</span></div>
      <div><strong>${sessions.length}</strong><span>Sessions graphed</span></div>
      <div><strong>${targetCount}</strong><span>Total targets</span></div>
    `
    : "";
}

function renderBillingExport() {
  if (!billingClientFilter || !billingTable || !billingSummary) return;
  const clientValue = billingClientFilter.value;
  billingClientFilter.innerHTML = '<option value="">All clients</option>' + state.clients.map((client) => (
    `<option value="${escapeHtml(client.id)}">${escapeHtml(client.name)}</option>`
  )).join("");
  billingClientFilter.value = clientValue;

  const rows = filteredBillingSessions();
  const readyRows = rows.filter((row) => row.ready);
  const totalUnits = rows.reduce((sum, row) => sum + row.units, 0);
  billingSummary.innerHTML = `
    <div><strong>${rows.length}</strong><span>Sessions</span></div>
    <div><strong>${readyRows.length}</strong><span>Billing-ready</span></div>
    <div><strong>${totalUnits}</strong><span>Total units</span></div>
  `;
  if (billingMessage) {
    billingMessage.textContent = rows.length
      ? `${readyRows.length} billing-ready session${readyRows.length === 1 ? "" : "s"} in the current filter.`
      : "No sessions match the current billing filters.";
  }
  if (!rows.length) {
    billingTable.innerHTML = '<p class="muted">No billing rows match the current filter.</p>';
    return;
  }
  billingTable.innerHTML = `
    <div class="report-table-wrap">
      <table class="fade-plan-table audit-table">
        <thead>
          <tr>
            <th>Client</th>
            <th>Date</th>
            <th>Code</th>
            <th>Provider</th>
            <th>Start</th>
            <th>End</th>
            <th>Minutes</th>
            <th>Units</th>
            <th>Setting</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => `
            <tr>
              <td>${escapeHtml(row.clientName)}</td>
              <td>${escapeHtml(formatDate(row.date))}</td>
              <td>${escapeHtml(row.code)}</td>
              <td>${escapeHtml(row.provider)}</td>
              <td>${escapeHtml(row.startTime)}</td>
              <td>${escapeHtml(row.endTime)}</td>
              <td>${escapeHtml(String(row.minutes))}</td>
              <td>${escapeHtml(String(row.units))}</td>
              <td>${escapeHtml(row.setting)}</td>
              <td>${escapeHtml(row.ready ? "Ready" : row.statusLabel)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderParentSummary() {
  const client = currentClient();
  const activeTargets = clientPrograms().flatMap((program) => program.targets || []).filter((target) => target.status === "active").length;
  const activeBehaviors = clientBehaviors().filter((behavior) => behavior.status !== "inactive").length;
  parentClientSummary.innerHTML = client
    ? `
      <div><strong>${client.name}</strong><span>Client</span></div>
      <div><strong>${activeTargets}</strong><span>Active targets</span></div>
      <div><strong>${activeBehaviors}</strong><span>Behaviors tracked</span></div>
    `
    : "";
}

function renderClientManagementSummary() {
  const activeClients = state.clients.filter((client) => client.status !== "archived").length;
  const archivedClients = state.clients.filter((client) => client.status === "archived").length;
  const client = currentClient();
  clientManagementSummary.innerHTML = `
    <div><strong>${state.clients.length}</strong><span>Total clients</span></div>
    <div><strong>${activeClients} / ${archivedClients}</strong><span>Active / archived</span></div>
    <div><strong>${client?.name || "None"}</strong><span>Selected client</span></div>
  `;
}

function renderUsers() {
  if (!userList) return;
  if (state.currentUser?.role !== "admin") {
    userList.innerHTML = '<p class="muted">Admin access is required.</p>';
    return;
  }
  if (!state.users.length) {
    userList.innerHTML = '<p class="muted">No users found.</p>';
    return;
  }
  userList.innerHTML = state.users.map((user) => `
    <div class="user-row" data-user-row="${escapeHtml(user.id)}">
      <label>
        Name
        <input type="text" value="${escapeHtml(user.name)}" data-user-field="name">
      </label>
      <label>
        Username
        <input type="text" value="${escapeHtml(user.username)}" disabled>
      </label>
      <label>
        Role
        <select data-user-field="role">
          ${["admin", "bcba", "rbt", "read-only"].map((role) => `
            <option value="${role}" ${user.role === role ? "selected" : ""}>${roleLabel(role)}</option>
          `).join("")}
        </select>
      </label>
      <label>
        Status
        <select data-user-field="active">
          <option value="true" ${user.active ? "selected" : ""}>Active</option>
          <option value="false" ${!user.active ? "selected" : ""}>Inactive</option>
        </select>
      </label>
      <div class="button-row">
        <button type="button" class="secondary-button" data-save-user>Save</button>
        <button type="button" class="delete-button" data-reset-password>Reset password</button>
      </div>
    </div>
  `).join("");
}

function renderClientDocuments() {
  const client = currentClient();
  const documents = client?.profile?.documents || [];
  clientDocumentForm.querySelectorAll("input, select, textarea, button").forEach((field) => {
    field.disabled = !client;
  });
  if (!client) {
    clientDocumentList.innerHTML = '<p class="muted">Select a client to upload documents.</p>';
    return;
  }
  if (!documents.length) {
    clientDocumentList.innerHTML = '<p class="muted">No documents uploaded yet.</p>';
    return;
  }
  clientDocumentList.innerHTML = documents.map((document) => `
    <div class="document-row">
      <div>
        <strong>${escapeHtml(document.fileName || "Document")}</strong>
        <span>${escapeHtml(documentTypeLabel(document.type))}${document.date ? ` - ${formatDate(document.date)}` : ""}</span>
        ${document.notes ? `<span>${escapeHtml(document.notes)}</span>` : ""}
      </div>
      <div class="button-row">
        <a class="secondary-link" href="${escapeHtml(document.url)}" target="_blank" rel="noopener">Open</a>
        <button type="button" class="delete-button" data-delete-document="${escapeHtml(document.id)}">Delete</button>
      </div>
    </div>
  `).join("");
}

async function refreshAuditLog(showMessage = true) {
  if (!["admin", "bcba"].includes(state.currentUser?.role)) return;
  try {
    const payload = await getAuditLog();
    state.auditLog = payload.auditLog || [];
    renderAuditFilters();
    renderAuditLog();
    if (showMessage) auditMessage.textContent = "Audit log refreshed.";
  } catch (error) {
    auditMessage.textContent = error.message;
  }
}

function renderAuditFilters() {
  if (!auditClientFilter) return;
  const clientValue = auditClientFilter.value;
  const userValue = auditUserFilter.value;
  const actionValue = auditActionFilter.value;
  auditClientFilter.innerHTML = '<option value="">All clients</option>' + state.clients.map((client) => (
    `<option value="${escapeHtml(client.id)}">${escapeHtml(client.name)}</option>`
  )).join("");
  auditUserFilter.innerHTML = '<option value="">All users</option>' + [...new Map(state.auditLog.map((entry) => [
    entry.userId,
    { id: entry.userId, name: entry.userName || entry.username || "Unknown user" }
  ])).values()].filter((user) => user.id).map((user) => (
    `<option value="${escapeHtml(user.id)}">${escapeHtml(user.name)}</option>`
  )).join("");
  auditActionFilter.innerHTML = '<option value="">All actions</option>' + [...new Set(state.auditLog.map((entry) => entry.action).filter(Boolean))]
    .sort()
    .map((action) => `<option value="${escapeHtml(action)}">${escapeHtml(actionLabel(action))}</option>`)
    .join("");
  auditClientFilter.value = clientValue;
  auditUserFilter.value = userValue;
  auditActionFilter.value = actionValue;
}

function renderAuditLog() {
  if (!auditLogTable) return;
  const entries = filteredAuditEntries();
  if (!entries.length) {
    auditLogTable.innerHTML = '<p class="muted">No audit entries match the current filters.</p>';
    return;
  }
  auditLogTable.innerHTML = `
    <div class="report-table-wrap">
      <table class="fade-plan-table audit-table">
        <thead>
          <tr>
            <th>Date/time</th>
            <th>User</th>
            <th>Role</th>
            <th>Action</th>
            <th>Client</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          ${entries.map((entry) => `
            <tr>
              <td>${escapeHtml(formatDateTime(entry.timestamp))}</td>
              <td>${escapeHtml(entry.userName || "Unknown")}</td>
              <td>${escapeHtml(roleLabel(entry.role))}</td>
              <td>${escapeHtml(actionLabel(entry.action))}</td>
              <td>${escapeHtml(entry.clientName || "")}</td>
              <td>${escapeHtml(auditDetails(entry.details))}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function filteredAuditEntries() {
  const start = auditStartFilter.value;
  const end = auditEndFilter.value;
  return state.auditLog.filter((entry) => (
    (!auditClientFilter.value || entry.clientId === auditClientFilter.value)
    && (!auditUserFilter.value || entry.userId === auditUserFilter.value)
    && (!auditActionFilter.value || entry.action === auditActionFilter.value)
    && (!start || entry.timestamp.slice(0, 10) >= start)
    && (!end || entry.timestamp.slice(0, 10) <= end)
  ));
}

function filteredBillingSessions() {
  return billingRows()
    .filter((row) => (
      (!billingClientFilter?.value || row.clientId === billingClientFilter.value)
      && (!billingProviderFilter?.value || row.provider.toLowerCase().includes(billingProviderFilter.value.trim().toLowerCase()))
      && (!billingCodeFilter?.value || row.codeValue === billingCodeFilter.value)
      && (!billingStartFilter?.value || row.date >= billingStartFilter.value)
      && (!billingEndFilter?.value || row.date <= billingEndFilter.value)
      && ((billingReadyFilter?.value || "ready") === "all" || row.ready)
    ))
    .sort((a, b) => a.date.localeCompare(b.date) || a.clientName.localeCompare(b.clientName));
}

function billingRows() {
  return state.sessions.map((session) => billingRow(session));
}

function billingRow(session) {
  const client = state.clients.find((item) => item.id === session.clientId);
  const minutes = sessionDurationMinutes(session.startTime, session.endTime);
  const units = billingUnits(minutes);
  const codeValue = session.serviceType === "parent-training" ? "97156" : (session.serviceType || "97153");
  const readyChecks = {
    finalized: Boolean(session.finalized),
    signature: Boolean(session.providerSignature),
    note: Boolean(String(session.soapNote || "").trim()),
    timing: Boolean(session.startTime && session.endTime),
    client: Boolean(client)
  };
  const ready = Object.values(readyChecks).every(Boolean);
  const statusLabel = !readyChecks.client
    ? "Missing client"
    : !readyChecks.timing
      ? "Missing time"
      : !readyChecks.note
        ? "Missing note"
        : !readyChecks.signature
          ? "Missing signature"
          : !readyChecks.finalized
            ? "Draft note"
            : "Ready";
  return {
    id: session.id,
    clientId: session.clientId,
    clientName: client?.name || "Unknown client",
    date: session.date,
    code: codeValue,
    codeValue,
    provider: session.therapist || "",
    credential: session.providerCredential || "",
    startTime: session.startTime || "",
    endTime: session.endTime || "",
    minutes,
    units,
    setting: session.setting || "",
    ready,
    statusLabel,
    authorizationNumber: client?.profile?.authorization?.number || ""
  };
}

function sessionDurationMinutes(startTime, endTime) {
  if (!startTime || !endTime) return 0;
  const [startHour, startMinute] = startTime.split(":").map(Number);
  const [endHour, endMinute] = endTime.split(":").map(Number);
  if ([startHour, startMinute, endHour, endMinute].some(Number.isNaN)) return 0;
  const start = startHour * 60 + startMinute;
  const end = endHour * 60 + endMinute;
  return Math.max(0, end - start);
}

function billingUnits(minutes) {
  if (!minutes) return 0;
  return Math.max(1, Math.round(minutes / 15));
}

function exportBillingCsv() {
  const rows = filteredBillingSessions();
  if (!rows.length) {
    if (billingMessage) billingMessage.textContent = "No billing sessions to export.";
    return;
  }
  const headers = ["client", "date_of_service", "code", "provider", "credential", "start_time", "end_time", "minutes", "units", "setting", "authorization_number", "status"];
  const csvRows = [headers, ...rows.map((row) => ([
    row.clientName,
    row.date,
    row.code,
    row.provider,
    row.credential,
    row.startTime,
    row.endTime,
    row.minutes,
    row.units,
    row.setting,
    row.authorizationNumber,
    row.ready ? "ready" : row.statusLabel.toLowerCase()
  ]))];
  downloadFile(`billing-export-${new Date().toISOString().slice(0, 10)}.csv`, csvRows.map(csvRow).join("\n"), "text/csv");
  if (billingMessage) billingMessage.textContent = `${rows.length} billing row${rows.length === 1 ? "" : "s"} exported.`;
}

function exportAuditLog(format) {
  const entries = filteredAuditEntries();
  if (format === "json") {
    downloadFile(`audit-log-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(entries, null, 2), "application/json");
    return;
  }
  const headers = ["timestamp", "userName", "role", "action", "clientName", "details"];
  const rows = [headers, ...entries.map((entry) => [
    entry.timestamp,
    entry.userName || "",
    entry.role || "",
    actionLabel(entry.action),
    entry.clientName || "",
    auditDetails(entry.details)
  ])];
  downloadFile(`audit-log-${new Date().toISOString().slice(0, 10)}.csv`, rows.map(csvRow).join("\n"), "text/csv");
}

function runDataHealthCheck() {
  state.healthIssues = buildDataHealthIssues();
  renderDataHealth();
  if (healthMessage) {
    healthMessage.textContent = state.healthIssues.length
      ? `${state.healthIssues.length} item${state.healthIssues.length === 1 ? "" : "s"} need review.`
      : "No data health issues found.";
  }
}

function renderDataHealth() {
  if (!healthSummary || !healthReportTable) return;
  const issues = state.healthIssues || [];
  const counts = healthSeverityCounts(issues);
  healthSummary.innerHTML = `
    <div><strong>${counts.high}</strong><span>High priority</span></div>
    <div><strong>${counts.medium}</strong><span>Medium priority</span></div>
    <div><strong>${counts.low}</strong><span>Low priority</span></div>
    <div><strong>${issues.length}</strong><span>Total items</span></div>
  `;
  if (!issues.length) {
    healthReportTable.innerHTML = '<p class="muted">Run a health check to review data quality.</p>';
    return;
  }
  healthReportTable.innerHTML = `
    <div class="report-table-wrap">
      <table class="fade-plan-table audit-table health-table">
        <thead>
          <tr>
            <th>Priority</th>
            <th>Client</th>
            <th>Area</th>
            <th>Issue</th>
            <th>Recommended next step</th>
          </tr>
        </thead>
        <tbody>
          ${issues.map((issue) => `
            <tr>
              <td><span class="health-badge ${escapeHtml(issue.severity)}">${escapeHtml(priorityLabel(issue.severity))}</span></td>
              <td>${escapeHtml(issue.clientName || "Practice")}</td>
              <td>${escapeHtml(issue.area)}</td>
              <td>${escapeHtml(issue.issue)}</td>
              <td>${escapeHtml(issue.recommendation)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function buildDataHealthIssues() {
  const issues = [];
  if (!state.clients.length) {
    issues.push(healthIssue("high", "", "Client management", "No clients are set up.", "Create a client before entering sessions."));
  }
  state.clients.forEach((client) => {
    const clientSessions = state.sessions.filter((session) => session.clientId === client.id);
    checkClientProfileHealth(client, clientSessions, issues);
    checkTreatmentPlanHealth(client, clientSessions, issues);
    checkSessionHealth(client, clientSessions, issues);
  });
  return issues.sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || a.clientName.localeCompare(b.clientName) || a.area.localeCompare(b.area));
}

function checkClientProfileHealth(client, sessions, issues) {
  const auth = client.profile?.authorization || {};
  if (auth.endDate) {
    const days = daysUntil(auth.endDate);
    if (days < 0) {
      issues.push(healthIssue("high", client.name, "Authorization", `Authorization expired on ${formatDate(auth.endDate)}.`, "Update authorization dates before continuing services."));
    } else if (days <= 30) {
      issues.push(healthIssue("medium", client.name, "Authorization", `Authorization expires in ${days} day${days === 1 ? "" : "s"}.`, "Start reauthorization planning."));
    }
  } else {
    issues.push(healthIssue("medium", client.name, "Authorization", "Authorization end date is missing.", "Add authorization effective dates in Client Management."));
  }
  if (!client.profile?.authorization?.number) {
    issues.push(healthIssue("low", client.name, "Authorization", "Authorization number is missing.", "Add the authorization number in Client Management."));
  }
  if (!sessions.length) {
    issues.push(healthIssue("medium", client.name, "Sessions", "No sessions are documented for this client.", "Enter a test or real session before reviewing graphs."));
  }
  (client.profile?.documents || []).forEach((document) => {
    if (!document.fileName || !document.url) {
      issues.push(healthIssue("medium", client.name, "Documents", `${documentTypeLabel(document.type)} is missing file metadata.`, "Re-upload or remove the document entry."));
    }
  });
}

function checkTreatmentPlanHealth(client, sessions, issues) {
  const programs = client.programs || [];
  const behaviors = client.behaviors || [];
  if (!programs.length) {
    issues.push(healthIssue("high", client.name, "Treatment plan", "No skill acquisition programs are configured.", "Add programs and targets in Treatment plan."));
  }
  programs.forEach((program) => {
    if (!(program.targets || []).length) {
      issues.push(healthIssue("medium", client.name, "Treatment plan", `${program.name} has no targets.`, "Add targets or remove the empty program."));
    }
    if (!program.objective) {
      issues.push(healthIssue("low", client.name, "Treatment plan", `${program.name} does not have an objective.`, "Add the BCBA-authored objective under Treatment plan."));
    }
    (program.targets || []).forEach((target) => {
      if (target.status === "active" && !hasTargetData(sessions, program.id, target.id)) {
        issues.push(healthIssue("low", client.name, "Skill data", `${program.name} - ${target.name} has no session data yet.`, "Collect baseline or intervention data when implemented."));
      }
    });
  });
  behaviors.filter((behavior) => behavior.status !== "paused").forEach((behavior) => {
    if (!hasBehaviorData(sessions, behavior.id)) {
      issues.push(healthIssue("low", client.name, "Behavior data", `${behavior.name} has no graph data yet.`, "Collect frequency data when the behavior is tracked."));
    }
  });
  if ((client.planChangeLog || []).length && !client.note97155) {
    issues.push(healthIssue("medium", client.name, "97155 note", "Treatment plan changes exist but no 97155 note is saved.", "Generate or document the 97155 note."));
  }
}

function checkSessionHealth(client, sessions, issues) {
  sessions.forEach((session) => {
    const label = `${formatDate(session.date)} ${session.serviceType || "97153"}`;
    if (!session.providerSignature) {
      issues.push(healthIssue("high", client.name, "Signature", `${label} is missing provider signature.`, "Open the session/note workflow and add the provider signature."));
    }
    if (!session.soapNote) {
      issues.push(healthIssue("high", client.name, "SOAP note", `${label} has no SOAP note.`, "Generate and review the SOAP note."));
    } else if (!session.finalized) {
      issues.push(healthIssue("medium", client.name, "SOAP note", `${label} SOAP note is still a draft.`, "Review and finalize the note when complete."));
    }
    if (session.date > new Date().toISOString().slice(0, 10)) {
      issues.push(healthIssue("medium", client.name, "Session date", `${label} is dated in the future.`, "Confirm the session date."));
    }
    if ((session.serviceType || "97153") === "97153" && !targetEntriesForSession(session).length) {
      issues.push(healthIssue("high", client.name, "Skill data", `${label} has no skill target data.`, "Add implemented targets or delete the incomplete entry."));
    }
    if (session.serviceType === "parent-training" && !(session.parentGoals || []).length) {
      issues.push(healthIssue("high", client.name, "Parent training", `${label} has no parent training goal data.`, "Add parent training goals and fidelity data."));
    }
  });
}

function targetEntriesForSession(session) {
  return (session.programs || []).flatMap((program) => (
    Array.isArray(program.targets)
      ? program.targets.map((target) => ({ ...target, programId: program.programId }))
      : [{ ...program, targetId: program.targetId || program.programId }]
  )).filter((target) => target.targetId);
}

function hasTargetData(sessions, programId, targetId) {
  return sessions.some((session) => targetEntriesForSession(session).some((target) => target.programId === programId && target.targetId === targetId));
}

function hasBehaviorData(sessions, behaviorId) {
  return sessions.some((session) => (session.behaviors || []).some((behavior) => behavior.behaviorId === behaviorId));
}

function healthIssue(severity, clientName, area, issue, recommendation) {
  return { severity, clientName, area, issue, recommendation };
}

function healthSeverityCounts(issues) {
  return issues.reduce((counts, issue) => {
    counts[issue.severity] = (counts[issue.severity] || 0) + 1;
    return counts;
  }, { high: 0, medium: 0, low: 0 });
}

function severityRank(severity) {
  return { high: 0, medium: 1, low: 2 }[severity] ?? 3;
}

function priorityLabel(severity) {
  return { high: "High", medium: "Medium", low: "Low" }[severity] || "Review";
}

function daysUntil(dateValue) {
  const today = new Date(new Date().toISOString().slice(0, 10));
  const target = new Date(`${dateValue}T00:00:00`);
  return Math.ceil((target - today) / 86400000);
}

function exportHealthReport(format) {
  const issues = state.healthIssues.length ? state.healthIssues : buildDataHealthIssues();
  if (format === "json") {
    downloadFile(`data-health-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(issues, null, 2), "application/json");
    return;
  }
  const headers = ["severity", "client", "area", "issue", "recommendation"];
  const rows = [headers, ...issues.map((issue) => [
    priorityLabel(issue.severity),
    issue.clientName || "Practice",
    issue.area,
    issue.issue,
    issue.recommendation
  ])];
  downloadFile(`data-health-${new Date().toISOString().slice(0, 10)}.csv`, rows.map(csvRow).join("\n"), "text/csv");
}

function csvRow(values) {
  return values.map((value) => `"${String(value || "").replace(/"/g, '""')}"`).join(",");
}

function auditDetails(details = {}) {
  if (!details || !Object.keys(details).length) return "";
  return Object.entries(details).map(([key, value]) => `${key}: ${auditValue(value)}`).join("; ");
}

function auditValue(value) {
  if (Array.isArray(value)) return value.length ? value.join(", ") : "none";
  if (value && typeof value === "object") {
    return Object.entries(value)
      .map(([key, nested]) => `${key}=${auditValue(nested)}`)
      .join(", ");
  }
  return String(value ?? "");
}

function actionLabel(action) {
  return String(action || "").split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function formatDateTime(value) {
  if (!value) return "";
  return new Date(value).toLocaleString();
}

function documentTypeLabel(type) {
  return {
    "authorization": "Authorization",
    "standardized-assessment": "Standardized assessment",
    "fba-assessment": "FBA / assessment grid",
    "behavior-support-plan": "Behavior support plan",
    "funder-report": "Funder report attachment",
    "other": "Other"
  }[type] || "Document";
}

function renderReportSummary() {
  const client = currentClient();
  const sessions = filteredReportSessions();
  applyIntakeInterviewToReport();
  reportClientSummary.innerHTML = client
    ? `
      <div><strong>${client.name}</strong><span>Client</span></div>
      <div><strong>${formatDate(reportForm.elements.startDate.value)}</strong><span>Report start</span></div>
      <div><strong>${sessions.length}</strong><span>Sessions in range</span></div>
    `
    : "";
}

function applyIntakeInterviewToReport(force = false) {
  const interview = currentClient()?.profile?.intakeInterview;
  if (!interview || !reportForm) return;
  setReportFieldFromInterview("background", interviewBackground(interview), defaultBackgroundInformation(), force);
  setReportFieldFromInterview("medicalConcerns", interviewMedicalConcerns(interview), defaultMedicalConcerns(), force);
  setReportFieldFromInterview("reasonReferral", interviewReasonForReferral(interview), defaultReasonForReferral(), force);
  setReportFieldFromInterview("impactBehaviors", interviewImpactOfBehaviors(interview), defaultImpactOfBehaviors(), force);
  setReportFieldFromInterview("familyStrengths", interviewFamilyStrengths(interview), defaultFamilyStrengths(), force);
  setReportFieldFromInterview("initialObservations", interviewInitialObservations(interview), defaultInitialObservations(), force);
  setSimpleReportFieldFromInterview("assessmentConductedBy", interview.interviewedBy || "", force);
  setSimpleReportFieldFromInterview("assessmentDate", interview.interviewDate || "", force);
  setSimpleReportFieldFromInterview("indirectAssessmentType", "Caregiver interview", force);
}

function setReportFieldFromInterview(name, value, fallbackDefault, force = false) {
  const field = reportForm.elements[name];
  if (!field || !value) return;
  const previous = field.dataset.autofillValue || "";
  const current = field.value || "";
  if (force || !current || current === fallbackDefault || current === previous) {
    field.value = value;
    field.dataset.autofillValue = value;
  }
}

function setSimpleReportFieldFromInterview(name, value, force = false) {
  const field = reportForm.elements[name];
  if (!field || !value) return;
  const previous = field.dataset.autofillValue || "";
  if (force || !field.value || field.value === previous) {
    field.value = value;
    field.dataset.autofillValue = value;
  }
}

function renderSoapSummary() {
  const client = currentClient();
  const session = selectedSession();
  soapClientSummary.innerHTML = client
    ? `
      <div><strong>${client.name}</strong><span>Client</span></div>
      <div><strong>${session ? formatDate(session.date) : "None"}</strong><span>Selected session</span></div>
      <div><strong>${session?.finalized ? "Finalized" : "Draft"}</strong><span>Note status</span></div>
    `
    : "";
}

function renderPlanReview() {
  const programs = clientPrograms();
  const behaviors = clientBehaviors();
  const client = currentClient();
  const activePrograms = programs.filter((program) => (program.status || "active") === "active").length;
  const masteredPrograms = programs.filter((program) => program.status === "mastered").length;
  const activeTargets = programs.flatMap((program) => program.targets || []).filter((target) => target.status === "active").length;
  const maintenanceTargets = programs.flatMap((program) => program.targets || []).filter((target) => target.status === "maintenance").length;
  const pausedTargets = programs.flatMap((program) => program.targets || []).filter((target) => target.status === "paused").length;
  planClientSummary.innerHTML = client
    ? `
      <div><strong>${client.name}</strong><span>Client</span></div>
      <div><strong>${activePrograms} / ${masteredPrograms}</strong><span>Active / mastered goals</span></div>
      <div><strong>${activeTargets}</strong><span>Active targets</span></div>
      <div><strong>${maintenanceTargets} / ${pausedTargets}</strong><span>Maintenance / paused</span></div>
      <div><strong>${behaviors.filter((behavior) => behavior.status !== "inactive").length}</strong><span>Active behaviors</span></div>
    `
    : "";

  if (!programs.length) {
    planDomainTabs.innerHTML = "";
    planReview.innerHTML = `
      <p class="muted">No treatment plan targets configured.</p>
      ${renderPlanBehaviorSection(behaviors)}
    `;
    bindPlanReviewInputs();
    return;
  }

  const groupedPrograms = groupedProgramsByDomain(programs);
  renderPlanDomainTabs(groupedPrograms.map(([domain]) => domain));

  planReview.innerHTML = `
    ${groupedPrograms.map(([domain, domainPrograms]) => `
    <section class="plan-domain ${domain === state.activePlanDomain ? "" : "hidden"}" data-plan-domain="${escapeHtml(domain)}">
      <div class="plan-domain-heading">
        <h3>${escapeHtml(domain)}</h3>
        <span>${domainPrograms.length} program${domainPrograms.length === 1 ? "" : "s"}</span>
      </div>
      ${domainPrograms.map((program) => renderPlanProgram(program)).join("")}
    </section>
  `).join("")}
    ${renderPlanBehaviorSection(behaviors)}
  `;

  bindPlanReviewInputs();
}

function bindPlanReviewInputs() {
  planReview.querySelectorAll("[data-program-name], [data-program-objective], [data-target-name], [data-target-note], [data-behavior-name]").forEach((input) => {
    input.addEventListener("blur", handlePlanTextEdit);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        input.blur();
      }
    });
  });
  planReview.querySelectorAll("[data-program-domain]").forEach((select) => {
    select.addEventListener("change", handleProgramDomainChange);
  });
}

function renderPlanBehaviorSection(behaviors) {
  return `
    <section class="plan-program">
      <div class="plan-domain-heading">
        <h3>Behavior reduction</h3>
        <span>${behaviors.length} behavior${behaviors.length === 1 ? "" : "s"}</span>
      </div>
      <p class="muted">Add the problem behaviors this client is tracking so they appear in session entry and graphing.</p>
      <div class="button-row">
        <button type="button" class="secondary-button" data-add-plan-behavior>Add behavior</button>
      </div>
      <div class="plan-target-list">
        ${behaviors.length ? behaviors.map((behavior) => `
          <div class="plan-target">
            <label>
              Behavior
              <input type="text" value="${escapeHtml(behavior.name || "")}" data-behavior-name="${behavior.id}" aria-label="Behavior name">
            </label>
            <label>
              Status
              <select data-behavior-status="${behavior.id}" aria-label="${escapeHtml(behavior.name || "Behavior")} status">
                <option value="active" ${behavior.status !== "inactive" ? "selected" : ""}>Active</option>
                <option value="inactive" ${behavior.status === "inactive" ? "selected" : ""}>Inactive</option>
              </select>
            </label>
            <div class="button-row">
              <button type="button" class="delete-button" data-remove-plan-behavior="${behavior.id}">Remove</button>
            </div>
          </div>
        `).join("") : '<p class="muted">No behaviors added yet.</p>'}
      </div>
    </section>
  `;
}

function renderPlanDomainTabs(domains) {
  if (!domains.length) {
    planDomainTabs.innerHTML = "";
    return;
  }
  if (!state.activePlanDomain || !domains.includes(state.activePlanDomain)) {
    state.activePlanDomain = domains[0];
  }
  planDomainTabs.innerHTML = domains.map((domain) => `
    <button type="button" class="domain-tab ${domain === state.activePlanDomain ? "active" : ""}" data-plan-domain-tab="${escapeHtml(domain)}">
      ${escapeHtml(domain)}
    </button>
  `).join("");
  planDomainTabs.querySelectorAll("[data-plan-domain-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activePlanDomain = button.dataset.planDomainTab;
      renderPlanReview();
    });
  });
}

function renderPlanProgram(program) {
  return `
    <section class="plan-program">
      <div class="plan-program-heading">
        <label>
          Program
          <input type="text" value="${escapeHtml(program.name)}" data-program-name="${program.id}" aria-label="Program name">
        </label>
        <label>
          Domain
          <select data-program-domain="${program.id}" aria-label="${program.name} domain">
            ${domainOptions.map((domain) => `
              <option value="${escapeHtml(domain)}" ${program.domain === domain ? "selected" : ""}>${escapeHtml(domain)}</option>
            `).join("")}
          </select>
        </label>
        <label>
          Goal status
          <select data-plan-program-status="${program.id}" aria-label="${program.name} goal status">
            ${["active", "maintenance", "mastered", "paused"].map((status) => `
              <option value="${status}" ${(program.status || "active") === status ? "selected" : ""}>${status}</option>
            `).join("")}
          </select>
        </label>
        <button type="button" class="secondary-button" data-add-target="${program.id}">Add target</button>
      </div>
      <label>
        Objective
        <textarea rows="3" data-program-objective="${program.id}" aria-label="${program.name} objective">${escapeHtml(program.objective || "")}</textarea>
      </label>
      <div class="plan-target-list">
        ${(program.targets || []).map((target) => `
          <div class="plan-target">
            <label>
              Target
              <input type="text" value="${escapeHtml(target.name)}" data-target-name="${program.id}:${target.id}" aria-label="Target name">
            </label>
            <label>
              Status
              <select data-plan-program="${program.id}" data-plan-target="${target.id}" aria-label="${target.name} status">
                ${["active", "maintenance", "mastered", "paused"].map((status) => `
                  <option value="${status}" ${target.status === status ? "selected" : ""}>${status}</option>
                `).join("")}
              </select>
            </label>
            <label>
              BCBA note
              <input type="text" value="${escapeHtml(target.note || "")}" data-target-note="${program.id}:${target.id}" placeholder="Optional">
            </label>
          </div>
        `).join("")}
      </div>
    </section>
  `;
}

async function handleAddProgram(event) {
  event.preventDefault();
  const name = addProgramForm.elements.programName.value.trim();
  if (!name) return;
  const programs = structuredClone(clientPrograms());
  programs.push({
    id: slugify(name, "program", programs.map((program) => program.id)),
    name,
    domain: addProgramForm.elements.programDomain.value || clientDomains()[0],
    status: "active",
    objective: "",
    targets: []
  });
  addProgramForm.reset();
  await savePlan(programs, clientBehaviors(), {
    type: "program-added",
    domain: programs[programs.length - 1].domain,
    programId: programs[programs.length - 1].id,
    programName: name
  });
}

async function handleAddDomain() {
  const name = window.prompt("Domain name");
  if (!name?.trim()) return;
  const domains = [...clientDomains()];
  if (domains.some((domain) => domain.toLowerCase() === name.trim().toLowerCase())) {
    planMessage.textContent = "That domain already exists.";
    return;
  }
  domains.push(name.trim());
  await savePlan(clientPrograms(), clientBehaviors(), {
    type: "domain-added",
    domain: name.trim()
  }, currentClient()?.note97155 || "", domains);
  state.activePlanDomain = name.trim();
  state.activeDomain = name.trim();
  planMessage.textContent = "Domain added.";
}

async function handlePlanClick(event) {
  const addBehavior = event.target.closest("[data-add-plan-behavior]");
  if (addBehavior) {
    const name = window.prompt("Behavior name");
    if (!name?.trim()) return;
    const behaviors = structuredClone(clientBehaviors());
    const newBehavior = {
      id: slugify(name, "behavior", behaviors.map((behavior) => behavior.id)),
      name: name.trim(),
      status: "active"
    };
    behaviors.push(newBehavior);
    await savePlan(clientPrograms(), behaviors, {
      type: "behavior-added",
      targetName: newBehavior.name
    });
    return;
  }
  const removeBehavior = event.target.closest("[data-remove-plan-behavior]");
  if (removeBehavior) {
    const behaviors = structuredClone(clientBehaviors());
    const target = behaviors.find((behavior) => behavior.id === removeBehavior.dataset.removePlanBehavior);
    if (!target) return;
    if (!window.confirm(`Remove ${target.name}?`)) return;
    await savePlan(clientPrograms(), behaviors.filter((behavior) => behavior.id !== target.id), {
      type: "behavior-removed",
      targetName: target.name
    });
    return;
  }
  const addTarget = event.target.closest("[data-add-target]");
  if (!addTarget) return;
  const name = window.prompt("Target name");
  if (!name?.trim()) return;
  const programs = structuredClone(clientPrograms());
  const program = programs.find((item) => item.id === addTarget.dataset.addTarget);
  if (!program) return;
  program.targets = program.targets || [];
  const newTarget = {
    id: slugify(name, "target", program.targets.map((target) => target.id)),
    name: name.trim(),
    status: "active",
    dateAdded: new Date().toISOString().slice(0, 10),
    maintenanceDate: "",
    note: ""
  };
  program.targets.push(newTarget);
  await savePlan(programs, clientBehaviors(), {
    type: "target-added",
    domain: program.domain,
    programId: program.id,
    programName: program.name,
    targetId: newTarget.id,
    targetName: newTarget.name,
    toStatus: "active"
  });
}

async function handlePlanTextEdit(event) {
  const input = event.target;
  const programs = structuredClone(clientPrograms());
  const behaviors = structuredClone(clientBehaviors());
  if (input.dataset.programName) {
    const program = programs.find((item) => item.id === input.dataset.programName);
    if (program && input.value.trim()) program.name = input.value.trim();
  }
  if (input.dataset.programObjective) {
    const program = programs.find((item) => item.id === input.dataset.programObjective);
    if (program) program.objective = input.value.trim();
  }
  if (input.dataset.targetName) {
    const [programId, targetId] = input.dataset.targetName.split(":");
    const target = programs.find((item) => item.id === programId)?.targets?.find((item) => item.id === targetId);
    if (target && input.value.trim()) target.name = input.value.trim();
  }
  if (input.dataset.targetNote) {
    const [programId, targetId] = input.dataset.targetNote.split(":");
    const target = programs.find((item) => item.id === programId)?.targets?.find((item) => item.id === targetId);
    if (target) target.note = input.value.trim();
  }
  if (input.dataset.behaviorName) {
    const behavior = behaviors.find((item) => item.id === input.dataset.behaviorName);
    if (behavior && input.value.trim()) {
      behavior.name = input.value.trim();
    }
  }
  await savePlan(programs, behaviors);
}

async function handleProgramDomainChange(event) {
  const programs = structuredClone(clientPrograms());
  const program = programs.find((item) => item.id === event.target.dataset.programDomain);
  if (!program) return;
  program.domain = event.target.value;
  await savePlan(programs, clientBehaviors());
}

async function handlePlanStatusChange(event) {
  const behaviorControl = event.target.closest("[data-behavior-status]");
  if (behaviorControl) {
    const behaviors = structuredClone(clientBehaviors());
    const behavior = behaviors.find((item) => item.id === behaviorControl.dataset.behaviorStatus);
    if (!behavior) return;
    behavior.status = behaviorControl.value;
    await savePlan(clientPrograms(), behaviors);
    return;
  }
  const programControl = event.target.closest("[data-plan-program-status]");
  if (programControl) {
    const programs = structuredClone(clientPrograms());
    const program = programs.find((item) => item.id === programControl.dataset.planProgramStatus);
    if (!program) return;
    const previousStatus = program.status || "active";
    program.status = programControl.value;
    try {
      await savePlan(programs, clientBehaviors(), previousStatus !== programControl.value ? {
        type: "program-status-changed",
        domain: program.domain,
        programId: program.id,
        programName: program.name,
        fromStatus: previousStatus,
        toStatus: programControl.value
      } : null);
    } catch (error) {
      formMessage.textContent = error.message;
      renderPlanReview();
    }
    return;
  }
  const control = event.target.closest("[data-plan-program][data-plan-target]");
  if (!control) return;
  const client = currentClient();
  const programs = structuredClone(clientPrograms());
  const program = programs.find((item) => item.id === control.dataset.planProgram);
  const target = program?.targets?.find((item) => item.id === control.dataset.planTarget);
  if (!target) return;

  const previousStatus = target.status;
  target.status = control.value;
  if (control.value === "maintenance" && !target.maintenanceDate) {
    target.maintenanceDate = new Date().toISOString().slice(0, 10);
  }

  try {
    await savePlan(programs, clientBehaviors(), previousStatus !== control.value ? {
      type: "target-status-changed",
      domain: program.domain,
      programId: program.id,
      programName: program.name,
      targetId: target.id,
      targetName: target.name,
      fromStatus: previousStatus,
      toStatus: control.value
    } : null);
  } catch (error) {
    formMessage.textContent = error.message;
    renderPlanReview();
  }
}

async function savePlan(
  programs,
  behaviors,
  change = null,
  note97155 = currentClient()?.note97155 || "",
  domains = clientDomains(),
  rbtPerformanceAreas = clientRbtPerformanceAreas()
) {
  const planChangeLog = change
    ? [...(currentClient()?.planChangeLog || []), {
        id: cryptoId(),
        date: new Date().toISOString().slice(0, 10),
        timestamp: new Date().toISOString(),
        ...change
      }]
    : currentClient()?.planChangeLog || [];
  const updated = await updateClientPlan(currentClient().id, {
    domains,
    programs,
    behaviors,
    planChangeLog,
    note97155,
    rbtPerformanceAreas
  });
  const index = state.clients.findIndex((item) => item.id === updated.id);
  if (index >= 0) state.clients[index] = updated;
  resetRows();
  render();
}

async function handleGenerate97155Note() {
  const note = generate97155Note();
  note97155Editor.value = note;
  await savePlan(clientPrograms(), clientBehaviors(), null, note);
  note97155Status.textContent = "97155 note generated.";
  planMessage.textContent = "97155 note generated. View or edit it under SOAP Notes.";
}

async function handleSave97155Note() {
  await savePlan(clientPrograms(), clientBehaviors(), null, note97155Editor.value);
  note97155Status.textContent = "97155 note saved.";
}

function render97155Note() {
  note97155Editor.value = currentClient()?.note97155 || "";
  note97155Status.textContent = "";
}

function renderRbtFidelityRows() {
  const rbtPresent = bcbaSessionForm.elements.rbtPresent.value === "true";
  rbtFidelityRows.innerHTML = clientRbtPerformanceAreas().map((area) => `
    <div class="fidelity-row" role="row" data-rbt-area-row="${escapeHtml(area.id)}">
      <label class="performance-area-label" role="cell">
        Area
        <input type="text" value="${escapeHtml(area.label)}" data-rbt-area-name="${escapeHtml(area.id)}" aria-label="RBT performance area">
      </label>
      <label><input type="radio" name="rbtFidelity_${escapeHtml(area.id)}" value="yes" data-rbt-score ${rbtPresent ? "" : "disabled"}> Yes</label>
      <label><input type="radio" name="rbtFidelity_${escapeHtml(area.id)}" value="no" data-rbt-score checked ${rbtPresent ? "" : "disabled"}> No</label>
      <button type="button" class="icon-button" data-remove-rbt-area="${escapeHtml(area.id)}" aria-label="Remove ${escapeHtml(area.label)}">x</button>
    </div>
  `).join("");
  toggleRbtFeedbackSection();
}

function generate97155Note() {
  const client = currentClient();
  const sessionDetails = readBcbaSessionDetails();
  const today = new Date().toISOString().slice(0, 10);
  const changes = (client?.planChangeLog || []).filter((change) => change.date === today);
  const targetAdds = changes.filter((change) => change.type === "target-added");
  const statusChanges = changes.filter((change) => change.type === "target-status-changed");
  const programAdds = changes.filter((change) => change.type === "program-added");
  const objectiveItems = [
    ...programAdds.map((change) => `Added program ${change.programName} under ${change.domain}.`),
    ...targetAdds.map((change) => `Added target ${change.targetName} under ${change.programName}.`),
    ...statusChanges.map((change) => `Changed ${change.targetName} under ${change.programName} from ${change.fromStatus} to ${change.toStatus}.`)
  ];
  const rbtFeedbackText = sessionDetails.rbtPresent
    ? ` RBT session fidelity was ${sessionDetails.rbtFidelity.percent}% (${sessionDetails.rbtFidelity.yesCount}/${sessionDetails.rbtFidelity.total} areas performed). ${sessionDetails.rbtFidelity.noItems.length ? `Areas needing support: ${sessionDetails.rbtFidelity.noItems.join(", ")}.` : "All scored areas were completed."} ${sessionDetails.rbtWrittenFeedback ? `Written RBT feedback: ${sessionDetails.rbtWrittenFeedback}` : "No written RBT feedback narrative was entered."}`
    : "";

  return [
    `S: ${sessionDetails.bcba || "BCBA"} completed a ${sessionDetails.focus} session for ${client?.name || "client"} under 97155 on ${formatDate(sessionDetails.date)} from ${sessionDetails.startTime || "start time"} to ${sessionDetails.endTime || "end time"} in the ${sessionDetails.setting || "setting"} setting. Caregiver ${sessionDetails.caregiverPresent ? "was" : "was not"} present. RBT ${sessionDetails.rbtPresent ? "was" : "was not"} present.`,
    "",
    `O: ${objectiveItems.length ? objectiveItems.join(" ") : "No target additions or target status changes were recorded today."}${rbtFeedbackText}${sessionDetails.notes ? ` Additional supervision note: ${sessionDetails.notes}` : ""}`,
    "",
    "A: Treatment plan updates were completed to align active acquisition and maintenance targets with current clinical priorities and client performance.",
    "",
    "P: Implement updated targets during upcoming 97153 sessions. Continue monitoring acquisition, maintenance, and behavior data to guide future protocol modifications.",
    "",
    signatureBlock(sessionDetails.providerSignature, sessionDetails.providerCredential, sessionDetails.date)
  ].join("\n");
}

function readBcbaSessionDetails() {
  const values = new FormData(bcbaSessionForm);
  return {
    date: values.get("date"),
    bcba: values.get("bcba"),
    setting: values.get("setting"),
    startTime: values.get("startTime"),
    endTime: values.get("endTime"),
    caregiverPresent: values.get("caregiverPresent") === "true",
    rbtPresent: values.get("rbtPresent") === "true",
    rbtFidelity: readRbtFidelity(),
    rbtWrittenFeedback: rbtWrittenFeedback.value.trim(),
    focus: values.get("focus"),
    notes: values.get("notes"),
    providerSignature: values.get("providerSignature"),
    providerCredential: values.get("providerCredential")
  };
}

function toggleRbtFeedbackSection() {
  const rbtPresent = bcbaSessionForm.elements.rbtPresent.value === "true";
  rbtFeedbackSection.classList.toggle("inactive", !rbtPresent);
  rbtFeedbackHelp.textContent = rbtPresent
    ? "Complete the checklist below for the RBT's session performance."
    : "Set RBT present to Yes in the 97155 session entry when feedback is provided.";
  rbtFeedbackSection.querySelectorAll("[data-rbt-score], #rbt-written-feedback").forEach((field) => {
    field.disabled = !rbtPresent;
  });
  updateRbtFidelityScore();
}

function readRbtFidelity() {
  const scoredItems = clientRbtPerformanceAreas().map((item) => {
    const selected = rbtFeedbackSection.querySelector(`input[name="rbtFidelity_${item.id}"]:checked`);
    return {
      ...item,
      value: selected?.value || "no"
    };
  });
  const total = scoredItems.length;
  const yesItems = scoredItems.filter((item) => item.value === "yes");
  const noItems = scoredItems.filter((item) => item.value !== "yes").map((item) => item.label);
  return {
    total,
    yesCount: yesItems.length,
    noItems,
    percent: total ? Math.round((yesItems.length / total) * 100) : 0
  };
}

function updateRbtFidelityScore() {
  const fidelity = readRbtFidelity();
  rbtFidelityScore.textContent = `${fidelity.percent}% fidelity`;
}

async function handleAddRbtPerformanceArea() {
  const name = window.prompt("Performance area");
  if (!name?.trim()) return;
  const areas = clientRbtPerformanceAreas();
  areas.push({
    id: slugify(name, "rbt-area", areas.map((area) => area.id)),
    label: name.trim()
  });
  await saveRbtPerformanceAreas(areas, "Performance area added.");
}

async function handleRbtPerformanceAreaEdit(event) {
  const input = event.target.closest("[data-rbt-area-name]");
  if (!input) return;
  const name = input.value.trim();
  if (!name) {
    renderRbtFidelityRows();
    return;
  }
  const areas = clientRbtPerformanceAreas();
  const area = areas.find((item) => item.id === input.dataset.rbtAreaName);
  if (!area || area.label === name) return;
  area.label = name;
  await saveRbtPerformanceAreas(areas, "Performance area updated.");
}

async function handleRbtPerformanceAreaClick(event) {
  const remove = event.target.closest("[data-remove-rbt-area]");
  if (!remove) return;
  const areas = clientRbtPerformanceAreas();
  if (areas.length <= 1) {
    planMessage.textContent = "At least one RBT performance area is required.";
    return;
  }
  const area = areas.find((item) => item.id === remove.dataset.removeRbtArea);
  if (!window.confirm(`Remove ${area?.label || "this performance area"}?`)) return;
  await saveRbtPerformanceAreas(
    areas.filter((item) => item.id !== remove.dataset.removeRbtArea),
    "Performance area removed."
  );
}

async function saveRbtPerformanceAreas(areas, message) {
  await savePlan(clientPrograms(), clientBehaviors(), null, currentClient()?.note97155 || "", clientDomains(), areas);
  planMessage.textContent = message;
}

function renderHistory() {
  const sessions = currentSessions();
  const container = document.querySelector("#session-history");
  if (!sessions.length) {
    container.innerHTML = '<p class="muted">No sessions saved yet.</p>';
    return;
  }
  container.innerHTML = sessions.map((session) => {
    const active = selectedSession()?.id === session.id ? "active" : "";
    const programSummary = targetEntries(session)
      .map((target) => `${lookups().targetName(target.programId, target.targetId)} ${target.independence}%`)
      .join(", ") || "No target data recorded";
    return `
      <div class="history-item ${active}">
        <button type="button" class="history-select" data-session-id="${session.id}">
          <span><strong>${formatDate(session.date)}</strong> ${session.startTime}-${session.endTime}</span>
          <span>${programSummary}</span>
          <span>${session.finalized ? "Finalized" : "Draft note"}</span>
        </button>
        <button type="button" class="delete-button" data-delete-session="${session.id}" aria-label="Delete session from ${formatDate(session.date)}">Delete</button>
      </div>
    `;
  }).join("");

  container.querySelectorAll("[data-session-id]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedSessionId = button.dataset.sessionId;
      renderHistory();
      renderNote();
      renderSoapSummary();
    });
  });
  container.querySelectorAll("[data-delete-session]").forEach((button) => {
    button.addEventListener("click", () => handleDeleteSession(button.dataset.deleteSession));
  });
}

async function handleDeleteSession(sessionId) {
  const session = state.sessions.find((item) => item.id === sessionId);
  const label = session ? `${formatDate(session.date)} ${session.startTime}-${session.endTime}` : "this session";
  if (!window.confirm(`Delete ${label}? This removes it from history, graphs, and notes.`)) return;

  try {
    await deleteSession(sessionId);
    if (state.selectedSessionId === sessionId) state.selectedSessionId = null;
    await refreshData();
    render();
  } catch (error) {
    formMessage.textContent = error.message;
  }
}

function handleGenerateFunderReport(event) {
  event.preventDefault();
  renderReportSummary();
  const client = currentClient();
  const sessions = filteredReportSessions().slice().reverse();
  const values = new FormData(reportForm);
  const metrics = funderReportMetrics(sessions);
  const assessmentGridFile = reportForm.elements.assessmentGrid.files[0];
  const standardizedGridFile = reportForm.elements.standardizedAssessmentGrid.files[0];
  reportPreview.innerHTML = `
    <section class="report-document">
      <div class="report-title-block">
        <p class="eyebrow">Funder report</p>
        <h2>${escapeHtml(client?.name || "Client")}</h2>
        <p>${formatDate(values.get("startDate"))} - ${formatDate(values.get("endDate"))}</p>
      </div>
      <div class="report-stat-grid">
        <div><strong>${sessions.length}</strong><span>Sessions reviewed</span></div>
        <div><strong>${metrics.averageIndependence}%</strong><span>Average independence</span></div>
        <div><strong>${metrics.targetsReviewed}</strong><span>Targets with data</span></div>
        <div><strong>${metrics.totalBehaviorFrequency}</strong><span>Total behavior frequency</span></div>
      </div>
      <section>
        <h3>Background Information</h3>
        ${reportParagraph(values.get("background") || defaultBackgroundInformation())}
      </section>
      <section>
        <h3>Medical Concerns</h3>
        ${reportParagraph(values.get("medicalConcerns") || defaultMedicalConcerns())}
      </section>
      <section>
        <h3>Reason for Referral</h3>
        ${reportParagraph(values.get("reasonReferral") || defaultReasonForReferral())}
      </section>
      <section>
        <h3>Impact of Behaviors</h3>
        ${reportParagraph(values.get("impactBehaviors") || defaultImpactOfBehaviors())}
      </section>
      <section>
        <h3>Client and Family Strengths</h3>
        ${reportParagraph(values.get("familyStrengths") || defaultFamilyStrengths())}
      </section>
      <section>
        <h3>Initial Observations</h3>
        ${reportParagraph(values.get("initialObservations") || defaultInitialObservations())}
      </section>
      <section>
        <h3>Functional Assessment</h3>
        <div class="report-detail-grid">
          <div><strong>Indirect assessment type</strong><span>${escapeHtml(values.get("indirectAssessmentType") || "Not entered")}</span></div>
          <div><strong>Conducted by</strong><span>${escapeHtml(values.get("assessmentConductedBy") || "Not entered")}</span></div>
          <div><strong>Date</strong><span>${values.get("assessmentDate") ? formatDate(values.get("assessmentDate")) : "Not entered"}</span></div>
        </div>
        ${reportFilePreview(assessmentGridFile, "Assessment grid")}
      </section>
      <section>
        <h3>Behavior Support Plan</h3>
        ${reportParagraph(values.get("behaviorSupportPlan") || "Behavior support plan content can be pasted by the supervising BCBA.")}
      </section>
      <section>
        <h3>Behavior Graphs</h3>
        <article class="chart-panel">
          <h4>Behavior frequency</h4>
          <canvas id="report-behavior-chart" width="760" height="320"></canvas>
        </article>
        <div id="report-behavior-charts" class="chart-zone"></div>
      </section>
      <section>
        <h3>Progress Summary</h3>
        ${reportParagraph(values.get("progressSummary") || `Across the reporting period, ${client?.name || "client"} completed ${sessions.length} documented sessions. Average skill independence was ${metrics.averageIndependence}%. Behavior data were reviewed across tracked behaviors for treatment planning.`)}
      </section>
      <section>
        <h3>Standardized Assessment</h3>
        <div class="report-detail-grid">
          <div><strong>Assessment type</strong><span>${escapeHtml(values.get("standardizedAssessmentType") || "Not entered")}</span></div>
          <div><strong>Conducted by</strong><span>${escapeHtml(values.get("standardizedConductedBy") || "Not entered")}</span></div>
          <div><strong>Date</strong><span>${values.get("standardizedAssessmentDate") ? formatDate(values.get("standardizedAssessmentDate")) : "Not entered"}</span></div>
        </div>
        ${reportFilePreview(standardizedGridFile, "Standardized assessment grid")}
      </section>
      <section>
        <h3>Skill Acquisition Graphs</h3>
        <div id="report-skill-charts" class="chart-zone"></div>
      </section>
      <section>
        <h3>Skill Acquisition Progress Summary</h3>
        ${renderMasteredTargetsSummary(values.get("startDate"), values.get("endDate"))}
      </section>
      <section>
        <h3>Parent Training</h3>
        ${renderParentTrainingReportSummary(values.get("startDate"), values.get("endDate"))}
        <div id="report-parent-training-charts" class="chart-zone"></div>
      </section>
      <section>
        <h3>Instructional Goals Information</h3>
        ${reportParagraph(values.get("instructionalGoalsInfo") || defaultInstructionalGoalsInfo())}
      </section>
      <section>
        <h3>Integration, Generalization, and Maintenance</h3>
        ${reportParagraph(values.get("generalizationMaintenance") || defaultGeneralizationMaintenance())}
      </section>
      <section>
        <h3>Barriers to Treatment</h3>
        ${reportParagraph(values.get("barriersToTreatmentSummary") || defaultBarriersToTreatmentSummary())}
      </section>
      <section>
        <h3>Discharge Criteria</h3>
        ${renderDischargeCriteria(values)}
      </section>
      <section>
        <h3>Fade Out Plan</h3>
        ${renderFadePlanTable()}
      </section>
      <section>
        <h3>Recommendations</h3>
        ${reportParagraph(values.get("recommendations") || defaultRecommendations())}
        ${renderServiceHoursTable()}
      </section>
      <section>
        <h3>Medical Necessity and Justification</h3>
        ${reportParagraph(values.get("medicalNecessity") || defaultMedicalNecessity())}
      </section>
      <section class="report-signature">
        <p><strong>Prepared by:</strong> ${escapeHtml(values.get("preparedBy") || "Provider")}${values.get("credential") ? `, ${escapeHtml(values.get("credential"))}` : ""}</p>
        <p><strong>Date:</strong> ${formatDate(new Date().toISOString().slice(0, 10))}</p>
      </section>
    </section>
  `;
  drawFunderReportCharts(sessions);
  createAuditEvent({
    action: "funder-report-generated",
    clientId: client?.id,
    details: {
      startDate: values.get("startDate"),
      endDate: values.get("endDate"),
      sessions: sessions.length
    }
  }).then(() => refreshAuditLog(false)).catch(() => {});
  funderExportStatus.textContent = "Report generated. Use Print report to save as PDF, or download a text/HTML copy.";
}

async function handleDownloadFunderReport(format) {
  const reportDocument = reportPreview.querySelector(".report-document");
  if (!reportDocument) {
    funderExportStatus.textContent = "Generate the funder report before downloading.";
    return;
  }
  const base = funderReportFileBase();
  if (format === "html") {
    const html = await funderReportHtml(reportDocument);
    downloadFile(`${base}.html`, html, "text/html");
  } else {
    downloadFile(`${base}.txt`, reportDocument.innerText, "text/plain");
  }
  funderExportStatus.textContent = `Funder report ${format === "html" ? "HTML" : "text"} downloaded.`;
  createAuditEvent({
    action: "funder-report-exported",
    clientId: currentClient()?.id,
    details: {
      format,
      startDate: reportForm.elements.startDate.value,
      endDate: reportForm.elements.endDate.value
    }
  }).then(() => refreshAuditLog(false)).catch(() => {});
}

function funderReportFileBase() {
  const client = currentClient();
  const startDate = reportForm.elements.startDate.value || "start";
  const endDate = reportForm.elements.endDate.value || "end";
  return `${safeFilename(client?.name || "client")}-funder-report-${startDate}-to-${endDate}`;
}

async function funderReportHtml(reportDocument) {
  const clone = reportDocument.cloneNode(true);
  replaceReportCanvases(reportDocument, clone);
  await inlineReportImages(clone);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>${escapeHtml(funderReportFileBase())}</title>
    <style>
      body { font-family: Arial, sans-serif; color: #17212b; margin: 32px; line-height: 1.45; }
      h1, h2, h3, h4, p { margin-top: 0; }
      h2 { font-size: 24px; margin-bottom: 4px; }
      h3 { border-top: 1px solid #cfd7df; padding-top: 14px; margin-top: 22px; }
      table { border-collapse: collapse; width: 100%; margin: 10px 0 18px; }
      th, td { border: 1px solid #9aa6b2; padding: 7px; text-align: left; vertical-align: top; }
      th { background: #eef2f5; }
      img { max-width: 100%; height: auto; }
      .eyebrow { text-transform: uppercase; letter-spacing: .08em; font-size: 11px; color: #5f6b76; }
      .report-stat-grid, .report-detail-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin: 14px 0; }
      .report-detail-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .report-stat-grid div, .report-detail-grid div, .program-report-info { border: 1px solid #d6dde3; padding: 8px; }
      .report-stat-grid strong, .report-detail-grid strong { display: block; }
      .chart-panel { page-break-inside: avoid; break-inside: avoid; margin-bottom: 18px; }
      .report-signature { margin-top: 28px; }
      @page { margin: 0.65in; }
      @media print {
        body { margin: 0; }
        section, .chart-panel, table, .program-report-info { break-inside: avoid; page-break-inside: avoid; }
      }
    </style>
  </head>
  <body>
    ${clone.outerHTML}
  </body>
</html>`;
}

function replaceReportCanvases(source, clone) {
  const sourceCanvases = [...source.querySelectorAll("canvas")];
  [...clone.querySelectorAll("canvas")].forEach((canvas, index) => {
    const sourceCanvas = sourceCanvases[index];
    if (!sourceCanvas) return;
    const image = document.createElement("img");
    image.alt = canvas.closest(".chart-panel")?.querySelector("h3, h4")?.textContent || "Report chart";
    try {
      image.src = sourceCanvas.toDataURL("image/png");
    } catch (error) {
      image.alt = "Chart image could not be embedded.";
    }
    image.width = sourceCanvas.width;
    image.height = sourceCanvas.height;
    canvas.replaceWith(image);
  });
}

async function inlineReportImages(container) {
  const images = [...container.querySelectorAll("img")].filter((image) => image.src.startsWith("blob:"));
  await Promise.all(images.map(async (image) => {
    try {
      const blob = await fetch(image.src).then((response) => response.blob());
      image.src = await blobToDataUrl(blob);
    } catch (error) {
      image.removeAttribute("src");
      image.alt = `${image.alt || "Uploaded image"} could not be embedded.`;
    }
  }));
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function filteredReportSessions() {
  const startDate = reportForm.elements.startDate.value;
  const endDate = reportForm.elements.endDate.value;
  return currentSessions().filter((session) => (
    (!startDate || session.date >= startDate) && (!endDate || session.date <= endDate)
  ));
}

function funderReportMetrics(sessions) {
  const targets = sessions.flatMap((session) => targetEntries(session).filter(isActualTargetEntry));
  const averageIndependence = targets.length
    ? Math.round(targets.reduce((sum, target) => sum + Number(target.independence || 0), 0) / targets.length)
    : 0;
  const targetKeys = new Set(targets.map((target) => `${target.programId}:${target.targetId}`));
  const totalBehaviorFrequency = sessions
    .flatMap((session) => session.behaviors || [])
    .reduce((sum, behavior) => sum + Number(behavior.frequency || 0), 0);
  return {
    averageIndependence,
    targetsReviewed: targetKeys.size,
    totalBehaviorFrequency
  };
}

function renderMasteredTargetsSummary(startDate, endDate) {
  const masteredTargets = masteredTargetsForRange(startDate, endDate);
  if (!masteredTargets.length) {
    return "<p>No targets were marked mastered during this reporting period.</p>";
  }
  return `
    <p>The following targets were mastered during this reporting period:</p>
    <ul class="mastered-target-list">
      ${masteredTargets.map((target) => `
        <li>
          <strong>${escapeHtml(target.targetName)}</strong>
          <span>${escapeHtml(target.programName)}${target.domain ? `, ${escapeHtml(target.domain)}` : ""} - mastered ${formatDate(target.date)}</span>
        </li>
      `).join("")}
    </ul>
  `;
}

function masteredTargetsForRange(startDate, endDate) {
  return (currentClient()?.planChangeLog || [])
    .filter((change) => (
      change.type === "target-status-changed"
      && change.toStatus === "mastered"
      && (!startDate || change.date >= startDate)
      && (!endDate || change.date <= endDate)
    ))
    .sort((a, b) => a.date.localeCompare(b.date) || a.targetName.localeCompare(b.targetName));
}

function renderParentTrainingReportSummary(startDate, endDate) {
  const parentSessions = parentTrainingSessionsForRange(startDate, endDate);
  if (!parentSessions.length) {
    return "<p>No parent training sessions were documented during this reporting period.</p>";
  }

  const goalEntries = parentSessions.flatMap((session) => (
    (session.parentGoals || []).map((goal) => ({
      ...goal,
      date: session.date,
      caregiverName: session.parentTraining?.caregiverName || "Caregiver",
      trainingFocus: session.parentTraining?.trainingFocus || "parent training"
    }))
  ));
  const averageFidelity = goalEntries.length
    ? Math.round(goalEntries.reduce((sum, goal) => sum + Number(goal.fidelity || 0), 0) / goalEntries.length)
    : 0;
  const caregivers = [...new Set(parentSessions.map((session) => session.parentTraining?.caregiverName).filter(Boolean))];

  return `
    <div class="report-detail-grid">
      <div><strong>Sessions completed</strong><span>${parentSessions.length}</span></div>
      <div><strong>Average caregiver fidelity</strong><span>${averageFidelity}%</span></div>
      <div><strong>Caregivers trained</strong><span>${escapeHtml(caregivers.join(", ") || "Not specified")}</span></div>
    </div>
    ${goalEntries.length ? `
      <p>Parent training goals practiced during this reporting period:</p>
      <ul class="mastered-target-list">
        ${goalEntries.map((goal) => `
          <li>
            <strong>${escapeHtml(goal.goalName)} - ${escapeHtml(goal.targetName)}</strong>
            <span>${formatDate(goal.date)}; ${escapeHtml(goal.caregiverName)}; ${goal.fidelity}% caregiver fidelity (${goal.independent}/${goal.opportunities || goal.independent + goal.prompted} independent); focus: ${escapeHtml(goal.trainingFocus)}</span>
          </li>
        `).join("")}
      </ul>
    ` : "<p>No parent training goal data were collected during these sessions.</p>"}
  `;
}

function parentTrainingSessionsForRange(startDate, endDate) {
  return currentSessions()
    .filter((session) => (
      session.serviceType === "parent-training"
      && (!startDate || session.date >= startDate)
      && (!endDate || session.date <= endDate)
    ))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function drawFunderReportCharts(sessions) {
  const skillContainer = reportPreview.querySelector("#report-skill-charts");
  if (!skillContainer) return;
  drawSkillChartSet(sessions, skillContainer, "report-program-chart", true);

  const behaviorCanvas = reportPreview.querySelector("#report-behavior-chart");
  if (!behaviorCanvas) return;
  const behaviorSeries = behaviorChartSeries(sessions);
  drawLineChart(behaviorCanvas, behaviorSeries, {
    yStep: 1,
    yLabel: "frequency",
    emptyMessage: "No behavior data in this report range"
  });

  const behaviorContainer = reportPreview.querySelector("#report-behavior-charts");
  if (behaviorContainer) drawBehaviorChartSet(sessions, behaviorContainer, "report-behavior-chart");

  const parentTrainingContainer = reportPreview.querySelector("#report-parent-training-charts");
  if (parentTrainingContainer) drawParentTrainingChartSet(sessions, parentTrainingContainer, "report-parent-training-chart");
}

function renderCharts() {
  const sessions = currentSessions().slice().reverse();
  renderSkillCharts(sessions);

  const behaviorSeries = behaviorChartSeries(sessions);

  drawLineChart(document.querySelector("#behavior-chart"), behaviorSeries, {
    yStep: 1,
    yLabel: "frequency",
    emptyMessage: "Save a session to graph behavior frequency"
  });
  drawBehaviorChartSet(sessions, behaviorCharts, "behavior-single-chart");
}

function renderSkillCharts(sessions) {
  drawSkillChartSet(sessions, skillCharts, "program-chart");
}

function drawSkillChartSet(sessions, container, chartAttribute, includeProgramInfo = false) {
  const charts = clientPrograms()
    .map((program) => {
      const targets = configuredTargetsForProgram(program);
      const series = targets.map((target) => ({
        name: target.name,
        points: sessions.flatMap((session) => {
          const entry = targetEntries(session)
            .filter(isActualTargetEntry)
            .find((item) => item.programId === program.id && item.targetId === target.id);
          return entry ? [{ x: session.date, y: entry.independence, phase: entry.phase || "intervention" }] : [];
        })
      })).filter((item) => item.points.length);
      return { program, series };
    })
    .filter((chart) => chart.series.length);

  if (!charts.length) {
    container.innerHTML = `
      <article class="chart-panel">
        <h3>Skill acquisition</h3>
        <canvas data-empty-skill width="760" height="320"></canvas>
      </article>
    `;
    drawLineChart(container.querySelector("canvas"), [], {
      maxY: 100,
      yStep: 10,
      yLabel: "% independence",
      emptyMessage: "Save a session to graph target independence"
    });
    return;
  }

  container.innerHTML = charts.map((chart) => `
    <article class="chart-panel">
      <h3>${chart.program.name}</h3>
      ${includeProgramInfo ? renderReportProgramInfo(chart.program) : ""}
      <canvas data-${chartAttribute}="${chart.program.id}" width="760" height="320"></canvas>
    </article>
  `).join("");

  charts.forEach((chart) => {
    drawLineChart(container.querySelector(`[data-${chartAttribute}="${chart.program.id}"]`), chart.series, {
      maxY: 100,
      yStep: 10,
      yLabel: "% independence",
      emptyMessage: "No target data for this program"
    });
  });
}

function behaviorChartSeries(sessions) {
  return clientBehaviors().map((behavior) => ({
    name: behavior.name,
    points: sessions.flatMap((session) => {
      const target = session.behaviors.find((item) => item.behaviorId === behavior.id);
      return target ? [{ x: session.date, y: Number(target.frequency || 0), phase: target.phase || "intervention" }] : [];
    })
  })).filter((series) => series.points.length);
}

function drawBehaviorChartSet(sessions, container, chartAttribute) {
  const charts = behaviorChartSeries(sessions).map((series) => ({
    behavior: series.name,
    series: [series]
  }));

  if (!charts.length) {
    container.innerHTML = "";
    return;
  }

  container.innerHTML = charts.map((chart, index) => `
    <article class="chart-panel">
      <h3>${escapeHtml(chart.behavior)}</h3>
      <canvas data-${chartAttribute}="${index}" width="760" height="320"></canvas>
    </article>
  `).join("");

  charts.forEach((chart, index) => {
    drawLineChart(container.querySelector(`[data-${chartAttribute}="${index}"]`), chart.series, {
      yStep: 1,
      yLabel: "frequency",
      emptyMessage: "No behavior data for this behavior"
    });
  });
}

function drawParentTrainingChartSet(sessions, container, chartAttribute) {
  const parentSessions = sessions.filter((session) => session.serviceType === "parent-training");
  const goalNames = [...new Set(parentSessions.flatMap((session) => (
    (session.parentGoals || []).map((goal) => goal.goalName)
  )))].filter(Boolean);

  const charts = goalNames.map((goalName) => {
    const targetNames = [...new Set(parentSessions.flatMap((session) => (
      (session.parentGoals || [])
        .filter((goal) => goal.goalName === goalName)
        .map((goal) => goal.targetName)
    )))].filter(Boolean);
    const series = targetNames.map((targetName) => ({
      name: targetName,
      points: parentSessions.flatMap((session) => {
        const goal = (session.parentGoals || []).find((item) => (
          item.goalName === goalName && item.targetName === targetName
        ));
        return goal ? [{ x: session.date, y: Number(goal.fidelity || 0), phase: "intervention" }] : [];
      })
    })).filter((item) => item.points.length);
    return { goalName, series };
  }).filter((chart) => chart.series.length);

  if (!charts.length) {
    container.innerHTML = '<p>No parent training graph data were collected during this reporting period.</p>';
    return;
  }

  container.innerHTML = charts.map((chart, index) => `
    <article class="chart-panel">
      <h3>${escapeHtml(chart.goalName)}</h3>
      <canvas data-${chartAttribute}="${index}" width="760" height="320"></canvas>
    </article>
  `).join("");

  charts.forEach((chart, index) => {
    drawLineChart(container.querySelector(`[data-${chartAttribute}="${index}"]`), chart.series, {
      maxY: 100,
      yStep: 10,
      yLabel: "caregiver fidelity %",
      emptyMessage: "No parent training data for this goal"
    });
  });
}

function renderReportProgramInfo(program) {
  const activeTargets = (program.targets || []).filter((target) => target.status === "active").map((target) => target.name);
  const maintenanceTargets = (program.targets || []).filter((target) => target.status === "maintenance").map((target) => target.name);
  return `
    <div class="program-report-info">
      <p><strong>Domain:</strong> ${escapeHtml(program.domain || "General")}</p>
      <p><strong>Objective:</strong> ${escapeHtml(program.objective || "Objective not entered in treatment plan.")}</p>
      <p><strong>Active targets:</strong> ${escapeHtml(activeTargets.join(", ") || "None")}</p>
      <p><strong>Maintenance targets:</strong> ${escapeHtml(maintenanceTargets.join(", ") || "None")}</p>
    </div>
  `;
}

function renderNote() {
  const session = selectedSession();
  if (!session) {
    selectedSoapNoteTitle.textContent = "97153 note";
    soapEditor.value = "";
    soapEditor.placeholder = "Save or select a session to generate a SOAP note.";
    soapEditor.readOnly = false;
    finalizeButton.disabled = true;
    printSoapNoteButton.disabled = true;
    downloadSoapTextButton.disabled = true;
    downloadSoapHtmlButton.disabled = true;
    return;
  }
  selectedSoapNoteTitle.textContent = session.serviceType === "parent-training" ? "97156 note" : "97153 note";
  soapEditor.value = session.soapNote || generateSoapNote(session, lookups());
  soapEditor.readOnly = session.finalized;
  finalizeButton.disabled = session.finalized;
  printSoapNoteButton.disabled = false;
  downloadSoapTextButton.disabled = false;
  downloadSoapHtmlButton.disabled = false;
  noteStatus.textContent = session.finalized ? "This note is finalized." : "Draft note is editable.";
}

function handlePrintSoapNote() {
  const session = selectedSession();
  if (!session) return;
  const noteWindow = window.open("", "_blank");
  if (!noteWindow) {
    noteStatus.textContent = "Popup blocked. Allow popups to print the note.";
    return;
  }
  noteWindow.document.write(`
    <!doctype html>
    <html>
      <head>
        <title>${escapeHtml(soapNoteFileBase(session))}</title>
        <style>
          body { font-family: Arial, sans-serif; color: #17212b; margin: 32px; line-height: 1.5; }
          h1 { font-size: 22px; margin: 0 0 8px; }
          p { margin: 0 0 16px; color: #59656f; }
          pre { white-space: pre-wrap; font: inherit; }
          @page { margin: 0.65in; }
        </style>
      </head>
      <body>
        <h1>${escapeHtml(selectedSoapNoteTitle.textContent)}</h1>
        <p>${escapeHtml(lookups().clientName(session.clientId))} - ${formatDate(session.date)}</p>
        <pre>${escapeHtml(soapEditor.value)}</pre>
      </body>
    </html>
  `);
  noteWindow.document.close();
  noteWindow.focus();
  noteWindow.print();
}

function handleDownloadSoapNote(format) {
  const session = selectedSession();
  if (!session) return;
  const base = soapNoteFileBase(session);
  if (format === "html") {
    downloadFile(`${base}.html`, soapNoteHtml(session), "text/html");
    return;
  }
  downloadFile(`${base}.txt`, soapEditor.value, "text/plain");
}

function soapNoteFileBase(session) {
  return `${safeFilename(lookups().clientName(session.clientId))}-${session.serviceType || "97153"}-${session.date}`;
}

function soapNoteHtml(session) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>${escapeHtml(soapNoteFileBase(session))}</title>
    <style>
      body { font-family: Arial, sans-serif; color: #17212b; margin: 32px; line-height: 1.5; }
      h1 { font-size: 22px; margin: 0 0 8px; }
      p { margin: 0 0 16px; color: #59656f; }
      pre { white-space: pre-wrap; font: inherit; }
    </style>
  </head>
  <body>
    <h1>${escapeHtml(selectedSoapNoteTitle.textContent)}</h1>
    <p>${escapeHtml(lookups().clientName(session.clientId))} - ${formatDate(session.date)}</p>
    <pre>${escapeHtml(soapEditor.value)}</pre>
  </body>
</html>`;
}

async function handleFinalize() {
  const session = selectedSession();
  if (!session) return;
  noteStatus.textContent = "";
  try {
    await updateNote(session.id, soapEditor.value, true);
    await refreshData();
    renderHistory();
    renderNote();
    renderSoapSummary();
    noteStatus.textContent = "SOAP note finalized.";
  } catch (error) {
    noteStatus.textContent = error.message;
  }
}

function currentClient() {
  return state.clients.find((client) => client.id === clientSelect.value) || state.clients[0];
}

function currentClientProfilePayload(client = currentClient()) {
  return {
    name: client?.name || "",
    dob: client?.dob || "",
    defaultSetting: client?.defaultSetting || "",
    status: client?.status || "active",
    caregivers: client?.profile?.caregivers || "",
    school: client?.profile?.school || "",
    diagnosis: client?.profile?.diagnosis || "",
    communication: client?.profile?.communication || "",
    profileNotes: client?.profile?.notes || "",
    authorizationNumber: client?.profile?.authorization?.number || "",
    funder: client?.profile?.authorization?.funder || "",
    authorizationStart: client?.profile?.authorization?.startDate || "",
    authorizationEnd: client?.profile?.authorization?.endDate || "",
    authorizationNotes: client?.profile?.authorization?.notes || "",
    auth97153Hours: client?.profile?.authorization?.services?.["97153"]?.hours || "",
    auth97153Units: client?.profile?.authorization?.services?.["97153"]?.units || "",
    auth97155Hours: client?.profile?.authorization?.services?.["97155"]?.hours || "",
    auth97155Units: client?.profile?.authorization?.services?.["97155"]?.units || "",
    auth97156Hours: client?.profile?.authorization?.services?.["97156"]?.hours || "",
    auth97156Units: client?.profile?.authorization?.services?.["97156"]?.units || "",
    auth97151Hours: client?.profile?.authorization?.services?.["97151"]?.hours || "",
    auth97151Units: client?.profile?.authorization?.services?.["97151"]?.units || "",
    assessmentType: client?.profile?.assessment?.type || "",
    assessmentDate: client?.profile?.assessment?.date || "",
    assessmentConductedBy: client?.profile?.assessment?.conductedBy || "",
    assessmentFileName: client?.profile?.assessment?.fileName || "",
    assessmentNotes: client?.profile?.assessment?.notes || "",
    intakeInterview: structuredClone(client?.profile?.intakeInterview || {}),
    parentTrainingGoals: structuredClone(client?.profile?.parentTrainingGoals || [])
  };
}

function replaceClient(updated) {
  const index = state.clients.findIndex((item) => item.id === updated.id);
  if (index >= 0) state.clients[index] = updated;
}

function clientPrograms() {
  return currentClient()?.programs || state.programs || [];
}

function clientBehaviors() {
  return currentClient()?.behaviors || state.behaviors || [];
}

function clientRbtPerformanceAreas() {
  const areas = currentClient()?.rbtPerformanceAreas;
  if (!Array.isArray(areas) || !areas.length) return structuredClone(defaultRbtPerformanceAreas);
  return structuredClone(areas);
}

function clientDomains() {
  const programDomains = clientPrograms().map((program) => program.domain).filter(Boolean);
  return [...new Set([...(currentClient()?.domains || []), ...domainOptions, ...programDomains])];
}

function groupedProgramsByDomain(programs) {
  return clientDomains().map((domain) => [
    domain,
    programs.filter((program) => (program.domain || clientDomains()[0]) === domain)
  ]);
}

function populateDomainSelect(select, selected = clientDomains()[0]) {
  select.innerHTML = clientDomains().map((domain) => (
    `<option value="${escapeHtml(domain)}" ${domain === selected ? "selected" : ""}>${escapeHtml(domain)}</option>`
  )).join("");
}

function currentSessions() {
  const client = currentClient();
  return state.sessions.filter((session) => session.clientId === client?.id);
}

function selectedSession() {
  const sessions = currentSessions();
  return sessions.find((session) => session.id === state.selectedSessionId) || sessions[0];
}

function lookups() {
  return {
    clientName: (id) => state.clients.find((item) => item.id === id)?.name || "Client",
    programName: (id) => clientPrograms().find((item) => item.id === id)?.name || state.programs.find((item) => item.id === id)?.name || "Program",
    targetName: (programId, targetId) => {
      const program = clientPrograms().find((item) => item.id === programId) || state.programs.find((item) => item.id === programId);
      if (targetId === programId) return "Legacy program-level data";
      return program?.targets?.find((item) => item.id === targetId)?.name || "Target";
    },
    behaviorName: (id) => clientBehaviors().find((item) => item.id === id)?.name || state.behaviors.find((item) => item.id === id)?.name || "Behavior"
  };
}

function syncTargetOptions(row, selected = "") {
  const programId = row.querySelector('[data-field="programId"]').value;
  const program = clientPrograms().find((item) => item.id === programId);
  populateSelect(row.querySelector('[data-field="targetId"]'), program?.targets || [], selected);
  updateRowDomain(row);
}

function updateRowDomain(row) {
  const programId = row.querySelector('[data-field="programId"]').value;
  const program = clientPrograms().find((item) => item.id === programId);
  row.dataset.domain = program?.domain || "General";
}

function renderDomainTabs() {
  const domains = [...new Set([...programList.querySelectorAll(".program-row")]
    .map((row) => row.dataset.domain || "General"))];

  if (!domains.length) {
    domainTabs.innerHTML = "";
    return;
  }

  if (!state.activeDomain || !domains.includes(state.activeDomain)) {
    state.activeDomain = domains[0];
  }

  domainTabs.innerHTML = domains.map((domain) => `
    <button type="button" class="domain-tab ${domain === state.activeDomain ? "active" : ""}" data-domain-tab="${escapeHtml(domain)}">
      ${escapeHtml(domain)}
    </button>
  `).join("");

  domainTabs.querySelectorAll("[data-domain-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeDomain = button.dataset.domainTab;
      renderDomainTabs();
    });
  });

  applyDomainFilter();
}

function applyDomainFilter() {
  [...programList.querySelectorAll(".program-row")].forEach((row) => {
    row.classList.toggle("hidden", (row.dataset.domain || "General") !== state.activeDomain);
  });
}

function targetEntries(session) {
  const structuredTargets = (session.programs || []).flatMap((program) => {
    if (Array.isArray(program.targets)) {
      return program.targets.map((target) => ({ ...target, programId: program.programId }));
    }
    return [{ ...program, targetId: program.targetId || program.programId }];
  });
  const actualTargets = structuredTargets.filter(isActualTargetEntry);
  return actualTargets.length ? structuredTargets : recoverTargetsFromSoap(session.soapNote);
}

function configuredTargetsForProgram(program) {
  return (program.targets || []).map((target) => ({ id: target.id, name: target.name }));
}

function isActualTargetEntry(target) {
  return target.targetId && target.targetId !== target.programId;
}

function recoverTargetsFromSoap(soapNote = "") {
  const look = lookups();
  return clientPrograms().flatMap((program) => (
    (program.targets || []).flatMap((target) => {
      const pattern = `${escapeRegExp(program.name)}\\s+-\\s+${escapeRegExp(target.name)}:\\s+(\\d+)% independence \\((\\d+)\\/(\\d+) correct\\), prompt level:\\s+([^.;]+)`;
      const matches = [...soapNote.matchAll(new RegExp(pattern, "g"))];
      return matches.map((match) => ({
        programId: program.id,
        targetId: target.id,
        independence: Number(match[1]),
        correct: Number(match[2]),
        trials: Number(match[3]),
        incorrect: Math.max(Number(match[3]) - Number(match[2]), 0),
        promptLevel: match[4].trim()
      }));
    })
  )).filter((target) => look.targetName(target.programId, target.targetId) !== "Target");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function downloadFile(fileName, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function safeFilename(value) {
  return String(value || "export").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "export";
}

function refreshTargetAvailability() {
  const selected = selectedTargetKeys();
  [...programList.querySelectorAll(".program-row")].forEach((row) => {
    const programId = row.querySelector('[data-field="programId"]').value;
    const targetSelect = row.querySelector('[data-field="targetId"]');
    [...targetSelect.options].forEach((option) => {
      const key = targetKey(programId, option.value);
      option.disabled = option.value !== targetSelect.value && selected.has(key);
    });
  });
}

function selectedTargetKeys(container = programList) {
  return new Set([...container.querySelectorAll(".program-row")]
    .map((row) => targetKey(
      row.querySelector('[data-field="programId"]').value,
      row.querySelector('[data-field="targetId"]').value
    ))
    .filter(Boolean));
}

function duplicateTargetNames(targets) {
  const seen = new Set();
  const duplicates = new Set();
  targets.forEach((target) => {
    const key = targetKey(target.programId, target.targetId);
    if (seen.has(key)) duplicates.add(lookups().targetName(target.programId, target.targetId));
    seen.add(key);
  });
  return [...duplicates];
}

function targetKey(programId, targetId) {
  return programId && targetId ? `${programId}:${targetId}` : "";
}

function refreshBehaviorAvailability() {
  const selected = selectedBehaviorKeys();
  [...behaviorList.querySelectorAll(".behavior-row")].forEach((row) => {
    const behaviorSelect = row.querySelector('[data-field="behaviorId"]');
    [...behaviorSelect.options].forEach((option) => {
      option.disabled = option.value !== behaviorSelect.value && selected.has(option.value);
    });
  });
}

function selectedBehaviorKeys(container = behaviorList) {
  return new Set([...container.querySelectorAll(".behavior-row")]
    .map((row) => row.querySelector('[data-field="behaviorId"]').value)
    .filter(Boolean));
}

function duplicateBehaviorNames(behaviors) {
  const seen = new Set();
  const duplicates = new Set();
  behaviors.forEach((behavior) => {
    if (seen.has(behavior.behaviorId)) duplicates.add(lookups().behaviorName(behavior.behaviorId));
    seen.add(behavior.behaviorId);
  });
  return [...duplicates];
}

function slugify(value, fallback, existingIds) {
  const base = value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || fallback;
  let candidate = base;
  let index = 2;
  while (existingIds.includes(candidate)) {
    candidate = `${base}-${index}`;
    index += 1;
  }
  return candidate;
}

function cryptoId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function signatureBlock(signature, credential, date) {
  const signedBy = signature?.trim() || "Provider signature";
  const credentialText = credential?.trim() ? `, ${credential.trim()}` : "";
  return `Provider signature: ${signedBy}${credentialText}\nDate signed: ${formatDate(date || new Date().toISOString().slice(0, 10))}`;
}

function reportFilePreview(file, label) {
  if (!file) return `<p class="muted">No ${escapeHtml(label.toLowerCase())} uploaded.</p>`;
  const fileName = escapeHtml(file.name);
  if (file.type.startsWith("image/")) {
    return `
      <figure class="report-upload-preview">
        <img src="${URL.createObjectURL(file)}" alt="${escapeHtml(label)} upload">
        <figcaption>${fileName}</figcaption>
      </figure>
    `;
  }
  return `<p><strong>${escapeHtml(label)} uploaded:</strong> ${fileName}</p>`;
}

function defaultBackgroundInformation() {
  return `The client is a [age]-year-old [male/female] diagnosed with Autism Spectrum Disorder. The client resides with [caregivers/family members] and currently attends [school/setting, if applicable].
Developmental history indicates delays in [expressive language, receptive language, social skills, adaptive functioning]. The client currently communicates using [single words/phrases/AAC/PECS], with [limited/emerging] ability to engage in reciprocal communication.
Socially, the client demonstrates [limited/emerging] interest in peers and has difficulty with [turn-taking, joint attention, sustaining interactions]. The client benefits from [structured routines, visual supports, reinforcement systems].
The client has a history of maladaptive behaviors, including [list behaviors], which interfere with learning and daily functioning. The client is currently receiving ABA services to address communication, behavior reduction, and skill acquisition across settings.`;
}

function interviewBackground(interview) {
  return `Caregiver interview indicates that the client resides with ${interview.householdMembers || "[caregivers/family members]"} and is primarily supported by ${interview.primaryCaregivers || "[primary caregivers]"}. Diagnostic history includes ${interview.autismDiagnosis || "[an autism diagnosis / developmental concerns]"}${interview.diagnosisSourceDate ? `, with diagnosis details reported as ${interview.diagnosisSourceDate}` : ""}. Additional evaluations include ${interview.priorEvaluations || "[psychological, speech, developmental, or educational evaluations]"}. Early development was described as ${interview.milestones || "[meeting or not meeting early milestones as expected]"}${interview.earlyDevelopmentNotes ? `, with notable developmental history including ${interview.earlyDevelopmentNotes}` : ""}. The client currently communicates using ${interview.communicationMethod || "[single words, phrases, AAC, gestures, or caregiver report of current communication style]"} and demonstrates strengths including ${interview.strengths || "[emerging skills, interests, and motivators]"}.`;
}

function defaultMedicalConcerns() {
  return `At this time, the client is reported to be in [good/overall stable] health. There are [no significant / the following] medical concerns impacting treatment: [insert if applicable].
The client is currently [not taking / taking] medication(s): [list medications if applicable], which [do/do not] impact behavior or learning.
Caregivers report [no concerns / concerns] related to sleep, feeding, or toileting. Any noted concerns include: [brief description].
Due to the diagnosis of Autism Spectrum Disorder, the client may exhibit sensory sensitivities (e.g., noise, textures, transitions), which can affect participation and behavior.
The client is able to participate in ABA services, and ongoing monitoring of medical and developmental status is recommended.`;
}

function interviewMedicalConcerns(interview) {
  return `Medical history provided by caregivers includes ${interview.medicalHistory || "[no major medical concerns reported / relevant medical history to be added]"}. Caregivers reported ${interview.seizuresAllergiesMedications || "[no seizures, allergies, or medication concerns reported]"}${interview.sleepQuality ? `. Sleep was described as ${interview.sleepQuality}` : ""}${interview.feedingConcerns ? `. Feeding concerns include ${interview.feedingConcerns}` : ""}${interview.painTolerance ? `. Caregivers described pain tolerance as ${interview.painTolerance}` : ""}. Ongoing monitoring of medical and developmental status is recommended as treatment continues.`;
}

function defaultReasonForReferral() {
  return `The client was referred for Applied Behavior Analysis (ABA) services due to concerns regarding delays in communication, social interaction, and adaptive functioning associated with Autism Spectrum Disorder.
Primary concerns include [limited functional communication, difficulty following instructions, reduced social engagement]. The client demonstrates challenges in [expressive/receptive language, responding to questions, engaging in conversation].
Additionally, the client engages in maladaptive behaviors, including [list behaviors], which occur in response to [demands, transitions, denied access, etc.].
These deficits significantly impact the client’s ability to function independently and participate in daily activities across home, school, and community settings. ABA services were recommended to increase functional skills and reduce behaviors that interfere with learning.`;
}

function interviewReasonForReferral(interview) {
  return `The client was referred for Applied Behavior Analysis (ABA) services due to ${interview.autismDiagnosis || interview.reasonForReferral || "[caregiver and provider concerns related to autism and developmental needs]"}. Caregiver priorities include ${interview.topPriorityBehavior || interview.concerningBehaviors || "[behavior reduction and skill development concerns]"} as well as broader concerns related to ${interview.schoolChallenges || interview.peerInteraction || "[communication, social interaction, adaptive functioning, and school participation]"}. Additional services currently in place include ${interview.currentServices || "[speech, occupational therapy, educational supports, or other related services]"}${interview.serviceFrequency ? `, with services occurring ${interview.serviceFrequency}` : ""}. ABA was recommended to address behavior, communication, adaptive skills, and parent priorities across settings.`;
}

function defaultImpactOfBehaviors() {
  return `The client’s maladaptive behaviors interfere with their ability to access learning opportunities and develop age-appropriate skills.
Behaviors such as [task refusal, tantrums, elopement, etc.] limit the client’s ability to participate in structured activities, complete tasks, and follow adult-directed instruction. As a result, the client requires increased prompting and support to engage in daily routines.
These behaviors also present safety concerns, particularly in [school/community] settings, where the client may [leave designated areas, fail to respond to directives, engage in unsafe actions].
Communication deficits further contribute to maladaptive behaviors, as the client may rely on problem behavior to express needs or escape demands.
Socially, these behaviors reduce opportunities for peer interaction and participation in group activities, impacting the development of appropriate social skills.
Overall, these behaviors significantly limit the client’s independence and ability to function across environments, supporting the need for continued intervention.`;
}

function interviewImpactOfBehaviors(interview) {
  return `Caregiver interview indicates that behaviors of concern include ${interview.concerningBehaviors || "[task refusal, tantrums, elopement, aggression, or other maladaptive behaviors]"}${interview.behaviorDescription ? `, described as ${interview.behaviorDescription}` : ""}. Caregivers reported that these behaviors typically occur ${interview.behaviorWhen || "[during challenging routines or demands]"} and are often triggered by ${interview.behaviorTriggers || "[demands, denied access, transitions, or other antecedents]"}. Following the behavior, ${interview.behaviorAfter || "[relevant consequences or responses occur]"}, and caregivers currently respond by ${interview.behaviorResponse || "[using their current response strategies]"}. These concerns interfere with participation across home, school, and community environments and contribute to the need for continued intervention.`;
}

function defaultFamilyStrengths() {
  return `The client demonstrates several strengths that support progress in treatment. The client exhibits [positive affect, responsiveness to reinforcement, interest in preferred activities], which facilitate engagement during sessions.
The client has emerging skills in [communication, imitation, following instructions], providing a foundation for continued development. The client responds well to [visual supports, structured routines, reinforcement systems].
The family is actively involved in the client’s care and demonstrates a willingness to participate in treatment and implement recommended strategies. Caregivers are [consistent, communicative, receptive to feedback], which supports generalization of skills across settings.
The family provides a supportive environment that promotes learning and collaboration with service providers. These strengths are expected to contribute to continued progress and positive treatment outcomes.`;
}

function interviewFamilyStrengths(interview) {
  return `Client strengths reported during interview include ${interview.strengths || "[positive affect, responsiveness to reinforcement, interests, and emerging skills]"}. Preferred interests and likely reinforcers include ${interview.preferredInterests || "[preferred activities, toys, videos, songs, or sensory interests]"}. Family strengths include the involvement of ${interview.primaryCaregivers || interview.caregiversPresent || "[engaged caregivers]"} and their willingness to report on routines, challenges, and priorities. Current caregiver priorities include ${interview.topPriorityBehavior || interview.schoolChallenges || "[behavior, communication, adaptive, or social goals]"}, which will help guide treatment planning and generalization.`;
}

function defaultInitialObservations() {
  return `The client was observed in a [clinic/home/school] setting during the initial assessment. The client presented as [alert, calm, active] and transitioned to the assessment environment with [minimal/moderate] prompting.
During the observation, the client engaged with [preferred items/activities] and demonstrated [increased/decreased] engagement during structured tasks. Participation decreased during [non-preferred tasks/transitions].
Communication was observed to consist of [single words/phrases/AAC use], with [limited/emerging] spontaneous language. The client required prompting to respond to questions and follow instructions.
Behaviorally, the client engaged in [task refusal, avoidance, elopement, etc.], particularly when demands were placed. These behaviors were managed with [redirection, reinforcement, visual supports].
The client demonstrated improved engagement when provided with structure and reinforcement. Overall, observations are consistent with deficits in communication, social interaction, and behavioral regulation, supporting the need for ABA services.`;
}

function interviewInitialObservations(interview) {
  return `During the initial interview and review of current functioning, caregivers described communication as ${interview.communicationMethod || "[single words, phrases, AAC use, gestures, or limited functional communication]"}. Social functioning was described through peer interaction such as ${interview.peerInteraction || "[limited or emerging interaction with peers]"}, and school-related concerns include ${interview.teacherConcerns || interview.schoolChallenges || "[academic, behavioral, or classroom readiness concerns]"}. Current educational placement was reported as ${interview.schoolAttendance || interview.schoolSetting || "[school, daycare, home, or other setting]"}. VB-MAPP screening discussion suggested skill levels consistent with caregiver report across early manding, listener responding, imitation, play, and social domains, with notable details including ${interview.level1Manding || interview.level2Manding || interview.level3Manding || "[language and learning profile details to be further assessed]"}.`;
}

function defaultInstructionalGoalsInfo() {
  return "The following skills will be taught utilizing the listed instructional methods in order to replace the client's problem behavior, increase social skills and independence, and achieve the quality of life outcomes that are the focus of this plan. These goals are derived from the ultimate outcomes desired through intervention and functional behavioral and curricular assessments, and include instruction in skills relevant to functional communication, tolerance and coping, social interaction, and daily living. The short term objectives will be addressed first during intervention, with additional targets being added as the client masters those listed. In order to develop the skills identified, the behavioral intervention professionals and caregiver will task analyze complex skills, develop routine-specific instructional plans, and use appropriate chaining, shaping, and prompting methods. Teaching plans will include the specific skills or skill sequences to be taught, environmental arrangements to promote skill use (e.g., token boards, timers, visual schedules), and other specific instructional procedures.";
}

function defaultGeneralizationMaintenance() {
  return "As the client makes progress on the goals identified in this plan, specific strategies will be used to promote generalization across people, settings, and circumstances and improve the durability of the behavioral outcomes. Specifically, the target contexts will include the home, outside areas of home, and the community when applicable. To enhance generalization, behavioral intervention goals and strategies will be integrated into the client's home life with family and the behavior analyst will collaborate with doctors, speech therapists, and teachers if requested. Specific strategies to promote generalization include teaching within the natural routines and environment, engaging caregivers in instructional and behavioral processes, relying on natural cues and reinforcers over time by fading prompts and cues, thinning contrived reinforcers, and expanding exemplars and contexts for implementation.";
}

function defaultBarriersToTreatmentSummary() {
  return "Implementation of this intervention plan could be affected by the following: lack of outings with family due to resources or time, and lack of socialization opportunities with peers. To overcome these barriers, we will provide times when we can assist parents in community outings, plan for outings that include opportunities to play with similar-aged peers, provide written materials with supportive strategies for behavior management in and out of the home, and provide parents with additional data sheets with planned targets that can be implemented when we are not present. Examples include changes to medications, changes to the home environment and dynamic, changes to family structure and routine, access to community resources, access to reinforcement, competing demands for caregivers and household, multiple caregivers, large family dynamic, language barriers, medical issues, and inconsistent schedules. Barriers do not include unavailable staff, caregiver resistance to training, cancellations, or similar administrative issues.";
}

function defaultRecommendations() {
  return "To implement this behavior intervention plan with integrity, the hours summarized in the table below are recommended. The BCBA will be responsible for providing initial training on the plan, coordinating with other service providers, designing instructional procedures, monitoring the outcomes, providing oversight for the behavior assistant, and assisting in ongoing planning and problem-solving. BCBAs will provide oversight for BCaBAs if assigned. The behavior assistant will facilitate day-to-day implementation of the plan, collecting data and working closely with caregivers and professionals. This plan will include shifting responsibility for monitoring to the caregivers over time.";
}

function defaultMedicalNecessity() {
  return "Clinical Summary Justifying Hours Requested:\nFocused ABA Treatment. Focused ABA generally ranges from 10-25 hours per week of direct treatment plus direct and indirect supervision and caregiver training. However, certain programs for severe destructive behavior may require more than 30 hours per week of direct therapy, for example day treatment or inpatient programming for severe self-injurious behavior. This BCBA is requesting 30 RBT hours a week (2,880 total units), BCBA direct protocol modification 6 hours per week (576 total units), and 1 BCBA family/caregiver training hour per week (96 total units) to help the client increase their quality of life and decrease maladaptive behaviors.";
}

function defaultDischargeCriteria() {
  return "The anticipated date to transition to a lower level of care is ____________. Services will be systematically faded when maladaptive behaviors (50% to 95%) and increases in independent skill performance (60% to greater than or equal to 90-95%) maintained for a minimum of three consecutive months at each level.";
}

function renderDischargeCriteria(values) {
  const objectiveItems = [
    ["Communication", values.get("dischargeCommunication")],
    ["Socialization", values.get("dischargeSocialization")],
    ["Adaptive", values.get("dischargeAdaptive")],
    ["Executive functioning", values.get("dischargeExecutive")]
  ].filter(([, text]) => String(text || "").trim());

  return `
    ${reportParagraph(values.get("dischargeCriteria") || defaultDischargeCriteria())}
    <p>Long-term objectives or goals for discharge:</p>
    ${objectiveItems.length ? `
      <ul class="mastered-target-list">
        ${objectiveItems.map(([label, text]) => `
          <li><strong>${escapeHtml(label)}:</strong> <span>${escapeHtml(text)}</span></li>
        `).join("")}
      </ul>
    ` : "<p>No discharge objectives were entered.</p>"}
  `;
}

function readFadePlanRows() {
  return [...fadePlanRows.querySelectorAll(".fade-plan-row")].map((row) => readDataRow(row)).filter((row) => (
    row.phase || row.actionStep || row.criteria || row.timeFrame || row.bcbaReduction || row.rbtReduction
  ));
}

function renderFadePlanTable() {
  const rows = readFadePlanRows();
  if (!rows.length) return "<p>No fade out plan phases were entered.</p>";
  return `
    <div class="report-table-wrap">
      <table class="fade-plan-table">
        <thead>
          <tr>
            <th>Phase</th>
            <th>Action Step</th>
            <th>Criteria</th>
            <th>Time Frame</th>
            <th>BCBA reduction</th>
            <th>RBT reduction</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => `
            <tr>
              <td>${escapeHtml(row.phase)}</td>
              <td>${escapeHtml(row.actionStep)}</td>
              <td>${escapeHtml(row.criteria)}</td>
              <td>${escapeHtml(row.timeFrame)}</td>
              <td>${escapeHtml(row.bcbaReduction)}</td>
              <td>${escapeHtml(row.rbtReduction)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function defaultFadePlanRows() {
  return [
    {
      phase: "1",
      actionStep: "Diminished rates of target behavior, increased skill acquisition and replacement skills",
      criteria: "Target problem behaviors reduced by 50%. Acquisition behaviors displayed independently at 60%.",
      timeFrame: "50% reductions sustained for 3 consecutive months. 50% independently displayed for 3 consecutive months.",
      bcbaReduction: "Fade from 6 to 5 hrs/wk",
      rbtReduction: "Fade from 30 to 25 hr/wk"
    },
    {
      phase: "2",
      actionStep: "Maintain Phase 1 and increase rate of replacement behaviors increase by 50% average",
      criteria: "Target problem behaviors reduced by 75%. Acquisition behaviors displayed independently at 75%.",
      timeFrame: "75% reductions sustained for 3 consecutive months. 75% independently displayed for 3 consecutive months.",
      bcbaReduction: "Reduce to 4 hrs/wk",
      rbtReduction: "Reduce to 20 hr/wk"
    },
    {
      phase: "3",
      actionStep: "Phase 2 sustained and further increased in rate of replacement behaviors",
      criteria: "Target problem behaviors reduced by 80%. Replacement skills and skill acquisition behaviors displayed independently at 80%.",
      timeFrame: "80% reductions sustained for 3 consecutive months. 80% independently displayed for 3 consecutive months.",
      bcbaReduction: "Reduce to 3 hr/wk, every other week",
      rbtReduction: "Reduce to 15 hr/wk"
    },
    {
      phase: "4",
      actionStep: "Criteria for target behaviors and replacement skills reached",
      criteria: "Target problem behaviors reduced by 95%. Acquisition behaviors displayed independently at 95%.",
      timeFrame: "95% reductions sustained for 3 consecutive months. 95% independently displayed for 3 consecutive months.",
      bcbaReduction: "Reduce to 2 hr/wk, every other week, then 1 hr/mo",
      rbtReduction: "Reduce to 10 hr/wk"
    },
    {
      phase: "5",
      actionStep: "Maintain current performance",
      criteria: "Maintain reductions and independence across environments",
      timeFrame: "1 month maintenance",
      bcbaReduction: "Reduce to 1 hr/week, then monthly",
      rbtReduction: "Reduce to 5 hrs/week"
    },
    {
      phase: "6",
      actionStep: "Maintain current performance",
      criteria: "Maintain current performance",
      timeFrame: "1 month",
      bcbaReduction: "Services discontinued",
      rbtReduction: "Services discontinued"
    }
  ];
}

function readServiceHourRows() {
  return [...serviceHourRows.querySelectorAll(".service-hours-row")].map((row) => readDataRow(row)).filter((row) => (
    row.serviceCode || row.provider || row.hours || row.setting
  ));
}

function renderServiceHoursTable() {
  const rows = readServiceHourRows();
  if (!rows.length) return "<p>No service-hour recommendations were entered.</p>";
  return `
    <div class="report-table-wrap">
      <table class="fade-plan-table service-hours-table">
        <thead>
          <tr>
            <th>Service / Code</th>
            <th>Provider</th>
            <th>Recommended hours</th>
            <th>Setting</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => `
            <tr>
              <td>${escapeHtml(row.serviceCode)}</td>
              <td>${escapeHtml(row.provider)}</td>
              <td>${escapeHtml(row.hours)}</td>
              <td>${escapeHtml(row.setting)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function defaultServiceHourRows() {
  return [
    {
      serviceCode: "97153",
      provider: "Behavior assistant / RBT",
      hours: "30 hours per week (120 units per week)",
      setting: "Home, clinic, community"
    },
    {
      serviceCode: "97155",
      provider: "BCBA / Lead Analyst",
      hours: "6 hours per week (22 units per week)",
      setting: "Home, clinic, community"
    },
    {
      serviceCode: "97156",
      provider: "BCBA / Lead Analyst",
      hours: "1 hour per week (4 units per week)",
      setting: "Caregiver training setting"
    },
    {
      serviceCode: "97151",
      provider: "BCBA / Lead Analyst",
      hours: "4.5 hours total (18 units total)",
      setting: "Assessment and reassessment"
    }
  ];
}

function reportParagraph(value) {
  return String(value || "")
    .split(/\n+/)
    .filter((line) => line.trim())
    .map((line) => `<p>${escapeHtml(line.trim())}</p>`)
    .join("") || "<p></p>";
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDate(value) {
  return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}
