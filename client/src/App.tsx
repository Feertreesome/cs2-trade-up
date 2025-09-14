import React from "react";
import SkinsBrowser from "./modules/skins";

/**
 * Главная страница приложения — содержит только компонент SkinsBrowser.
 */
const App: React.FC = () => (
    <div className="container mt-4">
        <div className="card bg-dark text-white mb-3 p-3">
            <div className="h1">CS2 Skins — Market Browser</div>
            <div className="small">Live Steam prices • Stable pagination • Progressive loading</div>
        </div>
        <SkinsBrowser />
    </div>
);

export default App;
