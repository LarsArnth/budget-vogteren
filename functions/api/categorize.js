// POST: Manually categorize a transaction (and optionally save as mapping)
export async function onRequestPost(context) {
  const { env, request } = context;
  const body = await request.json();
  const { transaction_id, category_id, save_mapping } = body;

  if (!transaction_id || !category_id) {
    return new Response(
      JSON.stringify({ error: "transaction_id and category_id required" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Update the transaction
  await env.DB.prepare(
    "UPDATE transactions SET category_id = ? WHERE id = ?"
  ).bind(category_id, transaction_id).run();

  // Optionally save as a mapping rule for future auto-categorization
  if (save_mapping) {
    const { results } = await env.DB.prepare(
      "SELECT description FROM transactions WHERE id = ?"
    ).bind(transaction_id).all();

    if (results.length > 0 && results[0].description) {
      const desc = results[0].description;

      // Check if it's a MobilePay transaction
      if (desc.toLowerCase().startsWith("mobilepay:")) {
        const mpName = desc.substring("mobilepay:".length).trim();
        await env.DB.prepare(
          "INSERT OR REPLACE INTO mobilepay_mappings (name, category_id) VALUES (?, ?)"
        ).bind(mpName, category_id).run();
      } else {
        await env.DB.prepare(
          "INSERT OR REPLACE INTO mappings (pattern, category_id) VALUES (?, ?)"
        ).bind(desc, category_id).run();
      }
    }
  }

  return new Response(JSON.stringify({ success: true }), {
    headers: { "Content-Type": "application/json" },
  });
}
