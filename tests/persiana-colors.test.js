import test from "node:test";
import assert from "node:assert/strict";
import {
  getPersianaColorByCode,
  getPersianaColorFromDescription,
  getPersianaColors,
  productSearchValues
} from "../src/persiana-colors.js";

function persiana(item) {
  return { item, fullDescription: `${item} PERSIANA`, brand: "PERSIANA" };
}

test("maps BKFF 180 and 240 products to their five color codes without merging groups", () => {
  const bkff180 = getPersianaColors(persiana("100BKFF"));
  const bkff240 = getPersianaColors(persiana("100X240BKFF"));
  const expectedColors = [
    "9026-1:Negro", "9026-2:Blanco", "9026-5:Gris claro",
    "9026-8:Gris oscuro", "MARRON:Marron"
  ];

  assert.deepEqual(bkff180.map(({ code, color }) => `${code}:${color}`), expectedColors);
  assert.deepEqual(bkff240.map(({ code, color }) => `${code}:${color}`), expectedColors);
  assert.notEqual(bkff180, bkff240);
});

test("maps PZ and BKL variants, including the corrected 629 label", () => {
  const pz = getPersianaColors(persiana("100PZ"));
  const bkl = getPersianaColors(persiana("100BKL"));

  assert.deepEqual(pz.map(({ code, color }) => `${code}:${color}`), [
    "M-4:Marron", "11-1:Blanco", "11-2:Negro", "11-3:Gris oscuro",
    "11-6:Gris claro", "MARRON VIEJO:Marron viejo", "MARRON VINOTINTO:Marron vinotinto"
  ]);
  assert.deepEqual(bkl.map(({ code, color }) => `${code}:${color}`), [
    "621:Gris claro con verde", "629:Beige con verde", "614:Gris oscuro", "626:Gris-beige y verde"
  ]);
});

test("makes color codes and names searchable without classifying unrelated products", () => {
  const product = persiana("100X240BKFF");
  const searchable = productSearchValues(product).join(" ").toLocaleLowerCase("es");

  assert.match(searchable, /9026-5/);
  assert.match(searchable, /gris claro/);
  assert.deepEqual(getPersianaColors({ item: "100X220BKFF PERSIANA" }), []);
  assert.deepEqual(getPersianaColors({ item: "100PZ CEPILLO" }), []);
});

test("resolves selected colors from codes and exported order descriptions", () => {
  const product = persiana("100PZ");

  assert.equal(getPersianaColorByCode(product, "11-2").color, "Negro");
  assert.equal(
    getPersianaColorFromDescription(product, "PERSIANA · Color elegido: MARRON VIEJO · Marron viejo").code,
    "MARRON VIEJO"
  );
  assert.equal(getPersianaColorFromDescription(product, "Descripción sin selección"), null);
});
