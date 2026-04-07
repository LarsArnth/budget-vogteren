#!/usr/bin/env node
/**
 * Import categorization rules from 1_Kontering_Hjerne.csv into D1.
 * CSV format: Søgetekst;Hovedkategori;Underkategori
 */

import { readFileSync } from "fs";

const CF_ACCOUNT_ID = "f4da3a9d6a35690a095dd88f07d2433c";
const CF_API_TOKEN = "cfut_B6zVK3bZJjUVDkVOkRtAqZnL5yvsEIHJSYPcNVC3b5cd2253";
const DB_ID = "217f67c2-1b55-44ea-8dcc-b1435bd707a0";
const CSV_PATH = "/Users/larsarnthjessen/1_Kontering_Hjerne.csv";

async function main() {
  const csvText = readFileSync(CSV_PATH, "utf-8");
  const lines = csvText.split("\n").filter((l) => l.trim());

  // Skip header: Søgetekst;Hovedkategori;Underkategori
  console.log("Header:", lines[0]);

  // First, get/create all unique categories
  const catSet = new Map(); // "main|sub" -> true
  const rules = [];
  const mpRules = [];

  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(";").map((s) => s.replace(/"/g, "").trim());
    if (parts.length < 3) continue;

    const [pattern, mainCat, subCat] = parts;
    if (!pattern || !mainCat || !subCat) continue;

    const key = `${mainCat}|${subCat}`;
    catSet.set(key, { main: mainCat, sub: subCat });

    // Check if it's a MobilePay pattern
    if (pattern.toLowerCase().startsWith("mobilepay:")) {
      const name = pattern.substring("mobilepay:".length).trim();
      mpRules.push({ name, catKey: key });
    } else {
      rules.push({ pattern, catKey: key });
    }
  }

  console.log(`Found ${catSet.size} unique categories, ${rules.length} rules, ${mpRules.length} MobilePay rules`);

  // Insert categories
  const catIdMap = new Map();
  for (const [key, { main, sub }] of catSet) {
    await d1Query(
      "INSERT OR IGNORE INTO categories (main_category, sub_category) VALUES (?, ?)",
      [main, sub]
    );
    const result = await d1Query(
      "SELECT id FROM categories WHERE main_category = ? AND sub_category = ?",
      [main, sub]
    );
    if (result[0]?.id) {
      catIdMap.set(key, result[0].id);
    }
  }
  console.log(`Inserted/resolved ${catIdMap.size} categories`);

  // Insert mappings in batches
  let inserted = 0;
  for (const rule of rules) {
    const catId = catIdMap.get(rule.catKey);
    if (!catId) continue;
    await d1Query(
      "INSERT OR IGNORE INTO mappings (pattern, category_id) VALUES (?, ?)",
      [rule.pattern, catId]
    );
    inserted++;
    if (inserted % 100 === 0) process.stdout.write(`\rMappings: ${inserted}/${rules.length}`);
  }
  console.log(`\nInserted ${inserted} mappings`);

  // Insert MobilePay mappings
  let mpInserted = 0;
  for (const rule of mpRules) {
    const catId = catIdMap.get(rule.catKey);
    if (!catId) continue;
    await d1Query(
      "INSERT OR IGNORE INTO mobilepay_mappings (name, category_id) VALUES (?, ?)",
      [rule.name, catId]
    );
    mpInserted++;
  }
  console.log(`Inserted ${mpInserted} MobilePay mappings`);

  // Verify
  const mapCount = await d1Query("SELECT COUNT(*) as c FROM mappings");
  const mpCount = await d1Query("SELECT COUNT(*) as c FROM mobilepay_mappings");
  const catCount = await d1Query("SELECT COUNT(*) as c FROM categories");
  console.log(`\nFinal counts - Categories: ${catCount[0]?.c}, Mappings: ${mapCount[0]?.c}, MobilePay: ${mpCount[0]?.c}`);
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
  if (!json.success) {
    console.error("D1 error:", JSON.stringify(json.errors));
    return [];
  }
  return json.result?.[0]?.results || [];
}

main().catch(console.error);
