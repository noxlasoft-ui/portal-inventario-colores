import "./styles.css";
import { formatInventorySummary, parseInventory } from "./inventory.js";
import { parseOrderWorkbook } from "./import-xlsx.js";
import { createWorkbookBlob, safeOrderFilename } from "./export-xlsx.js";
import {
  getPersianaColorByCode,
  getPersianaColorFromDescription,
  getPersianaColors,
  productSearchValues
} from "./persiana-colors.js";
import {
  addLine,
  countCases,
  countMissingColorLines,
  countMissingLines,
  emptyDraft,
  isExportable,
  normalizeDraft,
  reconcileDraft,
  removeLine,
  updateLine,
  UNITS
} from "./order.js";
import { readSavedState, writeDraft, writeSavedState } from "./storage.js";

const $ = (id) => document.getElementById(id);
const MAX_FILE_SIZE = 20 * 1024 * 1024;
const PAGE_SIZE = 80;
const state = { inventory: [], inventoryInfo: null, draft: emptyDraft() };
let isImporting = false;
let selectedProduct = null;
let visibleProducts = PAGE_SIZE;
let toastTimer;
let draftSaveTimer;
let searchTimer;
let persistenceQueue = Promise.resolve();
let installPrompt = null;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("es");
}

function showToast(message) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2800);
}

function showMessage(message, kind = "error") {
  const element = $("importMessage");
  element.textContent = message;
  element.className = `message${kind === "success" ? " is-success" : kind === "info" ? " is-info" : ""}`;
  element.hidden = false;
}

function clearMessage() {
  $("importMessage").hidden = true;
  $("importMessage").textContent = "";
}

function inventorySnapshot(inventory = state.inventory, info = state.inventoryInfo) {
  return { products: inventory, info };
}

function stateSnapshot(nextState = state) {
  return {
    inventory: inventorySnapshot(nextState.inventory, nextState.inventoryInfo),
    draft: nextState.draft
  };
}

function saveDraftSoon() {
  clearTimeout(draftSaveTimer);
  draftSaveTimer = setTimeout(() => {
    const draft = state.draft;
    persistenceQueue = persistenceQueue
      .then(() => writeDraft(draft))
      .catch((error) => {
        showMessage(
          `No se guardaron los cambios en este dispositivo: ${error.message || "error de almacenamiento"}. Mantén esta pestaña abierta y descarga el pedido.`,
          "error"
        );
      });
  }, 350);
}

function saveDraft(nextDraft, rerender = true) {
  state.draft = nextDraft;
  if (rerender) renderOrder();
  saveDraftSoon();
}

function money(value) {
  return new Intl.NumberFormat("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value) || 0);
}

function inventoryDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "fecha desconocida"
    : new Intl.DateTimeFormat("es-VE", { dateStyle: "short", timeStyle: "short" }).format(date);
}

function syncControlStates() {
  const hasInventory = state.inventory.length > 0;
  const canExport = isExportable(state.draft, state.inventory);
  const hasLines = state.draft.lines.length > 0;
  const availableColors = getPersianaColors(selectedProduct);
  const selectedColor = availableColors.find(({ code }) => code === $("persianaColorInput").value);

  $("loadButton").disabled = isImporting;
  $("repoLoadButton").disabled = isImporting || location.protocol === "file:";
  $("loadTopButton").disabled = isImporting;
  $("dropZone").disabled = isImporting;
  $("searchInput").disabled = isImporting || !hasInventory;
  $("departmentFilter").disabled = isImporting || !hasInventory;
  $("quantityInput").disabled = isImporting || !hasInventory;
  $("unitInput").disabled = isImporting || !hasInventory;
  $("persianaColorInput").disabled = isImporting || !hasInventory || !availableColors.length;
  $("addButton").disabled = isImporting || !hasInventory || !selectedProduct || (availableColors.length > 0 && !selectedColor);
  $("orderExcelToggle").disabled = isImporting || !hasInventory;
  $("orderExcelFile").disabled = isImporting || !hasInventory;
  $("managerInput").disabled = isImporting;
  $("phoneInput").disabled = isImporting;
  $("orderInput").disabled = isImporting;
  $("exportButton").disabled = isImporting || !canExport;
  $("clearOrderButton").disabled = isImporting || !hasLines;
  $("catalogPanel").setAttribute("aria-busy", String(isImporting));
  $("orderPanel").setAttribute("aria-busy", String(isImporting));
  $("requestContent").querySelectorAll("input, select, button").forEach((control) => {
    control.disabled = isImporting;
  });
}

