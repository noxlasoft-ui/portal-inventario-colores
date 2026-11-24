import test from "node:test";
import assert from "node:assert/strict";
import { zipSync } from "fflate";
import { createWorkbookBytes } from "../src/export-xlsx.js";
import { parseOrderWorkbook } from "../src/import-xlsx.js";
import { getPersianaColorFromDescription } from "../src/persiana-colors.js";

function workbook(sheetXml, sharedStrings = []) {
  const entries = {
    "xl/workbook.xml": `<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Table 1" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    "xl/worksheets/sheet1.xml": sheetXml
  };
  if (sharedStrings.length) {
    entries["xl/sharedStrings.xml"] = `<sst>${sharedStrings.map((value) => `<si><t>${value}</t></si>`).join("")}</sst>`;
  }
  return zipSync(Object.fromEntries(Object.entries(entries).map(([name, value]) => [name, new TextEncoder().encode(value)])));
}

test("imports the Valencia-style order table with shared strings and embedded units", () => {
  const sheet = `<worksheet><sheetData>
    <row r="6"><c r="A6" t="s"><v>0</v></c><c r="B6" t="s"><v>1</v></c><c r="D6" t="s"><v>2</v></c><c r="G6" t="s"><v>3</v></c><c r="H6" t="inlineStr"><is><t>UNIDAD</t></is></c></row>
    <row r="7"><c r="A7" t="s"><v>4</v></c><c r="B7" t="s"><v>5</v></c><c r="D7" t="s"><v>6</v></c><c r="G7" t="inlineStr"><is><t>2 CJ</t></is></c></row>
    <row r="8"><c r="A8" t="inlineStr"><is><t>AB-2</t></is></c><c r="D8" t="inlineStr"><is><t>Vaso &amp; tapa</t></is></c><c r="G8"><v>1.5</v></c><c r="H8" t="inlineStr"><is><t>UND</t></is></c></row>
  </sheetData></worksheet>`;
  const strings = ["CODIGO", "ITEM", "DESCRIPCION", "CANTIDAD / UNIDAD", "00123", "TERM-1", "Termo acero", "2 CJ"];
  const result = parseOrderWorkbook(workbook(sheet, strings));

  assert.equal(result.sheetName, "Table 1");
  assert.deepEqual(result.lines, [
    { code: "00123", item: "TERM-1", description: "Termo acero", quantity: 2, unit: "CJ" },
    { code: "AB-2", item: "", description: "Vaso & tapa", quantity: 1.5, unit: "UND" }
  ]);
  assert.deepEqual(result.skippedRows, []);
});

test("can continue from a workbook exported by the portal", () => {
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
  const bytes = createWorkbookBytes([product], {
    manager: "",
    phone: "",
    orderNumber: "0000042",
    lines: [{ product, quantity: 2.5, unit: "CJ" }]
  });
  const result = parseOrderWorkbook(bytes);
  assert.deepEqual(result.lines, [{
    code: "000001",
    item: "TERMO",
    description: "& TAPA",
    quantity: 2.5,
    unit: "CJ"
  }]);
});

test("preserves the selected persiana color when a downloaded order is re-imported", () => {
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
      quantity: 1,
      unit: "UND",
      color: { code: "11-2", color: "Negro" }
    }]
  });
  const result = parseOrderWorkbook(bytes);

  assert.equal(result.lines[0].description, "PERSIANA · Color elegido: 11-2 · Negro");
  assert.equal(getPersianaColorFromDescription(product, result.lines[0].description).color, "Negro");
});

test("keeps valid rows and reports rows with unsupported units", () => {
  const sheet = `<worksheet><sheetData>
    <row r="1"><c r="A1" t="inlineStr"><is><t>CODIGO</t></is></c><c r="B1" t="inlineStr"><is><t>CANTIDAD</t></is></c><c r="C1" t="inlineStr"><is><t>UNIDAD</t></is></c></row>
    <row r="2"><c r="A2" t="inlineStr"><is><t>X-1</t></is></c><c r="B2"><v>3</v></c><c r="C2" t="inlineStr"><is><t>PAQ</t></is></c></row>
    <row r="3"><c r="A3" t="inlineStr"><is><t>X-2</t></is></c><c r="B3"><v>4</v></c><c r="C3" t="inlineStr"><is><t>PALLET</t></is></c></row>
  </sheetData></worksheet>`;
  const result = parseOrderWorkbook(workbook(sheet));
  assert.deepEqual(result.lines.map(({ code, quantity, unit }) => ({ code, quantity, unit })), [{ code: "X-1", quantity: 3, unit: "PAQ" }]);
  assert.deepEqual(result.skippedRows, [3]);
});

test("rejects malformed or unrelated workbooks with a clear error", () => {
  assert.throws(() => parseOrderWorkbook(new Uint8Array([1, 2, 3])), /vacío o incompleto/);
  assert.throws(() => parseOrderWorkbook(new Uint8Array([1, 2, 3, 4])), /\.xlsx válido/);
  const sheet = `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>ARTICULO</t></is></c></row></sheetData></worksheet>`;
  assert.throws(() => parseOrderWorkbook(workbook(sheet)), /encabezados de código y cantidad/);
});
