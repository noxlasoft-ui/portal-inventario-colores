import orderTemplateBase64 from "./order-template.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const templateDataRows = 79;

function xmlEscape(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "")
    .replace(/[<>&"']/g, (character) => ({
      "<": "&lt;",
      ">": "&gt;",
      "&": "&amp;",
      '"': "&quot;",
      "'": "&apos;"
    })[character]);
}

function inlineCell(reference, value, style = 0) {
  const text = String(value ?? "");
  const styleAttribute = style ? ` s="${style}"` : "";
  return `<c r="${reference}"${styleAttribute} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(text)}</t></is></c>`;
}

function numberCell(reference, value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? `<c r="${reference}"><v>${amount}</v></c>` : `<c r="${reference}"/>`;
}

function rowXml(rowNumber, cells) {
  return `<row r="${rowNumber}">${cells.join("")}</row>`;
}

function decodeTemplate() {
  const binary = atob(orderTemplateBase64);
  const archive = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const files = new Map();
  let offset = 0;

  while (offset + 30 <= archive.length && view.getUint32(offset, true) === 0x04034b50) {
    const flags = view.getUint16(offset + 6, true);
    const method = view.getUint16(offset + 8, true);
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    if (method !== 0 || flags & 0x0008) {
      throw new Error("La plantilla del pedido tiene una compresión no compatible.");
    }

    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + size;
    if (dataEnd > archive.length) throw new Error("La plantilla del pedido está incompleta.");
    const name = decoder.decode(archive.subarray(nameStart, nameStart + nameLength));
    files.set(name, archive.slice(dataStart, dataEnd));
    offset = dataEnd;
  }

  if (!files.has("xl/worksheets/sheet1.xml") || !files.has("xl/worksheets/sheet2.xml")) {
    throw new Error("No se encontraron las hojas de la plantilla del pedido.");
  }
  return files;
}

function xmlFile(files, name) {
  const value = files.get(name);
  if (!value) throw new Error(`No se encontró el archivo ${name} en la plantilla del pedido.`);
  return decoder.decode(value);
}

function storeXml(files, name, xml) {
  files.set(name, encoder.encode(xml));
}

