import { getPersianaColorByCode, getPersianaColors } from "./persiana-colors.js";

export const UNITS = ["CJ", "UND", "MT", "PAQ", "JGO"];

function roundQuantity(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return NaN;
  return Math.round((num + Number.EPSILON) * 1e6) / 1e6;
}

export function emptyDraft() {
  return { manager: "", phone: "", orderNumber: "0000001", lines: [] };
}

export function normalizeDraft(value) {
  if (!value || typeof value !== "object") return emptyDraft();
  const lines = Array.isArray(value.lines) ? value.lines : [];
  const rawOrderNumber = String(value.orderNumber ?? "0000001").trim().slice(0, 20);
  return {
    manager: String(value.manager || "").slice(0, 80),
    phone: String(value.phone || "").slice(0, 35),
    orderNumber: rawOrderNumber || "0000001",
    lines: lines.flatMap((line) => {
      const quantity = roundQuantity(line?.quantity);
      const unit = String(line?.unit || "").trim().toUpperCase();
      const product = line?.product;
      if (
        !product ||
        !String(product.code || "").trim() ||
        !Number.isFinite(quantity) ||
        quantity <= 0 ||
        !UNITS.includes(unit)
      ) {
        return [];
      }
      return [{
        product: {
          ...product,
          code: String(product.code).trim()
        },
        quantity,
        unit,
        color: getPersianaColorByCode(product, line?.color?.code),
        missing: Boolean(line.missing)
      }];
    })
  };
}

export function addLine(draft, product, quantity, unit, color = null) {
  const amount = roundQuantity(quantity);
  const normalizedUnit = String(unit || "").trim().toUpperCase();
  const selectedColor = color ? getPersianaColorByCode(product, color.code) : null;
  if (!product || !String(product.code || "").trim()) {
    throw new Error("Selecciona un producto válido.");
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("La cantidad debe ser mayor que cero.");
  }
  if (!UNITS.includes(normalizedUnit)) {
    throw new Error("Selecciona una unidad de medida válida.");
  }
  if (color && !selectedColor) {
    throw new Error("Selecciona un color válido para este producto.");
  }

  const lines = draft.lines.map((line) => ({ ...line }));
  const existing = lines.find(
    (line) =>
      !line.missing &&
      line.product.code.toLocaleLowerCase("es") === String(product.code).trim().toLocaleLowerCase("es") &&
      line.unit === normalizedUnit &&
      (line.color?.code || "") === (selectedColor?.code || "")
  );
  if (existing) {
    existing.quantity = roundQuantity(existing.quantity + amount);
    existing.product = product;
    existing.color = selectedColor;
  } else {
    lines.push({ product, quantity: amount, unit: normalizedUnit, color: selectedColor, missing: false });
  }
  return { ...draft, lines };
}

export function updateLine(draft, index, changes) {
  if (!Number.isInteger(index) || index < 0 || index >= draft.lines.length) {
    throw new Error("El renglón ya no existe.");
  }
  const lines = draft.lines.map((line, lineIndex) => {
    if (lineIndex !== index) return line;
    const quantity = changes.quantity === undefined ? line.quantity : roundQuantity(changes.quantity);
    const unit = changes.unit === undefined ? line.unit : String(changes.unit).trim().toUpperCase();
    const color = changes.colorCode === undefined
      ? line.color
      : getPersianaColorByCode(line.product, changes.colorCode);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error("La cantidad debe ser mayor que cero.");
    }
    if (!UNITS.includes(unit)) {
      throw new Error("Selecciona una unidad de medida válida.");
    }
    if (changes.colorCode !== undefined && changes.colorCode !== "" && !color) {
      throw new Error("Selecciona un color válido para este producto.");
    }
    return { ...line, quantity, unit, color };
  });
  return { ...draft, lines };
}

export function removeLine(draft, index) {
  if (!Number.isInteger(index) || index < 0 || index >= draft.lines.length) {
    return draft;
  }
  return { ...draft, lines: draft.lines.filter((_, lineIndex) => lineIndex !== index) };
}

export function reconcileDraft(draft, products) {
  const byCode = new Map(
    products.map((product) => [String(product.code).trim().toLocaleLowerCase("es"), product])
  );
  return {
    ...draft,
    lines: draft.lines.map((line) => {
      const key = String(line.product?.code || "").trim().toLocaleLowerCase("es");
      const current = byCode.get(key);
      if (current) {
        return {
          ...line,
          product: current,
          color: getPersianaColorByCode(current, line.color?.code),
          missing: false
        };
      }
      return { ...line, missing: true };
    })
  };
}

export function countMissingLines(draft) {
  return draft.lines.filter((line) => line.missing).length;
}

export function countMissingColorLines(draft) {
  return draft.lines.filter((line) =>
    !line.color && getPersianaColors(line.product).length > 0
  ).length;
}

export function isExportable(draft, inventory) {
  return inventory.length > 0 &&
    draft.lines.length > 0 &&
    countMissingLines(draft) === 0 &&
    countMissingColorLines(draft) === 0;
}

export function countCases(draft) {
  const total = draft.lines.reduce((sum, line) => sum + (line.unit === "CJ" ? Number(line.quantity) || 0 : 0), 0);
  return roundQuantity(total);
}