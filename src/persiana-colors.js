const COLOR_GROUPS = {
  BKFF_180: [
    { code: "9026-1", color: "Negro" },
    { code: "9026-2", color: "Blanco" },
    { code: "9026-5", color: "Gris claro" },
    { code: "9026-8", color: "Gris oscuro" },
    { code: "MARRON", color: "Marron" }
  ],
  BKFF_240: [
    { code: "9026-1", color: "Negro" },
    { code: "9026-2", color: "Blanco" },
    { code: "9026-5", color: "Gris claro" },
    { code: "9026-8", color: "Gris oscuro" },
    { code: "MARRON", color: "Marron" }
  ],
  BKL: [
    { code: "621", color: "Gris claro con verde" },
    { code: "629", color: "Beige con verde" },
    { code: "614", color: "Gris oscuro" },
    { code: "626", color: "Gris-beige y verde" }
  ],
  PZ: [
    { code: "M-4", color: "Marron" },
    { code: "11-1", color: "Blanco" },
    { code: "11-2", color: "Negro" },
    { code: "11-3", color: "Gris oscuro" },
    { code: "11-6", color: "Gris claro" },
    { code: "MARRON VIEJO", color: "Marron viejo" },
    { code: "MARRON VINOTINTO", color: "Marron vinotinto" }
  ]
};

function productDescription(product) {
  return [product?.item, product?.fullDescription, product?.brand]
    .filter(Boolean)
    .join(" ")
    .toLocaleUpperCase("es");
}

export function getPersianaColors(product) {
  const description = productDescription(product);
  if (!description.includes("PERSIANA")) return [];

  if (/\d+BKL\b/.test(description) || /\bBKL\b/.test(description)) return COLOR_GROUPS.BKL;
  if (/\d+PZ\b/.test(description) || /\bPZ\b/.test(description)) return COLOR_GROUPS.PZ;

  if (description.includes("BKFF")) {
    const length = /X(\d{2,3})\s*BKFF/.exec(description)?.[1];
    if (length === "180") return COLOR_GROUPS.BKFF_180;
    if (length === "240") return COLOR_GROUPS.BKFF_240;
    if (!length && /\d+BKFF\b/.test(description)) return COLOR_GROUPS.BKFF_180;
  }

  return [];
}

export function getPersianaColorByCode(product, code) {
  return getPersianaColors(product).find((color) => color.code === String(code ?? "")) || null;
}

export function getPersianaColorFromDescription(product, description) {
  const match = /\bCOLOR ELEGIDO:\s*(.+?)\s*·/i.exec(String(description ?? ""));
  return getPersianaColorByCode(product, match?.[1]);
}

export function productSearchValues(product) {
  const colors = getPersianaColors(product);
  return [
    product?.code,
    product?.item,
    product?.fullDescription,
    product?.brand,
    product?.department,
    ...colors.flatMap(({ code, color }) => [code, color])
  ].filter(Boolean);
}