function updateInventoryBadge() {
  const badge = $("inventoryBadge");
  if (!state.inventory.length) {
    badge.classList.remove("is-ready");
    badge.innerHTML = '<span class="status-dot"></span><span>Inventario pendiente</span>';
    $("fileStatus").textContent = location.protocol === "file:" ? "Carga tu archivo XML" : "Inventario central disponible";
    $("fileDetail").textContent = location.protocol === "file:"
      ? "La carga desde repositorio requiere abrir el portal web."
      : "Pulsa «Repositorio» para cargarlo o elige tu propio XML.";
    syncControlStates();
    return;
  }
  const info = state.inventoryInfo || {};
  const loadedAt = info.loadedAt ? inventoryDate(info.loadedAt) : "fecha desconocida";
  badge.classList.add("is-ready");
  badge.innerHTML = `<span class="status-dot"></span><span>${state.inventory.length.toLocaleString("es-VE")} productos · ${escapeHtml(loadedAt)}</span>`;
  $("fileStatus").textContent = info.fileName || "Inventario guardado en este dispositivo";
  $("fileDetail").textContent = `${state.inventory.length.toLocaleString("es-VE")} productos activos · Actualizado ${loadedAt}`;
  syncControlStates();
}

function renderDepartments() {
  const select = $("departmentFilter");
  const selected = select.value;
  const departments = [...new Set(state.inventory.map((product) => product.department).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, "es", { numeric: true }));
  select.replaceChildren(new Option("Todos", ""));
  for (const department of departments) {
    select.add(new Option(`Departamento ${department}`, department));
  }
  if (departments.includes(selected)) select.value = selected;
}

function matchingProducts() {
  const query = normalizeSearchText($("searchInput").value.trim());
  const department = $("departmentFilter").value;
  return state.inventory.filter((product) => {
    if (department && product.department !== department) return false;
    if (!query) return true;
    return productSearchValues(product)
      .some((value) => normalizeSearchText(value).includes(query));
  });
}

function renderProducts() {
  const filtered = matchingProducts();
  const shown = filtered.slice(0, visibleProducts);
  $("resultCount").textContent = state.inventory.length
    ? `${filtered.length.toLocaleString("es-VE")} ${filtered.length === 1 ? "producto" : "productos"}`
    : "Primero carga el inventario";
  $("resultLimit").textContent = filtered.length > shown.length
    ? `Mostrando ${shown.length.toLocaleString("es-VE")} de ${filtered.length.toLocaleString("es-VE")}`
    : "";
  $("clearSearch").hidden = !$("searchInput").value;
  $("showMoreButton").hidden = filtered.length <= shown.length;

  const list = $("productList");
  if (!state.inventory.length) {
    list.innerHTML = '<div class="empty-state"><span class="empty-icon" aria-hidden="true">▦</span><strong>Tu catálogo aparecerá aquí</strong><span>Carga el inventario desde el repositorio o selecciona un archivo XML.</span></div>';
    return;
  }
  if (!shown.length) {
    list.innerHTML = '<div class="empty-state"><span class="empty-icon" aria-hidden="true">⌕</span><strong>No encontramos productos</strong><span>Prueba con otro código, nombre o departamento.</span></div>';
    return;
  }
  list.innerHTML = shown.map((product) => {
    const colors = getPersianaColors(product);
    return `
      <button class="product-row${selectedProduct?.code === product.code ? " is-selected" : ""}" type="button" data-code="${escapeHtml(product.code)}" aria-pressed="${selectedProduct?.code === product.code}">
        <span class="product-code">${escapeHtml(product.code)}</span>
        <span class="product-description"><strong>${escapeHtml(product.fullDescription)}</strong><small>${escapeHtml(product.brand || "Sin marca")} · Dpto. ${escapeHtml(product.department || "—")}</small>${colors.length ? `<small class="product-colors">Colores: ${colors.map(({ code, color }) => `${escapeHtml(code)}: ${escapeHtml(color)}`).join(" · ")}</small>` : ""}</span>
        <span class="product-price">${money(product.price)}<small>Precio 1</small></span>
      </button>`;
  }).join("");
}

