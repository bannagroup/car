/* ============================================================
   EL BANNA GROUP — Fleet Management System
   Main Application Logic
   ============================================================ */

// ======================== Firebase Config ========================
const firebaseConfig = {
  apiKey: "AIzaSyBOQ1K6djn81iOZ2R251k1Ky_kCFUGdn9Y",
  authDomain: "car-inovi.firebaseapp.com",
  databaseURL: "https://car-inovi-default-rtdb.firebaseio.com",
  projectId: "car-inovi",
  storageBucket: "car-inovi.firebasestorage.app",
  messagingSenderId: "396152886628",
  appId: "1:396152886628:web:fd55e20311231137af9671",
  measurementId: "G-BM9W87NR4X"
};

let db;
try {
  firebase.initializeApp(firebaseConfig);
  db = firebase.database();
} catch(e) {
  console.error("Firebase init error:", e);
}

// ======================== Global State ========================
let SYS = {
  cars: {}, violations: {}, supervisors: {}, invoices: {},
  config: { adminPass:"1234", trafficPass:"5678", financePass:"9999", custody:20000 },
  managerExpenses: {}, managerAssignments: {}, managerVisaCards: {}
};
let currentUser = null;
let activeInv = null;
let lastPrintScreen = "reports";
let confirmCb = null;
let LIC_FILTER = "all";
let idleTimer = null;

// ======================== Login ========================
function doLogin() {
  const user = document.getElementById("login-user").value.trim();
  const pass = document.getElementById("login-pass").value;
  const errEl = document.getElementById("login-error");
  if (!user || !pass) { errEl.textContent = "أدخل اسم المستخدم وكلمة المرور"; errEl.style.display = "block"; return; }

  // Check admin
  if (user === "admin" && pass === SYS.config.adminPass) {
    currentUser = { username: "admin", name: "المدير العام", role: "admin" };
  } else {
    // Check supervisors
    let found = false;
    Object.entries(SYS.supervisors).forEach(([k, s]) => {
      if (s.username === user && s.password === pass) {
        currentUser = { username: user, name: s.name, role: "supervisor", key: k };
        found = true;
      }
    });
    if (!found) {
      // Check role-based users from config
      const roleUsers = [
        { username: "traffic", pass: SYS.config.trafficPass, name: "مدير الحركة", role: "traffic" },
        { username: "finance", pass: SYS.config.financePass, name: "المدير المالي", role: "finance" },
        { username: "manager", pass: SYS.config.managerPass || "0000", name: "المشرف العام", role: "manager" }
      ];
      for (const ru of roleUsers) {
        if (user === ru.username && pass === ru.pass) {
          currentUser = ru; found = true; break;
        }
      }
    }
    if (!found) { errEl.textContent = "اسم المستخدم أو كلمة المرور خاطئة"; errEl.style.display = "block"; return; }
  }

  errEl.style.display = "none";
  document.getElementById("login-screen").style.display = "none";
  document.getElementById("app").style.display = "flex";
  document.getElementById("display-user").textContent = currentUser.name;
  buildNav();
  showScreen("dashboard");
  loadAll();
  resetIdle();
}

function doLogout() {
  currentUser = null;
  document.getElementById("app").style.display = "none";
  document.getElementById("login-screen").style.display = "flex";
  document.getElementById("login-user").value = "";
  document.getElementById("login-pass").value = "";
  document.getElementById("login-error").style.display = "none";
  clearTimeout(idleTimer);
}

// ======================== Navigation by Role ========================
const SCREENS = {
  dashboard: { icon: "fa-house", label: "الرئيسية", roles: ["admin","supervisor","traffic","finance","manager"] },
  "admin-vios": { icon: "fa-gavel", label: "المخالفات والخصومات", roles: ["admin"] },
  "admin-cars": { icon: "fa-car", label: "السيارات", roles: ["admin"] },
  "admin-licenses": { icon: "fa-id-card", label: "التراخيص", roles: ["admin"] },
  "admin-sups": { icon: "fa-users", label: "المشرفين", roles: ["admin"] },
  "admin-security": { icon: "fa-lock", label: "كلمات المرور", roles: ["admin"] },
  "admin-invoices": { icon: "fa-file-invoice", label: "الفواتير", roles: ["admin"] },
  supervisor: { icon: "fa-user-gear", label: "المشرف", roles: ["supervisor"] },
  traffic: { icon: "fa-traffic-light", label: "مدير الحركة", roles: ["traffic"] },
  finance: { icon: "fa-wallet", label: "المدير المالي", roles: ["finance"] },
  manager: { icon: "fa-receipt", label: "المصروفات العامة", roles: ["manager"] },
  reports: { icon: "fa-chart-pie", label: "التقارير", roles: ["admin","traffic","finance","manager"] },
  settings: { icon: "fa-gear", label: "الإعدادات", roles: ["admin"] }
};

function buildNav() {
  const nav = document.getElementById("main-nav");
  nav.innerHTML = "";
  Object.entries(SCREENS).forEach(([id, cfg]) => {
    if (!cfg.roles.includes(currentUser.role)) return;
    const btn = document.createElement("button");
    btn.className = "nav-btn";
    btn.id = "nav-" + id;
    btn.innerHTML = `<i class="fa-solid ${cfg.icon}"></i> ${cfg.label}`;
    btn.onclick = () => showScreen(id);
    nav.appendChild(btn);
  });
}

function showScreen(id) {
  document.querySelectorAll(".section").forEach(s => s.classList.remove("active"));
  document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
  const sec = document.getElementById("sec-" + id);
  if (sec) sec.classList.add("active");
  const navBtn = document.getElementById("nav-" + id);
  if (navBtn) navBtn.classList.add("active");
  renderScreen(id);
}

function renderScreen(id) {
  switch(id) {
    case "dashboard": renderDashboard(); break;
    case "admin-vios": renderAdminBalances(); break;
    case "admin-cars": renderAdminCars(); break;
    case "admin-licenses": renderLicenses(); break;
    case "admin-sups": renderAdminSups(); break;
    case "admin-invoices": renderAdminInvoices(); break;
    case "supervisor": renderSupervisor(); break;
    case "traffic": renderTraffic(); break;
    case "finance": renderFinance(); break;
    case "manager": renderManager(); break;
    case "reports": renderReports(); break;
  }
}

// ======================== Tabs ========================
function switchTab(section, tabId) {
  const sec = document.getElementById("sec-" + section);
  if (!sec) return;
  sec.querySelectorAll(".tab-content").forEach(t => t.classList.remove("active"));
  sec.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
  document.getElementById(tabId).classList.add("active");
  event.target.classList.add("active");
}

// ======================== Load All Data ========================
function loadAll() {
  db.ref("/").once("value", snap => {
    const v = snap.val();
    if (v) {
      SYS.cars = v.cars || {};
      SYS.violations = v.violations || {};
      SYS.supervisors = v.supervisors || {};
      SYS.invoices = v.invoices || {};
      SYS.config = v.config || SYS.config;
      SYS.managerExpenses = v.managerExpenses || {};
      SYS.managerAssignments = v.managerAssignments || {};
      SYS.managerVisaCards = v.managerVisaCards || {};
    }
    renderScreen(getCurrentScreen());
    toast("✅ تم التحديث", "ok");
  });
}

function getCurrentScreen() {
  const active = document.querySelector(".section.active");
  return active ? active.id.replace("sec-", "") : "dashboard";
}

// ======================== Dashboard ========================
function renderDashboard() {
  const cars = Object.keys(SYS.cars).length;
  const vios = Object.values(SYS.violations).reduce((s, v) => s + Number(v.amount || 0), 0);
  const supCustody = Object.values(SYS.supervisors).reduce((s, v) => s + Number(v.custody || 0), 0);
  const pending = Object.values(SYS.invoices).filter(i => i.status === "pending_approval").length;
  const approved = Object.values(SYS.invoices).filter(i => i.status === "approved").length;
  const finalized = Object.values(SYS.invoices).filter(i => i.status === "finalized").length;

  document.getElementById("dash-stats").innerHTML = `
    <div class="stat-card blue"><div class="stat-label">إجمالي السيارات</div><div class="stat-val">${cars}</div></div>
    <div class="stat-card red"><div class="stat-label">إجمالي المخالفات</div><div class="stat-val">${fmt(vios)}</div></div>
    <div class="stat-card green"><div class="stat-label">إجمالي العهد</div><div class="stat-val">${fmt(supCustody)}</div></div>
    <div class="stat-card gold"><div class="stat-label">فواتير قيد الاعتماد</div><div class="stat-val">${pending + approved}</div></div>
    <div class="stat-card teal"><div class="stat-label">فواتير منتهية</div><div class="stat-val">${finalized}</div></div>
  `;

  // Recent violations
  const latest = Object.values(SYS.violations).sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 5);
  document.getElementById("dash-vios-tbl").innerHTML = latest.length
    ? latest.map(v => `<tr><td>${v.date || ""}</td><td class="driver-cell">${v.car || ""}</td><td>${v.driver || ""}</td><td class="money-red">${fmt(v.amount)} ج</td></tr>`).join("")
    : '<tr><td colspan="4" style="text-align:center;color:#94a3b8;padding:20px">لا توجد مخالفات</td></tr>';

  // Supervisors
  document.getElementById("dash-sups-tbl").innerHTML = Object.keys(SYS.supervisors).length
    ? Object.values(SYS.supervisors).map(s => `<tr><td class="driver-cell">${s.name}</td><td class="money-grn">${fmt(s.custody)} ج</td><td><span class="tag tag-active">نشط</span></td></tr>`).join("")
    : '<tr><td colspan="3" style="text-align:center;color:#94a3b8;padding:20px">لا يوجد مشرفين</td></tr>';
}

// ======================== Admin: Violations ========================
function adminInsertViolation() {
  const car = document.getElementById("adm-vio-car").value.trim();
  const driver = document.getElementById("adm-vio-driver").value.trim();
  const desc = document.getElementById("adm-vio-desc").value.trim();
  const amount = parseFloat(document.getElementById("adm-vio-amount").value);
  if (!desc || isNaN(amount)) { alert("أدخل البيان والمبلغ!"); return; }
  db.ref("violations").push({
    date: new Date().toISOString().split("T")[0],
    car: car || "إدارة", driver: driver || "غير محدد", desc, amount
  });
  toast("✅ تم إدراج المخالفة", "ok");
  ["adm-vio-car", "adm-vio-driver", "adm-vio-desc", "adm-vio-amount"].forEach(id => document.getElementById(id).value = "");
}

function adminInsertDeduction() {
  const driver = document.getElementById("adm-disc-driver").value.trim();
  const reason = document.getElementById("adm-disc-reason").value.trim();
  const amount = parseFloat(document.getElementById("adm-disc-amount").value);
  if (!driver || isNaN(amount) || amount <= 0) { alert("أدخل السائق والمبلغ!"); return; }
  db.ref("violations").push({
    date: new Date().toISOString().split("T")[0],
    car: "إدارة", driver, desc: "[خصم] " + (reason || ""), amount: -Math.abs(amount)
  });
  toast("✅ تم إدراج الخصم", "ok");
  ["adm-disc-driver", "adm-disc-reason", "adm-disc-amount"].forEach(id => document.getElementById(id).value = "");
}

// ======================== Admin: Cars ========================
function renderAdminCars() {
  const tbody = document.getElementById("adm-cars-tbl");
  tbody.innerHTML = Object.entries(SYS.cars).map(([k, c]) => {
    const days = daysDiff(c.expiry);
    const tag = days < 0 ? "tag-expired" : days <= 30 ? "tag-soon" : "tag-active";
    const tagText = days < 0 ? "منتهي" : days <= 30 ? "باقي " + days + " يوم" : "ساري";
    return `<tr>
      <td class="driver-cell">${c.id || ""}</td><td>${c.company || ""}</td><td>${c.driverName || ""}</td>
      <td><span class="tag ${tag}">${tagText}</span> ${c.expiry || ""}</td>
      <td class="car-cell">${c.chassis || ""}</td>
      <td><button class="btn btn-sm btn-edit" onclick="editCar('${k}')">✏</button>
          <button class="btn btn-sm btn-del" onclick="confirmDel('car','${k}')">🗑</button></td>
    </tr>`;
  }).join("") || '<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:20px">لا توجد سيارات</td></tr>';
}

function saveCarData() {
  const uid = document.getElementById("adm-car-uid").value;
  const p = {
    id: document.getElementById("car-id").value.trim(),
    chassis: document.getElementById("car-chassis").value.trim(),
    motor: document.getElementById("car-motor").value.trim(),
    type: document.getElementById("car-type").value.trim(),
    model: document.getElementById("car-model").value.trim(),
    expiry: document.getElementById("car-expiry").value,
    company: document.getElementById("car-company").value.trim(),
    driverName: document.getElementById("car-driver").value.trim()
  };
  if (!p.id || !p.expiry || !p.company) { alert("أدخل البيانات الإلزامية!"); return; }
  if (uid) db.ref("cars/" + uid).set(p, () => { toast("✅ تم التحديث", "ok"); clearCarForm(); loadAll(); });
  else db.ref("cars").push(p, () => { toast("✅ تم الإضافة", "ok"); clearCarForm(); loadAll(); });
}

