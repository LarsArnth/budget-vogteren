export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!file) {
      return jsonResponse({ error: "No file uploaded" }, 400);
    }

    let csvText;
    if (typeof file === "string") {
      csvText = file;
    } else if (typeof file?.text === "function") {
      csvText = await file.text();
    } else if (typeof file?.arrayBuffer === "function") {
      const buf = await file.arrayBuffer();
      csvText = new TextDecoder("utf-8").decode(buf);
    } else {
      return jsonResponse({ error: "Kunne ikke laese filen" }, 400);
    }

    // Strip BOM
    if (csvText.charCodeAt(0) === 0xfeff) {
      csvText = csvText.slice(1);
    }

    const lines = csvText.split("\n").filter((l) => l.trim());
    if (lines.length < 2) {
      return jsonResponse({ error: "Filen er tom" }, 400);
    }

    const headers = lines[0]
      .split(";")
      .map((h) => h.replace(/"/g, "").trim().toLowerCase());

    const format = detectFormat(headers);
    if (!format) {
      return jsonResponse({
        error: "Ukendt CSV-format",
        detectedHeaders: headers.slice(0, 5),
      }, 400);
    }

    // Load category lookup: "main|sub" -> id
    const catResult = await env.DB.prepare(
      "SELECT id, main_category, sub_category FROM categories"
    ).all();
    const catLookup = new Map();
    for (const c of (catResult.results || [])) {
      catLookup.set(`${c.main_category}|${c.sub_category}`, c.id);
    }

    // Load mapping lookups (exact match only - fast O(1))
    const [mappingsResult, mpMappingsResult] = await Promise.all([
      env.DB.prepare("SELECT pattern, category_id FROM mappings").all(),
      env.DB.prepare("SELECT name, category_id FROM mobilepay_mappings").all(),
    ]);

    const mappingLookup = new Map();
    for (const m of (mappingsResult.results || [])) {
      mappingLookup.set(m.pattern.toLowerCase(), m.category_id);
    }
    const mpLookup = new Map();
    for (const mp of (mpMappingsResult.results || [])) {
      mpLookup.set(mp.name.toLowerCase(), mp.category_id);
    }

    // Parse and categorize transactions
    let categorized = 0;
    let uncategorized = 0;
    const batch = [];

    for (let i = 1; i < lines.length; i++) {
      const row = lines[i].split(";").map((c) => c.replace(/"/g, "").trim());
      if (row.length < 3) continue;

      const date = row[format.dateIdx];
      const description = row[format.descIdx] || "";
      const amountStr = (row[format.amountIdx] || "0")
        .replace(/\./g, "")
        .replace(",", ".");
      const amount = parseFloat(amountStr);

      if (!date || isNaN(amount)) continue;

      const id = format.idIdx !== null
        ? row[format.idIdx]
        : hashId(date, description, amount, i);

      // Determine category
      let categoryId = null;

      // Strategy 1: If CSV has category columns (Spiir format), use them
      if (format.mainCatIdx !== null && format.subCatIdx !== null) {
        const mainCat = row[format.mainCatIdx] || "";
        const subCat = row[format.subCatIdx] || "";
        if (mainCat && subCat) {
          categoryId = catLookup.get(`${mainCat}|${subCat}`) || null;
        }
      }

      // Strategy 2: MobilePay mapping
      if (!categoryId) {
        const descLower = description.toLowerCase();
        if (descLower.startsWith("mobilepay:")) {
          const mpName = description.substring("mobilepay:".length).trim();
          categoryId = mpLookup.get(mpName.toLowerCase()) || null;
        }

        // Strategy 3: Exact match on description
        if (!categoryId) {
          categoryId = mappingLookup.get(descLower) || null;
        }
      }

      if (categoryId) categorized++;
      else uncategorized++;

      batch.push(
        env.DB.prepare(
          `INSERT OR REPLACE INTO transactions (id, date, description, original_description, amount, category_id, account_name)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          id,
          normalizeDate(date),
          description,
          format.origDescIdx !== null ? (row[format.origDescIdx] || description) : description,
          amount,
          categoryId,
          format.accountIdx !== null ? (row[format.accountIdx] || "") : ""
        )
      );
    }

    if (batch.length === 0) {
      return jsonResponse({ error: "Ingen posteringer fundet i filen" }, 400);
    }

    // D1 batch limit is ~100 statements
    for (let i = 0; i < batch.length; i += 100) {
      await env.DB.batch(batch.slice(i, i + 100));
    }

    return jsonResponse({
      success: true,
      total: batch.length,
      categorized,
      uncategorized,
    });
  } catch (err) {
    return jsonResponse({ error: "Server-fejl: " + (err.message || String(err)) }, 500);
  }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function detectFormat(headers) {
  // Spiir full export (24 cols): Id;AccountId;AccountName;...;Amount;...
  if (headers.includes("id") && headers.includes("amount") && headers.length > 10) {
    return {
      idIdx: headers.indexOf("id"),
      dateIdx: headers.indexOf("date"),
      descIdx: headers.indexOf("description"),
      origDescIdx: headers.indexOf("originaldescription"),
      amountIdx: headers.indexOf("amount"),
      accountIdx: headers.indexOf("accountname"),
      mainCatIdx: headers.indexOf("maincategoryname"),
      subCatIdx: headers.indexOf("categoryname"),
    };
  }
  // Spiir simple export: Konto;Dato;Beskrivelse;Hovedkategori;Kategori;Type;Beloeb;...
  if (headers.includes("beskrivelse") && headers.includes("dato")) {
    const belobIdx = headers.indexOf("beløb") !== -1 ? headers.indexOf("beløb") : headers.indexOf("belob");
    return {
      idIdx: null,
      dateIdx: headers.indexOf("dato"),
      descIdx: headers.indexOf("beskrivelse"),
      origDescIdx: null,
      amountIdx: belobIdx,
      accountIdx: headers.indexOf("konto") !== -1 ? headers.indexOf("konto") : null,
      mainCatIdx: headers.indexOf("hovedkategori") !== -1 ? headers.indexOf("hovedkategori") : null,
      subCatIdx: headers.indexOf("kategori") !== -1 ? headers.indexOf("kategori") : null,
    };
  }
  // Generic Danish bank CSV: Dato;Tekst;Beloeb
  if (headers.includes("tekst") && headers.includes("dato")) {
    const belobIdx = headers.indexOf("beløb") !== -1 ? headers.indexOf("beløb") : headers.indexOf("belob");
    return {
      idIdx: null,
      dateIdx: headers.indexOf("dato"),
      descIdx: headers.indexOf("tekst"),
      origDescIdx: null,
      amountIdx: belobIdx,
      accountIdx: null,
      mainCatIdx: null,
      subCatIdx: null,
    };
  }
  // Sydbank: Bogfoert;Tekst;Beloeb
  if (headers.includes("bogført") && headers.includes("tekst")) {
    const belobIdx = headers.indexOf("beløb") !== -1 ? headers.indexOf("beløb") : headers.indexOf("belob");
    return {
      idIdx: null,
      dateIdx: headers.indexOf("bogført"),
      descIdx: headers.indexOf("tekst"),
      origDescIdx: null,
      amountIdx: belobIdx,
      accountIdx: null,
      mainCatIdx: null,
      subCatIdx: null,
    };
  }
  return null;
}

function normalizeDate(dateStr) {
  const parts = dateStr.split(/[-/.]/);
  if (parts.length === 3) {
    const [a, b, c] = parts;
    if (a.length === 4)
      return `${a}-${b.padStart(2, "0")}-${c.padStart(2, "0")}`;
    return `${c}-${b.padStart(2, "0")}-${a.padStart(2, "0")}`;
  }
  return dateStr;
}

function hashId(date, description, amount, rowIdx) {
  const str = `${date}|${description}|${amount}|${rowIdx}`;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return `gen_${Math.abs(hash).toString(36)}_${Date.now().toString(36)}`;
}
