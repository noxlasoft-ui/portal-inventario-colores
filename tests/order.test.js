import test from "node:test";
import assert from "node:assert/strict";
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
  updateLine
} from "../src/order.js";

const firstProduct = { code: "000001", item: "TERMO", fullDescription: "TERMO DEPORTIVO", price: 12 };
const updatedProduct = { ...firstProduct, fullDescription: "TERMO DEPORTIVO 1L", price: 14 };
const secondProduct = { code: "000002", item: "POTES", fullDescription: "SET DE POTES", price: 8 };
const persianaProduct = {
  code: "000003",
  item: "100PZ",
  fullDescription: "100PZ PERSIANA",
  brand: "PERSIANA",
  price: 18
};

test("adds and combines matching product lines without changing other units", () => {
  let draft = addLine(emptyDraft(), firstProduct, "2", "CJ");
  draft = addLine(draft, firstProduct, 3, "CJ");
  draft = addLine(draft, firstProduct, 1, "UND");
  assert.equal(draft.lines.length, 2);
  assert.equal(draft.lines[0].quantity, 5);
  assert.equal(countCases(draft), 5);
  assert.throws(() => addLine(draft, firstProduct, 0, "CJ"), /mayor que cero/);
  assert.throws(() => addLine(draft, firstProduct, 1, "INVALID"), /unidad/);
});

test("inventory replacement refreshes matching codes and preserves unmatched draft lines", () => {
  const draft = addLine(addLine(emptyDraft(), firstProduct, 2, "CJ"), secondProduct, 1, "UND");
  const updated = reconcileDraft(draft, [updatedProduct]);
  assert.equal(updated.lines[0].product.fullDescription, "TERMO DEPORTIVO 1L");
  assert.equal(updated.lines[0].quantity, 2);
  assert.equal(updated.lines[0].missing, false);
  assert.equal(updated.lines[1].product.code, "000002");
  assert.equal(updated.lines[1].missing, true);
  assert.equal(countMissingLines(updated), 1);
  assert.equal(isExportable(updated, [updatedProduct]), false);
  assert.equal(isExportable(reconcileDraft(draft, [updatedProduct, secondProduct]), [updatedProduct, secondProduct]), true);
});

test("validates line edits, removes lines and normalizes recovered drafts", () => {
  const draft = addLine(emptyDraft(), firstProduct, 2, "CJ");
  assert.throws(() => updateLine(draft, 0, { quantity: -1 }), /mayor que cero/);
  assert.throws(() => updateLine(draft, 1, { unit: "OTHER" }), /ya no existe/);
  assert.equal(updateLine(draft, 0, { unit: "PAQ" }).lines[0].unit, "PAQ");
  assert.equal(removeLine(draft, 0).lines.length, 0);
  const recovered = normalizeDraft({ orderNumber: "123", lines: [{ product: firstProduct, quantity: 0, unit: "CJ" }] });
  assert.equal(recovered.orderNumber, "123");
  assert.deepEqual(recovered.lines, []);
});

test("requires a color for persianas and keeps quantities separate by selected color", () => {
  const black = { code: "11-2" };
  const white = { code: "11-1" };
  let draft = addLine(emptyDraft(), persianaProduct, 2, "CJ", black);
  draft = addLine(draft, persianaProduct, 3, "CJ", black);

  assert.equal(draft.lines.length, 1);
  assert.equal(draft.lines[0].quantity, 5);
  assert.equal(draft.lines[0].color.color, "Negro");
  assert.equal(isExportable(draft, [persianaProduct]), true);

  draft = addLine(draft, persianaProduct, 1, "CJ", white);
  assert.equal(draft.lines.length, 2);
  assert.equal(draft.lines[1].color.color, "Blanco");
});

test("blocks exporting persianas without colors and allows selecting a color on the order line", () => {
  const draft = addLine(emptyDraft(), persianaProduct, 1, "CJ");
  assert.equal(countMissingColorLines(draft), 1);
  assert.equal(isExportable(draft, [persianaProduct]), false);

  const selected = updateLine(draft, 0, { colorCode: "11-3" });
  assert.equal(selected.lines[0].color.color, "Gris oscuro");
  assert.equal(countMissingColorLines(selected), 0);
  assert.equal(isExportable(selected, [persianaProduct]), true);
  assert.throws(() => addLine(emptyDraft(), persianaProduct, 1, "CJ", { code: "INVALID" }), /color válido/);
});

test("preserves valid persiana colors on restore and inventory reconciliation", () => {
  const line = addLine(emptyDraft(), persianaProduct, 1, "CJ", { code: "11-6" }).lines[0];
  const restored = normalizeDraft({ lines: [{ ...line, color: { code: "INVALID", color: "Fake" } }] });
  assert.equal(restored.lines[0].color, null);
  assert.equal(countMissingColorLines(restored), 1);

  const draft = normalizeDraft({ lines: [line] });
  const updatedProduct = { ...persianaProduct, fullDescription: "100PZ PERSIANA ACTUALIZADA" };
  const reconciled = reconcileDraft(draft, [updatedProduct]);
  assert.equal(reconciled.lines[0].color.color, "Gris claro");
  assert.equal(reconciled.lines[0].product.fullDescription, "100PZ PERSIANA ACTUALIZADA");
});