function editCar(key) {
  const c = SYS.cars[key];
  document.getElementById("adm-car-uid").value = key;
  ["car-id","car-chassis","car-motor","car-type","car-model","car-expiry","car-company","car-driver"].forEach((id, i) => {
    const fields = ["id","chassis","motor","type","model","expiry","company","driverName"];
    document.getElementById(id).value = c[fields[i]] || "";
  });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function clearCarForm() {
  ["adm-car-uid","car-id","car-chassis","car-motor","car-type","car-model","car-expiry","car-company","car-driver"].forEach(id => document.getElementById(id).value = "");
}

// ======================== Admin: Licenses ========================
function renderLicenses() {
  const cars = Object.values(SYS.cars);
  let expired = 0, soon = 0, active = 0;
  const today = new Date(); today.setHours(0,0,0,0);

  const lics = cars.map(c => {
    const exp = c.expiry ? new Date(c.expiry) : null;
    let status = "—", diffDays = null;
    if (exp instanceof Date && !isNaN(exp)) {
      diffDays = Math.ceil((exp - today) / 864e5);
      if (diffDays < 0) { status = "منتهي"; expired++; }
      else if (diffDays <= 30) { status = "ينتهي قريباً"; soon++; }
      else { status = "ساري"; active++; }
    }
    return { ...c, status, diffDays, expiry: c.expiry || "" };
  });

  document.getElementById("lic-stats").innerHTML = `
    <div class="stat-card green"><div class="stat-label">تراخيص سارية</div><div class="stat-val">${active}</div></div>
    <div class="stat-card gold"><div class="stat-label">تنتهي قريباً</div><div class="stat-val">${soon}</div></div>
    <div class="stat-card red"><div class="stat-label">تراخيص منتهية</div><div class="stat-val">${expired}</div></div>
    <div class="stat-card blue"><div class="stat-label">إجمالي السيارات</div><div class="stat-val">${cars.length}</div></div>
  `;

  let filtered = lics;
  if (LIC_FILTER !== "all") filtered = lics.filter(l => l.status === LIC_FILTER);
  filtered.sort((a, b) => (a.diffDays ?? 9999) - (b.diffDays ?? 9999));

  const grid = document.getElementById("lic-cards");
  const empty = document.getElementById("lic-empty");
  if (!filtered.length) { grid.innerHTML = ""; empty.style.display = ""; return; }
  empty.style.display = "none";

  grid.innerHTML = filtered.map(l => {
    const cls = l.status === "منتهي" ? "expired" : l.status === "ينتهي قريباً" ? "soon" : "";
    const expCls = cls || "ok";
    const daysText = l.diffDays === null ? "" : l.diffDays < 0 ? `منذ ${Math.abs(l.diffDays)} يوم` : l.diffDays === 0 ? "ينتهي اليوم!" : `باقي ${l.diffDays} يوم`;
    return `<div class="lic-card ${cls}">
      <div class="lic-card-head ${expCls}"><div><div class="lic-car-num">🚗 ${l.id || ""}</div></div>
        <span class="tag tag-${expCls === "expired" ? "expired" : expCls === "soon" ? "soon" : "active"}">${l.status}</span></div>
      <div class="lic-card-body">
        ${l.company ? `<div class="lic-row"><span class="lic-lbl">الشركة</span><span class="lic-val">${l.company}</span></div>` : ""}
        <div class="lic-row"><span class="lic-lbl">السائق</span><span class="lic-val">${l.driverName || "—"}</span></div>
        ${l.chassis ? `<div class="lic-row"><span class="lic-lbl">الشاسيه</span><span class="lic-val" style="font-family:monospace;font-size:.76rem">${l.chassis}</span></div>` : ""}
        <div class="lic-row" style="margin-top:4px"><span class="lic-lbl">تاريخ الانتهاء</span><span class="lic-expiry ${expCls}">${l.expiry || "—"}</span></div>
        ${daysText ? `<div style="font-size:.72rem;font-weight:700;color:#64748b;margin-top:2px">${daysText}</div>` : ""}
      </div>
    </div>`;
  }).join("");
}

function setLicFilter(f, btn) {
  LIC_FILTER = f;
  document.querySelectorAll(".filter-tab").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  renderLicenses();
}

// ======================== Admin: Supervisors ========================
function renderAdminSups() {
  const tbody = document.getElementById("adm-sups-tbl");
  tbody.innerHTML = Object.entries(SYS.supervisors).map(([k, s]) => `
    <tr><td class="driver-cell">${s.name}</td><td class="car-cell">${s.username || "—"}</td>
    <td class="money-grn">${fmt(s.custody)} ج</td>
    <td><button class="btn btn-sm btn-edit" onclick="editSup('${k}')">✏</button>
        <button class="btn btn-sm btn-del" onclick="confirmDel('supervisor','${k}')">🗑</button></td></tr>
  `).join("") || '<tr><td colspan="4" style="text-align:center;color:#94a3b8;padding:20px">لا يوجد مشرفين</td></tr>';
}

function saveSupervisor() {
  const uid = document.getElementById("sup-uid").value;
  const name = document.getElementById("sup-name").value.trim();
  const username = document.getElementById("sup-username").value.trim();
  const password = document.getElementById("sup-password").value;
  const custody = parseFloat(document.getElementById("sup-custody").value) || 0;
  if (!name) { alert("أدخل اسم المشرف!"); return; }
  if (uid) {
    db.ref("supervisors/" + uid + "/name").set(name);
    if (username) db.ref("supervisors/" + uid + "/username").set(username);
    if (password) db.ref("supervisors/" + uid + "/password").set(password);
    if (custody > 0) {
      const cur = Number(SYS.supervisors[uid].custody || 0);
      db.ref("supervisors/" + uid + "/custody").set(cur + custody);
    }
    toast("✅ تم التحديث", "ok");
  } else {
    if (!username || !password) { alert("أدخل اسم المستخدم وكلمة المرور!"); return; }
    db.ref("supervisors").push({ name, username, password, custody });
    toast("✅ تم إضافة المشرف", "ok");
  }
  ["sup-uid","sup-name","sup-username","sup-password","sup-custody"].forEach(id => document.getElementById(id).value = "");
  loadAll();
}

function editSup(key) {
  const s = SYS.supervisors[key];
  document.getElementById("sup-uid").value = key;
  document.getElementById("sup-name").value = s.name;
  document.getElementById("sup-username").value = s.username || "";
  document.getElementById("sup-password").value = "";
  document.getElementById("sup-custody").value = "";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ======================== Admin: Security ========================
function updatePass(configKey, inputId) {
  const nw = document.getElementById(inputId).value.trim();
  if (!nw) { alert("أدخل الباسورد الجديد!"); return; }
  db.ref("config/" + configKey).set(nw, () => {
    SYS.config[configKey] = nw;
    toast("🔒 تم التحديث", "ok");
    document.getElementById(inputId).value = "";
  });
}

function updateCustodyAmount() {
  const v = parseFloat(document.getElementById("custody-amt-new").value);
  if (isNaN(v) || v < 0) { alert("أدخل مبلغ صحيح!"); return; }
  db.ref("config/custody").set(v, () => {
    SYS.config.custody = v;
    toast("✅ تم تحديث العهدة", "ok");
    document.getElementById("custody-amt-new").value = "";
  });
}

// ======================== Admin: Invoices ========================
function renderAdminInvoices() {
  const tbody = document.getElementById("adm-invoices-tbl");
  const statusMap = { pending_approval: ["⏳ انتظار", "tag-pending"], approved: ["✔ معتمدة", "tag-approved"], finalized: ["✔✔ منتهية", "tag-finalized"], rejected: ["✘ مرفوضة", "tag-rejected"] };
  tbody.innerHTML = Object.entries(SYS.invoices).map(([k, inv]) => {
    const total = invTotal(inv);
    const [sl, cls] = statusMap[inv.status] || [inv.status, ""];
    return `<tr><td class="car-cell">${inv.id || ""}</td><td>${inv.date || ""}</td><td class="driver-cell">${inv.car || ""}</td><td>${inv.supervisorName || ""}</td>
    <td class="money-grn">${fmt(total)} ج</td><td><span class="tag ${cls}">${sl}</span></td>
    <td><button class="btn btn-sm btn-del" onclick="confirmDel('invoice','${k}')">🗑 حذف</button></td></tr>`;
  }).join("") || '<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:20px">لا توجد فواتير</td></tr>';
}

// ======================== Supervisor ========================
function renderSupervisor() {
  if (!currentUser || currentUser.role !== "supervisor") return;
  const sup = SYS.supervisors[currentUser.key];
  if (!sup) return;
  document.getElementById("sup-identity").textContent = sup.name;
  document.getElementById("sup-custody-lbl").textContent = fmt(sup.custody) + " ج";
  document.getElementById("exp-date").value = new Date().toISOString().split("T")[0];
  renderSupInvoiceHistory();
}

function renderSupInvoiceHistory() {
  if (!currentUser || currentUser.role !== "supervisor") return;
  const tbody = document.getElementById("sup-inv-history-tbl");
  const mine = Object.entries(SYS.invoices).filter(([k, inv]) => inv.supervisorKey === currentUser.key)
    .sort((a, b) => (b[1].submittedAt || "").localeCompare(a[1].submittedAt || ""));
  const statusMap = { pending_approval: ["⏳ انتظار", "tag-pending"], approved: ["✔ معتمدة", "tag-approved"], finalized: ["✔✔ منتهية", "tag-finalized"], rejected: ["✘ مرفوضة", "tag-rejected"] };
  tbody.innerHTML = mine.map(([k, inv]) => {
    const [sl, cls] = statusMap[inv.status] || [inv.status, ""];
    return `<tr><td class="car-cell">${inv.id || ""}</td><td class="driver-cell">${inv.car || ""}</td><td>${inv.date || ""}</td><td class="money-grn">${fmt(invTotal(inv))} ج</td><td><span class="tag ${cls}">${sl}</span></td></tr>`;
  }).join("") || '<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:20px">لا توجد فواتير سابقة</td></tr>';
}

function createInvoice() {
  if (!currentUser || currentUser.role !== "supervisor") return;
  const date = document.getElementById("exp-date").value;
  const car = document.getElementById("exp-car").value.trim();
  const place = document.getElementById("exp-place").value.trim();
  const licDesc = document.getElementById("exp-license-desc").value.trim();
  const amount = parseFloat(document.getElementById("exp-amount").value);
  const desc = document.getElementById("exp-desc").value.trim();
  if (!date || !car || isNaN(amount) || !desc) { alert("استوفِ جميع البيانات!"); return; }
  activeInv = {
    id: "INV-" + Math.floor(100000 + Math.random() * 900000),
    date, car, place, licenseDesc: licDesc,
    supervisorKey: currentUser.key, supervisorName: currentUser.name,
    items: [{ amount, desc }], status: "draft"
  };
  document.getElementById("active-invoice-zone").style.display = "";
  document.getElementById("inv-active-id").textContent = activeInv.id;
  renderInvItems();
}

function renderInvItems() {
  if (!activeInv) return;
  const tbody = document.getElementById("inv-items-tbl");
  let total = 0;
  tbody.innerHTML = activeInv.items.map((item, i) => {
    total += Number(item.amount);
    return `<tr><td class="money-grn">${fmt(item.amount)} ج</td><td>${item.desc}</td>
    <td style="text-align:center"><button class="btn btn-sm btn-del" onclick="removeInvItem(${i})">حذف</button></td></tr>`;
  }).join("") || '<tr><td colspan="3" style="text-align:center;color:#94a3b8;padding:12px">لا توجد بنود</td></tr>';
  document.getElementById("inv-total").textContent = fmt(total);
}

function appendItem() {
  const amt = parseFloat(document.getElementById("sub-amount").value);
  const desc = document.getElementById("sub-desc").value.trim();
  if (isNaN(amt) || !desc) { alert("أدخل المبلغ والبيان!"); return; }
  activeInv.items.push({ amount: amt, desc });
  document.getElementById("sub-amount").value = "";
  document.getElementById("sub-desc").value = "";
  renderInvItems();
}

function removeInvItem(i) { activeInv.items.splice(i, 1); renderInvItems(); }

function submitInvoice() {
  if (!activeInv || !activeInv.items.length) { alert("لا توجد بنود!"); return; }
  activeInv.status = "pending_approval";
  activeInv.totalSum = invTotal(activeInv);
  activeInv.submittedAt = new Date().toISOString();
  db.ref("invoices").push(activeInv, () => {
    toast("✅ تم إرسال الفاتورة لاعتماد مدير الحركة", "ok");
    document.getElementById("active-invoice-zone").style.display = "none";
    activeInv = null;
    ["exp-car", "exp-amount", "exp-desc", "exp-place", "exp-license-desc"].forEach(id => document.getElementById(id).value = "");
    loadAll();
  });
}

// ======================== Traffic Manager ========================
function renderTraffic() {
  const pending = document.getElementById("traffic-pending-tbl");
  const hist = document.getElementById("traffic-history-tbl");
  pending.innerHTML = ""; hist.innerHTML = "";
  let pendingCount = 0;

  Object.entries(SYS.invoices).forEach(([k, inv]) => {
    const total = invTotal(inv);
    if (inv.status === "pending_approval") {
      pendingCount++;
      pending.innerHTML += `<tr><td class="car-cell">${inv.id}</td><td>${inv.date}</td><td class="driver-cell">${inv.car}</td><td>${inv.supervisorName || ""}</td>
      <td class="money-grn">${fmt(total)} ج</td>
      <td><button class="btn btn-sm btn-outline" onclick="showInvDetails('${k}')">🔍</button></td>
      <td><button class="btn btn-sm btn-green" onclick="approveInv('${k}')">✔ موافقة</button>
          <button class="btn btn-sm btn-del" onclick="rejectInv('${k}')">✘ رفض</button></td></tr>`;
    } else if (["approved", "finalized", "rejected"].includes(inv.status)) {
      const badge = inv.status === "approved" ? '<span class="tag tag-approved">معتمدة</span>'
        : inv.status === "finalized" ? '<span class="tag tag-finalized">منتهية</span>'
        : '<span class="tag tag-rejected">مرفوضة</span>';
      hist.innerHTML += `<tr><td class="car-cell">${inv.id}</td><td>${inv.date}</td><td class="driver-cell">${inv.car}</td><td class="money-grn">${fmt(total)} ج</td><td>${badge}</td></tr>`;
    }
  });

  document.getElementById("traffic-empty").style.display = pendingCount ? "none" : "";
}

function approveInv(key) {
  if (!confirm("تأكيد اعتماد الفاتورة؟")) return;
  db.ref("invoices/" + key + "/status").set("approved", () => {
    db.ref("invoices/" + key + "/approvedAt").set(new Date().toISOString());
    toast("✅ تم الاعتماد", "ok"); loadAll();
  });
}

function rejectInv(key) {
  const reason = prompt("سبب الرفض (اختياري):");
  db.ref("invoices/" + key + "/status").set("rejected", () => {
    db.ref("invoices/" + key + "/rejectedAt").set(new Date().toISOString());
    if (reason) db.ref("invoices/" + key + "/rejectionReason").set(reason);
    toast("تم رفض الفاتورة", "warn"); loadAll();
  });
}

function showInvDetails(key) {
  const inv = SYS.invoices[key];
  const total = invTotal(inv);
  document.getElementById("modal-title").textContent = `فاتورة: ${inv.id} — السيارة: ${inv.car}`;
  document.getElementById("modal-body").innerHTML = (inv.items || []).map(item =>
    `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f1f5f9"><span>${item.desc}</span><strong class="money-grn">${fmt(item.amount)} ج</strong></div>`
  ).join("") + `<div style="text-align:left;padding-top:8px;font-weight:800">الإجمالي: ${fmt(total)} جنيه</div>`;
  openModal("modal-details");
}

// ======================== Finance Manager ========================
function renderFinance() {
  const approved = document.getElementById("finance-approved-tbl");
  const hist = document.getElementById("finance-history-tbl");
  approved.innerHTML = ""; hist.innerHTML = "";
  let approvedCount = 0;

  Object.entries(SYS.invoices).forEach(([k, inv]) => {
    const total = invTotal(inv);
    if (inv.status === "approved") {
      approvedCount++;
      approved.innerHTML += `<tr><td class="car-cell">${inv.id}</td><td>${inv.date}</td><td class="driver-cell">${inv.car}</td><td>${inv.supervisorName || ""}</td>
      <td>${inv.place || ""} ${inv.licenseDesc ? "- " + inv.licenseDesc : ""}</td>
      <td class="money-grn" style="font-size:.9rem">${fmt(total)} ج</td>
      <td><button class="btn btn-sm btn-green" onclick="finalizePrint('${k}')">🖨️ طباعة وخصم</button></td></tr>`;
    } else if (inv.status === "finalized") {
      hist.innerHTML += `<tr><td class="car-cell">${inv.id}</td><td>${inv.date}</td><td class="driver-cell">${inv.car}</td>
      <td class="money-grn">${fmt(total)} ج</td>
      <td><button class="btn btn-sm btn-outline" onclick="reprintInv('${k}')">🖨️ إعادة طباعة</button></td></tr>`;
    }
  });
  document.getElementById("finance-empty").style.display = approvedCount ? "none" : "";
}

function finalizePrint(key) {
  const inv = SYS.invoices[key];
  const total = invTotal(inv);
  if (!inv.supervisorKey || !SYS.supervisors[inv.supervisorKey]) { alert("لم يتم العثور على بيانات المشرف!"); return; }
  const sup = SYS.supervisors[inv.supervisorKey];
  const cur = Number(sup.custody || 0);
  if (cur < total) { alert(`عهدة المشرف (${cur} ج) غير كافية!`); return; }
  if (!confirm(`خصم ${fmt(total)} ج من عهدة "${sup.name}"؟\nقبل: ${fmt(cur)} ج → بعد: ${fmt(cur - total)} ج`)) return;

  db.ref("supervisors/" + inv.supervisorKey + "/custody").set(cur - total);
  db.ref("invoices/" + key + "/status").set("finalized");
  db.ref("invoices/" + key + "/finalizedAt").set(new Date().toISOString());

  activeInv = inv;
  lastPrintScreen = "finance";
  triggerPrint(total, sup.name);
}

function reprintInv(key) {
  const inv = SYS.invoices[key];
  const total = invTotal(inv);
  const supName = inv.supervisorName || (inv.supervisorKey && SYS.supervisors[inv.supervisorKey] ? SYS.supervisors[inv.supervisorKey].name : "");
  activeInv = inv;
  lastPrintScreen = currentUser && currentUser.role === "finance" ? "finance" : "reports";
  triggerPrint(total, supName);
}

function triggerPrint(total, supName) {
  document.getElementById("prt-inv-id").textContent = activeInv.id;
  document.getElementById("prt-date").textContent = new Date().toLocaleDateString("ar-EG");
  document.getElementById("prt-inv-date").textContent = activeInv.date;
  document.getElementById("prt-inv-car").textContent = activeInv.car;
  document.getElementById("prt-inv-place").textContent = activeInv.place || "مكان الخدمة";
  document.getElementById("prt-inv-license").textContent = activeInv.licenseDesc || "مصاريف عامة";
  document.getElementById("prt-inv-sup").textContent = supName || activeInv.supervisorName || "";
  document.getElementById("prt-items-tbl").innerHTML = (activeInv.items || []).map(item =>
    `<tr><td style="padding:6px;border-bottom:1px solid #d4b896;font-weight:700">${fmt(item.amount)} ج</td><td style="padding:6px;border-bottom:1px solid #d4b896">${item.desc}</td></tr>`
  ).join("");
  document.getElementById("prt-total").textContent = fmt(total) + " جنيه مصري";
  document.querySelectorAll(".section").forEach(s => s.classList.remove("active"));
  document.getElementById("print-zone").style.display = "block";
  setTimeout(() => window.print(), 400);
}

function closePrint() {
  document.getElementById("print-zone").style.display = "none";
  if (lastPrintScreen === "finance" && currentUser && currentUser.role === "finance") showScreen("finance");
  else showScreen("reports");
}

// ======================== Manager: General Expenses ========================
function renderManager() {
  renderMgrStats();
  renderMgrExpenses();
  renderMgrAssignSelect();
  renderMgrAssignments();
  renderMgrCards();
  document.getElementById("mgr-exp-date").value = new Date().toISOString().split("T")[0];
  document.getElementById("mgr-assign-date").value = new Date().toISOString().split("T")[0];
}

function renderMgrStats() {
  const total = Number(SYS.config.custody || 0);
  const cashSpent = Object.values(SYS.managerExpenses).filter(e => e.payMethod === "cash").reduce((s, e) => s + Number(e.total || 0), 0);
  const visaSpent = Object.values(SYS.managerExpenses).filter(e => e.payMethod === "visa").reduce((s, e) => s + Number(e.total || 0), 0);
  document.getElementById("mgr-stats").innerHTML = `
    <div class="stat-card purple"><div class="stat-label">إجمالي العهدة</div><div class="stat-val">${fmt(total)}</div></div>
    <div class="stat-card green"><div class="stat-label">مصروف نقدي</div><div class="stat-val">${fmt(cashSpent)}</div></div>
    <div class="stat-card blue"><div class="stat-label">مصروف فيزا</div><div class="stat-val">${fmt(visaSpent)}</div></div>
    <div class="stat-card teal"><div class="stat-label">المتبقي (نقدي)</div><div class="stat-val">${fmt(total - cashSpent)}</div></div>
  `;
}

function toggleVisaSelect() {
  document.getElementById("mgr-visa-select").style.display =
    document.querySelector('input[name="pay-method"]:checked').value === "visa" ? "" : "none";
}

function addGeneralExpense() {
  const desc = document.getElementById("mgr-exp-desc").value.trim();
  const qty = parseInt(document.getElementById("mgr-exp-qty").value) || 0;
  const price = parseFloat(document.getElementById("mgr-exp-price").value) || 0;
  const date = document.getElementById("mgr-exp-date").value;
  const payMethod = document.querySelector('input[name="pay-method"]:checked').value;
  const cardId = payMethod === "visa" ? document.getElementById("mgr-visa-select").value : "";
  if (!desc || qty < 1 || price <= 0 || !date) { alert("استوفِ جميع البيانات!"); return; }
  if (payMethod === "visa" && !cardId) { alert("اختر بطاقة الفيزا!"); return; }
  const cardName = payMethod === "visa" ? (SYS.managerVisaCards[cardId] || {}).name || "" : "";
  db.ref("managerExpenses").push({ id: "EXP-" + Date.now(), date, desc, qty, remainingQty: qty, unitPrice: price, total: qty * price, payMethod, cardId, cardName }, () => {
    toast("✅ تم حفظ المصروف", "ok");
    ["mgr-exp-desc", "mgr-exp-qty", "mgr-exp-price"].forEach(id => document.getElementById(id).value = "");
    document.getElementById("mgr-exp-total").textContent = "0";
    loadAll();
  });
}

function renderMgrExpenses() {
  const tbody = document.getElementById("mgr-exp-tbl");
  tbody.innerHTML = Object.entries(SYS.managerExpenses).map(([k, e]) => {
    const badge = e.payMethod === "cash" ? '<span style="background:#dcfce7;color:#16a34a;padding:2px 8px;border-radius:12px;font-size:.7rem;font-weight:700">💵 نقدي</span>'
      : `<span style="background:#dbeafe;color:#2563eb;padding:2px 8px;border-radius:12px;font-size:.7rem;font-weight:700">💳 ${e.cardName || "فيزا"}</span>`;
    return `<tr><td>${e.date || ""}</td><td class="driver-cell">${e.desc}</td><td style="text-align:center">${e.qty}</td>
    <td style="text-align:center;font-weight:700;color:${e.remainingQty > 0 ? "#d97706" : "#94a3b8"}">${e.remainingQty}</td>
    <td style="text-align:center">${fmt(e.unitPrice || 0)}</td>
    <td style="text-align:center;font-weight:700;color:#2563eb">${fmt(e.total || 0)}</td>
    <td style="text-align:center">${badge}</td>
    <td style="text-align:center"><button class="btn btn-sm btn-del" onclick="confirmDel('expense','${k}')">حذف</button></td></tr>`;
  }).join("") || '<tr><td colspan="8" style="text-align:center;color:#94a3b8;padding:20px">لا توجد مصروفات</td></tr>';
}

function renderMgrAssignSelect() {
  const sel = document.getElementById("mgr-assign-exp");
  sel.innerHTML = '<option value="">-- اختر مصروف --</option>';
  Object.entries(SYS.managerExpenses).filter(([, e]) => e.remainingQty > 0).forEach(([k, e]) => {
    sel.innerHTML += `<option value="${k}">${e.desc} (متبقي: ${e.remainingQty} — ${e.unitPrice} ج)</option>`;
  });
}

function updateAssignAvail() {
  const key = document.getElementById("mgr-assign-exp").value;
  const exp = SYS.managerExpenses[key];
  document.getElementById("mgr-assign-avail").textContent = exp ? `متاح: ${exp.remainingQty}` : "متاح: —";
}

function assignToCar() {
  const expKey = document.getElementById("mgr-assign-exp").value;
  const carNum = document.getElementById("mgr-assign-car").value.trim();
  const qty = parseInt(document.getElementById("mgr-assign-qty").value) || 0;
  const date = document.getElementById("mgr-assign-date").value;
  const exp = SYS.managerExpenses[expKey];
  if (!expKey || !exp || !carNum || qty < 1 || !date) { alert("استوفِ جميع البيانات!"); return; }
  if (qty > exp.remainingQty) { alert("الكمية أكبر من المتاح!"); return; }
  const amount = qty * (exp.unitPrice || 0);
  db.ref("managerAssignments").push({ id: "ASN-" + Date.now(), date, expenseId: expKey, expenseDesc: exp.desc, carNum, qty, amount }, () => {
    db.ref("managerExpenses/" + expKey + "/remainingQty").set(exp.remainingQty - qty);
    toast("✅ تم التحميل", "ok"); loadAll();
  });
}

function renderMgrAssignments() {
  const tbody = document.getElementById("mgr-assign-tbl");
  tbody.innerHTML = Object.entries(SYS.managerAssignments).map(([k, a]) => `
    <tr><td>${a.date || ""}</td><td class="driver-cell">${a.expenseDesc || ""}</td><td style="text-align:center;color:#2563eb;font-weight:700">${a.carNum}</td>
    <td style="text-align:center">${a.qty}</td><td style="text-align:center;font-weight:700;color:#16a34a">${fmt(a.amount || 0)} ج</td>
    <td style="text-align:center"><button class="btn btn-sm btn-del" onclick="confirmDel('assignment','${k}')">حذف</button></td></tr>
  `).join("") || '<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:20px">لا توجد تحميلات</td></tr>';
}

function renderMgrCards() {
  const el = document.getElementById("mgr-cards-list");
  el.innerHTML = Object.entries(SYS.managerVisaCards).map(([k, c]) => `
    <div style="display:flex;justify-content:space-between;align-items:center;background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:10px 14px;margin-bottom:8px;font-size:.82rem">
      <div><strong>${c.name}</strong> <span style="color:#94a3b8;font-family:monospace;margin-right:8px">**** ${c.last4}</span></div>
      <button class="btn btn-sm btn-del" onclick="confirmDel('card','${k}')">حذف</button>
    </div>
  `).join("") || '<p style="text-align:center;color:#94a3b8;padding:16px;font-size:.82rem">لا توجد بطاقات</p>';

  const sel = document.getElementById("mgr-visa-select");
  sel.innerHTML = '<option value="">-- اختر البطاقة --</option>';
  Object.entries(SYS.managerVisaCards).forEach(([k, c]) => {
    sel.innerHTML += `<option value="${k}">${c.name} (**** ${c.last4})</option>`;
  });
}

function addVisaCard() {
  const name = document.getElementById("mgr-card-name").value.trim();
  const last4 = document.getElementById("mgr-card-last4").value.trim();
  if (!name) { alert("أدخل اسم البطاقة!"); return; }
  if (last4.length !== 4 || isNaN(last4)) { alert("آخر 4 أرقام صحيحة فقط!"); return; }
  db.ref("managerVisaCards").push({ name, last4 }, () => { toast("✅ تمت الإضافة", "ok"); loadAll(); });
  document.getElementById("mgr-card-name").value = "";
  document.getElementById("mgr-card-last4").value = "";
}

// ======================== Reports ========================
function renderReports() {
  // Violations
  document.getElementById("rep-vios-tbl").innerHTML = Object.values(SYS.violations).sort((a, b) => (b.date || "").localeCompare(a.date || "")).map(v =>
    `<tr><td>${v.date || ""}</td><td class="driver-cell">${v.car || ""}</td><td>${v.driver || ""}</td><td>${v.desc || ""}</td><td class="${Number(v.amount) >= 0 ? "money-red" : "money-grn"}">${fmt(v.amount)} ج</td></tr>`
  ).join("") || '<tr><td colspan="5" style="text-align:center;color:#94a3b8">لا توجد مخالفات</td></tr>';

  // Drivers
  const balances = calcBalances();
  document.getElementById("rep-drivers-tbl").innerHTML = Object.values(balances).map(b => {
    const net = b.totalVios - b.totalDiscounts;
    return `<tr><td class="driver-cell">${b.driver}</td><td class="money-red">${fmt(b.totalVios)} ج</td><td class="money-grn">${fmt(b.totalDiscounts)} ج</td><td class="money-gold">${fmt(net)} ج</td></tr>`;
  }).join("") || '<tr><td colspan="4" style="text-align:center;color:#94a3b8">لا توجد بيانات</td></tr>';

  // Licenses
  document.getElementById("rep-licenses-tbl").innerHTML = Object.values(SYS.cars).map(c => {
    const d = daysDiff(c.expiry);
    return `<tr><td class="driver-cell">${c.id || ""}</td><td>${c.company || ""}</td><td>${c.expiry || ""}</td><td class="driver-cell">${d} يوم</td></tr>`;
  }).join("") || '<tr><td colspan="4" style="text-align:center;color:#94a3b8">لا توجد سيارات</td></tr>';

  // Invoices
  const stMap = { pending_approval: "⏳ انتظار", approved: "✔ معتمدة", finalized: "✔✔ منتهية", rejected: "✘ مرفوضة" };
  document.getElementById("rep-invoices-tbl").innerHTML = Object.entries(SYS.invoices).map(([k, inv]) => {
    const total = invTotal(inv);
    return `<tr><td class="car-cell">${inv.id}</td><td>${inv.date}</td><td class="driver-cell">${inv.car}</td><td class="money-grn">${fmt(total)} ج</td><td>${stMap[inv.status] || inv.status}</td>
    <td>${inv.status === "finalized" ? `<button class="btn btn-sm btn-outline" onclick="reprintInv('${k}')">🖨️</button>` : ""}</td></tr>`;
  }).join("") || '<tr><td colspan="6" style="text-align:center;color:#94a3b8">لا توجد فواتير</td></tr>';

  // Statement select
  const sel = document.getElementById("stmt-sup-select");
  sel.innerHTML = '<option value="">-- اختر المشرف --</option>' +
    Object.entries(SYS.supervisors).map(([k, s]) => `<option value="${k}">${s.name}</option>`).join("");
}

function renderStatement() {
  const key = document.getElementById("stmt-sup-select").value;
  const tbody = document.getElementById("rep-stmt-tbl");
  if (!key) { tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:20px">اختر مشرفاً</td></tr>'; return; }
  const mine = Object.entries(SYS.invoices).filter(([, inv]) => inv.supervisorKey === key)
    .sort((a, b) => (b[1].submittedAt || "").localeCompare(a[1].submittedAt || ""));
  const stMap = { pending_approval: "⏳ انتظار", approved: "✔ معتمدة", finalized: "✔✔ منتهية", rejected: "✘ مرفوضة" };
  tbody.innerHTML = mine.map(([, inv]) => {
    const total = invTotal(inv);
    return `<tr><td>${inv.date || ""}</td><td class="car-cell">${inv.id}</td><td class="driver-cell">${inv.car}</td><td>${inv.place || ""} ${inv.licenseDesc ? "- " + inv.licenseDesc : ""}</td><td class="money-red">-${fmt(total)} ج</td><td>${stMap[inv.status] || inv.status}</td></tr>`;
  }).join("") || '<tr><td colspan="6" style="text-align:center;color:#94a3b8">لا توجد فواتير</td></tr>';
}

// ======================== Driver Balances ========================
function calcBalances() {
  const bal = {};
  Object.values(SYS.violations).forEach(v => {
    if (!v.driver) return;
    if (!bal[v.driver]) bal[v.driver] = { driver: v.driver, totalVios: 0, totalDiscounts: 0 };
    if (Number(v.amount) >= 0) bal[v.driver].totalVios += Number(v.amount);
    else bal[v.driver].totalDiscounts += Math.abs(Number(v.amount));
  });
  return bal;
}

function renderAdminBalances() {
  const tbody = document.getElementById("adm-balances-tbl");
  const bal = calcBalances();
  tbody.innerHTML = Object.values(bal).map(b => {
    const net = b.totalVios - b.totalDiscounts;
    return `<tr><td class="driver-cell">${b.driver}</td><td class="money-red">${fmt(b.totalVios)} ج</td><td class="money-grn">${fmt(b.totalDiscounts)} ج</td>
    <td class="${net > 0 ? "money-gold" : ""}" style="font-weight:800">${fmt(net)} ج</td>
    <td><button class="btn btn-sm btn-green" onclick="applyDriverDiscount('${b.driver}')">خصم</button></td></tr>`;
  }).join("") || '<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:20px">لا توجد بيانات</td></tr>';
}

function applyDriverDiscount(driver) {
  const amt = prompt(`أدخل مبلغ الخصم للسائق "${driver}":`);
  if (!amt || isNaN(amt) || Number(amt) <= 0) return;
  db.ref("violations").push({ date: new Date().toISOString().split("T")[0], car: "إدارة", driver, desc: "[خصم مالي]", amount: -Math.abs(Number(amt)) });
  toast("✅ تم الخصم", "ok"); loadAll();
}

// ======================== Import / Export ========================
function importCSV(event, type) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    let count = 0;
    if (file.name.endsWith(".xlsx") || file.name.endsWith(".xls")) {
      const wb = XLSX.read(new Uint8Array(e.target.result), { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(ws, { defval: "" });
      json.forEach(row => {
        const vals = Object.values(row).map(String);
        if (type === "cars" && vals.length >= 7) { db.ref("cars").push({ id: vals[0], chassis: vals[1], motor: vals[2], type: vals[3], model: vals[4], expiry: vals[5], company: vals[6], driverName: vals[7] || "" }); count++; }
        else if (type === "violations" && vals.length >= 4) { db.ref("violations").push({ date: vals[0], car: vals[1], driver: vals[2], desc: vals[3], amount: parseFloat(vals[4] || 0) }); count++; }
        else if (type === "discounts" && vals.length >= 3) { db.ref("violations").push({ date: vals[0] || new Date().toISOString().split("T")[0], car: "إدارة", driver: vals[1], desc: "[خصم مستورد]: " + vals[2], amount: -Math.abs(parseFloat(vals[3] || 0)) }); count++; }
      });
    } else {
      const lines = e.target.result.split("\n");
      for (let i = 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        const c = lines[i].split(",").map(x => x.trim().replace(/^"|"$/g, ""));
        if (type === "cars" && c.length >= 7) { db.ref("cars").push({ id: c[0], chassis: c[1], motor: c[2], type: c[3], model: c[4], expiry: c[5], company: c[6], driverName: c[7] || "" }); count++; }
        else if (type === "violations" && c.length >= 4) { db.ref("violations").push({ date: c[0], car: c[1], driver: c[2], desc: c[3], amount: parseFloat(c[4] || 0) }); count++; }
        else if (type === "discounts" && c.length >= 3) { db.ref("violations").push({ date: c[0] || new Date().toISOString().split("T")[0], car: "إدارة", driver: c[1], desc: "[خصم مستورد]: " + c[2], amount: -Math.abs(parseFloat(c[3] || 0)) }); count++; }
      }
    }
    toast(`✅ تم استيراد ${count} سجل`, "ok"); event.target.value = ""; loadAll();
  };
  if (file.name.endsWith(".xlsx") || file.name.endsWith(".xls")) reader.readAsArrayBuffer(file);
  else reader.readAsText(file, "utf-8");
}

function downloadTemplate(type) {
  let csv = "\uFEFF";
  if (type === "cars") csv += "رقم_السيارة,الشاسيه,الموتور,النوع,الموديل,تاريخ_انتهاء_الترخيص,الشركة,اسم_السائق\n8245,SH10245,M9082,جامبو,2023,2026-12-31,مصر للتفريخ,اسم السائق";
  else if (type === "violations") csv += "التاريخ,رقم_السيارة,اسم_السائق,بيان_المخالفة,المبلغ\n2026-01-15,8245,اسم السائق,رادار طريق الكيلو 17,700";
  else if (type === "discounts") csv += "التاريخ,اسم_السائق,سبب_الخصم,مبلغ_الخصم\n2026-01-15,اسم السائق,خصم شهري,200";
  const a = document.createElement("a");
  a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);
  a.download = { cars: "قالب_السيارات", violations: "قالب_المخالفات", discounts: "قالب_الخصومات" }[type] + ".csv";
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}

// ======================== Confirm Delete ========================
function confirmDel(type, key) {
  confirmCb = () => {
    const paths = { car: "cars/" + key, supervisor: "supervisors/" + key, expense: "managerExpenses/" + key, assignment: "managerAssignments/" + key, card: "managerVisaCards/" + key, invoice: "invoices/" + key };
    if (paths[type]) db.ref(paths[type]).set(null, () => { toast("🗑 تم الحذف", "ok"); loadAll(); });
  };
  openModal("modal-confirm");
}

function confirmAction() {
  if (confirmCb) confirmCb();
  confirmCb = null;
  closeModal("modal-confirm");
}

// ======================== Helpers ========================
function daysDiff(d) {
  if (!d) return 9999;
  return Math.ceil((new Date(d) - new Date()) / 864e5);
}
function invTotal(inv) {
  return (inv.totalSum) || (inv.items || []).reduce((s, i) => s + Number(i.amount || 0), 0);
}
function fmt(n) { return Number(n || 0).toLocaleString("ar-EG", { maximumFractionDigits: 0 }); }
function openModal(id) { document.getElementById(id).classList.add("open"); }
function closeModal(id) { document.getElementById(id).classList.remove("open"); }
document.querySelectorAll(".backdrop").forEach(b => b.addEventListener("click", e => { if (e.target === b) b.classList.remove("open"); }));
let toastT;
function toast(msg, type, duration) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = "show" + (type ? " " + type : "");
  clearTimeout(toastT);
  toastT = setTimeout(() => el.className = "", duration || 3200);
}

// ======================== Auto Logout (30 min) ========================
function resetIdle() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (currentUser) { doLogout(); alert("⏱️ تم الخروج التلقائي بسبب الخمول (30 دقيقة)."); }
  }, 30 * 60 * 1000);
}
document.addEventListener("click", resetIdle);
document.addEventListener("keydown", resetIdle);
document.addEventListener("touchstart", resetIdle);