function updateOrderSummary(draft) {
  const missing = countMissingLines(draft);
  const missingColors = countMissingColorLines(draft);
  const lineCount = draft.lines.length;
  const countText = `${lineCount.toLocaleString("es-VE")} ${lineCount === 1 ? "producto" : "productos"}`;
  $("rowCounter").textContent = countText;
  $("mobileLineCount").textContent = lineCount > 99 ? "99+" : String(lineCount);
  $("lineTotal").textContent = lineCount.toLocaleString("es-VE");
  $("caseTotal").textContent = new Intl.NumberFormat("es-VE", { maximumFractionDigits: 2 }).format(countCases(draft));
  if ($("managerInput").value !== draft.manager) $("managerInput").value = draft.manager;
  if ($("phoneInput").value !== draft.phone) $("phoneInput").value = draft.phone;
  if ($("orderInput").value !== draft.orderNumber) $("orderInput").value = draft.orderNumber;
  $("orderHint").textContent = missing
    ? "Hay productos que debes revisar antes de descargar."
    : missingColors
      ? "Elige un color para cada persiana antes de descargar."
      : "Los cambios se guardan automáticamente.";
  const notice = $("reconcileNotice");
  notice.hidden = !missing;
  notice.textContent = missing
    ? `${missing === 1 ? "Un producto ya no aparece" : `${missing} productos ya no aparecen`} en el inventario actual. Elimina ${missing === 1 ? "ese renglón" : "esos renglones"} o agrégalos de nuevo con su código actualizado para poder descargar.`
    : "";
}

function renderOrder() {
  const draft = state.draft;
  updateOrderSummary(draft);
  const content = $("requestContent");
  if (!draft.lines.length) {
    content.innerHTML = '<div class="request-empty"><span class="empty-icon" aria-hidden="true">▤</span><strong>Tu pedido está vacío</strong><span>Agrega productos desde el catálogo o importa una reposición desde Excel.</span></div>';
    syncControlStates();
    return;
  }
  content.innerHTML = `<div class="request-lines">${draft.lines.map((line, index) => {
    const colors = getPersianaColors(line.product);
    return `
      <div class="order-line" data-order-line="${index}">
        <span class="order-line-product">
          <strong>${escapeHtml(line.product.fullDescription || line.product.item)}</strong>
          <small class="${line.missing ? "stale-label" : ""}">${escapeHtml(line.product.code)}${line.missing ? " · No está en el inventario actual" : ""}</small>
        </span>
        <input class="line-quantity" type="number" min="0.01" step="any" value="${escapeHtml(line.quantity)}" aria-label="Cantidad para ${escapeHtml(line.product.item)}" data-line-quantity="${index}">
        <select class="line-unit" aria-label="Unidad para ${escapeHtml(line.product.item)}" data-line-unit="${index}">
          ${UNITS.map((unit) => `<option${line.unit === unit ? " selected" : ""}>${unit}</option>`).join("")}
        </select>
        <button class="remove-line" type="button" aria-label="Eliminar ${escapeHtml(line.product.item)}" data-remove-line="${index}">×</button>
        ${colors.length ? `<label class="order-line-color"><span>Color para preparar</span><select class="line-color" required aria-label="Color para ${escapeHtml(line.product.item)}" data-line-color="${index}"><option value="">Selecciona un color</option>${colors.map(({ code, color }) => `<option value="${escapeHtml(code)}"${line.color?.code === code ? " selected" : ""}>${escapeHtml(code)} · ${escapeHtml(color)}</option>`).join("")}</select></label>` : ""}
      </div>`;
  }).join("")}</div>`;
  syncControlStates();
}