function replaceCell(xml, reference, value) {
  const escapedReference = reference.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`<c\\b(?=[^>]*\\br="${escapedReference}")[^>]*(?:\\/>|>[\\s\\S]*?<\\/c>)`);
  const match = xml.match(pattern);
  if (!match) throw new Error(`No se encontró la celda ${reference} en la plantilla del pedido.`);

  const openingTag = match[0].match(/^<c\b[^>]*>/)?.[0];
  if (!openingTag) throw new Error(`La celda ${reference} de la plantilla no es válida.`);
  const attributes = openingTag.slice(2, -1).replace(/\/$/, "").replace(/\s+t="[^"]*"/, "");
  const replacement = `<c${attributes} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
  return xml.replace(match[0], () => replacement);
}

function sheetDataRows(xml) {
  const match = /<sheetData\b[^>]*>([\s\S]*?)<\/sheetData>/.exec(xml);
  if (!match) throw new Error("No se encontró la tabla de datos de una hoja.");
  const rows = new Map();
  for (const row of match[1].matchAll(/<row\b[^>]*\br="(\d+)"[^>]*>[\s\S]*?<\/row>/g)) {
    rows.set(Number(row[1]), row[0]);
  }
  return rows;
}

function replaceSheetData(xml, rows) {
  return xml.replace(/<sheetData\b[^>]*>[\s\S]*?<\/sheetData>/, (whole) => {
    const openingTag = whole.match(/^<sheetData\b[^>]*>/)?.[0];
    if (!openingTag) throw new Error("La tabla de datos de una hoja no es válida.");
    return `${openingTag}${rows.join("")}</sheetData>`;
  });
}

function cloneRow(rowXmlValue, previousNumber, nextNumber) {
  const previous = String(previousNumber);
  const next = String(nextNumber);
  return rowXmlValue
    .replace(/(<row\b[^>]*\br=")\d+(")/, `$1${next}$2`)
    .replace(new RegExp(`(\\br="[A-Z]+)${previous}(")`, "g"), `$1${next}$2`);
}

function updateDimension(xml, reference) {
  return xml.replace(/<dimension\b[^>]*\bref="[^"]+"[^>]*\/>/, `<dimension ref="${reference}"/>`);
}

function updateAutoFilter(xml, reference) {
  return xml.replace(/(<autoFilter\b[^>]*\bref=")[^"]+(")/, `$1${reference}$2`);
}

function orderMerges(xml, lastRow) {
  return xml.replace(/<mergeCells\b([^>]*)>([\s\S]*?)<\/mergeCells>/, (whole, attributes, body) => {
    const staticRanges = [...body.matchAll(/<mergeCell\b[^>]*\bref="([^"]+)"/g)]
      .map((match) => match[1])
      .filter((range) => {
        const rows = [...range.matchAll(/\d+/g)].map((match) => Number(match[0]));
        return rows.length && Math.max(...rows) <= 6;
      });
    const rowRanges = [];
    for (let row = 7; row <= lastRow; row += 1) {
      rowRanges.push(`B${row}:C${row}`, `D${row}:F${row}`, `G${row}:H${row}`);
    }
    const ranges = [...staticRanges, ...rowRanges];
    const nextAttributes = attributes.replace(/\bcount="\d+"/, `count="${ranges.length}"`);
    const mergeCells = ranges.map((range) => `<mergeCell ref="${range}"/>`).join("");
    return `<mergeCells${nextAttributes}>${mergeCells}</mergeCells>`;
  });
}

function orderDate() {
  const date = new Date();
  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
}

function orderSheet(templateXml, draft) {
  const templateRows = sheetDataRows(templateXml);
  const lastRow = draft.lines.length + 6;
  const rows = [];
  for (let row = 1; row <= 6; row += 1) {
    const templateRow = templateRows.get(row);
    if (!templateRow) throw new Error(`Falta la fila ${row} en la plantilla del pedido.`);
    rows.push(templateRow);
  }

  draft.lines.forEach((line, index) => {
    const rowNumber = index + 7;
    const sourceRowNumber = Math.min(rowNumber, templateDataRows + 6);
    const sourceRow = templateRows.get(sourceRowNumber);
    if (!sourceRow) throw new Error(`Falta el formato de la fila ${sourceRowNumber} en la plantilla del pedido.`);
    let row = cloneRow(sourceRow, sourceRowNumber, rowNumber);
    const productDescription = line.product.shortDescription || line.product.fullDescription || line.product.item || "";
    const colorDescription = line.color ? ` · Color elegido: ${line.color.code} · ${line.color.color}` : "";
    const description = `${productDescription}${colorDescription}`;
    row = replaceCell(row, `A${rowNumber}`, line.product.code);
    row = replaceCell(row, `B${rowNumber}`, line.product.item);
    row = replaceCell(row, `D${rowNumber}`, description);
    row = replaceCell(row, `G${rowNumber}`, `${line.quantity} ${line.unit}`);
    rows.push(row);
  });

  let xml = replaceSheetData(templateXml, rows);
  const orderNum = String(draft.orderNumber || "0000001").trim();
  const managerName = String(draft.manager || "").trim();
  const phoneNumber = String(draft.phone || "").trim();
  const headers = {
    E1: `NOTA DE PEDIDO ${orderNum}`,
    F2: `Fecha ${orderDate()}`,
    A3: managerName ? `ENCARGADO RESP.: ${managerName}` : "ENCARGADO RESP.",
    A4: phoneNumber ? `                                            Teléfono: ${phoneNumber}` : "                                            Teléfono: "
  };
  for (const [reference, value] of Object.entries(headers)) {
    xml = replaceCell(xml, reference, value);
  }
  xml = updateDimension(xml, `A1:L${lastRow}`);
  xml = updateAutoFilter(xml, `A6:H${lastRow}`);
  xml = orderMerges(xml, lastRow);
  return xml;
}

function inventorySheet(templateXml, products) {
  const templateRows = sheetDataRows(templateXml);
  const header = templateRows.get(1);
  if (!header) throw new Error("Falta la fila de encabezados del inventario en la plantilla.");
  const rows = [header];

  products.forEach((product, index) => {
    const row = index + 2;
    rows.push(rowXml(row, [
      inlineCell(`A${row}`, product.code),
      inlineCell(`B${row}`, product.item),
      inlineCell(`C${row}`, product.fullDescription),
      inlineCell(`D${row}`, product.shortDescription),
      inlineCell(`E${row}`, product.department),
      ...(product.brand ? [inlineCell(`F${row}`, product.brand)] : []),
      numberCell(`G${row}`, product.cost),
      numberCell(`H${row}`, product.price)
    ]));
  });

  let xml = replaceSheetData(templateXml, rows);
  const lastRow = products.length + 1;
  xml = updateDimension(xml, `A1:H${lastRow}`);
  return updateAutoFilter(xml, `A1:H${lastRow}`);
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let crc = index;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    table[index] = crc >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function joinBytes(chunks) {
  const size = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function zipStore(files) {
  const localChunks = [];
  const directoryChunks = [];
  let offset = 0;
  for (const [path, content] of files) {
    const name = encoder.encode(path);
    const data = typeof content === "string" ? encoder.encode(content) : content;
    const checksum = crc32(data);
    const localHeader = new Uint8Array(30 + name.length);
    const local = new DataView(localHeader.buffer);
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);
    local.setUint16(8, 0, true);
    local.setUint16(10, 0, true);
    local.setUint16(12, 0x0021, true);
    local.setUint32(14, checksum, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    localHeader.set(name, 30);
    localChunks.push(localHeader, data);

    const centralHeader = new Uint8Array(46 + name.length);
    const central = new DataView(centralHeader.buffer);
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);
    central.setUint16(6, 20, true);
    central.setUint16(8, 0x0800, true);
    central.setUint16(10, 0, true);
    central.setUint16(12, 0, true);
    central.setUint16(14, 0x0021, true);
    central.setUint32(16, checksum, true);
    central.setUint32(20, data.length, true);
    central.setUint32(24, data.length, true);
    central.setUint16(28, name.length, true);
    central.setUint16(30, 0, true);
    central.setUint16(32, 0, true);
    central.setUint16(34, 0, true);
    central.setUint16(36, 0, true);
    central.setUint32(38, 0, true);
    central.setUint32(42, offset, true);
    centralHeader.set(name, 46);
    directoryChunks.push(centralHeader);
    offset += localHeader.length + data.length;
  }
  const directory = joinBytes(directoryChunks);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, directory.length, true);
  endView.setUint32(16, offset, true);
  return joinBytes([...localChunks, directory, end]);
}

export function createWorkbookBytes(inventory, draft) {
  if (!inventory.length || !draft.lines.length) {
    throw new Error("Carga el inventario y agrega productos antes de exportar.");
  }

  const files = decodeTemplate();
  const orderXml = orderSheet(xmlFile(files, "xl/worksheets/sheet1.xml"), draft);
  const inventoryXml = inventorySheet(xmlFile(files, "xl/worksheets/sheet2.xml"), inventory);
  let workbookXml = xmlFile(files, "xl/workbook.xml");
  workbookXml = workbookXml
    .replace("'Table 1'!$A$6:$H$6", `'Table 1'!$A$6:$H$${draft.lines.length + 6}`)
    .replace("Base_Inventario!$A$1:$H$1", `Base_Inventario!$A$1:$H$${inventory.length + 1}`);

  let coreProperties = xmlFile(files, "docProps/core.xml");
  coreProperties = coreProperties.replace(
    /(<dcterms:modified[^>]*>)[\s\S]*?(<\/dcterms:modified>)/,
    `$1${new Date().toISOString()}$2`
  );
  storeXml(files, "xl/worksheets/sheet1.xml", orderXml);
  storeXml(files, "xl/worksheets/sheet2.xml", inventoryXml);
  storeXml(files, "xl/workbook.xml", workbookXml);
  storeXml(files, "docProps/core.xml", coreProperties);

  return zipStore([...files.entries()]);
}

export function createWorkbookBlob(inventory, draft) {
  const bytes = createWorkbookBytes(inventory, draft);
  return new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

export function safeOrderFilename(orderNumber) {
  return String(orderNumber || "0000001").replace(/[^\w-]+/g, "_") || "0000001";
}