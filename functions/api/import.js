
export async function onRequestPost(context) {
  const { request, env } = context;
  const formData = await request.formData();
  const file = formData.get("file");

  if (!file) {
    return new Response("No file uploaded", { status: 400 });
  }

  const csvText = await file.text();
  const lines = csvText.split("\n");
  const headers = lines[0].split(";").map(h => h.replace(/"/g, ""));
  
  const transactions = [];
  // Skip header, process rows
  for (let i = 1; i < lines.length; i++) {
    const row = lines[i].split(";").map(c => c.replace(/"/g, ""));
    if (row.length < headers.length) continue;
    
    // Vi mapper Spiir-kolonner til vores database
    const transaction = {
      id: row[0],
      date: row[4],
      description: row[5],
      original_description: row[6],
      amount: parseFloat(row[13].replace(",", ".")),
      account_name: row[2]
    };
    transactions.push(transaction);
  }

  // Batch-indsæt i D1 for at det går stærkt
  const stmt = env.DB.prepare(`
    INSERT OR IGNORE INTO transactions (id, date, description, original_description, amount, account_name)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const batch = transactions.map(t => 
    stmt.bind(t.id, t.date, t.description, t.original_description, t.amount, t.account_name)
  );

  await env.DB.batch(batch);

  return new Response(JSON.stringify({ 
    success: true, 
    count: transactions.length 
  }), {
    headers: { "Content-Type": "application/json" }
  });
}
