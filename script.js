/* =========================================================
   Food Rescue - script.js
   Vanilla JavaScript. Data is saved ONLY in this browser
   using localStorage (demo data, no backend, no sync).

   Honesty rules built into this file:
   - Nothing is ever shown as "Verified" unless a real verification
     service (CONFIG.verificationApiUrl) returns that result.
   - OTP codes are not simulated: without an OTP service the UI says so.
   - Sample listings are labelled as samples; impact figures are demo data.
   ========================================================= */

(() => {
  "use strict";

  /* =========================================================
     Configuration
     ========================================================= */
  const CONFIG = {
    // Leave empty to run the clearly-labelled demo workflow (everything stays "Pending Review").
    // To connect a real verification backend, set this to its URL. The backend must accept a JSON POST
    // {method, details} and answer {status: "verified" | "pending"}. Only a "verified" answer from that
    // service will ever display the green "Verified" badge. Documents need a backend to be stored
    // and reviewed; this front end only sends text details, never file contents.
    verificationApiUrl: "",
    // Rough planning assumption used for the "food waste prevented" estimate when a donation was
    // not entered in kg or litres.
    kgPerMeal: 0.4
  };

  /* ---------- Constants ---------- */
  const KEYS = {
    listings: "foodRescue.listings.v2",
    legacy: "foodRescue.listings.v1",
    account: "foodRescue.account.v1"
  };
  const STATUS = { AVAILABLE: "Available", RESERVED: "Reserved", PICKED: "Picked Up" };
  const MIN = 60 * 1000;
  const HOUR = 60 * MIN;
  const ROOM_TEMP_LIMIT = 4 * HOUR; // cooked food at room temperature: max 4 hours (general guidance)

  const CATEGORY_ART = {
    "Cooked Meals": "🍛", "Bakery & Snacks": "🥐", "Fruits & Vegetables": "🥦",
    "Packaged Food": "📦", "Dairy & Beverages": "🥛"
  };
  const CONDITION_LABELS = {
    hot: "Freshly cooked (hot)", cooled: "Cooked and cooled", sealed: "Packaged and sealed",
    produce: "Fresh produce (uncut)", dry: "Baked or dry food"
  };
  const STORAGE_LABELS = {
    hot: "Hot-held (above 60°C)", chilled: "Refrigerated (below 5°C)", room: "Room temperature", frozen: "Frozen"
  };
  const COOKED = ["hot", "cooled"];

  // Verification badge styles. "verified" can only come from a real service; "demo" is for sample data only.
  const V_STATUS = {
    verified: { label: "Verified", cls: "v-verified", icon: "shield-check", tip: "Confirmed by a connected verification service." },
    pending: { label: "Pending Review", cls: "v-pending", icon: "clock", tip: "Details submitted. Not yet verified." },
    required: { label: "Verification Required", cls: "v-required", icon: "alert-triangle", tip: "This donor has not submitted verification details." },
    demo: { label: "Demo Verification", cls: "v-demo", icon: "info", tip: "Sample data only. This is not an official verification." },
    none: { label: "Not started", cls: "v-none", icon: "info", tip: "No details submitted yet." }
  };

  // The five verification methods shown on the page and in the dialog. All of them are compulsory for donors.
  const METHODS = [
    { id: "fssai", title: "FSSAI licence", icon: "file-text", desc: "Licence or registration number and business name." },
    { id: "identity", title: "Identity", icon: "id-card", desc: "Government photo ID for the person or owner." },
    { id: "contact", title: "Phone / email", icon: "smartphone", desc: "Contact check with a one-time code (needs an OTP service)." },
    { id: "address", title: "Address", icon: "home", desc: "Address with a proof document." },
    { id: "documents", title: "Licences & certificates", icon: "upload", desc: "Other licences and certificates for review." }
  ];

  const ALLOWED_DOC_TYPES = ["application/pdf", "image/jpeg", "image/png"];
  const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
  const MAX_FILE_BYTES = 5 * 1024 * 1024;

  // Old sample donors from the first version of the site. Their listings are not carried over on migration.
  const LEGACY_SAMPLE_DONORS = ["Sunrise Engineering College", "Golden Crust Bakery", "Green Basket Fresh",
    "Sharma Wedding Reception", "Boys Hostel 2 Mess", "Fresh Mart", "Spandan Tech Fest Committee", "Cafe Brew"];

  /* ---------- State ---------- */
  let listings = [];
  let account = loadAccount();
  let pendingImage = "";   // compressed data URL of the photo chosen in the donate form
  let imageBusy = false;   // true while a photo is being processed
  let resumeAfterVerify = false; // true when the verify dialog was opened because a donation was blocked
  let impactSeen = false;  // dashboard numbers count up once it scrolls into view
  const filters = { search: "", category: "all", location: "", status: "all" };

  /* ---------- DOM references ---------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const form = $("#donateForm");
  const submitBtn = $("#submitBtn");
  const listingsEl = $("#listings");
  const emptyState = $("#emptyState");
  const resultCount = $("#resultCount");
  const toastContainer = $("#toastContainer");
  const verifyDialog = $("#verifyDialog");
  const requestDialog = $("#requestDialog");
  const requestForm = $("#requestForm");
  const acctName = $("#acctName");

  /* =========================================================
     Reusable helpers / small components
     ========================================================= */

  const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  /** Escape user text before inserting into HTML (safe for text and attribute contexts). */
  function escapeHTML(str) {
    return String(str ?? "").replace(/[&<>"']/g, (c) => ESC[c]);
  }

  /** Inline SVG icon from the sprite in index.html. */
  function icon(name) {
    return `<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-${name}"></use></svg>`;
  }

  /** Verification badge component. */
  function vBadge(status) {
    const s = V_STATUS[status] || V_STATUS.required;
    return `<span class="vbadge ${s.cls}" title="${escapeHTML(s.tip)}">${icon(s.icon)}${s.label}</span>`;
  }

  /** Create a reasonably unique id. */
  function makeId() {
    return "fr-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
  }

  /** Date -> "YYYY-MM-DDTHH:MM" for datetime-local inputs (local time). */
  function toLocalInputValue(date) {
    const offsetMs = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
  }

  /** Human readable date/time, e.g. "Tue, 20 Oct, 9:30 pm". */
  function formatDateTime(iso) {
    return new Date(iso).toLocaleString(undefined, {
      weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit"
    });
  }

  /** Friendly "time left" text such as "2h 15m left". */
  function timeLeft(iso) {
    const diff = new Date(iso).getTime() - Date.now();
    if (diff <= 0) return "deadline passed";
    const mins = Math.floor(diff / MIN);
    const days = Math.floor(mins / 1440);
    const hrs = Math.floor((mins % 1440) / 60);
    const m = mins % 60;
    if (days > 0) return `${days}d ${hrs}h left`;
    if (hrs > 0) return `${hrs}h ${m}m left`;
    return `${m}m left`;
  }

  /** A listing is expired when it was never collected and its pickup deadline or use-by time has passed. */
  function isExpired(item) {
    if (item.status === STATUS.PICKED) return false;
    const now = Date.now();
    return new Date(item.deadline).getTime() <= now || new Date(item.expiresAt).getTime() <= now;
  }

  /** True when a listing can still be requested or collected. */
  function isOpen(item) {
    return item.status !== STATUS.PICKED && !isExpired(item);
  }

  /* =========================================================
     Toast notifications
     ========================================================= */

  /** Show a temporary success / error / info message. */
  function showToast(message, type = "success") {
    const toast = document.createElement("div");
    toast.className = `toast ${type === "success" ? "" : type}`.trim();
    toast.setAttribute("role", type === "error" ? "alert" : "status");
    const iconName = type === "error" ? "alert-triangle" : type === "info" ? "info" : "check-circle";
    toast.innerHTML = `${icon(iconName)}<span class="toast-msg"></span>
      <button type="button" aria-label="Dismiss notification">×</button>`;
    toast.querySelector(".toast-msg").textContent = message; // textContent keeps it safe

    const remove = () => {
      toast.classList.add("hide");
      setTimeout(() => toast.remove(), 300);
    };
    toast.querySelector("button").addEventListener("click", remove);
    toastContainer.appendChild(toast);
    setTimeout(remove, 5000);
    while (toastContainer.children.length > 4) toastContainer.firstElementChild.remove();
  }

  /* =========================================================
     Form field errors (shared by every form)
     ========================================================= */

  /** Show or clear the error message inside the .field that contains `el`. */
  function setError(el, message) {
    if (!el) return;
    const field = el.closest(".field");
    const errorEl = field && field.querySelector(".error");
    if (errorEl) errorEl.textContent = message || "";
    if (message) {
      if (el.matches("input, select, textarea")) el.setAttribute("aria-invalid", "true");
    } else if (field) {
      // Clearing an error clears every control in the group (radio buttons, checkboxes, quantity + unit)
      $$("input, select, textarea", field).forEach((i) => i.removeAttribute("aria-invalid"));
    }
  }

  /** Collects validation results; remembers the first invalid control so it can be focused. */
  function makeChecker() {
    let first = null;
    return {
      fail(el, msg) { setError(el, msg); first = first || el; },
      pass(el) { setError(el, ""); },
      get first() { return first; }
    };
  }

  /** Link every error message to its inputs for screen readers. */
  function wireErrorAccessibility() {
    $$(".field").forEach((field, i) => {
      const err = field.querySelector(".error");
      if (!err) return;
      if (!err.id) err.id = `field-error-${i}`;
      err.setAttribute("aria-live", "polite");
      $$("input, select, textarea", field).forEach((inp) => inp.setAttribute("aria-describedby", err.id));
    });
  }

  /** Clear an error as soon as the user edits the control. */
  function clearErrorOnInput(root) {
    $$("input, select, textarea", root).forEach((el) => {
      const clear = () => {
        const field = el.closest(".field");
        const err = field && field.querySelector(".error");
        if (err && err.textContent) setError(el, "");
      };
      el.addEventListener("input", clear);
      el.addEventListener("change", clear);
    });
  }

  /** Validate chosen files (type, size, count). Returns file names, or [] and sets an error. */
  function checkFiles(c, input, { required = true, max = 3 } = {}) {
    const files = [...input.files];
    if (!files.length) {
      if (required) c.fail(input, "Please choose a file to upload."); else c.pass(input);
      return [];
    }
    if (files.length > max) { c.fail(input, `Please choose at most ${max} files.`); return []; }
    for (const file of files) {
      if (!ALLOWED_DOC_TYPES.includes(file.type)) { c.fail(input, `"${file.name}" is not a PDF, JPG or PNG file.`); return []; }
      if (file.size > MAX_FILE_BYTES) { c.fail(input, `"${file.name}" is larger than 5 MB.`); return []; }
    }
    c.pass(input);
    return files.map((f) => f.name);
  }

  /* =========================================================
     Account / verification state (localStorage)
     ========================================================= */

  /** Load the donor/NGO account that lives in this browser. */
  function loadAccount() {
    try {
      const raw = localStorage.getItem(KEYS.account);
      if (raw) {
        const a = JSON.parse(raw);
        if (a && typeof a.id === "string" && a.methods && typeof a.methods === "object") {
          return { id: a.id, name: String(a.name || ""), methods: a.methods };
        }
      }
    } catch (err) { console.error("Could not read account:", err); }
    return { id: makeId(), name: "", methods: {} };
  }

  function saveAccount() {
    try {
      localStorage.setItem(KEYS.account, JSON.stringify(account));
      return true;
    } catch (err) {
      console.error("Could not save account:", err);
      showToast("Could not save in this browser. Your details may be lost on refresh.", "error");
      return false;
    }
  }

  /** Status of one method: verified | pending | none. */
  function methodStatus(id) {
    const m = account.methods[id];
    return m && (m.status === "verified" || m.status === "pending") ? m.status : "none";
  }

  /** Overall account status. "verified" only when a real service confirmed every method. */
  function accountStatus() {
    if (METHODS.every((m) => methodStatus(m.id) === "verified")) return "verified";
    if (METHODS.some((m) => methodStatus(m.id) !== "none")) return "pending";
    return "required";
  }

  /** Methods the donor has not submitted yet. */
  function missingMethods() {
    return METHODS.filter((m) => methodStatus(m.id) === "none");
  }

  /** Verification status to show on a listing's donor badge. */
  function listingVerification(item) {
    if (item.donorId && item.donorId === account.id) return accountStatus(); // your own listings follow your account
    return item.verification || "required";
  }

  /** Verification is mandatory: a donor must have submitted ALL methods (pending or verified) before listing food. */
  function hasSubmittedVerification() {
    return missingMethods().length === 0;
  }

  /**
   * Send details to the verification backend, if one is configured.
   * Without a backend the result is always "pending" (never fake-verified).
   */
  async function submitToVerificationService(method, details) {
    if (!CONFIG.verificationApiUrl) return { status: "pending", source: "demo" };
    const res = await fetch(CONFIG.verificationApiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method, details })
    });
    if (!res.ok) throw new Error("Verification service error " + res.status);
    const data = await res.json();
    return { status: data && data.status === "verified" ? "verified" : "pending", source: "service" };
  }

  /* =========================================================
     Listings storage + sample data
     ========================================================= */

  function saveListings() {
    try {
      localStorage.setItem(KEYS.listings, JSON.stringify(listings));
      return true;
    } catch (err) {
      console.error("Could not save to localStorage:", err);
      showToast("Could not save data in this browser (storage may be full). Changes may be lost on refresh.", "error");
      return false;
    }
  }

  /** Basic shape check so corrupted storage cannot break the page. */
  function isValidListing(x) {
    return x && typeof x === "object"
      && typeof x.id === "string" && typeof x.name === "string"
      && typeof x.category === "string" && typeof x.location === "string" && typeof x.donor === "string"
      && Number.isFinite(Number(x.servings))
      && !Number.isNaN(new Date(x.deadline).getTime())
      && !Number.isNaN(new Date(x.expiresAt).getTime())
      && Object.values(STATUS).includes(x.status);
  }

  /** Fill in any missing optional fields. */
  function normalizeListing(x) {
    return {
      diet: "", quantityAmount: Number(x.servings), quantityUnit: "portions", condition: "", storage: "",
      notes: "", image: "", reservedBy: "", reservedOrg: "", donorId: null, verification: "required",
      sample: false, createdAt: Date.now(), preparedAt: x.createdAt ? new Date(x.createdAt).toISOString() : new Date().toISOString(),
      ...x,
      servings: Number(x.servings),
      quantityAmount: Number(x.quantityAmount ?? x.servings)
    };
  }

  /** Bring listings saved by the first version of the site (v1) into the new format. */
  function migrateLegacyListings() {
    try {
      const raw = localStorage.getItem(KEYS.legacy);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      return arr
        .filter((x) => x && typeof x.id === "string" && typeof x.name === "string" && !LEGACY_SAMPLE_DONORS.includes(x.donor))
        .map((x) => ({
          id: x.id, name: x.name, category: x.category, location: x.location, donor: x.donor,
          servings: Number(x.quantity) || 1, quantityAmount: Number(x.quantity) || 1, quantityUnit: "portions",
          deadline: x.deadline, expiresAt: x.deadline, notes: x.notes || "", status: x.status,
          createdAt: x.createdAt || Date.now()
        }))
        .filter(isValidListing)
        .map(normalizeListing);
    } catch (err) {
      console.error("Could not migrate old data:", err);
      return [];
    }
  }

  /** Load listings; first visit (or bad data) starts from the sample listings. */
  function loadListings() {
    try {
      const raw = localStorage.getItem(KEYS.listings);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          listings = parsed.filter(isValidListing).map(normalizeListing);
          return;
        }
      }
    } catch (err) {
      console.error("Could not read localStorage:", err);
    }
    listings = [...migrateLegacyListings(), ...getSampleData()];
    saveListings();
  }

  /** Fictional sample listings, labelled as samples. Times are relative to "now" so the demo never starts expired. */
  function getSampleData() {
    const now = Date.now();
    const at = (h) => new Date(now + h * HOUR).toISOString();
    const s = (o) => normalizeListing({
      id: makeId(), diet: "veg", quantityUnit: "portions", condition: "hot", storage: "hot",
      notes: "", image: "", status: STATUS.AVAILABLE, reservedBy: "", reservedOrg: "",
      sample: true, createdAt: now, ...o
    });
    return [
      s({ name: "Veg Biryani & Raita", category: "Cooked Meals", servings: 60, quantityAmount: 18, quantityUnit: "kg",
        preparedAt: at(-1), expiresAt: at(4), deadline: at(3), location: "Central Canteen, Engineering Block, Tilak Road",
        donor: "Sunrise Engineering College", donorId: "sample-1", verification: "demo", notes: "Packed in steel containers. Contains dairy." }),
      s({ name: "Chicken Curry & Rice", category: "Cooked Meals", diet: "nonveg", servings: 40, quantityAmount: 10, quantityUnit: "kg",
        preparedAt: at(-1), expiresAt: at(3), deadline: at(2), location: "Spice Route Canteen, Ring Road",
        donor: "Spice Route Canteen", donorId: "sample-7", verification: "demo", notes: "Keep hot until pickup. Bring covered containers." }),
      s({ name: "Assorted Bread & Buns", category: "Bakery & Snacks", servings: 35, quantityAmount: 35, quantityUnit: "packets",
        condition: "dry", storage: "room", preparedAt: at(-8), expiresAt: at(30), deadline: at(5),
        location: "Golden Crust Bakery, Market Square", donor: "Golden Crust Bakery", donorId: "sample-2", verification: "demo",
        notes: "End-of-day stock, baked this morning. Contains gluten and egg." }),
      s({ name: "Seasonal Fruit Boxes", category: "Fruits & Vegetables", servings: 45, quantityAmount: 14, quantityUnit: "kg",
        condition: "produce", storage: "room", preparedAt: at(-6), expiresAt: at(72), deadline: at(20),
        location: "Green Basket Store, Station Road", donor: "Green Basket Fresh", donorId: "sample-3", verification: "pending",
        notes: "Bananas and apples. Bring crates if possible." }),
      s({ name: "Dal, Rice & Mixed Veg", category: "Cooked Meals", servings: 120, quantityAmount: 30, quantityUnit: "kg",
        preparedAt: at(-2), expiresAt: at(3), deadline: at(2), location: "Community Hall, Rose Garden Colony",
        donor: "Sharma Wedding Reception", donorId: "sample-4", verification: "required",
        notes: "Large quantity. Vehicle recommended.", status: STATUS.RESERVED,
        reservedBy: "Meera K. (sample)", reservedOrg: "Ward 12 Community Kitchen" }),
      s({ name: "Packed Snack Packets", category: "Packaged Food", servings: 80, quantityAmount: 80, quantityUnit: "packets",
        condition: "sealed", storage: "room", preparedAt: at(-72), expiresAt: at(2200), deadline: at(30),
        location: "Hostel Mess, Boys Hostel 2, University Campus", donor: "Boys Hostel 2 Mess", donorId: "sample-5", verification: "pending",
        notes: "Sealed packets, best before in about 3 months." }),
      s({ name: "Milk Cartons & Juice", category: "Dairy & Beverages", servings: 50, quantityAmount: 25, quantityUnit: "litres",
        condition: "sealed", storage: "chilled", preparedAt: at(-10), expiresAt: at(24), deadline: at(8),
        location: "Fresh Mart Dairy Counter, Civil Lines", donor: "Fresh Mart", donorId: "sample-6", verification: "demo",
        notes: "Keep refrigerated. Use within 24 hours." }),
      s({ name: "Chapati & Paneer Curry", category: "Cooked Meals", servings: 70, quantityAmount: 70, quantityUnit: "portions",
        preparedAt: at(-6), expiresAt: at(-1), deadline: at(-1), location: "Tech Fest Food Court, Sports Ground",
        donor: "Spandan Tech Fest Committee", donorId: "sample-8", verification: "demo", notes: "Collected by volunteers last night.",
        status: STATUS.PICKED, reservedBy: "Rohan S. (sample)", reservedOrg: "Evening Shelter Volunteers", createdAt: now - 6 * HOUR }),
      s({ name: "Sandwiches & Wraps", category: "Bakery & Snacks", servings: 40, quantityAmount: 40, quantityUnit: "packets",
        condition: "sealed", storage: "chilled", preparedAt: at(-12), expiresAt: at(-3), deadline: at(-3),
        location: "Cafe Brew, Main Market", donor: "Cafe Brew", donorId: "sample-9", verification: "demo",
        notes: "Delivered to a nearby shelter.", status: STATUS.PICKED, reservedBy: "Anita D. (sample)",
        reservedOrg: "Hostel Welfare Group", createdAt: now - 10 * HOUR })
    ];
  }

  /* =========================================================
     Impact dashboard
     ========================================================= */

  /** Estimated kg of food for a collected listing (uses entered kg/litres, otherwise an assumption). */
  function wasteKgFor(item) {
    if (item.quantityUnit === "kg" || item.quantityUnit === "litres") return item.quantityAmount;
    return item.servings * CONFIG.kgPerMeal;
  }

  /** Compute every dashboard number from the current listings. */
  function computeStats() {
    const picked = listings.filter((l) => l.status === STATUS.PICKED);
    const active = listings.filter(isOpen);

    // Donor key: the account id when known, otherwise the donor name.
    const donors = new Map();
    active.forEach((l) => donors.set(l.donorId || l.donor.toLowerCase(), listingVerification(l)));
    const verifiedDonors = [...donors.values()].filter((v) => v === "verified").length;

    const communities = new Set(
      listings.filter((l) => l.status !== STATUS.AVAILABLE && l.reservedOrg.trim())
        .map((l) => l.reservedOrg.trim().toLowerCase())
    );

    return {
      active: active.length,
      mealsRescued: picked.reduce((sum, l) => sum + l.servings, 0),
      completed: picked.length,
      wasteKg: Math.round(picked.reduce((sum, l) => sum + wasteKgFor(l), 0)),
      donors: donors.size,
      verifiedDonors,
      communities: communities.size
    };
  }

  /** Smoothly count a number from its previous value to the new one. */
  function animateNumber(el, to) {
    const from = Number(el.dataset.value || 0);
    el.dataset.value = to;
    if (from === to || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.textContent = to.toLocaleString();
      return;
    }
    const duration = 900;
    const start = performance.now();
    const step = (now) => {
      const p = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(from + (to - from) * eased).toLocaleString();
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /** Push the latest numbers into every [data-stat] element. The dashboard waits until it is on screen. */
  function updateStats() {
    const stats = computeStats();
    $$("[data-stat]").forEach((el) => {
      if (el.closest("#impact") && !impactSeen) return;
      animateNumber(el, stats[el.dataset.stat] ?? 0);
    });
    const sub = $("#donorsSub");
    if (sub) {
      const other = stats.donors - stats.verifiedDonors;
      sub.textContent = stats.donors ? `${stats.verifiedDonors} officially verified · ${other} demo or pending` : "";
    }
  }

  /* =========================================================
     Rendering: Find Food
     ========================================================= */

  /** Listings that match search text, category, location and availability filters, sorted sensibly. */
  function getVisibleListings() {
    const q = filters.search.trim().toLowerCase();
    const loc = filters.location.trim().toLowerCase();

    return listings
      .filter((l) => {
        const matchesSearch = !q || [l.name, l.location, l.donor, l.category, l.notes]
          .some((field) => field.toLowerCase().includes(q));
        const matchesCategory = filters.category === "all" || l.category === filters.category;
        const matchesLocation = !loc || l.location.toLowerCase().includes(loc);
        let matchesStatus = true;
        if (filters.status === "soon") {
          matchesStatus = isOpen(l) && new Date(l.deadline).getTime() - Date.now() <= 3 * HOUR;
        } else if (filters.status !== "all") {
          matchesStatus = l.status === filters.status;
        }
        return matchesSearch && matchesCategory && matchesLocation && matchesStatus;
      })
      .sort((a, b) => {
        // Open listings first (soonest deadline first), then expired, then completed.
        const rank = (l) => (l.status === STATUS.PICKED ? 2 : isExpired(l) ? 1 : 0);
        if (rank(a) !== rank(b)) return rank(a) - rank(b);
        return new Date(a.deadline) - new Date(b.deadline);
      });
  }

  /** Availability badge for a listing. */
  function getBadge(item) {
    if (item.status === STATUS.PICKED) return { text: "Picked Up", cls: "badge-picked" };
    if (isExpired(item)) return { text: "Expired", cls: "badge-expired" };
    if (item.status === STATUS.RESERVED) return { text: "Reserved", cls: "badge-reserved" };
    return { text: "Available", cls: "badge-available" };
  }

  /** Action button for each state (disabled buttons prevent invalid or repeated actions). */
  function getActionButton(item) {
    if (item.status === STATUS.PICKED) return `<button class="btn btn-done" type="button" disabled>${icon("check-circle")} Picked Up</button>`;
    if (isExpired(item)) return `<button class="btn btn-done" type="button" disabled>Pickup window closed</button>`;
    if (item.status === STATUS.AVAILABLE) {
      return `<button class="btn btn-primary" type="button" data-action="reserve" data-id="${escapeHTML(item.id)}">Request Food</button>`;
    }
    return `<button class="btn btn-reserved" type="button" data-action="pickup" data-id="${escapeHTML(item.id)}">Mark as Picked Up</button>`;
  }

  /** One food donation card. */
  function renderCard(item) {
    const badge = getBadge(item);
    const done = item.status === STATUS.PICKED || isExpired(item);
    const hasPhoto = typeof item.image === "string" && item.image.startsWith("data:image/");
    const media = hasPhoto
      ? `<img src="${escapeHTML(item.image)}" alt="Photo of ${escapeHTML(item.name)}" loading="lazy" />`
      : `<span class="media-art" aria-hidden="true">${CATEGORY_ART[item.category] || "🍽️"}</span>`;
    const dietMark = item.diet
      ? `<span class="veg-mark ${item.diet === "nonveg" ? "nonveg" : "veg"}" role="img" aria-label="${item.diet === "nonveg" ? "Non-vegetarian" : "Vegetarian"}"></span>`
      : "";
    const left = item.status === STATUS.PICKED ? "" : ` · ${escapeHTML(timeLeft(item.deadline))}`;
    const urgent = isOpen(item) && new Date(item.deadline).getTime() - Date.now() <= 3 * HOUR ? "urgent" : "";
    const chips = [CONDITION_LABELS[item.condition], STORAGE_LABELS[item.storage]].filter(Boolean)
      .map((t) => `<span class="chip">${escapeHTML(t)}</span>`).join("");

    return `
      <article class="food-card ${done ? "is-done" : ""}">
        <div class="card-media">
          ${media}
          <span class="card-cat">${escapeHTML(item.category)}</span>
          <span class="badge ${badge.cls}">${badge.text}</span>
          ${item.sample ? '<span class="sample-tag">Sample listing</span>' : ""}
        </div>
        <div class="card-body">
          <h3>${dietMark}<span>${escapeHTML(item.name)}</span></h3>
          <p class="serve"><strong>${item.servings.toLocaleString()}</strong> servings · ${escapeHTML(item.quantityAmount)} ${escapeHTML(item.quantityUnit)}</p>
          <ul class="meta">
            <li>${icon("map-pin")}<span>${escapeHTML(item.location)}</span></li>
            <li>${icon("clock")}<span class="${urgent}">Pickup by ${escapeHTML(formatDateTime(item.deadline))}${left}</span></li>
            <li>${icon("calendar")}<span>Use by ${escapeHTML(formatDateTime(item.expiresAt))}</span></li>
            <li>${icon("user")}<span>${escapeHTML(item.donor)}</span></li>
            <li>${icon("shield")}<span>${vBadge(listingVerification(item))}</span></li>
          </ul>
          ${chips ? `<div class="chips">${chips}</div>` : ""}
          ${item.notes ? `<p class="note">${escapeHTML(item.notes)}</p>` : ""}
          ${item.reservedBy && item.status !== STATUS.AVAILABLE
            ? `<p class="requested-by">Requested by ${escapeHTML(item.reservedBy)}${item.reservedOrg ? " · " + escapeHTML(item.reservedOrg) : ""}</p>` : ""}
          <div class="card-action">${getActionButton(item)}</div>
        </div>
      </article>`;
  }

  /** Re-draw the listing grid, empty state, result count and stats. */
  function render(animate = false) {
    const visible = getVisibleListings();
    listingsEl.classList.toggle("no-anim", !animate);
    listingsEl.innerHTML = visible.map(renderCard).join("");
    emptyState.hidden = visible.length > 0;
    listingsEl.hidden = visible.length === 0;

    if (!visible.length) {
      const none = listings.length === 0;
      $("#emptyTitle").textContent = none ? "No food has been listed yet" : "No matching food right now";
      $("#emptyText").textContent = none
        ? "Be the first to donate surplus food. It only takes a minute."
        : "Try a different search or filter, or donate some food to get things started.";
      $("#clearFilters").hidden = none;
    }
    resultCount.textContent = visible.length
      ? `Showing ${visible.length} of ${listings.length} listing${listings.length === 1 ? "" : "s"}`
      : "";
    updateStats();
  }

  /* =========================================================
     Request food / pickup status (Available -> Reserved -> Picked Up)
     ========================================================= */

  /** Open the request dialog for an available listing. */
  function openRequestDialog(id) {
    const item = listings.find((l) => l.id === id);
    if (!item) { showToast("That listing no longer exists.", "error"); render(); return; }
    if (item.status !== STATUS.AVAILABLE) { showToast("This food has already been requested.", "info"); render(); return; }
    if (isExpired(item)) { showToast("The pickup deadline has passed for this listing.", "error"); render(); return; }

    requestDialog.dataset.id = id;
    $("#requestFoodName").textContent = `${item.name} · ${item.servings} servings`;
    requestForm.reset();
    $$(".field", requestForm).forEach((f) => setError($("input", f), ""));
    showDialog(requestDialog);
    $("#requesterName").focus();
  }

  /** Reserve a listing for a requester. Guards stop double or invalid requests. */
  function reserveListing(id, name, org) {
    const item = listings.find((l) => l.id === id);
    if (!item) { showToast("That listing no longer exists.", "error"); render(); return false; }
    if (item.status !== STATUS.AVAILABLE) { showToast("This food has already been requested.", "info"); render(); return false; }
    if (isExpired(item)) { showToast("The pickup deadline has passed for this listing.", "error"); render(); return false; }

    item.status = STATUS.RESERVED;
    item.reservedBy = name;
    item.reservedOrg = org;
    saveListings();
    render();
    showToast(`"${item.name}" is now Reserved for ${name}. Please collect it before the pickup deadline.`);
    return true;
  }

  /** Mark a reserved listing as picked up. */
  function markPickedUp(id) {
    const item = listings.find((l) => l.id === id);
    if (!item) { showToast("That listing no longer exists.", "error"); render(); return; }
    if (item.status === STATUS.PICKED) { showToast("This food has already been picked up.", "info"); render(); return; }
    if (isExpired(item)) { showToast("The pickup deadline has passed for this listing.", "error"); render(); return; }
    if (item.status !== STATUS.RESERVED) { showToast("Request this food before marking it as picked up.", "error"); render(); return; }

    item.status = STATUS.PICKED;
    saveListings();
    render();
    showToast(`${item.servings} meals marked as picked up. Thank you!`);
  }

  /** Submit handler for the request dialog. */
  function handleRequestSubmit(e) {
    e.preventDefault();
    const nameEl = $("#requesterName");
    const orgEl = $("#requesterOrg");
    const name = nameEl.value.trim();
    const org = orgEl.value.trim();
    if (name.length < 2) { setError(nameEl, "Please enter your name (at least 2 characters)."); nameEl.focus(); return; }
    setError(nameEl, "");
    if (reserveListing(requestDialog.dataset.id, name, org)) closeDialog(requestDialog);
  }

  /* =========================================================
     Donate form: validation + submission
     ========================================================= */

  /** Keep the date pickers' limits fresh (prepared: not in the future; use-by and pickup: not in the past). */
  function refreshDateLimits() {
    const now = toLocalInputValue(new Date());
    form.elements.preparedAt.max = now;
    form.elements.expiresAt.min = now;
    form.elements.deadline.min = now;
  }

  /**
   * Validate every field, including the food-safety rules:
   * - food must not already be expired
   * - preparation time cannot be in the future
   * - pickup must happen before the use-by time
   * - cooked food at room temperature must be collected within 4 hours of preparation
   * - all three safety statements must be confirmed
   */
  function validateDonation() {
    const f = form.elements;
    const c = makeChecker();
    const v = {
      foodName: f.foodName.value.trim(), category: f.category.value, diet: f.diet.value,
      quantityAmount: f.quantityAmount.value.trim(), quantityUnit: f.quantityUnit.value, servings: f.servings.value.trim(),
      condition: f.condition.value, storage: f.storage.value, preparedAt: f.preparedAt.value, expiresAt: f.expiresAt.value,
      deadline: f.deadline.value, location: f.location.value.trim(), donor: f.donor.value.trim(), notes: f.notes.value.trim()
    };
    const now = Date.now();

    // Food name
    if (!v.foodName) c.fail(f.foodName, "Please enter the food name.");
    else if (v.foodName.length < 2) c.fail(f.foodName, "Food name must be at least 2 characters.");
    else c.pass(f.foodName);

    // Category + diet
    if (!v.category) c.fail(f.category, "Please choose a food category."); else c.pass(f.category);
    if (!v.diet) c.fail($("#dietVeg"), "Please mark the food as Veg or Non-Veg."); else c.pass($("#dietVeg"));

    // Quantity (any positive amount) and servings (whole number)
    const amount = Number(v.quantityAmount);
    if (!v.quantityAmount) c.fail(f.quantityAmount, "Please enter the quantity.");
    else if (!Number.isFinite(amount) || amount <= 0) c.fail(f.quantityAmount, "Quantity must be more than 0.");
    else if (amount > 10000) c.fail(f.quantityAmount, "Quantity cannot be more than 10,000.");
    else c.pass(f.quantityAmount);

    const servings = Number(v.servings);
    if (!v.servings) c.fail(f.servings, "Please enter the number of servings.");
    else if (!Number.isInteger(servings)) c.fail(f.servings, "Servings must be a whole number.");
    else if (servings < 1) c.fail(f.servings, "Servings must be at least 1.");
    else if (servings > 5000) c.fail(f.servings, "Servings cannot be more than 5000.");
    else c.pass(f.servings);

    // Condition + storage
    if (!v.condition) c.fail(f.condition, "Please choose the food condition."); else c.pass(f.condition);
    if (!v.storage) c.fail(f.storage, "Please choose how the food is stored."); else c.pass(f.storage);

    // Times
    const prepared = new Date(v.preparedAt).getTime();
    const expires = new Date(v.expiresAt).getTime();
    const deadline = new Date(v.deadline).getTime();

    if (!v.preparedAt) c.fail(f.preparedAt, "Please enter when the food was prepared or packed.");
    else if (Number.isNaN(prepared)) c.fail(f.preparedAt, "That date is not valid.");
    else if (prepared > now + 5 * MIN) c.fail(f.preparedAt, "Preparation time cannot be in the future.");
    else c.pass(f.preparedAt);

    if (!v.expiresAt) c.fail(f.expiresAt, "Please enter the use-by or expiry time.");
    else if (Number.isNaN(expires)) c.fail(f.expiresAt, "That date is not valid.");
    else if (expires <= now) c.fail(f.expiresAt, "This food is already past its use-by time. Expired food cannot be listed.");
    else if (!Number.isNaN(prepared) && expires <= prepared) c.fail(f.expiresAt, "Use-by time must be after the preparation time.");
    else c.pass(f.expiresAt);

    if (!v.deadline) c.fail(f.deadline, "Please choose a pickup deadline.");
    else if (Number.isNaN(deadline)) c.fail(f.deadline, "That date is not valid.");
    else if (deadline <= now) c.fail(f.deadline, "Pickup deadline must be in the future.");
    else if (!Number.isNaN(expires) && deadline > expires) c.fail(f.deadline, "Pickup deadline must be before the food's use-by time.");
    else c.pass(f.deadline);

    // Cooked food at room temperature: 4-hour rule
    if (COOKED.includes(v.condition) && v.storage === "room" && !Number.isNaN(prepared)) {
      const limit = prepared + ROOM_TEMP_LIMIT;
      if (now >= limit) {
        c.fail(f.storage, "Cooked food left at room temperature for more than 4 hours is not safe to donate and cannot be listed.");
      } else if (!Number.isNaN(deadline) && deadline > limit && !f.deadline.hasAttribute("aria-invalid")) {
        c.fail(f.deadline, `Cooked food at room temperature must be collected within 4 hours of preparation (by ${formatDateTime(new Date(limit).toISOString())}).`);
      }
    }

    // Location + donor
    if (!v.location) c.fail(f.location, "Please enter the pickup location.");
    else if (v.location.length < 3) c.fail(f.location, "Location must be at least 3 characters.");
    else c.pass(f.location);

    if (!v.donor) c.fail(f.donor, "Please enter the donor or organisation name.");
    else if (v.donor.length < 2) c.fail(f.donor, "Name must be at least 2 characters.");
    else c.pass(f.donor);

    // Safety confirmation
    const allChecked = ["safetyFresh", "safetyNotServed", "safetyStored"].every((n) => f[n].checked);
    if (!allChecked) c.fail(f.safetyFresh, "Please confirm all three food-safety statements. Unsafe food must not be donated.");
    else c.pass(f.safetyFresh);

    return { valid: !c.first, firstBad: c.first, values: v, times: { prepared, expires, deadline } };
  }

  /** Handle form submit: validate, block duplicates, save, and show the new card. */
  function handleDonate(event) {
    event.preventDefault();
    if (submitBtn.disabled) return; // prevent double submission
    if (imageBusy) { showToast("Your photo is still being processed. Please try again in a moment.", "info"); return; }

    // Mandatory verification gate: no listing until every verification method has been submitted.
    if (!hasSubmittedVerification()) {
      resumeAfterVerify = true;
      const left = missingMethods().length;
      showToast(`Verification is mandatory. Please complete all ${METHODS.length} methods before donating food (${left} left).`, "error");
      openVerifyDialog();
      return;
    }

    refreshDateLimits();
    $("#donateSuccess").hidden = true;
    const { valid, firstBad, values, times } = validateDonation();
    if (!valid) {
      showToast("Please fix the highlighted fields and try again.", "error");
      firstBad.focus();
      return;
    }

    const deadlineISO = new Date(times.deadline).toISOString();
    const duplicate = listings.some((l) =>
      l.status !== STATUS.PICKED &&
      l.name.toLowerCase() === values.foodName.toLowerCase() &&
      l.donor.toLowerCase() === values.donor.toLowerCase() &&
      l.location.toLowerCase() === values.location.toLowerCase() &&
      l.deadline === deadlineISO);
    if (duplicate) { showToast("This exact listing already exists.", "error"); return; }

    submitBtn.disabled = true;
    submitBtn.textContent = "Submitting...";

    const item = normalizeListing({
      id: makeId(),
      name: values.foodName, category: values.category, diet: values.diet,
      quantityAmount: Number(values.quantityAmount), quantityUnit: values.quantityUnit, servings: Number(values.servings),
      condition: values.condition, storage: values.storage,
      preparedAt: new Date(times.prepared).toISOString(), expiresAt: new Date(times.expires).toISOString(), deadline: deadlineISO,
      location: values.location, donor: values.donor, donorId: account.id, notes: values.notes,
      image: pendingImage, status: STATUS.AVAILABLE, sample: false, createdAt: Date.now()
    });

    listings.unshift(item);
    if (!saveListings()) {
      // Most likely storage is full (large photo). Roll back so the page never shows something unsaved.
      listings.shift();
      submitBtn.disabled = false;
      submitBtn.textContent = "Submit Donation";
      return;
    }

    // Remember the donor name for next time (shared with the verification form)
    if (!account.name) { account.name = values.donor; saveAccount(); }

    // Reset filters so the new card is definitely visible, then redraw
    filters.search = ""; filters.category = "all"; filters.location = ""; filters.status = "all";
    $("#searchInput").value = ""; $("#categoryFilter").value = "all"; $("#locationFilter").value = ""; $("#statusFilter").value = "all";
    renderAccountUI(true);

    resetDonateForm();
    $("#donateSuccess").hidden = false;
    showToast(`"${values.foodName}" was listed and now appears in Find Food. Thank you for donating!`);

    setTimeout(() => { submitBtn.disabled = false; submitBtn.textContent = "Submit Donation"; }, 800);
  }

  /** Clear the donate form and its photo preview, keeping the donor name prefilled. */
  function resetDonateForm() {
    form.reset();
    clearPhoto();
    form.elements.donor.value = account.name || "";
    $("#notesCount").textContent = "0";
    $$("[aria-invalid]", form).forEach((el) => el.removeAttribute("aria-invalid"));
    $$(".error", form).forEach((el) => (el.textContent = ""));
  }

  /* ---------- Photo upload ---------- */

  /** Read an image file, shrink it and return a compressed JPEG data URL (keeps localStorage small). */
  function compressImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("read"));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error("decode"));
        img.onload = () => {
          const scale = Math.min(1, 720 / Math.max(img.width, img.height));
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));
          const ctx = canvas.getContext("2d");
          ctx.fillStyle = "#fff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL("image/jpeg", 0.72));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function clearPhoto() {
    pendingImage = "";
    imageBusy = false;
    const input = $("#foodImage");
    input.value = "";
    $("#imagePreview").hidden = true;
    setError(input, "");
  }

  async function handlePhotoChange(e) {
    const input = e.target;
    const file = input.files[0];
    if (!file) { clearPhoto(); return; }
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) { clearPhoto(); setError(input, "Please choose a JPG, PNG or WebP image."); return; }
    if (file.size > MAX_FILE_BYTES) { clearPhoto(); setError(input, "That photo is larger than 5 MB."); return; }

    setError(input, "");
    imageBusy = true;
    try {
      const dataUrl = await compressImage(file);
      pendingImage = dataUrl;
      $("#imagePreview img").src = dataUrl;
      $("#imagePreview").hidden = false;
    } catch (err) {
      clearPhoto();
      setError(input, "Could not read that image. Please try a different photo.");
    } finally {
      imageBusy = false;
    }
  }

  /* =========================================================
     Verification: trust card, method cards, dialog
     ========================================================= */

  const STATUS_TEXT = {
    required: "Verification is mandatory. Complete all methods below before you can list food, so NGOs can see you are a trusted donor.",
    pending: "Your details are saved and waiting for review. All methods must be submitted before you can donate. This demo has no reviewer or verification service connected, so nothing is officially verified yet.",
    verified: "Confirmed by the connected verification service."
  };

  /** The "Verified Food Donor" profile card with trust badge, progress and method list. */
  function renderTrustCard() {
    const st = accountStatus();
    const done = METHODS.filter((m) => methodStatus(m.id) !== "none").length;
    $("#trustCard").innerHTML = `
      <div class="trust-head">
        <div class="trust-shield ${st}" aria-hidden="true">${icon(st === "verified" ? "shield-check" : "shield")}</div>
        <div>
          <p class="trust-eyebrow">Verified Food Donor</p>
          <h3>${escapeHTML(account.name || "Your donor profile")}</h3>
          ${vBadge(st)}
        </div>
      </div>
      <p class="trust-desc">${STATUS_TEXT[st]}</p>
      <div class="progress" role="progressbar" aria-label="Verification methods submitted" aria-valuemin="0" aria-valuemax="${METHODS.length}" aria-valuenow="${done}">
        <span style="width:${(done / METHODS.length) * 100}%"></span>
      </div>
      <p class="progress-label">${done} of ${METHODS.length} methods submitted</p>
      <ul class="trust-list">
        ${METHODS.map((m) => `<li>${icon(m.icon)}<span>${escapeHTML(m.title)}</span>${vBadge(methodStatus(m.id))}</li>`).join("")}
      </ul>
      <div class="trust-actions">
        <button type="button" class="btn btn-primary" data-open-verify>${icon("shield-check")} Verify Your Account</button>
        ${done ? '<button type="button" class="btn btn-ghost btn-sm" id="clearVerification">Clear saved details</button>' : ""}
      </div>`;
  }

  /** One card per verification method. */
  function renderMethodGrid() {
    $("#methodGrid").innerHTML = METHODS.map((m) => {
      const st = methodStatus(m.id);
      return `
        <article class="method-card">
          <div class="method-top"><span class="method-icon" aria-hidden="true">${icon(m.icon)}</span>${vBadge(st)}</div>
          <h3>${escapeHTML(m.title)}</h3>
          <p>${escapeHTML(m.desc)}</p>
          <button type="button" class="btn btn-outline btn-sm" data-open-verify="${m.id}">${st === "none" ? "Start" : "Update"}</button>
        </article>`;
    }).join("");
  }

  /** Donor status line inside the donate form. */
  function renderDonorStatus() {
    const el = $("#donorStatus");
    const blocked = !hasSubmittedVerification();
    el.classList.toggle("is-required", blocked);
    el.innerHTML = `
      <span class="donor-status-label">Your donor status</span>
      ${vBadge(accountStatus())}
      ${blocked ? `<span class="donor-status-note">Verification is mandatory. Complete all ${METHODS.length} methods before you can donate (${missingMethods().length} left).</span>` : ""}
      <button type="button" class="link-btn" data-open-verify>${blocked ? "Verify now" : "Verify Your Account"}</button>`;
  }

  /** Badges inside the dialog's accordion headers. */
  function renderDialogBadges() {
    $$("[data-method-badge]").forEach((el) => { el.innerHTML = vBadge(methodStatus(el.dataset.methodBadge)); });
  }

  /** Refresh everything that depends on the account (profile card, badges on listings, stats). */
  function renderAccountUI(animate = false) {
    renderTrustCard();
    renderMethodGrid();
    renderDonorStatus();
    renderDialogBadges();
    render(animate);
  }

  /** Per-method validation. Each returns {ok, first, details} where details are the non-sensitive values we keep. */
  const VALIDATORS = {
    fssai(fm) {
      const c = makeChecker(); const e = fm.elements;
      const num = e.fssaiNumber.value.replace(/\s/g, "");
      const biz = e.fssaiBusiness.value.trim();
      if (!/^\d{14}$/.test(num)) c.fail(e.fssaiNumber, "An FSSAI number has 14 digits."); else c.pass(e.fssaiNumber);
      if (biz.length < 2) c.fail(e.fssaiBusiness, "Please enter the business name on the licence."); else c.pass(e.fssaiBusiness);
      return { ok: !c.first, first: c.first, details: { number: num, business: biz } };
    },
    identity(fm) {
      const c = makeChecker(); const e = fm.elements;
      if (!e.idType.value) c.fail(e.idType, "Please choose an ID type."); else c.pass(e.idType);
      if (e.idName.value.trim().length < 2) c.fail(e.idName, "Please enter your full name."); else c.pass(e.idName);
      const files = checkFiles(c, e.idFile, { max: 1 });
      return { ok: !c.first, first: c.first, details: { idType: e.idType.value, files } };
    },
    contact(fm) {
      const c = makeChecker(); const e = fm.elements;
      const type = e.contactType.value;
      const val = e.contactValue.value.trim();
      const okPhone = /^(\+91)?[6-9]\d{9}$/.test(val.replace(/[\s-]/g, ""));
      const okEmail = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(val);
      if (type === "phone" && !okPhone) c.fail(e.contactValue, "Enter a valid 10-digit Indian mobile number.");
      else if (type === "email" && !okEmail) c.fail(e.contactValue, "Enter a valid email address.");
      else c.pass(e.contactValue);
      return { ok: !c.first, first: c.first, details: { type, masked: maskContact(type, val) } };
    },
    address(fm) {
      const c = makeChecker(); const e = fm.elements;
      if (e.addrText.value.trim().length < 10) c.fail(e.addrText, "Please enter your full address (at least 10 characters)."); else c.pass(e.addrText);
      if (!/^\d{6}$/.test(e.addrPin.value.trim())) c.fail(e.addrPin, "A PIN code has 6 digits."); else c.pass(e.addrPin);
      if (!e.addrProofType.value) c.fail(e.addrProofType, "Please choose the proof type."); else c.pass(e.addrProofType);
      const files = checkFiles(c, e.addrFile, { max: 1 });
      return { ok: !c.first, first: c.first, details: { pin: e.addrPin.value.trim(), proofType: e.addrProofType.value, files } };
    },
    documents(fm) {
      const c = makeChecker(); const e = fm.elements;
      if (!e.docType.value) c.fail(e.docType, "Please choose the document type."); else c.pass(e.docType);
      const files = checkFiles(c, e.docFile, { max: 3 });
      return { ok: !c.first, first: c.first, details: { docType: e.docType.value, files } };
    }
  };

  /** Make the contact input match the selected type (phone or email). */
  function syncContactInput() {
    const isEmail = $('input[name="contactType"]:checked').value === "email";
    const input = $("#contactValue");
    input.type = isEmail ? "email" : "tel";
    input.placeholder = isEmail ? "name@example.com" : "10-digit mobile number";
    input.autocomplete = isEmail ? "email" : "tel";
  }

  /** Hide most of a phone number / email before saving it. */
  function maskContact(type, value) {
    if (type === "email") {
      const [user, domain] = value.split("@");
      return `${user.charAt(0)}•••@${domain}`;
    }
    return "••••••••" + value.replace(/\D/g, "").slice(-2);
  }

  /** Submit handler shared by the five verification forms. */
  async function handleVerifySubmit(e) {
    e.preventDefault();
    const fm = e.currentTarget;
    const method = fm.dataset.method;
    const btn = fm.querySelector('button[type="submit"]');
    if (btn.disabled) return;

    const name = acctName.value.trim();
    if (name.length < 2) {
      setError(acctName, "Please enter your name or organisation first.");
      acctName.focus();
      showToast("Enter your name or organisation at the top of the form.", "error");
      return;
    }
    setError(acctName, "");

    const result = VALIDATORS[method](fm);
    if (!result.ok) {
      showToast("Please fix the highlighted fields and try again.", "error");
      result.first.focus();
      return;
    }

    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Saving...";
    try {
      const outcome = await submitToVerificationService(method, result.details);
      account.name = name;
      account.methods[method] = { status: outcome.status, source: outcome.source, submittedAt: Date.now(), details: result.details };
      saveAccount();

      const title = METHODS.find((m) => m.id === method).title;
      if (outcome.status === "verified") showToast(`${title} was verified by the verification service.`);
      else if (outcome.source === "service") showToast(`${title} was submitted for review.`);
      else showToast(`${title} saved as Pending Review. This demo does not verify anything officially.`, "info");

      fm.reset();
      if (method === "contact") syncContactInput();
      const panel = fm.closest("details");
      if (panel) panel.open = false;
      if (!form.elements.donor.value) form.elements.donor.value = account.name;
      renderAccountUI();

      // The donor was sent here because a donation was blocked.
      if (resumeAfterVerify) {
        const next = missingMethods()[0];
        if (!next) {
          resumeAfterVerify = false;
          closeDialog(verifyDialog);
          showToast("All verification methods are complete. You can now submit your donation.");
        } else {
          // Keep going: open the next method that is still missing.
          $$(".v-panel").forEach((d) => { d.open = d.dataset.method === next.id; });
          const p = $(`.v-panel[data-method="${next.id}"]`);
          if (p) setTimeout(() => p.scrollIntoView({ block: "nearest", behavior: "smooth" }), 50);
        }
      }
    } catch (err) {
      console.error(err);
      showToast("Could not reach the verification service. Nothing was saved. Please try again.", "error");
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  }

  /** Open the verification dialog, with one method expanded. */
  function openVerifyDialog(methodId) {
    const target = METHODS.some((m) => m.id === methodId)
      ? methodId
      : (METHODS.find((m) => methodStatus(m.id) === "none") || METHODS[0]).id;
    acctName.value = account.name || "";
    setError(acctName, "");
    $$(".v-panel").forEach((d) => { d.open = d.dataset.method === target; });
    renderDialogBadges();
    showDialog(verifyDialog);
    const panel = $(`.v-panel[data-method="${target}"]`);
    if (panel) setTimeout(() => panel.scrollIntoView({ block: "nearest", behavior: "smooth" }), 50);
  }

  /** Remove all saved verification details from this browser. */
  function clearVerification() {
    if (!window.confirm("Remove all saved verification details from this browser?")) return;
    account.methods = {};
    saveAccount();
    renderAccountUI();
    showToast("Saved verification details were removed.", "info");
  }

  /* =========================================================
     Dialog helpers (native <dialog> with a fallback)
     ========================================================= */
  function showDialog(d) {
    if (d.open) return;
    if (typeof d.showModal === "function") d.showModal(); else d.setAttribute("open", "");
  }
  function closeDialog(d) {
    if (typeof d.close === "function") d.close(); else d.removeAttribute("open");
  }

  /* =========================================================
     UI behaviours: nav, scroll spy, reveal, filters, events
     ========================================================= */

  /** Mobile navigation toggle. */
  function initNav() {
    const toggle = $("#navToggle");
    const links = $("#navLinks");
    const setOpen = (open) => {
      links.classList.toggle("open", open);
      toggle.setAttribute("aria-expanded", String(open));
    };
    toggle.addEventListener("click", () => setOpen(!links.classList.contains("open")));
    $$("a", links).forEach((a) => a.addEventListener("click", () => setOpen(false)));
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") setOpen(false); });
  }

  /** Highlight the nav link of the section currently on screen. */
  function initScrollSpy() {
    if (!("IntersectionObserver" in window)) return;
    const links = $$('.nav-links a[href^="#"]:not(.nav-cta)');
    const byId = new Map(links.map((a) => [a.getAttribute("href").slice(1), a]));
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        links.forEach((l) => l.removeAttribute("aria-current"));
        const link = byId.get(entry.target.id);
        if (link) link.setAttribute("aria-current", "true");
      });
    }, { rootMargin: "-45% 0px -50% 0px" });
    byId.forEach((_, id) => { const s = document.getElementById(id); if (s) observer.observe(s); });
  }

  /** Fade elements in as they scroll into view, and start the dashboard count-up when it appears. */
  function initReveal() {
    const items = $$(".reveal");
    if (!("IntersectionObserver" in window)) {
      items.forEach((el) => el.classList.add("visible"));
      impactSeen = true;
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) { entry.target.classList.add("visible"); observer.unobserve(entry.target); }
      });
    }, { threshold: 0.12 });
    items.forEach((el) => observer.observe(el));

    const impact = $("#impact");
    const impactObserver = new IntersectionObserver((entries) => {
      if (entries.some((en) => en.isIntersecting)) {
        impactSeen = true;
        updateStats();
        impactObserver.disconnect();
      }
    }, { threshold: 0.25 });
    impactObserver.observe(impact);
  }

  /** Wire up every form, filter, button and dialog. */
  function bindEvents() {
    // Donate form
    form.addEventListener("submit", handleDonate);
    clearErrorOnInput(form);
    form.elements.notes.addEventListener("input", () => { $("#notesCount").textContent = form.elements.notes.value.length; });
    $$("input, select, textarea", form).forEach((el) => el.addEventListener("input", () => { $("#donateSuccess").hidden = true; }));
    ["preparedAt", "expiresAt", "deadline"].forEach((n) => form.elements[n].addEventListener("focus", refreshDateLimits));
    $("#foodImage").addEventListener("change", handlePhotoChange);
    $("#removeImage").addEventListener("click", clearPhoto);

    // Filters
    $("#searchInput").addEventListener("input", (e) => { filters.search = e.target.value; render(); });
    $("#categoryFilter").addEventListener("change", (e) => { filters.category = e.target.value; render(); });
    $("#locationFilter").addEventListener("input", (e) => { filters.location = e.target.value; render(); });
    $("#statusFilter").addEventListener("change", (e) => { filters.status = e.target.value; render(); });
    $("#clearFilters").addEventListener("click", () => {
      filters.search = ""; filters.category = "all"; filters.location = ""; filters.status = "all";
      $("#searchInput").value = ""; $("#categoryFilter").value = "all"; $("#locationFilter").value = ""; $("#statusFilter").value = "all";
      render();
      showToast("Filters cleared.", "info");
    });

    // One delegated listener handles every card button
    listingsEl.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-action]");
      if (!btn || btn.disabled) return;
      if (btn.dataset.action === "reserve") openRequestDialog(btn.dataset.id);
      else if (btn.dataset.action === "pickup") { btn.disabled = true; markPickedUp(btn.dataset.id); }
    });

    // Reset demo listings
    $("#resetDemo").addEventListener("click", () => {
      if (!window.confirm("Reset all listings back to the original sample data? Listings you added will be removed.")) return;
      listings = getSampleData();
      saveListings();
      render(true);
      showToast("Demo listings have been reset.", "info");
    });

    // Verification: open buttons (delegated), forms, accordion, clear
    document.addEventListener("click", (e) => {
      const opener = e.target.closest("[data-open-verify]");
      if (opener) { openVerifyDialog(opener.dataset.openVerify); return; }
      if (e.target.closest("#clearVerification")) clearVerification();
    });
    $$("#verifyDialog form[data-method]").forEach((fm) => fm.addEventListener("submit", handleVerifySubmit));
    clearErrorOnInput(verifyDialog);
    $$(".v-panel").forEach((panel) => panel.addEventListener("toggle", () => {
      if (panel.open) $$(".v-panel").forEach((p) => { if (p !== panel) p.open = false; });
    }));

    // Contact form: switch between phone and email
    $$('input[name="contactType"]').forEach((r) => r.addEventListener("change", () => {
      syncContactInput();
      setError($("#contactValue"), "");
    }));

    // Request dialog
    requestForm.addEventListener("submit", handleRequestSubmit);
    clearErrorOnInput(requestForm);

    // Dialog close buttons and backdrop clicks
    $$("[data-close-dialog]").forEach((b) => b.addEventListener("click", () => closeDialog(b.closest("dialog"))));
    [verifyDialog, requestDialog].forEach((d) => d.addEventListener("click", (e) => { if (e.target === d) closeDialog(d); }));
    verifyDialog.addEventListener("close", () => { resumeAfterVerify = false; });

    // Refresh time-left text and expiry every minute (without replaying card animations)
    setInterval(() => render(), 60 * 1000);
  }

  /* =========================================================
     Init
     ========================================================= */
  function init() {
    $("#year").textContent = new Date().getFullYear();
    wireErrorAccessibility();
    refreshDateLimits();
    loadListings();
    form.elements.donor.value = account.name || "";
    initNav();
    initScrollSpy();
    bindEvents();
    initReveal();
    renderAccountUI(true);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
