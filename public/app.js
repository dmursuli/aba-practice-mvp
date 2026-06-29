import { createAuditEvent, createClient, createSession, createUser, deleteClient, deleteClientDocument, deleteSession, deleteSessionBehaviorData, deleteSessionParentGoalData, deleteSessionTargetData, getAuditLog, getCurrentUser, getData, getPracticeBackup, getRecoverableDrafts, getUsers, importHistoricalData, login, logout, preserveDrafts, resendSignInCode, restorePracticeBackup, rollbackHistoricalImport, setupVerificationEmail, touchSession, updateClientPlan, updateClientProfile, updateClientWorkflow, updateNote, updateUser, uploadClientDocument, verifySignInCode } from "./api.js";
import { buildGraphAnalysis, buildLegendItems, drawLineChart, formatGraphDate, filterSeriesPointsByDateRange } from "./charts.js";
import { graphScopeVisibility } from "./graph-ui.js";
import { buildHistoricalImportCsvTemplate, parseHistoricalImportCsv, validateHistoricalImportRows } from "./historical-import-utils.js";
import { buildEditableParentTrainingSummary, filterMasteredGoalsForPeriod, isLegacyGeneratedParentTrainingSummary, parentTrainingGoalKey, parentTrainingGoalLabel, summarizeParentTrainingReport } from "./parent-training-report.js";
import { buildCompactGraphAnalysisSentence, buildEditableSkillAcquisitionSummary, buildFunderDraftRecord, estimateJsonBytes, hasMeaningfulFunderReportDraft, isLegacyGeneratedSkillAcquisitionSummary, parseNumberedObjectives, sanitizeAssessmentDocumentRefs, sanitizeCustomPhaseLines, sanitizeTrendVisibilityMap, summarizeSkillAcquisitionReport } from "./report-utils.js";
import { generateSoapNote } from "./soap.js";
import { availableBehaviorsForSession, availableTargetsForSession, dedupeBehaviorEntries, dedupeTargetEntries, duplicateBehaviorIds, duplicateTargetIdsFromPrograms } from "./session-utils.js";

const state = {
  clients: [],
  programs: [],
  behaviors: [],
  sessions: [],
  auditLog: [],
  healthIssues: [],
  users: [],
  selectedSessionId: null,
  selectedSoapEntryKey: "",
  activeClientId: "",
  activeDomain: "",
  activeSessionTargetTab: "active",
  activeParentGoalTab: "active",
  activePlanDomain: "",
  activePlanProgramTab: "active",
  activePlanReviewFilter: "",
  activeGraphTab: "skills",
  activeGraphDomain: "",
  activeSoapHistoryTab: "97153",
  currentUser: null,
  skipNextSessionDraftRestore: false,
  loadedSessionDomainKeys: [],
  authFlow: "password",
  authChallenge: null,
  graphTrendVisibility: {},
  behaviorGraphRangePreset: "default",
  behaviorGraphCustomStart: "",
  behaviorGraphCustomEnd: "",
  behaviorGraphShowPoints: true,
  behaviorGraphAnalyzeAllData: false,
  hiddenBehaviorSeries: {},
  draftCache: {
    intake: {},
    session: {}
  },
  reportDraftClientId: "",
  reportDraftSavedSnapshot: "",
  reportDraftDirty: false,
  reportAssessmentDocuments: {
    assessmentGrid: [],
    standardizedAssessmentGrid: []
  },
  historicalImportRows: [],
  historicalImportPreview: null,
  reportCustomPhaseLines: {},
  inactivityTimerId: null,
  inactivityWarningTimerId: null,
  lastSessionTouchAt: 0
};

const roleViews = {
  admin: ["clients", "users", "session", "intake", "workflow", "plan", "parent", "graphs", "import", "report", "soap", "billing", "health", "audit"],
  bcba: ["clients", "session", "intake", "workflow", "plan", "parent", "graphs", "import", "report", "soap", "billing", "health", "audit"],
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

const workflowColumns = [
  { id: "todo", label: "To do" },
  { id: "in-progress", label: "In progress" },
  { id: "done", label: "Done" }
];

const agencyOptions = ["Triumph ABA", "One Clinical Care"];

const loginScreen = document.querySelector("#login-screen");
const loginForm = document.querySelector("#login-form");
const loginMessage = document.querySelector("#login-message");
const loginPanel = document.querySelector("#login-form");
const mfaVerifyPanel = document.querySelector("#mfa-verify-panel");
const verificationEmailForm = document.querySelector("#verification-email-form");
const verificationEmailMessage = document.querySelector("#verification-email-message");
const mfaVerifyForm = document.querySelector("#mfa-verify-form");
const mfaMessage = document.querySelector("#mfa-message");
const mfaCancelButtons = document.querySelectorAll("[data-auth-cancel]");
const resendSignInCodeButton = document.querySelector("#resend-sign-in-code");
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
const deleteClientButton = document.querySelector("#delete-client-button");
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
const workspaceClientSelect = document.querySelector("#workspace-client-select");
const clientSelect = document.querySelector("#client-select");
const managementClientSelect = document.querySelector("#management-client-select");
const bcbaClientSelect = document.querySelector("#bcba-client-select");
const parentClientSelect = document.querySelector("#parent-client-select");
const intakeClientSelect = document.querySelector("#intake-client-select");
const programList = document.querySelector("#program-list");
const targetStatusTabs = document.querySelector("#target-status-tabs");
const parentGoalList = document.querySelector("#parent-goal-list");
const parentGoalTabs = document.querySelector("#parent-goal-tabs");
const domainTabs = document.querySelector("#domain-tabs");
const behaviorList = document.querySelector("#behavior-list");
const skillCharts = document.querySelector("#skill-charts");
const behaviorChartPanel = document.querySelector("#behavior-chart")?.closest(".chart-panel");
const behaviorGraphControls = document.querySelector("#behavior-graph-controls");
const behaviorCharts = document.querySelector("#behavior-charts");
const parentTrainingCharts = document.querySelector("#parent-training-charts");
const graphsClientSummary = document.querySelector("#graphs-client-summary");
const graphScopeTabs = document.querySelector("#graph-scope-tabs");
const graphDomainTabs = document.querySelector("#graph-domain-tabs");
const historicalImportForm = document.querySelector("#historical-import-form");
const historicalImportClientSelect = document.querySelector("#historical-import-client");
const historicalImportDataTypeSelect = document.querySelector("#historical-import-data-type");
const historicalImportMeasurementTypeSelect = document.querySelector("#historical-import-measurement-type");
const historicalImportReferenceSelect = document.querySelector("#historical-import-reference");
const historicalImportDuplicateStrategySelect = document.querySelector("#historical-import-duplicate-strategy");
const historicalImportCsvInput = document.querySelector("#historical-import-csv");
const historicalImportRows = document.querySelector("#historical-import-rows");
const historicalImportMessage = document.querySelector("#historical-import-message");
const historicalImportSummary = document.querySelector("#historical-import-summary");
const historicalImportPreviewTable = document.querySelector("#historical-import-preview-table");
const historicalImportBatches = document.querySelector("#historical-import-batches");
const historicalImportTemplateButton = document.querySelector("#historical-import-template");
const historicalImportAddRowButton = document.querySelector("#historical-import-add-row");
const historicalImportPreviewButton = document.querySelector("#historical-import-preview");
const reportClientSummary = document.querySelector("#report-client-summary");
const workflowBoard = document.querySelector("#workflow-board");
const workflowClientSummary = document.querySelector("#workflow-client-summary");
const workflowMessage = document.querySelector("#workflow-message");
const reportForm = document.querySelector("#funder-report-form");
const reportPreview = document.querySelector("#funder-report-preview");
const reportSectionNav = document.querySelector("#report-section-nav");
const assessmentGridDraftFiles = document.querySelector("#assessment-grid-draft-files");
const standardizedAssessmentGridDraftFiles = document.querySelector("#standardized-assessment-grid-draft-files");
const fadePlanRows = document.querySelector("#fade-plan-rows");
const addFadeRowButton = document.querySelector("#add-fade-row");
const serviceHourRows = document.querySelector("#service-hour-rows");
const addServiceHourRowButton = document.querySelector("#add-service-hour-row");
const printFunderReportButton = document.querySelector("#print-funder-report");
const downloadFunderTextButton = document.querySelector("#download-funder-text");
const downloadFunderHtmlButton = document.querySelector("#download-funder-html");
const saveFunderReportButton = document.querySelector("#save-funder-report");
const resumeFunderReportButton = document.querySelector("#resume-funder-report");
const funderExportStatus = document.querySelector("#funder-export-status");
const note97151Editor = document.querySelector("#note-97151");
const note97151Status = document.querySelector("#note-97151-status");
const generate97151Button = document.querySelector("#generate-97151-note");
const planNote97151Editor = document.querySelector("#plan-note-97151");
const planNote97151Status = document.querySelector("#plan-note-97151-status");
const generatePlan97151Button = document.querySelector("#generate-plan-97151-note");
const soapClientSummary = document.querySelector("#soap-client-summary");
const soapCodeLabel = document.querySelector("#soap-code-label");
const soapHistoryTabs = document.querySelector("#soap-history-tabs");
const planReview = document.querySelector("#plan-review");
const planDomainTabs = document.querySelector("#plan-domain-tabs");
const programGraphModal = document.querySelector("#program-graph-modal");
const programGraphModalTitle = document.querySelector("#program-graph-modal-title");
const programGraphModalSubtitle = document.querySelector("#program-graph-modal-subtitle");
const programGraphModalCanvas = document.querySelector("#program-graph-modal-canvas");
const clientManagementSummary = document.querySelector("#client-management-summary");
const clientProfileMessage = document.querySelector("#client-profile-message");
const authorizationUsage = document.querySelector("#authorization-usage");
const authorizationUsageNote = document.querySelector("#authorization-usage-note");
const clientDocumentMessage = document.querySelector("#client-document-message");
const clientDocumentList = document.querySelector("#client-document-list");
const clientAdminToolbar = document.querySelector("#client-admin-toolbar");
const exportClientPackageButton = document.querySelector("#export-client-package");
const downloadPracticeBackupButton = document.querySelector("#download-practice-backup");
const restorePracticeBackupButton = document.querySelector("#restore-practice-backup");
const newClientMessage = document.querySelector("#new-client-message");
const intakeMessage = document.querySelector("#intake-message");
const intakeSummary = document.querySelector("#intake-summary");
const planClientSummary = document.querySelector("#plan-client-summary");
const planStatusTabs = document.querySelector("#plan-status-tabs");
const parentClientSummary = document.querySelector("#parent-client-summary");
const addProgramForm = document.querySelector("#add-program-form");
const addDomainButton = document.querySelector("#add-domain");
const deleteDomainButton = document.querySelector("#delete-domain");
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

const graphsMessage = ensureGraphsMessage();
const programGraphModalLegend = ensureProgramGraphModalLegend();
const programGraphModalAnalysis = ensureProgramGraphModalAnalysis();
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

const sessionPreloadLimits = {
  activePrograms: 4,
  maintenancePrograms: 2,
  behaviors: 2
};

const INACTIVITY_TIMEOUT_MS = 45 * 60 * 1000;
const INACTIVITY_WARNING_MS = 40 * 60 * 1000;
const SESSION_TOUCH_DEBOUNCE_MS = 60 * 1000;

init().catch(handleBootstrapFailure);

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
  } catch (error) {
    if (["VERIFICATION_REQUIRED", "MFA_REQUIRED", "VERIFICATION_EMAIL_REQUIRED"].includes(error.code)) {
      state.authChallenge = error.details;
      showAuthStep("mfa-verify", error.details);
      return;
    }
    const message = error.code === "SESSION_TIMEOUT"
      ? "Session timed out due to inactivity."
      : error.code === "VERIFICATION_UNAVAILABLE"
        ? error.message
      : error.code === "AUTH_UNAVAILABLE"
        ? "Authentication is temporarily unavailable. Please try again shortly or contact support."
        : "";
    showLogin(message);
  }
}

async function startAuthenticatedApp() {
  showApp();
  state.lastSessionTouchAt = Date.now();
  startInactivityTimer();
  await refreshData();
  await restoreRecoverableDrafts();
  const requested = requestedWorkspaceState();
  if (requested.clientId && state.clients.some((client) => client.id === requested.clientId)) {
    state.activeClientId = requested.clientId;
  }
  preloadTargetRows();
  preloadBehaviorRows();
  preloadParentRows();
  preloadFadePlanRows();
  preloadServiceHourRows();
  render();
  if (requested.view) {
    switchView(requested.view);
  } else {
    syncWorkspaceUrl(currentView());
  }
}

async function restoreRecoverableDrafts() {
  try {
    const drafts = await getRecoverableDrafts();
    if (drafts?.intake && Object.keys(drafts.intake).length) {
      state.draftCache.intake = { ...state.draftCache.intake, ...drafts.intake };
    }
    if (drafts?.session && Object.keys(drafts.session).length) {
      state.draftCache.session = { ...state.draftCache.session, ...drafts.session };
    }
    const restoredIntake = drafts?.intake && Object.keys(drafts.intake).length;
    const restoredSession = drafts?.session && Object.keys(drafts.session).length;
    if (restoredIntake || restoredSession) {
      const parts = [];
      if (restoredSession) parts.push("session drafts");
      if (restoredIntake) parts.push("intake drafts");
      formMessage.textContent = `Recovered ${parts.join(" and ")} from your last timed-out session.`;
      intakeMessage.textContent = formMessage.textContent;
    }
  } catch {}
}

async function preserveRecoverableDrafts() {
  try {
    const clientId = currentClient()?.id || clientSelect.value || intakeClientSelect.value;
    if (clientId && form) saveSessionDraft();
    if (clientId && intakeForm) saveIntakeDraft();
    await preserveDrafts(state.draftCache);
  } catch {}
}

function startInactivityTimer() {
  clearInactivityTimer();
  if (!state.currentUser) return;
  state.inactivityWarningTimerId = window.setTimeout(async () => {
    await preserveRecoverableDrafts();
    const staySignedIn = window.confirm("Your session will expire soon due to inactivity. Stay signed in?");
    if (!staySignedIn) {
      try {
        await preserveRecoverableDrafts();
        await logout("timeout");
      } catch {}
      handleAuthFailureEvent({ code: "SESSION_TIMEOUT", errors: ["You were signed out due to inactivity."] });
      return;
    }
    try {
      await touchSession();
      state.lastSessionTouchAt = Date.now();
    } catch {
      handleAuthFailureEvent({ code: "SESSION_TIMEOUT", errors: ["You were signed out due to inactivity."] });
      return;
    }
    startInactivityTimer();
  }, INACTIVITY_WARNING_MS);
  state.inactivityTimerId = window.setTimeout(async () => {
    try {
      await preserveRecoverableDrafts();
      await logout("timeout");
    } catch {}
    handleAuthFailureEvent({ code: "SESSION_TIMEOUT", errors: ["You were signed out due to inactivity."] });
  }, INACTIVITY_TIMEOUT_MS);
}

function clearInactivityTimer() {
  if (state.inactivityTimerId) {
    window.clearTimeout(state.inactivityTimerId);
    state.inactivityTimerId = null;
  }
  if (state.inactivityWarningTimerId) {
    window.clearTimeout(state.inactivityWarningTimerId);
    state.inactivityWarningTimerId = null;
  }
}

function resetInactivityTimer() {
  if (!state.currentUser) return;
  maybeTouchAuthenticatedSession();
  startInactivityTimer();
}

function maybeTouchAuthenticatedSession() {
  const now = Date.now();
  if (now - Number(state.lastSessionTouchAt || 0) < SESSION_TOUCH_DEBOUNCE_MS) return;
  state.lastSessionTouchAt = now;
  touchSession().catch(() => {
    handleAuthFailureEvent({ code: "SESSION_TIMEOUT", errors: ["You were signed out due to inactivity."] });
  });
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

function ensureGraphsMessage() {
  if (!graphsClientSummary?.parentElement) return { textContent: "" };
  const existing = document.querySelector("#graphs-message");
  if (existing) return existing;
  const node = document.createElement("p");
  node.id = "graphs-message";
  node.className = "form-message";
  node.setAttribute("role", "status");
  graphsClientSummary.insertAdjacentElement("afterend", node);
  return node;
}

function ensureProgramGraphModalLegend() {
  const existing = document.querySelector("#program-graph-modal-legend");
  if (existing) return existing;
  if (!programGraphModalCanvas?.parentElement) return null;
  const node = document.createElement("div");
  node.id = "program-graph-modal-legend";
  programGraphModalCanvas.insertAdjacentElement("afterend", node);
  return node;
}

function ensureProgramGraphModalAnalysis() {
  const existing = document.querySelector("#program-graph-modal-analysis");
  if (existing) return existing;
  const legend = ensureProgramGraphModalLegend();
  if (!legend?.parentElement) return null;
  const node = document.createElement("div");
  node.id = "program-graph-modal-analysis";
  legend.insertAdjacentElement("afterend", node);
  return node;
}

function bindEvents() {
  loginForm.addEventListener("submit", handleLogin);
  verificationEmailForm?.addEventListener("submit", handleSetupVerificationEmail);
  mfaVerifyForm?.addEventListener("submit", handleVerifyMfa);
  resendSignInCodeButton?.addEventListener("click", handleResendSignInCode);
  mfaCancelButtons.forEach((button) => button.addEventListener("click", handleCancelAuthFlow));
  logoutButton.addEventListener("click", handleLogout);
  newUserForm.addEventListener("submit", handleCreateUser);
  newUserForm.elements.role?.addEventListener("change", syncUserRoleControls);
  userList.addEventListener("click", handleUserListClick);
  userList.addEventListener("change", handleUserListChange);
  refreshUsersButton.addEventListener("click", refreshUsers);
  document.querySelectorAll("[data-view-button]").forEach((button) => {
    button.addEventListener("click", (event) => handleViewTabClick(event, button.dataset.viewButton));
  });
  document.querySelector("#add-program").addEventListener("click", () => addFirstAvailableTargetRow());
  document.querySelector("#add-maintenance-target").addEventListener("click", () => addFirstAvailableTargetRow("maintenance"));
  document.querySelector("#add-behavior").addEventListener("click", () => addFirstAvailableBehaviorRow());
  document.querySelector("#add-parent-goal").addEventListener("click", () => addParentGoalRow());
  workspaceClientSelect.addEventListener("change", () => setActiveClient(workspaceClientSelect.value));
  managementClientSelect.addEventListener("change", () => setActiveClient(managementClientSelect.value));
  clientSelect.addEventListener("change", () => setActiveClient(clientSelect.value));
  historicalImportClientSelect?.addEventListener("change", () => setActiveClient(historicalImportClientSelect.value));
  historicalImportDataTypeSelect?.addEventListener("change", handleHistoricalImportTypeChange);
  historicalImportMeasurementTypeSelect?.addEventListener("change", () => {
    state.historicalImportPreview = null;
    renderHistoricalImport();
  });
  historicalImportReferenceSelect?.addEventListener("change", () => {
    state.historicalImportPreview = null;
    renderHistoricalImport();
  });
  historicalImportDuplicateStrategySelect?.addEventListener("change", () => {
    state.historicalImportPreview = null;
    renderHistoricalImport();
  });
  historicalImportAddRowButton?.addEventListener("click", handleAddHistoricalImportRow);
  historicalImportPreviewButton?.addEventListener("click", handlePreviewHistoricalImport);
  historicalImportTemplateButton?.addEventListener("click", handleDownloadHistoricalImportTemplate);
  historicalImportCsvInput?.addEventListener("change", handleHistoricalImportCsvSelected);
  historicalImportRows?.addEventListener("input", handleHistoricalImportRowInput);
  historicalImportRows?.addEventListener("change", handleHistoricalImportRowInput);
  historicalImportRows?.addEventListener("click", handleHistoricalImportRowClick);
  historicalImportBatches?.addEventListener("click", handleHistoricalImportBatchClick);
  form.addEventListener("input", (event) => {
    const row = event.target.closest(".program-row");
    if (row) updateProgramIndependence(row);
    saveSessionDraft();
  });
  form.addEventListener("change", (event) => {
    if (event.target.matches('[data-field="programId"]')) {
      const row = event.target.closest(".program-row");
      syncTargetOptions(row);
      row.dataset.lastTargetId = row.querySelector('[data-field="targetId"]').value || "";
      renderDomainTabs();
      refreshTargetAvailability();
    }
    if (event.target.matches('[data-field="targetId"]')) {
      const row = event.target.closest(".program-row");
      if (selectedTargetIds(programList, row).has(event.target.value)) {
        event.target.value = row.dataset.lastTargetId || "";
        syncTargetOptions(row, event.target.value);
        formMessage.textContent = "This target is already in the session.";
      } else {
        row.dataset.lastTargetId = event.target.value || "";
      }
      refreshTargetAvailability();
    }
    if (event.target.matches('[data-field="behaviorId"]')) {
      const row = event.target.closest(".behavior-row");
      if (selectedBehaviorIds(behaviorList, row).has(event.target.value)) {
        event.target.value = row.dataset.lastBehaviorId || "";
        syncBehaviorOptions(row, event.target.value);
        formMessage.textContent = "This target is already in the session.";
      } else {
        row.dataset.lastBehaviorId = event.target.value || "";
      }
      refreshBehaviorAvailability();
    }
    saveSessionDraft();
  });
  form.addEventListener("submit", handleSubmit);
  clientProfileForm.addEventListener("submit", handleClientProfileSubmit);
  deleteClientButton.addEventListener("click", handleDeleteClient);
  clientDocumentForm.addEventListener("submit", handleClientDocumentSubmit);
  clientDocumentList.addEventListener("click", handleClientDocumentClick);
  exportClientPackageButton.addEventListener("click", handleExportClientPackage);
  downloadPracticeBackupButton.addEventListener("click", handleDownloadPracticeBackup);
  restorePracticeBackupButton.addEventListener("click", handleRestorePracticeBackup);
  newClientForm.addEventListener("submit", handleNewClientSubmit);
  intakeClientSelect.addEventListener("change", () => setActiveClient(intakeClientSelect.value));
  intakeVbMappLevelSelect.addEventListener("change", updateVbMappVisibility);
  intakeVbMappLevelSelect.addEventListener("input", updateVbMappVisibility);
  intakeForm.addEventListener("input", saveIntakeDraft);
  intakeForm.addEventListener("submit", handleIntakeSubmit);
  workflowBoard?.addEventListener("change", handleWorkflowBoardChange);
  workflowBoard?.addEventListener("focusout", handleWorkflowBoardBlur);
  parentTrainingForm.addEventListener("input", (event) => {
    const row = event.target.closest(".parent-goal-row");
    if (row) updateParentGoalScore(row);
  });
  historicalImportForm?.addEventListener("submit", handleCommitHistoricalImport);
  parentTrainingForm.addEventListener("submit", handleParentTrainingSubmit);
  bcbaSessionForm.elements.rbtPresent.addEventListener("change", toggleRbtFeedbackSection);
  rbtFeedbackSection.addEventListener("change", updateRbtFidelityScore);
  rbtFeedbackSection.addEventListener("focusout", handleRbtPerformanceAreaEdit);
  rbtFeedbackSection.addEventListener("click", handleRbtPerformanceAreaClick);
  addRbtPerformanceAreaButton.addEventListener("click", handleAddRbtPerformanceArea);
  addProgramForm.addEventListener("submit", handleAddProgram);
  addDomainButton.addEventListener("click", handleAddDomain);
  deleteDomainButton.addEventListener("click", handleDeleteDomain);
  skillCharts.addEventListener("click", handleGraphDataDeleteClick);
  skillCharts.addEventListener("click", handleGraphPhaseLineClick);
  skillCharts.addEventListener("submit", handleGraphPhaseLineSubmit);
  skillCharts.addEventListener("change", handleGraphAnalysisControlChange);
  behaviorCharts.addEventListener("click", handleGraphDataDeleteClick);
  behaviorCharts.addEventListener("click", handleGraphPhaseLineClick);
  behaviorCharts.addEventListener("submit", handleGraphPhaseLineSubmit);
  behaviorCharts.addEventListener("change", handleGraphAnalysisControlChange);
  behaviorCharts.addEventListener("click", handleGraphAnalysisClick);
  skillCharts.addEventListener("click", handleGraphAnalysisClick);
  parentTrainingCharts.addEventListener("click", handleGraphDataDeleteClick);
  parentTrainingCharts.addEventListener("click", handleGraphPhaseLineClick);
  parentTrainingCharts.addEventListener("submit", handleGraphPhaseLineSubmit);
  parentTrainingCharts.addEventListener("change", handleGraphAnalysisControlChange);
  parentTrainingCharts.addEventListener("click", handleGraphAnalysisClick);
  programGraphModal?.addEventListener("change", handleGraphAnalysisControlChange);
  programGraphModal?.addEventListener("click", handleGraphAnalysisClick);
  reportPreview?.addEventListener("click", handleGraphPhaseLineClick);
  reportPreview?.addEventListener("submit", handleGraphPhaseLineSubmit);
  reportForm.addEventListener("submit", handleGenerateFunderReport);
  reportForm.addEventListener("input", handleReportDraftInput);
  reportForm.addEventListener("change", handleReportFormChange);
  reportForm.addEventListener("click", handleReportFormClick);
  reportSectionNav?.addEventListener("click", handleReportSectionNavClick);
  addFadeRowButton.addEventListener("click", () => {
    addFadePlanRow();
    markReportDraftDirty();
  });
  addServiceHourRowButton.addEventListener("click", () => {
    addServiceHourRow();
    markReportDraftDirty();
  });
  printFunderReportButton.addEventListener("click", () => window.print());
  downloadFunderTextButton.addEventListener("click", () => handleDownloadFunderReport("txt"));
  downloadFunderHtmlButton.addEventListener("click", () => handleDownloadFunderReport("html"));
  saveFunderReportButton?.addEventListener("click", handleSaveFunderReportDraft);
  resumeFunderReportButton?.addEventListener("click", resumeSavedFunderReportDraft);
  generate97151Button.addEventListener("click", handleGenerate97151Note);
  note97151Editor.addEventListener("blur", handleSave97151Note);
  generatePlan97151Button.addEventListener("click", handleGenerate97151Note);
  planNote97151Editor.addEventListener("blur", handleSave97151Note);
  generate97155Button.addEventListener("click", handleGenerate97155Note);
  note97155Editor.addEventListener("blur", handleSave97155Note);
  planReview.addEventListener("change", handlePlanStatusChange);
  planReview.addEventListener("click", handlePlanClick);
  programGraphModal?.addEventListener("click", handleProgramGraphModalClick);
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
  window.addEventListener("aba-auth-error", (event) => handleAuthFailureEvent(event.detail));
  window.addEventListener("pageshow", () => {
    if (state.currentUser) {
      restoreSession();
      return;
    }
    if (!state.authChallenge) showLogin();
  });
  ["click", "keydown", "mousemove", "touchstart", "scroll"].forEach((eventName) => {
    window.addEventListener(eventName, resetInactivityTimer, { passive: true });
  });
}

async function handleLogin(event) {
  event.preventDefault();
  loginMessage.textContent = "";
  const values = new FormData(loginForm);
  try {
    const payload = await login(values.get("username"), values.get("password"));
    loginForm.reset();
    if (payload.user && !payload.verificationRequired && !payload.mfaRequired) {
      state.currentUser = payload.user;
      state.authChallenge = null;
      await startAuthenticatedApp();
      return;
    }
    state.authChallenge = payload;
    showAuthStep("mfa-verify", payload);
  } catch (error) {
    loginMessage.textContent = error.message;
  }
}

async function handleLogout() {
  await logout().catch(() => {});
  resetSensitiveState();
  showLogin();
}

async function handleVerifyMfa(event) {
  event.preventDefault();
  if (!mfaVerifyForm) return;
  mfaMessage.textContent = "";
  const values = new FormData(mfaVerifyForm);
  try {
    const payload = await verifySignInCode(values.get("code"));
    state.currentUser = payload.user;
    state.authChallenge = null;
    mfaVerifyForm.reset();
    await startAuthenticatedApp();
  } catch (error) {
    mfaMessage.textContent = error.message;
  }
}

async function handleResendSignInCode() {
  if (!state.authChallenge) return;
  mfaMessage.textContent = "";
  try {
    const payload = await resendSignInCode();
    state.authChallenge = payload;
    showAuthStep("mfa-verify", payload);
  } catch (error) {
    mfaMessage.textContent = error.message;
  }
}

async function handleSetupVerificationEmail(event) {
  event.preventDefault();
  if (!verificationEmailForm) return;
  verificationEmailMessage.textContent = "";
  const values = new FormData(verificationEmailForm);
  try {
    const payload = await setupVerificationEmail(values.get("email"));
    state.authChallenge = payload;
    showAuthStep("mfa-verify", payload);
  } catch (error) {
    verificationEmailMessage.textContent = error.message;
  }
}

async function handleCancelAuthFlow() {
  await logout().catch(() => {});
  resetSensitiveState();
  showLogin();
}

function handleHistoricalImportTypeChange() {
  populateHistoricalImportMeasurementSelect();
  populateHistoricalImportReferenceSelect();
  state.historicalImportRows = [blankHistoricalImportRow(currentHistoricalImportDataType())];
  state.historicalImportPreview = null;
  renderHistoricalImport();
}

function handleAddHistoricalImportRow() {
  state.historicalImportRows.push(blankHistoricalImportRow(currentHistoricalImportDataType()));
  state.historicalImportPreview = null;
  renderHistoricalImport();
}

function handleHistoricalImportRowInput(event) {
  const rowNode = event.target.closest("[data-historical-row]");
  if (!rowNode) return;
  const row = state.historicalImportRows.find((item) => item.id === rowNode.dataset.historicalRow);
  if (!row) return;
  row[event.target.dataset.importField] = event.target.value;
  state.historicalImportPreview = null;
}

function handleHistoricalImportRowClick(event) {
  const removeButton = event.target.closest("[data-import-remove]");
  if (!removeButton) return;
  state.historicalImportRows = state.historicalImportRows.filter((row) => row.id !== removeButton.dataset.importRemove);
  if (!state.historicalImportRows.length) {
    state.historicalImportRows = [blankHistoricalImportRow(currentHistoricalImportDataType())];
  }
  state.historicalImportPreview = null;
  renderHistoricalImport();
}

async function handleHistoricalImportCsvSelected(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  historicalImportMessage.textContent = "";
  try {
    const parsedRows = parseHistoricalImportCsv(await file.text());
    if (!parsedRows.length) {
      historicalImportMessage.textContent = "That CSV file did not include any import rows.";
      return;
    }
    state.historicalImportRows = parsedRows.map((row) => ({
      id: crypto.randomUUID(),
      rowNumber: row.__rowNumber,
      date: row.date || "",
      value: row.value || "",
      denominator: row.denominator || "",
      phase: row.phase || "",
      setting: row.setting || currentClient()?.defaultSetting || "",
      notes: row.notes || ""
    }));
    if (!state.historicalImportRows.length) {
      state.historicalImportRows = [blankHistoricalImportRow(currentHistoricalImportDataType())];
    }
    state.historicalImportPreview = null;
    renderHistoricalImport();
    historicalImportMessage.textContent = `Loaded ${parsedRows.length} row${parsedRows.length === 1 ? "" : "s"} from ${file.name}. Preview before importing.`;
  } catch (error) {
    historicalImportMessage.textContent = error.message || "Could not read that CSV file.";
  } finally {
    historicalImportCsvInput.value = "";
  }
}

function handleDownloadHistoricalImportTemplate() {
  const csv = buildHistoricalImportCsvTemplate(currentHistoricalImportDataType());
  downloadFile(`historical-import-template-${currentHistoricalImportDataType()}.csv`, csv, "text/csv");
}

function handlePreviewHistoricalImport() {
  const preview = validateHistoricalImportRows({
    client: currentClient(),
    sessions: currentSessions(),
    dataType: currentHistoricalImportDataType(),
    measurementType: currentHistoricalImportMeasurementType(),
    selectedReference: currentHistoricalImportReference(),
    rows: historicalImportRowsToPayload(),
    duplicateStrategy: historicalImportDuplicateStrategySelect.value,
    today: new Date()
  });
  state.historicalImportPreview = preview;
  renderHistoricalImport();
  historicalImportMessage.textContent = preview.summary.errorRows
    ? "Review the blocked rows below before importing."
    : `Preview ready. ${preview.summary.importableRows} row${preview.summary.importableRows === 1 ? "" : "s"} can be imported.`;
}

async function handleCommitHistoricalImport(event) {
  event.preventDefault();
  const preview = validateHistoricalImportRows({
    client: currentClient(),
    sessions: currentSessions(),
    dataType: currentHistoricalImportDataType(),
    measurementType: currentHistoricalImportMeasurementType(),
    selectedReference: currentHistoricalImportReference(),
    rows: historicalImportRowsToPayload(),
    duplicateStrategy: historicalImportDuplicateStrategySelect.value,
    today: new Date()
  });
  state.historicalImportPreview = preview;
  renderHistoricalImport();
  if (preview.summary.importableRows === 0) {
    historicalImportMessage.textContent = preview.summary.errorRows
      ? "No valid rows are ready to import yet."
      : "Nothing is ready to import yet.";
    return;
  }
  if (historicalImportDuplicateStrategySelect.value === "cancel" && preview.rows.some((row) => row.existingDuplicate)) {
    historicalImportMessage.textContent = "Duplicates were found. Choose Skip duplicates or Replace duplicates, or cancel the import.";
    return;
  }
  try {
    const payload = await importHistoricalData({
      clientId: currentClient()?.id,
      dataType: currentHistoricalImportDataType(),
      measurementType: currentHistoricalImportMeasurementType(),
      selectedReference: currentHistoricalImportReference(),
      duplicateStrategy: historicalImportDuplicateStrategySelect.value,
      rows: historicalImportRowsToPayload()
    });
    await refreshData();
    state.historicalImportRows = [blankHistoricalImportRow(currentHistoricalImportDataType())];
    state.historicalImportPreview = null;
    render();
    historicalImportMessage.textContent = `Historical import saved. Imported ${payload.results?.created || 0}, replaced ${payload.results?.updated || 0}, skipped ${payload.results?.skipped || 0}, errors ${payload.results?.invalid || 0}.`;
  } catch (error) {
    state.historicalImportPreview = error.details?.preview || state.historicalImportPreview;
    renderHistoricalImport();
    historicalImportMessage.textContent = error.message;
  }
}

async function handleHistoricalImportBatchClick(event) {
  const rollbackButton = event.target.closest("[data-import-rollback]");
  if (!rollbackButton) return;
  if (!window.confirm("Rollback this historical import batch? This will remove created rows and restore any updated imported values.")) {
    return;
  }
  try {
    await rollbackHistoricalImport(rollbackButton.dataset.importRollback);
    await refreshData();
    state.historicalImportPreview = null;
    render();
    historicalImportMessage.textContent = "Historical import batch rolled back.";
  } catch (error) {
    historicalImportMessage.textContent = error.message;
  }
}

function showAuthStep(step, details = {}) {
  state.authFlow = step;
  loginScreen.classList.remove("hidden");
  appRoot.classList.add("hidden");
  loginPanel?.classList.toggle("hidden", step !== "password");
  mfaVerifyPanel?.classList.toggle("hidden", step !== "mfa-verify");
  loginMessage.textContent = step === "password" ? "" : loginMessage.textContent;
  if (step === "mfa-verify") {
    const requiresEmailSetup = Boolean(details.setupRequired);
    verificationEmailForm?.classList.toggle("hidden", !requiresEmailSetup);
    mfaVerifyForm?.classList.toggle("hidden", requiresEmailSetup);
    resendSignInCodeButton?.classList.toggle("hidden", requiresEmailSetup);
    if (requiresEmailSetup) {
      verificationEmailMessage.textContent = details.message || "Enter the email address you want to use for sign-in verification.";
      verificationEmailForm?.reset();
      const emailInput = verificationEmailForm?.elements?.email;
      if (emailInput && details.user?.email) emailInput.value = details.user.email;
    } else {
      verificationEmailMessage.textContent = "";
      mfaMessage.textContent = details.message || "Enter the 6-digit verification code we emailed to you.";
      mfaVerifyForm?.reset();
    }
  }
}

function resetSensitiveState() {
  clearInactivityTimer();
  state.currentUser = null;
  state.clients = [];
  state.programs = [];
  state.behaviors = [];
  state.sessions = [];
  state.auditLog = [];
  state.users = [];
  state.selectedSessionId = null;
  state.selectedSoapEntryKey = "";
  state.activeClientId = "";
  state.activeDomain = "";
  state.activeGraphDomain = "";
  state.activePlanDomain = "";
  state.activeSoapHistoryTab = "97153";
  state.loadedSessionDomainKeys = [];
  state.authChallenge = null;
  state.authFlow = "password";
  state.draftCache = { intake: {}, session: {} };
  state.historicalImportRows = [];
  state.historicalImportPreview = null;
  state.lastSessionTouchAt = 0;
  currentUserLabel.textContent = "";
  clearSensitiveDom();
  appRoot.classList.add("hidden");
  try {
    window.history.replaceState({}, "", "/");
  } catch {}
}

function handleAuthFailureEvent(detail = {}) {
  if (["VERIFICATION_REQUIRED", "VERIFICATION_EMAIL_REQUIRED"].includes(detail.code)) {
    state.authChallenge = detail;
    showAuthStep("mfa-verify", detail);
    return;
  }
  resetSensitiveState();
  const message = detail.code === "SESSION_TIMEOUT"
    ? "You were signed out due to inactivity."
    : detail.code === "SESSION_EXPIRED"
      ? "Session expired. Please sign in again."
      : detail.code === "VERIFICATION_UNAVAILABLE"
        ? detail.errors?.[0] || "Verification email is not configured for this account."
      : detail.code === "AUTH_UNAVAILABLE"
        ? "Authentication is temporarily unavailable. Please try again shortly or contact support."
      : detail.errors?.[0] || "";
  showLogin(message);
}

function handleBootstrapFailure(error) {
  console.error("App bootstrap failed", { message: error?.message || String(error) });
  resetSensitiveState();
  showLogin("We couldn't load the sign-in experience. Please refresh or contact support if this continues.");
}

function clearSensitiveDom() {
  const soapHistoryList = document.querySelector("#soap-history-list");
  const graphLegends = document.querySelectorAll(".graph-legend");
  [
    soapEditor,
    note97151Editor,
    planNote97151Editor,
    note97155Editor,
    rbtWrittenFeedback
  ].forEach((field) => {
    if (field) field.value = "";
  });
  [
    selectedSoapNoteTitle,
    currentUserLabel,
    soapClientSummary,
    planClientSummary,
    parentClientSummary,
    intakeSummary,
    graphsMessage,
    healthSummary,
    billingSummary,
    clientManagementSummary,
    reportClientSummary,
    workflowClientSummary,
    funderExportStatus
  ].forEach((node) => {
    if (node) node.textContent = "";
  });
  [
    programList,
    behaviorList,
    parentGoalList,
    targetStatusTabs,
    domainTabs,
    planDomainTabs,
    planReview,
    clientDocumentList,
    auditLogTable,
    billingTable,
    healthReportTable,
    soapHistoryList,
    reportPreview,
    workflowBoard,
    skillCharts,
    behaviorCharts,
    parentTrainingCharts
  ].forEach((node) => {
    if (node) node.innerHTML = "";
  });
  graphLegends.forEach((node) => {
    node.innerHTML = "";
  });
  if (programGraphModalCanvas) {
    const ctx = programGraphModalCanvas.getContext("2d");
    ctx?.clearRect(0, 0, programGraphModalCanvas.width, programGraphModalCanvas.height);
  }
}

async function handleCreateUser(event) {
  event.preventDefault();
  newUserMessage.textContent = "";
  const values = new FormData(newUserForm);
  try {
    await createUser({
      name: values.get("name"),
      username: values.get("username"),
      email: values.get("email"),
      role: values.get("role"),
      password: values.get("password"),
      agency: values.get("agency"),
      isMasterAdmin: values.get("isMasterAdmin") === "true"
    });
    newUserForm.reset();
    syncAdminAgencyControls();
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
  if (event.target.matches('[data-user-field="role"]')) {
    syncUserRowRoleControls(row);
  }
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
      email: row.querySelector('[data-user-field="email"]').value,
      role: row.querySelector('[data-user-field="role"]').value,
      agency: row.querySelector('[data-user-field="agency"]')?.value,
      isMasterAdmin: row.querySelector('[data-user-field="isMasterAdmin"]')?.checked || false,
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

function showLogin(message = "") {
  state.authFlow = "password";
  loginScreen.classList.remove("hidden");
  appRoot.classList.add("hidden");
  loginPanel?.classList.remove("hidden");
  mfaVerifyPanel?.classList.add("hidden");
  verificationEmailForm?.classList.add("hidden");
  verificationEmailForm?.reset();
  verificationEmailMessage.textContent = "";
  mfaVerifyForm?.classList.remove("hidden");
  mfaVerifyForm?.reset();
  mfaMessage.textContent = "";
  resendSignInCodeButton?.classList.remove("hidden");
  loginMessage.textContent = message;
}

function showApp() {
  loginScreen.classList.add("hidden");
  appRoot.classList.remove("hidden");
  const agencySuffix = state.currentUser?.agency ? ` - ${state.currentUser.agency}` : "";
  const masterSuffix = state.currentUser?.isMasterAdmin ? ", Master admin" : "";
  currentUserLabel.textContent = `${state.currentUser?.name || "User"} (${roleLabel(state.currentUser?.role)}${masterSuffix}${agencySuffix})`;
  applyRoleAccess();
}

function defaultReportDateRange() {
  const today = new Date();
  const endDate = today.toISOString().slice(0, 10);
  const sixMonthsAgo = new Date(today);
  sixMonthsAgo.setMonth(today.getMonth() - 6);
  return {
    startDate: sixMonthsAgo.toISOString().slice(0, 10),
    endDate
  };
}

function resetFunderReportForm() {
  if (!reportForm) return;
  reportForm.reset();
  state.reportAssessmentDocuments = sanitizeAssessmentDocumentRefs({});
  state.reportCustomPhaseLines = sanitizeCustomPhaseLines({});
  const range = defaultReportDateRange();
  reportForm.elements.startDate.value = range.startDate;
  reportForm.elements.endDate.value = range.endDate;
  preloadFadePlanRows();
  preloadServiceHourRows();
  renderReportAssessmentDraftFiles();
}

function setDefaultDate() {
  const today = new Date();
  const todayValue = today.toISOString().slice(0, 10);
  form.elements.date.value = todayValue;
  bcbaSessionForm.elements.date.value = todayValue;
  parentTrainingForm.elements.date.value = todayValue;
  const reportRange = defaultReportDateRange();
  reportForm.elements.endDate.value = reportRange.endDate;
  reportForm.elements.startDate.value = reportRange.startDate;
  toggleRbtFeedbackSection();
}

function populateSelect(select, items, selected = "") {
  select.innerHTML = items.map((item) => (
    `<option value="${item.id}">${clientOptionLabel(item)}</option>`
  )).join("");
  if (selected) select.value = selected;
}

function clientOptionLabel(client) {
  const archivedSuffix = client.status === "archived" ? " (archived)" : "";
  const agencySuffix = state.currentUser?.isMasterAdmin && client.agency ? ` - ${client.agency}` : "";
  return `${client.name}${agencySuffix}${archivedSuffix}`;
}

function workflowClients() {
  return state.clients.filter((client) => client.status !== "archived");
}

function setActiveClient(clientId, { resetSession = true } = {}) {
  if (!clientId) return;
  state.activeClientId = clientId;
  [
    workspaceClientSelect,
    clientSelect,
    managementClientSelect,
    bcbaClientSelect,
    parentClientSelect,
    intakeClientSelect,
    historicalImportClientSelect
  ].forEach((select) => {
    if (select) select.value = clientId;
  });
  if (resetSession) {
    state.selectedSessionId = null;
    state.selectedSoapEntryKey = "";
    state.activeDomain = "";
    state.activePlanDomain = "";
    state.activeGraphDomain = "";
    state.historicalImportRows = [];
    state.historicalImportPreview = null;
    syncSettingFromClient();
    resetRows();
  }
  render();
  syncWorkspaceUrl(currentView());
}

function addProgramRow(programId = "", targetId = "", values = {}) {
  const allowDuplicateExisting = Boolean(values.__allowDuplicateExisting);
  if (targetId && !allowDuplicateExisting && selectedTargetIds().has(targetId)) {
    formMessage.textContent = "This target is already in the session.";
    return null;
  }
  const suppressRefresh = Boolean(values.__suppressRefresh);
  const node = document.querySelector("#program-template").content.cloneNode(true);
  const row = node.querySelector(".program-row");
  const entryMode = values.entryMode || "active";
  populateSelect(row.querySelector('[data-field="programId"]'), clientPrograms(), programId);
  row.querySelector('[data-field="entryMode"]').value = entryMode;
  syncTargetOptions(row, targetId);
  row.dataset.lastTargetId = row.querySelector('[data-field="targetId"]').value || "";
  row.querySelector('[data-field="trials"]').value = values.trials ?? 10;
  row.querySelector('[data-field="correct"]').value = values.correct ?? 0;
  row.querySelector('[data-field="incorrect"]').value = values.incorrect ?? Math.max((values.trials ?? 10) - (values.correct ?? 0), 0);
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
      syncTrialBalance(row, input.dataset.field);
      updateProgramIndependence(row);
      saveSessionDraft();
    });
  });
  programList.append(row);
  syncTrialBalance(row);
  updateProgramIndependence(row);
  if (!suppressRefresh) renderDomainTabs();
  refreshTargetAvailability();
  saveSessionDraft();
  return row;
}

