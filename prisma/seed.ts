import { PrismaClient, AccountType } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const vendors = [
    { name: "SuperMercado XYZ", legalName: "SuperMercado XYZ, S.A." },
    { name: "Janeth Supply Beauty"},
    { name: "Derma Medical Center S.A."},
    { name: "Uber" },
    { name: "Rapi" },
    { name: "Gasolinera Centro" },
    { name: "Farmacia Salud" },
    { name: "Restaurante La 14" },
    { name: "Ferretería Norte" },
    { name: "Panadería Dulce" },
    { name: "Telefonía Telco" },
    { name: "Luz & Energía" }
  ];

  const accounts = [
    { name: "Aseo/Limpieza", type: AccountType.expense },
    { name: "Transporte", type: AccountType.expense },
    { name: "Alimentación", type: AccountType.expense },
    { name: "Servicios Públicos", type: AccountType.expense },
    { name: "Combustible", type: AccountType.expense },
    { name: "Papelería", type: AccountType.expense },
    { name: "Software/Suscripciones", type: AccountType.expense },
    { name: "Mantenimiento", type: AccountType.expense },
    { name: "Ropa/Vestimenta", type: AccountType.expense },
    { name: "Impuestos (IVA/ITBMS)", type: AccountType.tax },
    { name: "Ventas", type: AccountType.income },
    { name: "Banco Principal", type: AccountType.payment_account },
    { name: "Caja", type: AccountType.payment_account }
  ];

  await prisma.vendor.createMany({ data: vendors, skipDuplicates: true });
  await prisma.account.createMany({ data: accounts, skipDuplicates: true });
  console.log("Seed completed");
}

main().finally(() => prisma.$disconnect());
