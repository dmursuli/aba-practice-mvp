const navToggle = document.querySelector(".nav-toggle");
const siteNav = document.querySelector("#site-nav");
const consultationForm = document.querySelector("#consultation-form");
const formStatus = document.querySelector("#form-status");

navToggle?.addEventListener("click", () => {
  const isOpen = siteNav.classList.toggle("open");
  navToggle.setAttribute("aria-expanded", String(isOpen));
});

siteNav?.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", () => {
    siteNav.classList.remove("open");
    navToggle?.setAttribute("aria-expanded", "false");
  });
});

consultationForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(consultationForm);
  const body = [
    `Name: ${data.get("name") || ""}`,
    `Email: ${data.get("email") || ""}`,
    `Phone: ${data.get("phone") || ""}`,
    `Service interest: ${data.get("service") || ""}`,
    `Privacy acknowledgment: ${data.get("privacyAcknowledgment") ? "Yes" : "No"}`,
    "",
    "Note:",
    data.get("message") || ""
  ].join("\n");
  const href = `mailto:dmursuli@triumphbehavioral.com?subject=${encodeURIComponent("Consultation request")}&body=${encodeURIComponent(body)}`;
  formStatus.textContent = "Opening your email app with the consultation details.";
  window.location.href = href;
});
