document.addEventListener("DOMContentLoaded", () => {
  const state = {
    customers: [], suppliers: [], inventory: [], saleCart: [], purchaseCart: [],
    currentStatement: null, currentBills: [],
    storeProfile: { name: "Agri Kisan Store", address: "", license: "" }
  };
  const $ = (id) => document.getElementById(id);
  const money = (value) => `₹${Number(value || 0).toFixed(2)}`;
  const number = (value) => Number(value || 0);
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
  const emptyRow = (columns, message) => `<tr><td colspan="${columns}" class="empty">${escapeHtml(message)}</td></tr>`;

  // --- Account & Auth Logic ---
  window.handleLogout = async function() {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch (e) { console.log("Logout error:", e); }
    window.location.href = "/login"; 
  };

  window.togglePasswordForm = function() {
    $("passwordForm").classList.toggle("hidden");
  };

  const passForm = $("passwordForm");
  if (passForm) {
    passForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const res = await api("/api/auth/change-password", {
          method: "POST",
          body: JSON.stringify({
            old_password: $("oldPassword").value,
            new_password: $("newPassword").value
          })
        });
        toast(res.message || "Password updated successfully.");
        passForm.reset();
        passForm.classList.add("hidden"); 
      } catch (error) { toast(error.message, true); }
    });
  }

  window.handleDeleteAccount = async function() {
    if (!confirm("Are you sure you want to delete your entire store account?")) return;
    const confirmSecond = prompt("Type 'DELETE' in capital letters to confirm permanent wipeout:");
    if (confirmSecond !== "DELETE") {
      alert("Account deletion canceled.");
      return;
    }

    try {
      const res = await api("/api/auth/delete-account", { method: "DELETE" });
      alert(res.message || "Account permanently deleted.");
      window.location.href = "/login";
    } catch (err) {
      toast(err.message, true);
    }
  };

  // --- Multi-Language Toggle ---
  window.toggleLanguage = function() {
    let currentLang = localStorage.getItem("appLanguage") || "en";
    let newLang = currentLang === "en" ? "hi" : "en";
    localStorage.setItem("appLanguage", newLang);
    updateLangButton();
    applyLanguage();
    toast(newLang === "hi" ? "भाषा बदल दी गई है।" : "Language updated to English.");
  };

  function updateLangButton() {
    const btn = $("mainLangToggleBtn");
    if (!btn) return;
    const currentLang = localStorage.getItem("appLanguage") || "en";
    btn.textContent = currentLang === "en" ? "अ/A हिन्दी" : "A/अ English";
  }

  function applyLanguage() {
    const lang = localStorage.getItem("appLanguage") || "en";
    if (typeof translations === "undefined" || !translations[lang]) return;
    const dict = translations[lang];
    
    const navButtons = document.querySelectorAll(".nav-button");
    if(navButtons.length > 0) {
      navButtons[0].textContent = dict.nav_dashboard || "Dashboard";
      navButtons[1].textContent = dict.nav_sales || "Sell";
      navButtons[2].textContent = dict.nav_purchase || "Purchase";
      if(navButtons[4]) navButtons[4].textContent = dict.nav_customers || "All Customers";
      if(navButtons[5]) navButtons[5].textContent = dict.nav_suppliers || "All Suppliers";
      if(navButtons[6]) navButtons[6].textContent = dict.nav_inventory || "Stock & Inventory";
      if(navButtons[7]) navButtons[7].textContent = dict.nav_reports || "Receipt and Bills";
    }
  }

  // --- Store Profile Management (Database Read-Only View) ---
  async function loadProfile() {
    updateLangButton(); 
    applyLanguage();
    try {
      const user = await api("/api/profile");
      const name = user.store_name || user.name || "Agri Kisan Store";
      const address = user.store_address || "";
      const license = user.store_license || "";

      $("storeName").value = name;
      $("storeAddress").value = address;
      $("storeLicense").value = license;
      $("displayStoreName").textContent = name;
      
      state.storeProfile = { name, address, license };
    } catch (e) {
      console.error("Failed to load user profile:", e);
    }
  }

  // --- Profile Verification Request to Distributor ---
  window.toggleProfileEditForm = function() {
    const form = $("profileEditRequestForm");
    if (!form) return;
    $("passwordForm")?.classList.add("hidden");
    form.classList.toggle("hidden");
    
    if (!form.classList.contains("hidden")) {
      $("reqStoreName").value = $("storeName").value;
      $("reqStoreAddress").value = $("storeAddress").value;
      $("reqStoreLicense").value = $("storeLicense").value;
    }
  };

  window.submitProfileRequest = async function(e) {
    e.preventDefault();
    const docFile = $("reqDocFile").files[0];
    if (!docFile) return toast("Please select a valid document proof.", true);

    const formData = new FormData();
    formData.append("shop_name", $("reqStoreName").value);
    formData.append("shop_address", $("reqStoreAddress").value);
    formData.append("license_gstin", $("reqStoreLicense").value);
    formData.append("document", docFile);

    try {
      const res = await fetch("/api/profile/request-update", {
        method: "POST",
        body: formData 
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Update submission failed.");
      
      toast("Request sent to distributor. Details will update upon approval.");
      $("profileEditRequestForm").reset();
      $("profileEditRequestForm").classList.add("hidden");
    } catch (err) {
      toast(err.message, true);
    }
  };

  // --- Core API Wrapper ---
  async function api(path, options = {}) {
    const response = await fetch(path, { headers: { "Content-Type": "application/json", ...(options.headers || {}) }, ...options });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Request failed.");
    return data;
  }

  function toast(message, error = false) {
    const element = $("toast");
    element.textContent = message; 
    element.classList.toggle("error", error); 
    element.classList.remove("hidden");
    clearTimeout(toast.timer); 
    toast.timer = setTimeout(() => element.classList.add("hidden"), 3600);
  }

  function setView(view, ledgerType) {
    const target = $(`${view}View`);
    if (!target) return toast("Screen not available.", true);
    document.querySelectorAll(".view").forEach((s) => s.classList.toggle("active", s === target));
    document.querySelectorAll(".nav-button").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
    if (view === "ledger" && ledgerType) { $("ledgerType").value = ledgerType; renderLedgerPartyOptions(); }
    if (view === "reports") loadSummary();
  }

  function openModal(id) { $(id).classList.remove("hidden"); }
  function closeModal(id) { $(id).classList.add("hidden"); }
  function options(items, label, includeBlank = true, blankLabel = "Select an option") {
    const first = includeBlank ? `<option value="">${escapeHtml(blankLabel)}</option>` : "";
    return first + items.map((i) => `<option value="${i.id}">${escapeHtml(label(i))}</option>`).join("");
  }

  let cachedSummary = null;
  async function loadSummary() {
    try {
      const summary = await api("/api/reports/summary");
      cachedSummary = summary;
      updateDashboardMetrics();
      $("reportSales").textContent = money(summary.sales_total); 
      $("reportPurchases").textContent = money(summary.purchases_total); 
      $("reportExpenses").textContent = money(summary.expenses_total);
      $("reportMargin").textContent = money(number(summary.sales_total) - number(summary.purchases_total) - number(summary.expenses_total));
    } catch (error) { toast(error.message, true); }
  }

  async function refreshAll() {
    try {
      const [customers, suppliers, inventory] = await Promise.all([
        api("/api/customers"), 
        api("/api/suppliers"), 
        api("/api/inventory")
      ]);
      state.customers = customers; 
      state.suppliers = suppliers; 
      state.inventory = inventory;
      
      renderParties(); 
      renderInventory(); 
      renderProductOptions(); 
      renderLedgerPartyOptions();
      
      await Promise.all([loadSummary(), loadLedger(), loadExpenses(), loadProfile()]);
    } catch (error) { toast(`Connection error: ${error.message}`, true); }
  }

  function renderParties() {
    $("purchaseParty").innerHTML = options(state.suppliers, (s) => `${s.agency_name} · Due ${money(s.outstanding_balance)}`, true, "Select supplier");
    renderCustomerTable(); 
    renderSupplierTable();
  }

  function renderCustomerTable() {
    const term = ($("customerSearch") ? $("customerSearch").value.toLowerCase() : "");
    const filtered = state.customers.filter(c => c.name.toLowerCase().includes(term) || String(c.phone).includes(term));
    $("customersTable").innerHTML = filtered.length 
      ? filtered.map((c) => `<tr>
          <td><strong>${escapeHtml(c.name)}</strong></td>
          <td>${escapeHtml(c.phone)}</td>
          <td>${escapeHtml(c.location || "—")}</td>
          <td>${escapeHtml(c.gstin || "—")}</td>
          <td>${money(c.credit_limit)}</td>
          <td class="amount due">${money(c.dues)}</td>
          <td>
            <button class="table-button" data-action="view-statement" data-type="CUSTOMER" data-id="${c.id}" style="margin-right:8px;">History</button>
            <button class="table-button" data-action="edit-customer" data-id="${c.id}">Edit</button>
          </td>
        </tr>`).join("") 
      : emptyRow(7, "No customers found.");
  }

  function renderSupplierTable() {
    const term = ($("supplierSearch") ? $("supplierSearch").value.toLowerCase() : "");
    const filtered = state.suppliers.filter(s => s.agency_name.toLowerCase().includes(term) || String(s.phone).includes(term));
    $("suppliersTable").innerHTML = filtered.length 
      ? filtered.map((s) => `<tr>
          <td><strong>${escapeHtml(s.agency_name)}</strong></td>
          <td>${escapeHtml(s.contact_name || "—")}</td>
          <td>${escapeHtml(s.phone)}</td>
          <td>${escapeHtml(s.gstin || "—")}</td>
          <td class="amount due">${money(s.outstanding_balance)}</td>
          <td>
            <button class="table-button" data-action="view-statement" data-type="SUPPLIER" data-id="${s.id}" style="margin-right:8px;">History</button>
            <button class="table-button" data-action="edit-supplier" data-id="${s.id}">Edit</button>
          </td>
        </tr>`).join("") 
      : emptyRow(6, "No suppliers found.");
  }

  function renderInventory() {
    const term = ($("inventorySearch") ? $("inventorySearch").value.toLowerCase().trim() : "");
    const filtered = state.inventory.filter((item) => {
      const name = String(item.name || "").toLowerCase();
      const brand = String(item.brand || "").toLowerCase();
      const batch = String(item.batch_no || "").toLowerCase();
      return name.includes(term) || brand.includes(term) || batch.includes(term);
    });

    $("inventoryTable").innerHTML = filtered.length ? filtered.map((item) => {
      const stock = number(item.stock_quantity);
      const stockStyle = stock <= number(item.min_stock_alert) ? "color: var(--danger); font-weight: 700;" : "color: var(--success); font-weight: 700;";
      return `<tr>
        <td><strong>${escapeHtml(item.name)}</strong></td>
        <td>${escapeHtml(item.brand || "—")}</td>
        <td>${escapeHtml(item.batch_no || "—")}</td>
        <td>${number(item.min_stock_alert).toFixed(2)}</td>
        <td>${money(item.purchase_rate)}</td>
        <td>${money(item.mrp)}</td>
        <td>${escapeHtml(item.expiry_date || "—")}</td>
        <td>${number(item.cgst_pct)}% + ${number(item.sgst_pct)}%</td>
        <td style="${stockStyle}">${stock.toFixed(2)}</td>
        <td><button class="table-button" data-action="adjust-stock" data-id="${item.id}">Adjust</button></td>
      </tr>`;
    }).join("") : emptyRow(10, "No inventory records available.");
  }

  function renderProductOptions() {
    const optionHTML = options(state.inventory, (i) => `${i.name} · ${i.batch_no || "No batch"} · ${number(i.stock_quantity).toFixed(2)} in stock`, true, "Select stock item");
    const selSale = $("saleProduct").value; 
    $("saleProduct").innerHTML = optionHTML; 
    if (state.inventory.some((i) => String(i.id) === selSale)) $("saleProduct").value = selSale;
  }

  function fillProductFields(prefix) {
    const item = state.inventory.find((entry) => String(entry.id) === $(`${prefix}Product`).value);
    $(`${prefix}Brand`).value = item?.brand || ""; 
    $(`${prefix}Batch`).value = item?.batch_no || ""; 
    $(`${prefix}Available`).value = item ? number(item.stock_quantity).toFixed(2) : "";
    $(`${prefix}Rate`).value = item ? number(item.mrp || item.purchase_rate).toFixed(2) : ""; 
    $(`${prefix}Cgst`).value = item ? number(item.cgst_pct) : ""; 
    $(`${prefix}Sgst`).value = item ? number(item.sgst_pct) : "";
  }

  $("saleProduct").addEventListener("change", () => fillProductFields("sale"));

  function itemTotal(item) {
    const base = number(item.qty) * number(item.rate); 
    const tax = base * (number(item.cgst) + number(item.sgst)) / 100;
    return { base, tax, total: base + tax };
  }

  function renderCart(kind) {
    const cart = kind === "SALE" ? state.saleCart : state.purchaseCart;
    const prefix = kind === "SALE" ? "sale" : "purchase";
    let units = 0; let gross = 0; let tax = 0;

    $(`${prefix}Cart`).innerHTML = cart.length ? cart.map((item, index) => {
      const totals = itemTotal(item); 
      units += number(item.qty); 
      gross += totals.base; 
      tax += totals.tax;
      if (kind === "SALE") {
        return `<tr>
          <td>${index + 1}</td>
          <td><strong>${escapeHtml(item.name)}</strong></td>
          <td>${escapeHtml(item.brand || "—")}</td>
          <td>${escapeHtml(item.batch || "—")}</td>
          <td><input type="number" step="any" min="0" value="${item.qty}" data-action="update-cart-qty" data-kind="${kind}" data-index="${index}" style="width:70px"></td>
          <td><input type="number" step="any" min="0" value="${item.rate}" data-action="update-cart-rate" data-kind="${kind}" data-index="${index}" style="width:80px"></td>
          <td>${number(item.cgst)}% + ${number(item.sgst)}%</td>
          <td>${money(totals.total)}</td>
          <td><button class="table-button danger" data-action="remove-line" data-kind="${kind}" data-index="${index}">Remove</button></td>
        </tr>`;
      }
      return `<tr>
        <td>${index + 1}</td>
        <td><strong>${escapeHtml(item.name)}</strong></td>
        <td>${escapeHtml(item.brand || "—")}</td>
        <td>${escapeHtml(item.batch)}</td>
        <td>${escapeHtml(item.expiry || "—")}</td>
        <td><input type="number" step="any" min="0" value="${item.qty}" data-action="update-cart-qty" data-kind="PURCHASE" data-index="${index}" style="width:70px"></td>
        <td><input type="number" step="any" min="0" value="${item.rate}" data-action="update-cart-rate" data-kind="PURCHASE" data-index="${index}" style="width:80px"></td>
        <td>${money(item.mrp)}</td>
        <td>${number(item.cgst)}% + ${number(item.sgst)}%</td>
        <td>${money(totals.total)}</td>
        <td><button class="table-button danger" data-action="remove-line" data-kind="PURCHASE" data-index="${index}">Remove</button></td>
      </tr>`;
    }).join("") : emptyRow(kind === "PURCHASE" ? 11 : 9, "No items added yet.");
    
    const transport = number($(`${prefix}Transport`).value);
    $(`${prefix}Units`).textContent = units.toFixed(2); 
    $(`${prefix}Gross`).textContent = money(gross); 
    $(`${prefix}Tax`).textContent = money(tax);
    $(`${prefix}Total`).textContent = money(gross + tax + transport);
  }

  function addStockLine() {
    const inv = state.inventory.find((i) => String(i.id) === $("saleProduct").value);
    const qty = number($("saleQty").value); 
    const rate = number($("saleRate").value);
    if (!inv) return toast("Select a product from inventory first.", true);
    if (qty > number(inv.stock_quantity)) return toast(`Only ${number(inv.stock_quantity).toFixed(2)} units available in stock.`, true);
    if (qty <= 0 || rate < 0) return toast("Quantity and rate are required.", true);

    state.saleCart.push({ 
      inventory_id: inv.id, name: inv.name, brand: inv.brand, batch: inv.batch_no, 
      qty, rate, cgst: number($("saleCgst").value), sgst: number($("saleSgst").value) 
    });
    $("saleQty").value = "1"; 
    renderCart("SALE");
  }

  function addPurchaseLine() {
    const name = $("purchaseName").value.trim(); 
    const batch = $("purchaseBatch").value.trim();
    const qty = number($("purchaseQty").value); 
    const rate = number($("purchaseRate").value);
    if (!name || !batch) return toast("Item name and batch are required.", true);
    if (qty <= 0 || rate < 0) return toast("Quantity and cost rate are required.", true);

    state.purchaseCart.push({ 
      name, brand: $("purchaseBrand").value.trim(), batch, expiry: $("purchaseExpiry").value || null, 
      qty, rate, mrp: number($("purchaseMrp").value), cgst: number($("purchaseCgst").value), sgst: number($("purchaseSgst").value) 
    });
    ["purchaseName", "purchaseBrand", "purchaseBatch", "purchaseExpiry", "purchaseRate", "purchaseMrp"].forEach((id) => $(id).value = "");
    $("purchaseQty").value = "1"; 
    $("purchaseCgst").value = "0"; 
    $("purchaseSgst").value = "0"; 
    renderCart("PURCHASE");
  }

  function resetBill(kind) {
    const prefix = kind === "SALE" ? "sale" : "purchase";
    if (kind === "SALE") { 
      state.saleCart = []; 
      $("saleParty").value = ""; 
      if ($("saleCustomerSearch")) $("saleCustomerSearch").value = ""; 
    } else { 
      state.purchaseCart = []; 
      $("purchaseParty").value = ""; 
    }
    $(`${prefix}Transport`).value = "0"; 
    $(`${prefix}Paid`).value = "0"; 
    $(`${prefix}Notes`).value = "";
    renderCart(kind);
  }

  async function saveBill(kind) {
    const prefix = kind === "SALE" ? "sale" : "purchase";
    const cart = kind === "SALE" ? state.saleCart : state.purchaseCart;
    const partyId = $(`${prefix}Party`).value;
    
    if (!cart.length) return toast("Please add at least one line item.", true);
    
    const payload = { 
      entity_id: partyId || null, 
      items: cart, 
      transport: number($(`${prefix}Transport`).value), 
      paid: number($(`${prefix}Paid`).value), 
      notes: $(`${prefix}Notes`).value, 
      bill_type: kind 
    };
    
    try {
      const response = await api(`/api/bills/${kind.toLowerCase()}`, { method: "POST", body: JSON.stringify(payload) });
      toast(`${response.message} Invoice #${response.id}.`); 
      const newBillId = response.id;
      resetBill(kind); 
      await refreshAll();
      if (kind === "SALE") printBill(newBillId);
    } catch (error) { toast(error.message, true); }
  }

  // --- PRINTING FUNCTIONS (BOUND TO DATABASE PROFILE) ---
  async function printBill(id) {
    if (!id) return toast("Invalid Bill ID.", true);
    try {
      const bill = await api(`/api/bills/${id}`);
      const storeName = state.storeProfile.name || "Agri Kisan Store"; 
      const storeAddr = state.storeProfile.address || ""; 
      const storeLic = state.storeProfile.license || "";
      let subTotal = 0; let cgstTotal = 0; let sgstTotal = 0;
      
      const rows = (bill.items || []).map((item, idx) => {
        const base = number(item.qty) * number(item.rate); 
        const cgstAmt = base * (number(item.cgst_pct) / 100); 
        const sgstAmt = base * (number(item.sgst_pct) / 100);
        subTotal += base; cgstTotal += cgstAmt; sgstTotal += sgstAmt;
        return `<tr>
          <td style="text-align:center;">${idx + 1}</td>
          <td><strong>${escapeHtml(item.material_name)}</strong><br><small>Batch: ${escapeHtml(item.batch_no || '—')}</small></td>
          <td style="text-align:right;">${number(item.qty).toFixed(2)}</td>
          <td style="text-align:right;">${money(item.rate)}</td>
          <td style="text-align:right;">${number(item.cgst_pct)}% (${money(cgstAmt)})</td>
          <td style="text-align:right;">${number(item.sgst_pct)}% (${money(sgstAmt)})</td>
          <td style="text-align:right; font-weight: bold;">${money(item.total_price)}</td>
        </tr>`;
      }).join("");

      const popup = window.open("", "_blank", "width=850,height=750");
      if (!popup) return toast("Pop-up blocked! Allow pop-ups to print invoices.", true);

      popup.document.open();
      popup.document.write(`
        <!doctype html>
        <html>
        <head>
          <title>${bill.bill_type} INVOICE #${bill.id}</title>
          <style>
            body { font-family: 'Segoe UI', Arial, sans-serif; padding: 25px; color: #111; margin: 0; }
            .header-box { text-align: center; border-bottom: 2px solid #222; padding-bottom: 10px; margin-bottom: 14px; }
            .header-box h1 { margin: 0; font-size: 22px; text-transform: uppercase; }
            .header-box p { margin: 3px 0; font-size: 13px; color: #444; }
            .meta-grid { display: flex; justify-content: space-between; margin-bottom: 14px; font-size: 13px; }
            table { border-collapse: collapse; width: 100%; font-size: 13px; }
            th, td { border: 1px solid #cbd5e1; padding: 7px 10px; text-align: left; }
            th { background: #f8fafc; }
            .totals-container { float: right; width: 320px; margin-top: 15px; font-size: 13px; }
            .totals-row { display: flex; justify-content: space-between; padding: 3px 0; }
            .grand-total { border-top: 2px solid #111; font-size: 15px; font-weight: bold; margin-top: 5px; padding-top: 5px; }
            .footer-note { clear: both; margin-top: 40px; border-top: 1px dashed #ccc; padding-top: 10px; font-size: 12px; text-align: center; }
          </style>
        </head>
        <body>
          <div class="header-box">
            <h1>${escapeHtml(storeName)}</h1>
            <p>${escapeHtml(storeAddr)}</p>
            <p><strong>License / GSTIN:</strong> ${escapeHtml(storeLic)}</p>
          </div>
          <div class="meta-grid">
            <div>
              <strong>INVOICE TYPE:</strong> ${escapeHtml(bill.bill_type)} TAX INVOICE<br>
              <strong>Invoice #:</strong> #${bill.id}<br>
              <strong>Date:</strong> ${new Date(bill.created_at).toLocaleString()}
            </div>
            <div style="text-align: right;">
              <strong>Status:</strong> ${escapeHtml(bill.status)}<br>
              <strong>Notes:</strong> ${escapeHtml(bill.notes || "—")}
            </div>
          </div>
          <table>
            <thead>
              <tr><th style="width: 25px;">#</th><th>Item / Description</th><th style="text-align:right;">Qty</th><th style="text-align:right;">Rate</th><th style="text-align:right;">CGST</th><th style="text-align:right;">SGST</th><th style="text-align:right;">Total</th></tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
          <div class="totals-container">
            <div class="totals-row"><span>Subtotal:</span> <span>${money(subTotal)}</span></div>
            <div class="totals-row"><span>CGST:</span> <span>${money(cgstTotal)}</span></div>
            <div class="totals-row"><span>SGST:</span> <span>${money(sgstTotal)}</span></div>
            <div class="totals-row"><span>Transport:</span> <span>${money(bill.transport_charges)}</span></div>
            <div class="totals-row grand-total"><span>Total Payable:</span> <span>${money(bill.total_amount)}</span></div>
            <div class="totals-row"><span>Paid:</span> <span>${money(bill.paid_amount)}</span></div>
            <div class="totals-row" style="font-weight:bold; color: #b42318;"><span>Balance Due:</span> <span>${money(number(bill.total_amount) - number(bill.paid_amount))}</span></div>
          </div>
          <div class="footer-note">Authorized Store Signatory: _______________________</div>
        </body>
        </html>
      `);
      popup.document.close();
      popup.focus();
      popup.print();
    } catch (err) { toast(err.message, true); }
  }

  async function printStatement(selectedOnly = false) {
    if (!state.currentStatement) return toast("No party loaded.", true);
    try {
      const { type, id } = state.currentStatement;
      const data = await api(`/api/parties/${type}/${id}/statement`);
      const storeName = state.storeProfile.name || "Agri Kisan Store";
      const storeAddr = state.storeProfile.address || "";
      const storeLic = state.storeProfile.license || "";
      
      let rowsToPrint = data.history;
      if (selectedOnly) {
        const checkboxes = document.querySelectorAll("#statementTable input[type='checkbox']");
        const selectedIndices = [];
        checkboxes.forEach((cb, idx) => { if (cb.checked) selectedIndices.push(idx); });
        if (!selectedIndices.length) return toast("Select at least one record to print.", true);
        rowsToPrint = selectedIndices.map(idx => data.history[idx]);
      }

      const popup = window.open("", "_blank", "width=850,height=750");
      if (!popup) return toast("Allow pop-ups to print ledger.", true);

      let totalDebited = 0; let totalCredited = 0;
      const tableRows = rowsToPrint.map((row, idx) => {
        const amt = number(row.amount);
        if (row.record_type === "BILL") totalDebited += amt; else totalCredited += amt;
        return `<tr>
          <td style="text-align:center;">${idx + 1}</td>
          <td>${new Date(row.date).toLocaleString()}</td>
          <td><strong>${escapeHtml(row.record_type)}</strong></td>
          <td>#${escapeHtml(row.ref_id || '-')}</td>
          <td style="text-align:right; font-weight:600;">${money(row.amount)}</td>
          <td>${escapeHtml(row.status)}</td>
          <td>${escapeHtml(row.notes || '—')}</td>
        </tr>`;
      }).join("");

      popup.document.open();
      popup.document.write(`
        <!doctype html>
        <html>
        <head>
          <title>Ledger - ${escapeHtml(data.party.name || data.party.agency_name)}</title>
          <style>
            body { font-family: 'Segoe UI', Arial, sans-serif; padding: 25px; margin: 0; color: #111; }
            .header { text-align: center; border-bottom: 2px solid #222; padding-bottom: 10px; margin-bottom: 14px; }
            table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 13px; }
            th, td { border: 1px solid #cbd5e1; padding: 7px 10px; text-align: left; }
            th { background: #f8fafc; }
            .summary { float: right; width: 300px; margin-top: 15px; font-size: 13px; }
            .summary-row { display: flex; justify-content: space-between; padding: 3px 0; }
            .balance-due { font-size: 15px; font-weight: bold; border-top: 2px solid #111; padding-top: 5px; color: #b42318; }
          </style>
        </head>
        <body>
          <div class="header">
            <h2>${escapeHtml(storeName)}</h2>
            <p>${escapeHtml(storeAddr)} | Lic/GST: ${escapeHtml(storeLic)}</p>
          </div>
          <div><strong>Statement For:</strong> ${escapeHtml(data.party.name || data.party.agency_name)} (${escapeHtml(data.party.phone || '—')})</div>
          <table>
            <thead><tr><th>#</th><th>Date</th><th>Type</th><th>Ref</th><th style="text-align:right;">Amount</th><th>Status</th><th>Notes</th></tr></thead>
            <tbody>${tableRows}</tbody>
          </table>
          <div class="summary">
            <div class="summary-row"><span>Total Invoiced:</span> <span>${money(totalDebited)}</span></div>
            <div class="summary-row"><span>Total Payments:</span> <span>${money(totalCredited)}</span></div>
            <div class="summary-row balance-due"><span>Net Balance Due:</span> <span>${money(data.party.pending)}</span></div>
          </div>
        </body>
        </html>
      `);
      popup.document.close();
      popup.focus();
      popup.print();
    } catch (err) { toast(err.message, true); }
  }

  async function printReceipt(id) {
    try {
      const entry = await api(`/api/ledger/${id}`);
      const storeName = state.storeProfile.name || "Agri Kisan Store";
      const storeAddr = state.storeProfile.address || "";
      const storeLic = state.storeProfile.license || "";
      const popup = window.open("", "_blank", "width=600,height=500");
      if (!popup) return toast("Allow pop-ups to print receipts.", true);

      popup.document.open();
      popup.document.write(`
        <!doctype html>
        <html>
        <head>
          <title>Receipt #${entry.id}</title>
          <style>
            body { font-family: 'Segoe UI', Arial, sans-serif; padding: 20px; color: #111; margin: 0; }
            .box { border: 2px solid #222; padding: 20px; border-radius: 4px; }
            .title { text-align: center; font-size: 15px; font-weight: bold; background: #f1f5f9; padding: 5px; margin: 12px 0; }
            .row { display: flex; justify-content: space-between; padding: 5px 0; font-size: 13px; border-bottom: 1px dashed #e2e8f0; }
            .amount-box { font-size: 20px; font-weight: bold; text-align: center; margin: 12px 0; color: #166534; background: #f0fdf4; padding: 8px; }
          </style>
        </head>
        <body>
          <div class="box">
            <div style="text-align: center;">
              <h3 style="margin: 0;">${escapeHtml(storeName)}</h3>
              <p style="margin: 2px 0; font-size: 12px;">${escapeHtml(storeAddr)} | ${escapeHtml(storeLic)}</p>
            </div>
            <div class="title">${entry.entry_type === 'RECEIPT' ? 'OFFICIAL CASH RECEIPT' : 'OFFICIAL PAYMENT VOUCHER'}</div>
            <div class="row"><span>Voucher #:</span> <strong>#${entry.id}</strong></div>
            <div class="row"><span>Date:</span> <span>${new Date(entry.created_at).toLocaleString()}</span></div>
            <div class="row"><span>Party:</span> <strong>${escapeHtml(entry.party_name)}</strong></div>
            <div class="row"><span>Mode:</span> <span>${escapeHtml(entry.payment_mode)}</span></div>
            <div class="row"><span>Notes:</span> <span>${escapeHtml(entry.notes || 'None')}</span></div>
            <div class="amount-box">AMOUNT: ${money(entry.amount)}</div>
            <div style="margin-top: 30px; display: flex; justify-content: space-between; font-size: 12px;">
              <span>Party Signature</span><span>Authorized Store Signatory</span>
            </div>
          </div>
        </body>
        </html>
      `);
      popup.document.close();
      popup.focus();
      popup.print();
    } catch (err) { toast(err.message, true); }
  }

  function updateDashboardMetrics() {
    if (!cachedSummary) return;
    const salesMode = $("salesMetricToggle")?.value || "today";
    const purchaseMode = $("purchaseMetricToggle")?.value || "today";
    const expenseMode = $("expenseMetricToggle")?.value || "today";

    $("salesMetricVal").textContent = money(salesMode === "today" ? cachedSummary.sales_today : cachedSummary.sales_total);
    $("purchaseMetricVal").textContent = money(purchaseMode === "today" ? cachedSummary.purchases_today : cachedSummary.purchases_total);
    $("expensesMetricVal").textContent = money(expenseMode === "today" ? cachedSummary.expenses_today : cachedSummary.expenses_total);
    $("customerDues").textContent = money(cachedSummary.customer_dues);
    $("supplierOutstanding").textContent = money(cachedSummary.supplier_outstanding);
    $("lowStockCount").textContent = number(cachedSummary.low_stock_count);
  }

  async function fetchDateHistory() {
    const dateVal = $("historyDateInput").value;
    if (!dateVal) return toast("Select a valid date first.", true);
    try {
      const data = await api(`/api/reports/date-history?date=${dateVal}`);
      const container = $("dateHistoryResults");
      const salesRows = data.sales.length ? data.sales.map(s => `<tr>
        <td>#${s.id}</td><td>Sales</td><td>${escapeHtml(s.party_name)}</td><td>${money(s.total_amount)}</td><td>Paid: ${money(s.paid_amount)}</td>
        <td><button class="table-button" data-action="print-bill" data-id="${s.id}">Print</button></td>
      </tr>`).join("") : `<tr><td colspan="6" class="empty">No sales on this day.</td></tr>`;

      const purchaseRows = data.purchases.length ? data.purchases.map(p => `<tr>
        <td>#${p.id}</td><td>Purchase</td><td>${escapeHtml(p.party_name)}</td><td>${money(p.total_amount)}</td><td>Paid: ${money(p.paid_amount)}</td>
        <td><button class="table-button" data-action="print-bill" data-id="${p.id}">Print</button></td>
      </tr>`).join("") : `<tr><td colspan="6" class="empty">No purchases on this day.</td></tr>`;

      const expenseRows = data.expenses.length ? data.expenses.map(e => `<tr>
        <td>—</td><td>Expense (${escapeHtml(e.category)})</td><td>${escapeHtml(e.notes || "—")}</td><td>${money(e.amount)}</td><td>—</td><td>—</td>
      </tr>`).join("") : `<tr><td colspan="6" class="empty">No expenses on this day.</td></tr>`;

      container.innerHTML = `<h5 style="margin: 12px 0 6px;">Activity for ${dateVal}</h5><table class="data-table"><thead><tr><th>Ref</th><th>Type</th><th>Party</th><th>Amount</th><th>Details</th><th>Action</th></tr></thead><tbody>${salesRows}${purchaseRows}${expenseRows}</tbody></table>`;
    } catch (err) { toast(err.message, true); }
  }

  function renderLedgerPartyOptions() {
    const type = $("ledgerType").value;
    const parties = type === "CUSTOMER" ? state.customers : state.suppliers;
    $("ledgerParty").innerHTML = options(parties, (p) => type === "CUSTOMER" ? `${p.name} · Due ${money(p.dues)}` : `${p.agency_name} · Due ${money(p.outstanding_balance)}`, true, "Select party");
  }

  async function saveLedger(e) {
    e.preventDefault();
    const payload = {
      entity_type: $("ledgerType").value,
      entity_id: $("ledgerParty").value,
      amount: number($("ledgerAmount").value),
      payment_mode: $("ledgerMode").value,
      notes: $("ledgerNotes").value
    };
    try {
      await api("/api/ledger", { method: "POST", body: JSON.stringify(payload) });
      toast("Ledger voucher saved.");
      $("ledgerForm").reset();
      await refreshAll();
    } catch (err) { toast(err.message, true); }
  }

  async function loadLedger() {
    try {
      const entries = await api("/api/ledger");
      $("ledgerTable").innerHTML = entries.length ? entries.map((entry) => `<tr>
        <td>${new Date(entry.created_at).toLocaleString()}</td>
        <td>${escapeHtml(entry.entry_type)}</td>
        <td>${escapeHtml(entry.party_name || "—")}</td>
        <td class="amount">${money(entry.amount)}</td>
        <td>${escapeHtml(entry.payment_mode)}</td>
        <td>${escapeHtml(entry.notes || "—")}</td>
        <td><button class="table-button" data-action="print-receipt" data-id="${entry.id}">Print</button></td>
      </tr>`).join("") : emptyRow(7, "No ledger entries recorded.");
    } catch (err) { toast(err.message, true); }
  }

  async function saveExpense(e) {
    e.preventDefault();
    const payload = {
      category: $("expenseCategory").value,
      amount: number($("expenseAmount").value),
      expense_date: $("expenseDate").value,
      notes: $("expenseNotes").value
    };
    try {
      await api("/api/expenses", { method: "POST", body: JSON.stringify(payload) });
      toast("Expense saved.");
      $("expenseForm").reset();
      $("expenseDate").value = new Date().toISOString().slice(0, 10);
      await refreshAll();
    } catch (err) { toast(err.message, true); }
  }

  async function loadExpenses() {
    try {
      const entries = await api("/api/expenses");
      $("expensesTable").innerHTML = entries.length ? entries.map((entry) => `<tr>
        <td>${escapeHtml(entry.expense_date)}</td>
        <td>${escapeHtml(entry.category)}</td>
        <td class="amount">${money(entry.amount)}</td>
        <td>${escapeHtml(entry.notes || "—")}</td>
      </tr>`).join("") : emptyRow(4, "No expenses recorded.");
    } catch (err) { toast(err.message, true); }
  }

  async function showHistory(billType) {
    try {
      const endpoint = billType ? `/api/bills?type=${billType}` : "/api/all-transactions";
      state.currentBills = await api(endpoint);
      $("historyModalTitle").textContent = billType ? `${billType} Invoices` : "All Transactions & Bills";
      if ($("billSearchInput")) $("billSearchInput").value = "";
      renderBillHistoryTable();
      openModal("historyModal");
    } catch (err) { toast(err.message, true); }
  }

  function renderBillHistoryTable() {
    const term = ($("billSearchInput") ? $("billSearchInput").value.toLowerCase().trim() : "").replace(/^#/, "");
    const filtered = state.currentBills.filter((txn) => {
      const ref = String(txn.ref_id || txn.id || "").toLowerCase(); 
      const party = String(txn.party_name || "").toLowerCase();
      const type = String(txn.txn_type || txn.bill_type || "").toLowerCase();
      return ref.includes(term) || party.includes(term) || type.includes(term);
    });

    $("historyTable").innerHTML = filtered.length ? filtered.map((txn) => {
      const rawId = txn.ref_id || txn.id;
      const isLedger = String(rawId).startsWith("L-");
      const cleanId = String(rawId).replace("L-", "");
      const totalAmount = txn.amount ?? txn.total_amount ?? 0;
      const statusLabel = txn.status || txn.bill_type || "POSTED";
      
      let actionButtons = "";
      if (isLedger) {
        actionButtons = `<button class="table-button" data-action="print-receipt" data-id="${cleanId}">Print</button>`;
      } else if (statusLabel === "POSTED") {
        actionButtons = `<button class="table-button" data-action="print-bill" data-id="${cleanId}">Print</button><button class="table-button danger" data-action="void-bill" data-id="${cleanId}">Void</button>`;
      } else {
        actionButtons = `<button class="table-button" data-action="print-bill" data-id="${cleanId}">View</button>`;
      }

      return `<tr>
        <td>#${escapeHtml(rawId)}</td>
        <td>${new Date(txn.created_at).toLocaleString()}</td>
        <td>${escapeHtml(txn.party_name || '—')}</td>
        <td class="amount">${money(totalAmount)}</td>
        <td class="amount">${money(txn.paid_amount || 0)}</td>
        <td>${escapeHtml(statusLabel)}</td>
        <td>${actionButtons}</td>
      </tr>`;
    }).join("") : emptyRow(7, "No transactions found.");
  }

  async function voidBill(id) {
    if (!confirm("Void this bill? Stock and party balances will reverse. This cannot be undone.")) return;
    try { 
      const res = await api(`/api/bills/${id}`, { method: "DELETE" }); 
      toast(res.message); 
      await refreshAll(); 
      closeModal("historyModal"); 
    } catch (err) { toast(err.message, true); }
  }

  async function showStatement(type, id) {
    try {
      state.currentStatement = { type, id };
      const data = await api(`/api/parties/${type}/${id}/statement`);
      $("statementModalTitle").textContent = `${escapeHtml(data.party.name || data.party.agency_name)} - Statement`;
      $("statementPending").textContent = `Pending: ${money(data.party.pending)}`;
      $("statementTable").innerHTML = data.history.length ? data.history.map(row => `
        <tr>
          <td style="width:30px;"><input type="checkbox"></td>
          <td>${new Date(row.date).toLocaleString()}</td>
          <td>${escapeHtml(row.record_type)}</td>
          <td>#${escapeHtml(row.ref_id || '-')}</td>
          <td class="amount">${money(row.amount)}</td>
          <td>${escapeHtml(row.status)}</td>
          <td>${escapeHtml(row.notes || '')}</td>
        </tr>
      `).join("") : emptyRow(7, "No transaction history.");
      
      const selectAll = $("selectAllStatement");
      if (selectAll) {
        selectAll.checked = false;
        selectAll.onchange = (e) => {
          document.querySelectorAll("#statementTable input[type='checkbox']").forEach(cb => cb.checked = e.target.checked);
        };
      }
      openModal("statementModal");
    } catch (err) { toast(err.message, true); }
  }

  function openCustomer(customer = null) {
    $("customerForm").reset(); 
    $("customerId").value = customer?.id || ""; 
    $("customerModalTitle").textContent = customer ? "Edit Customer" : "Add Customer";
    if ($("customerDuesGroup")) $("customerDuesGroup").classList.toggle("hidden", !!customer);
    if (customer) { 
      $("customerName").value = customer.name; 
      $("customerPhone").value = customer.phone; 
      $("customerLocation").value = customer.location || ""; 
      $("customerGstin").value = customer.gstin || ""; 
      $("customerLimit").value = number(customer.credit_limit); 
      $("customerCrops").value = customer.primary_crops || ""; 
      $("customerIrrigation").value = customer.irrigation_source || ""; 
    }
    openModal("customerModal");
  }

  function openSupplier(supplier = null) {
    $("supplierForm").reset(); 
    $("supplierId").value = supplier?.id || ""; 
    $("supplierModalTitle").textContent = supplier ? "Edit Supplier" : "Add Supplier";
    if ($("supplierOutstandingGroup")) $("supplierOutstandingGroup").classList.toggle("hidden", !!supplier);
    if (supplier) { 
      $("supplierAgency").value = supplier.agency_name; 
      $("supplierContact").value = supplier.contact_name || ""; 
      $("supplierPhone").value = supplier.phone; 
      $("supplierGstin").value = supplier.gstin || ""; 
      $("supplierAddress").value = supplier.address || ""; 
      $("supplierEmail").value = supplier.email || ""; 
    }
    openModal("supplierModal");
  }

  async function saveCustomer(e) {
    e.preventDefault(); 
    const id = $("customerId").value;
    const data = { 
      name: $("customerName").value, 
      phone: $("customerPhone").value, 
      location: $("customerLocation").value, 
      gstin: $("customerGstin").value, 
      dues: number($("customerDuesInput")?.value), 
      credit_limit: number($("customerLimit").value), 
      primary_crops: $("customerCrops").value, 
      irrigation_source: $("customerIrrigation").value 
    };
    try { 
      await api(id ? `/api/customers/${id}` : "/api/customers", { method: id ? "PUT" : "POST", body: JSON.stringify(data) }); 
      toast("Customer saved."); 
      closeModal("customerModal"); 
      await refreshAll(); 
    } catch (err) { toast(err.message, true); }
  }

  async function saveSupplier(e) {
    e.preventDefault(); 
    const id = $("supplierId").value;
    const data = { 
      agency_name: $("supplierAgency").value, 
      contact_name: $("supplierContact").value, 
      phone: $("supplierPhone").value, 
      gstin: $("supplierGstin").value, 
      address: $("supplierAddress").value, 
      email: $("supplierEmail").value, 
      outstanding_balance: number($("supplierOutstandingInput")?.value) 
    };
    try { 
      await api(id ? `/api/suppliers/${id}` : "/api/suppliers", { method: id ? "PUT" : "POST", body: JSON.stringify(data) }); 
      toast("Supplier saved."); 
      closeModal("supplierModal"); 
      await refreshAll(); 
    } catch (err) { toast(err.message, true); }
  }

  const adjForm = $("adjustmentForm");
  if (adjForm) {
    adjForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const id = $("adjustmentInventoryId").value;
      const payload = { 
        direction: $("adjustmentDirection").value, 
        quantity: number($("adjustmentQuantity").value), 
        reason: $("adjustmentReason").value, 
        notes: $("adjustmentNotes").value 
      };
      try { 
        await api(`/api/inventory/${id}/adjust`, { method: "POST", body: JSON.stringify(payload) }); 
        toast("Stock updated."); 
        closeModal("adjustmentModal"); 
        await refreshAll(); 
      } catch(err) { toast(err.message, true); }
    });
  }

  // --- Dynamic Input Handlers ---
  document.addEventListener("input", (event) => {
    const action = event.target.dataset.action; 
    if (action) {
      const index = number(event.target.dataset.index); 
      const kind = event.target.dataset.kind;
      const cart = kind === "SALE" ? state.saleCart : state.purchaseCart;
      if (action === "update-cart-qty" && cart[index]) { cart[index].qty = number(event.target.value); renderCart(kind); } 
      else if (action === "update-cart-rate" && cart[index]) { cart[index].rate = number(event.target.value); renderCart(kind); }
      return;
    }

    if (event.target.id === "saleCustomerSearch") {
      const term = event.target.value.toLowerCase();
      const listDiv = $("customerDropdownList");
      if (!term) { listDiv.classList.add("hidden"); $("saleParty").value = ""; return; }
      const filtered = state.customers.filter(c => c.name.toLowerCase().includes(term) || String(c.phone).includes(term));
      if (!filtered.length) { 
        listDiv.innerHTML = `<div style="padding: 8px; color: #64748b;">No customers found</div>`; 
      } else { 
        listDiv.innerHTML = filtered.map(c => `
          <div class="customer-suggestion-item" data-id="${c.id}" data-name="${escapeHtml(c.name)} · ${c.phone}" style="padding: 8px 12px; cursor: pointer; border-bottom: 1px solid #e2e8f0; color: #1e293b;">
            <strong>${escapeHtml(c.name)}</strong> · ${c.phone}
          </div>
        `).join(""); 
      }
      listDiv.classList.remove("hidden");
    }
  });

  // --- Global Click Router ---
  document.addEventListener("click", async (event) => {
    const suggestionItem = event.target.closest(".customer-suggestion-item");
    if (suggestionItem) {
      $("saleParty").value = suggestionItem.dataset.id; 
      $("saleCustomerSearch").value = suggestionItem.dataset.name;
      $("customerDropdownList")?.classList.add("hidden");
      return;
    }

    if (!event.target.closest("#saleCustomerSearch") && !event.target.closest("#customerDropdownList")) { 
      $("customerDropdownList")?.classList.add("hidden"); 
    }

    const button = event.target.closest("button"); 
    if (!button) return;
    
    if (button.dataset.view) return setView(button.dataset.view, button.dataset.ledgerType);
    if (button.dataset.open === "customerModal") return openCustomer();
    if (button.dataset.open === "supplierModal") return openSupplier();
    if (button.dataset.open) return openModal(button.dataset.open);
    if (button.dataset.close) return closeModal(button.dataset.close);
    
    const action = button.dataset.action; 
    if (!action) return;

    if (action === "edit-customer") { const c = state.customers.find(i => String(i.id) === button.dataset.id); if(c) openCustomer(c); return; }
    if (action === "edit-supplier") { const s = state.suppliers.find(i => String(i.id) === button.dataset.id); if(s) openSupplier(s); return; }
    if (action === "view-statement") return showStatement(button.dataset.type, button.dataset.id);
    if (action === "adjust-stock") { $("adjustmentForm").reset(); $("adjustmentInventoryId").value = button.dataset.id; return openModal("adjustmentModal"); }
    if (action === "print-statement") return printStatement(false);
    if (action === "print-selected") return printStatement(true);
    if (action === "print-receipt") return printReceipt(button.dataset.id);
    if (action === "refresh-all") return refreshAll(); 
    if (action === "add-sale-line") return addStockLine(); 
    if (action === "add-purchase-line") return addPurchaseLine();
    if (action === "clear-sale") return resetBill("SALE"); 
    if (action === "clear-purchase") return resetBill("PURCHASE"); 
    if (action === "save-sale") return saveBill("SALE"); 
    if (action === "save-purchase") return saveBill("PURCHASE");
    if (action === "remove-line") { (button.dataset.kind === "SALE" ? state.saleCart : state.purchaseCart).splice(number(button.dataset.index), 1); return renderCart(button.dataset.kind); }
    if (action === "view-bills") return showHistory(button.dataset.billType || null);
    if (action === "void-bill") return voidBill(button.dataset.id); 
    if (action === "print-bill") return printBill(button.dataset.id);
    if (action === "fetch-date-history") return fetchDateHistory();
  });

  $("ledgerType")?.addEventListener("change", renderLedgerPartyOptions);
  $("ledgerForm")?.addEventListener("submit", saveLedger);
  $("expenseForm")?.addEventListener("submit", saveExpense);
  $("customerForm")?.addEventListener("submit", saveCustomer); 
  $("supplierForm")?.addEventListener("submit", saveSupplier); 

  ["saleTransport", "purchaseTransport", "salePaid", "purchasePaid"].forEach((id) => {
    $(id)?.addEventListener("input", () => {
      if(id.startsWith("sale")) renderCart("SALE"); else renderCart("PURCHASE");
    });
  });
  
  $("customerSearch")?.addEventListener("input", renderCustomerTable);
  $("supplierSearch")?.addEventListener("input", renderSupplierTable);
  $("inventorySearch")?.addEventListener("input", renderInventory);
  $("billSearchInput")?.addEventListener("input", renderBillHistoryTable);

  document.addEventListener("keydown", (event) => { 
    if (["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) return; 
    const shortcut = { F1: "dashboard", F2: "purchase", F3: "sales", F6: "expenses", F7: "inventory", F8: "inventory", F9: "customers", F11: "ledger" }[event.key]; 
    if (shortcut) { event.preventDefault(); setView(shortcut); } 
  });

  $("expenseDate").value = new Date().toISOString().slice(0, 10); 
  
  renderCart("SALE"); 
  renderCart("PURCHASE"); 
  refreshAll();
});