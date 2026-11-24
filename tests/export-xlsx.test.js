import test from "node:test";
import assert from "node:assert/strict";
import { createWorkbookBytes, safeOrderFilename } from "../src/export-xlsx.js";

function storedZipEntries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = new Map();
  let offset = 0;
  while (offset + 30 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const size = view.getUint32(offset + 18, true);
    const nameStart = offset + 30;
    const name = new TextDecoder().decode(bytes.subarray(nameStart, nameStart + nameLength));
    const dataStart = nameStart + nameLength + extraLength;
    entries.set(name, bytes.subarray(dataStart, dataStart + size));
    offset = dataStart + size;
  }
  return entries;
}

function textEntry(entries, name) {
  const entry = entries.get(name);
  assert.ok(entry, `Missing ZIP entry ${name}`);
  return new TextDecoder().decode(entry);
}

function cellValue(sheet, reference) {
  const escaped = reference.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = sheet.match(new RegExp(`<c\\b(?=[^>]*\\br="${escaped}")[^>]*>([\\s\\S]*?)<\\/c>`));
  assert.ok(match, `Missing cell ${reference}`);
  const value = /<t\b[^>]*>([\s\S]*?)<\/t>/.exec(match[1]) || /<v>([\s\S]*?)<\/v>/.exec(match[1]);
  return value
    ? value[1].replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&")
    : "";
}

function makeWorkbook(lineCount = 1) {
  const product = {
    code: "000001",
    item: "TERMO",
    fullDescription: "TERMO & TAPA",
    shortDescription: "& TAPA",
    department: "022",
    brand: "Marca",
    cost: 4.9,
    price: 12.67
  };
  const inventory = [product];
  const draft = {
    manager: "María",
    phone: "555-0100",
    orderNumber: "0000042",
    lines: Array.from({ length: lineCount }, () => ({ product, quantity: 2.5, unit: "CJ" }))
  };
  return { bytes: createWorkbookBytes(inventory, draft), inventory, draft };
}

test("matches the reference order layout and includes the current inventory", () => {
  const { bytes } = makeWorkbook();
  const entries = storedZipEntries(bytes);
  const workbook = textEntry(entries, "xl/workbook.xml");
  const orderSheet = textEntry(entries, "xl/worksheets/sheet1.xml");
  const inventorySheet = textEntry(entries, "xl/worksheets/sheet2.xml");

  assert.match(workbook, /name="Table 1"/);
  assert.match(workbook, /name="Base_Inventario"/);
  assert.match(orderSheet, /orientation="portrait"/);
  assert.match(orderSheet, /<drawing r:id="rId1"/);
  assert.match(orderSheet, /<mergeCell ref="D7:F7"\/>/);
  assert.match(orderSheet, /<autoFilter ref="A6:H7"/);
  assert.equal(cellValue(orderSheet, "E1"), "NOTA DE PEDIDO 0000042");
  assert.match(cellValue(orderSheet, "F2"), /^Fecha \d{2}\/\d{2}\/\d{4}$/);
  assert.equal(cellValue(orderSheet, "A3"), "ENCARGADO RESP.: María");
  assert.equal(cellValue(orderSheet, "A4"), "                                            Teléfono: 555-0100");
  assert.equal(cellValue(orderSheet, "A7"), "000001");
  assert.equal(cellValue(orderSheet, "B7"), "TERMO");
  assert.equal(cellValue(orderSheet, "D7"), "& TAPA");
  assert.equal(cellValue(orderSheet, "G7"), "2.5 CJ");
  assert.doesNotMatch(orderSheet, /000543|LAMPARA LED/);
  assert.ok(entries.get("xl/media/image1.png")?.length > 1000, "the reference logo is included");
  assert.equal(cellValue(inventorySheet, "A1"), "CODIGO");
  assert.equal(cellValue(inventorySheet, "C1"), "DESCRIPCION_COMPLETA");
  assert.equal(cellValue(inventorySheet, "A2"), "000001");
  assert.equal(cellValue(inventorySheet, "G2"), "4.9");
  assert.equal(cellValue(inventorySheet, "H2"), "12.67");
  assert.match(inventorySheet, /<autoFilter ref="A1:H2"/);
  assert.equal(entries.has("xl/sharedStrings.xml"), false);
});

test("extends the reference row format and merged columns past its 79-row sample", () => {
  const { bytes } = makeWorkbook(80);
  const entries = storedZipEntries(bytes);
  const orderSheet = textEntry(entries, "xl/worksheets/sheet1.xml");
  const workbook = textEntry(entries, "xl/workbook.xml");

  assert.equal(cellValue(orderSheet, "A86"), "000001");
  assert.match(orderSheet, /<mergeCell ref="G86:H86"\/>/);
  assert.match(orderSheet, /<dimension ref="A1:L86"\/>/);
  assert.match(orderSheet, /<autoFilter ref="A6:H86"/);
  assert.match(workbook, /'Table 1'!\$A\$6:\$H\$86/);
});

test("includes the selected persiana color in the order description", () => {
  const product = {
    code: "001121",
    item: "100PZ",
    fullDescription: "100PZ PERSIANA",
    shortDescription: "PERSIANA",
    department: "025",
    brand: "PERSIANA",
    cost: 0,
    price: 18.32
  };
  const bytes = createWorkbookBytes([product], {
    manager: "",
    phone: "",
    orderNumber: "0000042",
    lines: [{
      product,
      quantity: 2,
      unit: "CJ",
      color: { code: "MARRON VIEJO", color: "Marron viejo" }
    }]
  });
  const orderSheet = textEntry(storedZipEntries(bytes), "xl/worksheets/sheet1.xml");

  assert.equal(cellValue(orderSheet, "D7"), "PERSIANA · Color elegido: MARRON VIEJO · Marron viejo");
  assert.equal(cellValue(orderSheet, "A7"), "001121");
  assert.equal(cellValue(orderSheet, "G7"), "2 CJ");
});

test("requires an inventory and at least one product before generating an order", () => {
  assert.throws(() => createWorkbookBytes([], { lines: [] }), /Carga el inventario/);
});

test("keeps exported order filenames safe", () => {
  assert.equal(safeOrderFilename("0000042"), "0000042");
  assert.equal(safeOrderFilename("../pedido 1"), "_pedido_1");
});
