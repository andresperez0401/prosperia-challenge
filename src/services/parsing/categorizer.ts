import { prisma } from "../../db/client.js";

// Palabras clave → nombre de cuenta contable.
// El orden importa: la primera coincidencia gana.
const KEYWORD_MAP: [string, string][] = [
  // Transporte
  ["uber", "Transporte"], ["didi", "Transporte"], ["cabify", "Transporte"],
  ["taxi", "Transporte"], ["rapi", "Transporte"], ["bus ", "Transporte"],
  ["metro", "Transporte"], ["carrera", "Transporte"], ["viaje", "Transporte"],
  // Combustible
  ["gasolin", "Combustible"], ["combustible", "Combustible"], ["diesel", "Combustible"],
  ["bencina", "Combustible"], ["gasoil", "Combustible"],
  // Alimentación — amplio porque las facturas de comida varían mucho
  ["restaur", "Alimentación"], ["comida", "Alimentación"], ["aliment", "Alimentación"],
  ["vegano", "Alimentación"], ["ensalada", "Alimentación"], ["granola", "Alimentación"],
  ["panadería", "Alimentación"], ["panader", "Alimentación"],
  ["supermercado", "Alimentación"], ["mercado", "Alimentación"],
  ["cafe", "Alimentación"], ["pizza", "Alimentación"], ["burger", "Alimentación"],
  ["taquería", "Alimentación"], ["taqueri", "Alimentación"],
  ["frutos", "Alimentación"], ["pollo", "Alimentación"], ["carne", "Alimentación"],
  ["bebida", "Alimentación"], ["desayuno", "Alimentación"], ["almuerzo", "Alimentación"],
  ["cena", "Alimentación"], ["sushi", "Alimentación"], ["menú", "Alimentación"],
  ["menu", "Alimentación"], ["nugget", "Alimentación"], ["tazón", "Alimentación"],
  ["farmacia", "Alimentación"],
  // Servicios Públicos
  ["electricidad", "Servicios Públicos"], ["energia", "Servicios Públicos"],
  ["luz", "Servicios Públicos"], ["agua", "Servicios Públicos"],
  ["internet", "Servicios Públicos"], ["telefon", "Servicios Públicos"],
  ["telco", "Servicios Públicos"], ["servicio básico", "Servicios Públicos"],
  // Aseo/Limpieza
  ["limpieza", "Aseo/Limpieza"], ["aseo", "Aseo/Limpieza"],
  ["lavandería", "Aseo/Limpieza"], ["detergente", "Aseo/Limpieza"],
  // Papelería
  ["papelería", "Papelería"], ["papeler", "Papelería"], ["tinta", "Papelería"],
  ["impresora", "Papelería"], ["lapiz", "Papelería"], ["bolígraf", "Papelería"],
  ["papel", "Papelería"], ["cartuch", "Papelería"], ["resma", "Papelería"],
  ["cartucho", "Papelería"], ["cinta adhesiva", "Papelería"], ["adhesiva", "Papelería"],
  ["oficina", "Papelería"], ["folder", "Papelería"], ["archivador", "Papelería"],
  ["pluma", "Papelería"], ["marcador", "Papelería"], ["cuaderno", "Papelería"],
  // Software / Suscripciones
  ["suscrip", "Software/Suscripciones"], ["software", "Software/Suscripciones"],
  ["netflix", "Software/Suscripciones"], ["spotify", "Software/Suscripciones"],
  ["aws", "Software/Suscripciones"],
  ["microsoft 365", "Software/Suscripciones"], ["microsoft365", "Software/Suscripciones"],
  ["office 365", "Software/Suscripciones"],
  ["adobe", "Software/Suscripciones"], ["google workspace", "Software/Suscripciones"],
  ["dropbox", "Software/Suscripciones"], ["zoom", "Software/Suscripciones"],
  ["saas", "Software/Suscripciones"], ["plan mensual", "Software/Suscripciones"],
  // Note: bare "amazon"/"microsoft"/"google" intentionally excluded — too ambiguous
  // (Amazon retail, Microsoft hardware, Google Store hardware all map elsewhere).
  // The AI categorization in structure() handles those nuanced cases.
  // Mantenimiento
  ["mantenim", "Mantenimiento"], ["reparación", "Mantenimiento"],
  ["ferretería", "Mantenimiento"], ["ferreteri", "Mantenimiento"],
  ["plomero", "Mantenimiento"], ["electricista", "Mantenimiento"],
  ["pintura", "Mantenimiento"],
];

export async function categorize(
  rawText: string,
  opts?: { vendorName?: string | null; items?: { description: string }[] },
): Promise<number | null> {
  const parts = [rawText];
  if (opts?.vendorName) parts.push(opts.vendorName);
  if (opts?.items?.length) parts.push(opts.items.map((i) => i.description).join(" "));
  const text = parts.join(" ").toLowerCase();

  for (const [kw, accountName] of KEYWORD_MAP) {
    if (text.includes(kw)) {
      const acc = await prisma.account.findFirst({ where: { name: accountName } });
      if (acc) return acc.id;
    }
  }
  return null;
}