function removeOrderLine(index) {
  const nextDraft = removeLine(state.draft, index);
  if (nextDraft === state.draft) return;

  const content = $("requestContent");
  const list = content.querySelector(".request-lines");
  const row = list?.querySelector(`[data-order-line="${index}"]`);
  if (!list || !row) {
    saveDraft(nextDraft);
    return;
  }

  saveDraft(nextDraft, false);
  row.remove();
  const remainingRows = [...list.querySelectorAll(".order-line")];
  if (remainingRows.length) {
    remainingRows.forEach((remainingRow, lineIndex) => {
      remainingRow.dataset.orderLine = String(lineIndex);
      const quantity = remainingRow.querySelector("[data-line-quantity]");
      const unit = remainingRow.querySelector("[data-line-unit]");
      const color = remainingRow.querySelector("[data-line-color]");
      const remove = remainingRow.querySelector("[data-remove-line]");
      if (quantity) quantity.dataset.lineQuantity = String(lineIndex);
      if (unit) unit.dataset.lineUnit = String(lineIndex);
      if (color) color.dataset.lineColor = String(lineIndex);
      if (remove) remove.dataset.removeLine = String(lineIndex);
    });
  } else {
    content.innerHTML = '<div class="request-empty"><span class="empty-icon" aria-hidden="true">▤</span><strong>Tu pedido está vacío</strong><span>Agrega productos desde el catálogo o importa una reposición desde Excel.</span></div>';
  }

  updateOrderSummary(state.draft);
  syncControlStates();
  if (remainingRows.length) {
    const focusIndex = Math.min(index, remainingRows.length - 1);
    list.querySelector(`[data-remove-line="${focusIndex}"]`)?.focus({ preventScroll: true });
  }
}

function renderAll() {
  updateInventoryBadge();
  renderProducts();
  renderOrder();
}

function setSelectedProduct(product) {
  const sameProduct = selectedProduct?.code === product?.code;
  selectedProduct = product;
  const colors = getPersianaColors(product);
  const colorInput = $("persianaColorInput");
  colorInput.replaceChildren(new Option("Selecciona un color", ""));
  for (const { code, color } of colors) {
    colorInput.add(new Option(`${code} · ${color}`, code));
  }
  if (!sameProduct) colorInput.value = "";
  $("persianaColorField").hidden = !colors.length;
  $("selectedProduct").textContent = product
    ? `${product.code} · ${product.fullDescription}`
    : "Toca un producto del catálogo.";
  $("selectedProduct").parentElement.classList.toggle("has-selection", Boolean(product));
  syncControlStates();
  renderProducts();
  const selectedButton = [...$("productList").querySelectorAll("[data-code]")]
    .find((button) => button.dataset.code === product?.code);
  selectedButton?.focus({ preventScroll: true });
}

function setImportBusy(busy) {
  isImporting = Boolean(busy);
  syncControlStates();
}

function updateDraftField(field, value) {
  state.draft = { ...state.draft, [field]: value };
  syncControlStates();
  saveDraftSoon();
}

async function commitInventoryText(xmlText, fileName, fileSize, confirmReplacement) {
  const result = parseInventory(xmlText);
  const nextDraft = reconcileDraft(state.draft, result.products);
  const missing = countMissingLines(nextDraft);
  if (confirmReplacement && state.inventory.length) {
    const details = state.draft.lines.length
      ? missing
        ? `Se conservarán los ${state.draft.lines.length} productos del pedido. ${missing} no coinciden con el nuevo inventario y quedarán marcados para revisar antes de exportar.`
        : `Se conservarán los ${state.draft.lines.length} productos del pedido y se actualizarán sus descripciones y precios.`
      : "El pedido actual está vacío y no se perderán renglones.";
    if (!window.confirm(`¿Reemplazar el inventario guardado en este dispositivo?\n\n${details}`)) {
      showMessage("No se cambió el inventario. La versión anterior sigue intacta.", "info");
      return false;
    }
  }

  const info = {
    fileName,
    loadedAt: new Date().toISOString(),
    productCount: result.products.length,
    totalRecords: result.totalRecords,
    inactiveRecords: result.inactiveRecords,
    skippedRecords: result.skippedRecords,
    fileSize
  };
  const nextState = { inventory: result.products, inventoryInfo: info, draft: nextDraft };
  const save = persistenceQueue.then(() => writeSavedState(stateSnapshot(nextState)));
  persistenceQueue = save.catch((error) => {
    showMessage(`El inventario no se reemplazó porque no se pudo guardar en este dispositivo: ${error.message || "error de almacenamiento"}.`, "error");
  });
  await save;
  state.inventory = nextState.inventory;
  state.inventoryInfo = nextState.inventoryInfo;
  state.draft = nextState.draft;
  setSelectedProduct(null);
  visibleProducts = PAGE_SIZE;
  $("searchInput").value = "";
  $("departmentFilter").value = "";
  renderDepartments();
  renderAll();

  const summary = formatInventorySummary(result);
  const note = result.inactiveRecords || result.skippedRecords ? ` ${summary}` : "";
  showMessage(`Inventario actualizado: ${result.products.length.toLocaleString("es-VE")} productos activos. ${info.fileName} · ${inventoryDate(info.loadedAt)}.${note}`, "success");
  showToast("Inventario guardado en este dispositivo.");
  return true;
}

