import { prisma } from "../../db/client.js";

// Palabras clave → nombre de cuenta contable.
// El orden importa: la primera coincidencia gana.
const KEYWORD_MAP: [string, string][] = [
  // Salud/Farmacia — antes que Alimentación para que farmacia no caiga ahí
  ["farmacia", "Salud/Farmacia"], ["medicament", "Salud/Farmacia"],
  ["médico", "Salud/Farmacia"], ["medico", "Salud/Farmacia"],
  ["clínica", "Salud/Farmacia"], ["clinica", "Salud/Farmacia"],
  ["hospital", "Salud/Farmacia"], ["droguería", "Salud/Farmacia"],
  ["droguer", "Salud/Farmacia"], ["consultor", "Salud/Farmacia"],
  ["dentist", "Salud/Farmacia"], ["laboratorio", "Salud/Farmacia"],
  ["óptica", "Salud/Farmacia"], ["optica", "Salud/Farmacia"],
  ["derma", "Salud/Farmacia"], ["salud", "Salud/Farmacia"],
  // Belleza/Cuidado Personal
  ["cosmétic", "Belleza/Cuidado Personal"], ["cosmet", "Belleza/Cuidado Personal"],
  ["maquillaje", "Belleza/Cuidado Personal"], ["perfum", "Belleza/Cuidado Personal"],
  ["peluquería", "Belleza/Cuidado Personal"], ["peluquer", "Belleza/Cuidado Personal"],
  ["salón de belleza", "Belleza/Cuidado Personal"], ["salon de belleza", "Belleza/Cuidado Personal"],
  ["belleza", "Belleza/Cuidado Personal"], ["spa ", "Belleza/Cuidado Personal"],
  ["manicur", "Belleza/Cuidado Personal"], ["cabello", "Belleza/Cuidado Personal"],
  ["shampoo", "Belleza/Cuidado Personal"], ["crema", "Belleza/Cuidado Personal"],
  ["supply beauty", "Belleza/Cuidado Personal"],
  // Tecnología/Hardware — antes de Papelería para que impresora no caiga ahí
  ["celular", "Tecnología/Hardware"], ["smartphone", "Tecnología/Hardware"],
  ["laptop", "Tecnología/Hardware"], ["computador", "Tecnología/Hardware"],
  ["monitor", "Tecnología/Hardware"], ["teclado", "Tecnología/Hardware"],
  ["tablet", "Tecnología/Hardware"], ["auricular", "Tecnología/Hardware"],
  ["audífon", "Tecnología/Hardware"], ["cargador", "Tecnología/Hardware"],
  ["cable usb", "Tecnología/Hardware"], ["electrónic", "Tecnología/Hardware"],
  ["electron", "Tecnología/Hardware"], ["router", "Tecnología/Hardware"],
  ["disco duro", "Tecnología/Hardware"], ["memoria ram", "Tecnología/Hardware"],
  // Transporte
  ["uber", "Transporte"], ["didi", "Transporte"], ["cabify", "Transporte"],
  ["taxi", "Transporte"], ["rapi", "Transporte"], ["bus ", "Transporte"],
  ["metro", "Transporte"], ["carrera", "Transporte"], ["viaje", "Transporte"],
  // Combustible
  ["gasolin", "Combustible"], ["combustible", "Combustible"], ["diesel", "Combustible"],
  ["bencina", "Combustible"], ["gasoil", "Combustible"],
  // Alimentación
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
  ["cartucho", "Papelería"], ["cinta adhesiva", "Papelería"],
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
  // bare "amazon"/"microsoft"/"google" excluded — too ambiguous; AI handles those
  // Mantenimiento
  ["mantenim", "Mantenimiento"], ["reparación", "Mantenimiento"],
  ["ferretería", "Mantenimiento"], ["ferreteri", "Mantenimiento"],
  ["plomero", "Mantenimiento"], ["electricista", "Mantenimiento"],
  ["pintura", "Mantenimiento"],
  // Ropa/Vestimenta
  ["ropa", "Ropa/Vestimenta"], ["vestim", "Ropa/Vestimenta"],
  ["calzado", "Ropa/Vestimenta"], ["zapato", "Ropa/Vestimenta"],
  ["zapatill", "Ropa/Vestimenta"], ["camisa", "Ropa/Vestimenta"],
  ["pantalon", "Ropa/Vestimenta"], ["falda", "Ropa/Vestimenta"],
  ["chaqueta", "Ropa/Vestimenta"], ["abrigo", "Ropa/Vestimenta"],
  ["boutique", "Ropa/Vestimenta"], ["moda", "Ropa/Vestimenta"],
  // Compras Generales — catch-all retail, siempre al final
  ["tienda", "Compras Generales"], ["almacén", "Compras Generales"],
  ["bazar", "Compras Generales"], ["retail", "Compras Generales"],
  ["plaza", "Compras Generales"], ["mall", "Compras Generales"],
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
