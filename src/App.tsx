
import React, { useState, useEffect } from "react";
import "./App.css";

interface Transaction {
  id: string;
  date: string;
  description: string;
  amount: number;
  category_name?: string;
}

function App() {
  const [file, setFile] = useState<File | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFile(e.target.files[0]);
    }
  };

  const handleUpload = async () => {
    if (!file) return;
    setLoading(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/import", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      alert(`Importeret ${data.count} poster!`);
      fetchTransactions();
    } catch (err) {
      console.error(err);
      alert("Fejl ved import");
    } finally {
      setLoading(false);
    }
  };

  const fetchTransactions = async () => {
    const res = await fetch("/api/transactions");
    const data = await res.json();
    setTransactions(data);
  };

  useEffect(() => {
    fetchTransactions();
  }, []);

  return (
    <div className="container">
      <header>
        <h1>Budget-Vogteren 🛡️</h1>
        <p>Din personlige Spiir-erstatning</p>
      </header>

      <main>
        <section className="import-box">
          <h2>Importer Bankdata</h2>
          <div className="file-input">
            <input type="file" accept=".csv" onChange={handleFileChange} />
            <button onClick={handleUpload} disabled={loading || !file}>
              {loading ? "Uploader..." : "Importér CSV"}
            </button>
          </div>
        </section>

        <section className="dashboard">
          <div className="summary-cards">
            <div className="card">
              <h3>Forbrug denne måned</h3>
              <p className="amount">14.200 kr.</p>
            </div>
            <div className="card">
              <h3>Mest brugt på</h3>
              <p className="category">Husholdning 🍎</p>
            </div>
          </div>

          <div className="transaction-list">
            <h3>Seneste Posteringer</h3>
            <table>
              <thead>
                <tr>
                  <th>Dato</th>
                  <th>Beskrivelse</th>
                  <th>Beløb</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((t) => (
                  <tr key={t.id}>
                    <td>{t.date}</td>
                    <td>{t.description}</td>
                    <td className={t.amount < 0 ? "negative" : "positive"}>
                      {t.amount.toLocaleString("da-DK", { style: "currency", currency: "DKK" })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
