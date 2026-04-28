import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

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
  // Software / Suscripciones
  ["suscrip", "Software/Suscripciones"], ["software", "Software/Suscripciones"],
  ["netflix", "Software/Suscripciones"], ["spotify", "Software/Suscripciones"],
  ["amazon", "Software/Suscripciones"], ["microsoft", "Software/Suscripciones"],
  ["adobe", "Software/Suscripciones"], ["google", "Software/Suscripciones"],
  ["dropbox", "Software/Suscripciones"], ["zoom", "Software/Suscripciones"],
  ["saas", "Software/Suscripciones"], ["plan mensual", "Software/Suscripciones"],
  // Mantenimiento
  ["mantenim", "Mantenimiento"], ["reparación", "Mantenimiento"],
  ["ferretería", "Mantenimiento"], ["ferreteri", "Mantenimiento"],
  ["plomero", "Mantenimiento"], ["electricista", "Mantenimiento"],
  ["pintura", "Mantenimiento"],
];

export async function categorize(rawText: string): Promise<number | null> {
  const text = rawText.toLowerCase();
  for (const [kw, accountName] of KEYWORD_MAP) {
    if (text.includes(kw)) {
      const acc = await prisma.account.findFirst({ where: { name: accountName } });
      if (acc) return acc.id;
    }
  }
  return null;
}
