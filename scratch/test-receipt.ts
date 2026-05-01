import "dotenv/config";
import { processReceipt } from "../src/services/receipts.service.js";

async function run() {
  const filePath = "C:\\Proyectos\\PruebaProsperia\\prosperia-challenge\\uploads\\db0073ba9654a9bc5f95e2f44eeb0629";
  console.log("Processing receipt:", filePath);
  try {
    const result = await processReceipt(filePath, {
      originalName: "test.pdf",
      mimeType: "application/pdf",
      size: 100000,
    });
    console.log("Final Result AI Provider:", result.aiProvider);
    console.log("Amount:", result.json?.amount);
    console.log("Category:", result.json?.categoryName);
  } catch (err) {
    console.error("Fatal Error:", err);
  }
}

run();