// ======================== Live Sync ========================
db.ref("/").on("value", snap => {
  const v = snap.val();
  if (!v) return;
  SYS.cars = v.cars || {};
  SYS.violations = v.violations || {};
  SYS.supervisors = v.supervisors || {};
  SYS.invoices = v.invoices || {};
  SYS.config = v.config || SYS.config;
  SYS.managerExpenses = v.managerExpenses || {};
  SYS.managerAssignments = v.managerAssignments || {};
  SYS.managerVisaCards = v.managerVisaCards || {};
  renderScreen(getCurrentScreen());
});

// ======================== FIREBASE SETTINGS & MIGRATION ========================

// --- Firebase Backup/Restore ---
function exportFirebaseBackup() {
  db.ref("/").once("value", snap => {
    const data = snap.val();
    if (!data) { toast("لا توجد بيانات للتصدير", "warn"); return; }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "backup_firebase_" + new Date().toISOString().split("T")[0] + ".json";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    toast("✅ تم تصدير النسخة الاحتياطية", "ok");
  });
}

function importFirebaseBackup(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = JSON.parse(e.target.result);
      if (!data || typeof data !== "object") throw new Error("الملف غير صالح");
      if (!confirm("⚠️ سيتم استبدال كل البيانات الحالية بالبيانات من الملف!\nهل أنت متأكد؟")) return;
      db.ref("/").set(data, () => {
        toast("✅ تم استرجاع البيانات بنجاح", "ok");
        loadAll();
      });
    } catch (err) {
      toast("❌ خطأ في الملف: " + err.message, "err");
    }
  };
  reader.readAsText(file);
  event.target.value = "";
}