function preloadTargetRows() {
  programList.innerHTML = "";
  state.activeSessionTargetTab = "active";
  state.loadedSessionDomainKeys = [];
}

function addFirstAvailableTargetRow(status = "active", preferredDomain = state.activeDomain) {
  const used = selectedTargetIds();
  const assignable = sessionAssignableTargets(status).filter(({ target }) => !used.has(target.id));
  const available = assignable.find(({ program }) => !preferredDomain || (program.domain || "General") === preferredDomain)
    || assignable[0];

  if (!available) {
    formMessage.textContent = status === "maintenance"
      ? "No maintenance targets are available to add."
      : "All active targets are already on this session.";
    return;
  }
  addProgramRow(available.program.id, available.target.id, { entryMode: status });
}

function addBehaviorRow(behaviorId = "", values = {}) {
  const allowDuplicateExisting = Boolean(values.__allowDuplicateExisting);
  if (behaviorId && !allowDuplicateExisting && selectedBehaviorIds().has(behaviorId)) {
    formMessage.textContent = "This target is already in the session.";
    return null;
  }
  const node = document.querySelector("#behavior-template").content.cloneNode(true);
  const row = node.querySelector(".behavior-row");
  syncBehaviorOptions(row, behaviorId);
  row.dataset.lastBehaviorId = row.querySelector('[data-field="behaviorId"]').value || "";
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
  return row;
}

function preloadBehaviorRows() {
  behaviorList.innerHTML = "";
  clientBehaviors()
    .filter((behavior) => behavior.status !== "inactive")
    .slice(0, sessionPreloadLimits.behaviors)
    .forEach((behavior) => addBehaviorRow(behavior.id));
}

function addFirstAvailableBehaviorRow() {
  const used = selectedBehaviorIds();
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
  row.querySelector("[data-remove]").addEventListener("click", () => {
    row.remove();
    renderParentGoalTabs();
  });
  row.querySelectorAll("input, select").forEach((input) => {
    input.addEventListener("input", () => updateParentGoalScore(row));
    input.addEventListener("change", () => updateParentGoalScore(row));
  });
  parentGoalList.append(row);
  updateParentGoalScore(row);
  renderParentGoalTabs();
}

function preloadParentRows() {
  parentGoalList.innerHTML = "";
  state.activeParentGoalTab = "active";
  const goals = currentParentTrainingGoals();
  if (goals.length) {
    goals.forEach((goal) => addParentGoalRow(goal));
    renderParentGoalTabs();
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
  row.querySelector("[data-remove]").addEventListener("click", () => {
    row.remove();
    markReportDraftDirty();
  });
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
  row.querySelector("[data-remove]").addEventListener("click", () => {
    row.remove();
    markReportDraftDirty();
  });
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
  const goal = normalizeParentGoal(readDataRow(row));
  const review = parentGoalReview(goal);
  row.classList.remove("mastered-target", "mastery-ready-target", "mastery-close-target", "stagnant-target");
  if (review.className) row.classList.add(review.className);
  const reviewBox = row.querySelector("[data-parent-goal-review]");
  if (reviewBox) reviewBox.innerHTML = review.message;
  row.dataset.parentGoalState = review.state || "none";
  applyParentGoalFilter();
}

function parentGoalTabState(goal) {
  return parentGoalReview(goal).state === "mastered" ? "mastered" : "active";
}

function renderParentGoalTabs() {
  if (!parentGoalTabs || !parentGoalList) return;
  const counts = { active: 0, mastered: 0 };
  [...parentGoalList.querySelectorAll(".parent-goal-row")].forEach((row) => {
    const goal = normalizeParentGoal(readDataRow(row));
    counts[parentGoalTabState(goal)] += 1;
  });

  if (!counts[state.activeParentGoalTab]) {
    state.activeParentGoalTab = counts.active ? "active" : "mastered";
  }
  if (!counts.active && !counts.mastered) {
    state.activeParentGoalTab = "active";
  }

  parentGoalTabs.innerHTML = ["active", "mastered"].map((tab) => `
    <button type="button" class="domain-tab ${tab === state.activeParentGoalTab ? "active" : ""}" data-parent-goal-tab="${tab}">
      ${tab === "active" ? "Active" : "Mastered"}${counts[tab] ? ` (${counts[tab]})` : ""}
    </button>
  `).join("");

  parentGoalTabs.querySelectorAll("[data-parent-goal-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeParentGoalTab = button.dataset.parentGoalTab;
      renderParentGoalTabs();
    });
  });

  applyParentGoalFilter();
}

function applyParentGoalFilter() {
  if (!parentGoalList) return;
  [...parentGoalList.querySelectorAll(".parent-goal-row")].forEach((row) => {
    const rowState = row.dataset.parentGoalState === "mastered" ? "mastered" : "active";
    row.classList.toggle("hidden", rowState !== state.activeParentGoalTab);
  });
}

function updateProgramIndependence(row) {
  const correct = Number(row.querySelector('[data-field="correct"]').value || 0);
  const incorrect = Number(row.querySelector('[data-field="incorrect"]').value || 0);
  const trials = Number(row.querySelector('[data-field="trials"]').value || 0);
  const denominator = trials || correct + incorrect;
  const independence = denominator > 0 ? Math.round((correct / denominator) * 100) : 0;
  row.querySelector("[data-independence]").textContent = `${independence}%`;
}

function syncTrialBalance(row, sourceField = "") {
  const trialsField = row.querySelector('[data-field="trials"]');
  const correctField = row.querySelector('[data-field="correct"]');
  const incorrectField = row.querySelector('[data-field="incorrect"]');
  const trials = Math.max(Number(trialsField.value || 0), 0);
  let correct = Math.max(Number(correctField.value || 0), 0);
  let incorrect = Math.max(Number(incorrectField.value || 0), 0);

  if (trials <= 0) {
    if (sourceField === "correct") {
      incorrect = 0;
    } else if (sourceField === "incorrect") {
      correct = 0;
    }
  } else if (sourceField === "incorrect") {
    incorrect = Math.min(incorrect, trials);
    correct = Math.max(trials - incorrect, 0);
  } else {
    correct = Math.min(correct, trials);
    incorrect = Math.max(trials - correct, 0);
  }

  correctField.value = String(correct);
  incorrectField.value = String(incorrect);
}

