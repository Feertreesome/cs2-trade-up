import React from "react";
import SkinsBrowserComponent from "./components/SkinsBrowserComponent/SkinsBrowserComponent";

/**
 * Главная страница приложения — содержит только SkinsBrowserComponent.
 */
const App: React.FC = () => (
    <div className="container">
        <div className="card" style={{ marginBottom: 12 }}>
            <div className="h1">CS2 Skins — Market Browser</div>
            <div className="small">Live Steam prices • Stable pagination • Progressive loading</div>
        </div>
        <SkinsBrowserComponent />
    </div>
);

export default App;