// --- Pre-loaded data from ALL Google Sheets ---
const PRELOADED_DRIVERS = [
  { name: "خالد عبدالسميع عبدالرازق حسين", car: "4795" },
  { name: "فتحي امام عبد السلام امام", car: "8435" },
  { name: "محمود عطيه ابراهيم محمد الشاذلى", car: "4616" },
  { name: "سعيد محمد ابراهيم محمود", car: "3481" },
  { name: "محمد ابراهيم حسن موسى", car: "6814" },
  { name: "عادل عبدالنبى عبدالحميد الحلبى", car: "8245" },
  { name: "عصام سعيد عبدالصادق حسن", car: "6171" },
  { name: "محمد احمد حسانين السيد", car: "5724" },
  { name: "محمد محمد حسن السيد", car: "9312" },
  { name: "علاء محمد محمد النحاس", car: "7425" },
  { name: "دياب اسماعيل عبد اللطيف محمود الجبالي", car: "8562" },
  { name: "حازم محمد محمد ابراهيم", car: "8562" },
  { name: "احمد بدوى محمد محمد", car: "4623" },
  { name: "محيي الدين علي عبد الحميد غنيم", car: "2547" },
  { name: "صالح ابراهيم عبد الله الجبالي", car: "3683" },
  { name: "سعيد عبدالعزيز عفيفى عبدالعال", car: "6242" },
  { name: "حسين جمعة حجاج السيد", car: "5734" },
  { name: "احمد فتحى السيد حسن", car: "4616" },
  { name: "اشرف عنتر على محمد", car: "8245" },
  { name: "هشام حمدان حسن نصار", car: "8265" },
  { name: "السيد سلمان عبدالمقصود حمد", car: "3171" },
  { name: "سعيد محمد فتوح عزب", car: "7896" },
  { name: "احمد محمد محمود حسن", car: "9283" },
  { name: "محمد عبدالله محمد عبدالوهاب", car: "1579" },
  { name: "محمد صبرى نبوى ابراهيم", car: "1273" },
  { name: "السيد ابراهيم عسران حفنى", car: "8265" },
  { name: "ابراهيم فتحى محمد محمد البواب", car: "8626" },
  { name: "عمر محمد حسن كمال عمر", car: "1496" },
  { name: "يحيى نجف عبدالله", car: "8562" },
  { name: "عزت ابراهيم عبدالعزيز السيد", car: "2538" },
  { name: "اشرف خليل برهامى مهدى عبدربه", car: "2579" },
  { name: "محمد صبحى مرسى حسن هيكل", car: "2547" },
  { name: "احمد حسين جمعه حجاج", car: "3526" },
  { name: "خالد محمد ابوالنجا محمد", car: "9124" },
  { name: "محسن صبحى عبدالحميد دراز", car: "7346" },
  { name: "احمد شريف احمد عبدالرازق", car: "5723" },
  { name: "سليمان مرغنى عبدالله سليمان", car: "5724" },
  { name: "احمد حسن هاشم عبدالله", car: "2483" },
  { name: "احمد شاكر السيد ابراهيم", car: "1371" },
  { name: "محمد السيد يحيى حسن", car: "9386" },
  { name: "محمد احمد محمد احمد", car: "4742" },
  { name: "احمد محمود فوزى احمد", car: "1566" },
  { name: "احمد عبدالعليم محمد طه عريبه", car: "5734" },
  { name: "ياسر عبدالله محمد على", car: "2853" },
  { name: "محمد ابراهيم احمد عوض", car: "7352" },
  { name: "على مصطفى تهامى مسلم", car: "8176" },
  { name: "محمود عبداللطيف احمد احمد", car: "1928" },
  { name: "اسلام محمد سيد محمد", car: "6576" },
  { name: "محمود عبدالغفار جودة دسوقى", car: "7423" },
  { name: "احمد محمد السيد خليل", car: "6981" },
  { name: "احمد على محروس محمد الانشاصى", car: "3" },
  { name: "محمود فتحى محمد محمد", car: "7642" },
  { name: "سامح صلاح امين غريب", car: "5642" },
  { name: "احمد سعيد احمد حسن", car: "9759" },
  { name: "منصور على عبدالشكور على", car: "1216" },
  { name: "عبدالرحمن ايمن احمد عزب", car: "1235" },
  { name: "اسامة شحتة عبدالفتاح عطية", car: "8637" },
  { name: "محمد حسين عبدالفتاح حسين", car: "9241" },
  { name: "محمود مهدى احمد احمد", car: "1519" },
  { name: "يوسف اسماعيل صباحى عبداللطيف", car: "7697" },
  { name: "النطرون", car: "5161" },
  { name: "عادل رشوان", car: "6814" },
  { name: "عمرو لينا", car: "2467" },
  { name: "لينا", car: "2469" },
  { name: "خالد محمود", car: "7912" },
  { name: "سعيد محمد شوقى", car: "1358" },
  { name: "ىحىى البدرى", car: "5734" },
  { name: "احمد محمود عبدالخالق", car: "5723" },
  { name: "فتحى صابر على", car: "1666" },
  { name: "احمد عبدالله", car: "9386" },
  { name: "ايهاب السيد", car: "1928" },
  { name: "عبدالعال الشحات", car: "2547" },
  { name: "محى الدين", car: "2547" }
];

