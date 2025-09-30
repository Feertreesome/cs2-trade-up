import React from "react";
import SkinsBrowser from "./modules/skins";
import TradeupBuilder from "./modules/tradeups";

const App: React.FC = () => {
  const [activeTab, setActiveTab] = React.useState<"browser" | "tradeup">("browser");

  return (
    <div className="container mt-4">
      <div className="card bg-dark text-white mb-3 p-3">
        <div className="h1">CS2 Toolkit</div>
        <div className="small">Live Steam prices • Trade-up EV • Progressive loading</div>
      </div>
      <ul className="nav nav-tabs mb-3">
        <li className="nav-item">
          <button
            className={`nav-link ${activeTab === "tradeup" ? "" : "active"}`}
            type="button"
            onClick={() => setActiveTab("browser")}
          >
            Market Browser
          </button>
        </li>
        <li className="nav-item">
          <button
            className={`nav-link ${activeTab === "tradeup" ? "active" : ""}`}
            type="button"
            onClick={() => setActiveTab("tradeup")}
          >
            Trade-Up Calculator
          </button>
        </li>
      </ul>
      {activeTab === "tradeup" ? <TradeupBuilder /> : <SkinsBrowser />}
    </div>
  );
};

export default App;
