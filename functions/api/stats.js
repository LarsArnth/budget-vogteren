export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const month = url.searchParams.get("month"); // YYYY-MM

  if (!month) {
    return new Response(JSON.stringify({ error: "month parameter required (YYYY-MM)" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Spending per category this month (expenses only = negative amounts)
  const { results: categorySpending } = await env.DB.prepare(`
    SELECT c.main_category, c.sub_category, c.id as category_id,
           SUM(t.amount) as total_spent,
           COUNT(t.id) as transaction_count
    FROM transactions t
    LEFT JOIN categories c ON t.category_id = c.id
    WHERE t.date LIKE ? AND t.amount < 0
    GROUP BY COALESCE(c.main_category, 'Ikke kategoriseret')
    ORDER BY total_spent ASC
  `).bind(`${month}%`).all();

  // Total income and expenses
  const { results: totals } = await env.DB.prepare(`
    SELECT
      SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END) as total_expenses,
      SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) as total_income,
      COUNT(*) as transaction_count
    FROM transactions
    WHERE date LIKE ?
  `).bind(`${month}%`).all();

  // Budget for this month
  const [yearStr, monthStr] = month.split("-");
  const { results: budgets } = await env.DB.prepare(`
    SELECT b.amount as budget_amount, c.main_category, c.sub_category, c.id as category_id
    FROM budgets b
    JOIN categories c ON b.category_id = c.id
    WHERE b.year = ? AND b.month = ?
  `).bind(parseInt(yearStr), parseInt(monthStr)).all();

  // Total budget
  const totalBudget = budgets.reduce((sum, b) => sum + b.budget_amount, 0);

  // Uncategorized count
  const { results: uncatResult } = await env.DB.prepare(`
    SELECT COUNT(*) as count FROM transactions
    WHERE date LIKE ? AND category_id IS NULL
  `).bind(`${month}%`).all();

  return new Response(
    JSON.stringify({
      month,
      total_expenses: totals[0]?.total_expenses || 0,
      total_income: totals[0]?.total_income || 0,
      transaction_count: totals[0]?.transaction_count || 0,
      total_budget: totalBudget,
      uncategorized_count: uncatResult[0]?.count || 0,
      category_spending: categorySpending,
      budgets,
    }),
    { headers: { "Content-Type": "application/json" } }
  );
}