async function stageInventory(file) {
  if (!file) return;
  clearMessage();
  if (file.size > MAX_FILE_SIZE) {
    showMessage("El archivo supera el límite de 20 MB. Exporta el inventario nuevamente desde Stellar.");
    return;
  }

  clearTimeout(draftSaveTimer);
  let committed = false;
  setImportBusy(true);
  $("fileStatus").textContent = "Leyendo y validando el inventario…";
  $("fileDetail").textContent = "La versión anterior sigue disponible mientras se revisa el archivo.";

  try {
    committed = await commitInventoryText(
      await file.text(),
      file.name,
      file.size,
      state.draft.lines.length > 0
    );
  } catch (error) {
    showMessage(error.message || "No se pudo leer el inventario. La versión anterior no cambió.");
  } finally {
    setImportBusy(false);
    if (!committed) updateInventoryBadge();
    $("xmlFile").value = "";
  }
}

async function loadRepositoryInventory(initial = false) {
  clearMessage();
  clearTimeout(draftSaveTimer);
  let committed = false;
  setImportBusy(true);
  $("fileStatus").textContent = "Cargando desde el repositorio…";
  $("fileDetail").textContent = "Tu inventario actual no cambiará hasta validar el XML.";
  try {
    const response = await fetch("./INVENTARIO.xml", { cache: "no-store" });
    if (!response.ok) throw new Error(`El repositorio respondió con el estado ${response.status}.`);
    const xmlText = await response.text();
    const fileSize = new Blob([xmlText]).size;
    if (fileSize > MAX_FILE_SIZE) {
      throw new Error("El XML del repositorio supera el límite de 20 MB.");
    }
    committed = await commitInventoryText(
      xmlText,
      "INVENTARIO.xml · Repositorio",
      fileSize,
      !initial && state.inventory.length > 0
    );
  } catch (error) {
    showMessage(`No se pudo cargar el XML del repositorio: ${error.message || "error de conexión"}. Tu inventario guardado sigue intacto.`);
  } finally {
    setImportBusy(false);
    if (!committed) updateInventoryBadge();
  }
}

