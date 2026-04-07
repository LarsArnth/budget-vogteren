#!/usr/bin/env node
/**
 * Extract MobilePay mappings from Spiir simple export and seed into D1.
 */

import { readFileSync } from "fs";

const CF_ACCOUNT_ID = "f4da3a9d6a35690a095dd88f07d2433c";
const CF_API_TOKEN = "cfut_B6zVK3bZJjUVDkVOkRtAqZnL5yvsEIHJSYPcNVC3b5cd2253";
const DB_ID = "217f67c2-1b55-44ea-8dcc-b1435bd707a0";
const CSV_PATH = "/Users/larsarnthjessen/Documents/Spiir Export/poster-2026-04-07.csv";

async function main() {
  const csvText = readFileSync(CSV_PATH, "utf-8");
  const lines = csvText.split("\n").filter((l) => l.trim());

  // Extract unique MobilePay name -> category pairs
  // Use the most frequent category for each name
  const mpMap = new Map(); // name -> { mainCat, subCat, count }

  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(";").map((s) => s.replace(/"/g, "").trim());
    const desc = parts[2] || "";
    const mainCat = parts[3] || "";
    const subCat = parts[4] || "";

    if (!desc.startsWith("MobilePay:")) continue;
    const name = desc.substring("MobilePay:".length).trim();
    if (!name || !mainCat || !subCat) continue;

    const key = name.toLowerCase();
    const existing = mpMap.get(key);
    if (!existing || mainCat !== "Privatforbrug") {
      // Prefer specific categories over generic "Privatforbrug > Andet privatforbrug"
      mpMap.set(key, { name, mainCat, subCat });
    }
  }

  console.log(`Found ${mpMap.size} unique MobilePay names`);

  // Get category IDs
  const categories = await d1Query("SELECT id, main_category, sub_category FROM categories");
  const catIdMap = new Map();
  for (const c of categories) {
    catIdMap.set(`${c.main_category}|${c.sub_category}`, c.id);
  }

  let inserted = 0;
  for (const [, { name, mainCat, subCat }] of mpMap) {
    let catId = catIdMap.get(`${mainCat}|${subCat}`);
    if (!catId) {
      await d1Query(
        "INSERT OR IGNORE INTO categories (main_category, sub_category) VALUES (?, ?)",
        [mainCat, subCat]
      );
      const result = await d1Query(
        "SELECT id FROM categories WHERE main_category = ? AND sub_category = ?",
        [mainCat, subCat]
      );
      catId = result[0]?.id;
      if (catId) catIdMap.set(`${mainCat}|${subCat}`, catId);
    }
    if (!catId) continue;

    await d1Query(
      "INSERT OR IGNORE INTO mobilepay_mappings (name, category_id) VALUES (?, ?)",
      [name, catId]
    );
    inserted++;
    if (inserted % 20 === 0) process.stdout.write(`\r${inserted}/${mpMap.size}`);
  }

  console.log(`\nInserted ${inserted} MobilePay mappings`);
  const count = await d1Query("SELECT COUNT(*) as c FROM mobilepay_mappings");
  console.log(`Total MobilePay mappings in DB: ${count[0]?.c}`);
}

async function d1Query(sql, params = []) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/d1/database/${DB_ID}/query`;
  const body = { sql };
  if (params.length > 0) body.params = params;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${CF_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!json.success) { console.error("D1 error:", JSON.stringify(json.errors)); return []; }
  return json.result?.[0]?.results || [];
}

main().catch(console.error);
