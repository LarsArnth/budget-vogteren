export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const month = url.searchParams.get("month");

  if (!month) {
    return json({ error: "month parameter required (YYYY-MM)" }, 400);
  }

  // Category spending: use splits where they exist, otherwise use transaction category
  // Transactions WITH splits: sum split amounts per category
  // Transactions WITHOUT splits: use original amount + category
  const { results: categorySpending } = await env.DB.prepare(`
    SELECT c.main_category, c.sub_category, c.id as category_id,
           SUM(effective_amount) as total_spent,
           COUNT(*) as transaction_count
    FROM (
      -- Transactions with splits: use split amounts
      SELECT ts.category_id, ts.amount as effective_amount
      FROM transactions t
      JOIN transaction_splits ts ON ts.transaction_id = t.id
      WHERE t.date LIKE ? AND ts.amount < 0

      UNION ALL

      -- Transactions without splits: use original amount
      SELECT t.category_id, t.amount as effective_amount
      FROM transactions t
      WHERE t.date LIKE ? AND t.amount < 0
        AND NOT EXISTS (SELECT 1 FROM transaction_splits ts WHERE ts.transaction_id = t.id)
    ) sub
    LEFT JOIN categories c ON sub.category_id = c.id
    GROUP BY COALESCE(c.main_category, 'Ikke kategoriseret')
    ORDER BY total_spent ASC
  `).bind(`${month}%`, `${month}%`).all();

  // Total income and expenses (raw transaction amounts, not splits)
  const { results: totals } = await env.DB.prepare(`
    SELECT
      SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END) as total_expenses,
      SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) as total_income,
      COUNT(*) as transaction_count
    FROM transactions
    WHERE date LIKE ?
  `).bind(`${month}%`).all();

  // Budget
  const [yearStr, monthStr] = month.split("-");
  const { results: budgets } = await env.DB.prepare(`
    SELECT b.amount as budget_amount, c.main_category, c.sub_category, c.id as category_id
    FROM budgets b
    JOIN categories c ON b.category_id = c.id
    WHERE b.year = ? AND b.month = ?
  `).bind(parseInt(yearStr), parseInt(monthStr)).all();

  const totalBudget = budgets.reduce((sum, b) => sum + b.budget_amount, 0);

  // Uncategorized count
  const { results: uncatResult } = await env.DB.prepare(`
    SELECT COUNT(*) as count FROM transactions
    WHERE date LIKE ? AND category_id IS NULL
  `).bind(`${month}%`).all();

  return json({
    month,
    total_expenses: totals[0]?.total_expenses || 0,
    total_income: totals[0]?.total_income || 0,
    transaction_count: totals[0]?.transaction_count || 0,
    total_budget: totalBudget,
    uncategorized_count: uncatResult[0]?.count || 0,
    category_spending: categorySpending,
    budgets,
  });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
