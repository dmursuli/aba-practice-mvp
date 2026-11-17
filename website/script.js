const navToggle = document.querySelector(".nav-toggle");
const siteNav = document.querySelector("#site-nav");
const consultationForm = document.querySelector("#consultation-form");
const formStatus = document.querySelector("#form-status");

navToggle?.addEventListener("click", () => {
  const isOpen = siteNav.classList.toggle("open");
  navToggle.setAttribute("aria-expanded", String(isOpen));
  navToggle.setAttribute("aria-label", isOpen ? "Close navigation" : "Open navigation");
});

siteNav?.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", () => {
    siteNav.classList.remove("open");
    navToggle?.setAttribute("aria-expanded", "false");
    navToggle?.setAttribute("aria-label", "Open navigation");
  });
});

if (consultationForm && formStatus) {
  const submitButton = consultationForm.querySelector('button[type="submit"]');
  const phone = consultationForm.elements.namedItem("phone");
  const caregiverName = consultationForm.elements.namedItem("name");
  const landingParams = new URLSearchParams(window.location.search);
  let submitting = false;
  let submitted = false;

  // Capture campaign labels only, in memory. Never copy arbitrary URLs or contact
  // values into attribution, analytics, browser storage, or navigation URLs.
  const attribution = {};
  for (const key of ["utm_source", "utm_medium", "utm_campaign"]) {
    const value = (landingParams.get(key) || "").trim();
    attribution[key] = /^[a-z0-9][a-z0-9 _-]{0,99}$/i.test(value)
      && !/(?:\d[\s-]*){7}/.test(value) ? value : "";
  }
  // This site's only landing page is the homepage. Drop all query/hash/path data.
  attribution.landing_page = "https://triumphbehavioral.com/";
  const populateAttribution = () => {
    for (const [key, value] of Object.entries(attribution)) {
      consultationForm.elements.namedItem(key).value = value;
    }
  };
  populateAttribution();
  submitButton.disabled = false;

  const validateContact = () => {
    caregiverName.setCustomValidity(caregiverName.value.trim() ? "" : "Enter your name.");
    const digits = phone.value.replace(/\D/g, "");
    phone.setCustomValidity(digits.length >= 7 && digits.length <= 15
      ? "" : "Enter a phone number with 7 to 15 digits.");
  };
  phone.addEventListener("input", validateContact);
  caregiverName.addEventListener("input", validateContact);

  consultationForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submitting || submitted) return;
    validateContact();
    if (!consultationForm.reportValidity()) return;
    if (consultationForm.elements.namedItem("bot-field").value) {
      formStatus.textContent = "Unable to send this request. Please call (786) 223-7310 for assistance.";
      formStatus.focus({ preventScroll: true });
      return;
    }
    if (!/^https?:$/.test(window.location.protocol)) {
      formStatus.textContent = "This preview cannot send requests. Please use triumphbehavioral.com or call (786) 223-7310.";
      return;
    }

    populateAttribution();
    consultationForm.elements.namedItem("submitted_at").value = new Date().toISOString();
    const body = new URLSearchParams(new FormData(consultationForm)).toString();
    submitting = true;
    submitButton.disabled = true;
    submitButton.textContent = "Sending...";
    consultationForm.setAttribute("aria-busy", "true");
    formStatus.textContent = "Sending your request...";
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20000);

    try {
      const response = await fetch("/", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        signal: controller.signal,
        credentials: "omit",
        referrerPolicy: "no-referrer"
      });
      if (!response.ok) throw new Error("Submission rejected");
      // An unconfigured static host may return the homepage with HTTP 200.
      const responseText = await response.text();
      if (responseText.includes('id="consultation-form"')) throw new Error("Form endpoint unavailable");
      submitted = true;
      consultationForm.reset();
      submitButton.textContent = "Request sent";
      formStatus.textContent = "Thank you. Your request has been sent. Triumph Behavioral Care will follow up using your preferred contact method.";
    } catch {
      formStatus.textContent = "We could not confirm your request was received. Your entries are still here. Please try again, or call (786) 223-7310 if you are unsure whether it went through.";
      submitButton.textContent = "Send request";
    } finally {
      window.clearTimeout(timeout);
      submitting = false;
      submitButton.disabled = submitted;
      consultationForm.removeAttribute("aria-busy");
      formStatus.focus({ preventScroll: true });
    }
  });
}