const PRELOADED_CARS_ONLY = [
  "2156","2916","7385","2198","5468","6941","7362","2476","2136",
  "1","6334","2976","7378","7535","7537","6268","9231"
];

// سجل المخالفات
const PRELOADED_VIOLATIONS = [
  { date:"2025-12-23", driver:"عادل عبدالنبى عبدالحميد الحلبى", car:"8245", desc:"حرام امان", amount:400 },
  { date:"2025-09-20", driver:"عمر محمد حسن كمال عمر", car:"1928", desc:"سرعه", amount:700 },
  { date:"2025-11-23", driver:"احمد سعيد احمد حسن", car:"7961", desc:"حرام", amount:200 },
  { date:"2025-10-09", driver:"احمد سعيد احمد حسن", car:"7642", desc:"سرعه", amount:700 },
  { date:"2025-11-17", driver:"احمد سعيد احمد حسن", car:"7642", desc:"سرعه", amount:700 },
  { date:"2025-11-12", driver:"احمد عبدالعليم محمد طه عريبه", car:"2591", desc:"سرعه", amount:700 },
  { date:"2025-05-10", driver:"محمد صبرى نبوى ابراهيم", car:"7684", desc:"سرعه", amount:700 },
  { date:"2025-07-20", driver:"محمد صبرى نبوى ابراهيم", car:"7684", desc:"سرعه", amount:700 },
  { date:"2025-07-31", driver:"محمد صبرى نبوى ابراهيم", car:"7684", desc:"سرعه", amount:700 },
  { date:"2025-10-20", driver:"محمد صبرى نبوى ابراهيم", car:"7684", desc:"سرعه", amount:700 },
  { date:"2025-09-21", driver:"اسامة شحتة عبدالفتاح عطية", car:"7684", desc:"استعمال النطرون", amount:200 },
  { date:"2025-11-16", driver:"عبدالرحمن ايمن احمد عزب", car:"7684", desc:"سرعه", amount:700 },
  { date:"2026-01-20", driver:"محمد عصافيرى ابراهيم محمد الشاذلى", car:"9124", desc:"سرعه", amount:2800 },
  { date:"2026-01-20", driver:"احمد عبدالعليم محمد طه عريبه", car:"2591", desc:"سرعه", amount:400 },
  { date:"2026-01-20", driver:"احمد عبدالعليم محمد طه عريبه", car:"2591", desc:"سرعه", amount:700 },
  { date:"2026-01-20", driver:"احمد محمود فوزى احمد", car:"9283", desc:"سرعه", amount:700 },
  { date:"2026-01-20", driver:"احمد عبدالعليم محمد طه عريبه", car:"9283", desc:"حرام", amount:200 },
  { date:"2026-01-20", driver:"احمد عبدالعليم محمد طه عريبه", car:"9283", desc:"سرعه", amount:200 },
  { date:"2025-11-12", driver:"هشام حمدان حسن نصار", car:"1273", desc:"عدم ارتداء حزام الامان", amount:1200 },
  { date:"2025-06-06", driver:"هشام حمدان حسن نصار", car:"1273", desc:"سرعه", amount:700 },
  { date:"2025-10-21", driver:"هشام حمدان حسن نصار", car:"1273", desc:"حرام", amount:200 },
  { date:"2025-11-22", driver:"هشام حمدان حسن نصار", car:"1273", desc:"سرعه", amount:700 },
  { date:"2026-01-01", driver:"هشام حمدان حسن نصار", car:"1273", desc:"سرعه", amount:700 },
  { date:"2026-01-20", driver:"محمد احمد حسانين السيد", car:"5724", desc:"سرعه (1)", amount:7700 },
  { date:"2026-01-20", driver:"محمد احمد حسانين السيد", car:"5724", desc:"حرام (2)", amount:1400 },
  { date:"2026-01-20", driver:"عادل عبدالنبى عبدالحميد الحلبى", car:"8245", desc:"سرعه (1)", amount:2800 },
  { date:"2026-01-20", driver:"محمد السيد يحيى حسن", car:"5468", desc:"سرعه (2)", amount:4900 },
  { date:"2026-01-20", driver:"محمد السيد يحيى حسن", car:"5468", desc:"حرام", amount:200 },
  { date:"2026-01-20", driver:"السيد ابراهيم عسران حفنى", car:"8265", desc:"سرعه", amount:700 },
  { date:"2026-01-20", driver:"النطرون", car:"1215", desc:"سرعه (3)", amount:1400 },
  { date:"2026-01-20", driver:"دياب اسماعيل عبد اللطيف محمود الجبالي", car:"2781", desc:"سرعه (4)", amount:1500 },
  { date:"2025-08-04", driver:"محمد الاربى احمد عوض", car:"2591", desc:"سرعه", amount:700 },
  { date:"2025-08-04", driver:"ابراهيم فتحى محمد محمد البواب", car:"2591", desc:"حرام", amount:200 },
  { date:"2025-08-04", driver:"خالد محمد ابوالنجا محمد", car:"2198", desc:"سرعه (5)", amount:3900 },
  { date:"2026-01-04", driver:"محمد عبدالعليم محمد عبدالخالق", car:"1566", desc:"سرعه (6)", amount:1400 },
  { date:"2025-12-21", driver:"عادل رشوان", car:"7385", desc:"حرام", amount:200 },
  { date:"2025-08-24", driver:"عمرو لينا", car:"7385", desc:"حرام", amount:200 },
  { date:"2025-07-02", driver:"دياب اسماعيل عبد اللطيف محمود الجبالي", car:"6538", desc:"مخالفة سرعة الزحمة الالكترونية", amount:400 },
  { date:"2025-07-03", driver:"محيي الدين علي عبد الحميد غنيم", car:"6538", desc:"سرعه", amount:700 },
  { date:"2025-07-06", driver:"محيي الدين علي عبد الحميد غنيم", car:"6538", desc:"سرعه", amount:700 },
  { date:"2025-09-20", driver:"محيي الدين علي عبد الحميد غنيم", car:"6538", desc:"سرعه", amount:700 },
  { date:"2025-10-06", driver:"محيي الدين علي عبد الحميد غنيم", car:"6538", desc:"سرعه", amount:700 },
  { date:"2025-12-17", driver:"محيي الدين علي عبد الحميد غنيم", car:"6538", desc:"سرعه", amount:700 },
  { date:"2025-12-21", driver:"لينا", car:"3526", desc:"سرعه", amount:400 },
  { date:"2025-11-06", driver:"عصام سعيد عبدالصادق حسن", car:"3481", desc:"حرام", amount:200 },
  { date:"2025-10-06", driver:"خالد محمود", car:"7642", desc:"سرعه", amount:700 },
  { date:"2025-11-17", driver:"خالد محمود", car:"7642", desc:"سرعه", amount:700 },
  { date:"2025-08-07", driver:"احمد شاكر السيد ابراهيم", car:"1358", desc:"سرعه", amount:400 },
  { date:"2025-09-09", driver:"احمد شاكر السيد ابراهيم", car:"1358", desc:"سرعه", amount:700 },
  { date:"2025-10-09", driver:"احمد شاكر السيد ابراهيم", car:"1358", desc:"سرعه", amount:700 },
  { date:"2025-10-01", driver:"سليمان مرغنى عبدالله سليمان", car:"2547", desc:"سرعه", amount:700 },
  { date:"2025-11-08", driver:"سليمان مرغنى عبدالله سليمان", car:"2547", desc:"سرعه", amount:700 },
  { date:"2026-01-04", driver:"صالح ابراهيم عبد الله الجبالي", car:"1928", desc:"حرام", amount:700 },
  { date:"2025-10-01", driver:"حازم محمد محمد ابراهيم", car:"8562", desc:"سرعه", amount:700 },
  { date:"2025-10-12", driver:"حازم محمد محمد ابراهيم", car:"8562", desc:"سرعه", amount:700 },
  { date:"2025-08-12", driver:"حازم محمد محمد ابراهيم", car:"8562", desc:"سرعه", amount:700 },
  { date:"2026-02-20", driver:"محمد احمد حسانين السيد", car:"1278", desc:"سرعه 2026/1/19 - 2026/1/19 - التحليلى", amount:1800 },
  { date:"2026-02-20", driver:"محمد احمد حسانين السيد", car:"1278", desc:"حرام 2026/1/19 - 2026/1/19", amount:600 },
  { date:"2025-12-13", driver:"محمد حسين عبدالفتاح حسين", car:"4616", desc:"مخالفة سرعة الزحمة الالكترونية الابتدائى", amount:400 },
  { date:"2026-02-10", driver:"عمر محمد حسن كمال عمر", car:"1579", desc:"مخالفة 4 المروى الابتدائى سرعة حد الاجره (50) السعة", amount:700 },
  { date:"2026-03-24", driver:"سعيد محمد شوقى", car:"2547", desc:"سرعه", amount:700 },
  { date:"2026-04-03", driver:"حازم محمد محمد ابراهيم", car:"8562", desc:"مخالفة 4 المروى الابتدائى", amount:700 },
  { date:"2026-03-08", driver:"حازم محمد محمد ابراهيم", car:"8562", desc:"مخالفة طريق استكمال المسرعين", amount:700 },
  { date:"2026-04-14", driver:"حازم محمد محمد ابراهيم", car:"8562", desc:"مخالفة 4 المروى الابتدائى", amount:700 },
  { date:"2026-04-14", driver:"دياب اسماعيل عبد اللطيف محمود الجبالي", car:"8562", desc:"مخالفة 4 المروى الابتدائى", amount:700 },
  { date:"2026-02-23", driver:"السيد ابراهيم عسران حفنى", car:"8265", desc:"الاونت الكهربائية المسرعى الكلى 27 (سرعه)", amount:700 },
  { date:"2026-03-19", driver:"السيد ابراهيم عسران حفنى", car:"8265", desc:"طريق ثانى الكهربائية المسرعى الكلى 27 (برعه)", amount:700 },
  { date:"2026-03-21", driver:"محمد السيد يحيى حسن", car:"8265", desc:"مخالفة ربط الأطفال المسرعى الكلى", amount:700 },
  { date:"2026-03-25", driver:"هشام حمدان حسن نصار", car:"8265", desc:"طريق ربط الأطفال المسرعى الكلى 27 (برعه)", amount:700 },
  { date:"2026-04-10", driver:"السيد ابراهيم عسران حفنى", car:"8265", desc:"الموقف الراقي نفق المركب الحديث المئى", amount:700 },
  { date:"2026-02-17", driver:"محمد ابراهيم حسن موسى", car:"6814", desc:"مخالفة طريق استكمال المسرعين", amount:700 },
  { date:"2026-04-07", driver:"محمد ابراهيم حسن موسى", car:"6814", desc:"مخالفة 4 المروى الابتدائى", amount:700 },
  { date:"2026-01-01", driver:"حسين محمد عبدالخالق", car:"5734", desc:"حرام امان", amount:200 },
  { date:"2026-01-01", driver:"حسين محمد عبدالخالق", car:"5734", desc:"حرام امان", amount:200 },
  { date:"2026-01-29", driver:"حسين محمد عبدالخالق", car:"5734", desc:"مخالفة الابتدائى", amount:400 },
  { date:"2026-01-23", driver:"احمد محمود عبدالخالق", car:"5723", desc:"مخالفة 4 المروى الابتدائى", amount:700 },
  { date:"2026-01-26", driver:"احمد محمود عبدالخالق", car:"5723", desc:"مخالفة 4 المروى الابتدائى", amount:700 },
  { date:"2026-04-06", driver:"احمد محمود عبدالخالق", car:"5723", desc:"مخالفة طريق استكمال المسرعين", amount:700 },
  { date:"2026-04-10", driver:"احمد محمود عبدالخالق", car:"5723", desc:"مخالفة 4 المروى الابتدائى", amount:700 },
  { date:"2026-02-06", driver:"محمد احمد حسانين السيد", car:"5724", desc:"مخالفة طريق استكمال المسرعين", amount:700 },
  { date:"2026-02-06", driver:"محمد احمد حسانين السيد", car:"5724", desc:"بلي斯顿 المسرعين الكلى 17", amount:200 },
  { date:"2026-02-21", driver:"محمد احمد حسانين السيد", car:"5724", desc:"بلي斯顿 الرزاقى (حرام امان)", amount:200 },
  { date:"2026-03-24", driver:"محمد احمد حسانين السيد", car:"5724", desc:"مخالفة 4 المروى الابتدائى", amount:700 },
  { date:"2026-04-08", driver:"محيي الدين علي عبد الحميد غنيم", car:"2547", desc:"مخالفة 4 المروى الابتدائى", amount:700 },
  { date:"2026-04-16", driver:"محيي الدين علي عبد الحميد غنيم", car:"2547", desc:"مخالفة 4 المروى الابتدائى", amount:700 },
  { date:"2026-01-01", driver:"عادل عبدالنبى عبدالحميد الحلبى", car:"8245", desc:"سرعه", amount:700 },
  { date:"2025-12-05", driver:"احمد عبادة", car:"9386", desc:"رادار مخالفة طريق استكمال المسرعين -", amount:700 },
  { date:"2026-04-22", driver:"احمد عبادة", car:"9386", desc:"مخالفة 4 المروى الابتدائى", amount:700 },
  { date:"2026-03-29", driver:"ايهاب السيد", car:"1928", desc:"طريق المليسين الكهربائية اسكتكالم رادار امان", amount:200 },
  { date:"2026-05-13", driver:"محمد احمد حسانين السيد", car:"5724", desc:"مخالفة 4 المروى الابتدائى", amount:700 },
  { date:"2026-05-07", driver:"محيي الدين", car:"2547", desc:"رادار مخالفة طريق استكمال المسرعين", amount:700 },
  { date:"2026-05-13", driver:"محيي الدين", car:"2547", desc:"مخالفة 4 المروى الابتدائى", amount:700 }
];

