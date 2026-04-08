// POST: Categorize transaction(s) - supports single, all-by-name, and split
export async function onRequestPost(context) {
  const { env, request } = context;
  const body = await request.json();
  const { transaction_id, category_id, save_mapping, apply_to_all, splits } = body;

  if (!transaction_id) {
    return json({ error: "transaction_id required" }, 400);
  }

  // Get the transaction description for "apply to all" and mapping save
  const { results: txnRows } = await env.DB.prepare(
    "SELECT description FROM transactions WHERE id = ?"
  ).bind(transaction_id).all();

  if (txnRows.length === 0) {
    return json({ error: "Transaction not found" }, 400);
  }

  const description = txnRows[0].description;

  // --- SPLIT MODE ---
  if (splits && Array.isArray(splits) && splits.length > 0) {
    // Delete existing splits for this transaction
    await env.DB.prepare(
      "DELETE FROM transaction_splits WHERE transaction_id = ?"
    ).bind(transaction_id).run();

    // Insert new splits
    const batch = splits.map((s) =>
      env.DB.prepare(
        "INSERT INTO transaction_splits (transaction_id, category_id, amount, description) VALUES (?, ?, ?, ?)"
      ).bind(transaction_id, s.category_id, s.amount, s.label || null)
    );
    await env.DB.batch(batch);

    // Set the transaction's main category to the largest split
    const mainSplit = splits.reduce((a, b) => Math.abs(a.amount) > Math.abs(b.amount) ? a : b);
    await env.DB.prepare(
      "UPDATE transactions SET category_id = ? WHERE id = ?"
    ).bind(mainSplit.category_id, transaction_id).run();

    // If apply_to_all, save as split rule (percentage-based)
    if (apply_to_all) {
      // Delete old rules for this pattern
      await env.DB.prepare(
        "DELETE FROM split_rules WHERE pattern = ?"
      ).bind(description).run();

      const { results: txnAmt } = await env.DB.prepare(
        "SELECT amount FROM transactions WHERE id = ?"
      ).bind(transaction_id).all();
      const totalAmt = Math.abs(txnAmt[0].amount);

      const ruleBatch = splits.map((s) =>
        env.DB.prepare(
          "INSERT INTO split_rules (pattern, category_id, percentage, label) VALUES (?, ?, ?, ?)"
        ).bind(description, s.category_id, (Math.abs(s.amount) / totalAmt) * 100, s.label || null)
      );
      await env.DB.batch(ruleBatch);

      // Also apply splits to all existing transactions with same description
      const { results: others } = await env.DB.prepare(
        "SELECT id, amount FROM transactions WHERE description = ? AND id != ?"
      ).bind(description, transaction_id).all();

      for (const other of others) {
        await env.DB.prepare(
          "DELETE FROM transaction_splits WHERE transaction_id = ?"
        ).bind(other.id).run();

        const otherBatch = splits.map((s) => {
          const pct = Math.abs(s.amount) / totalAmt;
          return env.DB.prepare(
            "INSERT INTO transaction_splits (transaction_id, category_id, amount, description) VALUES (?, ?, ?, ?)"
          ).bind(other.id, s.category_id, other.amount * pct, s.label || null);
        });
        await env.DB.batch(otherBatch);

        await env.DB.prepare(
          "UPDATE transactions SET category_id = ? WHERE id = ?"
        ).bind(mainSplit.category_id, other.id).run();
      }
    }

    return json({ success: true, mode: "split" });
  }

  // --- SIMPLE CATEGORIZE MODE ---
  if (!category_id) {
    return json({ error: "category_id or splits required" }, 400);
  }

  if (apply_to_all) {
    // Update ALL transactions with the same description
    await env.DB.prepare(
      "UPDATE transactions SET category_id = ? WHERE description = ?"
    ).bind(category_id, description).run();

    // Also remove any splits on those transactions
    await env.DB.prepare(
      "DELETE FROM transaction_splits WHERE transaction_id IN (SELECT id FROM transactions WHERE description = ?)"
    ).bind(description).run();
  } else {
    // Update just this one
    await env.DB.prepare(
      "UPDATE transactions SET category_id = ? WHERE id = ?"
    ).bind(category_id, transaction_id).run();

    // Remove splits on this transaction
    await env.DB.prepare(
      "DELETE FROM transaction_splits WHERE transaction_id = ?"
    ).bind(transaction_id).run();
  }

  // Save mapping rule
  if (save_mapping) {
    if (description.toLowerCase().startsWith("mobilepay:")) {
      const mpName = description.substring("mobilepay:".length).trim();
      await env.DB.prepare(
        "INSERT OR REPLACE INTO mobilepay_mappings (name, category_id) VALUES (?, ?)"
      ).bind(mpName, category_id).run();
    } else {
      await env.DB.prepare(
        "INSERT OR REPLACE INTO mappings (pattern, category_id) VALUES (?, ?)"
      ).bind(description, category_id).run();
    }
  }

  return json({ success: true, mode: apply_to_all ? "all" : "single" });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
