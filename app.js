/* ==========================================================
   InvoiceGen — M/S Ganapati Trading Co
   Main Application Logic
   ========================================================== */
'use strict';

const app = (() => {

  /* ========================================================
     STATE
     ======================================================== */
  const state = {
    clients:              [],
    products:             [],
    invoiceCounter:       107,
    lineItems:            [],
    selectedClientId:     null,
    pendingProductItemId: null,
    itemIdCounter:        0,
  };

  /* ========================================================
     INIT
     ======================================================== */
  function init() {
    loadStorage();
    renderClientSelect();
    setTodayDate();
    computeInvoiceNo();
    addItem();
    updatePreview();

    // Form change listeners
    document.getElementById('invoiceDate').addEventListener('change', () => {
      computeInvoiceNo();
      updatePreview();
    });
    ['invoiceNo', 'challanNo', 'modeOfPayment', 'myGSTIN', 'myBankDetails'].forEach(id => {
      document.getElementById(id).addEventListener('input', e => {
        if (id === 'myGSTIN')       localStorage.setItem('gtc_my_gstin',  e.target.value);
        if (id === 'myBankDetails') localStorage.setItem('gtc_my_bank',   e.target.value);
        updatePreview();
      });
    });
    document.getElementById('clientSelect').addEventListener('change', e => {
      state.selectedClientId = e.target.value || null;
      renderClientInfo();
      updatePreview();
    });

    // Preview scaling
    scalePreview();
    window.addEventListener('resize', debounce(scalePreview, 100));

    // Mobile: collapse preview by default; tapping topbar toggles it
    const previewPanel = document.querySelector('.preview-panel');
    const previewTopbar = document.querySelector('.preview-topbar');
    if (window.innerWidth <= 767) previewPanel.classList.add('mobile-hidden');
    previewTopbar.addEventListener('click', () => {
      if (window.innerWidth <= 767) {
        previewPanel.classList.toggle('mobile-hidden');
        requestAnimationFrame(scalePreview);
      }
    });
    window.addEventListener('resize', () => {
      if (window.innerWidth > 767) previewPanel.classList.remove('mobile-hidden');
    });
  }

  /* ========================================================
     LOCAL STORAGE
     ======================================================== */
  function loadStorage() {
    try {
      const sc  = localStorage.getItem('gtc_clients');
      const sp  = localStorage.getItem('gtc_products');
      const si  = localStorage.getItem('gtc_inv_counter');
      const smg = localStorage.getItem('gtc_my_gstin');
      const smb = localStorage.getItem('gtc_my_bank');
      state.clients        = sc ? JSON.parse(sc) : [...DEFAULT_CLIENTS];
      state.products       = sp ? JSON.parse(sp) : [...DEFAULT_PRODUCTS];
      state.invoiceCounter = si ? parseInt(si, 10) : 107;
      if (smg) set('myGSTIN', smg);
      if (smb) set('myBankDetails', smb);
    } catch {
      state.clients        = [...DEFAULT_CLIENTS];
      state.products       = [...DEFAULT_PRODUCTS];
      state.invoiceCounter = 107;
    }
    if (!localStorage.getItem('gtc_clients'))  persist('clients');
    if (!localStorage.getItem('gtc_products')) persist('products');
  }

  function persist(key) {
    if (key === 'clients')  localStorage.setItem('gtc_clients',     JSON.stringify(state.clients));
    if (key === 'products') localStorage.setItem('gtc_products',    JSON.stringify(state.products));
    if (key === 'counter')  localStorage.setItem('gtc_inv_counter', String(state.invoiceCounter));
  }

  /* ========================================================
     DATE & INVOICE NUMBER
     ======================================================== */
  function setTodayDate() {
    document.getElementById('invoiceDate').value = new Date().toISOString().slice(0, 10);
  }

  function getFY(dateStr) {
    const d = dateStr ? new Date(dateStr + 'T00:00:00') : new Date();
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    return m >= 4
      ? `${y}-${String(y + 1).slice(-2)}`
      : `${y - 1}-${String(y).slice(-2)}`;
  }

  function computeInvoiceNo() {
    const dateStr = get('invoiceDate');
    const fy = getFY(dateStr);
    set('invoiceNo', `${state.invoiceCounter}/${fy}`);
    if (!get('challanNo')) set('challanNo', String(state.invoiceCounter));
  }

  function fmtDate(str) {
    if (!str) return '';
    const [y, m, d] = str.split('-');
    return `${d}/${m}/${y}`;
  }

  /* ========================================================
     CLIENT
     ======================================================== */
  function renderClientSelect() {
    const sel = document.getElementById('clientSelect');
    const prev = sel.value;
    sel.innerHTML = '<option value="">— Select Client —</option>';
    state.clients.forEach(c => {
      const o = document.createElement('option');
      o.value = c.id;
      o.textContent = c.name;
      sel.appendChild(o);
    });
    if (prev) sel.value = prev;
  }

  function renderClientInfo() {
    const card = document.getElementById('clientInfo');
    const c = state.clients.find(x => x.id === state.selectedClientId);
    if (!c) { card.style.display = 'none'; return; }
    card.style.display = 'block';
    card.innerHTML = `
      <strong>${esc(c.name)}</strong>
      ${esc(c.address).replace(/\n/g, '<br>')}
      <span style="color:var(--text-dim)">GSTIN: ${esc(c.gstin)}&nbsp;&nbsp;|&nbsp;&nbsp;State: ${esc(c.stateName)}</span>
      ${c.destination ? `<span style="color:var(--text-dim)">Destination: ${esc(c.destination)}</span>` : ''}
    `;
  }

  function saveClient() {
    const name   = get('ncName').trim();
    const addr   = get('ncAddr').trim();
    const gstin  = get('ncGSTIN').trim().toUpperCase();
    const sname  = get('ncState').trim();
    const dest   = get('ncDest').trim();

    if (!name)  return toast('Client name is required', 'error');
    if (!addr)  return toast('Address is required', 'error');
    if (!gstin) return toast('GSTIN is required', 'error');

    const c = { id: `c_${Date.now()}`, name, address: addr, gstin, stateName: sname, destination: dest };
    state.clients.push(c);
    persist('clients');
    renderClientSelect();

    document.getElementById('clientSelect').value = c.id;
    state.selectedClientId = c.id;
    renderClientInfo();
    updatePreview();
    closeModal('clientModal');
    clearFields(['ncName', 'ncAddr', 'ncGSTIN', 'ncState', 'ncDest']);
    toast(`Client "${name}" saved!`, 'success');
  }

  /* ========================================================
     PRODUCTS & LINE ITEMS
     ======================================================== */
  function addItem() {
    state.itemIdCounter++;
    const id = state.itemIdCounter;
    state.lineItems.push({ id, desc: '', hsn: '', qty: 0, unit: '', rate: 0, per: '', gross: 0 });

    const container = document.getElementById('lineItemsContainer');
    const card = document.createElement('div');
    card.className = 'line-item-card';
    card.id = `item_${id}`;
    card.innerHTML = buildItemHTML(id);
    container.appendChild(card);
    updatePreview();
  }

  function buildItemHTML(id) {
    const opts = state.products
      .map(p => `<option value="${p.id}">${esc(p.description.split('\n')[0].trim())}</option>`)
      .join('');

    const canRemove = state.lineItems.length > 1;

    return `
      <div class="item-head">
        <span class="item-badge">Item ${id}</span>
        ${canRemove ? `<button class="remove-btn" onclick="app.removeItem(${id})">✕ Remove</button>` : ''}
      </div>
      <div class="product-row">
        <select id="pSel_${id}" onchange="app.pickProduct(${id}, this.value)">
          <option value="">— Select Product —</option>
          ${opts}
        </select>
        <button class="action-btn" onclick="app.openProductModal(${id})" title="Add new product" style="font-size:18px;line-height:1;">＋</button>
      </div>
      <div class="form-group">
        <label>Description of Goods</label>
        <textarea id="iDesc_${id}" rows="3" placeholder="Enter product description…" oninput="app.itemChanged(${id})"></textarea>
      </div>
      <div class="form-row">
        <div class="form-group half">
          <label>HSN Code</label>
          <input type="text" id="iHSN_${id}" placeholder="55081000" oninput="app.itemChanged(${id})">
        </div>
        <div class="form-group half">
          <label>Quantity</label>
          <input type="number" id="iQty_${id}" placeholder="96" min="0" step="0.001" oninput="app.itemChanged(${id})">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group half">
          <label>Rate (₹)</label>
          <input type="number" id="iRate_${id}" placeholder="254.00" min="0" step="0.01" oninput="app.itemChanged(${id})">
        </div>
        <div class="form-group half">
          <label>Per Unit</label>
          <input type="text" id="iPer_${id}" placeholder="Pc" oninput="app.itemChanged(${id})" title="Per (e.g. Pc, Kg)">
        </div>
      </div>
    `;
  }

  function removeItem(id) {
    document.getElementById(`item_${id}`)?.remove();
    state.lineItems = state.lineItems.filter(i => i.id !== id);
    updatePreview();
  }

  function pickProduct(itemId, productId) {
    const p = state.products.find(x => x.id === productId);
    if (!p) return;
    set(`iDesc_${itemId}`,  p.description);
    set(`iHSN_${itemId}`,   p.hsnCode);
    set(`iRate_${itemId}`,  String(p.rate));
    set(`iPer_${itemId}`,   p.per);
    itemChanged(itemId);
  }

  function itemChanged(id) {
    const item = state.lineItems.find(x => x.id === id);
    if (!item) return;
    item.desc  = get(`iDesc_${id}`);
    item.hsn   = get(`iHSN_${id}`);
    item.qty   = parseFloat(get(`iQty_${id}`))  || 0;
    item.per   = get(`iPer_${id}`);
    item.unit  = item.per; // Use the same value for both qty unit and rate per
    item.rate  = parseFloat(get(`iRate_${id}`)) || 0;
    item.gross = r2(item.qty * item.rate);
    updatePreview();
  }

  function openProductModal(itemId) {
    state.pendingProductItemId = itemId;
    openModal('productModal');
  }

  function saveProduct() {
    const desc    = get('npDesc').trim();
    const hsnCode = get('npHSN').trim();
    const rate    = parseFloat(get('npRate'))   || 0;
    const per     = get('npPer').trim()  || 'Pc';
    const unit    = get('npUnit').trim() || '';

    if (!desc)    return toast('Description is required', 'error');
    if (!hsnCode) return toast('HSN Code is required', 'error');

    const p = { id: `p_${Date.now()}`, description: desc, hsnCode, rate, per, unit };
    state.products.push(p);
    persist('products');

    // Add option to all existing product selects
    document.querySelectorAll('[id^="pSel_"]').forEach(sel => {
      const o = document.createElement('option');
      o.value = p.id;
      o.textContent = desc.split('\n')[0].trim();
      sel.appendChild(o);
    });

    // Auto-select in the triggering item
    if (state.pendingProductItemId != null) {
      const sel = document.getElementById(`pSel_${state.pendingProductItemId}`);
      if (sel) {
        sel.value = p.id;
        pickProduct(state.pendingProductItemId, p.id);
      }
    }

    closeModal('productModal');
    clearFields(['npDesc', 'npHSN', 'npRate']);
    set('npPer', 'Pc');
    set('npUnit', 'pc');
    toast('Product saved!', 'success');
  }

  /* ========================================================
     CALCULATIONS
     ======================================================== */
  function calcTotals() {
    const taxable = state.lineItems.reduce((s, i) => s + (i.gross || 0), 0);
    const cgst    = r2(taxable * 0.025);
    const sgst    = r2(taxable * 0.025);
    const gross   = taxable + cgst + sgst;
    const net     = Math.round(gross);
    const roundOff = r2(net - gross);
    return { taxable, cgst, sgst, roundOff, net };
  }

  function r2(n) { return Math.round(n * 100) / 100; }

  function fmt(n) {
    return n.toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  /* ========================================================
     AMOUNT IN WORDS  (Indian numbering system)
     ======================================================== */
  const ONES = [
    '', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
    'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
    'seventeen', 'eighteen', 'nineteen',
  ];
  const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty',
    'sixty', 'seventy', 'eighty', 'ninety'];

  function nw(n) {
    if (n === 0) return '';
    let w = '';
    if (n >= 10000000) { w += nw(Math.floor(n / 10000000)) + ' crore '; n %= 10000000; }
    if (n >= 100000)   { w += nw(Math.floor(n / 100000))   + ' lakh ';  n %= 100000;   }
    if (n >= 1000)     { w += nw(Math.floor(n / 1000))     + ' thousand '; n %= 1000;   }
    if (n >= 100)      { w += ONES[Math.floor(n / 100)] + ' hundred '; n %= 100; }
    if (n >= 20)       { w += TENS[Math.floor(n / 10)]; n %= 10; if (n) w += ' '; }
    if (n > 0)         { w += ONES[n]; }
    return w.trim();
  }

  function amountWords(total) {
    const rupees = Math.floor(total);
    const paise  = Math.round((total - rupees) * 100);
    const rWord  = nw(rupees) || 'zero';
    let out = `Indian Rupees:- ${cap(rWord)}`;
    if (paise > 0) out += ` and ${nw(paise)} paise`;
    return out + ' only.';
  }

  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  /* ========================================================
     UPDATE PREVIEW
     ======================================================== */
  function updatePreview() {
    const dateStr = get('invoiceDate');
    const invNo   = get('invoiceNo');
    const challan = get('challanNo');
    const mode    = get('modeOfPayment');
    const myGST   = get('myGSTIN');
    const myBank  = get('myBankDetails');
    const client  = state.clients.find(c => c.id === state.selectedClientId);
    const totals  = calcTotals();

    // Invoice fields
    txt('pInvoiceNo',   invNo);
    txt('pInvoiceDate', fmtDate(dateStr));
    txt('pChallanNo',   challan);
    txt('pMode',        mode);
    txt('pMyGSTIN',     myGST);

    // Buyer
    txt('pBuyerName',  client?.name        || '');
    html('pBuyerAddr', client ? client.address.replace(/\n/g, '<br>') : '');
    txt('pBuyerGSTIN', client?.gstin       || '');
    txt('pBuyerState', client?.stateName   || '');
    txt('pDest',       client?.destination || 'Kolkata');

    // Bank details on invoice (dynamic from localStorage)
    if (myBank) {
      // Parse lines: Line1=Bank Name, Line2=A/c No, Line3=Branch, Line4=IFSC
      const lines = myBank.split('\n').map(l => l.trim()).filter(Boolean);
      txt('pBankName',   lines[0] || '');
      txt('pBankAcc',    lines[1] || '');
      txt('pBankBranch', lines[2] || '');
      txt('pBankIFSC',   lines[3] || '');
    }

    // Items table
    renderPreviewItems();

    // Totals
    txt('pTaxable',   fmt(totals.taxable));
    txt('pCGST',      fmt(totals.cgst));
    txt('pSGST',      fmt(totals.sgst));
    txt('pRoundOff',  '₹' + fmt(Math.abs(totals.roundOff)));
    txt('pNetAmt',    fmt(totals.net));
    txt('pWords',     totals.net > 0 ? amountWords(totals.net) : '');

    // Sidebar summary
    txt('sumTaxable',  '₹' + fmt(totals.taxable));
    txt('sumCGST',     '₹' + fmt(totals.cgst));
    txt('sumSGST',     '₹' + fmt(totals.sgst));
    txt('sumRoundOff', '₹' + fmt(Math.abs(totals.roundOff)));
    txt('sumNet',      '₹' + fmt(totals.net));

    // Rescale after DOM updates
    requestAnimationFrame(scalePreview);
  }

  function renderPreviewItems() {
    const tbody = document.getElementById('pItemsBody');
    tbody.innerHTML = '';

    const valid = state.lineItems.filter(i => i.desc || i.qty || i.rate);

    if (valid.length === 0) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="col-slno" style="height:420px;"></td>
        <td class="col-desc"></td>
        <td class="col-hsn"></td>
        <td class="col-qty"></td>
        <td class="col-rate"></td>
        <td class="col-per"></td>
        <td class="col-gross"></td>`;
      tbody.appendChild(tr);
      return;
    }

    valid.forEach((item, idx) => {
      const gross   = r2((item.qty || 0) * (item.rate || 0));
      const qtyStr  = item.qty
        ? `${item.qty}${item.unit ? ' ' + item.unit : ''}`
        : '';
      // FIX XSS: sanitize description before rendering into innerHTML
      const descHtml = esc(item.desc || '').replace(/\n/g, '<br>');

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="col-slno">${idx + 1}.</td>
        <td class="col-desc">${descHtml}</td>
        <td class="col-hsn">${esc(item.hsn)}</td>
        <td class="col-qty">${esc(qtyStr)}</td>
        <td class="col-rate">${item.rate ? fmt(item.rate) : ''}</td>
        <td class="col-per">${esc(item.per)}</td>
        <td class="col-gross">${gross > 0 ? fmt(gross) : ''}</td>`;
      tbody.appendChild(tr);
    });

    // Spacer row so the items section fills space proportionally
    const spacerH = Math.max(60, 420 - valid.length * 90);
    const spacer = document.createElement('tr');
    spacer.innerHTML = `
      <td class="col-slno" style="height:${spacerH}px;"></td>
      <td class="col-desc"></td>
      <td class="col-hsn"></td>
      <td class="col-qty"></td>
      <td class="col-rate"></td>
      <td class="col-per"></td>
      <td class="col-gross"></td>`;
    tbody.appendChild(spacer);
  }

  /* ========================================================
     PREVIEW SCALING
     ======================================================== */
  function scalePreview() {
    const scroll  = document.getElementById('previewScroll');
    const inner   = document.getElementById('previewInner');
    const outer   = document.getElementById('previewOuter');
    const inv     = document.getElementById('invoice-preview');
    if (!scroll || !inner || !inv) return;

    const availW  = scroll.clientWidth - 48;
    const invW    = inv.offsetWidth || 794;
    const scale   = Math.min(1, availW / invW);

    inner.style.transform       = `scale(${scale})`;
    inner.style.transformOrigin = 'top left';

    // Set outer wrapper to match scaled dimensions so scroll works correctly
    const invH = inv.scrollHeight;
    outer.style.width  = `${invW * scale}px`;
    outer.style.height = `${invH * scale}px`;

    document.getElementById('zoomLabel').textContent = `${Math.round(scale * 100)}%`;
  }

  /* ========================================================
     PDF DOWNLOAD
     ======================================================== */
  async function downloadPDF() {
    const btn       = document.getElementById('dlBtn');
    const btnMobile = document.getElementById('dlBtnMobile');

    const setBtns = (disabled, label) => {
      [btn, btnMobile].forEach(b => {
        if (!b) return;
        b.disabled = disabled;
        if (label) b.textContent = label;
      });
    };

    const resetBtns = () => {
      const html = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg> Download PDF`;
      [btn, btnMobile].forEach(b => { if (b) { b.disabled = false; b.innerHTML = html; } });
    };

    setBtns(true, '⏳  Generating PDF…');

    try {
      const el    = document.getElementById('invoice-preview');
      const inner = document.getElementById('previewInner');

      // On mobile the preview may be hidden — temporarily show it for capture
      const previewPanel = document.querySelector('.preview-panel');
      const wasHidden = previewPanel.classList.contains('mobile-hidden');
      if (wasHidden) {
        previewPanel.classList.remove('mobile-hidden');
        await sleep(200);
      }

      // Reset transform so html2canvas captures at full resolution
      const prevTx = inner.style.transform;
      inner.style.transform = 'scale(1)';
      await sleep(180);

      const canvas = await html2canvas(el, {
        scale: 2.5,
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#ffffff',
        logging: false,
        imageTimeout: 0,
        removeContainer: true,
      });

      // Restore transform and preview visibility
      inner.style.transform = prevTx;
      if (wasHidden) previewPanel.classList.add('mobile-hidden');
      scalePreview();

      const imgData = canvas.toDataURL('image/jpeg', 0.97);
      const { jsPDF } = window.jspdf;
      const pdf  = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pw   = pdf.internal.pageSize.getWidth();
      const ph   = pdf.internal.pageSize.getHeight();
      const iw   = pw;
      const ih   = iw * (canvas.height / canvas.width);

      if (ih <= ph) {
        pdf.addImage(imgData, 'JPEG', 0, 0, iw, ih);
      } else {
        let yOff = 0;
        while (yOff < ih) {
          if (yOff > 0) pdf.addPage();
          pdf.addImage(imgData, 'JPEG', 0, -yOff, iw, ih);
          yOff += ph;
        }
      }

      // Build filename
      const invNo  = get('invoiceNo').replace(/\//g, '-');
      const client = state.clients.find(c => c.id === state.selectedClientId);
      const cName  = client
        ? client.name.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 20)
        : 'Invoice';
      pdf.save(`Invoice_${invNo}_${cName}.pdf`);

      // Increment invoice counter for the next invoice
      state.invoiceCounter++;
      persist('counter');
      computeInvoiceNo();

      toast('PDF downloaded successfully!', 'success');

    } catch (err) {
      console.error('PDF generation error:', err);
      toast('PDF generation failed. Please try again.', 'error');
      document.getElementById('previewInner').style.transform = '';
      scalePreview();
    } finally {
      resetBtns();
    }
  }

  /* ========================================================
     RESET
     ======================================================== */
  function reset() {
    if (!confirm('Clear all data and start a new invoice?')) return;
    state.selectedClientId = null;
    state.lineItems        = [];
    state.itemIdCounter    = 0;
    document.getElementById('lineItemsContainer').innerHTML = '';
    document.getElementById('clientSelect').value = '';
    document.getElementById('clientInfo').style.display = 'none';
    set('modeOfPayment', '');
    set('challanNo', '');
    setTodayDate();
    computeInvoiceNo();
    addItem();
    updatePreview();
  }

  /* ========================================================
     MODAL HELPERS
     ======================================================== */
  function openModal(id) {
    document.getElementById(id).style.display = 'flex';
  }

  function closeModal(id) {
    document.getElementById(id).style.display = 'none';
  }

  function closeOnBackdrop(e, id) {
    if (e.target === e.currentTarget) closeModal(id);
  }

  /* ========================================================
     UTILITY HELPERS
     ======================================================== */
  function sleep(ms)   { return new Promise(r => setTimeout(r, ms)); }
  function get(id)     { return document.getElementById(id)?.value ?? ''; }
  function set(id, v)  { const el = document.getElementById(id); if (el) el.value = v; }
  function txt(id, v)  { const el = document.getElementById(id); if (el) el.textContent = v; }
  function html(id, v) { const el = document.getElementById(id); if (el) el.innerHTML = v; }
  function clearFields(ids) { ids.forEach(id => set(id, '')); }
  function esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  function toast(msg, type = 'success') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => {
      el.style.transition = 'opacity 0.4s';
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 420);
    }, 3000);
  }

  /* ========================================================
     PUBLIC API
     ======================================================== */
  return {
    init,
    openModal,
    closeModal,
    closeOnBackdrop,
    saveClient,
    saveProduct,
    addItem,
    removeItem,
    pickProduct,
    itemChanged,
    openProductModal,
    downloadPDF,
    reset,
  };

})();

document.addEventListener('DOMContentLoaded', app.init);