// سجل الخصومات
const PRELOADED_DEDUCTIONS = [
  { date:"2026-01-26", driver:"عادل عبدالنبى عبدالحميد الحلبى", amount:1000, type:"خصم" },
  { date:"2026-01-26", driver:"عمر محمد حسن كمال عمر", amount:1000, type:"خصم" },
  { date:"2026-01-26", driver:"احمد سعيد احمد حسن", amount:1000, type:"خصم" },
  { date:"2026-01-26", driver:"احمد عبدالعليم محمد طه عريبه", amount:1000, type:"خصم" },
  { date:"2026-01-26", driver:"محمد صبرى نبوى ابراهيم", amount:1000, type:"خصم" },
  { date:"2026-01-26", driver:"عبدالرحمن ايمن احمد عزب", amount:900, type:"خصم" },
  { date:"2026-01-26", driver:"محمد عصافيرى ابراهيم محمد الشاذلى", amount:1000, type:"خصم" },
  { date:"2026-01-26", driver:"احمد عبدالعليم محمد طه عريبه", amount:1800, type:"خصم" },
  { date:"2026-01-26", driver:"هشام حمدان حسن نصار", amount:1000, type:"خصم" },
  { date:"2026-01-26", driver:"محمد السيد يحيى حسن", amount:700, type:"خصم" },
  { date:"2026-01-26", driver:"السيد ابراهيم عسران حفنى", amount:1000, type:"خصم" },
  { date:"2026-01-26", driver:"اب اسماعيل عبد اللطيف محمود الجبالي", amount:700, type:"خصم" },
  { date:"2026-01-26", driver:"محمد الاربى احمد عوض", amount:200, type:"خصم" },
  { date:"2026-01-26", driver:"ابراهيم فتحى محمد محمد البواب", amount:1000, type:"خصم" },
  { date:"2026-01-26", driver:"خالد محمد ابوالنجا محمد", amount:1000, type:"خصم" },
  { date:"2026-01-26", driver:"محيي الدين علي عبد الحميد غنيم", amount:1000, type:"خصم" },
  { date:"2026-01-26", driver:"عصام سعيد عبدالصادق حسن", amount:200, type:"خصم" },
  { date:"2026-01-26", driver:"احمد شاكر السيد ابراهيم", amount:1000, type:"خصم" },
  { date:"2026-01-26", driver:"سليمان مرغنى عبدالله سليمان", amount:700, type:"خصم" },
  { date:"2026-01-26", driver:"حازم محمد محمد ابراهيم", amount:1000, type:"خصم" },
  { date:"2026-01-26", driver:"محمد احمد حسانين السيد", amount:1000, type:"خصم" },
  { date:"2026-02-22", driver:"علاء محمد محمد النحاس", amount:1000, type:"خصم" },
  { date:"2026-02-22", driver:"علاء محمد محمد النحاس", amount:3000, type:"خصم" },
  { date:"2026-02-22", driver:"عمر محمد حسن كمال عمر", amount:400, type:"خصم" },
  { date:"2026-02-22", driver:"احمد عبدالعليم محمد طه عريبه", amount:100, type:"خصم" },
  { date:"2026-02-22", driver:"محمد صبرى نبوى ابراهيم", amount:1000, type:"خصم" },
  { date:"2026-02-22", driver:"محمود عبداللطيف احمد احمد", amount:1000, type:"خصم" },
  { date:"2026-02-22", driver:"محمد احمد حسانين السيد", amount:1000, type:"خصم" },
  { date:"2026-02-22", driver:"هشام حمدان حسن نصار", amount:1000, type:"خصم" },
  { date:"2026-02-22", driver:"اب اسماعيل عبد اللطيف محمود الجبالي", amount:1000, type:"خصم" },
  { date:"2026-02-22", driver:"خالد محمد ابوالنجا محمد", amount:1000, type:"خصم" },
  { date:"2026-02-22", driver:"محيي الدين علي عبد الحميد غنيم", amount:400, type:"خصم" },
  { date:"2026-02-22", driver:"محيي الدين علي عبد الحميد غنيم", amount:1000, type:"خصم" },
  { date:"2026-02-22", driver:"احمد شاكر السيد ابراهيم", amount:800, type:"خصم" },
  { date:"2026-02-22", driver:"حازم محمد محمد ابراهيم", amount:500, type:"خصم" },
  { date:"2026-01-01", driver:"عمر محمد حسن كمال عمر", amount:700, type:"خصم" },
  { date:"2026-01-02", driver:"احمد سعيد احمد حسن", amount:600, type:"خصم" },
  { date:"2026-01-03", driver:"محمد صبرى نبوى ابراهيم", amount:800, type:"خصم" },
  { date:"2026-01-04", driver:"اسلام محمد سيد محمد", amount:700, type:"خصم" },
  { date:"2026-01-05", driver:"محمود عبداللطيف احمد احمد", amount:800, type:"خصم" },
  { date:"2026-01-06", driver:"هشام حمدان حسن نصار", amount:1500, type:"خصم" },
  { date:"2026-01-07", driver:"محمد احمد حسانين السيد", amount:0, type:"خصم" },
  { date:"2026-01-08", driver:"محمد احمد حسانين السيد", amount:1000, type:"خصم" },
  { date:"2026-01-09", driver:"محمد السيد يحيى حسن", amount:1000, type:"خصم" },
  { date:"2026-01-10", driver:"خالد محمد ابوالنجا محمد", amount:1000, type:"خصم" },
  { date:"2026-01-11", driver:"محيي الدين علي عبد الحميد غنيم", amount:1500, type:"خصم" },
  { date:"2026-01-12", driver:"سليمان مرغنى عبدالله سليمان", amount:1400, type:"خصم" },
  { date:"2026-04-20", driver:"محمد احمد حسانين السيد", amount:1000, type:"خصم" },
  { date:"2026-04-20", driver:"محمد السيد يحيى حسن", amount:1000, type:"خصم" },
  { date:"2026-04-20", driver:"السيد ابراهيم عسران حفنى", amount:1000, type:"خصم" },
  { date:"2026-04-20", driver:"خالد محمد ابوالنجا محمد", amount:900, type:"خصم" },
  { date:"2026-04-20", driver:"حازم محمد محمد ابراهيم", amount:1000, type:"خصم" },
  { date:"2026-04-20", driver:"علاء محمد محمد النحاس", amount:1000, type:"خصم" },
  { date:"2026-04-20", driver:"محمد ابراهيم حسن موسى", amount:1400, type:"خصم" },
  { date:"2026-04-20", driver:"محيي الدين علي عبد الحميد غنيم", amount:1000, type:"خصم" },
  { date:"2026-02-03", driver:"سعيد محمد شوقى", amount:700, type:"خصم" },
  { date:"2026-04-20", driver:"نحى البدرى", amount:800, type:"خصم" },
  { date:"2026-04-21", driver:"احمد محمود عبدالخالق", amount:1000, type:"خصم" },
  { date:"2026-03-20", driver:"محمد حسين عبدالفتاح حسين", amount:400, type:"خصم" },
  { date:"2026-05-17", driver:"محمد احمد حسانين السيد", amount:1000, type:"خصم" },
  { date:"2026-05-17", driver:"محمد احمد حسانين السيد", amount:550, type:"خصم" },
  { date:"2026-05-17", driver:"محمد السيد يحيى حسن", amount:900, type:"خصم" },
  { date:"2026-05-17", driver:"السيد ابراهيم عسران حفنى", amount:600, type:"خصم" },
  { date:"2026-05-17", driver:"اب اسماعيل عبد اللطيف محمود الجبالي", amount:400, type:"خصم" },
  { date:"2026-05-17", driver:"محيي الدين علي عبد الحميد غنيم", amount:400, type:"خصم" },
  { date:"2026-05-17", driver:"علاء محمد محمد النحاس", amount:200, type:"خصم" },
  { date:"2026-05-17", driver:"ايهاب السيد", amount:400, type:"خصم" },
  { date:"2026-05-17", driver:"محى الدين", amount:900, type:"خصم" },
  { date:"2026-05-17", driver:"احمد محمود عبدالخالق", amount:850, type:"خصم" }
];