async function handleSubmit(event) {
  event.preventDefault();
  formMessage.textContent = "";

  try {
    const payload = buildSessionPayload();
    payload.soapNote = generateSoapNote(payload, lookups());
    const saved = await createSession(payload);
    state.selectedSessionId = saved.id;
    state.selectedSoapEntryKey = saved.id;
    state.skipNextSessionDraftRestore = true;
    clearSessionDraft(payload.clientId);
    await refreshData();
    resetRows();
    render();
    formMessage.textContent = "Session saved. Graphs and SOAP note updated.";
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

async function handleDeleteClient() {
  const client = currentClient();
  if (!client) return;
  const sessionCount = state.sessions.filter((session) => session.clientId === client.id).length;
  const confirmMessage = `Delete ${client.name}? This will also remove ${sessionCount} session${sessionCount === 1 ? "" : "s"} and any uploaded documents for this client.`;
  if (!window.confirm(confirmMessage)) return;

  clientProfileMessage.textContent = "";
  try {
    await deleteClient(client.id);
    await refreshData();
    state.activeClientId = workflowClients()[0]?.id || state.clients[0]?.id || "";
    state.selectedSessionId = null;
    state.selectedSoapEntryKey = "";
    resetRows();
    render();
    clientProfileMessage.textContent = `${client.name} deleted.`;
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
      agency: values.get("agency"),
      dob: values.get("dob"),
      defaultSetting: values.get("defaultSetting"),
      diagnosis: values.get("diagnosis")
    });
    newClientForm.reset();
    syncAdminAgencyControls();
    await refreshData();
    state.activeClientId = client.id;
    setActiveClient(client.id);
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
      note97151: client.note97151 || "",
      note97155: client.note97155 || "",
      note97151History: client.note97151History || [],
      note97155History: client.note97155History || [],
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
    agency: values.get("agency"),
    dob: values.get("dob"),
    defaultSetting: values.get("defaultSetting"),
    status: values.get("status"),
    caregivers: values.get("caregivers"),
    school: values.get("school"),
    diagnosis: values.get("diagnosis"),
    communication: values.get("communication"),
    profileNotes: values.get("profileNotes"),
    masteryThresholdPercent: values.get("masteryThresholdPercent"),
    masteryConsecutiveSessions: values.get("masteryConsecutiveSessions"),
    stagnantConsecutiveSessions: values.get("stagnantConsecutiveSessions"),
    stagnantMinimumGain: values.get("stagnantMinimumGain"),
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
    funderReport: structuredClone(currentClient()?.profile?.funderReport || {}),
    intakeInterview: structuredClone(currentClient()?.profile?.intakeInterview || {}),
    parentTrainingGoals: structuredClone(currentClient()?.profile?.parentTrainingGoals || []),
    documents: structuredClone(currentClient()?.profile?.documents || [])
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
  state.draftCache.intake[clientId] = intakeDraftPayload();
}

function loadIntakeDraft(clientId) {
  if (!clientId) return null;
  return structuredClone(state.draftCache.intake[clientId] || null);
}

function clearIntakeDraft(clientId) {
  if (!clientId) return;
  delete state.draftCache.intake[clientId];
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
  const draft = sessionDraftPayload();
  if (!hasMeaningfulSessionDraft(draft)) {
    clearSessionDraft(clientId);
    return;
  }
  state.draftCache.session[clientId] = structuredClone(draft);
}

function loadSessionDraft(clientId) {
  if (!clientId) return null;
  return structuredClone(state.draftCache.session[clientId] || null);
}

function clearSessionDraft(clientId) {
  if (!clientId) return;
  delete state.draftCache.session[clientId];
}

function restoreSessionDraft() {
  const client = currentClient();
  if (!client || !form) return;
  if (state.skipNextSessionDraftRestore) {
    state.skipNextSessionDraftRestore = false;
    return;
  }
  const draft = loadSessionDraft(client.id);
  if (!draft || !hasMeaningfulSessionDraft(draft)) return;
  Object.entries(draft.fields || {}).forEach(([field, value]) => {
    if (form.elements[field]) form.elements[field].value = value || "";
  });
  if (Array.isArray(draft.programs)) {
    programList.innerHTML = "";
    state.loadedSessionDomainKeys = [];
    draft.programs.forEach((row) => {
      addProgramRow(row.programId, row.targetId, { ...row, __suppressRefresh: true, __allowDuplicateExisting: true });
      const program = clientPrograms().find((item) => item.id === row.programId);
      markSessionDomainLoaded(row.entryMode || "active", program?.domain || "General");
    });
  }
  if (Array.isArray(draft.behaviors)) {
    behaviorList.innerHTML = "";
    draft.behaviors.forEach((row) => addBehaviorRow(row.behaviorId, { ...row, __allowDuplicateExisting: true }));
  }
  formMessage.textContent = "Unsaved session draft restored.";
}

function hasMeaningfulSessionDraft(draft) {
  if (!draft) return false;
  const fields = draft.fields || {};
  const meaningfulFieldValues = [
    fields.therapist,
    fields.startTime,
    fields.endTime,
    fields.notes,
    fields.barrierText,
    fields.providerSignature,
    fields.providerCredential
  ].some((value) => String(value || "").trim());
  if (meaningfulFieldValues) return true;

  const meaningfulProgramRows = (draft.programs || []).some((row) => {
    const trials = Number(row.trials ?? 10);
    const correct = Number(row.correct ?? 0);
    const incorrect = Number(row.incorrect ?? 10);
    return (
      trials !== 10
      || correct !== 0
      || incorrect !== 10
      || String(row.promptLevel || "independent") !== "independent"
      || String(row.phase || "intervention") !== "intervention"
    );
  });
  if (meaningfulProgramRows) return true;

  const meaningfulBehaviorRows = (draft.behaviors || []).some((row) => (
    Number(row.frequency || 0) > 0
    || String(row.duration || "").trim()
    || String(row.intensity || "").trim()
    || String(row.phase || "intervention") !== "intervention"
  ));
  if (meaningfulBehaviorRows) return true;

  return (draft.programs || []).length > sessionPreloadLimits.activePrograms + sessionPreloadLimits.maintenancePrograms
    || (draft.behaviors || []).length > sessionPreloadLimits.behaviors;
}

function syncClientProfileForm() {
  const client = currentClient();
  clientProfileForm.querySelectorAll("input, select, textarea, button").forEach((field) => {
    field.disabled = !client;
  });
  deleteClientButton.classList.toggle("hidden", !canEditAdmin());
  deleteClientButton.disabled = !client || !canEditAdmin();
  clientAdminToolbar?.classList.toggle("hidden", !canEditAdmin());
  document.querySelectorAll("[data-admin-only]").forEach((section) => {
    section.classList.toggle("hidden", !canEditAdmin());
  });
  syncAdminAgencyControls();
  if (!client) return;
  managementClientSelect.value = client.id;
  clientProfileForm.elements.status.value = client.status === "archived" ? "archived" : "active";
  clientProfileForm.elements.name.value = client.name || "";
  if (clientProfileForm.elements.agency) clientProfileForm.elements.agency.value = client.agency || state.currentUser?.agency || agencyOptions[0];
  clientProfileForm.elements.dob.value = client.dob || "";
  clientProfileForm.elements.defaultSetting.value = client.defaultSetting || "";
  clientProfileForm.elements.caregivers.value = client.profile?.caregivers || client.caregivers || "";
  clientProfileForm.elements.school.value = client.profile?.school || client.school || "";
  clientProfileForm.elements.diagnosis.value = client.profile?.diagnosis || client.diagnosis || "Autism Spectrum Disorder";
  clientProfileForm.elements.communication.value = client.profile?.communication || "";
  clientProfileForm.elements.profileNotes.value = client.profile?.notes || client.profileNotes || "";
  clientProfileForm.elements.masteryThresholdPercent.value = client.profile?.masteryCriteria?.thresholdPercent || 90;
  clientProfileForm.elements.masteryConsecutiveSessions.value = client.profile?.masteryCriteria?.consecutiveSessions || 2;
  clientProfileForm.elements.stagnantConsecutiveSessions.value = client.profile?.masteryCriteria?.stagnantConsecutiveSessions || 3;
  clientProfileForm.elements.stagnantMinimumGain.value = client.profile?.masteryCriteria?.stagnantMinimumGain || 5;
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
  renderAuthorizationUsage();
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

function behaviorEntriesForSession(session) {
  return dedupeBehaviorEntries(session.behaviors || []);
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
  const availableClients = workflowClients();
  const selectedClientId = availableClients.find((client) => client.id === state.activeClientId)?.id
    || availableClients[0]?.id
    || state.clients[0]?.id
    || "";
  state.activeClientId = selectedClientId;
  populateSelect(workspaceClientSelect, availableClients, selectedClientId);
  populateSelect(clientSelect, availableClients, selectedClientId);
  populateSelect(managementClientSelect, state.clients, selectedClientId);
  populateSelect(bcbaClientSelect, availableClients, selectedClientId);
  populateSelect(parentClientSelect, availableClients, selectedClientId);
  populateSelect(intakeClientSelect, availableClients, selectedClientId);
  populateDomainSelect(addProgramForm.elements.programDomain, addProgramForm.elements.programDomain.value || clientDomains()[0]);
  syncSettingFromClient();
  restoreSessionDraft();
  syncBcbaSessionDefaults();
  syncParentTrainingDefaults();
  syncClientProfileForm();
  syncIntakeInterviewForm();
  syncFunderReportDraftForClient();
  renderClientManagementSummary();
  renderClientDocuments();
  renderSummary();
  renderWorkflowBoard();
  renderSoapSummary();
  renderDomainTabs();
  renderGraphsSummary();
  renderHistoricalImport();
  renderReportSummary();
  renderPlanReview();
  renderParentSummary();
  renderRbtFidelityRows();
  render97151Note();
  render97155Note();
  renderHistory();
  renderCharts();
  renderNote();
  renderAuditFilters();
  renderAuditLog();
  renderDataHealth();
  renderUsers();
  if (currentView() === "report") renderFunderReportPreview();
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

function currentHistoricalImportDataType() {
  return historicalImportDataTypeSelect?.value || "skill";
}

function historicalImportMeasurementOptions(dataType = currentHistoricalImportDataType()) {
  if (dataType === "behavior") {
    return [
      { id: "frequency", name: "Frequency" },
      { id: "duration", name: "Duration" },
      { id: "rate", name: "Rate" },
      { id: "percentage", name: "Percentage" }
    ];
  }
  if (dataType === "caregiver_training") return [{ id: "fidelity", name: "Fidelity" }];
  return [{ id: "percentage", name: "Percentage / Independence" }];
}

function currentHistoricalImportMeasurementType() {
  const options = historicalImportMeasurementOptions();
  return historicalImportMeasurementTypeSelect?.value || options[0]?.id || "percentage";
}

function populateHistoricalImportMeasurementSelect() {
  if (!historicalImportMeasurementTypeSelect) return;
  const options = historicalImportMeasurementOptions();
  const current = options.some((option) => option.id === historicalImportMeasurementTypeSelect.value)
    ? historicalImportMeasurementTypeSelect.value
    : options[0]?.id;
  historicalImportMeasurementTypeSelect.innerHTML = options.map((option) => (
    `<option value="${escapeHtml(option.id)}" ${option.id === current ? "selected" : ""}>${escapeHtml(option.name)}</option>`
  )).join("");
}

function skillImportOptions() {
  return clientPrograms().flatMap((program) => (
    (program.targets || []).map((target) => ({
      id: target.id,
      domain: program.domain || "General",
      goal: program.name,
      target: target.name,
      label: `${program.name} - ${target.name} (${program.domain || "General"})`
    }))
  ));
}

function behaviorImportOptions() {
  return clientBehaviors().map((behavior) => ({
    id: behavior.id,
    label: behavior.name
  }));
}

function caregiverImportOptions() {
  return currentParentTrainingGoals().map((goal) => ({
    id: `${goal.goalName}::${goal.targetName}`,
    goal: goal.goalName,
    target: goal.targetName,
    label: `${goal.goalName} - ${goal.targetName}`
  }));
}

function findSkillImportOption(targetId = "") {
  return skillImportOptions().find((option) => option.id === targetId) || null;
}

function findBehaviorImportOption(behaviorId = "") {
  return behaviorImportOptions().find((option) => option.id === behaviorId) || null;
}

function findCaregiverImportOption(compositeId = "") {
  return caregiverImportOptions().find((option) => option.id === compositeId) || null;
}

function historicalImportReferenceOptions(dataType = currentHistoricalImportDataType()) {
  if (dataType === "behavior") return behaviorImportOptions();
  if (dataType === "caregiver_training") return caregiverImportOptions();
  return skillImportOptions();
}

function populateHistoricalImportReferenceSelect() {
  if (!historicalImportReferenceSelect) return;
  const options = historicalImportReferenceOptions();
  const current = options.some((option) => option.id === historicalImportReferenceSelect.value)
    ? historicalImportReferenceSelect.value
    : options[0]?.id;
  historicalImportReferenceSelect.innerHTML = options.map((option) => (
    `<option value="${escapeHtml(option.id)}" ${option.id === current ? "selected" : ""}>${escapeHtml(option.label)}</option>`
  )).join("");
}

function currentHistoricalImportReference() {
  const dataType = currentHistoricalImportDataType();
  const referenceId = historicalImportReferenceSelect?.value || "";
  if (dataType === "behavior") return findBehaviorImportOption(referenceId);
  if (dataType === "caregiver_training") return findCaregiverImportOption(referenceId);
  return findSkillImportOption(referenceId);
}

function currentHistoricalImportReferenceLabel() {
  const reference = currentHistoricalImportReference();
  if (!reference) return "No target selected";
  if (currentHistoricalImportDataType() === "behavior") return reference.label;
  if (currentHistoricalImportDataType() === "caregiver_training") return `${reference.goal} - ${reference.target}`;
  return `${reference.goal} - ${reference.target}`;
}

function historicalImportValueLabel(measurementType = currentHistoricalImportMeasurementType()) {
  return {
    frequency: "Frequency",
    duration: "Duration",
    rate: "Rate",
    percentage: "Percentage",
    fidelity: "Fidelity",
    percentage_independence: "Percentage / Independence"
  }[measurementType] || "Value";
}

function blankHistoricalImportRow(dataType = currentHistoricalImportDataType()) {
  const today = new Date().toISOString().slice(0, 10);
  const client = currentClient();
  return {
    id: crypto.randomUUID(),
    date: today,
    value: "",
    denominator: dataType === "behavior" ? "" : "10",
    phase: "",
    setting: client?.defaultSetting || "",
    notes: ""
  };
}

function ensureHistoricalImportRows() {
  if (state.historicalImportRows.length) return;
  state.historicalImportRows = [blankHistoricalImportRow()];
}

function renderHistoricalImportRows() {
  if (!historicalImportRows) return;
  ensureHistoricalImportRows();
  const dataType = currentHistoricalImportDataType();
  const measurementType = currentHistoricalImportMeasurementType();
  const measurementLabel = historicalImportValueLabel(measurementType);
  historicalImportRows.innerHTML = state.historicalImportRows.map((row) => `
    <tr data-historical-row="${escapeHtml(row.id)}">
      <td><input type="date" data-import-field="date" value="${escapeHtml(row.date || "")}"></td>
      <td><input type="number" min="0" step="0.01" data-import-field="value" value="${escapeHtml(row.value || "")}" placeholder="${escapeHtml(measurementLabel)}"></td>
      <td>
        <strong>${escapeHtml(measurementLabel)}</strong>
        ${dataType === "behavior" ? "" : `<input type="number" min="1" step="1" data-import-field="denominator" value="${escapeHtml(row.denominator || "")}" placeholder="Denominator">`}
      </td>
      <td>
        <select data-import-field="phase">
          <option value="" ${!row.phase ? "selected" : ""}>Auto</option>
          <option value="baseline" ${row.phase === "baseline" ? "selected" : ""}>Baseline</option>
          <option value="intervention" ${row.phase === "intervention" ? "selected" : ""}>Treatment</option>
        </select>
      </td>
      <td><input type="text" data-import-field="setting" value="${escapeHtml(row.setting || "")}" placeholder="home, clinic, school"></td>
      <td><textarea rows="2" data-import-field="notes" placeholder="Historical source notes">${escapeHtml(row.notes || "")}</textarea></td>
      <td><button type="button" class="danger-button" data-import-remove="${escapeHtml(row.id)}">Remove</button></td>
    </tr>
  `).join("");
}

function historicalImportRowsToPayload() {
  const dataType = currentHistoricalImportDataType();
  const measurementType = currentHistoricalImportMeasurementType();
  const reference = currentHistoricalImportReference();
  return state.historicalImportRows.map((row) => {
    if (dataType === "skill") {
      return {
        date: row.date,
        dataType,
        domain: reference?.domain || "",
        goal: reference?.goal || "",
        target: reference?.target || "",
        targetId: reference?.id || "",
        measurementType,
        value: row.value,
        denominator: row.denominator,
        phase: row.phase,
        setting: row.setting,
        notes: row.notes,
        rowNumber: row.rowNumber || ""
      };
    }
    if (dataType === "behavior") {
      return {
        date: row.date,
        dataType,
        goal: reference?.label || "",
        target: reference?.label || "",
        targetId: reference?.id || "",
        measurementType,
        value: row.value,
        phase: row.phase,
        setting: row.setting,
        notes: row.notes,
        rowNumber: row.rowNumber || ""
      };
    }
    return {
      date: row.date,
      dataType,
      goal: reference?.goal || "",
      target: reference?.target || "",
      measurementType,
      value: row.value,
      denominator: row.denominator,
      phase: row.phase,
      setting: row.setting,
      notes: row.notes,
      rowNumber: row.rowNumber || ""
    };
  });
}

function renderHistoricalImportSummary() {
  if (!historicalImportSummary) return;
  const preview = state.historicalImportPreview;
  if (!preview) {
    historicalImportSummary.innerHTML = `
      <div><strong>${state.historicalImportRows.length}</strong><span>Rows staged</span></div>
      <div><strong>${escapeHtml(currentHistoricalImportReferenceLabel())}</strong><span>Selected target</span></div>
      <div><strong>${(state.historicalImportBatches || []).filter((batch) => batch.clientId === currentClient()?.id && batch.status === "committed").length}</strong><span>Committed batches</span></div>
    `;
    return;
  }
  historicalImportSummary.innerHTML = `
    <div><strong>${preview.summary.totalRows}</strong><span>Rows reviewed</span></div>
    <div><strong>${preview.summary.importableRows}</strong><span>Rows ready to import</span></div>
    <div><strong>${preview.summary.warningRows}</strong><span>Rows with warnings</span></div>
    <div><strong>${preview.summary.errorRows}</strong><span>Rows with errors</span></div>
    <div><strong>${escapeHtml(currentHistoricalImportReferenceLabel())}</strong><span>Selected target</span></div>
  `;
}

function renderHistoricalImportPreview() {
  if (!historicalImportPreviewTable) return;
  const preview = state.historicalImportPreview;
  if (!preview) {
    historicalImportPreviewTable.innerHTML = '<p class="muted">Preview staged rows to review validation, warnings, duplicates, and commit actions.</p>';
    return;
  }
  historicalImportPreviewTable.innerHTML = `
    <p><strong>Selected ${currentHistoricalImportDataType() === "behavior" ? "Behavior" : currentHistoricalImportDataType() === "caregiver_training" ? "Caregiver Target" : "Skill Target"}:</strong> ${escapeHtml(currentHistoricalImportReferenceLabel())}</p>
    <div class="report-table-wrap">
      <table class="fade-plan-table">
        <thead>
          <tr>
            <th>Row</th>
            <th>Date</th>
            <th>Value</th>
            <th>Status</th>
            <th>Warnings / errors</th>
          </tr>
        </thead>
        <tbody>
          ${preview.rows.map((row) => {
            const issueBadges = [
              ...row.errors.map((message) => `<div class="import-badge import-badge--error">${escapeHtml(message)}</div>`),
              ...row.warnings.map((message) => `<div class="import-badge import-badge--warning">${escapeHtml(message)}</div>`)
            ].join(" ");
            const statusLabel = row.errors.length
              ? "Error"
              : row.commitAction === "skip"
                ? "Duplicate skipped"
                : row.commitAction === "update"
                  ? "Replace duplicate"
                  : "Ready";
            return `
              <tr>
                <td>${row.rowNumber}</td>
                <td>${escapeHtml(formatDate(row.raw.date))}</td>
                <td>${escapeHtml(row.raw.value)}</td>
                <td><span class="import-badge ${row.errors.length ? "import-badge--error" : row.commitAction === "skip" ? "import-badge--warning" : "import-badge--success"}">${escapeHtml(statusLabel)}</span></td>
                <td>${issueBadges || '<span class="muted">No issues detected.</span>'}</td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderHistoricalImportBatches() {
  if (!historicalImportBatches) return;
  const clientId = currentClient()?.id;
  const batches = (state.historicalImportBatches || []).filter((batch) => batch.clientId === clientId);
  if (!batches.length) {
    historicalImportBatches.innerHTML = '<p class="muted">No historical import batches have been saved for this client yet.</p>';
    return;
  }
  historicalImportBatches.innerHTML = `
    <div class="report-table-wrap">
      <table class="fade-plan-table">
        <thead>
          <tr>
            <th>Imported</th>
            <th>Type</th>
            <th>Rows</th>
            <th>Results</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${batches.map((batch) => `
            <tr>
              <td>${escapeHtml(formatDate(batch.importedAt))}<br><span class="muted">${escapeHtml(batch.importedByName || "")}</span></td>
              <td>${escapeHtml(capitalize(batch.dataType.replace(/_/g, " ")))}</td>
              <td>${Number(batch.rowCount || 0)}</td>
              <td>
                Created ${Number(batch.resultCounts?.created || 0)}<br>
                Updated ${Number(batch.resultCounts?.updated || 0)}<br>
                Skipped ${Number(batch.resultCounts?.skipped || 0)}
              </td>
              <td>${escapeHtml(capitalize(batch.status || "committed"))}</td>
              <td>${batch.status === "committed" ? `<button type="button" class="secondary-button" data-import-rollback="${escapeHtml(batch.id)}">Rollback batch</button>` : ""}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderHistoricalImport() {
  if (!historicalImportForm) return;
  const availableClients = workflowClients();
  populateSelect(historicalImportClientSelect, availableClients, state.activeClientId);
  populateHistoricalImportMeasurementSelect();
  populateHistoricalImportReferenceSelect();
  ensureHistoricalImportRows();
  renderHistoricalImportRows();
  renderHistoricalImportSummary();
  renderHistoricalImportPreview();
  renderHistoricalImportBatches();
}

function currentParentTrainingGoals() {
  return structuredClone(currentClient()?.profile?.parentTrainingGoals || []);
}

function currentMasteryCriteria() {
  return {
    thresholdPercent: Number(currentClient()?.profile?.masteryCriteria?.thresholdPercent || 90),
    consecutiveSessions: Number(currentClient()?.profile?.masteryCriteria?.consecutiveSessions || 2),
    stagnantConsecutiveSessions: Number(currentClient()?.profile?.masteryCriteria?.stagnantConsecutiveSessions || 3),
    stagnantMinimumGain: Number(currentClient()?.profile?.masteryCriteria?.stagnantMinimumGain || 5)
  };
}

function parentGoalSessionHistory(goal) {
  const normalizedGoal = normalizeParentGoal(goal);
  return currentSessions()
    .filter((session) => session.serviceType === "parent-training")
    .map((session) => {
      const match = (session.parentGoals || []).find((item) => (
        normalizeParentGoal(item).goalName === normalizedGoal.goalName
        && normalizeParentGoal(item).targetName === normalizedGoal.targetName
      ));
      return match ? { session, goal: normalizeParentGoal(match) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => {
      const aValue = `${a.session.date}T${a.session.startTime || "00:00"}`;
      const bValue = `${b.session.date}T${b.session.startTime || "00:00"}`;
      return bValue.localeCompare(aValue);
    });
}

function parentGoalReview(goal) {
  const criteria = currentMasteryCriteria();
  const sessions = parentGoalSessionHistory(goal);
  const currentScore = Number(goal.fidelity || 0);
  if (!sessions.length) {
    return {
      state: "none",
      className: "",
      message: ""
    };
  }

  const fidelitySessions = sessions.map((item) => ({
    session: item.session,
    entry: { independence: Number(item.goal.fidelity || 0) }
  }));
  const base = stagnantReviewForTarget(criteria, fidelitySessions, {
    state: "none",
    threshold: criteria.thresholdPercent,
    consecutiveSessions: criteria.consecutiveSessions,
    matchedDates: [],
    previewScores: fidelitySessions.slice(0, criteria.consecutiveSessions).map(({ entry }) => Number(entry.independence || 0)).reverse()
  });
  const masteryWindow = findMasteryWindow(fidelitySessions, criteria.consecutiveSessions, criteria.thresholdPercent);
  const recentScores = fidelitySessions.slice(0, criteria.consecutiveSessions).map(({ entry }) => Number(entry.independence || 0));
  const nearThreshold = recentScores.length >= criteria.consecutiveSessions
    && recentScores.every((score) => score >= Math.max(criteria.thresholdPercent - 10, 0));
  const averageScore = recentScores.length
    ? Math.round(recentScores.reduce((sum, score) => sum + score, 0) / recentScores.length)
    : currentScore;
  const stateValue = masteryWindow
    ? "mastered"
    : base.state === "stagnant"
      ? "stagnant"
      : nearThreshold && averageScore >= criteria.thresholdPercent - 5
        ? "close"
        : "none";

  if (stateValue === "mastered") {
    return {
      state: stateValue,
      className: "mastered-target",
      message: `
        <div class="mastery-review-hint mastery-review-hint-mastered">
          <strong>Meeting mastery criteria</strong>
          <span>${escapeHtml(goal.targetName)} reached ${criteria.thresholdPercent}% across ${criteria.consecutiveSessions} consecutive parent-training sessions.</span>
        </div>
      `
    };
  }
  if (stateValue === "close") {
    return {
      state: stateValue,
      className: "mastery-close-target",
      message: `
        <div class="mastery-review-hint mastery-review-hint-close">
          <strong>Close to mastery</strong>
          <span>${escapeHtml(goal.targetName)} is trending near criterion (${recentScores.reverse().join("%, ")}%).</span>
        </div>
      `
    };
  }
  if (stateValue === "stagnant") {
    return {
      state: stateValue,
      className: "stagnant-target",
      message: `
        <div class="mastery-review-hint mastery-review-hint-stagnant">
          <strong>Stagnant</strong>
          <span>${escapeHtml(goal.targetName)} has not meaningfully improved across recent caregiver-training sessions.</span>
        </div>
      `
    };
  }
  return {
    state: "none",
    className: "",
    message: ""
  };
}

function requestedWorkspaceState() {
  const url = new URL(window.location.href);
  return {
    view: url.searchParams.get("view") || "",
    clientId: url.searchParams.get("client") || ""
  };
}

function currentView() {
  return document.querySelector("[data-view-button].active")?.dataset.viewButton || allowedViews()[0] || "session";
}

function buildWorkspaceUrl({ view = currentView(), clientId = state.activeClientId } = {}) {
  const url = new URL(window.location.href);
  if (view) {
    url.searchParams.set("view", view);
  } else {
    url.searchParams.delete("view");
  }
  if (clientId) {
    url.searchParams.set("client", clientId);
  } else {
    url.searchParams.delete("client");
  }
  return url;
}

function syncWorkspaceUrl(view = currentView()) {
  window.history.replaceState({}, "", buildWorkspaceUrl({ view }).toString());
}

function handleViewTabClick(event, view) {
  if ((event.metaKey || event.ctrlKey || event.shiftKey) && allowedViews().includes(view)) {
    window.open(buildWorkspaceUrl({ view }).toString(), "_blank", "noopener");
    return;
  }
  switchView(view);
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
  if (view === "report") renderFunderReportPreview();
  if (view === "billing") renderBillingExport();
  if (view === "audit") refreshAuditLog(false);
  if (view === "health") runDataHealthCheck();
  if (view === "users") refreshUsers(false);
  syncWorkspaceUrl(view);
}

function handleReportSectionNavClick(event) {
  const button = event.target.closest("[data-report-section-target]");
  if (!button) return;
  const section = document.getElementById(button.dataset.reportSectionTarget);
  if (!section) return;
  if (section.tagName === "DETAILS") {
    section.open = true;
  }
  section.scrollIntoView({ behavior: "smooth", block: "start" });
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

function canManageAcrossAgencies() {
  return canEditAdmin() && Boolean(state.currentUser?.isMasterAdmin);
}

function roleLabel(role) {
  return {
    admin: "Admin",
    bcba: "BCBA",
    rbt: "RBT",
    "read-only": "Read-only"
  }[role] || "User";
}

function capitalize(value = "") {
  return String(value)
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function syncSettingFromClient() {
  const client = currentClient();
  if (client && !form.elements.setting.value) form.elements.setting.value = client.defaultSetting;
}

function masteryReviewForTarget(programId, targetId) {
  const target = clientPrograms().find((program) => program.id === programId)?.targets?.find((item) => item.id === targetId);
  if (target?.status === "mastered") {
    return { state: "mastered", threshold: 0, consecutiveSessions: 0, matchedDates: [], previewScores: [] };
  }
  const criteria = currentMasteryCriteria();
  const qualifyingSessions = currentSessions()
    .filter((session) => (session.serviceType || "97153") === "97153")
    .map((session) => {
      const entry = targetEntries(session).find((target) => target.programId === programId && target.targetId === targetId);
      return entry ? { session, entry } : null;
    })
    .filter(Boolean)
    .sort((a, b) => {
      const aValue = `${a.session.date}T${a.session.startTime || "00:00"}`;
      const bValue = `${b.session.date}T${b.session.startTime || "00:00"}`;
      return bValue.localeCompare(aValue);
    });

  if (qualifyingSessions.length < criteria.consecutiveSessions) {
    return stagnantReviewForTarget(criteria, qualifyingSessions, {
      state: "none",
      threshold: criteria.thresholdPercent,
      consecutiveSessions: criteria.consecutiveSessions,
      matchedDates: [],
      previewScores: []
    });
  }

  const recentSessions = qualifyingSessions.slice(0, criteria.consecutiveSessions);
  const scores = recentSessions.map(({ entry }) => Number(entry.independence || 0));
  const masteryWindow = findMasteryWindow(qualifyingSessions, criteria.consecutiveSessions, criteria.thresholdPercent);
  const eligible = Boolean(masteryWindow);
  const nearThreshold = scores.every((score) => score >= Math.max(criteria.thresholdPercent - 10, 0));
  const averageScore = scores.length ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : 0;
  return stagnantReviewForTarget(criteria, qualifyingSessions, {
    state: eligible ? "ready" : (nearThreshold && averageScore >= criteria.thresholdPercent - 5 ? "close" : "none"),
    threshold: criteria.thresholdPercent,
    consecutiveSessions: criteria.consecutiveSessions,
    matchedDates: eligible ? masteryWindow.map(({ session }) => session.date).reverse() : [],
    previewScores: scores.reverse()
  });
}

function findMasteryWindow(qualifyingSessions, consecutiveSessions, thresholdPercent) {
  for (let start = 0; start <= qualifyingSessions.length - consecutiveSessions; start += 1) {
    const window = qualifyingSessions.slice(start, start + consecutiveSessions);
    if (window.every(({ entry }) => Number(entry.independence || 0) >= thresholdPercent)) {
      return window;
    }
  }
  return null;
}

function masteryReviewCounts() {
  return clientPrograms().flatMap((program) => (
    (program.targets || []).map((target) => masteryReviewForTarget(program.id, target.id).state)
  )).reduce((counts, stateValue) => {
    counts[stateValue] = (counts[stateValue] || 0) + 1;
    return counts;
  }, {
    ready: 0,
    close: 0,
    stagnant: 0,
    mastered: 0,
    none: 0
  });
}

function stagnantReviewForTarget(criteria, qualifyingSessions, baseResult) {
  if (baseResult.state !== "none") return baseResult;
  if (qualifyingSessions.length < criteria.stagnantConsecutiveSessions) return baseResult;

  const stagnantSessions = qualifyingSessions.slice(0, criteria.stagnantConsecutiveSessions).reverse();
  const stagnantScores = stagnantSessions.map(({ entry }) => Number(entry.independence || 0));
  const newestScore = stagnantScores[stagnantScores.length - 1] || 0;
  const oldestScore = stagnantScores[0] || 0;
  const improvement = newestScore - oldestScore;
  const scoreRange = Math.max(...stagnantScores) - Math.min(...stagnantScores);
  const averageScore = Math.round(stagnantScores.reduce((sum, score) => sum + score, 0) / stagnantScores.length);
  const stagnant = improvement < criteria.stagnantMinimumGain
    && scoreRange <= criteria.stagnantMinimumGain
    && averageScore < criteria.thresholdPercent - 5;

  return stagnant
    ? {
        ...baseResult,
        state: "stagnant",
        stagnantConsecutiveSessions: criteria.stagnantConsecutiveSessions,
        stagnantMinimumGain: criteria.stagnantMinimumGain,
        matchedDates: stagnantSessions.map(({ session }) => session.date),
        previewScores: stagnantScores
      }
    : baseResult;
}

function renderSummary() {
  const client = currentClient();
  const sessions = currentSessions();
  const activeTargets = clientPrograms().flatMap((program) => program.targets || []).filter((target) => target.status === "active").length;
  const maintenanceTargets = clientPrograms().flatMap((program) => {
    const programStatus = normalizePlanStatus(program.status || "active");
    return (program.targets || []).filter((target) => sessionTargetMatchesTab(programStatus, target, "maintenance"));
  }).length;
  document.querySelector("#client-summary").innerHTML = client
    ? `
      <div><strong>${client.name}</strong><span>Client</span></div>
      <div><strong>${sessions.length}</strong><span>Sessions</span></div>
      <div><strong>${activeTargets} / ${maintenanceTargets}</strong><span>Active / maintenance targets</span></div>
    `
    : "<p>No client selected.</p>";
}

function renderWorkflowBoard() {
  if (!workflowBoard || !workflowClientSummary) return;
  const client = currentClient();
  const board = clientWorkflowBoard();
  const counts = workflowColumns.reduce((acc, column) => {
    acc[column.id] = board.filter((card) => card.status === column.id).length;
    return acc;
  }, {});
  const completedItems = board.reduce((sum, card) => sum + (card.checklist || []).filter((item) => item.done).length, 0);
  const totalItems = board.reduce((sum, card) => sum + (card.checklist || []).length, 0);

  workflowClientSummary.innerHTML = client
    ? `
      <div><strong>${client.name}</strong><span>Client</span></div>
      <div><strong>${workflowCycleLabel(client)}</strong><span>Authorization cycle</span></div>
      <div><strong>${counts.todo || 0}</strong><span>To do</span></div>
      <div><strong>${counts["in-progress"] || 0}</strong><span>In progress</span></div>
      <div><strong>${counts.done || 0}</strong><span>Done</span></div>
      <div><strong>${completedItems}/${totalItems}</strong><span>Checklist items complete</span></div>
      <div><strong>Auto</strong><span>Updated from chart evidence</span></div>
    `
    : "";

  workflowBoard.innerHTML = workflowColumns.map((column) => `
    <section class="workflow-column">
      <div class="workflow-column-heading">
        <h3>${column.label}</h3>
        <span>${counts[column.id] || 0} card${counts[column.id] === 1 ? "" : "s"}</span>
      </div>
      <div class="workflow-card-list">
        ${board.filter((card) => card.status === column.id).map((card) => renderWorkflowCard(card)).join("") || '<p class="muted">Nothing here yet.</p>'}
      </div>
    </section>
  `).join("");

  workflowMessage.textContent = "";
}

function renderWorkflowCard(card) {
  const completed = (card.checklist || []).filter((item) => item.done).length;
  const total = (card.checklist || []).length;
  const statusLabel = workflowColumns.find((column) => column.id === card.status)?.label || "To do";
  return `
    <article class="workflow-card workflow-card--${escapeHtml(card.status)}" data-workflow-card="${card.id}">
      <div class="workflow-card-header">
        <div>
          <p class="eyebrow">${escapeHtml(card.timeline)}</p>
          <h4>${escapeHtml(card.title)}</h4>
        </div>
        <span class="workflow-status-chip workflow-status-chip--${escapeHtml(card.status)}">${escapeHtml(statusLabel)}</span>
      </div>
      <div class="workflow-meta-row">
        <span class="metric-pill">${escapeHtml(card.deliverable)}</span>
        ${(card.cptCodes || []).map((code) => `<span class="health-badge">${escapeHtml(code)}</span>`).join("")}
        <span class="muted">${completed}/${total} checklist items complete</span>
      </div>
      ${card.evidence?.length ? `
        <div class="workflow-evidence-list">
          ${card.evidence.map((item) => `<span class="workflow-evidence-pill">${escapeHtml(item)}</span>`).join("")}
        </div>
      ` : '<p class="muted">Waiting on assessment fields, uploaded documents, notes, or session activity.</p>'}
      <div class="workflow-checklist">
        ${(card.checklist || []).map((item) => `
          <label class="workflow-checklist-item ${item.done ? "is-complete" : ""}">
            <input type="checkbox" ${item.done ? "checked" : ""} disabled>
            <span>${escapeHtml(item.label)}</span>
          </label>
        `).join("")}
      </div>
      <label>
        Notes
        <textarea rows="3" data-workflow-notes="${card.id}" placeholder="Client-specific notes, blockers, or follow-up">${escapeHtml(card.notes || "")}</textarea>
      </label>
    </article>
  `;
}

async function handleWorkflowBoardChange(event) {
  const statusSelect = event.target.closest("[data-workflow-status]");
  if (statusSelect) {
    const board = clientWorkflowBoard();
    const card = board.find((item) => item.id === statusSelect.dataset.workflowStatus);
    if (!card) return;
    card.status = statusSelect.value;
    await saveWorkflowBoard(board, "Workflow status updated.");
    return;
  }
  const checklistInput = event.target.closest("[data-workflow-check]");
  if (checklistInput) {
    const [cardId, itemId] = checklistInput.dataset.workflowCheck.split(":");
    const board = clientWorkflowBoard();
    const card = board.find((item) => item.id === cardId);
    const item = card?.checklist?.find((entry) => entry.id === itemId);
    if (!item) return;
    item.done = checklistInput.checked;
    await saveWorkflowBoard(board, "Workflow checklist updated.");
  }
}

async function handleWorkflowBoardBlur(event) {
  const notesField = event.target.closest("[data-workflow-notes]");
  if (!notesField) return;
  const board = clientWorkflowBoard();
  const card = board.find((item) => item.id === notesField.dataset.workflowNotes);
  if (!card || (card.notes || "") === notesField.value.trim()) return;
  card.notes = notesField.value.trim();
  await saveWorkflowBoard(board, "Workflow notes saved.");
}

async function saveWorkflowBoard(board, message = "") {
  try {
    const updated = await updateClientWorkflow(currentClient().id, board);
    replaceClient(updated);
    render();
    workflowMessage.textContent = message;
  } catch (error) {
    workflowMessage.textContent = error.message;
  }
}

function sessionAssignableTargets(status = "active") {
  return clientPrograms().flatMap((program) => {
    const programStatus = normalizePlanStatus(program.status || "active");
    if (status === "active" && programStatus === "mastered") return [];
    return (program.targets || [])
      .filter((target) => sessionTargetMatchesTab(programStatus, target, status))
      .map((target) => ({ program, target }));
  });
}

function programHasSessionContentForTab(program, status = "active") {
  const programStatus = normalizePlanStatus(program.status || "active");
  const targets = program.targets || [];
  if (!targets.length) {
    return status === "active" ? programStatus === "active" : programStatus === "mastered";
  }
  return targets.some((target) => sessionTargetMatchesTab(programStatus, target, status));
}

function sessionAvailableDomains(status = state.activeSessionTargetTab) {
  return clientDomains().filter((domain) => (
    clientPrograms().some((program) => (
      (program.domain || "General") === domain
      && programHasSessionContentForTab(program, status)
    ))
  ));
}

function sessionDomainLoadKey(status, domain) {
  return `${status}:${domain || "General"}`;
}

function markSessionDomainLoaded(status, domain) {
  const key = sessionDomainLoadKey(status, domain);
  if (!state.loadedSessionDomainKeys.includes(key)) {
    state.loadedSessionDomainKeys.push(key);
  }
}

function ensureDomainSessionRowsLoaded(status = state.activeSessionTargetTab, domain = state.activeDomain) {
  if (!programList || !domain) return;
  const key = sessionDomainLoadKey(status, domain);
  if (state.loadedSessionDomainKeys.includes(key)) return;

  const used = selectedTargetIds();
  const rowsToAdd = sessionAssignableTargets(status)
    .filter(({ program, target }) => (program.domain || "General") === domain && !used.has(target.id));

  rowsToAdd.forEach(({ program, target }) => {
    addProgramRow(program.id, target.id, { entryMode: status, __suppressRefresh: true });
  });

  markSessionDomainLoaded(status, domain);
}

function sessionTargetMatchesTab(programStatus, target, tab) {
  const targetStatus = normalizePlanStatus(target?.status || "active");
  if (tab === "maintenance") {
    if (programStatus === "mastered") return targetStatus !== "paused";
    return targetStatus === "mastered";
  }
  return targetStatus === "active";
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
  const parentReviews = currentParentTrainingGoals().map((goal) => parentGoalReview(goal).state);
  const masteredGoals = parentReviews.filter((stateValue) => stateValue === "mastered").length;
  const closeGoals = parentReviews.filter((stateValue) => stateValue === "close").length;
  parentClientSummary.innerHTML = client
    ? `
      <div><strong>${client.name}</strong><span>Client</span></div>
      <div><strong>${activeTargets}</strong><span>Active targets</span></div>
      <div><strong>${activeBehaviors}</strong><span>Behaviors tracked</span></div>
      <div><strong>${masteredGoals} / ${closeGoals}</strong><span>Meeting mastery / close</span></div>
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
    <div><strong>${client?.name || "None"}</strong><span>${client?.agency || "Selected client"}</span></div>
  `;
}

function renderAuthorizationUsage() {
  if (!authorizationUsage || !authorizationUsageNote) return;
  const client = currentClient();
  if (!client) {
    authorizationUsage.innerHTML = "";
    authorizationUsageNote.textContent = "";
    return;
  }
  const usage = authorizationUsageByCode(client);
  authorizationUsage.innerHTML = usage.map((row) => {
    const remainingClass = row.percentUsed >= 80 ? "medium" : "low";
    return `
      <div>
        <strong>${row.code}</strong>
        <span>${formatUsageNumber(row.usedHours)}h / ${row.usedUnits}u used</span>
        <span>${formatUsageNumber(row.approvedHours)}h / ${row.approvedUnits}u approved</span>
        <span class="health-badge ${remainingClass}">${formatUsageNumber(row.remainingHours)}h / ${row.remainingUnits}u left</span>
      </div>
    `;
  }).join("");
  authorizationUsageNote.textContent = "97153 and 97156 usage update automatically from saved sessions in the current authorization period. 97151 and 97155 will show 0 until timed billing entries are captured for those codes.";
}

function authorizationUsageByCode(client) {
  const cycle = currentAuthorizationCycle(client);
  const timedRows = state.sessions
    .filter((session) => session.clientId === client.id && dateFallsInCycle(session.date, cycle))
    .map((session) => billingRow(session));
  const services = client.profile?.authorization?.services || {};
  return ["97153", "97155", "97156", "97151"].map((code) => {
    const approvedHours = Number(services?.[code]?.hours || 0);
    const approvedUnits = Number(services?.[code]?.units || 0);
    const matchingRows = timedRows.filter((row) => row.codeValue === code);
    const usedMinutes = matchingRows.reduce((sum, row) => sum + row.minutes, 0);
    const usedUnits = matchingRows.reduce((sum, row) => sum + row.units, 0);
    const usedHours = roundUsage(usedMinutes / 60);
    const remainingHours = roundUsage(Math.max(approvedHours - usedHours, 0));
    const remainingUnits = Math.max(approvedUnits - usedUnits, 0);
    const percentUsed = approvedUnits > 0
      ? Math.round((usedUnits / approvedUnits) * 100)
      : approvedHours > 0
        ? Math.round((usedHours / approvedHours) * 100)
        : 0;
    return {
      code,
      approvedHours,
      approvedUnits,
      usedHours,
      usedUnits,
      remainingHours,
      remainingUnits,
      percentUsed
    };
  });
}

function roundUsage(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function formatUsageNumber(value) {
  return roundUsage(value).toFixed(Number.isInteger(roundUsage(value)) ? 0 : 2);
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
        Verification email
        <input type="email" value="${escapeHtml(user.email || "")}" data-user-field="email">
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
        Agency
        <select data-user-field="agency" ${canManageAcrossAgencies() ? "" : "disabled"}>
          ${agencyOptions.map((agency) => `
            <option value="${escapeHtml(agency)}" ${user.agency === agency ? "selected" : ""}>${escapeHtml(agency)}</option>
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
      ${canManageAcrossAgencies() ? `
        <label>
          Master admin
          <input type="checkbox" data-user-field="isMasterAdmin" value="true" ${user.isMasterAdmin ? "checked" : ""} ${user.role !== "admin" ? "disabled" : ""}>
        </label>
      ` : ""}
      <div class="button-row">
        <button type="button" class="secondary-button" data-save-user>Save</button>
        <button type="button" class="delete-button" data-reset-password>Reset password</button>
      </div>
    </div>
  `).join("");
  userList.querySelectorAll("[data-user-row]").forEach((row) => syncUserRowRoleControls(row));
}

function syncAdminAgencyControls() {
  const masterOnlyVisible = canManageAcrossAgencies();
  document.querySelectorAll("[data-master-admin-only]").forEach((section) => {
    section.classList.toggle("hidden", !masterOnlyVisible);
  });
  if (newUserForm?.elements.agency) {
    newUserForm.elements.agency.value = state.currentUser?.agency || agencyOptions[0];
    newUserForm.elements.agency.disabled = !masterOnlyVisible;
  }
  if (clientProfileForm?.elements.agency) {
    clientProfileForm.elements.agency.disabled = !canEditAdmin() || !masterOnlyVisible;
  }
  if (newClientForm?.elements.agency) {
    newClientForm.elements.agency.value = state.currentUser?.agency || agencyOptions[0];
    newClientForm.elements.agency.disabled = !masterOnlyVisible;
  }
  if (newUserForm?.elements.isMasterAdmin) {
    newUserForm.elements.isMasterAdmin.checked = false;
  }
  syncUserRoleControls();
}

function syncUserRoleControls() {
  if (!newUserForm?.elements.role) return;
  const isAdminRole = newUserForm.elements.role.value === "admin";
  const masterField = newUserForm.elements.isMasterAdmin;
  if (masterField) {
    masterField.disabled = !canManageAcrossAgencies() || !isAdminRole;
    if (!isAdminRole) masterField.checked = false;
  }
}

function syncUserRowRoleControls(row) {
  const roleField = row.querySelector('[data-user-field="role"]');
  const masterField = row.querySelector('[data-user-field="isMasterAdmin"]');
  if (!roleField || !masterField) return;
  const isAdminRole = roleField.value === "admin";
  masterField.disabled = !isAdminRole;
  if (!isAdminRole) masterField.checked = false;
}

function renderClientDocuments() {
  const client = currentClient();
  const documents = client?.profile?.documents || [];
  clientDocumentForm.querySelectorAll("input, select, textarea, button").forEach((field) => {
    field.disabled = !client || !canEditClinical();
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
        ${canEditClinical() ? `<button type="button" class="delete-button" data-delete-document="${escapeHtml(document.id)}">Delete</button>` : ""}
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
  return dedupeTargetEntries((session.programs || []).flatMap((program) => (
    Array.isArray(program.targets)
      ? program.targets.map((target) => ({ ...target, programId: program.programId }))
      : [{ ...program, targetId: program.targetId || program.programId }]
  )).filter((target) => target.targetId));
}

function hasTargetData(sessions, programId, targetId) {
  return sessions.some((session) => targetEntriesForSession(session).some((target) => target.programId === programId && target.targetId === targetId));
}

function hasBehaviorData(sessions, behaviorId) {
  return sessions.some((session) => behaviorEntriesForSession(session).some((behavior) => behavior.behaviorId === behaviorId));
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

function reportAssessmentFieldConfig(fieldName) {
  return {
    assessmentGrid: {
      documentType: "fba-assessment",
      label: "Assessment grid",
      mount: assessmentGridDraftFiles
    },
    standardizedAssessmentGrid: {
      documentType: "standardized-assessment",
      label: "Standardized assessment grid",
      mount: standardizedAssessmentGridDraftFiles
    }
  }[fieldName] || null;
}

function reportAssessmentDocumentRefsFromClient(fieldName, client = currentClient()) {
  const config = reportAssessmentFieldConfig(fieldName);
  if (!config || !client?.profile?.documents?.length) return [];
  return client.profile.documents
    .filter((document) => document.type === config.documentType)
    .map((document) => reportAssessmentDocumentRef(document, client.id))
    .filter(Boolean);
}

function reportAssessmentDocumentRef(document, clientId = currentClient()?.id || "") {
  if (!document?.id) return null;
  return {
    fileId: document.id,
    originalFileName: document.fileName || "",
    uploadedAt: document.uploadedAt || document.createdAt || "",
    fileSize: Number(document.fileSize || 0),
    contentType: document.contentType || document.mimeType || "",
    storagePath: document.relativePath || document.s3Key || "",
    objectKey: document.s3Key || "",
    clientId,
    documentType: document.type || ""
  };
}

function reportAssessmentRefs(fieldName) {
  const savedRefs = sanitizeAssessmentDocumentRefs(state.reportAssessmentDocuments)[fieldName] || [];
  if (savedRefs.length) return savedRefs;
  return reportAssessmentDocumentRefsFromClient(fieldName);
}

function setReportAssessmentRefs(fieldName, refs) {
  state.reportAssessmentDocuments = {
    ...sanitizeAssessmentDocumentRefs(state.reportAssessmentDocuments),
    [fieldName]: sanitizeAssessmentDocumentRefs({ [fieldName]: refs })[fieldName] || []
  };
}

function currentClientDocumentById(fileId) {
  return (currentClient()?.profile?.documents || []).find((document) => document.id === fileId) || null;
}

function renderReportAssessmentDraftFiles() {
  ["assessmentGrid", "standardizedAssessmentGrid"].forEach((fieldName) => {
    const config = reportAssessmentFieldConfig(fieldName);
    if (!config?.mount) return;
    const refs = reportAssessmentRefs(fieldName);
    if (!refs.length) {
      config.mount.innerHTML = `<p class="muted">No ${escapeHtml(config.label.toLowerCase())} attached to this draft.</p>`;
      return;
    }
    config.mount.innerHTML = `
      <div class="report-upload-draft-list">
        ${refs.map((ref) => {
          const document = currentClientDocumentById(ref.fileId);
          const fileName = escapeHtml(ref.originalFileName || "Uploaded file");
          const uploadedAt = ref.uploadedAt ? formatDateTime(ref.uploadedAt) : "Upload time unavailable";
          const fileSize = ref.fileSize ? `${Math.max(1, Math.round(ref.fileSize / 1024))} KB` : "Size unavailable";
          if (!document) {
            return `
              <div class="report-upload-draft-item report-upload-draft-item-missing">
                <div>
                  <strong>${fileName}</strong>
                  <span>Stored file reference is missing from client documents.</span>
                </div>
                <button type="button" class="delete-button" data-remove-report-attachment="${escapeHtml(fieldName)}" data-file-id="${escapeHtml(ref.fileId)}">Remove</button>
              </div>
            `;
          }
          return `
            <div class="report-upload-draft-item">
              <div>
                <strong>${fileName}</strong>
                <span>${escapeHtml(uploadedAt)} - ${escapeHtml(fileSize)}</span>
              </div>
              <div class="report-upload-draft-actions">
                <a class="secondary-button" href="${escapeHtml(document.url)}" target="_blank" rel="noopener">View / download</a>
                <button type="button" class="delete-button" data-remove-report-attachment="${escapeHtml(fieldName)}" data-file-id="${escapeHtml(ref.fileId)}">Remove</button>
              </div>
            </div>
          `;
        }).join("")}
      </div>
    `;
  });
}

function storedPhaseLinesForGraph(graphKey) {
  return sanitizeCustomPhaseLines(state.reportCustomPhaseLines)[graphKey] || [];
}

function customPhaseLinesForGraph(graphKey) {
  return storedPhaseLinesForGraph(graphKey).filter((line) => line.phaseType === "environmentalChange");
}

function treatmentPhaseOverrideForGraph(graphKey) {
  return storedPhaseLinesForGraph(graphKey).find((line) => line.phaseType === "userTreatmentOverride") || null;
}

function setCustomPhaseLinesForGraph(graphKey, lines) {
  const treatmentOverride = treatmentPhaseOverrideForGraph(graphKey);
  state.reportCustomPhaseLines = {
    ...sanitizeCustomPhaseLines(state.reportCustomPhaseLines),
    [graphKey]: sanitizeCustomPhaseLines({
      [graphKey]: [
        ...(Array.isArray(lines) ? lines : []),
        ...(treatmentOverride ? [treatmentOverride] : [])
      ]
    })[graphKey] || []
  };
}

function setTreatmentPhaseOverrideForGraph(graphKey, line) {
  const nextLines = [
    ...customPhaseLinesForGraph(graphKey),
    ...(line ? [line] : [])
  ];
  setCustomPhaseLinesForGraph(graphKey, nextLines);
}

function graphSeriesDateRange(series = []) {
  const dates = [...new Set((series || []).flatMap((item) => (item.points || []).map((point) => point.x)).filter(Boolean))].sort();
  return {
    startDate: dates[0] || "",
    endDate: dates[dates.length - 1] || ""
  };
}

function graphPhaseMarkers(graphKey, automaticMarkers = []) {
  return [
    ...(automaticMarkers || []),
    ...customPhaseLinesForGraph(graphKey)
  ];
}

function graphPhaseConfig(graphKey, series = [], automaticMarkers = []) {
  return {
    treatmentPhaseLine: graphTreatmentPhaseLine(graphKey, series),
    phaseMarkers: graphPhaseMarkers(graphKey, automaticMarkers)
  };
}

function graphTreatmentPhaseLine(graphKey, series = []) {
  const override = treatmentPhaseOverrideForGraph(graphKey);
  const dates = [...new Set((series || []).flatMap((item) => (item.points || []).map((point) => point.x)).filter(Boolean))].sort();
  if (override?.hidden) {
    return {
      id: override.id,
      date: override.date || dates[1] || "",
      label: override.label || "Treatment",
      lineStyle: override.lineStyle === "dashed" ? "dashed" : "solid",
      note: override.note || "",
      hidden: true,
      sourceType: "userTreatmentOverride",
      phaseType: "baselineToTreatment"
    };
  }
  if (override?.date) {
    return {
      id: override.id,
      date: override.date,
      label: override.label || "Treatment",
      lineStyle: override.lineStyle === "dashed" ? "dashed" : "solid",
      note: override.note || "",
      hidden: false,
      sourceType: "userTreatmentOverride",
      phaseType: "baselineToTreatment"
    };
  }
  if (dates.length < 2) return null;
  return {
    id: `${graphKey}:auto-treatment`,
    date: dates[1],
    label: "Treatment",
    lineStyle: "solid",
    note: "",
    hidden: false,
    sourceType: "autoTreatment",
    phaseType: "baselineToTreatment"
  };
}

function renderCustomPhaseLineManager(graphKey, series, options = {}) {
  const range = graphSeriesDateRange(series);
  const lines = customPhaseLinesForGraph(graphKey);
  const treatmentLine = graphTreatmentPhaseLine(graphKey, series);
  const editingId = options.editingId || "";
  const editingLine = editingId ? lines.find((line) => line.id === editingId) : null;
  const editingTreatment = options.editingTreatment === true;
  const submitLabel = editingLine ? "Save phase line" : "Add phase line";
  const actionLabel = options.readOnly ? "Environmental phase lines" : "Environmental phase lines";
  if (options.readOnly && !lines.length && !treatmentLine) return "";
  const listMarkup = lines.length
    ? `
      <div class="graph-phase-line-list">
        ${lines.map((line) => `
          <div class="graph-phase-line-item">
            <div>
              <strong>${escapeHtml(line.label)}</strong>
              <span>${escapeHtml(formatGraphDate(line.date))} - ${escapeHtml(line.lineStyle)}</span>
              ${line.note ? `<p class="graph-phase-line-note">${escapeHtml(line.note)}</p>` : ""}
            </div>
            ${options.readOnly ? "" : `
              <div class="graph-phase-line-actions">
                <button type="button" class="secondary-button" data-edit-phase-line="${escapeHtml(graphKey)}" data-phase-line-id="${escapeHtml(line.id)}">Edit</button>
                <button type="button" class="delete-button" data-delete-phase-line="${escapeHtml(graphKey)}" data-phase-line-id="${escapeHtml(line.id)}">Delete</button>
              </div>
            `}
          </div>
        `).join("")}
      </div>
    `
    : `<p class="muted">No custom environmental phase lines saved for this graph.</p>`;

  const treatmentSummary = !treatmentLine
    ? `<p class="muted">Treatment phase line unavailable; baseline/treatment analysis may be limited.</p>`
    : treatmentLine.hidden
      ? `<p class="muted">Treatment phase line hidden. Baseline/treatment analysis may be limited.</p>`
      : `
        <div class="graph-phase-line-item graph-phase-line-item-treatment">
          <div>
            <strong>${escapeHtml(treatmentLine.label || "Treatment")}</strong>
            <span>${escapeHtml(formatGraphDate(treatmentLine.date))} - ${escapeHtml(treatmentLine.lineStyle)}</span>
            ${treatmentLine.note ? `<p class="graph-phase-line-note">${escapeHtml(treatmentLine.note)}</p>` : ""}
          </div>
          ${options.readOnly ? "" : `
            <div class="graph-phase-line-actions">
              <button type="button" class="secondary-button" data-edit-treatment-phase-line="${escapeHtml(graphKey)}">Edit</button>
              <button type="button" class="delete-button" data-hide-treatment-phase-line="${escapeHtml(graphKey)}">Hide</button>
              ${treatmentLine.sourceType === "userTreatmentOverride" ? `<button type="button" class="secondary-button" data-reset-treatment-phase-line="${escapeHtml(graphKey)}">Reset to default</button>` : ""}
            </div>
          `}
        </div>
      `;

  const treatmentFormMarkup = !options.readOnly && editingTreatment && treatmentLine
    ? `
      <form class="graph-phase-line-form" data-phase-line-form="${escapeHtml(graphKey)}" data-phase-line-kind="treatment" data-start-date="${escapeHtml(range.startDate)}" data-end-date="${escapeHtml(range.endDate)}">
        <input type="hidden" name="phaseLineId" value="${escapeHtml(treatmentLine.id || `${graphKey}:treatment-override`)}">
        <label>
          Treatment start date
          <input type="date" name="phaseLineDate" value="${escapeHtml(treatmentLine.date || "")}" required>
        </label>
        <label>
          Label
          <input type="text" name="phaseLineLabel" value="${escapeHtml(treatmentLine.label || "Treatment")}" maxlength="80" required>
        </label>
        <label>
          Line style
          <select name="phaseLineStyle">
            <option value="solid" ${treatmentLine.lineStyle !== "dashed" ? "selected" : ""}>Solid</option>
            <option value="dashed" ${treatmentLine.lineStyle === "dashed" ? "selected" : ""}>Dashed</option>
          </select>
        </label>
        <label>
          Note
          <textarea name="phaseLineNote" rows="2" placeholder="Optional clinical note">${escapeHtml(treatmentLine.note || "")}</textarea>
        </label>
        <div class="graph-phase-line-form-actions">
          <button type="submit" class="primary-button">Save treatment phase line</button>
          <button type="button" class="secondary-button" data-cancel-treatment-phase-line="${escapeHtml(graphKey)}">Cancel</button>
        </div>
      </form>
    `
    : "";

  if (options.readOnly) {
    return `
      <section class="graph-phase-line-panel graph-phase-line-panel-readonly" aria-label="${escapeHtml(actionLabel)}">
        <div class="graph-analysis-toolbar">
          <strong>Treatment phase line</strong>
        </div>
        ${treatmentSummary}
        <div class="graph-analysis-toolbar">
          <strong>${escapeHtml(actionLabel)}</strong>
        </div>
        ${listMarkup}
      </section>
    `;
  }

  return `
    <section class="graph-phase-line-panel" data-phase-line-panel="${escapeHtml(graphKey)}">
      <div class="graph-analysis-toolbar">
        <strong>Treatment phase line</strong>
      </div>
      ${treatmentSummary}
      ${treatmentFormMarkup}
      <div class="graph-analysis-toolbar">
        <strong>${escapeHtml(actionLabel)}</strong>
      </div>
      ${listMarkup}
      <form class="graph-phase-line-form" data-phase-line-form="${escapeHtml(graphKey)}" data-phase-line-kind="environmental" data-start-date="${escapeHtml(range.startDate)}" data-end-date="${escapeHtml(range.endDate)}">
        <input type="hidden" name="phaseLineId" value="${escapeHtml(editingLine?.id || "")}">
        <label>
          Date
          <input type="date" name="phaseLineDate" value="${escapeHtml(editingLine?.date || "")}" ${range.startDate ? `min="${escapeHtml(range.startDate)}"` : ""} ${range.endDate ? `max="${escapeHtml(range.endDate)}"` : ""} required>
        </label>
        <label>
          Label
          <input type="text" name="phaseLineLabel" value="${escapeHtml(editingLine?.label || "")}" placeholder="Medication change, new RBT" required>
        </label>
        <label>
          Line style
          <select name="phaseLineStyle">
            <option value="dashed" ${editingLine?.lineStyle !== "solid" ? "selected" : ""}>Dashed</option>
            <option value="solid" ${editingLine?.lineStyle === "solid" ? "selected" : ""}>Solid</option>
          </select>
        </label>
        <label>
          Note
          <input type="text" name="phaseLineNote" value="${escapeHtml(editingLine?.note || "")}" placeholder="Optional environmental note">
        </label>
        <div class="graph-phase-line-form-actions">
          <button type="submit" class="secondary-button">${escapeHtml(submitLabel)}</button>
          ${editingLine ? `<button type="button" class="secondary-button" data-cancel-phase-line="${escapeHtml(graphKey)}">Cancel</button>` : ""}
        </div>
      </form>
    </section>
  `;
}

function handleReportDraftInput() {
  markReportDraftDirty();
}

async function handleReportFormChange(event) {
  const fileField = event?.target?.name;
  if (fileField === "assessmentGrid" || fileField === "standardizedAssessmentGrid") {
    await handleReportAssessmentUpload(event.target);
  }
  markReportDraftDirty();
  renderReportSummary();
  if (currentView() === "report") renderFunderReportPreview();
}

function handleReportFormClick(event) {
  const remove = event.target.closest("[data-remove-report-attachment]");
  if (!remove) return;
  handleReportAttachmentRemove(remove.dataset.removeReportAttachment, remove.dataset.fileId);
}

async function handleReportAssessmentUpload(input) {
  const client = currentClient();
  const fieldName = input?.name;
  const config = reportAssessmentFieldConfig(fieldName);
  const file = input?.files?.[0];
  if (!client || !config || !file) return;

  const duplicate = reportAssessmentRefs(fieldName).some((ref) => (
    ref.originalFileName === file.name
    && Number(ref.fileSize || 0) === Number(file.size || 0)
    && (ref.contentType || "") === (file.type || "application/octet-stream")
  ));
  if (duplicate) {
    input.value = "";
    funderExportStatus.textContent = `${config.label} is already attached to this draft.`;
    return;
  }

  try {
    funderExportStatus.textContent = `Uploading ${config.label.toLowerCase()}...`;
    const dataUrl = await readFileAsDataUrl(file);
    const documentDate = fieldName === "standardizedAssessmentGrid"
      ? reportForm.elements.standardizedAssessmentDate?.value || ""
      : reportForm.elements.assessmentDate?.value || "";
    const document = await uploadClientDocument(client.id, {
      documentType: config.documentType,
      documentDate,
      notes: `Attached from funder report draft (${config.label})`,
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      fileSize: file.size || 0,
      dataUrl
    });
    currentClient().profile = currentClient().profile || {};
    currentClient().profile.documents = currentClient().profile.documents || [];
    currentClient().profile.documents = [
      document,
      ...currentClient().profile.documents.filter((item) => item.id !== document.id)
    ];
    const nextRefs = [...reportAssessmentRefs(fieldName), reportAssessmentDocumentRef(document, client.id)].filter(Boolean);
    setReportAssessmentRefs(fieldName, nextRefs);
    renderReportAssessmentDraftFiles();
    input.value = "";
    markReportDraftDirty();
    funderExportStatus.textContent = document.storageWarning
      ? `${config.label} uploaded and attached to this draft. ${document.storageWarning}`
      : `${config.label} uploaded and attached to this draft.`;
  } catch (error) {
    funderExportStatus.textContent = `${config.label} upload failed: ${error.message}`;
  }
}

function handleReportAttachmentRemove(fieldName, fileId) {
  const config = reportAssessmentFieldConfig(fieldName);
  const ref = reportAssessmentRefs(fieldName).find((item) => item.fileId === fileId);
  if (!config || !ref) return;
  if (!window.confirm(`Remove ${ref.originalFileName || config.label} from this draft? The stored file will remain available in client documents.`)) return;
  setReportAssessmentRefs(fieldName, reportAssessmentRefs(fieldName).filter((item) => item.fileId !== fileId));
  renderReportAssessmentDraftFiles();
  markReportDraftDirty();
  if (currentView() === "report") renderFunderReportPreview();
  funderExportStatus.textContent = `${config.label} removed from this draft.`;
}

function reportGraphPreferenceKeys() {
  const client = currentClient();
  return [
    ...clientPrograms().map((program) => graphTrendKey("skill", program.id)),
    ...clientBehaviors().map((behavior) => graphTrendKey("behavior", behavior.id)),
    graphTrendKey("behavior", "overview"),
    ...(client ? currentParentTrainingGoals().map((goal) => graphTrendKey("parent", parentTrainingGoalKey(goal))) : [])
  ];
}

function currentReportIncludedContent() {
  return {
    programIds: clientPrograms().map((program) => program.id),
    targetIds: clientPrograms().flatMap((program) => (program.targets || []).map((target) => target.id)).filter(Boolean),
    behaviorIds: clientBehaviors().map((behavior) => behavior.id).filter(Boolean),
    parentTrainingGoalIds: currentParentTrainingGoals().map((goal) => parentTrainingGoalKey(goal)).filter(Boolean)
  };
}

function currentFunderReportDraft() {
  if (!reportForm) return {};
  const values = new FormData(reportForm);
  const sections = {};
  const generatedSectionAutofill = {};
  const existingDraft = currentClient()?.profile?.funderReport || {};
  values.forEach((value, key) => {
    if (key === "assessmentGrid" || key === "standardizedAssessmentGrid") return;
    sections[key] = String(value || "");
  });
  [...reportForm.elements].forEach((field) => {
    if (!field?.name || field.type === "file") return;
    if (field.dataset?.autofillValue) {
      generatedSectionAutofill[field.name] = String(field.dataset.autofillValue || "");
    }
  });
  const assessmentDocuments = sanitizeAssessmentDocumentRefs({
    assessmentGrid: reportAssessmentRefs("assessmentGrid"),
    standardizedAssessmentGrid: reportAssessmentRefs("standardizedAssessmentGrid")
  });
  return buildFunderDraftRecord({
    clientId: currentClient()?.id || "",
    startDate: sections.startDate || "",
    endDate: sections.endDate || "",
    sections,
    generatedSectionAutofill,
    fadePlanRows: readFadePlanRows(),
    serviceHours: readServiceHourRows(),
    graphPreferences: sanitizeTrendVisibilityMap(state.graphTrendVisibility, reportGraphPreferenceKeys()),
    includedContent: currentReportIncludedContent(),
    displaySettings: {
      compactGraphAnalysis: true
    },
    assessmentDocuments,
    customPhaseLines: sanitizeCustomPhaseLines(state.reportCustomPhaseLines),
    editedGraphAnalysis: structuredClone(existingDraft.editedGraphAnalysis || {}),
    existingDraft
  });
}

function applyFunderReportDraft(draft = {}) {
  if (!reportForm) return;
  const rows = Array.isArray(draft.fadePlanRows) ? draft.fadePlanRows : [];
  const serviceRows = Array.isArray(draft.serviceHours) ? draft.serviceHours : [];
  const graphPreferences = draft.settings?.graphPreferences || {};
  const generatedSectionAutofill = draft.metadata?.generatedSectionAutofill || {};
  const restoredAssessmentDocuments = sanitizeAssessmentDocumentRefs(draft.assessmentDocuments || {});
  state.reportAssessmentDocuments = {
    assessmentGrid: restoredAssessmentDocuments.assessmentGrid.length
      ? restoredAssessmentDocuments.assessmentGrid
      : reportAssessmentDocumentRefsFromClient("assessmentGrid"),
    standardizedAssessmentGrid: restoredAssessmentDocuments.standardizedAssessmentGrid.length
      ? restoredAssessmentDocuments.standardizedAssessmentGrid
      : reportAssessmentDocumentRefsFromClient("standardizedAssessmentGrid")
  };
  state.reportCustomPhaseLines = sanitizeCustomPhaseLines(draft.customPhaseLines || {});
  reportGraphPreferenceKeys().forEach((key) => {
    if (Object.hasOwn(graphPreferences, key)) {
      state.graphTrendVisibility[key] = Boolean(graphPreferences[key]);
    } else {
      delete state.graphTrendVisibility[key];
    }
  });
  [...reportForm.elements].forEach((field) => {
    if (!field?.name || field.type === "file") return;
    if (Object.hasOwn(draft, field.name)) {
      field.value = String(draft[field.name] || "");
    }
    const restoredAutofill = generatedSectionAutofill[field.name];
    if (typeof restoredAutofill === "string" && restoredAutofill) {
      field.dataset.autofillValue = restoredAutofill;
    } else if (field.name === "skillAcquisitionSummary" && isLegacyGeneratedSkillAcquisitionSummary(field.value || "")) {
      field.dataset.autofillValue = String(field.value || "");
    } else if (field.name === "parentTrainingSummary" && isLegacyGeneratedParentTrainingSummary(field.value || "")) {
      field.dataset.autofillValue = String(field.value || "");
    } else {
      delete field.dataset.autofillValue;
    }
  });
  fadePlanRows.innerHTML = "";
  (rows.length ? rows : defaultFadePlanRows()).forEach((row) => addFadePlanRow(row));
  serviceHourRows.innerHTML = "";
  (serviceRows.length ? serviceRows : defaultServiceHourRows()).forEach((row) => addServiceHourRow(row));
  renderReportAssessmentDraftFiles();
}

function reportDraftSnapshot(draft = currentFunderReportDraft()) {
  return JSON.stringify(draft);
}

function savedDraftLastSavedAt(draft = currentClient()?.profile?.funderReport || {}) {
  return draft?.metadata?.lastSavedAt || draft?.metadata?.updatedAt || "";
}

function updateResumeDraftButtonState(draft = currentClient()?.profile?.funderReport || {}) {
  if (!resumeFunderReportButton) return;
  const hasDraft = hasMeaningfulFunderReportDraft(draft);
  resumeFunderReportButton.disabled = !hasDraft;
  const timestamp = savedDraftLastSavedAt(draft);
  resumeFunderReportButton.textContent = hasDraft && timestamp
    ? `Resume saved draft (${formatDateTime(timestamp)})`
    : "Resume saved draft";
}

function markReportDraftDirty() {
  const client = currentClient();
  if (!client || state.reportDraftClientId !== client.id) return;
  const dirty = reportDraftSnapshot() !== state.reportDraftSavedSnapshot;
  state.reportDraftDirty = dirty;
  if (dirty) {
    funderExportStatus.textContent = "Unsaved report changes.";
  } else if (funderExportStatus.textContent === "Unsaved report changes.") {
    funderExportStatus.textContent = "";
  }
}

function syncFunderReportDraftForClient() {
  const client = currentClient();
  if (!client || !reportForm) return;
  if (state.reportDraftClientId === client.id) {
    markReportDraftDirty();
    updateResumeDraftButtonState(client.profile?.funderReport || {});
    return;
  }
  const savedDraft = structuredClone(client.profile?.funderReport || {});
  resetFunderReportForm();
  applyFunderReportDraft(savedDraft);
  state.reportDraftClientId = client.id;
  state.reportDraftSavedSnapshot = reportDraftSnapshot();
  state.reportDraftDirty = false;
  updateResumeDraftButtonState(savedDraft);
  if (hasMeaningfulFunderReportDraft(savedDraft)) {
    const lastSavedAt = savedDraftLastSavedAt(savedDraft);
    funderExportStatus.textContent = lastSavedAt
      ? `Saved report draft restored from ${formatDateTime(lastSavedAt)}.`
      : "Saved report draft restored.";
  } else if (funderExportStatus.textContent === "Saved report draft restored." || funderExportStatus.textContent === "Unsaved report changes.") {
    funderExportStatus.textContent = "";
  }
}

function resumeSavedFunderReportDraft() {
  const draft = structuredClone(currentClient()?.profile?.funderReport || {});
  if (!hasMeaningfulFunderReportDraft(draft)) {
    funderExportStatus.textContent = "No saved report draft is available for this client yet.";
    return;
  }
  resetFunderReportForm();
  applyFunderReportDraft(draft);
  renderReportSummary();
  renderFunderReportPreview();
  state.reportDraftSavedSnapshot = reportDraftSnapshot();
  state.reportDraftDirty = false;
  const lastSavedAt = savedDraftLastSavedAt(draft);
  funderExportStatus.textContent = lastSavedAt
    ? `Saved report draft resumed from ${formatDateTime(lastSavedAt)}.`
    : "Saved report draft resumed.";
}

function renderReportSummary() {
  const client = currentClient();
  const sessions = filteredReportSessions();
  applyIntakeInterviewToReport();
  syncParentTrainingReportFields();
  syncProgressSummaryField();
  syncSkillAcquisitionSummaryField();
  reportClientSummary.innerHTML = client
    ? `
      <div><strong>${client.name}</strong><span>Client</span></div>
      <div><strong>${formatDate(reportForm.elements.startDate.value)}</strong><span>Report start</span></div>
      <div><strong>${sessions.length}</strong><span>Sessions in range</span></div>
    `
    : "";
}

function syncProgressSummaryField(force = false) {
  if (!reportForm) return;
  setGeneratedReportField("progressSummary", buildReportProgressSummary(), force);
}

function skillAcquisitionReportModel(startDate, endDate) {
  return summarizeSkillAcquisitionReport({
    programs: clientPrograms(),
    planChangeLog: currentClient()?.planChangeLog || [],
    startDate,
    endDate
  });
}

function syncSkillAcquisitionSummaryField(force = false) {
  if (!reportForm) return;
  const model = skillAcquisitionReportModel(reportForm.elements.startDate.value, reportForm.elements.endDate.value);
  setGeneratedReportField("skillAcquisitionSummary", buildEditableSkillAcquisitionSummary(model), force);
}

function buildFunderReportPreviewMarkup() {
  const client = currentClient();
  const sessions = filteredReportSessions().slice().reverse();
  const values = new FormData(reportForm);
  const metrics = funderReportMetrics(sessions);
  return `
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
        ${safeReportFilePreview("assessmentGrid", "Assessment grid")}
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
        ${safeReportFilePreview("standardizedAssessmentGrid", "Standardized assessment grid")}
      </section>
      <section>
        <h3>Skill Acquisition Graphs</h3>
        <div id="report-skill-charts" class="chart-zone"></div>
      </section>
      <section>
        <h3>Skill Acquisition Goal and Target Summary</h3>
        ${renderParentTrainingProgressSummary(values.get("skillAcquisitionSummary") || buildEditableSkillAcquisitionSummary(skillAcquisitionReportModel(values.get("startDate"), values.get("endDate"))))}
      </section>
      <section>
        <h3>Parent Training</h3>
        ${renderParentTrainingReportSummary(values.get("startDate"), values.get("endDate"), {
          summaryText: values.get("parentTrainingSummary"),
          recommendationText: values.get("parentTrainingRecommendations")
        })}
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
}

function renderFunderReportPreview() {
  if (!reportPreview || !reportForm) return;
  try {
    reportPreview.innerHTML = buildFunderReportPreviewMarkup();
  } catch (error) {
    console.error("Funder report preview render failed", { message: error?.message || String(error) });
    reportPreview.innerHTML = `
      <section class="report-document">
        <div class="status-message warning">
          The funder report preview could not be fully rendered. Uploaded assessment documents will be skipped while you continue editing.
        </div>
      </section>
    `;
    funderExportStatus.textContent = "One uploaded assessment document could not be loaded.";
    return;
  }
  try {
    drawFunderReportCharts(filteredReportSessions().slice().reverse());
  } catch (error) {
    console.error("Funder report chart render failed", { message: error?.message || String(error) });
    funderExportStatus.textContent = "One chart could not be rendered, but the report content is still available.";
  }
}

async function handleSaveFunderReportDraft() {
  const client = currentClient();
  if (!client) return;
  funderExportStatus.textContent = "";
  try {
    const draft = currentFunderReportDraft();
    const updated = await updateClientProfile(client.id, {
      ...currentClientProfilePayload(client),
      funderReport: draft
    });
    replaceClient(updated);
    state.reportDraftClientId = updated.id;
    state.reportDraftSavedSnapshot = reportDraftSnapshot(draft);
    state.reportDraftDirty = false;
    updateResumeDraftButtonState(updated.profile?.funderReport || draft);
    funderExportStatus.textContent = `Draft saved ${new Date().toLocaleString()}. Lightweight draft payload: about ${Math.max(1, Math.round(estimateJsonBytes(draft) / 1024))} KB.`;
    if (currentView() === "report") renderFunderReportPreview();
  } catch (error) {
    funderExportStatus.textContent = `Draft save failed: ${error.message}`;
  }
}

function buildReportProgressSummary() {
  const client = currentClient();
  const sessions = filteredReportSessions();
  const metrics = funderReportMetrics(sessions);
  return `Across the reporting period, ${client?.name || "client"} completed ${sessions.length} documented sessions. Average skill independence was ${metrics.averageIndependence}%. Behavior data were reviewed across tracked behaviors for treatment planning.`;
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

function setGeneratedReportField(name, value, force = false) {
  const field = reportForm.elements[name];
  if (!field) return;
  const nextValue = String(value || "");
  const previous = field.dataset.autofillValue || "";
  const current = field.value || "";
  if (force || !current || current === previous) {
    field.value = nextValue;
    field.dataset.autofillValue = nextValue;
  }
}

function parentTrainingReportModel(startDate, endDate) {
  const parentSessions = parentTrainingSessionsForRange(startDate, endDate);
  const criteria = currentMasteryCriteria();
  const goalReviewsByKey = Object.fromEntries(
    currentParentTrainingGoals().map((goal) => [parentTrainingGoalKey(goal), parentGoalReview(goal).state])
  );
  const masteredGoalsDuringPeriod = filterMasteredGoalsForPeriod(
    currentParentTrainingGoals().flatMap((goal) => {
      const history = parentGoalSessionHistory(goal);
      const fidelitySessions = history.map((item) => ({
        session: item.session,
        entry: { independence: Number(item.goal.fidelity || 0) }
      }));
      const masteryWindow = findMasteryWindow(fidelitySessions, criteria.consecutiveSessions, criteria.thresholdPercent);
      if (!masteryWindow?.length) return [];
      const masteryDate = masteryWindow[0]?.session?.date;
      if (!masteryDate) return [];
      return [{
        ...goal,
        masteredDate: masteryDate
      }];
    }),
    startDate,
    endDate
  );
  return summarizeParentTrainingReport({
    parentSessions,
    currentGoals: currentParentTrainingGoals(),
    goalReviewsByKey,
    masteredGoalsDuringPeriod
  });
}

function syncParentTrainingReportFields(force = false) {
  if (!reportForm) return;
  const model = parentTrainingReportModel(reportForm.elements.startDate.value, reportForm.elements.endDate.value);
  setGeneratedReportField("parentTrainingSummary", buildEditableParentTrainingSummary(model), force);
  setGeneratedReportField("parentTrainingRecommendations", model.recommendationText, force);
}

function renderSoapSummary() {
  const client = currentClient();
  const entry = selectedSoapEntry();
  const session = entry?.type === "session" ? entry.session : null;
  const serviceCode = entry?.type === "97151"
    ? "97151"
    : entry?.type === "97155"
      ? "97155"
      : (session ? sessionCodeLabel(session) : "Session notes");
  const selectedLabel = entry?.type === "97151"
    ? formatDate(entry.record?.date || "")
    : entry?.type === "97155"
      ? formatDate(entry.record?.date || "")
      : (session ? formatDate(session.date) : "None");
  const statusLabel = entry?.type === "97151"
    ? (String(entry?.note || "").trim() ? "Saved" : "Not generated")
    : entry?.type === "97155"
      ? (String(entry?.note || "").trim() ? "Saved" : "Not generated")
      : (session?.finalized ? "Finalized" : "Draft");
  const activityLabel = entry ? soapEntryActivityLabel(entry) : "No note selected";
  soapCodeLabel.textContent = serviceCode;
  soapClientSummary.innerHTML = client
    ? `
      <div><strong>${client.name}</strong><span>Client</span></div>
      <div><strong>${selectedLabel}</strong><span>${entry?.type === "session" ? "Selected session" : "Selected note"}</span></div>
      <div><strong>${escapeHtml(activityLabel)}</strong><span>Activity</span></div>
      <div><strong>${serviceCode}</strong><span>Service code</span></div>
      <div><strong>${statusLabel}</strong><span>Note status</span></div>
    `
    : "";
}

function renderPlanReview() {
  const programs = clientPrograms();
  const behaviors = clientBehaviors();
  const client = currentClient();
  const activePrograms = programs.filter((program) => programHasPlanContentForTab(program, "active")).length;
  const pausedPrograms = programs.filter((program) => programHasPlanContentForTab(program, "paused")).length;
  const masteredPrograms = programs.filter((program) => programHasPlanContentForTab(program, "mastered")).length;
  const activeTargets = programs.flatMap((program) => program.targets || []).filter((target) => target.status === "active").length;
  const pausedTargets = programs.flatMap((program) => program.targets || []).filter((target) => normalizePlanStatus(target.status) === "paused").length;
  const masteryCounts = masteryReviewCounts();
  planClientSummary.innerHTML = client
    ? `
      <div><strong>${client.name}</strong><span>Client</span></div>
      <div><strong>${activePrograms} / ${pausedPrograms} / ${masteredPrograms}</strong><span>Active / on hold / mastered goals</span></div>
      <div><strong>${activeTargets}</strong><span>Active targets</span></div>
      <div><strong>${pausedTargets}</strong><span>On hold targets</span></div>
      <div><strong>${behaviors.filter((behavior) => behavior.status !== "inactive").length}</strong><span>Active behaviors</span></div>
      <div><strong>${masteryCounts.ready} / ${masteryCounts.close} / ${masteryCounts.stagnant}</strong><span>Ready / close / stagnant</span></div>
    `
    : "";

  if (!programs.length) {
    planStatusTabs.innerHTML = "";
    planDomainTabs.innerHTML = "";
    planReview.innerHTML = `
      <p class="muted">No treatment plan targets configured.</p>
      ${renderPlanBehaviorSection(behaviors)}
    `;
    bindPlanReviewInputs();
    return;
  }

  renderPlanStatusTabs(programs);
  const visiblePrograms = programs.filter((program) => programHasPlanContentForTab(program, state.activePlanProgramTab));
  if (!visiblePrograms.length) {
    planDomainTabs.innerHTML = "";
    planReview.innerHTML = state.activePlanReviewFilter
      ? `<p class="muted">No ${escapeHtml(state.activePlanReviewFilter)} targets found in this treatment plan.</p>`
      : state.activePlanProgramTab === "mastered"
      ? '<p class="muted">No mastered goals yet.</p>'
      : state.activePlanProgramTab === "paused"
        ? '<p class="muted">No on-hold goals yet.</p>'
        : `
          <p class="muted">No active goals yet.</p>
          ${renderPlanBehaviorSection(behaviors)}
        `;
    bindPlanReviewInputs();
    return;
  }
  const groupedPrograms = groupedProgramsByDomain(visiblePrograms);
  renderPlanDomainTabs(groupedPrograms.map(([domain]) => domain));

  planReview.innerHTML = `
    <section class="plan-status-legend">
      <button type="button" class="health-badge mastery-close-badge ${state.activePlanReviewFilter === "close" ? "is-active" : ""}" data-review-jump="close" aria-pressed="${state.activePlanReviewFilter === "close"}">Close (${masteryCounts.close})</button>
      <button type="button" class="health-badge mastery-ready-badge ${state.activePlanReviewFilter === "ready" ? "is-active" : ""}" data-review-jump="ready" aria-pressed="${state.activePlanReviewFilter === "ready"}">Ready (${masteryCounts.ready})</button>
      <button type="button" class="health-badge mastered-badge ${state.activePlanReviewFilter === "mastered" ? "is-active" : ""}" data-review-jump="mastered" aria-pressed="${state.activePlanReviewFilter === "mastered"}">Mastered (${masteryCounts.mastered})</button>
      <button type="button" class="health-badge stagnant-badge ${state.activePlanReviewFilter === "stagnant" ? "is-active" : ""}" data-review-jump="stagnant" aria-pressed="${state.activePlanReviewFilter === "stagnant"}">Stagnant (${masteryCounts.stagnant})</button>
    </section>
    ${state.activePlanReviewFilter ? `<p class="plan-review-filter-note">Showing all ${escapeHtml(state.activePlanReviewFilter)} targets across domains. Click the same badge again to clear.</p>` : ""}
    ${groupedPrograms.map(([domain, domainPrograms]) => `
    <section class="plan-domain ${state.activePlanReviewFilter || domain === state.activePlanDomain ? "" : "hidden"}" data-plan-domain="${escapeHtml(domain)}">
      <div class="plan-domain-heading">
        <h3>${escapeHtml(domain)}</h3>
        <span>${domainPrograms.length} program${domainPrograms.length === 1 ? "" : "s"}</span>
      </div>
      ${domainPrograms.map((program) => renderPlanProgram(program, state.activePlanProgramTab)).join("")}
    </section>
  `).join("")}
    ${state.activePlanProgramTab === "active" && !state.activePlanReviewFilter ? renderPlanBehaviorSection(behaviors) : ""}
  `;

  bindPlanReviewInputs();
}

function renderPlanStatusTabs(programs) {
  if (!planStatusTabs) return;
  const counts = {
    active: programs.filter((program) => programHasPlanContentForTab(program, "active")).length,
    paused: programs.filter((program) => programHasPlanContentForTab(program, "paused")).length,
    mastered: programs.filter((program) => programHasPlanContentForTab(program, "mastered")).length
  };
  if (!counts[state.activePlanProgramTab]) {
    if (counts.active) {
      state.activePlanProgramTab = "active";
    } else if (counts.paused) {
      state.activePlanProgramTab = "paused";
    } else if (counts.mastered) {
      state.activePlanProgramTab = "mastered";
    }
  }
  planStatusTabs.innerHTML = ["active", "paused", "mastered"].map((tab) => `
    <button type="button" class="domain-tab ${tab === state.activePlanProgramTab ? "active" : ""}" data-plan-status-tab="${tab}">
      ${tab === "active" ? "Active goals" : tab === "paused" ? "On hold" : "Mastered goals"}${counts[tab] ? ` (${counts[tab]})` : ""}
    </button>
  `).join("");
  planStatusTabs.querySelectorAll("[data-plan-status-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activePlanProgramTab = button.dataset.planStatusTab;
      state.activePlanReviewFilter = "";
      renderPlanReview();
    });
  });
}

function normalizePlanStatus(status = "active") {
  if (status === "maintenance") return "mastered";
  if (status === "paused") return "paused";
  return status === "mastered" ? "mastered" : "active";
}

function bindPlanReviewInputs() {
  planReview.querySelectorAll("[data-program-name], [data-program-objective], [data-target-name], [data-target-note], [data-behavior-name], [data-plan-parent-goal], [data-plan-parent-target], [data-plan-parent-opportunities], [data-plan-parent-independent], [data-plan-parent-prompted]").forEach((input) => {
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
  planReview.querySelectorAll("[data-plan-parent-prompt-level]").forEach((select) => {
    select.addEventListener("change", handlePlanTextEdit);
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
              <button type="button" class="secondary-button" data-open-plan-behavior-graph="${behavior.id}">View graph</button>
              <button type="button" class="delete-button" data-remove-plan-behavior="${behavior.id}">Remove</button>
            </div>
          </div>
        `).join("") : '<p class="muted">No behaviors added yet.</p>'}
      </div>
    </section>
  `;
}

function renderPlanParentTrainingSection() {
  const goals = currentParentTrainingGoals();
  return `
    <section class="plan-program">
      <div class="plan-domain-heading">
        <h3>Parent training</h3>
        <span>${goals.length} goal${goals.length === 1 ? "" : "s"}</span>
      </div>
      <p class="muted">Manage the caregiver-training goal bank here so 97156 sessions preload the current goals.</p>
      <div class="button-row">
        <button type="button" class="secondary-button" data-add-plan-parent-goal>Add parent goal</button>
      </div>
      <div class="plan-target-list">
        ${goals.length ? goals.map((goal, index) => {
          const review = parentGoalReview(goal);
          const denominator = Math.max(Number(goal.opportunities || 0), Number(goal.independent || 0) + Number(goal.prompted || 0), 1);
          const score = Math.round((Number(goal.independent || 0) / denominator) * 100);
          return `
            <div class="data-row parent-goal-row ${review.className || ""}">
              <label class="parent-goal-main">
                Parent goal
                <input type="text" value="${escapeHtml(goal.goalName || "")}" data-plan-parent-goal="${index}" placeholder="Entire caregiver-training goal">
              </label>
              <div class="parent-goal-controls">
                <label>
                  Target
                  <input type="text" value="${escapeHtml(goal.targetName || "")}" data-plan-parent-target="${index}" placeholder="Caregiver target">
                </label>
                <label>
                  Opportunities
                  <input type="number" value="${Number(goal.opportunities ?? 5)}" min="0" data-plan-parent-opportunities="${index}">
                </label>
                <label>
                  Independent
                  <input type="number" value="${Number(goal.independent ?? 0)}" min="0" data-plan-parent-independent="${index}">
                </label>
                <label>
                  Prompted
                  <input type="number" value="${Number(goal.prompted ?? 0)}" min="0" data-plan-parent-prompted="${index}">
                </label>
                <label>
                  Prompt level
                  <select data-plan-parent-prompt-level="${index}">
                    ${["independent", "gestural", "verbal", "modeling", "physical"].map((level) => `
                      <option value="${level}" ${String(goal.promptLevel || "verbal") === level ? "selected" : ""}>${capitalize(level)}</option>
                    `).join("")}
                  </select>
                </label>
                <div class="metric-pill" data-plan-parent-score="${index}">${score}%</div>
                <button type="button" class="icon-button" data-remove-plan-parent-goal="${index}" aria-label="Remove parent goal">x</button>
              </div>
              <div class="parent-goal-review">${review.message || ""}</div>
            </div>
          `;
        }).join("") : '<p class="muted">No parent training goals added yet.</p>'}
      </div>
    </section>
  `;
}

function targetMatchesPlanTab(target, tab) {
  const status = normalizePlanStatus(target?.status || "active");
  return status === tab;
}

function targetMatchesPlanReviewFilter(program, target) {
  if (!state.activePlanReviewFilter) return true;
  return masteryReviewForTarget(program.id, target.id).state === state.activePlanReviewFilter;
}

function filteredTargetsForPlanProgram(program, tab) {
  return (program.targets || []).filter((target) => {
    if (!targetMatchesPlanReviewFilter(program, target)) return false;
    if (state.activePlanReviewFilter) return true;
    return targetMatchesPlanTab(target, tab);
  });
}

function programHasPlanContentForTab(program, tab) {
  const visibleTargets = filteredTargetsForPlanProgram(program, tab);
  if (visibleTargets.length) return true;
  if (state.activePlanReviewFilter) return false;
  if (!(program.targets || []).length) {
    const status = normalizePlanStatus(program.status || "active");
    return status === tab;
  }
  const status = normalizePlanStatus(program.status || "active");
  return status === tab && tab !== "active";
}

function renderPlanDomainTabs(domains) {
  if (state.activePlanReviewFilter) {
    planDomainTabs.innerHTML = "";
    return;
  }
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
      state.activePlanReviewFilter = "";
      renderPlanReview();
    });
  });
}

function renderPlanProgram(program, tab = state.activePlanProgramTab) {
  const visibleTargets = filteredTargetsForPlanProgram(program, tab);
  const displayedProgramStatus = normalizePlanStatus(program.status || "active");
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
            ${clientDomains().map((domain) => `
              <option value="${escapeHtml(domain)}" ${program.domain === domain ? "selected" : ""}>${escapeHtml(domain)}</option>
            `).join("")}
          </select>
        </label>
        <label>
          Goal status
          <select data-plan-program-status="${program.id}" aria-label="${program.name} goal status">
            ${["active", "paused", "mastered"].map((status) => `
              <option value="${status}" ${displayedProgramStatus === status ? "selected" : ""}>${status === "paused" ? "on hold" : status}</option>
            `).join("")}
          </select>
        </label>
        <div class="plan-program-actions">
          <button type="button" class="secondary-button" data-open-plan-graph="${program.id}">View graph</button>
          <button type="button" class="secondary-button" data-add-target="${program.id}">Add target</button>
        </div>
      </div>
      <label>
        Objective
        <textarea rows="3" data-program-objective="${program.id}" aria-label="${program.name} objective">${escapeHtml(program.objective || "")}</textarea>
      </label>
      <div class="plan-target-list">
        ${visibleTargets.length ? visibleTargets.map((target) => `
          <div class="plan-target ${masteryReviewClass(program, target)}" data-review-state="${escapeHtml(masteryReviewForTarget(program.id, target.id).state)}" data-target-anchor="${escapeHtml(program.id)}:${escapeHtml(target.id)}">
            <label>
              Target
              <input type="text" value="${escapeHtml(target.name)}" data-target-name="${program.id}:${target.id}" aria-label="Target name">
            </label>
            <label>
              Status
              <select data-plan-program="${program.id}" data-plan-target="${target.id}" aria-label="${target.name} status">
                ${["active", "paused", "mastered"].map((status) => `
                  <option value="${status}" ${normalizePlanStatus(target.status || "active") === status ? "selected" : ""}>${status === "paused" ? "on hold" : status}</option>
                `).join("")}
              </select>
            </label>
            <label>
              BCBA note
              <input type="text" value="${escapeHtml(target.note || "")}" data-target-note="${program.id}:${target.id}" placeholder="Optional">
            </label>
            ${renderMasteryReviewHint(program, target)}
          </div>
        `).join("") : '<p class="muted">No targets in this status view.</p>'}
      </div>
    </section>
  `;
}

function renderMasteryReviewHint(program, target) {
  const review = masteryReviewForTarget(program.id, target.id);
  if (review.state === "none") return "";
  if (review.state === "mastered") {
    return `
      <div class="mastery-review-hint mastery-review-hint-mastered">
        <strong>Already mastered</strong>
        <span>${escapeHtml(target.name)} is already marked mastered in the treatment plan.</span>
      </div>
    `;
  }
  if (review.state === "ready") {
    return `
      <div class="mastery-review-hint mastery-review-hint-ready">
        <strong>Ready for mastery review</strong>
        <span>${escapeHtml(target.name)} met ${review.threshold}%+ for ${review.consecutiveSessions} consecutive sessions (${review.matchedDates.map(formatDate).join(", ")}).</span>
      </div>
    `;
  }
  if (review.state === "stagnant") {
    return `
      <div class="mastery-review-hint mastery-review-hint-stagnant">
        <strong>Stagnant target</strong>
        <span>${escapeHtml(target.name)} showed less than ${review.stagnantMinimumGain}% improvement across ${review.stagnantConsecutiveSessions} sessions (${review.previewScores.join("%, ")}%). Consider revising or placing on hold.</span>
      </div>
    `;
  }
  return `
    <div class="mastery-review-hint mastery-review-hint-close">
      <strong>Close to mastery</strong>
      <span>${escapeHtml(target.name)} is trending near the mastery rule (${review.previewScores.join("%, ")}% across recent sessions).</span>
    </div>
  `;
}

function masteryReviewClass(program, target) {
  const review = masteryReviewForTarget(program.id, target.id);
  return {
    mastered: "mastered-target",
    ready: "mastery-ready-target",
    stagnant: "stagnant-target",
    close: "mastery-close-target",
    none: ""
  }[review.state] || "";
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
  const { programs, behaviors } = currentPlanDraft();
  const domains = [...clientDomains()];
  if (domains.some((domain) => domain.toLowerCase() === name.trim().toLowerCase())) {
    planMessage.textContent = "That domain already exists.";
    return;
  }
  domains.push(name.trim());
  await savePlan(programs, behaviors, {
    type: "domain-added",
    domain: name.trim()
  }, currentClient()?.note97155 || "", domains);
  state.activePlanDomain = name.trim();
  state.activeDomain = name.trim();
  planMessage.textContent = "Domain added.";
}

async function handleDeleteDomain() {
  const domain = state.activePlanDomain;
  if (!domain) {
    planMessage.textContent = "Select a domain before deleting it.";
    return;
  }
  const { programs, behaviors } = currentPlanDraft();
  const programsInDomain = programs.filter((program) => (program.domain || clientDomains()[0]) === domain);
  if (programsInDomain.length) {
    planMessage.textContent = `Move all ${programsInDomain.length} program${programsInDomain.length === 1 ? "" : "s"} out of ${domain} before deleting the domain.`;
    return;
  }
  if (!window.confirm(`Delete the ${domain} domain? This only removes the empty domain shell.`)) return;
  const remainingDomains = clientDomains().filter((item) => item !== domain);
  state.activePlanDomain = remainingDomains[0] || "";
  state.activeDomain = remainingDomains[0] || "";
  await savePlan(programs, behaviors, {
    type: "domain-removed",
    domain
  }, currentClient()?.note97155 || "", remainingDomains, clientRbtPerformanceAreas(), currentClient()?.note97151 || "");
  planMessage.textContent = "Domain removed.";
}

async function handlePlanClick(event) {
  const reviewJump = event.target.closest("[data-review-jump]");
  if (reviewJump) {
    jumpToReviewState(reviewJump.dataset.reviewJump);
    return;
  }
  const openProgramGraph = event.target.closest("[data-open-plan-graph]");
  if (openProgramGraph) {
    openProgramGraphModal(openProgramGraph.dataset.openPlanGraph);
    return;
  }
  const openBehaviorGraph = event.target.closest("[data-open-plan-behavior-graph]");
  if (openBehaviorGraph) {
    openBehaviorGraphModal(openBehaviorGraph.dataset.openPlanBehaviorGraph);
    return;
  }
  const addBehavior = event.target.closest("[data-add-plan-behavior]");
  if (addBehavior) {
    const name = window.prompt("Behavior name");
    if (!name?.trim()) return;
    const { programs, behaviors } = currentPlanDraft();
    const newBehavior = {
      id: slugify(name, "behavior", behaviors.map((behavior) => behavior.id)),
      name: name.trim(),
      status: "active"
    };
    behaviors.push(newBehavior);
    await savePlan(programs, behaviors, {
      type: "behavior-added",
      targetName: newBehavior.name
    });
    return;
  }
  const removeBehavior = event.target.closest("[data-remove-plan-behavior]");
  if (removeBehavior) {
    const { programs, behaviors } = currentPlanDraft();
    const target = behaviors.find((behavior) => behavior.id === removeBehavior.dataset.removePlanBehavior);
    if (!target) return;
    if (!window.confirm(`Remove ${target.name}?`)) return;
    await savePlan(programs, behaviors.filter((behavior) => behavior.id !== target.id), {
      type: "behavior-removed",
      targetName: target.name
    });
    return;
  }
  const addParentGoal = event.target.closest("[data-add-plan-parent-goal]");
  if (addParentGoal) {
    const goals = currentPlanParentGoalsDraft();
    goals.push(normalizeParentGoal({
      goalName: "",
      targetName: "",
      opportunities: 5,
      independent: 0,
      prompted: 0,
      promptLevel: "verbal"
    }));
    await savePlanParentTrainingGoals(goals, "Parent training goal added.");
    return;
  }
  const removeParentGoal = event.target.closest("[data-remove-plan-parent-goal]");
  if (removeParentGoal) {
    const goals = currentPlanParentGoalsDraft();
    const index = Number(removeParentGoal.dataset.removePlanParentGoal);
    const target = goals[index];
    if (!target) return;
    if (!window.confirm(`Remove ${target.goalName || target.targetName || "this parent goal"}?`)) return;
    goals.splice(index, 1);
    await savePlanParentTrainingGoals(goals, "Parent training goal removed.");
    return;
  }
  const addTarget = event.target.closest("[data-add-target]");
  if (!addTarget) return;
  const name = window.prompt("Target name");
  if (!name?.trim()) return;
  const { programs, behaviors } = currentPlanDraft();
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
  await savePlan(programs, behaviors, {
    type: "target-added",
    domain: program.domain,
    programId: program.id,
    programName: program.name,
    targetId: newTarget.id,
    targetName: newTarget.name,
    toStatus: "active"
  });
}

function jumpToReviewState(stateValue) {
  const matches = clientPrograms().flatMap((program) => (
    (program.targets || []).map((target) => ({
      domain: program.domain || clientDomains()[0],
      programId: program.id,
      targetId: target.id,
      state: masteryReviewForTarget(program.id, target.id).state,
      statusTab: normalizePlanStatus(target.status || "active")
    }))
  )).filter((item) => item.state === stateValue);

  if (!matches.length) {
    planMessage.textContent = `No ${stateValue} targets right now.`;
    return;
  }

  state.activePlanReviewFilter = state.activePlanReviewFilter === stateValue ? "" : stateValue;
  const filteredMatches = state.activePlanReviewFilter
    ? matches.filter((item) => item.state === state.activePlanReviewFilter)
    : matches;
  const match = filteredMatches.find((item) => item.domain === state.activePlanDomain) || filteredMatches[0];
  if (state.activePlanReviewFilter && match) {
    state.activePlanDomain = match.domain;
  }
  renderPlanReview();
  if (state.activePlanReviewFilter && match) {
    const target = planReview.querySelector(`[data-target-anchor="${match.programId}:${match.targetId}"]`);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      target.classList.add("plan-target-focus");
      window.setTimeout(() => target.classList.remove("plan-target-focus"), 1400);
    }
  }
}

function handleProgramGraphModalClick(event) {
  if (event.target.closest("[data-close-program-graph]")) {
    closeProgramGraphModal();
  }
}

function openProgramGraphModal(programId) {
  const program = clientPrograms().find((item) => item.id === programId);
  if (!program) return;
  const chart = buildProgramSkillChart(program, currentSessions().slice().reverse());
  const graphKey = graphTrendKey("skill", programId);
  const phaseConfig = graphPhaseConfig(graphKey, chart.series, masteryMarkersForProgram(program.id));
  programGraphModalTitle.textContent = program.name;
  programGraphModalSubtitle.textContent = `${program.domain || "General"}${chart.series.length ? ` - ${chart.series.length} target graph${chart.series.length === 1 ? "" : "s"}` : ""}`;
  programGraphModal.classList.remove("hidden");
  programGraphModal.setAttribute("aria-hidden", "false");
  requestAnimationFrame(() => {
    drawLineChart(programGraphModalCanvas, chart.series, {
      maxY: 100,
      yStep: 10,
      yLabel: "% independence",
      emptyMessage: "No target data for this program",
      phaseMarkers: phaseConfig.phaseMarkers,
      treatmentPhaseLine: phaseConfig.treatmentPhaseLine,
      graphType: "skill",
      showTrendLine: trendLineEnabled(graphKey)
    });
    if (programGraphModalLegend) {
      programGraphModalLegend.innerHTML = renderGraphLegendMarkup(chart.series, {
        showTrendLine: trendLineEnabled(graphKey)
      });
    }
    if (programGraphModalAnalysis) {
      programGraphModalAnalysis.innerHTML = renderGraphAnalysisMarkup(
        buildGraphAnalysis(chart.series, {
          graphType: "skill",
          phaseMarkers: phaseConfig.phaseMarkers,
          treatmentPhaseLine: phaseConfig.treatmentPhaseLine
        }),
        graphKey,
        { reportField: "progressSummary" }
      );
    }
  });
}

function buildBehaviorChart(behaviorId, sessions) {
  const behavior = clientBehaviors().find((item) => item.id === behaviorId);
  if (!behavior) return null;
  const points = sessions.flatMap((session) => {
    const entry = behaviorEntriesForSession(session).find((item) => item.behaviorId === behaviorId);
    return entry ? [{ x: session.date, y: Number(entry.frequency || 0), phase: entry.phase || "intervention" }] : [];
  });
  return {
    behavior,
    series: [{
      name: behavior.name,
      meta: {
        behaviorId: behavior.id,
        status: behavior.status || "active"
      },
      points
    }]
  };
}

function latestSessionDate(sessions = []) {
  return (sessions || []).reduce((latest, session) => (
    !latest || session.date > latest ? session.date : latest
  ), "");
}

function shiftIsoDate(date, offsetDays) {
  if (!date) return "";
  const value = new Date(`${date}T00:00:00`);
  value.setUTCDate(value.getUTCDate() + offsetDays);
  return value.toISOString().slice(0, 10);
}

function currentAuthorizationRange() {
  const authorization = currentClient()?.profile?.authorization || {};
  return {
    startDate: authorization.startDate || "",
    endDate: authorization.endDate || ""
  };
}

function resolvedBehaviorGraphRangePreset() {
  if (state.behaviorGraphRangePreset !== "default") return state.behaviorGraphRangePreset;
  const authorization = currentAuthorizationRange();
  return authorization.startDate && authorization.endDate ? "authorization" : "last90";
}

function behaviorGraphRangeLabel() {
  const preset = resolvedBehaviorGraphRangePreset();
  return {
    last30: "Last 30 days",
    last60: "Last 60 days",
    last90: "Last 90 days",
    last6months: "Last 6 months",
    last12months: "Last 12 months",
    authorization: "Authorization period",
    all: "All data",
    custom: "Custom date range"
  }[preset] || "Selected date range";
}

function behaviorGraphRange() {
  const preset = resolvedBehaviorGraphRangePreset();
  const sessions = currentSessions();
  const lastDate = latestSessionDate(sessions);
  const authorization = currentAuthorizationRange();
  if (preset === "authorization") {
    return {
      preset,
      startDate: authorization.startDate || "",
      endDate: authorization.endDate || "",
      label: "Authorization period"
    };
  }
  if (preset === "custom") {
    return {
      preset,
      startDate: state.behaviorGraphCustomStart || "",
      endDate: state.behaviorGraphCustomEnd || "",
      label: "Custom date range"
    };
  }
  if (preset === "all" || !lastDate) {
    return {
      preset,
      startDate: "",
      endDate: "",
      label: preset === "all" ? "All data" : behaviorGraphRangeLabel()
    };
  }
  const days = {
    last30: 30,
    last60: 60,
    last90: 90,
    last6months: 183,
    last12months: 365
  }[preset] || 90;
  return {
    preset,
    startDate: shiftIsoDate(lastDate, -(days - 1)),
    endDate: lastDate,
    label: behaviorGraphRangeLabel()
  };
}

function sessionsWithinRange(sessions, range) {
  return (sessions || []).filter((session) => (
    (!range.startDate || session.date >= range.startDate)
    && (!range.endDate || session.date <= range.endDate)
  ));
}

function anySeriesDataBeforeRange(series = [], startDate = "") {
  if (!startDate) return false;
  return (series || []).some((entry) => (
    (entry.points || []).some((point) => point.x < startDate)
    && (entry.points || []).some((point) => point.x >= startDate)
  ));
}

function visibleBehaviorIds() {
  return clientBehaviors()
    .filter((behavior) => state.hiddenBehaviorSeries[behavior.id] !== true)
    .map((behavior) => behavior.id);
}

function openBehaviorGraphModal(behaviorId) {
  const chart = buildBehaviorChart(behaviorId, currentSessions().slice().reverse());
  if (!chart) return;
  const graphKey = graphTrendKey("behavior", behaviorId);
  const phaseConfig = graphPhaseConfig(graphKey, chart.series);
  programGraphModalTitle.textContent = chart.behavior.name;
  programGraphModalSubtitle.textContent = "Behavior reduction - frequency";
  programGraphModal.classList.remove("hidden");
  programGraphModal.setAttribute("aria-hidden", "false");
  requestAnimationFrame(() => {
    drawLineChart(programGraphModalCanvas, chart.series, {
      yStep: 1,
      yLabel: "frequency",
      emptyMessage: "No behavior data for this behavior",
      phaseMarkers: phaseConfig.phaseMarkers,
      treatmentPhaseLine: phaseConfig.treatmentPhaseLine,
      graphType: "behavior",
      showTrendLine: trendLineEnabled(graphKey)
    });
    if (programGraphModalLegend) {
      programGraphModalLegend.innerHTML = renderGraphLegendMarkup(chart.series, {
        showTrendLine: trendLineEnabled(graphKey)
      });
    }
    if (programGraphModalAnalysis) {
      programGraphModalAnalysis.innerHTML = renderGraphAnalysisMarkup(
        buildGraphAnalysis(chart.series, {
          graphType: "behavior",
          phaseMarkers: phaseConfig.phaseMarkers,
          treatmentPhaseLine: phaseConfig.treatmentPhaseLine
        }),
        graphKey,
        { reportField: "progressSummary" }
      );
    }
  });
}

function closeProgramGraphModal() {
  programGraphModal.classList.add("hidden");
  programGraphModal.setAttribute("aria-hidden", "true");
  if (programGraphModalLegend) programGraphModalLegend.innerHTML = "";
  if (programGraphModalAnalysis) programGraphModalAnalysis.innerHTML = "";
}

async function handlePlanTextEdit(event) {
  const input = event.target;
  const { programs, behaviors } = currentPlanDraft();
  if (
    input.dataset.planParentGoal !== undefined
    || input.dataset.planParentTarget !== undefined
    || input.dataset.planParentOpportunities !== undefined
    || input.dataset.planParentIndependent !== undefined
    || input.dataset.planParentPrompted !== undefined
    || input.dataset.planParentPromptLevel !== undefined
  ) {
    await savePlanParentTrainingGoals(currentPlanParentGoalsDraft());
    return;
  }
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
  const { programs, behaviors } = currentPlanDraft();
  const program = programs.find((item) => item.id === event.target.dataset.programDomain);
  if (!program) return;
  program.domain = event.target.value;
  await savePlan(programs, behaviors);
}

async function handlePlanStatusChange(event) {
  const behaviorControl = event.target.closest("[data-behavior-status]");
  if (behaviorControl) {
    const { programs, behaviors } = currentPlanDraft();
    const behavior = behaviors.find((item) => item.id === behaviorControl.dataset.behaviorStatus);
    if (!behavior) return;
    behavior.status = behaviorControl.value;
    await savePlan(programs, behaviors);
    return;
  }
  const programControl = event.target.closest("[data-plan-program-status]");
  if (programControl) {
    const { programs, behaviors } = currentPlanDraft();
    const program = programs.find((item) => item.id === programControl.dataset.planProgramStatus);
    if (!program) return;
    const previousStatus = normalizePlanStatus(program.status || "active");
    program.status = programControl.value;
    if (programControl.value === "mastered") {
      (program.targets || []).forEach((target) => {
        if (normalizePlanStatus(target.status || "active") !== "paused") {
          target.status = "mastered";
          if (!target.maintenanceDate) target.maintenanceDate = new Date().toISOString().slice(0, 10);
        }
      });
    } else if (programControl.value === "paused") {
      (program.targets || []).forEach((target) => {
        if (normalizePlanStatus(target.status || "active") !== "mastered") {
          target.status = "paused";
        }
      });
    }
    try {
      await savePlan(programs, behaviors, previousStatus !== programControl.value ? {
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
  const { programs, behaviors } = currentPlanDraft();
  const program = programs.find((item) => item.id === control.dataset.planProgram);
  const target = program?.targets?.find((item) => item.id === control.dataset.planTarget);
  if (!target) return;

  const previousStatus = normalizePlanStatus(target.status || "active");
  target.status = control.value;
  if (control.value === "mastered" && !target.maintenanceDate) {
    target.maintenanceDate = new Date().toISOString().slice(0, 10);
  }

  try {
    await savePlan(programs, behaviors, previousStatus !== control.value ? {
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
  rbtPerformanceAreas = clientRbtPerformanceAreas(),
  note97151 = currentClient()?.note97151 || "",
  note97155History = currentClient()?.note97155History || [],
  note97151History = currentClient()?.note97151History || []
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
    note97151,
    note97155History,
    note97151History,
    rbtPerformanceAreas
  });
  const index = state.clients.findIndex((item) => item.id === updated.id);
  if (index >= 0) state.clients[index] = updated;
  resetRows();
  render();
}

function soapNoteEntryKey(serviceCode, entryId) {
  return `note-${serviceCode}-${entryId}`;
}

function parseSoapNoteEntryKey(key) {
  const match = String(key || "").match(/^note-(97151|97155)-(.+)$/);
  if (!match) return null;
  return { serviceCode: match[1], id: match[2] };
}

function noteHistoryEntriesFor(serviceCode) {
  return structuredClone(currentClient()?.[`note${serviceCode}History`] || []);
}

function latestNoteHistoryEntry(serviceCode) {
  return noteHistoryEntriesFor(serviceCode)[0] || null;
}

function selectedNoteHistoryEntry(serviceCode) {
  const parsed = parseSoapNoteEntryKey(state.selectedSoapEntryKey);
  if (!parsed || parsed.serviceCode !== serviceCode) return latestNoteHistoryEntry(serviceCode);
  return noteHistoryEntriesFor(serviceCode).find((entry) => entry.id === parsed.id) || latestNoteHistoryEntry(serviceCode);
}

function upsertNoteHistoryEntry(serviceCode, record) {
  const entries = noteHistoryEntriesFor(serviceCode);
  const latest = entries[0];
  const matchesCurrentSession = latest
    && latest.date === record.date
    && latest.startTime === record.startTime
    && latest.endTime === record.endTime
    && latest.providerSignature === record.providerSignature
    && latest.providerCredential === record.providerCredential
    && latest.setting === record.setting;
  const normalized = {
    ...record,
    serviceCode,
    id: record.id || (matchesCurrentSession ? latest.id : cryptoId()),
    createdAt: matchesCurrentSession ? latest.createdAt : (record.createdAt || new Date().toISOString()),
    updatedAt: new Date().toISOString()
  };
  const remaining = entries.filter((entry) => entry.id !== normalized.id);
  return [normalized, ...remaining].sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
}

function currentPlanDraft() {
  const programs = structuredClone(clientPrograms());
  const behaviors = structuredClone(clientBehaviors());

  planReview.querySelectorAll("[data-program-name]").forEach((input) => {
    const program = programs.find((item) => item.id === input.dataset.programName);
    if (program && input.value.trim()) program.name = input.value.trim();
  });
  planReview.querySelectorAll("[data-program-objective]").forEach((input) => {
    const program = programs.find((item) => item.id === input.dataset.programObjective);
    if (program) program.objective = input.value.trim();
  });
  planReview.querySelectorAll("[data-target-name]").forEach((input) => {
    const [programId, targetId] = input.dataset.targetName.split(":");
    const target = programs.find((item) => item.id === programId)?.targets?.find((item) => item.id === targetId);
    if (target && input.value.trim()) target.name = input.value.trim();
  });
  planReview.querySelectorAll("[data-target-note]").forEach((input) => {
    const [programId, targetId] = input.dataset.targetNote.split(":");
    const target = programs.find((item) => item.id === programId)?.targets?.find((item) => item.id === targetId);
    if (target) target.note = input.value.trim();
  });
  planReview.querySelectorAll("[data-program-domain]").forEach((select) => {
    const program = programs.find((item) => item.id === select.dataset.programDomain);
    if (program) program.domain = select.value;
  });
  planReview.querySelectorAll("[data-plan-program-status]").forEach((select) => {
    const program = programs.find((item) => item.id === select.dataset.planProgramStatus);
    if (program) program.status = select.value;
  });
  planReview.querySelectorAll("[data-plan-program][data-plan-target]").forEach((select) => {
    const program = programs.find((item) => item.id === select.dataset.planProgram);
    const target = program?.targets?.find((item) => item.id === select.dataset.planTarget);
    if (target) target.status = select.value;
  });
  planReview.querySelectorAll("[data-behavior-name]").forEach((input) => {
    const behavior = behaviors.find((item) => item.id === input.dataset.behaviorName);
    if (behavior && input.value.trim()) behavior.name = input.value.trim();
  });
  planReview.querySelectorAll("[data-behavior-status]").forEach((select) => {
    const behavior = behaviors.find((item) => item.id === select.dataset.behaviorStatus);
    if (behavior) behavior.status = select.value;
  });

  return { programs, behaviors };
}

function currentPlanParentGoalsDraft() {
  const goals = structuredClone(currentParentTrainingGoals());
  planReview.querySelectorAll("[data-plan-parent-goal]").forEach((input) => {
    const goal = goals[Number(input.dataset.planParentGoal)];
    if (goal) goal.goalName = input.value.trim();
  });
  planReview.querySelectorAll("[data-plan-parent-target]").forEach((input) => {
    const goal = goals[Number(input.dataset.planParentTarget)];
    if (goal) goal.targetName = input.value.trim();
  });
  planReview.querySelectorAll("[data-plan-parent-opportunities]").forEach((input) => {
    const goal = goals[Number(input.dataset.planParentOpportunities)];
    if (goal) goal.opportunities = Number(input.value || 0);
  });
  planReview.querySelectorAll("[data-plan-parent-independent]").forEach((input) => {
    const goal = goals[Number(input.dataset.planParentIndependent)];
    if (goal) goal.independent = Number(input.value || 0);
  });
  planReview.querySelectorAll("[data-plan-parent-prompted]").forEach((input) => {
    const goal = goals[Number(input.dataset.planParentPrompted)];
    if (goal) goal.prompted = Number(input.value || 0);
  });
  planReview.querySelectorAll("[data-plan-parent-prompt-level]").forEach((select) => {
    const goal = goals[Number(select.dataset.planParentPromptLevel)];
    if (goal) goal.promptLevel = select.value;
  });
  return goals.map((goal) => normalizeParentGoal(goal)).filter((goal) => goal.goalName || goal.targetName);
}

async function savePlanParentTrainingGoals(goals, message = "Parent training goals saved.") {
  const client = currentClient();
  if (!client) return;
  const updated = await updateClientProfile(client.id, {
    ...currentClientProfilePayload(client),
    parentTrainingGoals: goals
  });
  replaceClient(updated);
  planMessage.textContent = message;
  render();
}

async function handleGenerate97155Note() {
  const note = generate97155Note();
  const sessionDetails = readBcbaSessionDetails();
  const note97155History = upsertNoteHistoryEntry("97155", {
    id: cryptoId(),
    note,
    date: sessionDetails.date,
    providerSignature: sessionDetails.providerSignature,
    providerCredential: sessionDetails.providerCredential,
    startTime: sessionDetails.startTime,
    endTime: sessionDetails.endTime,
    setting: sessionDetails.setting,
    activityLabel: "Treatment planning / protocol modification"
  });
  note97155Editor.value = note;
  await savePlan(
    clientPrograms(),
    clientBehaviors(),
    null,
    note,
    clientDomains(),
    clientRbtPerformanceAreas(),
    currentClient()?.note97151 || "",
    note97155History,
    currentClient()?.note97151History || []
  );
  state.selectedSoapEntryKey = soapNoteEntryKey("97155", note97155History[0].id);
  note97155Status.textContent = "97155 note generated.";
  planMessage.textContent = "97155 note generated. Review or edit it below.";
  renderHistory();
  renderNote();
  renderSoapSummary();
}

function generate97151Note() {
  const client = currentClient();
  const values = new FormData(reportForm);
  const startDate = values.get("startDate");
  const endDate = values.get("endDate");
  const preparedBy = values.get("preparedBy") || values.get("assessmentConductedBy") || state.currentUser?.name || "BCBA";
  const credential = values.get("credential") || "BCBA";
  const assessmentDate = values.get("assessmentDate") || new Date().toISOString().slice(0, 10);
  const assessmentType = values.get("indirectAssessmentType") || "caregiver interview and record review";
  const standardizedType = values.get("standardizedAssessmentType") || "clinical observation";
  const sessions = filteredReportSessions();
  const metrics = funderReportMetrics(sessions);
  const activePrograms = clientPrograms().filter((program) => (program.status || "active") !== "mastered").length;
  const activeBehaviors = clientBehaviors().filter((behavior) => behavior.status !== "inactive").length;

  return [
    `S: ${preparedBy} completed a 97151 behavior identification assessment for ${client?.name || "the client"} on ${formatDate(assessmentDate)}. Activities included caregiver interview, direct and indirect assessment, review of records, data analysis, funder report update, and treatment planning. The review period covered ${formatDate(startDate)} through ${formatDate(endDate)}.`,
    "",
    `O: The assessment included ${assessmentType} and ${standardizedType}. ${sessions.length} session${sessions.length === 1 ? "" : "s"} were reviewed. Average target independence during the review period was ${metrics.averageIndependence}%, with ${metrics.targetsReviewed} targets showing measurable data and ${metrics.totalBehaviorFrequency} total behavior incidents documented across tracked behaviors. Current treatment planning reflects ${activePrograms} active program${activePrograms === 1 ? "" : "s"} and ${activeBehaviors} active behavior${activeBehaviors === 1 ? "" : "s"}.`,
    "",
    "A: Findings support the continued medical necessity of ABA services and indicate that goals, maintenance planning, and behavior targets should be updated based on current performance trends, caregiver report, and assessment findings.",
    "",
    "P: Finalize the updated funder report, revise the treatment plan as indicated, and continue monitoring acquisition, maintenance, and behavior data to guide clinical decision-making.",
    "",
    signatureBlock(preparedBy, credential, assessmentDate)
  ].join("\n");
}

async function handleGenerate97151Note() {
  const note = generate97151Note();
  const values = new FormData(reportForm);
  const note97151History = upsertNoteHistoryEntry("97151", {
    id: cryptoId(),
    note,
    date: values.get("assessmentDate") || new Date().toISOString().slice(0, 10),
    providerSignature: values.get("preparedBy") || values.get("assessmentConductedBy") || state.currentUser?.name || "BCBA",
    providerCredential: values.get("credential") || "BCBA",
    activityLabel: "Behavior assessment / report update"
  });
  note97151Editor.value = note;
  planNote97151Editor.value = note;
  await savePlan(
    clientPrograms(),
    clientBehaviors(),
    null,
    currentClient()?.note97155 || "",
    clientDomains(),
    clientRbtPerformanceAreas(),
    note,
    currentClient()?.note97155History || [],
    note97151History
  );
  state.selectedSoapEntryKey = soapNoteEntryKey("97151", note97151History[0].id);
  note97151Status.textContent = "97151 note generated.";
  planNote97151Status.textContent = "97151 note generated.";
  funderExportStatus.textContent = "97151 assessment note generated. Review or edit it below.";
  planMessage.textContent = "97151 assessment note generated. Review or edit it below.";
  renderHistory();
  renderNote();
  renderSoapSummary();
}

async function handleSave97151Note() {
  const note = document.activeElement === planNote97151Editor ? planNote97151Editor.value : note97151Editor.value;
  const values = new FormData(reportForm);
  const selected = selectedNoteHistoryEntry("97151");
  const note97151History = upsertNoteHistoryEntry("97151", {
    ...selected,
    note,
    date: selected?.date || values.get("assessmentDate") || new Date().toISOString().slice(0, 10),
    providerSignature: selected?.providerSignature || values.get("preparedBy") || values.get("assessmentConductedBy") || state.currentUser?.name || "BCBA",
    providerCredential: selected?.providerCredential || values.get("credential") || "BCBA",
    activityLabel: selected?.activityLabel || "Behavior assessment / report update"
  });
  note97151Editor.value = note;
  planNote97151Editor.value = note;
  await savePlan(
    clientPrograms(),
    clientBehaviors(),
    null,
    currentClient()?.note97155 || "",
    clientDomains(),
    clientRbtPerformanceAreas(),
    note,
    currentClient()?.note97155History || [],
    note97151History
  );
  if (note.trim()) {
    state.selectedSoapEntryKey = soapNoteEntryKey("97151", note97151History[0].id);
  } else if (parseSoapNoteEntryKey(state.selectedSoapEntryKey)?.serviceCode === "97151") {
    state.selectedSoapEntryKey = "";
  }
  note97151Status.textContent = "97151 note saved.";
  planNote97151Status.textContent = "97151 note saved.";
  renderHistory();
  renderNote();
  renderSoapSummary();
}

function render97151Note() {
  const note = currentClient()?.note97151 || "";
  note97151Editor.value = note;
  planNote97151Editor.value = note;
  note97151Status.textContent = "";
  planNote97151Status.textContent = "";
}

async function handleSave97155Note() {
  const sessionDetails = readBcbaSessionDetails();
  const selected = selectedNoteHistoryEntry("97155");
  const note97155History = upsertNoteHistoryEntry("97155", {
    ...selected,
    note: note97155Editor.value,
    date: selected?.date || sessionDetails.date,
    providerSignature: selected?.providerSignature || sessionDetails.providerSignature,
    providerCredential: selected?.providerCredential || sessionDetails.providerCredential,
    startTime: selected?.startTime || sessionDetails.startTime,
    endTime: selected?.endTime || sessionDetails.endTime,
    setting: selected?.setting || sessionDetails.setting,
    activityLabel: selected?.activityLabel || "Treatment planning / protocol modification"
  });
  await savePlan(
    clientPrograms(),
    clientBehaviors(),
    null,
    note97155Editor.value,
    clientDomains(),
    clientRbtPerformanceAreas(),
    currentClient()?.note97151 || "",
    note97155History,
    currentClient()?.note97151History || []
  );
  if (note97155Editor.value.trim()) {
    state.selectedSoapEntryKey = soapNoteEntryKey("97155", note97155History[0].id);
  } else if (parseSoapNoteEntryKey(state.selectedSoapEntryKey)?.serviceCode === "97155") {
    state.selectedSoapEntryKey = "";
  }
  note97155Status.textContent = "97155 note saved.";
  renderHistory();
  renderNote();
  renderSoapSummary();
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

function sessionActivityLabel(session) {
  if (!session) return "Clinical activity";
  if (session.serviceType === "parent-training") {
    return session.parentTraining?.trainingFocus || "Parent training";
  }
  const programNames = (session.programs || [])
    .map((program) => lookups().programName(program.programId))
    .filter(Boolean);
  if (programNames.length) {
    return programNames.length === 1
      ? programNames[0]
      : `${programNames[0]} + ${programNames.length - 1} more`;
  }
  return "Direct therapy";
}

function soapEntryActivityLabel(entry) {
  if (!entry) return "Clinical activity";
  if (entry.type === "97151") return "Behavior assessment / report update";
  if (entry.type === "97155") return "Treatment planning / protocol modification";
  return sessionActivityLabel(entry.session);
}

function soapEntryGroup(entry) {
  if (entry.type === "97151") return { key: "97151", label: "97151 Assessment" };
  if (entry.type === "97155") return { key: "97155", label: "97155 Treatment planning" };
  const code = sessionCodeLabel(entry.session);
  if (code === "97156") return { key: "97156", label: "97156 Parent training" };
  return { key: "97153", label: "97153 Direct therapy" };
}

function renderSoapHistoryTabs(groups) {
  if (!soapHistoryTabs) return;
  const availableKeys = groups.map((group) => group.key);
  if (!availableKeys.includes(state.activeSoapHistoryTab)) {
    state.activeSoapHistoryTab = availableKeys[0] || "97153";
  }
  soapHistoryTabs.innerHTML = groups.map((group) => `
    <button
      type="button"
      class="domain-tab ${group.key === state.activeSoapHistoryTab ? "active" : ""}"
      data-soap-history-tab="${escapeHtml(group.key)}"
    >
      ${escapeHtml(group.label)} (${group.entries.length})
    </button>
  `).join("");
  soapHistoryTabs.querySelectorAll("[data-soap-history-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeSoapHistoryTab = button.dataset.soapHistoryTab;
      const selectedGroup = groups.find((group) => group.key === state.activeSoapHistoryTab);
      if (selectedGroup?.entries?.length) {
        state.selectedSoapEntryKey = selectedGroup.entries[0].key;
        if (selectedGroup.entries[0].session?.id) {
          state.selectedSessionId = selectedGroup.entries[0].session.id;
        }
      }
      renderHistory();
      renderNote();
      renderSoapSummary();
    });
  });
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
  const entries = soapHistoryEntries();
  const container = document.querySelector("#session-history");
  if (!entries.length) {
    if (soapHistoryTabs) soapHistoryTabs.innerHTML = "";
    container.innerHTML = '<p class="muted">No sessions saved yet.</p>';
    return;
  }
  const groups = entries.reduce((collection, entry) => {
    const group = soapEntryGroup(entry);
    let bucket = collection.find((item) => item.key === group.key);
    if (!bucket) {
      bucket = { ...group, entries: [] };
      collection.push(bucket);
    }
    bucket.entries.push(entry);
    return collection;
  }, []);
  if (!state.selectedSoapEntryKey) {
    const defaultSessionEntry = entries.find((entry) => entry.type === "session") || entries[0] || null;
    if (defaultSessionEntry) {
      state.selectedSoapEntryKey = defaultSessionEntry.key;
      if (defaultSessionEntry.session?.id) state.selectedSessionId = defaultSessionEntry.session.id;
    }
  }
  const selectedEntry = selectedSoapEntry();
  const selectedGroup = selectedEntry ? soapEntryGroup(selectedEntry).key : "";
  const availableKeys = groups.map((group) => group.key);
  if (selectedGroup && availableKeys.includes(selectedGroup)) {
    state.activeSoapHistoryTab = selectedGroup;
  } else if (!availableKeys.includes(state.activeSoapHistoryTab)) {
    const fallbackOrder = ["97153", "97156", "97155", "97151"];
    state.activeSoapHistoryTab = fallbackOrder.find((key) => availableKeys.includes(key)) || availableKeys[0] || "97153";
  }
  renderSoapHistoryTabs(groups);
  const visibleGroups = groups.filter((group) => group.key === state.activeSoapHistoryTab);
  container.innerHTML = visibleGroups.map((group) => `
    <section class="history-group">
      <h3 class="history-group-title">${escapeHtml(group.label)}</h3>
      ${group.entries.map((entry) => {
        const active = selectedSoapEntry()?.key === entry.key ? "active" : "";
        if (entry.type === "97151") {
          const preview = String(entry.note || "").trim().split(/\n+/)[0] || "Assessment note generated from intake, report, and treatment planning data.";
          return `
            <div class="history-item ${active}">
              <button type="button" class="history-select" data-soap-entry="${entry.key}">
                <span><strong>97151</strong> • <strong>${formatDate(entry.record?.date)}</strong></span>
                <div class="history-item-meta">
                  <span class="health-badge low">${escapeHtml(soapEntryActivityLabel(entry))}</span>
                </div>
                <span>${escapeHtml(preview)}</span>
                <span>${escapeHtml(entry.record?.providerSignature || "Saved note")}</span>
              </button>
            </div>
          `;
        }
        if (entry.type === "97155") {
          const preview = String(entry.note || "").trim().split(/\n+/)[0] || "Treatment plan note generated from protocol modification work.";
          return `
            <div class="history-item ${active}">
              <button type="button" class="history-select" data-soap-entry="${entry.key}">
                <span><strong>97155</strong> • <strong>${formatDate(entry.record?.date)}</strong>${entry.record?.startTime && entry.record?.endTime ? ` ${entry.record.startTime}-${entry.record.endTime}` : ""}</span>
                <div class="history-item-meta">
                  <span class="health-badge medium">${escapeHtml(soapEntryActivityLabel(entry))}</span>
                </div>
                <span>${escapeHtml(preview)}</span>
                <span>${escapeHtml(entry.record?.providerSignature || "Saved note")}</span>
              </button>
            </div>
          `;
        }
        const session = entry.session;
        const programSummary = session.serviceType === "parent-training"
          ? ((session.parentGoals || []).map((goal) => `${goal.targetName} ${goal.fidelity}%`).join(", ")
            || "No parent-training goal data recorded")
          : (targetEntries(session)
            .map((target) => `${lookups().targetName(target.programId, target.targetId)} ${target.independence}%`)
            .join(", ") || "No target data recorded");
        return `
          <div class="history-item ${active}">
            <button type="button" class="history-select" data-soap-entry="${entry.key}" data-session-id="${session.id}">
              <span><strong>${sessionCodeLabel(session)}</strong> • <strong>${formatDate(session.date)}</strong> ${session.startTime}-${session.endTime}</span>
              <div class="history-item-meta">
                <span class="health-badge low">${escapeHtml(soapEntryActivityLabel(entry))}</span>
                <span class="health-badge ${session.finalized ? "low" : "medium"}">${session.finalized ? "Finalized" : "Draft"}</span>
              </div>
              <span>${programSummary}</span>
              <span>${session.finalized ? "Finalized" : "Draft note"}</span>
            </button>
            <button type="button" class="delete-button" data-delete-session="${session.id}" aria-label="Delete session from ${formatDate(session.date)}">Delete</button>
          </div>
        `;
      }).join("")}
    </section>
  `).join("");

  container.querySelectorAll("[data-soap-entry]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedSoapEntryKey = button.dataset.soapEntry;
      if (button.dataset.sessionId) state.selectedSessionId = button.dataset.sessionId;
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
    if (state.selectedSoapEntryKey === sessionId) state.selectedSoapEntryKey = "";
    await refreshData();
    render();
  } catch (error) {
    formMessage.textContent = error.message;
  }
}

async function handleGraphDataDeleteClick(event) {
  const skillDelete = event.target.closest("[data-delete-skill-point]");
  const behaviorDelete = event.target.closest("[data-delete-behavior-point]");
  const parentDelete = event.target.closest("[data-delete-parent-point]");
  if (!skillDelete && !behaviorDelete && !parentDelete) return;

  graphsMessage.textContent = "";
  try {
    if (skillDelete) {
      const label = skillDelete.dataset.pointLabel || "this target";
      const date = skillDelete.dataset.pointDate ? formatGraphDate(skillDelete.dataset.pointDate) : "this date";
      if (!window.confirm(`Delete ${label} data for ${date}? This will immediately update graphs, mastery review, and report summaries.`)) return;
      await deleteSessionTargetData(
        skillDelete.dataset.sessionId,
        skillDelete.dataset.programId,
        skillDelete.dataset.targetId
      );
      await refreshData();
      render();
      graphsMessage.textContent = `${label} data for ${date} deleted.`;
      return;
    }

    if (parentDelete) {
      const label = parentDelete.dataset.pointLabel || "this caregiver-training target";
      const date = parentDelete.dataset.pointDate ? formatGraphDate(parentDelete.dataset.pointDate) : "this date";
      if (!window.confirm(`Delete ${label} data for ${date}? This will immediately update caregiver-training graphs, fidelity averages, and parent-training report summaries.`)) return;
      await deleteSessionParentGoalData(
        parentDelete.dataset.sessionId,
        parentDelete.dataset.goalName,
        parentDelete.dataset.targetName
      );
      await refreshData();
      render();
      graphsMessage.textContent = `${label} data for ${date} deleted.`;
      return;
    }

    const label = behaviorDelete.dataset.pointLabel || "this behavior";
    const date = behaviorDelete.dataset.pointDate ? formatGraphDate(behaviorDelete.dataset.pointDate) : "this date";
    if (!window.confirm(`Delete ${label} data for ${date}? This will immediately update graphs and summaries.`)) return;
    await deleteSessionBehaviorData(
      behaviorDelete.dataset.sessionId,
      behaviorDelete.dataset.behaviorId
    );
    await refreshData();
    render();
    graphsMessage.textContent = `${label} data for ${date} deleted.`;
  } catch (error) {
    graphsMessage.textContent = error.message;
  }
}

function handleGraphAnalysisControlChange(event) {
  const toggle = event.target.closest("[data-graph-trend-toggle]");
  if (!toggle) return;
  event.preventDefault();
  const graphKey = toggle.dataset.graphTrendToggle;
  const previousPanel = toggle.closest(".chart-panel");
  const previousTop = previousPanel?.getBoundingClientRect().top ?? null;
  state.graphTrendVisibility[graphKey] = toggle.checked;
  renderCharts();
  if (reportPreview.innerHTML) renderFunderReportPreview();
  requestAnimationFrame(() => {
    if (!graphKey || previousTop === null) return;
    const nextToggle = [...document.querySelectorAll("[data-graph-trend-toggle]")].find((input) => input.dataset.graphTrendToggle === graphKey);
    const nextPanel = nextToggle?.closest(".chart-panel");
    if (!nextPanel) return;
    const delta = nextPanel.getBoundingClientRect().top - previousTop;
    window.scrollTo({ top: Math.max(window.scrollY + delta, 0), behavior: "auto" });
  });
}

function handleGraphAnalysisClick(event) {
  const insert = event.target.closest("[data-insert-graph-analysis]");
  if (!insert) return;
  const graphKey = insert.dataset.insertGraphAnalysis;
  const chartAnalysis = event.target.closest("[data-graph-analysis]");
  const label = insert.dataset.seriesLabel || "";
  const reportField = insert.dataset.reportField || chartAnalysis?.dataset.reportField || "progressSummary";
  const targetField = reportForm?.elements?.[reportField];
  if (!graphKey || !chartAnalysis || !targetField) return;
  const analysisPayload = chartAnalysis.dataset.graphAnalysisPayload
    ? JSON.parse(decodeURIComponent(chartAnalysis.dataset.graphAnalysisPayload))
    : null;
  if (!analysisPayload) return;
  const existing = String(targetField.value || "").trim();
  const addition = graphInterpretationText(analysisPayload, graphKey, label);
  targetField.value = existing ? `${existing}\n\n${addition}` : addition;
  funderExportStatus.textContent = reportField === "parentTrainingSummary"
    ? "Graph interpretation inserted into the parent training summary."
    : "Graph interpretation inserted into the progress summary.";
}

function handleGraphPhaseLineClick(event) {
  const editTreatment = event.target.closest("[data-edit-treatment-phase-line]");
  if (editTreatment) {
    const graphKey = editTreatment.dataset.editTreatmentPhaseLine;
    const panel = event.currentTarget;
    const mount = panel?.querySelector?.(`[data-phase-line-panel="${CSS.escape(graphKey)}"]`);
    if (!mount) return;
    const chartPanel = mount.closest(".chart-panel");
    const series = phaseLineSeriesFromPanel(chartPanel);
    mount.outerHTML = renderCustomPhaseLineManager(graphKey, series, { editingTreatment: true });
    return;
  }

  const edit = event.target.closest("[data-edit-phase-line]");
  if (edit) {
    const graphKey = edit.dataset.editPhaseLine;
    const lines = customPhaseLinesForGraph(graphKey);
    const line = lines.find((item) => item.id === edit.dataset.phaseLineId);
    const panel = event.currentTarget;
    const mount = panel?.querySelector?.(`[data-phase-line-panel="${CSS.escape(graphKey)}"]`);
    if (!line || !mount) return;
    const chartPanel = mount.closest(".chart-panel");
    const series = phaseLineSeriesFromPanel(chartPanel);
    mount.outerHTML = renderCustomPhaseLineManager(graphKey, series, { editingId: line.id });
    return;
  }

  const cancel = event.target.closest("[data-cancel-phase-line]");
  if (cancel) {
    const graphKey = cancel.dataset.cancelPhaseLine;
    const panel = event.currentTarget;
    const mount = panel?.querySelector?.(`[data-phase-line-panel="${CSS.escape(graphKey)}"]`);
    const chartPanel = mount?.closest(".chart-panel");
    if (!mount || !chartPanel) return;
    mount.outerHTML = renderCustomPhaseLineManager(graphKey, phaseLineSeriesFromPanel(chartPanel));
    return;
  }

  const cancelTreatment = event.target.closest("[data-cancel-treatment-phase-line]");
  if (cancelTreatment) {
    const graphKey = cancelTreatment.dataset.cancelTreatmentPhaseLine;
    const panel = event.currentTarget;
    const mount = panel?.querySelector?.(`[data-phase-line-panel="${CSS.escape(graphKey)}"]`);
    const chartPanel = mount?.closest(".chart-panel");
    if (!mount || !chartPanel) return;
    mount.outerHTML = renderCustomPhaseLineManager(graphKey, phaseLineSeriesFromPanel(chartPanel));
    return;
  }

  const hideTreatment = event.target.closest("[data-hide-treatment-phase-line]");
  if (hideTreatment) {
    const graphKey = hideTreatment.dataset.hideTreatmentPhaseLine;
    const currentLine = graphTreatmentPhaseLine(graphKey, phaseLineSeriesFromPanel(hideTreatment.closest(".chart-panel")));
    if (!currentLine) return;
    if (!window.confirm(`Hide the "${currentLine.label || "Treatment"}" phase line for this graph?`)) return;
    setTreatmentPhaseOverrideForGraph(graphKey, {
      id: `${graphKey}:treatment-override`,
      date: currentLine.date,
      label: currentLine.label || "Treatment",
      lineStyle: currentLine.lineStyle === "dashed" ? "dashed" : "solid",
      note: currentLine.note || "",
      phaseType: "userTreatmentOverride",
      hidden: true
    });
    markReportDraftDirty();
    graphsMessage.textContent = "Treatment phase line hidden for this graph.";
    funderExportStatus.textContent = graphsMessage.textContent;
    rerenderGraphSurfaces();
    return;
  }

  const resetTreatment = event.target.closest("[data-reset-treatment-phase-line]");
  if (resetTreatment) {
    const graphKey = resetTreatment.dataset.resetTreatmentPhaseLine;
    if (!window.confirm("Reset the treatment phase line to the default baseline-to-treatment rule?")) return;
    setTreatmentPhaseOverrideForGraph(graphKey, null);
    markReportDraftDirty();
    graphsMessage.textContent = "Treatment phase line reset to default.";
    funderExportStatus.textContent = graphsMessage.textContent;
    rerenderGraphSurfaces();
    return;
  }

  const remove = event.target.closest("[data-delete-phase-line]");
  if (!remove) return;
  const graphKey = remove.dataset.deletePhaseLine;
  const phaseLineId = remove.dataset.phaseLineId;
  const line = customPhaseLinesForGraph(graphKey).find((item) => item.id === phaseLineId);
  if (!line) return;
  if (!window.confirm(`Delete the "${line.label}" phase line from this graph?`)) return;
  setCustomPhaseLinesForGraph(graphKey, customPhaseLinesForGraph(graphKey).filter((item) => item.id !== phaseLineId));
  markReportDraftDirty();
  funderExportStatus.textContent = `Removed phase line "${line.label}".`;
  rerenderGraphSurfaces();
}

async function handleGraphPhaseLineSubmit(event) {
  const form = event.target.closest("[data-phase-line-form]");
  if (!form) return;
  event.preventDefault();
  const graphKey = form.dataset.phaseLineForm;
  const formKind = form.dataset.phaseLineKind || "environmental";
  const values = new FormData(form);
  const date = String(values.get("phaseLineDate") || "").trim();
  const label = String(values.get("phaseLineLabel") || "").trim();
  const lineStyle = String(values.get("phaseLineStyle") || "dashed").trim() === "solid" ? "solid" : "dashed";
  const note = String(values.get("phaseLineNote") || "").trim();
  const existingId = String(values.get("phaseLineId") || "").trim();
  const startDate = form.dataset.startDate || "";
  const endDate = form.dataset.endDate || "";
  if (!date || !label) {
    graphsMessage.textContent = "Phase line date and label are required.";
    return;
  }
  if ((startDate && date < startDate) || (endDate && date > endDate)) {
    graphsMessage.textContent = `Phase line date must be between ${formatGraphDate(startDate)} and ${formatGraphDate(endDate)} for this graph.`;
    return;
  }
  if (formKind === "treatment") {
    const seriesDates = [...new Set(phaseLineSeriesFromPanel(form.closest(".chart-panel")).flatMap((item) => (item.points || []).map((point) => point.x)).filter(Boolean))].sort();
    if (seriesDates.length >= 2 && date <= seriesDates[0]) {
      graphsMessage.textContent = `Treatment phase line must occur after the first baseline date (${formatGraphDate(seriesDates[0])}).`;
      return;
    }
    setTreatmentPhaseOverrideForGraph(graphKey, {
      id: existingId || `${graphKey}:treatment-override`,
      date,
      label,
      lineStyle,
      note,
      phaseType: "userTreatmentOverride",
      hidden: false
    });
    markReportDraftDirty();
    graphsMessage.textContent = `Updated treatment phase line "${label}".`;
    funderExportStatus.textContent = graphsMessage.textContent;
    rerenderGraphSurfaces();
    return;
  }

  const nextLines = [
    ...customPhaseLinesForGraph(graphKey).filter((line) => line.id !== existingId),
    {
      id: existingId || cryptoId(),
      date,
      label,
      lineStyle,
      note,
      phaseType: "environmentalChange"
    }
  ];
  setCustomPhaseLinesForGraph(graphKey, nextLines);
  markReportDraftDirty();
  graphsMessage.textContent = existingId
    ? `Updated phase line "${label}".`
    : `Added phase line "${label}".`;
  funderExportStatus.textContent = graphsMessage.textContent;
  rerenderGraphSurfaces();
}

function phaseLineSeriesFromPanel(chartPanel) {
  const graphKey = chartPanel?.querySelector?.("[data-phase-line-panel]")?.dataset.phaseLinePanel || "";
  if (!graphKey) return [];
  const sessions = currentView() === "report"
    ? filteredReportSessions().slice().reverse()
    : currentSessions().slice().reverse();
  if (graphKey.startsWith("skill:")) {
    const program = clientPrograms().find((item) => item.id === graphKey.slice("skill:".length));
    return program ? buildProgramSkillChart(program, sessions)?.series || [] : [];
  }
  if (graphKey === "behavior:overview") {
    return behaviorChartSeries(sessions);
  }
  if (graphKey.startsWith("behavior:")) {
    return buildBehaviorChart(graphKey.slice("behavior:".length), sessions)?.series || [];
  }
  if (graphKey.startsWith("parent:")) {
    const goalKey = graphKey.slice("parent:".length);
    return buildParentTrainingChartModels(sessions).find((chart) => chart.goalKey === goalKey)?.series || [];
  }
  return [];
}

function rerenderGraphSurfaces() {
  if (currentView() === "graphs") renderCharts();
  if (reportPreview?.innerHTML) renderFunderReportPreview();
}

function handleGenerateFunderReport(event) {
  event.preventDefault();
  renderReportSummary();
  syncParentTrainingReportFields();
  const client = currentClient();
  const sessions = filteredReportSessions().slice().reverse();
  const values = new FormData(reportForm);
  renderFunderReportPreview();
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
    .flatMap((session) => behaviorEntriesForSession(session))
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

function renderParentTrainingReportSummary(startDate, endDate, options = {}) {
  const model = parentTrainingReportModel(startDate, endDate);
  const summaryText = String(options.summaryText || model.summaryText || "").trim();
  const recommendationText = String(options.recommendationText || model.recommendationText || "").trim();

  return `
    <div class="report-detail-grid">
      <div><strong>Sessions completed</strong><span>${model.sessionCount}</span></div>
      <div><strong>Average caregiver fidelity</strong><span>${model.sessionCount ? `${model.averageFidelity}%` : "No data"}</span></div>
      <div><strong>Caregivers trained</strong><span>${escapeHtml(model.caregivers.join(", ") || "Not specified")}</span></div>
      <div><strong>Parent training focus</strong><span>${escapeHtml(model.focusAreas.join(", ") || "Not specified")}</span></div>
    </div>
    <section class="report-parent-training-summary">
      <h4>Progress summary</h4>
      ${renderParentTrainingProgressSummary(summaryText)}
    </section>
    ${model.activeGoals.length ? `
      <section class="report-parent-training-summary">
        <h4>Active parent-training goals</h4>
        <ul class="mastered-target-list">
          ${model.activeGoals.map((goal) => `
            <li>
              <strong>${escapeHtml(parentTrainingGoalLabel(goal))}</strong>
            </li>
          `).join("")}
        </ul>
      </section>
    ` : ""}
    ${model.masteredGoals.length ? `
      <section class="report-parent-training-summary">
        <h4>Mastered parent-training goals</h4>
        <ul class="mastered-target-list">
          ${model.masteredGoals.map((goal) => `
            <li>
              <strong>${escapeHtml(parentTrainingGoalLabel(goal))}</strong>
            </li>
          `).join("")}
        </ul>
      </section>
    ` : ""}
    <section class="report-parent-training-summary">
      <h4>Recommendations / next steps</h4>
      ${reportParagraph(recommendationText)}
    </section>
  `;
}

function renderParentTrainingProgressSummary(value) {
  const lines = String(value || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return "<p></p>";

  const sections = [];
  let paragraphBuffer = [];
  let listHeading = "";
  let listItems = [];
  let tableLines = [];

  const flushParagraph = () => {
    if (!paragraphBuffer.length) return;
    sections.push(`<p>${escapeHtml(paragraphBuffer.join(" "))}</p>`);
    paragraphBuffer = [];
  };
  const flushList = () => {
    if (!listHeading && !listItems.length) return;
    if (listHeading) sections.push(`<p><strong>${escapeHtml(listHeading)}</strong></p>`);
    if (listItems.length) {
      sections.push(`
        <ul class="mastered-target-list">
          ${listItems.map((item) => `<li><strong>${escapeHtml(item)}</strong></li>`).join("")}
        </ul>
      `);
    }
    listHeading = "";
    listItems = [];
  };
  const flushTable = () => {
    if (!tableLines.length) return;
    const parsedRows = tableLines
      .map((line) => line.split("|").map((cell) => cell.trim()).filter((cell, index, cells) => !(index === 0 && !cell && cells.length > 1) && !(index === cells.length - 1 && !cell)))
      .filter((cells) => cells.length);
    tableLines = [];
    if (parsedRows.length < 2) {
      paragraphBuffer.push(...parsedRows.map((cells) => cells.join(" ")));
      return;
    }
    const [headerRow, ...bodyRows] = parsedRows;
    const dataRows = bodyRows.filter((cells) => !cells.every((cell) => /^:?-{3,}:?$/.test(cell)));
    if (!dataRows.length) return;
    sections.push(`
      <div class="report-table-wrap">
        <table class="fade-plan-table report-breakdown-table">
          <thead>
            <tr>${headerRow.map((cell) => `<th>${escapeHtml(cell)}</th>`).join("")}</tr>
          </thead>
          <tbody>
            ${dataRows.map((cells) => `<tr>${cells.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}
          </tbody>
        </table>
      </div>
    `);
  };

  lines.forEach((line) => {
    if (/^\|.+\|$/.test(line)) {
      flushParagraph();
      flushList();
      tableLines.push(line);
      return;
    }
    if (tableLines.length) flushTable();
    if (line.startsWith("- ")) {
      flushParagraph();
      listItems.push(line.slice(2).trim());
      return;
    }
    if (line.endsWith(":")) {
      flushParagraph();
      flushList();
      listHeading = line;
      return;
    }
    if (listItems.length) flushList();
    paragraphBuffer.push(line);
  });

  flushParagraph();
  flushList();
  flushTable();
  return sections.join("");
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
  const allBehaviorSeries = behaviorChartSeries(currentSessions().slice().reverse());
  const behaviorOverviewGraphKey = graphTrendKey("behavior", "overview");
  const behaviorOverviewPhaseConfig = graphPhaseConfig(behaviorOverviewGraphKey, behaviorSeries);
  drawLineChart(behaviorCanvas, behaviorSeries, {
    yStep: 1,
    yLabel: "frequency",
    emptyMessage: "No behavior data in this report range",
    phaseMarkers: behaviorOverviewPhaseConfig.phaseMarkers,
    treatmentPhaseLine: behaviorOverviewPhaseConfig.treatmentPhaseLine,
    graphType: "behavior",
    showTrendLine: trendLineEnabled(behaviorOverviewGraphKey),
    showPointMarkers: true,
    suppressAutoTreatmentBoundary: anySeriesDataBeforeRange(allBehaviorSeries, reportForm.elements.startDate.value)
  });
  behaviorCanvas.parentElement?.classList.remove("is-scrollable");
  const behaviorPanel = behaviorCanvas.closest(".chart-panel");
  if (behaviorPanel) {
    behaviorPanel.querySelector(".graph-phase-line-panel")?.remove();
    behaviorPanel.insertAdjacentHTML("beforeend", renderCustomPhaseLineManager(behaviorOverviewGraphKey, behaviorSeries, {
      readOnly: true
    }));
  }

  const behaviorContainer = reportPreview.querySelector("#report-behavior-charts");
  if (behaviorContainer) {
    drawBehaviorChartSet(sessions, behaviorContainer, "report-behavior-chart", {
      range: {
        startDate: reportForm.elements.startDate.value,
        endDate: reportForm.elements.endDate.value,
        label: "Authorization period"
      },
      allSeries: allBehaviorSeries,
      visibleBehaviorIds: clientBehaviors().map((behavior) => behavior.id)
    });
  }

  const parentTrainingContainer = reportPreview.querySelector("#report-parent-training-charts");
  if (parentTrainingContainer) {
    drawParentTrainingChartSet(sessions, parentTrainingContainer, "report-parent-training-chart", {
      readOnly: true,
      reportField: "parentTrainingSummary",
      emptyMessage: "No parent training graph data were collected during this reporting period."
    });
  }
}

function renderCharts() {
  const sessions = currentSessions().slice().reverse();
  const scope = graphScopeVisibility(state.activeGraphTab);
  renderGraphScopeTabs();
  behaviorChartPanel?.classList.toggle("hidden", !scope.showBehaviorGraphs);
  behaviorCharts.classList.toggle("hidden", !scope.showBehaviorGraphs);
  parentTrainingCharts.classList.toggle("hidden", !scope.showParentTrainingCharts);
  graphDomainTabs.classList.toggle("hidden", !scope.showSkillCharts);
  if (scope.showSkillCharts) {
    renderSkillCharts(sessions);
    behaviorCharts.innerHTML = "";
    parentTrainingCharts.innerHTML = "";
    return;
  }

  if (scope.showParentTrainingCharts) {
    skillCharts.innerHTML = "";
    behaviorCharts.innerHTML = "";
    drawParentTrainingChartSet(sessions, parentTrainingCharts, "parent-training-chart", {
      readOnly: false,
      reportField: "parentTrainingSummary",
      emptyMessage: "No caregiver training graph data available."
    });
    return;
  }

  skillCharts.innerHTML = "";
  parentTrainingCharts.innerHTML = "";
  renderBehaviorGraphControls();
  const allBehaviorSeries = behaviorChartSeries(sessions);
  const range = behaviorGraphRange();
  const behaviorSeries = filterSeriesPointsByDateRange(allBehaviorSeries, range, {
    includeSeriesIds: visibleBehaviorIds()
  });
  const behaviorOverviewGraphKey = graphTrendKey("behavior", "overview");
  const behaviorOverviewPhaseConfig = graphPhaseConfig(behaviorOverviewGraphKey, behaviorSeries);
  const behaviorOverviewAnalysis = buildGraphAnalysis(
    state.behaviorGraphAnalyzeAllData
      ? allBehaviorSeries.filter((series) => visibleBehaviorIds().includes(series.meta?.behaviorId))
      : behaviorSeries,
    {
      graphType: "behavior",
      phaseMarkers: behaviorOverviewPhaseConfig.phaseMarkers,
      treatmentPhaseLine: behaviorOverviewPhaseConfig.treatmentPhaseLine,
      rangeLabel: state.behaviorGraphAnalyzeAllData ? "All data" : range.label
    }
  );
  drawLineChart(document.querySelector("#behavior-chart"), behaviorSeries, {
    yStep: 1,
    yLabel: "frequency",
    emptyMessage: "Save a session to graph behavior frequency",
    phaseMarkers: behaviorOverviewPhaseConfig.phaseMarkers,
    treatmentPhaseLine: behaviorOverviewPhaseConfig.treatmentPhaseLine,
    graphType: "behavior",
    showTrendLine: trendLineEnabled(behaviorOverviewGraphKey),
    showPointMarkers: state.behaviorGraphShowPoints,
    suppressAutoTreatmentBoundary: anySeriesDataBeforeRange(allBehaviorSeries, range.startDate)
  });
  const behaviorOverviewScrollWrap = document.querySelector("#behavior-chart")?.parentElement;
  behaviorOverviewScrollWrap?.classList.remove("is-scrollable");
  const behaviorChartContainer = document.querySelector("#behavior-chart")?.closest(".chart-panel");
  renderGraphLegend(behaviorChartContainer, behaviorSeries, {
    showTrendLine: trendLineEnabled(behaviorOverviewGraphKey)
  });
  if (behaviorChartContainer) {
    behaviorChartContainer.querySelector(".graph-analysis-panel")?.remove();
    behaviorChartContainer.querySelector(".graph-phase-line-panel")?.remove();
    behaviorChartContainer.insertAdjacentHTML("beforeend", renderGraphAnalysisMarkup(
      behaviorOverviewAnalysis,
      behaviorOverviewGraphKey,
      {
        reportField: "progressSummary",
        rangeLabel: state.behaviorGraphAnalyzeAllData ? "All data" : range.label,
        treatmentBeforeRange: anySeriesDataBeforeRange(allBehaviorSeries, range.startDate)
      }
    ));
    behaviorChartContainer.insertAdjacentHTML("beforeend", renderCustomPhaseLineManager(
      behaviorOverviewGraphKey,
      behaviorSeries
    ));
  }
  drawBehaviorChartSet(sessions, behaviorCharts, "behavior-single-chart", {
    range,
    allSeries: allBehaviorSeries,
    visibleBehaviorIds: visibleBehaviorIds()
  });
}

function renderBehaviorGraphControls() {
  if (!behaviorGraphControls) return;
  const range = behaviorGraphRange();
  const currentPreset = resolvedBehaviorGraphRangePreset();
  const options = [
    ["default", "Default"],
    ["last30", "Last 30 days"],
    ["last60", "Last 60 days"],
    ["last90", "Last 90 days"],
    ["last6months", "Last 6 months"],
    ["last12months", "Last 12 months"],
    ["authorization", "Authorization period"],
    ["all", "All data"],
    ["custom", "Custom date range"]
  ];
  const toggleMarkup = clientBehaviors().map((behavior) => `
    <label class="graph-toggle-pill">
      <input type="checkbox" data-behavior-visibility="${escapeHtml(behavior.id)}" ${state.hiddenBehaviorSeries[behavior.id] ? "" : "checked"}>
      <span>${escapeHtml(behavior.name)}</span>
    </label>
  `).join("");
  behaviorGraphControls.innerHTML = `
    <section class="graph-controls" aria-label="Behavior graph controls">
      <div class="graph-controls-row">
        <label>
          Date range
          <select id="behavior-graph-range-preset">
            ${options.map(([value, label]) => `<option value="${escapeHtml(value)}" ${value === currentPreset ? "selected" : ""}>${escapeHtml(label)}</option>`).join("")}
          </select>
        </label>
        ${currentPreset === "custom" ? `
          <label>
            Start date
            <input type="date" id="behavior-graph-custom-start" value="${escapeHtml(state.behaviorGraphCustomStart || "")}">
          </label>
          <label>
            End date
            <input type="date" id="behavior-graph-custom-end" value="${escapeHtml(state.behaviorGraphCustomEnd || "")}">
          </label>
        ` : ""}
        <label class="graph-toggle-pill">
          <input type="checkbox" id="behavior-graph-show-points" ${state.behaviorGraphShowPoints ? "checked" : ""}>
          <span>Show data points</span>
        </label>
        <label class="graph-toggle-pill">
          <input type="checkbox" id="behavior-graph-analyze-all" ${state.behaviorGraphAnalyzeAllData ? "checked" : ""}>
          <span>Analyze all data</span>
        </label>
      </div>
      <div class="graph-controls-row">
        <div>
          <strong>Visible behaviors</strong>
          <div class="graph-toggle-list">${toggleMarkup || '<span class="muted">No behaviors configured.</span>'}</div>
        </div>
      </div>
      <p class="graph-range-note">
        Viewing <strong>${escapeHtml(range.label)}</strong>. Tooltip inspection still shows exact dates and values.
      </p>
    </section>
  `;
  behaviorGraphControls.querySelector("#behavior-graph-range-preset")?.addEventListener("change", (event) => {
    state.behaviorGraphRangePreset = event.target.value;
    renderCharts();
  });
  behaviorGraphControls.querySelector("#behavior-graph-custom-start")?.addEventListener("change", (event) => {
    state.behaviorGraphCustomStart = event.target.value;
    renderCharts();
  });
  behaviorGraphControls.querySelector("#behavior-graph-custom-end")?.addEventListener("change", (event) => {
    state.behaviorGraphCustomEnd = event.target.value;
    renderCharts();
  });
  behaviorGraphControls.querySelector("#behavior-graph-show-points")?.addEventListener("change", (event) => {
    state.behaviorGraphShowPoints = event.target.checked;
    renderCharts();
  });
  behaviorGraphControls.querySelector("#behavior-graph-analyze-all")?.addEventListener("change", (event) => {
    state.behaviorGraphAnalyzeAllData = event.target.checked;
    renderCharts();
  });
  behaviorGraphControls.querySelectorAll("[data-behavior-visibility]").forEach((checkbox) => {
    checkbox.addEventListener("change", (event) => {
      state.hiddenBehaviorSeries[event.target.dataset.behaviorVisibility] = !event.target.checked;
      renderCharts();
    });
  });
}

function renderGraphScopeTabs() {
  if (!graphScopeTabs) return;
  graphScopeTabs.innerHTML = ["skills", "behaviors", "parent"].map((tab) => `
    <button type="button" class="domain-tab ${tab === state.activeGraphTab ? "active" : ""}" data-graph-scope-tab="${tab}">
      ${tab === "skills" ? "Skills" : tab === "behaviors" ? "Behaviors" : "Caregiver Training"}
    </button>
  `).join("");
  graphScopeTabs.querySelectorAll("[data-graph-scope-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeGraphTab = button.dataset.graphScopeTab;
      renderCharts();
    });
  });
}

function renderSkillCharts(sessions) {
  const groups = buildSkillChartsByDomain(sessions);
  renderGraphDomainTabs(groups);

  if (!groups.length) {
    skillCharts.innerHTML = `
      <article class="chart-panel">
        <h3>Skill acquisition</h3>
        <canvas data-empty-skill width="760" height="320"></canvas>
      </article>
    `;
    drawLineChart(skillCharts.querySelector("canvas"), [], {
      maxY: 100,
      yStep: 10,
      yLabel: "% independence",
      emptyMessage: "Save a session to graph target independence"
    });
    return;
  }

  const visibleGroups = groups.filter((group) => !state.activeGraphDomain || group.domain === state.activeGraphDomain);
  skillCharts.innerHTML = visibleGroups.map((group) => `
    <section class="graph-domain-group">
      <div class="plan-domain-heading">
        <h3>${escapeHtml(group.domain)}</h3>
        <span>${group.charts.length} program${group.charts.length === 1 ? "" : "s"}</span>
      </div>
      <div class="chart-zone">
        ${group.charts.map((chart) => `
          <article class="chart-panel">
            <h3>${chart.program.name}</h3>
            <canvas data-program-chart="${chart.program.id}" width="760" height="320"></canvas>
            ${renderGraphLegendMarkup(chart.series, { showTrendLine: trendLineEnabled(graphTrendKey("skill", chart.program.id)) })}
            <div data-program-analysis="${chart.program.id}"></div>
            ${renderSkillDataManagerMarkup(chart)}
          </article>
        `).join("")}
      </div>
    </section>
  `).join("");

  visibleGroups.flatMap((group) => group.charts).forEach((chart) => {
    const graphKey = graphTrendKey("skill", chart.program.id);
    const phaseConfig = graphPhaseConfig(graphKey, chart.series, masteryMarkersForProgram(chart.program.id));
    drawLineChart(skillCharts.querySelector(`[data-program-chart="${chart.program.id}"]`), chart.series, {
      maxY: 100,
      yStep: 10,
      yLabel: "% independence",
      emptyMessage: "No target data for this program",
      phaseMarkers: phaseConfig.phaseMarkers,
      treatmentPhaseLine: phaseConfig.treatmentPhaseLine,
      graphType: "skill",
      showTrendLine: trendLineEnabled(graphKey)
    });
    const analysisMount = skillCharts.querySelector(`[data-program-analysis="${chart.program.id}"]`);
    if (analysisMount) {
      const analysis = buildGraphAnalysis(chart.series, {
        graphType: "skill",
        phaseMarkers: phaseConfig.phaseMarkers,
        treatmentPhaseLine: phaseConfig.treatmentPhaseLine
      });
      analysisMount.innerHTML = `
        ${renderGraphAnalysisMarkup(analysis, graphKey, {
          reportField: "progressSummary"
        })}
        ${renderCustomPhaseLineManager(graphKey, chart.series)}
      `;
    }
  });
}

function buildSkillChartsByDomain(sessions) {
  return groupedProgramsByDomain(clientPrograms())
    .map(([domain, domainPrograms]) => ({
      domain,
      charts: domainPrograms.map((program) => buildProgramSkillChart(program, sessions)).filter((chart) => chart.series.length)
    }))
    .filter((group) => group.charts.length);
}

function buildProgramSkillChart(program, sessions) {
  const targets = configuredTargetsForProgram(program);
  const series = targets.map((target) => ({
    name: target.name,
    meta: {
      targetId: target.id,
      status: target.status || "active"
    },
    points: sessions.flatMap((session) => {
      const entry = targetEntries(session)
        .filter(isActualTargetEntry)
        .find((item) => item.programId === program.id && item.targetId === target.id);
      return entry ? [{
        x: session.date,
        y: entry.independence,
        phase: entry.phase || "intervention",
        sessionId: session.id,
        programId: program.id,
        targetId: target.id,
        note: session.notes || ""
      }] : [];
    })
  })).filter((item) => item.points.length);
  return { program, series };
}

function buildParentTrainingChartModels(sessions) {
  const parentSessions = sessions.filter((session) => session.serviceType === "parent-training");
  const goalNames = [...new Set(parentSessions.flatMap((session) => (
    (session.parentGoals || []).map((goal) => goal.goalName)
  )))].filter(Boolean);

  return goalNames.map((goalName) => {
    const goalKey = parentTrainingGoalKey({ goalName, targetName: "" });
    const targetNames = [...new Set(parentSessions.flatMap((session) => (
      (session.parentGoals || [])
        .filter((goal) => goal.goalName === goalName)
        .map((goal) => goal.targetName)
    )))].filter(Boolean);
    const series = targetNames.map((targetName) => ({
      name: targetName,
      meta: {
        goalName,
        targetName
      },
      points: parentSessions.flatMap((session) => {
        const goal = (session.parentGoals || []).find((item) => (
          item.goalName === goalName && item.targetName === targetName
        ));
        return goal ? [{
          x: session.date,
          y: Number(goal.fidelity || 0),
          phase: "intervention",
          sessionId: session.id,
          goalName,
          targetName,
          note: session.notes || ""
        }] : [];
      })
    })).filter((item) => item.points.length);
    return { goalName, goalKey, series };
  }).filter((chart) => chart.series.length);
}

function masteryMarkersForProgram(programId) {
  const markers = (currentClient()?.planChangeLog || [])
    .filter((change) => (
      change.type === "target-status-changed"
      && change.programId === programId
      && change.toStatus === "mastered"
      && change.date
    ))
    .reduce((map, change) => {
      if (!map.has(change.date)) {
        map.set(change.date, []);
      }
      map.get(change.date).push(change.targetName);
      return map;
    }, new Map());

  return [...markers.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, targetNames]) => ({
      date,
      label: "Target mastered",
      detail: targetNames.join(", "),
      targetIds: targetNames.map((targetName) => (
        clientPrograms()
          .find((program) => program.id === programId)
          ?.targets?.find((target) => target.name === targetName)?.id
      )).filter(Boolean),
      phaseType: "targetMastered",
      lineStyle: "dashed",
      position: "after-date"
    }));
}

function renderGraphLegendMarkup(series, options = {}) {
  const items = buildLegendItems(series || []);
  const showTrendLine = Boolean(options.showTrendLine);
  if (!items.length && !showTrendLine) return "";
  return `
    <div class="graph-legend" aria-label="Graph target legend">
      ${items.map((item) => `
        <span class="graph-legend-item">
          <span class="graph-legend-swatch" style="background:${escapeHtml(item.color)};"></span>
          <span>${escapeHtml(item.label)}</span>
        </span>
      `).join("")}
      ${showTrendLine ? `
        <span class="graph-legend-item graph-legend-item-trend">
          <span class="graph-legend-line graph-legend-line-trend" aria-hidden="true"></span>
          <span>5-session moving average</span>
        </span>
      ` : ""}
    </div>
  `;
}

function renderGraphLegend(container, series, options = {}) {
  if (!container) return;
  const existing = container.querySelector(".graph-legend");
  const markup = renderGraphLegendMarkup(series, options);
  if (existing) existing.remove();
  if (markup) container.insertAdjacentHTML("beforeend", markup);
}

function graphTrendKey(prefix, id) {
  return `${prefix}:${id}`;
}

function trendLineEnabled(graphKey) {
  return Boolean(state.graphTrendVisibility[graphKey]);
}

function renderGraphAnalysisMarkup(analysis, graphKey, options = {}) {
  if (!analysis?.analyses?.length) return "";
  const reportField = options.reportField || "progressSummary";
  const insertLabel = reportField === "parentTrainingSummary"
    ? "Insert into parent training summary"
    : reportField === "progressSummary"
      ? "Insert interpretation into report"
      : "Insert interpretation";
  const showTrendLine = trendLineEnabled(graphKey);
  const payload = escapeHtml(encodeURIComponent(JSON.stringify(analysis)));
  return `
    <section class="graph-analysis-panel" data-graph-analysis="${escapeHtml(graphKey)}" data-graph-analysis-payload="${payload}" data-report-field="${escapeHtml(reportField)}">
      <div class="graph-analysis-toolbar">
        <strong>Graph Analysis</strong>
        <label class="trend-line-toggle">
          <input type="checkbox" data-graph-trend-toggle="${escapeHtml(graphKey)}" ${showTrendLine ? "checked" : ""}>
          <span>Show trend line</span>
        </label>
      </div>
      <p class="graph-analysis-note">Analysis based on ${escapeHtml(options.rangeLabel || analysis.rangeLabel || "selected date range")}.</p>
      ${!analysis.phaseBoundary ? '<p class="graph-analysis-note">Treatment phase line unavailable; baseline/treatment analysis may be limited.</p>' : ""}
      ${options.treatmentBeforeRange ? '<p class="graph-analysis-note">Treatment phase began before selected range.</p>' : ""}
      ${showTrendLine && analysis.trendLineMessage ? `<p class="graph-analysis-note">${escapeHtml(analysis.trendLineMessage)}</p>` : ""}
      ${analysis.analyses.map((entry) => `
        <article class="graph-analysis-series">
          <div class="graph-analysis-series-heading">
            <h4>${escapeHtml(entry.label)}</h4>
            <button type="button" class="secondary-button" data-insert-graph-analysis="${escapeHtml(graphKey)}" data-series-label="${escapeHtml(entry.label)}" data-report-field="${escapeHtml(reportField)}">${insertLabel}</button>
          </div>
          <p class="graph-analysis-interpretation">${escapeHtml(entry.interpretation)}</p>
          <div class="graph-analysis-grid">
            ${renderGraphMetricCell("Baseline level", formatAnalysisMetric(entry.baselineLevel, analysis.graphType))}
            ${renderGraphMetricCell("Treatment level", formatAnalysisMetric(entry.treatmentLevel ?? entry.treatmentAverage, analysis.graphType))}
            ${renderGraphMetricCell("Current level", formatAnalysisMetric(entry.currentLevel, analysis.graphType))}
            ${renderGraphMetricCell("Trend", entry.trendDirection)}
            ${analysis.graphType === "skill"
              ? renderGraphMetricCell("Change from baseline", entry.percentChange && !String(entry.percentChange).includes("unavailable")
                ? `${formatAnalysisMetric(entry.difference, analysis.graphType)} (${entry.percentChange})`
                : formatAnalysisMetric(entry.difference, analysis.graphType))
              : renderGraphMetricCell("Percent reduction", entry.percentReduction || "Unavailable")}
          </div>
          <details class="graph-analysis-details">
            <summary>Advanced analysis</summary>
            <div class="graph-analysis-grid graph-analysis-grid-advanced">
              ${renderGraphMetricCell("Baseline average", formatAnalysisMetric(entry.baselineAverage, analysis.graphType))}
              ${renderGraphMetricCell("Variability", entry.variability)}
              ${renderGraphMetricCell("Stability", entry.stability)}
              ${analysis.graphType === "skill"
                ? renderGraphMetricCell("Mastery status", entry.masteryStatus || "in progress")
                : renderGraphMetricCell("Overlap", entry.overlap || "Unavailable")}
              ${analysis.graphType === "skill"
                ? renderGraphMetricCell("Sessions to mastery", entry.sessionsToMastery ?? "Not mastered")
                : renderGraphMetricCell("Immediacy of effect", entry.immediacy || "Unavailable")}
            </div>
            ${entry.trendConfidence ? `<p class="graph-analysis-note">${escapeHtml(entry.trendConfidence)}</p>` : ""}
          </details>
        </article>
      `).join("")}
    </section>
  `;
}

function renderReportGraphAnalysisMarkup(analysis, options = {}) {
  if (!analysis?.analyses?.length) return "";
  return `
    <section class="report-graph-analysis" aria-label="Graph Analysis">
      <p class="graph-analysis-note">Analysis based on ${escapeHtml(options.rangeLabel || analysis.rangeLabel || "selected date range")}.</p>
      ${!analysis.phaseBoundary ? '<p class="graph-analysis-note">Treatment phase line unavailable; baseline/treatment analysis may be limited.</p>' : ""}
      ${analysis.analyses.map((entry) => `
        <p class="report-graph-analysis-line">
          <strong>${escapeHtml(entry.label)}:</strong>
          <span>${escapeHtml(buildCompactGraphAnalysisSentence(entry, analysis.graphType))}</span>
        </p>
      `).join("")}
    </section>
  `;
}

function renderGraphMetricCell(label, value) {
  return `
    <div class="graph-analysis-metric">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(String(value ?? "Unavailable"))}</strong>
    </div>
  `;
}

function formatAnalysisMetric(value, graphType) {
  if (value === null || value === undefined || value === "") return "Unavailable";
  if (typeof value === "number") {
    return graphType === "behavior" ? `${value}` : `${value}%`;
  }
  return value;
}

function graphInterpretationText(analysis, graphKey, seriesLabel = "") {
  const matching = seriesLabel
    ? analysis.analyses.filter((entry) => entry.label === seriesLabel)
    : analysis.analyses;
  const interpretation = matching.map((entry) => entry.interpretation).join(" ");
  if (trendLineEnabled(graphKey) && analysis.trendLineEligible) {
    return `${interpretation} A 5-session moving average trend line was enabled for visual review.`;
  }
  return interpretation;
}

function renderSkillDataManagerMarkup(chart) {
  const rows = chart.series.flatMap((series) => series.points.map((point) => ({
    sessionId: point.sessionId,
    programId: point.programId,
    targetId: point.targetId,
    targetName: series.name,
    date: point.x,
    value: point.y
  }))).sort((a, b) => b.date.localeCompare(a.date));
  if (!rows.length) return "";
  return `
    <details class="graph-data-manager">
      <summary>Manage data points</summary>
      <div class="graph-data-list">
        ${rows.map((row) => `
          <div class="graph-data-row">
            <div>
              <strong>${escapeHtml(row.targetName)}</strong>
              <span>${escapeHtml(formatGraphDate(row.date))} - ${row.value}% independence</span>
            </div>
            <button
              type="button"
              class="delete-button"
              data-delete-skill-point="true"
              data-session-id="${escapeHtml(row.sessionId)}"
              data-program-id="${escapeHtml(row.programId)}"
              data-target-id="${escapeHtml(row.targetId)}"
              data-point-label="${escapeHtml(row.targetName)}"
              data-point-date="${escapeHtml(row.date)}"
            >Delete</button>
          </div>
        `).join("")}
      </div>
    </details>
  `;
}

function renderBehaviorDataManagerMarkup(chart) {
  const rows = chart.series.flatMap((series) => series.points.map((point) => ({
    sessionId: point.sessionId,
    behaviorId: point.behaviorId,
    behaviorName: series.name,
    date: point.x,
    value: point.y
  }))).sort((a, b) => b.date.localeCompare(a.date));
  if (!rows.length) return "";
  return `
    <details class="graph-data-manager">
      <summary>Manage data points</summary>
      <div class="graph-data-list">
        ${rows.map((row) => `
          <div class="graph-data-row">
            <div>
              <strong>${escapeHtml(row.behaviorName)}</strong>
              <span>${escapeHtml(formatGraphDate(row.date))} - ${row.value} frequency</span>
            </div>
            <button
              type="button"
              class="delete-button"
              data-delete-behavior-point="true"
              data-session-id="${escapeHtml(row.sessionId)}"
              data-behavior-id="${escapeHtml(row.behaviorId)}"
              data-point-label="${escapeHtml(row.behaviorName)}"
              data-point-date="${escapeHtml(row.date)}"
            >Delete</button>
          </div>
        `).join("")}
      </div>
    </details>
  `;
}

function renderParentTrainingDataManagerMarkup(chart) {
  const rows = chart.series.flatMap((series) => series.points.map((point) => ({
    sessionId: point.sessionId,
    goalName: point.goalName || chart.goalName,
    targetName: point.targetName || series.name,
    targetLabel: `${chart.goalName}: ${series.name}`,
    date: point.x,
    value: point.y
  }))).sort((a, b) => b.date.localeCompare(a.date));
  if (!rows.length) return "";
  return `
    <details class="graph-data-manager">
      <summary>Manage data points</summary>
      <div class="graph-data-list">
        ${rows.map((row) => `
          <div class="graph-data-row">
            <div>
              <strong>${escapeHtml(row.targetLabel)}</strong>
              <span>${escapeHtml(formatGraphDate(row.date))} - ${row.value}% fidelity</span>
            </div>
            <button
              type="button"
              class="delete-button"
              data-delete-parent-point="true"
              data-session-id="${escapeHtml(row.sessionId)}"
              data-goal-name="${escapeHtml(row.goalName)}"
              data-target-name="${escapeHtml(row.targetName)}"
              data-point-label="${escapeHtml(row.targetLabel)}"
              data-point-date="${escapeHtml(row.date)}"
            >Delete</button>
          </div>
        `).join("")}
      </div>
    </details>
  `;
}

function renderGraphDomainTabs(groups) {
  if (!graphDomainTabs) return;
  if (!groups.length) {
    graphDomainTabs.innerHTML = "";
    state.activeGraphDomain = "";
    return;
  }
  const domains = groups.map((group) => group.domain);
  if (!state.activeGraphDomain || !domains.includes(state.activeGraphDomain)) {
    state.activeGraphDomain = domains[0];
  }
  graphDomainTabs.innerHTML = domains.map((domain) => {
    const group = groups.find((item) => item.domain === domain);
    return `
      <button type="button" class="domain-tab ${domain === state.activeGraphDomain ? "active" : ""}" data-graph-domain-tab="${escapeHtml(domain)}">
        ${escapeHtml(domain)}${group?.charts?.length ? ` (${group.charts.length})` : ""}
      </button>
    `;
  }).join("");
  graphDomainTabs.querySelectorAll("[data-graph-domain-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeGraphDomain = button.dataset.graphDomainTab;
      renderCharts();
    });
  });
}

function drawSkillChartSet(sessions, container, chartAttribute, includeProgramInfo = false) {
  const charts = clientPrograms()
    .map((program) => buildProgramSkillChart(program, sessions))
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
      ${renderGraphLegendMarkup(chart.series, { showTrendLine: trendLineEnabled(graphTrendKey("skill", chart.program.id)) })}
      ${includeProgramInfo ? `<div data-report-program-analysis="${chart.program.id}"></div>` : ""}
    </article>
  `).join("");

  charts.forEach((chart) => {
    const graphKey = graphTrendKey("skill", chart.program.id);
    const phaseConfig = graphPhaseConfig(graphKey, chart.series, masteryMarkersForProgram(chart.program.id));
    drawLineChart(container.querySelector(`[data-${chartAttribute}="${chart.program.id}"]`), chart.series, {
      maxY: 100,
      yStep: 10,
      yLabel: "% independence",
      emptyMessage: "No target data for this program",
      phaseMarkers: phaseConfig.phaseMarkers,
      treatmentPhaseLine: phaseConfig.treatmentPhaseLine,
      graphType: "skill",
      showTrendLine: trendLineEnabled(graphKey)
    });
    if (includeProgramInfo) {
      const analysisMount = container.querySelector(`[data-report-program-analysis="${chart.program.id}"]`);
      if (analysisMount) {
        const analysis = buildGraphAnalysis(chart.series, {
          graphType: "skill",
          phaseMarkers: phaseConfig.phaseMarkers,
          treatmentPhaseLine: phaseConfig.treatmentPhaseLine
        });
        analysisMount.innerHTML = `
          ${renderReportGraphAnalysisMarkup(analysis)}
          ${renderCustomPhaseLineManager(graphKey, chart.series, { readOnly: true })}
        `;
      }
    }
  });
}

function behaviorChartSeries(sessions) {
  return clientBehaviors().map((behavior) => ({
    name: behavior.name,
    meta: {
      behaviorId: behavior.id,
      status: behavior.status || "active"
    },
    points: sessions.flatMap((session) => {
      const target = behaviorEntriesForSession(session).find((item) => item.behaviorId === behavior.id);
      return target ? [{
        x: session.date,
        y: Number(target.frequency || 0),
        phase: target.phase || "intervention",
        sessionId: session.id,
        behaviorId: behavior.id,
        note: target.note || session.notes || ""
      }] : [];
    })
  })).filter((series) => series.points.length);
}

function drawBehaviorChartSet(sessions, container, chartAttribute, options = {}) {
  const isReportChart = String(chartAttribute || "").startsWith("report-");
  const range = options.range || behaviorGraphRange();
  const allSeries = options.allSeries || behaviorChartSeries(currentSessions().slice().reverse());
  const visibleIds = options.visibleBehaviorIds || visibleBehaviorIds();
  const charts = filterSeriesPointsByDateRange(behaviorChartSeries(sessions), range, {
    includeSeriesIds: visibleIds
  }).map((series) => ({
    behaviorId: series.meta?.behaviorId || series.name,
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
      <div class="graph-canvas-scroll">
        <canvas data-${chartAttribute}="${index}" width="760" height="320"></canvas>
      </div>
      ${renderGraphLegendMarkup(chart.series, { showTrendLine: trendLineEnabled(graphTrendKey("behavior", chart.behaviorId)) })}
      <div data-behavior-analysis="${escapeHtml(String(chart.behaviorId))}"></div>
      ${isReportChart ? "" : renderBehaviorDataManagerMarkup(chart)}
    </article>
  `).join("");

  charts.forEach((chart, index) => {
    const graphKey = graphTrendKey("behavior", chart.behaviorId);
    const phaseConfig = graphPhaseConfig(graphKey, chart.series);
    drawLineChart(container.querySelector(`[data-${chartAttribute}="${index}"]`), chart.series, {
      yStep: 1,
      yLabel: "frequency",
      emptyMessage: "No behavior data for this behavior",
      phaseMarkers: phaseConfig.phaseMarkers,
      treatmentPhaseLine: phaseConfig.treatmentPhaseLine,
      graphType: "behavior",
      showTrendLine: trendLineEnabled(graphKey),
      showPointMarkers: isReportChart ? true : state.behaviorGraphShowPoints,
      suppressAutoTreatmentBoundary: anySeriesDataBeforeRange(
        allSeries.filter((series) => series.meta?.behaviorId === chart.behaviorId),
        range.startDate
      )
    });
    const analysisMount = container.querySelector(`[data-behavior-analysis="${escapeHtml(String(chart.behaviorId))}"]`);
    if (analysisMount) {
      const analysisSeries = state.behaviorGraphAnalyzeAllData && !isReportChart
        ? allSeries.filter((series) => series.meta?.behaviorId === chart.behaviorId)
        : chart.series;
      const analysis = buildGraphAnalysis(analysisSeries, {
        graphType: "behavior",
        phaseMarkers: phaseConfig.phaseMarkers,
        treatmentPhaseLine: phaseConfig.treatmentPhaseLine,
        phaseMarkers: phaseConfig.phaseMarkers,
        rangeLabel: state.behaviorGraphAnalyzeAllData && !isReportChart ? "All data" : range.label
      });
      analysisMount.innerHTML = isReportChart
        ? `
            ${renderReportGraphAnalysisMarkup(analysis, { rangeLabel: range.label })}
            ${renderCustomPhaseLineManager(graphKey, chart.series, { readOnly: true })}
          `
        : `
            ${renderGraphAnalysisMarkup(analysis, graphKey, {
              reportField: "progressSummary",
              rangeLabel: state.behaviorGraphAnalyzeAllData ? "All data" : range.label,
              treatmentBeforeRange: anySeriesDataBeforeRange(
                allSeries.filter((series) => series.meta?.behaviorId === chart.behaviorId),
                range.startDate
              )
            })}
            ${renderCustomPhaseLineManager(graphKey, chart.series)}
          `;
    }
  });
}

function drawParentTrainingChartSet(sessions, container, chartAttribute, options = {}) {
  const charts = buildParentTrainingChartModels(sessions);
  const isReadOnly = Boolean(options.readOnly);
  const reportField = options.reportField || "parentTrainingSummary";
  const emptyMessage = options.emptyMessage || "No caregiver training graph data available.";

  if (!charts.length) {
    container.innerHTML = `<p>${escapeHtml(emptyMessage)}</p>`;
    return;
  }

  container.innerHTML = charts.map((chart, index) => `
    <article class="chart-panel">
      <h3>${escapeHtml(chart.goalName)}</h3>
      <canvas data-${chartAttribute}="${index}" width="760" height="320"></canvas>
      ${renderGraphLegendMarkup(chart.series, { showTrendLine: trendLineEnabled(graphTrendKey("parent", chart.goalKey)) })}
      <div data-parent-training-analysis="${escapeHtml(chart.goalKey)}"></div>
      ${isReadOnly ? "" : renderParentTrainingDataManagerMarkup(chart)}
    </article>
  `).join("");

  charts.forEach((chart, index) => {
    const graphKey = graphTrendKey("parent", chart.goalKey);
    const phaseConfig = graphPhaseConfig(graphKey, chart.series);
    drawLineChart(container.querySelector(`[data-${chartAttribute}="${index}"]`), chart.series, {
      maxY: 100,
      yStep: 10,
      yLabel: "caregiver fidelity %",
      emptyMessage: "No parent training data for this goal",
      graphType: "skill",
      phaseMarkers: phaseConfig.phaseMarkers,
      treatmentPhaseLine: phaseConfig.treatmentPhaseLine,
      showTrendLine: trendLineEnabled(graphKey)
    });
    const analysisMount = container.querySelector(`[data-parent-training-analysis="${escapeHtml(chart.goalKey)}"]`);
    if (analysisMount) {
      const analysis = buildGraphAnalysis(chart.series, {
        graphType: "skill",
        phaseMarkers: phaseConfig.phaseMarkers,
        treatmentPhaseLine: phaseConfig.treatmentPhaseLine
      });
      analysisMount.innerHTML = isReadOnly
        ? `
            ${renderReportGraphAnalysisMarkup(analysis)}
            ${renderCustomPhaseLineManager(graphKey, chart.series, { readOnly: true })}
          `
        : `
            ${renderGraphAnalysisMarkup(analysis, graphKey, { reportField })}
            ${renderCustomPhaseLineManager(graphKey, chart.series)}
          `;
    }
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
  const entry = selectedSoapEntry();
  const session = entry?.type === "session" ? entry.session : null;
  if (!entry) {
    selectedSoapNoteTitle.textContent = "Selected note";
    soapEditor.value = "";
    soapEditor.placeholder = "Save or select a session to generate a SOAP note.";
    soapEditor.readOnly = false;
    finalizeButton.disabled = true;
    printSoapNoteButton.disabled = true;
    downloadSoapTextButton.disabled = true;
    downloadSoapHtmlButton.disabled = true;
    return;
  }
  if (entry.type === "97151") {
    selectedSoapNoteTitle.textContent = "97151 assessment note";
    soapEditor.value = entry.note || "";
    soapEditor.readOnly = true;
    finalizeButton.disabled = true;
    printSoapNoteButton.disabled = false;
    downloadSoapTextButton.disabled = false;
    downloadSoapHtmlButton.disabled = false;
    noteStatus.textContent = "This 97151 assessment note is managed from Treatment Plan or Funder Report.";
    return;
  }
  if (entry.type === "97155") {
    selectedSoapNoteTitle.textContent = "97155 treatment plan note";
    soapEditor.value = entry.note || "";
    soapEditor.readOnly = true;
    finalizeButton.disabled = true;
    printSoapNoteButton.disabled = false;
    downloadSoapTextButton.disabled = false;
    downloadSoapHtmlButton.disabled = false;
    noteStatus.textContent = "This 97155 treatment plan note is managed from Treatment Plan.";
    return;
  }
  selectedSoapNoteTitle.textContent = `${sessionCodeLabel(session)} ${soapEntryActivityLabel(entry)}`;
  soapEditor.value = session.soapNote || generateSoapNote(session, lookups());
  soapEditor.readOnly = session.finalized;
  finalizeButton.disabled = session.finalized;
  printSoapNoteButton.disabled = false;
  downloadSoapTextButton.disabled = false;
  downloadSoapHtmlButton.disabled = false;
  noteStatus.textContent = session.finalized ? "This note is finalized." : "Draft note is editable.";
}

function handlePrintSoapNote() {
  const entry = selectedSoapEntry();
  if (!entry) return;
  const session = entry.type === "session" ? entry.session : null;
  const noteWindow = window.open("", "_blank");
  if (!noteWindow) {
    noteStatus.textContent = "Popup blocked. Allow popups to print the note.";
    return;
  }
  noteWindow.document.write(`
    <!doctype html>
    <html>
      <head>
        <title>${escapeHtml(soapNoteFileBase(entry))}</title>
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
        <p>${escapeHtml(currentClient()?.name || "Client")}${session ? ` - ${formatDate(session.date)}` : ""}</p>
        <pre>${escapeHtml(soapEditor.value)}</pre>
      </body>
    </html>
  `);
  noteWindow.document.close();
  noteWindow.focus();
  noteWindow.print();
}

function handleDownloadSoapNote(format) {
  const entry = selectedSoapEntry();
  if (!entry) return;
  const base = soapNoteFileBase(entry);
  if (format === "html") {
    downloadFile(`${base}.html`, soapNoteHtml(entry), "text/html");
    return;
  }
  downloadFile(`${base}.txt`, soapEditor.value, "text/plain");
}

function soapNoteFileBase(entry) {
  if (entry?.type === "97151") {
    return `${safeFilename(currentClient()?.name || "Client")}-97151-assessment-note-${entry.record?.date || "note"}`;
  }
  if (entry?.type === "97155") {
    return `${safeFilename(currentClient()?.name || "Client")}-97155-treatment-plan-note-${entry.record?.date || "note"}`;
  }
  const session = entry?.session || entry;
  return `${safeFilename(lookups().clientName(session.clientId))}-${session.serviceType || "97153"}-${session.date}`;
}

function soapNoteHtml(entry) {
  const session = entry?.type === "session" ? entry.session : null;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>${escapeHtml(soapNoteFileBase(entry))}</title>
    <style>
      body { font-family: Arial, sans-serif; color: #17212b; margin: 32px; line-height: 1.5; }
      h1 { font-size: 22px; margin: 0 0 8px; }
      p { margin: 0 0 16px; color: #59656f; }
      pre { white-space: pre-wrap; font: inherit; }
    </style>
  </head>
  <body>
    <h1>${escapeHtml(selectedSoapNoteTitle.textContent)}</h1>
    <p>${escapeHtml(currentClient()?.name || "Client")}${session ? ` - ${formatDate(session.date)}` : ""}</p>
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
  return state.clients.find((client) => client.id === state.activeClientId)
    || workflowClients()[0]
    || state.clients[0];
}

function currentClientProfilePayload(client = currentClient()) {
  return {
    name: client?.name || "",
    agency: client?.agency || state.currentUser?.agency || agencyOptions[0],
    dob: client?.dob || "",
    defaultSetting: client?.defaultSetting || "",
    status: client?.status || "active",
    caregivers: client?.profile?.caregivers || "",
    school: client?.profile?.school || "",
    diagnosis: client?.profile?.diagnosis || "",
    communication: client?.profile?.communication || "",
    profileNotes: client?.profile?.notes || "",
    masteryThresholdPercent: client?.profile?.masteryCriteria?.thresholdPercent || 90,
    masteryConsecutiveSessions: client?.profile?.masteryCriteria?.consecutiveSessions || 2,
    stagnantConsecutiveSessions: client?.profile?.masteryCriteria?.stagnantConsecutiveSessions || 3,
    stagnantMinimumGain: client?.profile?.masteryCriteria?.stagnantMinimumGain || 5,
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
    funderReport: structuredClone(client?.profile?.funderReport || {}),
    intakeInterview: structuredClone(client?.profile?.intakeInterview || {}),
    parentTrainingGoals: structuredClone(client?.profile?.parentTrainingGoals || []),
    documents: structuredClone(client?.profile?.documents || [])
  };
}

function defaultClinicalWorkflowBoard() {
  return [
    workflowCard("initial-assessment", "Conduct initial assessment", "1 week", "Completed assessment", ["97151"], [
      "Conduct and document the initial assessment"
    ]),
    workflowCard("week-1-2", "Assessment setup and curriculum probing", "Week 1-2", "Integrity checklist, programs on Rethink", ["97155"], [
      "Establish rapport",
      "Select and administer developmental curriculum (VB-MAPP, ABLLS-R, AFLS)",
      "Probe and write skill acquisition programs",
      "Collect ABC data for behaviors identified during assessment"
    ]),
    workflowCard("week-3-4", "Early implementation and behavior plan drafting", "Week 3-4", "Integrity checklist, behavior plan draft", ["97155"], [
      "Continue implementing skill acquisition programs",
      "Complete grid of developmental curriculum",
      "Probe behavior reduction strategies appropriate to client's skills"
    ]),
    workflowCard("week-5-6", "Caregiver presentation and plan drafting", "Week 5-6", "Integrity checklist, behavior plan draft", ["97155", "97156"], [
      "Complete all items of session task list",
      "Present developmental curriculum grid to caregivers",
      "Draft and complete behavior reduction plan"
    ]),
    workflowCard("week-7", "Review behavior plan with caregivers", "Week 7", "Integrity checklist, behavior plan draft", ["97155", "97156"], [
      "Complete all items of session task list",
      "Meet with caregivers to review behavior plan and collect feedback"
    ]),
    workflowCard("week-8-9", "Finalize signed behavior plan", "Week 8-9", "Signed behavior plan", ["97155", "97156"], [
      "Complete all items of session task list",
      "Finalize behavior plan and present final draft to caregiver",
      "Collect caregiver signature"
    ]),
    workflowCard("week-10-17", "Ongoing integrity checks", "Week 10-17", "Integrity checklists", ["97155"], [
      "Complete all items of session task list"
    ]),
    workflowCard("week-18-20", "Prepare for 6-month reassessment", "Week 18-20", "Integrity checklists", ["97155", "97156"], [
      "Complete all items of session task list",
      "Send standardized curriculums to caregivers in preparation for 6 month reassessment"
    ]),
    workflowCard("week-20-22", "Complete reassessment", "Week 20-22", "Completed reassessment", ["97151"], [
      "Complete and submit reassessment"
    ])
  ];
}

function workflowCard(id, title, timeline, deliverable, cptCodes, checklist) {
  return {
    id,
    title,
    timeline,
    deliverable,
    cptCodes,
    status: "todo",
    notes: "",
    checklist: checklist.map((label, index) => ({
      id: `${id}-item-${index + 1}`,
      label,
      done: false
    }))
  };
}

function clientWorkflowBoard() {
  const client = currentClient();
  const storedBoard = client?.workflowBoard;
  const board = structuredClone(Array.isArray(storedBoard) && storedBoard.length ? storedBoard : defaultClinicalWorkflowBoard());
  return deriveWorkflowBoardFromClient(client, board);
}

function deriveWorkflowBoardFromClient(client, board) {
  if (!client) return board;
  const noteByCard = new Map(board.map((card) => [card.id, card.notes || ""]));
  const cycle = currentAuthorizationCycle(client);
  const sessions = currentSessions().filter((session) => dateFallsInCycle(session.date, cycle));
  const parentSessions = sessions.filter((session) => session.serviceType === "parent-training");
  const directSessions = sessions.filter((session) => (session.serviceType || "97153") === "97153");
  const documents = (client.profile?.documents || []).filter((document) => dateFallsInCycle(document.date || document.createdAt, cycle));
  const behaviors = clientBehaviors();
  const programs = clientPrograms();
  const assessment = client.profile?.assessment || {};
  const cyclePlanChanges = (client.planChangeLog || []).filter((change) => dateFallsInCycle(change.date || change.createdAt, cycle));
  const hasAssessmentRecord = Boolean(
    dateFallsInCycle(assessment.date, cycle) && String(assessment.date || "").trim()
    || String(assessment.conductedBy || "").trim()
    || (dateFallsInCycle(assessment.date, cycle) && String(assessment.fileName || "").trim())
    || (dateFallsInCycle(assessment.date, cycle) && String(assessment.notes || "").trim())
  );
  const hasNote97151 = Boolean(String(client.note97151 || "").trim()) && dateFallsInCycle(assessment.date, cycle);
  const hasNote97155 = Boolean(String(client.note97155 || "").trim()) && Boolean(cyclePlanChanges.length || parentSessions.length);
  const hasAssessmentDocument = documents.some((document) => ["standardized-assessment", "fba-assessment"].includes(document.type));
  const hasBehaviorPlanDocument = documents.some((document) => document.type === "behavior-support-plan");
  const hasFunderReportDocument = documents.some((document) => document.type === "funder-report");
  const hasSignedBehaviorPlan = documents.some((document) => document.type === "behavior-support-plan" && workflowText(document).match(/\bsign(ed|ature)?\b/i));
  const hasAuthorizationDocument = documents.some((document) => document.type === "authorization");
  const hasAssessmentEvidence = hasAssessmentRecord || hasAssessmentDocument || hasNote97151;
  const hasBehaviorPlanDraft = hasBehaviorPlanDocument || hasFunderReportDocument || hasNote97155;
  const hasCaregiverReview = parentSessions.length > 0 || workflowText(client.note97155 || "").match(/\bcaregiver\b/i);
  const hasReassessment = hasNote97151 && (hasFunderReportDocument || hasAssessmentDocument);
  const significantDirectWork = directSessions.length >= 4;
  const ongoingIntegrityChecks = directSessions.length >= 8 || Boolean(cyclePlanChanges.length);
  const evidenceMap = {
    "initial-assessment": {
      done: [hasAssessmentEvidence],
      evidence: workflowEvidenceList([
        hasAssessmentRecord && `Assessment entered (${formatDate(assessment.date) || "date pending"})`,
        hasAssessmentDocument && "Assessment file uploaded",
        hasNote97151 && "97151 note generated"
      ])
    },
    "week-1-2": {
      done: [
        directSessions.length > 0,
        hasAssessmentEvidence,
        programs.length > 0,
        behaviors.length > 0
      ],
      evidence: workflowEvidenceList([
        directSessions.length > 0 && `${directSessions.length} direct session${directSessions.length === 1 ? "" : "s"} logged`,
        hasAssessmentEvidence && "Assessment materials documented",
        programs.length > 0 && `${programs.length} program${programs.length === 1 ? "" : "s"} on plan`,
        behaviors.length > 0 && `${behaviors.length} behavior${behaviors.length === 1 ? "" : "s"} tracked`
      ])
    },
    "week-3-4": {
      done: [
        directSessions.length >= 2,
        hasAssessmentEvidence,
        hasBehaviorPlanDraft
      ],
      evidence: workflowEvidenceList([
        directSessions.length >= 2 && "Implementation sessions underway",
        hasAssessmentEvidence && "Curriculum / assessment materials present",
        hasBehaviorPlanDraft && "Behavior plan drafting evidence present"
      ])
    },
    "week-5-6": {
      done: [
        significantDirectWork,
        parentSessions.length > 0,
        hasBehaviorPlanDraft
      ],
      evidence: workflowEvidenceList([
        significantDirectWork && "Session task list activity established",
        parentSessions.length > 0 && `${parentSessions.length} caregiver training session${parentSessions.length === 1 ? "" : "s"} logged`,
        hasBehaviorPlanDraft && "Behavior plan draft present"
      ])
    },
    "week-7": {
      done: [
        significantDirectWork,
        hasCaregiverReview
      ],
      evidence: workflowEvidenceList([
        significantDirectWork && "Ongoing clinical work documented",
        hasCaregiverReview && "Caregiver review evidence found"
      ])
    },
    "week-8-9": {
      done: [
        significantDirectWork,
        hasBehaviorPlanDocument,
        hasSignedBehaviorPlan
      ],
      evidence: workflowEvidenceList([
        significantDirectWork && "Session task list activity established",
        hasBehaviorPlanDocument && "Behavior support plan uploaded",
        hasSignedBehaviorPlan && "Signed behavior plan detected"
      ])
    },
    "week-10-17": {
      done: [ongoingIntegrityChecks],
      evidence: workflowEvidenceList([
        ongoingIntegrityChecks && "Integrity / ongoing implementation evidence found",
        hasNote97155 && "97155 treatment-plan note saved this cycle"
      ])
    },
    "week-18-20": {
      done: [
        ongoingIntegrityChecks,
        hasAuthorizationDocument || hasAssessmentDocument || hasFunderReportDocument
      ],
      evidence: workflowEvidenceList([
        ongoingIntegrityChecks && "Ongoing work still active",
        (hasAuthorizationDocument || hasAssessmentDocument || hasFunderReportDocument) && "Reassessment prep files are present"
      ])
    },
    "week-20-22": {
      done: [hasReassessment],
      evidence: workflowEvidenceList([
        hasNote97151 && "97151 reassessment note generated this cycle",
        (hasFunderReportDocument || hasAssessmentDocument) && "Reassessment support document uploaded"
      ])
    }
  };

  return board.map((card) => {
    const derived = evidenceMap[card.id] || { done: [], evidence: [] };
    const checklist = (card.checklist || []).map((item, index) => ({
      ...item,
      done: Boolean(derived.done[index])
    }));
    const completed = checklist.filter((item) => item.done).length;
    const total = checklist.length;
    const status = total && completed === total
      ? "done"
      : completed > 0
        ? "in-progress"
        : "todo";
    return {
      ...card,
      notes: noteByCard.get(card.id) || "",
      status,
      checklist,
      evidence: derived.evidence
    };
  });
}

function workflowEvidenceList(items) {
  return items.filter(Boolean);
}

function workflowText(value) {
  return String(value || "").trim();
}

function currentAuthorizationCycle(client) {
  const authStart = parseDateOnly(client?.profile?.authorization?.startDate);
  const authEnd = parseDateOnly(client?.profile?.authorization?.endDate);
  const fallbackStart = parseDateOnly(client?.createdAt) || new Date();
  const start = authStart || fallbackStart;
  const end = authEnd || addMonths(start, 6);
  return { start, end };
}

function workflowCycleLabel(client) {
  const cycle = currentAuthorizationCycle(client);
  return `${formatDate(dateInputValue(cycle.start))} - ${formatDate(dateInputValue(cycle.end))}`;
}

function parseDateOnly(value) {
  if (!value) return null;
  const text = String(value).trim();
  if (!text) return null;
  const isoDate = text.includes("T") ? text.slice(0, 10) : text;
  const parsed = new Date(`${isoDate}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function addMonths(date, months) {
  const copy = new Date(date.getTime());
  copy.setMonth(copy.getMonth() + months);
  return copy;
}

function dateFallsInCycle(value, cycle) {
  const date = parseDateOnly(value);
  if (!date || !cycle?.start || !cycle?.end) return false;
  return date >= cycle.start && date <= cycle.end;
}

function dateInputValue(date) {
  return date instanceof Date && !Number.isNaN(date.getTime())
    ? date.toISOString().slice(0, 10)
    : "";
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
  const configuredDomains = [...new Set([...(currentClient()?.domains || []), ...programDomains])];
  return configuredDomains.length ? configuredDomains : [...domainOptions];
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

function soapHistoryEntries() {
  const entries = currentSessions().map((session) => ({
    key: session.id,
    type: "session",
    session
  }));
  const note97155History = noteHistoryEntriesFor("97155");
  const note97151History = noteHistoryEntriesFor("97151");
  if (String(currentClient()?.note97155 || "").trim() && !note97155History.some((entry) => String(entry.note || "").trim() === String(currentClient()?.note97155 || "").trim())) {
    note97155History.push({
      id: "legacy-97155",
      serviceCode: "97155",
      note: currentClient().note97155,
      date: currentClient()?.planUpdatedAt?.slice(0, 10) || currentClient()?.updatedAt?.slice(0, 10) || currentClient()?.createdAt?.slice(0, 10) || "",
      providerSignature: "",
      providerCredential: "",
      activityLabel: "Treatment planning / protocol modification",
      createdAt: currentClient()?.planUpdatedAt || currentClient()?.updatedAt || currentClient()?.createdAt || "",
      updatedAt: currentClient()?.planUpdatedAt || currentClient()?.updatedAt || currentClient()?.createdAt || ""
    });
  }
  if (String(currentClient()?.note97151 || "").trim() && !note97151History.some((entry) => String(entry.note || "").trim() === String(currentClient()?.note97151 || "").trim())) {
    note97151History.push({
      id: "legacy-97151",
      serviceCode: "97151",
      note: currentClient().note97151,
      date: currentClient()?.profile?.assessment?.date || currentClient()?.updatedAt?.slice(0, 10) || currentClient()?.createdAt?.slice(0, 10) || "",
      providerSignature: "",
      providerCredential: "",
      activityLabel: "Behavior assessment / report update",
      createdAt: currentClient()?.updatedAt || currentClient()?.createdAt || "",
      updatedAt: currentClient()?.updatedAt || currentClient()?.createdAt || ""
    });
  }
  note97155History
    .slice()
    .sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")))
    .forEach((record) => {
    entries.unshift({
      key: soapNoteEntryKey("97155", record.id),
      type: "97155",
      note: record.note,
      record
    });
  });
  note97151History
    .slice()
    .sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")))
    .forEach((record) => {
    entries.unshift({
      key: soapNoteEntryKey("97151", record.id),
      type: "97151",
      note: record.note,
      record
    });
  });
  return entries;
}

function selectedSoapEntry() {
  const entries = soapHistoryEntries();
  return entries.find((entry) => entry.key === state.selectedSoapEntryKey) || entries[0] || null;
}

function sessionCodeLabel(session) {
  return session?.serviceType === "parent-training" ? "97156" : (session?.serviceType || "97153");
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
  const selectedIds = selectedTargetIds(programList, row);
  const options = availableTargetsForSession(program?.targets || [], selectedIds, selected);
  populateSelect(row.querySelector('[data-field="targetId"]'), options, selected);
  updateRowDomain(row);
  updateProgramDisplay(row);
}

function syncBehaviorOptions(row, selected = "") {
  const selectedIds = selectedBehaviorIds(behaviorList, row);
  const options = availableBehaviorsForSession(clientBehaviors().filter((behavior) => behavior.status !== "inactive"), selectedIds, selected);
  populateSelect(row.querySelector('[data-field="behaviorId"]'), options, selected);
}

function updateRowDomain(row) {
  const programId = row.querySelector('[data-field="programId"]').value;
  const program = clientPrograms().find((item) => item.id === programId);
  row.dataset.domain = program?.domain || "General";
}

function updateProgramDisplay(row) {
  const programId = row.querySelector('[data-field="programId"]').value;
  const program = clientPrograms().find((item) => item.id === programId);
  const display = row.querySelector("[data-program-display]");
  if (display) display.textContent = program?.name || "Program";
}

function renderDomainTabs() {
  renderTargetStatusTabs();
  const domains = sessionAvailableDomains(state.activeSessionTargetTab);

  if (!domains.length) {
    domainTabs.innerHTML = "";
    applySessionTargetFilter();
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

  ensureDomainSessionRowsLoaded();
  applySessionTargetFilter();
}

function renderTargetStatusTabs() {
  if (!targetStatusTabs) return;
  const counts = {
    active: sessionAssignableTargets("active").length,
    maintenance: sessionAssignableTargets("maintenance").length
  };
  targetStatusTabs.innerHTML = ["active", "maintenance"].map((tab) => `
    <button type="button" class="domain-tab ${tab === state.activeSessionTargetTab ? "active" : ""}" data-target-status-tab="${tab}">
      ${tab === "active" ? "Active targets" : "Maintenance"}${counts[tab] ? ` (${counts[tab]})` : ""}
    </button>
  `).join("");
  targetStatusTabs.querySelectorAll("[data-target-status-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeSessionTargetTab = button.dataset.targetStatusTab;
      renderDomainTabs();
    });
  });
  document.querySelector("#add-program")?.classList.toggle("hidden", state.activeSessionTargetTab !== "active");
  document.querySelector("#add-maintenance-target")?.classList.toggle("hidden", state.activeSessionTargetTab !== "maintenance");
}

function applySessionTargetFilter() {
  [...programList.querySelectorAll(".program-row")].forEach((row) => {
    const rowMode = row.querySelector('[data-field="entryMode"]')?.value || "active";
    const domainMatches = !state.activeDomain || (row.dataset.domain || "General") === state.activeDomain;
    row.classList.toggle("hidden", rowMode !== state.activeSessionTargetTab || !domainMatches);
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
  return actualTargets.length ? dedupeTargetEntries(structuredTargets) : recoverTargetsFromSoap(session.soapNote);
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
  [...programList.querySelectorAll(".program-row")].forEach((row) => {
    syncTargetOptions(row, row.querySelector('[data-field="targetId"]').value);
  });
}

function selectedTargetIds(container = programList, excludeRow = null) {
  return new Set([...container.querySelectorAll('.program-row')]
    .filter((row) => row !== excludeRow)
    .map((row) => row.querySelector('[data-field="targetId"]').value)
    .filter(Boolean));
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
  const duplicateIds = new Set(duplicateTargetIdsFromPrograms(groupTargetsByProgram(targets)));
  return targets
    .filter((target) => duplicateIds.has(target.targetId))
    .map((target) => lookups().targetName(target.programId, target.targetId))
    .filter((name, index, list) => list.indexOf(name) === index);
}

function targetKey(programId, targetId) {
  return programId && targetId ? `${programId}:${targetId}` : "";
}

function refreshBehaviorAvailability() {
  [...behaviorList.querySelectorAll(".behavior-row")].forEach((row) => {
    syncBehaviorOptions(row, row.querySelector('[data-field="behaviorId"]').value);
  });
}

function selectedBehaviorIds(container = behaviorList, excludeRow = null) {
  return new Set([...container.querySelectorAll('.behavior-row')]
    .filter((row) => row !== excludeRow)
    .map((row) => row.querySelector('[data-field="behaviorId"]').value)
    .filter(Boolean));
}

function selectedBehaviorKeys(container = behaviorList) {
  return new Set([...container.querySelectorAll(".behavior-row")]
    .map((row) => row.querySelector('[data-field="behaviorId"]').value)
    .filter(Boolean));
}

function duplicateBehaviorNames(behaviors) {
  const duplicateIds = new Set(duplicateBehaviorIds(behaviors));
  return behaviors
    .filter((behavior) => duplicateIds.has(behavior.behaviorId))
    .map((behavior) => lookups().behaviorName(behavior.behaviorId))
    .filter((name, index, list) => list.indexOf(name) === index);
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

function assessmentDocumentCanRenderInline(document, ref) {
  const contentType = String(document?.contentType || document?.mimeType || ref?.contentType || "").trim().toLowerCase();
  if (contentType.startsWith("image/")) return true;
  const fileName = String(ref?.originalFileName || document?.fileName || "").trim().toLowerCase();
  return [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".heic", ".heif"].some((extension) => fileName.endsWith(extension));
}

function reportFilePreview(files, label) {
  const items = Array.isArray(files) ? files : [];
  if (!items.length) return `<p class="muted">No ${escapeHtml(label.toLowerCase())} uploaded.</p>`;
  return `
    <div class="report-upload-preview-list">
      ${items.map((ref) => {
        const document = currentClientDocumentById(ref.fileId);
        const fileName = escapeHtml(ref.originalFileName || label);
        if (!document) {
          return `<p class="muted"><strong>${escapeHtml(label)}:</strong> ${fileName} (stored file reference missing)</p>`;
        }
        if (assessmentDocumentCanRenderInline(document, ref)) {
          return `
            <figure class="report-upload-preview">
              <img src="${escapeHtml(document.url)}" alt="${fileName}">
              <figcaption>
                <strong>${escapeHtml(label)} uploaded:</strong>
                <a href="${escapeHtml(document.url)}" target="_blank" rel="noopener">${fileName}</a>
              </figcaption>
            </figure>
          `;
        }
        return `
          <p>
            <strong>${escapeHtml(label)} uploaded:</strong>
            <a href="${escapeHtml(document.url)}" target="_blank" rel="noopener">${fileName}</a>
          </p>
        `;
      }).join("")}
    </div>
  `;
}

function safeReportFilePreview(fieldName, label) {
  try {
    return reportFilePreview(reportAssessmentRefs(fieldName), label);
  } catch (error) {
    console.error("Report assessment attachment preview failed", {
      fieldName,
      message: error?.message || String(error)
    });
    return `<p class="muted"><strong>${escapeHtml(label)}:</strong> One uploaded assessment document could not be loaded.</p>`;
  }
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
    ["Maladaptive Behaviors", parseNumberedObjectives(values.get("dischargeMaladaptiveBehaviors"))],
    ["Communication", parseNumberedObjectives(values.get("dischargeCommunication"))],
    ["Socialization", parseNumberedObjectives(values.get("dischargeSocialization"))],
    ["Adaptive", parseNumberedObjectives(values.get("dischargeAdaptive"))],
    ["Executive functioning", parseNumberedObjectives(values.get("dischargeExecutive"))]
  ].filter(([, objectives]) => objectives.length);

  return `
    ${reportParagraph(values.get("dischargeCriteria") || defaultDischargeCriteria())}
    <p>Long-term objectives or goals for discharge:</p>
    ${objectiveItems.length ? `
      <div class="discharge-objective-groups">
        ${objectiveItems.map(([label, objectives]) => `
          <section class="discharge-objective-group">
            <h4>${escapeHtml(label)}</h4>
            <ol class="discharge-objective-list">
              ${objectives.map((objective) => `
                <li>${escapeHtml(objective)}</li>
              `).join("")}
            </ol>
          </section>
        `).join("")}
      </div>
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
