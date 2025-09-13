import React from "react";
import SkinsBrowser from "./modules/skins";

/**
 * Главная страница приложения — содержит только компонент SkinsBrowser.
 */
const App: React.FC = () => (
    <div className="container">
        <div className="card" style={{ marginBottom: 12 }}>
            <div className="h1">CS2 Skins — Market Browser</div>
            <div className="small">Live Steam prices • Stable pagination • Progressive loading</div>
        </div>
        <SkinsBrowser />
    </div>
);

export default App;