// Cars without drivers (from sheet — rows with only car numbers)
// بيانات التراخيص (من شيت البيانات)
const PRELOADED_LICENSES = [
  { carNumber:"1", company:"ايهام النسسى", carType:"دبة كابينة", chassis:"4213784", motor:"3290740", driver:"ايهام النسسى", expiry:"2028-01-15" },
  { carNumber:"3", company:"ايهام النسسى", carType:"دبة", chassis:"7116141", motor:"4495", driver:"قادر فرونس", expiry:"2026-09-30" },
  { carNumber:"1215", company:"قادر فرونس", carType:"دبابة", chassis:"7109772", motor:"252565", driver:"مينا الفتح شيفورلي", expiry:"2026-05-12" },
  { carNumber:"1216", company:"مصر للنقل", carType:"نقل كابينة", chassis:"10864", motor:"3338297", driver:"مسيح النصر", expiry:"2026-10-14" },
  { carNumber:"1235", company:"مصر للنقل", carType:"دبابة", chassis:"70025450", motor:"6024024", driver:"فتحى صابر", expiry:"2026-06-25" },
  { carNumber:"1273", company:"ذورجن امبكت", carType:"دبة كابينة", chassis:"3649", motor:"839", driver:"احمد شاكر السيد", expiry:"2026-08-14" },
  { carNumber:"1278", company:"مصر للفرس", carType:"جامبو", chassis:"7104670", motor:"741256", driver:"ابراهيم فتحى محمد", expiry:"2026-11-09" },
  { carNumber:"1358", company:"مصر للنوربات", carType:"نترنو", chassis:"432724", motor:"273638", driver:"احمد شاكر السيد", expiry:"2026-07-22" },
  { carNumber:"1371", company:"مصر للنوربات", carType:"نترنو", chassis:"370025054", motor:"6021884", driver:"فخرى صابر", expiry:"2026-07-18" },
  { carNumber:"1496", company:"مصر للنوربات", carType:"دبة", chassis:"3815", motor:"52839", driver:"عمر محمد حسن كمال عمر", expiry:"2026-09-16" },
  { carNumber:"1519", company:"احدى الاسلام الارب", carType:"نترنو", chassis:"############", motor:"969632", driver:"محمود مهدى احمد احمد", expiry:"2026-07-31" },
  { carNumber:"1566", company:"قادر فرونس", carType:"جامبو", chassis:"7100832", motor:"6073939", driver:"احمد محمود فوزى احمد", expiry:"2026-11-17" },
  { carNumber:"1579", company:"مصر للنوربات", carType:"دبة", chassis:"4170934", motor:"60022458", driver:"محمد عبدالله محمد عبدالوهاب", expiry:"2026-12-06" },
  { carNumber:"1633", company:"مصر للنوربات", carType:"نترنو", chassis:"7100729", motor:"4092635", driver:"", expiry:"2026-12-29" },
  { carNumber:"1928", company:"مصر للنوربات", carType:"نترنو", chassis:"4077126", motor:"747142", driver:"محمود عبداللطيف احمد احمد", expiry:"2026-10-08" },
  { carNumber:"2136", company:"مصر للنوربات", carType:"ملكى", chassis:"60022420", motor:"6002458", driver:"", expiry:"2026-11-17" },
  { carNumber:"2156", company:"مصر للنوربات", carType:"مرورا نارية", chassis:"131506", motor:"333113", driver:"", expiry:"2026-12-12" },
  { carNumber:"2198", company:"قادر فرونس", carType:"جامبو", chassis:"160017923", motor:"632196", driver:"", expiry:"2026-06-22" },
  { carNumber:"2467", company:"مصر للنوربات", carType:"ملكى", chassis:"4077126", motor:"60022458", driver:"عمرو لينا", expiry:"2026-08-11" },
  { carNumber:"2469", company:"مصر للنوربات", carType:"نترنو", chassis:"60022420", motor:"6002458", driver:"لينا", expiry:"2026-11-17" },
  { carNumber:"2476", company:"مصر للنوربات", carType:"نترنو", chassis:"131506", motor:"333113", driver:"", expiry:"2026-12-12" },
  { carNumber:"2483", company:"برادو جيب", carType:"نترنو", chassis:"160017923", motor:"632196", driver:"احمد حسن هاشم عبدالله", expiry:"2026-06-22" },
  { carNumber:"2538", company:"مصر للنوربات", carType:"اوتوبس", chassis:"233186", motor:"290239", driver:"عزت ابراهيم عبدالعزيز السيد", expiry:"2026-08-13" },
  { carNumber:"2547", company:"مصر للنوربات", carType:"اوتوبس", chassis:"233210", motor:"290273", driver:"محيي الدين علي عبد الحميد غنيم", expiry:"2026-05-29" },
  { carNumber:"2561", company:"ذورجن امبكت", carType:"دبة كابينة", chassis:"7102213", motor:"420230", driver:"", expiry:"2026-07-30" },
  { carNumber:"2579", company:"ذورجن امبكت", carType:"اوتوبس", chassis:"233169", motor:"287663", driver:"اشرف خليل برهامى مهدى عبدربه", expiry:"2026-08-08" },
  { carNumber:"2591", company:"مصر للنوربات", carType:"دبة كابينة", chassis:"946404", motor:"5246", driver:"احمد عبدالعليم محمد طه عريبه", expiry:"2027-01-02" },
  { carNumber:"2781", company:"ذورجن امبكت", carType:"جامبو", chassis:"57102210", motor:"88201", driver:"دياب اسماعيل عبد اللطيف محمود الجبالي", expiry:"2027-01-24" },
  { carNumber:"2853", company:"برادو جيب", carType:"نترنو", chassis:"18673", motor:"5636907", driver:"ياسر عبدالله محمد على", expiry:"2026-07-21" },
  { carNumber:"2916", company:"مصر للنوربات", carType:"جنيب", chassis:"4200488", motor:"531599", driver:"", expiry:"2026-11-17" },
  { carNumber:"2976", company:"قادر فرونس", carType:"ملكى", chassis:"967205", motor:"183110038", driver:"", expiry:"2028-05-03" },
  { carNumber:"3171", company:"النوربات", carType:"ملكى", chassis:"2010587", motor:"0", driver:"السيد سلمان عبدالمقصود حمد", expiry:"2026-06-09" },
  { carNumber:"3481", company:"ذورجن امبكت", carType:"نترنو", chassis:"57102210", motor:"88201", driver:"سعيد محمد ابراهيم محمود", expiry:"2027-01-09" },
  { carNumber:"3526", company:"قادر فرونس", carType:"نترنو", chassis:"7115994", motor:"483257", driver:"احمد حسين جمعه حجاج", expiry:"2026-06-17" },
  { carNumber:"4616", company:"مرسيس", carType:"مرسيس", chassis:"##########", motor:"422411", driver:"محمود عطيه ابراهيم محمد الشاذلى", expiry:"2026-12-30" },
  { carNumber:"4623", company:"مصر للنوربات", carType:"نترنو", chassis:"7108407", motor:"53281", driver:"احمد بدوى محمد محمد", expiry:"2026-06-11" },
  { carNumber:"4742", company:"مصر للنوربات", carType:"جامبو", chassis:"7110514", motor:"6329031", driver:"محمد احمد محمد احمد", expiry:"2026-06-02" },
  { carNumber:"4795", company:"ذورجن امبكت", carType:"نترنو", chassis:"85242", motor:"8196991", driver:"خالد عبدالسميع عبدالرازق حسين", expiry:"2026-07-11" },
  { carNumber:"5161", company:"مصر للنوربات", carType:"ملكى", chassis:"990569", motor:"1914300012", driver:"النطرون", expiry:"2026-10-21" },
  { carNumber:"5258", company:"مصر للنوربات", carType:"نترنو", chassis:"203602", motor:"1946", driver:"", expiry:"2026-09-09" },
  { carNumber:"5468", company:"ذورجن امبكت", carType:"دبابة نارية", chassis:"567291", motor:"363511", driver:"محمد السيد يحيى حسن", expiry:"2026-12-08" },
  { carNumber:"5642", company:"النوربات", carType:"برادو جيب", chassis:"900013643", motor:"5587610", driver:"سامح صلاح امين غريب", expiry:"2026-08-28" },
  { carNumber:"5649", company:"مصر للنوربات", carType:"مرورا نارية", chassis:"1077568", motor:"6227267", driver:"", expiry:"2026-11-14" },
  { carNumber:"5723", company:"قادر فرونس", carType:"جامبو", chassis:"128161", motor:"219", driver:"احمد محمود عبدالخالق", expiry:"2026-07-18" },
  { carNumber:"5724", company:"قادر فرونس", carType:"جامبو", chassis:"128164", motor:"264", driver:"محمد احمد حسانين السيد", expiry:"2026-07-18" },
  { carNumber:"5734", company:"مصر للنوربات", carType:"دبابة كابينة", chassis:"7128497", motor:"381368", driver:"حسين جمعة حجاج السيد", expiry:"2026-07-31" },
  { carNumber:"6171", company:"مصر للنوربات", carType:"ملكى", chassis:"55946406", motor:"1740", driver:"عصام سعيد عبدالصادق حسن", expiry:"2026-08-07" },
  { carNumber:"6242", company:"مصر للنوربات", carType:"نترنو", chassis:"903028086", motor:"7913221", driver:"سعيد عبدالعزيز عفيفى عبدالعال", expiry:"2026-10-08" },
  { carNumber:"6268", company:"مصر للنوربات", carType:"نترنو", chassis:"6412", motor:"842810", driver:"", expiry:"2026-08-11" },
  { carNumber:"6334", company:"", carType:"", chassis:"", motor:"", driver:"", expiry:"" },
  { carNumber:"6538", company:"مصر للنوربات", carType:"نترنو", chassis:"57102224", motor:"355384", driver:"دياب اسماعيل عبد اللطيف محمود الجبالي", expiry:"2026-11-16" },
  { carNumber:"6814", company:"مصر للنوربات", carType:"نترنو", chassis:"57102224", motor:"355384", driver:"محمد ابراهيم حسن موسى", expiry:"2026-11-16" },
  { carNumber:"6941", company:"", carType:"", chassis:"", motor:"", driver:"", expiry:"" },
  { carNumber:"7346", company:"", carType:"", chassis:"", motor:"", driver:"محسن صبحى عبدالحميد دراز", expiry:"" },
  { carNumber:"7352", company:"", carType:"", chassis:"", motor:"", driver:"محمد ابراهيم احمد عوض", expiry:"" },
  { carNumber:"7362", company:"", carType:"", chassis:"", motor:"", driver:"", expiry:"" },
  { carNumber:"7378", company:"", carType:"", chassis:"", motor:"", driver:"", expiry:"" },
  { carNumber:"7385", company:"", carType:"", chassis:"", motor:"", driver:"عادل رشوان", expiry:"" },
  { carNumber:"7423", company:"", carType:"", chassis:"", motor:"", driver:"محمود عبدالغفار جودة دسوقى", expiry:"" },
  { carNumber:"7425", company:"", carType:"", chassis:"", motor:"", driver:"علاء محمد محمد النحاس", expiry:"" },
  { carNumber:"7535", company:"", carType:"", chassis:"", motor:"", driver:"", expiry:"" },
  { carNumber:"7537", company:"", carType:"", chassis:"", motor:"", driver:"", expiry:"" },
  { carNumber:"7642", company:"", carType:"", chassis:"", motor:"", driver:"محمود فتحى محمد محمد", expiry:"" },
  { carNumber:"7697", company:"", carType:"", chassis:"", motor:"", driver:"يوسف اسماعيل صباحى عبداللطيف", expiry:"" },
  { carNumber:"7896", company:"", carType:"", chassis:"", motor:"", driver:"سعيد محمد فتوح عزب", expiry:"" },
  { carNumber:"7912", company:"", carType:"", chassis:"", motor:"", driver:"خالد محمود", expiry:"" },
  { carNumber:"8176", company:"", carType:"", chassis:"", motor:"", driver:"على مصطفى تهامى مسلم", expiry:"" },
  { carNumber:"8245", company:"", carType:"", chassis:"", motor:"", driver:"عادل عبدالنبى عبدالحميد الحلبى", expiry:"" },
  { carNumber:"8265", company:"", carType:"", chassis:"", motor:"", driver:"هشام حمدان حسن نصار", expiry:"" },
  { carNumber:"8435", company:"", carType:"", chassis:"", motor:"", driver:"فتحي امام عبد السلام امام", expiry:"" },
  { carNumber:"8562", company:"", carType:"", chassis:"", motor:"", driver:"حازم محمد محمد ابراهيم", expiry:"" },
  { carNumber:"8626", company:"", carType:"", chassis:"", motor:"", driver:"ابراهيم فتحى محمد محمد البواب", expiry:"" },
  { carNumber:"8637", company:"", carType:"", chassis:"", motor:"", driver:"اسامة شحتة عبدالفتاح عطية", expiry:"" },
  { carNumber:"9124", company:"", carType:"", chassis:"", motor:"", driver:"خالد محمد ابوالنجا محمد", expiry:"" },
  { carNumber:"9241", company:"", carType:"", chassis:"", motor:"", driver:"محمد حسين عبدالفتاح حسين", expiry:"" },
  { carNumber:"9283", company:"", carType:"", chassis:"", motor:"", driver:"احمد محمد محمود حسن", expiry:"" },
  { carNumber:"9312", company:"", carType:"", chassis:"", motor:"", driver:"محمد محمد حسن السيد", expiry:"" },
  { carNumber:"9386", company:"", carType:"", chassis:"", motor:"", driver:"محمد السيد يحيى حسن", expiry:"" },
  { carNumber:"9759", company:"", carType:"", chassis:"", motor:"", driver:"احمد سعيد احمد حسن", expiry:"" }
];

