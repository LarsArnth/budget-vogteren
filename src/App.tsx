import { useState, useEffect, useCallback } from "react";
import "./App.css";

interface User {
  id: number;
  email: string;
  name: string;
  picture: string;
}

interface Transaction {
  id: string;
  date: string;
  description: string;
  original_description: string;
  amount: number;
  category_id: number | null;
  account_name: string;
  main_category: string | null;
  sub_category: string | null;
}

interface Category {
  id: number;
  main_category: string;
  sub_category: string;
}

interface CategorySpending {
  main_category: string | null;
  total_spent: number;
  transaction_count: number;
}

interface Stats {
  month: string;
  total_expenses: number;
  total_income: number;
  transaction_count: number;
  total_budget: number;
  uncategorized_count: number;
  category_spending: CategorySpending[];
  budgets: {
    budget_amount: number;
    main_category: string;
    sub_category: string;
    category_id: number;
  }[];
}

type Tab = "overview" | "transactions" | "uncategorized" | "mobilepay" | "import";

const MONTH_NAMES = [
  "Januar", "Februar", "Marts", "April", "Maj", "Juni",
  "Juli", "August", "September", "Oktober", "November", "December",
];

function formatDKK(amount: number): string {
  return amount.toLocaleString("da-DK", {
    style: "currency",
    currency: "DKK",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("overview");
  const [month, setMonth] = useState(getCurrentMonth);
  const [stats, setStats] = useState<Stats | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [categorizeTarget, setCategorizeTarget] = useState<Transaction | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [saveMapping, setSaveMapping] = useState(true);

  // Check auth on load
  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((data) => setUser(data.user || null))
      .catch(() => setUser(null))
      .finally(() => setAuthLoading(false));
  }, []);

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
  };

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch(`/api/stats?month=${month}`);
      const data = await res.json();
      setStats(data);
    } catch {
      /* offline/dev */
    }
  }, [month]);

  const fetchTransactions = useCallback(
    async (opts?: { uncategorized?: boolean; mobilepay?: boolean }) => {
      try {
        const params = new URLSearchParams({ month, limit: "300" });
        if (opts?.uncategorized) params.set("uncategorized", "true");
        if (opts?.mobilepay) params.set("mobilepay", "true");
        const res = await fetch(`/api/transactions?${params}`);
        const data = await res.json();
        setTransactions(data);
      } catch {
        /* offline/dev */
      }
    },
    [month]
  );

  const fetchCategories = useCallback(async () => {
    try {
      const res = await fetch("/api/categories");
      const data = await res.json();
      setCategories(data);
    } catch {
      /* offline/dev */
    }
  }, []);

  useEffect(() => {
    fetchStats();
    fetchCategories();
  }, [fetchStats, fetchCategories]);

  useEffect(() => {
    if (tab === "transactions") fetchTransactions();
    else if (tab === "uncategorized") fetchTransactions({ uncategorized: true });
    else if (tab === "mobilepay") fetchTransactions({ mobilepay: true });
  }, [tab, month, fetchTransactions]);

  const handleImport = async () => {
    if (!file) return;
    setImporting(true);
    setImportResult(null);
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await fetch("/api/import", { method: "POST", body: formData });
      const data = await res.json();
      if (data.success) {
        setImportResult(
          `Importeret ${data.total} posteringer. ${data.categorized} kategoriseret, ${data.uncategorized} ukendte.`
        );
        fetchStats();
      } else {
        setImportResult(`Fejl: ${data.error}`);
      }
    } catch {
      setImportResult("Netvaerksfejl ved import");
    } finally {
      setImporting(false);
    }
  };

  const handleCategorize = async () => {
    if (!categorizeTarget || !selectedCategoryId) return;
    await fetch("/api/categorize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transaction_id: categorizeTarget.id,
        category_id: selectedCategoryId,
        save_mapping: saveMapping,
      }),
    });
    setCategorizeTarget(null);
    setSelectedCategoryId(null);
    fetchStats();
    if (tab === "uncategorized") fetchTransactions({ uncategorized: true });
    else if (tab === "mobilepay") fetchTransactions({ mobilepay: true });
    else fetchTransactions();
  };

  const budgetPct =
    stats && stats.total_budget > 0
      ? Math.min(100, Math.round((Math.abs(stats.total_expenses) / stats.total_budget) * 100))
      : 0;

  const budgetColor =
    budgetPct > 100 ? "var(--red)" : budgetPct > 80 ? "var(--orange)" : "var(--green)";

  const groupedCategories = categories.reduce<Record<string, Category[]>>((acc, c) => {
    if (!acc[c.main_category]) acc[c.main_category] = [];
    acc[c.main_category].push(c);
    return acc;
  }, {});

  if (authLoading) {
    return (
      <div className="login-screen">
        <p>Indlaeser...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="login-screen">
        <div className="login-card">
          <h1>Budget-Vogteren</h1>
          <p>Din personlige budget-app</p>
          <a href="/api/auth/login" className="google-btn">
            <svg width="20" height="20" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Log ind med Google
          </a>
        </div>
      </div>
    );
  }

  return (
    <div>
      <header className="app-header">
        <h1>Budget-Vogteren</h1>
        <div className="month-nav">
          <button onClick={() => setMonth((m) => shiftMonth(m, -1))}>&#8592;</button>
          <span>{monthLabel(month)}</span>
          <button onClick={() => setMonth((m) => shiftMonth(m, 1))}>&#8594;</button>
        </div>
        <div className="user-info">
          {user.picture && <img src={user.picture} alt="" className="user-avatar" />}
          <span>{user.name || user.email}</span>
          <button className="btn btn-secondary" style={{ padding: "4px 10px", fontSize: "12px" }} onClick={handleLogout}>
            Log ud
          </button>
        </div>
      </header>

      <nav className="tabs">
        {(
          [
            ["overview", "Overblik"],
            ["transactions", "Posteringer"],
            ["uncategorized", "Ukendte"],
            ["mobilepay", "MobilePay"],
            ["import", "Import"],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            className={`tab ${tab === key ? "active" : ""}`}
            onClick={() => setTab(key)}
          >
            {label}
            {key === "uncategorized" && stats && stats.uncategorized_count > 0 && (
              <> ({stats.uncategorized_count})</>
            )}
          </button>
        ))}
      </nav>

      {/* OVERVIEW */}
      {tab === "overview" && stats && (
        <>
          <div className="summary-grid">
            <div className="summary-card">
              <div className="label">Forbrug</div>
              <div className="value negative">{formatDKK(stats.total_expenses)}</div>
            </div>
            <div className="summary-card">
              <div className="label">Indkomst</div>
              <div className="value positive">{formatDKK(stats.total_income)}</div>
            </div>
            <div className="summary-card">
              <div className="label">Budget</div>
              <div className="value">{formatDKK(stats.total_budget)}</div>
              {stats.total_budget > 0 && (
                <div className="budget-progress">
                  <div className="progress-bar">
                    <div
                      className="progress-fill"
                      style={{ width: `${budgetPct}%`, background: budgetColor }}
                    />
                  </div>
                  <div className="progress-text">{budgetPct}% brugt</div>
                </div>
              )}
            </div>
            <div className="summary-card">
              <div className="label">Posteringer</div>
              <div className="value">{stats.transaction_count}</div>
              {stats.uncategorized_count > 0 && (
                <div className="progress-text" style={{ color: "var(--orange)" }}>
                  {stats.uncategorized_count} ikke kategoriseret
                </div>
              )}
            </div>
          </div>

          <div className="card">
            <div className="section-header">
              <h2>Forbrug pr. kategori</h2>
            </div>
            <div className="category-list">
              {stats.category_spending.map((cs, i) => {
                const budgetForCat = stats.budgets
                  .filter((b) => b.main_category === cs.main_category)
                  .reduce((s, b) => s + b.budget_amount, 0);
                return (
                  <div className="category-row" key={i}>
                    <span className="cat-name">
                      {cs.main_category || "Ikke kategoriseret"}
                    </span>
                    <span className="cat-spent" style={{ color: "var(--red)" }}>
                      {formatDKK(cs.total_spent)}
                    </span>
                    {budgetForCat > 0 && (
                      <span className="cat-budget">/ {formatDKK(budgetForCat)}</span>
                    )}
                  </div>
                );
              })}
              {stats.category_spending.length === 0 && (
                <p style={{ padding: "20px 0", color: "var(--text)" }}>
                  Ingen posteringer for {monthLabel(month)}.
                </p>
              )}
            </div>
          </div>
        </>
      )}

      {/* TRANSACTIONS / UNCATEGORIZED / MOBILEPAY */}
      {(tab === "transactions" || tab === "uncategorized" || tab === "mobilepay") && (
        <div className="card">
          <div className="section-header">
            <h2>
              {tab === "uncategorized"
                ? "Posteringer uden kategori"
                : tab === "mobilepay"
                  ? "MobilePay-posteringer"
                  : "Alle posteringer"}
            </h2>
          </div>
          {transactions.length === 0 ? (
            <p style={{ padding: "20px 0", color: "var(--text)" }}>
              Ingen posteringer fundet for {monthLabel(month)}.
            </p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="transaction-table">
                <thead>
                  <tr>
                    <th>Dato</th>
                    <th>Beskrivelse</th>
                    <th>Kategori</th>
                    <th style={{ textAlign: "right" }}>Belob</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((t) => (
                    <tr key={t.id}>
                      <td style={{ whiteSpace: "nowrap" }}>{t.date}</td>
                      <td>{t.description}</td>
                      <td>
                        {t.main_category ? (
                          <span className="category-badge">
                            {t.main_category}
                            {t.sub_category ? ` > ${t.sub_category}` : ""}
                          </span>
                        ) : (
                          <span className="uncategorized-badge">Ukendt</span>
                        )}
                      </td>
                      <td
                        className={`amount-cell ${t.amount < 0 ? "negative" : "positive"}`}
                      >
                        {formatDKK(t.amount)}
                      </td>
                      <td>
                        {!t.category_id && (
                          <button
                            className="btn btn-secondary"
                            style={{ padding: "4px 10px", fontSize: "12px" }}
                            onClick={() => {
                              setCategorizeTarget(t);
                              setSelectedCategoryId(null);
                              setSaveMapping(true);
                            }}
                          >
                            Kategoriser
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* IMPORT */}
      {tab === "import" && (
        <div className="card">
          <h2 style={{ marginBottom: 16 }}>Importer bankdata (CSV)</h2>
          <p style={{ marginBottom: 16, color: "var(--text)" }}>
            Upload en CSV-fil fra din bank. Understottede formater: Sydbank, Spiir-eksport, eller
            standard dansk bank-CSV (Dato;Tekst;Belob).
          </p>
          <div className="import-section">
            <input
              type="file"
              accept=".csv"
              onChange={(e) => {
                setFile(e.target.files?.[0] || null);
                setImportResult(null);
              }}
            />
            <button
              className="btn btn-primary"
              onClick={handleImport}
              disabled={importing || !file}
            >
              {importing ? "Importerer..." : "Importer CSV"}
            </button>
          </div>
          {importResult && (
            <div className="import-result" style={{ marginTop: 16 }}>
              {importResult}
            </div>
          )}
        </div>
      )}

      {/* CATEGORIZE MODAL */}
      {categorizeTarget && (
        <div className="modal-overlay" onClick={() => setCategorizeTarget(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Kategoriser postering</h3>
            <p style={{ marginBottom: 12, color: "var(--text)", fontSize: 14 }}>
              <strong>{categorizeTarget.description}</strong>
              <br />
              {formatDKK(categorizeTarget.amount)} &mdash; {categorizeTarget.date}
            </p>
            <select
              value={selectedCategoryId ?? ""}
              onChange={(e) => setSelectedCategoryId(Number(e.target.value) || null)}
            >
              <option value="">Vaelg kategori...</option>
              {Object.entries(groupedCategories).map(([main, cats]) => (
                <optgroup key={main} label={main}>
                  {cats.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.sub_category}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <label>
              <input
                type="checkbox"
                checked={saveMapping}
                onChange={(e) => setSaveMapping(e.target.checked)}
              />
              Husk denne regel til fremtidige posteringer
            </label>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setCategorizeTarget(null)}>
                Annuller
              </button>
              <button
                className="btn btn-primary"
                onClick={handleCategorize}
                disabled={!selectedCategoryId}
              >
                Gem
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
