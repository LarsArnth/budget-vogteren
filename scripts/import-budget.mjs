#!/usr/bin/env node
/**
 * Import Spiir Budget 2026.xlsx into D1 budgets table.
 * Usage: node scripts/import-budget.mjs
 */

import { readFileSync } from "fs";
import XLSX from "xlsx";

const CF_ACCOUNT_ID = "f4da3a9d6a35690a095dd88f07d2433c";
const CF_API_TOKEN = "cfut_B6zVK3bZJjUVDkVOkRtAqZnL5yvsEIHJSYPcNVC3b5cd2253";
const DB_ID = "217f67c2-1b55-44ea-8dcc-b1435bd707a0";
const XLSX_PATH = "/Users/larsarnthjessen/Documents/Spiir Export/Spiir Budget 2026.xlsx";

// Known main category sections in the Excel
const MAIN_CATEGORIES = new Set([
  "Bolig", "Transport", "Andre leveomkostninger", "Pension & Opsparing",
  "Indkomst",
]);
const SKIP_LABELS = new Set([
  "Resultat", "Regninger", "Rådighedsbeløb", "I alt", "Indkomst ialt",
  "Mit budget for 2026", "Gns/md", "Årligt",
]);

async function main() {
  const wb = XLSX.read(readFileSync(XLSX_PATH));
  const ws = wb.Sheets["Budget 2026"];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1 });

  // Get existing categories from D1
  const categories = await d1Query("SELECT id, main_category, sub_category FROM categories");
  const catMap = new Map();
  for (const c of categories) {
    catMap.set(`${c.main_category}|${c.sub_category}`, c.id);
  }
  console.log(`Loaded ${categories.length} categories from D1`);

  const budgetEntries = [];
  let currentMainCategory = null;

  for (let rowIdx = 0; rowIdx < data.length; rowIdx++) {
    const row = data[rowIdx];
    if (!row || !row[0]) continue;

    const col0 = String(row[0]).trim();

    // Skip known non-data rows
    if (SKIP_LABELS.has(col0)) continue;
    if (col0.startsWith("Budgettet er lavet") || col0.startsWith("Spiir er gratis")) continue;

    // Check if this is a section header (main_category with no monthly data)
    if (MAIN_CATEGORIES.has(col0)) {
      const hasValues = row.slice(4, 16).some((v) => typeof v === "number");
      if (!hasValues) {
        currentMainCategory = col0;
        console.log(`\nSection: ${currentMainCategory}`);
        continue;
      }
    }

    // This is a data row. col0 = sub_category, monthly values in cols 4-15
    const hasValues = row.slice(4, 16).some((v) => typeof v === "number");
    if (!hasValues || !currentMainCategory) continue;

    const subCategory = col0;
    let categoryId = catMap.get(`${currentMainCategory}|${subCategory}`);

    if (!categoryId) {
      // Create the category
      await d1Query(
        "INSERT OR IGNORE INTO categories (main_category, sub_category) VALUES (?, ?)",
        [currentMainCategory, subCategory]
      );
      const fetched = await d1Query(
        "SELECT id FROM categories WHERE main_category = ? AND sub_category = ?",
        [currentMainCategory, subCategory]
      );
      categoryId = fetched[0]?.id;
      if (categoryId) {
        catMap.set(`${currentMainCategory}|${subCategory}`, categoryId);
        console.log(`  Created: ${currentMainCategory} > ${subCategory} (id=${categoryId})`);
      }
    }

    if (!categoryId) {
      console.log(`  SKIP: ${currentMainCategory} > ${subCategory} (no category found)`);
      continue;
    }

    // Also handle continuation rows (where col0 is empty, same sub_category)
    // Aggregate monthly values for this sub_category group
    let groupRow = rowIdx;
    const monthlyTotals = new Array(12).fill(0);

    while (groupRow < data.length) {
      const r = data[groupRow];
      if (!r) { groupRow++; continue; }

      const c0 = String(r[0] || "").trim();

      // If we're past the first row and hit a new non-empty col0, stop
      if (groupRow > rowIdx && c0 && !SKIP_LABELS.has(c0)) break;

      for (let m = 0; m < 12; m++) {
        const val = r[4 + m];
        if (typeof val === "number") {
          monthlyTotals[m] += val;
        }
      }

      groupRow++;
      // Check if next row is a continuation (empty col0 with same group)
      const nextRow = data[groupRow];
      if (!nextRow || (String(nextRow[0] || "").trim() !== "")) break;
    }

    // Jump to after the group
    rowIdx = groupRow - 1;

    for (let m = 0; m < 12; m++) {
      if (monthlyTotals[m] !== 0) {
        budgetEntries.push({
          category_id: categoryId,
          amount: Math.abs(monthlyTotals[m]),
          year: 2026,
          month: m + 1,
        });
      }
    }

    console.log(`  ${subCategory}: ${monthlyTotals.filter(v => v !== 0).length} months`);
  }

  console.log(`\nTotal: ${budgetEntries.length} budget entries. Inserting...`);

  for (const entry of budgetEntries) {
    await d1Query(
      "INSERT OR REPLACE INTO budgets (category_id, amount, year, month) VALUES (?, ?, ?, ?)",
      [entry.category_id, entry.amount, entry.year, entry.month]
    );
  }

  console.log("Done!");
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