// ======================== Import All Preloaded Data ========================
function importAllPreloadedData() {
  const total = PRELOADED_DRIVERS.length + PRELOADED_CARS_ONLY.length
    + PRELOADED_VIOLATIONS.length + PRELOADED_DEDUCTIONS.length + PRELOADED_LICENSES.length;
  if (!confirm(`استيراد ${total} سجل إلى Firebase؟\n\n• ${PRELOADED_DRIVERS.length} سائق\n• ${PRELOADED_CARS_ONLY.length} سيارة بدون سائق\n• ${PRELOADED_VIOLATIONS.length} مخالفة\n• ${PRELOADED_DEDUCTIONS.length} خصم\n• ${PRELOADED_LICENSES.length} ترخيص\n\nسيتم إضافة البيانات إلى البيانات الحالية.`)) return;

  setStatus("loading", "جاري الاستيراد...");
  let count = 0;
  const existingCars = new Set(Object.values(SYS.cars).map(c => c.id));

  // 1. استيراد السائقين
  for (const d of PRELOADED_DRIVERS) {
    if (d.car && existingCars.has(d.car)) continue;
    db.ref("cars").push({
      id: d.car || "", chassis: "", motor: "", type: "", model: "",
      expiry: "", company: "", driverName: d.name
    });
    if (d.car) existingCars.add(d.car);
    count++;
  }

  // 2. استيراد السيارات بدون سائق
  for (const carNum of PRELOADED_CARS_ONLY) {
    if (existingCars.has(carNum)) continue;
    db.ref("cars").push({
      id: carNum, chassis: "", motor: "", type: "", model: "",
      expiry: "", company: "", driverName: ""
    });
    existingCars.add(carNum);
    count++;
  }

  // 3. استيراد المخالفات
  for (const v of PRELOADED_VIOLATIONS) {
    db.ref("violations").push({
      date: v.date, car: v.car || "إدارة", driver: v.driver,
      desc: v.desc, amount: v.amount
    });
    count++;
  }

  // 4. استيراد الخصومات
  for (const d of PRELOADED_DEDUCTIONS) {
    db.ref("violations").push({
      date: d.date, car: "إدارة", driver: d.driver,
      desc: "[خصم] " + (d.type || ""), amount: -Math.abs(d.amount)
    });
    count++;
  }

  // 5. استيراد التراخيص (تحديث بيانات السيارة)
  for (const l of PRELOADED_LICENSES) {
    const key = Object.keys(SYS.cars).find(k => SYS.cars[k].id === l.carNumber);
    if (key) {
      if (l.chassis) db.ref("cars/" + key + "/chassis").set(l.chassis);
      if (l.motor) db.ref("cars/" + key + "/motor").set(l.motor);
      if (l.company) db.ref("cars/" + key + "/company").set(l.company);
      if (l.carType) db.ref("cars/" + key + "/type").set(l.carType);
      if (l.expiry) db.ref("cars/" + key + "/expiry").set(l.expiry);
      if (l.driver && !SYS.cars[key].driverName) db.ref("cars/" + key + "/driverName").set(l.driver);
    } else {
      db.ref("cars").push({
        id: l.carNumber, chassis: l.chassis || "", motor: l.motor || "",
        type: l.carType || "", model: "", expiry: l.expiry || "",
        company: l.company || "", driverName: l.driver || ""
      });
      existingCars.add(l.carNumber);
    }
    count++;
  }

  setStatus("ok", `✅ تم استيراد ${count} سجل بنجاح`);
  toast(`✅ تم استيراد ${count} سجل بنجاح!`, "ok");
  loadAll();
}

function setMigrationUrl() {
  migrationSheetUrl = document.getElementById("migration-url").value.trim();
  if (!migrationSheetUrl) { alert("أدخل رابط الشيت!"); return; }
  toast("✅ تم حفظ الرابط", "ok");
}

async function fetchSheetData() {
  let url = migrationSheetUrl || document.getElementById("migration-url").value.trim();
  if (!url) { alert("أدخل رابط Google Sheet!"); return; }

  setStatus("loading", "جاري جلب البيانات من Google Sheets...");
  document.getElementById("migration-preview").style.display = "none";
  migrationResults = { drivers: [], violations: [], deductions: [], licenses: [], accounts: [] };

  // Build CSV URL from any Google Sheets link
  let csvUrl = url;
  if (url.includes("/pub?")) {
    // Published URL — replace output type with csv
    csvUrl = url.replace(/output=[^&]+/, "output=csv");
  } else if (url.includes("/edit") || url.includes("/d/")) {
    const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (match) csvUrl = `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=csv&gid=0`;
  }

  console.log("[Migration] CSV URL:", csvUrl);

  // Method 1: Direct fetch
  try {
    const resp = await fetch(csvUrl);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const csv = await resp.text();
    if (!csv || csv.length < 10) throw new Error("الرد فارغ");
    console.log("[Migration] CSV received, length:", csv.length);
    parseAndLoadCSV(csv);
    return;
  } catch (err) {
    console.warn("[Migration] Direct fetch failed:", err.message);
  }

  // Method 2: Load via script tag (bypasses CORS)
  try {
    const scriptUrl = csvUrl + "&callback=_csvCallback";
    await new Promise((resolve, reject) => {
      window._csvCallback = function(data) {
        resolve(data);
        delete window._csvCallback;
      };
      const s = document.createElement("script");
      s.src = scriptUrl;
      s.onerror = () => reject(new Error("script load failed"));
      document.head.appendChild(s);
      setTimeout(() => { reject(new Error("timeout")); }, 10000);
    });
  } catch (err2) {
    console.warn("[Migration] Script method failed:", err2.message);
  }

  // Method 3: Try via proxy
  try {
    const proxyUrl = "https://api.allorigins.win/raw?url=" + encodeURIComponent(csvUrl);
    const resp = await fetch(proxyUrl);
    if (!resp.ok) throw new Error(`Proxy HTTP ${resp.status}`);
    const csv = await resp.text();
    if (!csv || csv.length < 10) throw new Error("Proxy response empty");
    console.log("[Migration] Proxy CSV received, length:", csv.length);
    parseAndLoadCSV(csv);
    return;
  } catch (err3) {
    console.error("[Migration] All methods failed");
  }

  // All methods failed — show file upload fallback
  toast("❌ تعذر الجلب المباشر!\n\n📦 استخدم طريقة الرفعيدوية:\n1. افتح الشيت في Google Sheets\n2. ملف → تحميل → CSV\n3. ارفع الملف من أعلى", "warn", 6000);
  setStatus("err", "فشل الجلب — استخدم رفع الملف يدوياً");
}

function parseAndLoadCSV(csv) {
  const rows = parseCSVText(csv);
  console.log("[Migration] Parsed rows:", rows.length);

  if (rows.length < 2) { toast("الشيت فارغ!", "warn"); setStatus("err", "الشيت فارغ"); return; }

  const headers = rows[0].map(h => String(h).trim());
  console.log("[Migration] Headers:", headers);

  // The sheet has: اسم السائق | رقم السيارة | ID
  // We know the exact structure, so hardcode it
  let driverCol = -1, carCol = -1, idCol = -1;
  headers.forEach((h, i) => {
    const hl = h.replace(/[\s_]/g, "");
    if (hl.includes("سائق") || hl.includes("اسم")) driverCol = i;
    else if (hl.includes("سيارة") || hl.includes("رقم")) carCol = i;
    else if (hl.toLowerCase().includes("id")) idCol = i;
  });

  // Fallback: assume columns are 0=name, 1=car, 2=id
  if (driverCol < 0) driverCol = 0;
  if (carCol < 0) carCol = 1;
  if (idCol < 0) idCol = 2;

  console.log("[Migration] Columns - driver:", driverCol, "car:", carCol, "id:", idCol);

  let count = 0, skipped = 0;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.every(c => !c)) { skipped++; continue; }

    let driverName = String(r[driverCol] || "").trim();
    let carNum = String(r[carCol] || "").trim();

    // Clean car number: remove trailing text like "4616 علف" → "4616"
    // Keep only digits and common plate characters
    const carClean = carNum.replace(/[^\d\u0600-\u06FF\w]/g, " ").trim();
    // Extract the numeric part
    const carMatch = carNum.match(/\d+/);
    carNum = carMatch ? carMatch[0] : carNum;

    // Skip rows with no useful data
    if (!driverName && !carNum) { skipped++; continue; }
    // Skip rows where driver name is just a number (car number误放在 name column)
    if (/^\d+\s/.test(driverName) && !carNum) {
      carNum = driverName.match(/\d+/)?.[0] || "";
      driverName = "";
    }
    // Skip completely empty names with only car numbers
    if (!driverName && carNum) {
      // Still add it — it's a car without a driver assigned yet
      driverName = "";
    }

    migrationResults.drivers.push({
      name: driverName,
      car: carNum,
      existingId: String(r[idCol] || "").trim()
    });
    count++;
  }

  console.log("[Migration] Drivers ready:", count, "Skipped:", skipped);
  setStatus(count > 0 ? "ok" : "err", count > 0 ? `✅ تم جلب ${count} سائق / سيارة` : "❌ لا توجد بيانات");
  renderMigrationPreview();
}

function detectColumns(headers) {
  const map = { name: -1, car: -1, id: -1 };
  headers.forEach((h, i) => {
    const hl = String(h).toLowerCase().replace(/[\s_]/g, "");
    if (hl.includes("سائق") || hl.includes("driver") || hl.includes("اسم")) map.name = i;
    else if (hl.includes("سيارة") || hl.includes("car") || hl.includes("رقم")) map.car = i;
    else if (hl.includes("id")) map.id = i;
  });
  // Fallback: first 3 columns
  if (map.name < 0) map.name = 0;
  if (map.car < 0 && headers.length > 1) map.car = 1;
  if (map.id < 0 && headers.length > 2) map.id = 2;
  return map;
}

function parseCSVText(text) {
  const lines = text.split("\n");
  return lines.map(line => {
    const result = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"') { inQuotes = !inQuotes; }
      else if (line[i] === "," && !inQuotes) { result.push(current.trim()); current = ""; }
      else { current += line[i]; }
    }
    result.push(current.trim());
    return result;
  }).filter(r => r.some(c => c));
}

function formatDateVal(d) {
  if (!d) return "";
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  const s = String(d).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}$/.test(s)) {
    const [a, b, c] = s.split(/[\/\-]/);
    return `${c}-${b.padStart(2, "0")}-${a.padStart(2, "0")}`;
  }
  return s;
}

function renderMigrationPreview() {
  const preview = document.getElementById("migration-preview");
  const stats = document.getElementById("migration-stats");
  const tbody = document.getElementById("migration-tbody");
  preview.style.display = "";

  const total = migrationResults.drivers.length;
  const withName = migrationResults.drivers.filter(d => d.name).length;
  const withoutName = total - withName;

  if (total === 0) {
    stats.innerHTML = '<span style="color:#dc2626;font-size:.82rem">❌ لا توجد بيانات — تأكد أن الشيت عام (Public) أو ارفع الملف يدوياً</span>';
    tbody.innerHTML = "";
    return;
  }

  stats.innerHTML = `
    <span class="tag tag-active" style="font-size:.82rem">👤 ${withName} سائق</span>
    ${withoutName > 0 ? `<span class="tag tag-pending" style="font-size:.82rem;margin-right:4px">🚗 ${withoutName} سيارة بدون سائق</span>` : ""}
  `;

  // Show drivers with names first, then those without
  const named = migrationResults.drivers.filter(d => d.name);
  const unnamed = migrationResults.drivers.filter(d => !d.name && d.car);

  let html = "";
  if (named.length) {
    html += '<tr><td colspan="3" style="background:#eff6ff;font-weight:700;font-size:.78rem">👤 السائقون والسيارات (' + named.length + ')</td></tr>';
    html += named.slice(0, 25).map((d, i) =>
      `<tr><td style="width:30px;color:#94a3b8">${i + 1}</td><td class="driver-cell">${d.name}</td><td class="car-cell">${d.car || "—"}</td></tr>`
    ).join("");
    if (named.length > 25) html += `<tr><td colspan="3" style="color:#64748b;text-align:center">... و ${named.length - 25} سائق آخرين</td></tr>`;
  }
  if (unnamed.length) {
    html += '<tr><td colspan="3" style="background:#fef3c7;font-weight:700;font-size:.78rem">🚗 سيارات بدون سائق محدد (' + unnamed.length + ')</td></tr>';
    html += unnamed.slice(0, 10).map(d =>
      `<tr><td style="color:#94a3b8">—</td><td style="color:#d97706;font-style:italic">بدون اسم</td><td class="car-cell">${d.car}</td></tr>`
    ).join("");
    if (unnamed.length > 10) html += `<tr><td colspan="3" style="color:#64748b;text-align:center">... و ${unnamed.length - 10} سيارة أخرى</td></tr>`;
  }

  tbody.innerHTML = html;
}

async function doMigration() {
  const total = migrationResults.drivers.length;
  if (total === 0) { toast("لا توجد بيانات للاستيراد!", "warn"); return; }
  if (!confirm(`استيراد ${total} سائق / سيارة إلى Firebase؟\nسيتم إضافة البيانات إلى البيانات الحالية.`)) return;

  setStatus("loading", "جاري الاستيراد...");
  let count = 0;
  let skipped = 0;

  try {
    for (const d of migrationResults.drivers) {
      // Check if car already exists
      const existingKey = Object.keys(SYS.cars).find(k => SYS.cars[k].id === d.car);
      if (existingKey) {
        // Update existing car with driver name if empty
        const existing = SYS.cars[existingKey];
        if (!existing.driverName && d.name) {
          db.ref("cars/" + existingKey + "/driverName").set(d.name);
          count++;
        } else {
          skipped++;
        }
      } else {
        db.ref("cars").push({
          id: d.car || "",
          chassis: "",
          motor: "",
          type: "",
          model: "",
          expiry: "",
          company: "",
          driverName: d.name
        });
        count++;
      }
    }

    setStatus("ok", `✅ تم استيراد ${count} سائق` + (skipped > 0 ? ` (تم تخطي ${skipped} مكرر)` : ""));
    toast(`✅ تم استيراد ${count} سائق` + (skipped > 0 ? ` — تخطي ${skipped} مكرر` : ""), "ok");
    loadAll();
  } catch (err) {
    toast("❌ خطأ: " + err.message, "err");
    setStatus("err", "فشل الاستيراد");
  }
}

// ======================== Init ========================
document.getElementById("login-pass").addEventListener("keydown", e => { if (e.key === "Enter") doLogin(); });
document.getElementById("login-user").addEventListener("keydown", e => { if (e.key === "Enter") document.getElementById("login-pass").focus(); });