async function importOrderFile(file) {
  if (!file) return;
  clearMessage();
  $("orderExcelToggle").checked = false;
  if (file.size > MAX_FILE_SIZE) {
    showMessage("El Excel supera el límite de 20 MB.");
    return;
  }
  if (!state.inventory.length) {
    showMessage("Carga primero el inventario para poder relacionar los códigos del Excel.");
    return;
  }

  setImportBusy(true);
  try {
    const parsed = parseOrderWorkbook(new Uint8Array(await file.arrayBuffer()));
    const byCode = new Map(state.inventory.map((product) => [product.code.toLocaleLowerCase("es"), product]));
    let nextDraft = state.draft;
    let added = 0;
    let rejected = 0;
    const unmatchedCodes = new Set();
    const rejectedCodes = new Set();
    for (const importedLine of parsed.lines) {
      try {
        const code = importedLine.code.trim();
        const product = byCode.get(code.toLocaleLowerCase("es"));
        if (product) {
          const color = getPersianaColorByCode(product, importedLine.colorCode) ||
            getPersianaColorFromDescription(product, importedLine.description);
          nextDraft = addLine(nextDraft, product, importedLine.quantity, importedLine.unit, color);
        } else {
          const fullDescription = [importedLine.item, importedLine.description].filter(Boolean).join(" ").trim() || code;
          const item = importedLine.item || fullDescription.split(/\s+/)[0];
          const missingProduct = {
            code,
            item,
            fullDescription,
            shortDescription: importedLine.description || fullDescription.slice(item.length).trim(),
            department: "",
            brand: "",
            cost: 0,
            price: 0
          };
          const existingIndex = nextDraft.lines.findIndex((line) =>
            line.missing &&
            line.product.code.toLocaleLowerCase("es") === code.toLocaleLowerCase("es") &&
            line.unit === importedLine.unit
          );
          if (existingIndex >= 0) {
            const lines = nextDraft.lines.map((line, index) => index === existingIndex
              ? { ...line, quantity: line.quantity + importedLine.quantity }
              : line);
            nextDraft = { ...nextDraft, lines };
          } else {
            nextDraft = {
              ...nextDraft,
              lines: [...nextDraft.lines, { product: missingProduct, quantity: importedLine.quantity, unit: importedLine.unit, missing: true }]
            };
          }
          unmatchedCodes.add(code);
        }
        added += 1;
      } catch {
        rejected += 1;
        rejectedCodes.add(importedLine.code);
      }
    }

    if (added) saveDraft(nextDraft);
    const notes = [];
    if (unmatchedCodes.size) {
      const examples = [...unmatchedCodes].slice(0, 6).join(", ");
      notes.push(`${unmatchedCodes.size} códigos no están en el inventario y quedaron marcados para revisar (${examples}${unmatchedCodes.size > 6 ? "…" : ""})`);
    }
    if (parsed.skippedRows.length) {
      notes.push(`${parsed.skippedRows.length} filas sin unidad válida omitidas (fila${parsed.skippedRows.length === 1 ? "" : "s"} ${parsed.skippedRows.slice(0, 8).join(", ")})`);
    }
    if (rejected) {
      const examples = [...rejectedCodes].slice(0, 6).join(", ");
      notes.push(`${rejected} renglones no se pudieron agregar${examples ? ` (${examples}${rejectedCodes.size > 6 ? "…" : ""})` : ""}`);
    }
    showMessage(
      `${added} renglones agregados desde «${file.name}».${notes.length ? ` ${notes.join(". ")}.` : ""}`,
      notes.length ? "info" : "success"
    );
    if (added) showToast("Reposición agregada al pedido actual.");
  } catch (error) {
    showMessage(error.message || "No se pudo leer el Excel.");
  } finally {
    setImportBusy(false);
    $("orderExcelFile").value = "";
  }
}

