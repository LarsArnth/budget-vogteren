export async function onRequestPost(context) {
  const { request, env } = context;
  const formData = await request.formData();
  const file = formData.get("file");

  if (!file) {
    return new Response(JSON.stringify({ error: "No file uploaded" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const csvText = await file.text();
  const lines = csvText.split("\n").filter((l) => l.trim());
  const headers = lines[0]
    .split(";")
    .map((h) => h.replace(/"/g, "").trim().toLowerCase());

  const format = detectFormat(headers);
  if (!format) {
    return new Response(
      JSON.stringify({
        error:
          "Ukendt CSV-format. Forventede kolonner: Dato, Beskrivelse/Tekst, Beløb",
        headers,
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Parse transactions from CSV
  const transactions = [];
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

    const id =
      format.idIdx !== null
        ? row[format.idIdx]
        : hashId(date, description, amount, i);

    transactions.push({
      id,
      date: normalizeDate(date),
      description,
      original_description:
        format.origDescIdx !== null ? row[format.origDescIdx] : description,
      amount,
      account_name:
        format.accountIdx !== null ? (row[format.accountIdx] || "") : "",
    });
  }

  if (transactions.length === 0) {
    return new Response(
      JSON.stringify({ error: "Ingen posteringer fundet i filen" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Load all mappings for categorization
  const [mappingsResult, mpMappingsResult] = await Promise.all([
    env.DB.prepare("SELECT pattern, category_id FROM mappings").all(),
    env.DB.prepare("SELECT name, category_id FROM mobilepay_mappings").all(),
  ]);

  const mappings = mappingsResult.results || [];
  const mpMappings = mpMappingsResult.results || [];

  const mappingLookup = new Map();
  for (const m of mappings) {
    mappingLookup.set(m.pattern.toLowerCase(), m.category_id);
  }
  const mpLookup = new Map();
  for (const mp of mpMappings) {
    mpLookup.set(mp.name.toLowerCase(), mp.category_id);
  }

  let categorized = 0;
  let uncategorized = 0;
  const batch = [];

  for (const t of transactions) {
    let categoryId = null;
    const descLower = t.description.toLowerCase();

    // 1. MobilePay mapping
    if (descLower.startsWith("mobilepay:")) {
      const mpName = t.description.substring("mobilepay:".length).trim();
      categoryId = mpLookup.get(mpName.toLowerCase()) || null;
    }

    // 2. Exact match on description
    if (!categoryId) {
      categoryId = mappingLookup.get(descLower) || null;
    }

    // 3. Partial match - description contains a known pattern
    if (!categoryId) {
      for (const [pattern, catId] of mappingLookup) {
        if (descLower.includes(pattern) || pattern.includes(descLower)) {
          categoryId = catId;
          break;
        }
      }
    }

    if (categoryId) categorized++;
    else uncategorized++;

    batch.push(
      env.DB.prepare(
        `INSERT OR REPLACE INTO transactions (id, date, description, original_description, amount, category_id, account_name)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        t.id,
        t.date,
        t.description,
        t.original_description,
        t.amount,
        categoryId,
        t.account_name
      )
    );
  }

  // D1 batch limit is ~100 statements
  for (let i = 0; i < batch.length; i += 100) {
    await env.DB.batch(batch.slice(i, i + 100));
  }

  return new Response(
    JSON.stringify({
      success: true,
      total: transactions.length,
      categorized,
      uncategorized,
    }),
    { headers: { "Content-Type": "application/json" } }
  );
}

function detectFormat(headers) {
  // Spiir full export (24 cols)
  if (
    headers.includes("id") &&
    headers.includes("amount") &&
    headers.length > 10
  ) {
    return {
      idIdx: headers.indexOf("id"),
      dateIdx: headers.indexOf("date"),
      descIdx: headers.indexOf("description"),
      origDescIdx: headers.indexOf("originaldescription"),
      amountIdx: headers.indexOf("amount"),
      accountIdx: headers.indexOf("accountname"),
    };
  }
  // Spiir simple export
  if (
    headers.includes("konto") &&
    headers.includes("beskrivelse") &&
    headers.includes("beløb")
  ) {
    return {
      idIdx: null,
      dateIdx: headers.indexOf("dato"),
      descIdx: headers.indexOf("beskrivelse"),
      origDescIdx: null,
      amountIdx: headers.indexOf("beløb"),
      accountIdx: headers.indexOf("konto"),
    };
  }
  // Generic Danish bank CSV
  if (
    headers.includes("dato") &&
    headers.includes("tekst") &&
    headers.includes("beløb")
  ) {
    return {
      idIdx: null,
      dateIdx: headers.indexOf("dato"),
      descIdx: headers.indexOf("tekst"),
      origDescIdx: null,
      amountIdx: headers.indexOf("beløb"),
      accountIdx: null,
    };
  }
  // Sydbank: Bogført;Tekst;Beløb
  if (headers.includes("bogført") && headers.includes("tekst")) {
    return {
      idIdx: null,
      dateIdx: headers.indexOf("bogført"),
      descIdx: headers.indexOf("tekst"),
      origDescIdx: null,
      amountIdx: headers.indexOf("beløb"),
      accountIdx: null,
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