function downloadOrder() {
  if (!isExportable(state.draft, state.inventory)) {
    showToast(countMissingLines(state.draft)
      ? "Revisa los productos que ya no están en el inventario."
      : countMissingColorLines(state.draft)
        ? "Elige un color para cada persiana antes de descargar."
        : "Agrega al menos un producto al pedido.");
    return;
  }
  try {
    const blob = createWorkbookBlob(state.inventory, state.draft);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Nota_de_Pedido_${safeOrderFilename(state.draft.orderNumber)}.xlsx`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast("Archivo Excel descargado.");
  } catch (error) {
    showMessage(`No se pudo generar el Excel: ${error.message || "error al crear el archivo"}.`);
  }
}

function setMobileView(view) {
  document.body.dataset.mobileView = view;
  document.querySelectorAll("[data-mobile-view]").forEach((button) => {
    const active = button.dataset.mobileView === view;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function openFilePicker(input, description) {
  try {
    if (typeof input.showPicker === "function") input.showPicker();
    else input.click();
  } catch (pickerError) {
    try {
      input.click();
    } catch (clickError) {
      showMessage(`No se pudo abrir el selector de archivos ${description}: ${clickError.message || pickerError.message || "intenta otra vez"}.`);
    }
  }
}

function configureImportControls() {
  const input = $("xmlFile");
  $("repoLoadButton").title = location.protocol === "file:"
    ? "Abre el portal web para cargar el inventario desde el repositorio."
    : "";
  $("repoLoadButton").disabled = location.protocol === "file:";
  const choose = () => openFilePicker(input, "XML");
  $("loadButton").addEventListener("click", choose);
  $("loadTopButton").addEventListener("click", choose);
  $("repoLoadButton").addEventListener("click", () => loadRepositoryInventory(false));
  $("dropZone").addEventListener("click", choose);
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    input.value = "";
    stageInventory(file);
  });
  const dropZone = $("dropZone");
  for (const eventName of ["dragenter", "dragover"]) {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropZone.classList.add("is-dragging");
    });
  }
  for (const eventName of ["dragleave", "drop"]) {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropZone.classList.remove("is-dragging");
    });
  }
  dropZone.addEventListener("drop", (event) => stageInventory(event.dataTransfer?.files?.[0]));
}

function configureOrderControls() {
  const orderExcelToggle = $("orderExcelToggle");
  const orderExcelFile = $("orderExcelFile");
  orderExcelToggle.addEventListener("change", () => {
    if (!orderExcelToggle.checked) return;
    if (!state.inventory.length) {
      orderExcelToggle.checked = false;
      showMessage("Carga primero el inventario para poder relacionar los códigos del Excel.", "info");
      return;
    }
    openFilePicker(orderExcelFile, "Excel");
  });
  orderExcelFile.addEventListener("change", () => {
    const file = orderExcelFile.files?.[0];
    orderExcelFile.value = "";
    importOrderFile(file);
  });
  orderExcelFile.addEventListener("cancel", () => {
    orderExcelToggle.checked = false;
  });
  $("productList").addEventListener("click", (event) => {
    const button = event.target.closest("[data-code]");
    if (!button) return;
    const product = state.inventory.find((item) => item.code === button.dataset.code);
    if (product) setSelectedProduct(product);
  });
  $("searchInput").addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      visibleProducts = PAGE_SIZE;
      renderProducts();
    }, 90);
  });
  $("clearSearch").addEventListener("click", () => {
    clearTimeout(searchTimer);
    $("searchInput").value = "";
    $("searchInput").focus();
    visibleProducts = PAGE_SIZE;
    renderProducts();
  });
  $("departmentFilter").addEventListener("change", () => {
    visibleProducts = PAGE_SIZE;
    renderProducts();
  });
  $("showMoreButton").addEventListener("click", () => {
    visibleProducts += PAGE_SIZE;
    renderProducts();
  });
  const addSelected = () => {
    if (!selectedProduct) return;
    const colors = getPersianaColors(selectedProduct);
    const selectedColor = colors.find(({ code }) => code === $("persianaColorInput").value);
    if (colors.length && !selectedColor) {
      showToast("Elige el color de la persiana antes de agregarla.");
      $("persianaColorInput").focus();
      return;
    }
    try {
      saveDraft(addLine(state.draft, selectedProduct, $("quantityInput").value, $("unitInput").value, selectedColor));
      $("quantityInput").value = "1";
      showToast("Producto agregado al pedido.");
    } catch (error) {
      showToast(error.message);
      $("quantityInput").focus();
    }
  };
  $("addButton").addEventListener("click", addSelected);
  $("persianaColorInput").addEventListener("change", syncControlStates);
  $("quantityInput").addEventListener("keydown", (event) => {
    if (event.key === "Enter") addSelected();
  });
  $("requestContent").addEventListener("change", (event) => {
    const quantity = event.target.closest("[data-line-quantity]");
    const unit = event.target.closest("[data-line-unit]");
    const color = event.target.closest("[data-line-color]");
    if (!quantity && !unit && !color) return;
    const input = quantity || unit || color;
    const index = Number(input.dataset[quantity ? "lineQuantity" : unit ? "lineUnit" : "lineColor"]);
    try {
      const changes = quantity
        ? { quantity: quantity.value }
        : unit
          ? { unit: unit.value }
          : { colorCode: color.value };
      saveDraft(updateLine(state.draft, index, changes));
    } catch (error) {
      showToast(error.message);
      renderOrder();
    }
  });
  $("requestContent").addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-line]");
    if (!button) return;
    removeOrderLine(Number(button.dataset.removeLine));
  });
  for (const [id, field] of [["managerInput", "manager"], ["phoneInput", "phone"], ["orderInput", "orderNumber"]]) {
    $(id).addEventListener("input", (event) => updateDraftField(field, event.target.value));
  }
  $("clearOrderButton").addEventListener("click", () => {
    if (!state.draft.lines.length) return;
    if (!window.confirm("¿Vaciar los productos de este pedido? Los datos del encargado y el número se conservarán.")) return;
    saveDraft({ ...state.draft, lines: [] });
    showToast("Pedido vacío.");
  });
  $("exportButton").addEventListener("click", downloadOrder);
  document.querySelectorAll("[data-mobile-view]").forEach((button) => {
    button.addEventListener("click", () => setMobileView(button.dataset.mobileView));
  });
}

async function restoreSavedState() {
  try {
    const saved = await readSavedState();
    const products = Array.isArray(saved.inventory?.products) ? saved.inventory.products : [];
    state.inventory = products;
    state.inventoryInfo = products.length && saved.inventory.info ? saved.inventory.info : null;
    const draft = normalizeDraft(saved.draft);
    state.draft = products.length ? reconcileDraft(draft, products) : draft;
    renderDepartments();
    renderAll();
    if (products.length) {
      const missing = countMissingLines(state.draft);
      if (missing) {
        showMessage(`${missing} productos guardados en el pedido ya no están en el inventario guardado. Revísalos antes de descargar.`, "info");
      } else {
        showMessage(`Inventario y pedido restaurados desde este dispositivo. Última actualización: ${inventoryDate(state.inventoryInfo?.loadedAt)}.`, "info");
      }
    }
  } catch (error) {
    renderAll();
    showMessage(`No se pudo abrir el almacenamiento local: ${error.message || "error de almacenamiento"}. Puedes usar la app en esta pestaña, pero importa un inventario y descarga tu pedido antes de cerrarla.`);
  }
}

function configureInstallPrompt() {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
    $("installButton").hidden = false;
  });
  $("installButton").addEventListener("click", async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    $("installButton").hidden = true;
  });
  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    $("installButton").hidden = true;
    showToast("App instalada en este dispositivo.");
  });
}

function updateConnectionStatus() {
  const status = $("connectionStatus");
  const offline = !navigator.onLine;
  status.classList.toggle("is-offline", offline);
  status.querySelector("span:last-child").textContent = offline ? "Sin conexión · modo local" : "En este dispositivo";
}

function setTheme(theme, persist = true) {
  const isDark = theme === "dark";
  document.documentElement.dataset.theme = isDark ? "dark" : "light";
  $("themeToggle").setAttribute("aria-label", isDark ? "Cambiar a tema claro" : "Cambiar a tema oscuro");
  $("themeToggle").setAttribute("aria-pressed", String(isDark));
  $("themeToggle").querySelector(".theme-label").textContent = isDark ? "Tema claro" : "Tema oscuro";
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) metaTheme.content = isDark ? "#0b1422" : "#10233f";
  if (persist) {
    try {
      localStorage.setItem("coisa-hogar-theme", isDark ? "dark" : "light");
    } catch {
      showToast("No se pudo guardar la preferencia del tema en este dispositivo.");
    }
  }
}

function configureTheme() {
  let savedTheme = "";
  try {
    savedTheme = localStorage.getItem("coisa-hogar-theme") || "";
  } catch {
    savedTheme = "";
  }
  const initialTheme = savedTheme === "light" || savedTheme === "dark"
    ? savedTheme
    : window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  setTheme(initialTheme, false);
  $("themeToggle").addEventListener("click", () => {
    setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
  });
}

async function registerOfflineSupport() {
  if (window.location.protocol === "file:" || window.location.protocol === "tauri:" || window.location.hostname === "tauri.localhost") return;
  if (!("serviceWorker" in navigator)) {
    showMessage("Este navegador no permite activar el modo sin conexión. Puedes seguir usando la app mientras la página esté abierta.", "info");
    return;
  }
  try {
    await navigator.serviceWorker.register("./sw.js");
  } catch {
    showMessage("No se pudo activar el modo sin conexión en este navegador. La app y los datos guardados siguen disponibles mientras la página esté abierta.", "info");
  }
}

configureImportControls();
configureOrderControls();
configureInstallPrompt();
configureTheme();
setMobileView("catalog");
updateConnectionStatus();
window.addEventListener("online", updateConnectionStatus);
window.addEventListener("offline", updateConnectionStatus);

async function startApp() {
  await restoreSavedState();
  if (!state.inventory.length && location.protocol !== "file:" && navigator.onLine) {
    await loadRepositoryInventory(true);
  }
  registerOfflineSupport();
}

startApp();