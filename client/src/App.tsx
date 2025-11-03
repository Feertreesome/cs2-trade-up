import React from "react";
import SkinsBrowser from "./modules/skins";
import TradeupBuilder from "./modules/tradeups";
import CollectionAnalyzer from "./modules/collections";
import {
  fetchCollectionsSyncStatus,
  requestCollectionsSync,
  type SyncJobStatus,
} from "./modules/tradeups/services/api";

const App: React.FC = () => {
  const [activeTab, setActiveTab] = React.useState<"browser" | "tradeup" | "collections">(
    "browser",
  );
  const [syncOverview, setSyncOverview] = React.useState<{
    active: SyncJobStatus | null;
    jobs: SyncJobStatus[];
  } | null>(null);
  const [syncMessage, setSyncMessage] = React.useState<string | null>(null);
  const [syncLoading, setSyncLoading] = React.useState(false);

  const updateSyncOverview = React.useCallback(async () => {
    setSyncLoading(true);
    setSyncMessage(null);
    try {
      const overview = await fetchCollectionsSyncStatus();
      setSyncOverview(overview);
    } catch (error) {
      setSyncMessage(`Failed to fetch sync status: ${String(error)}`);
    } finally {
      setSyncLoading(false);
    }
  }, []);

  const handleStartSync = React.useCallback(async () => {
    setSyncLoading(true);
    setSyncMessage(null);
    try {
      const { job } = await requestCollectionsSync();
      setSyncMessage(`Sync job #${job.id} is ${job.status}.`);
      const overview = await fetchCollectionsSyncStatus();
      setSyncOverview(overview);
    } catch (error) {
      setSyncMessage(`Failed to start sync: ${String(error)}`);
    } finally {
      setSyncLoading(false);
    }
  }, []);

  const handleCheckSyncStatus = React.useCallback(async () => {
    await updateSyncOverview();
  }, [updateSyncOverview]);

  const renderActiveSync = () => {
    if (!syncOverview) {
      return null;
    }
    const { active } = syncOverview;
    if (!active) {
      return <div className="text-secondary small">No active sync jobs.</div>;
    }

    const progress = active.progress;
    const progressText =
      progress.totalCollections > 0
        ? `${progress.syncedCollections}/${progress.totalCollections}`
        : `${progress.syncedCollections}`;

    return (
      <div className="small">
        Active job #{active.id}: {active.status}
        {` • ${progressText} collections`}
        {progress.currentCollectionName ? ` • ${progress.currentCollectionName}` : ""}
        {progress.currentRarity ? ` (${progress.currentRarity})` : ""}
      </div>
    );
  };

  const renderRecentJobs = () => {
    if (!syncOverview) {
      return null;
    }
    const activeId = syncOverview.active?.id;
    const recent = syncOverview.jobs.filter((job) => job.id !== activeId).slice(0, 3);
    if (!recent.length) {
      return null;
    }
    return (
      <div className="text-secondary small">
        Recent jobs: {recent.map((job) => `#${job.id} ${job.status}`).join(", ")}
      </div>
    );
  };

  return (
    <div className="container mt-4">
      <div className="card bg-dark text-white mb-3 p-3">
        <div className="h1">CS2 Toolkit</div>
        <div className="small">Live Steam prices • Trade-up EV • Progressive loading</div>
        <div className="d-flex flex-wrap gap-2 mt-3">
          <button
            type="button"
            className="btn btn-outline-light btn-sm"
            onClick={handleStartSync}
            disabled={syncLoading}
          >
            Sync collections
          </button>
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            onClick={handleCheckSyncStatus}
            disabled={syncLoading}
          >
            Check sync status
          </button>
        </div>
        <div className="mt-2">
          {syncLoading && <div className="small text-secondary">Loading…</div>}
          {!syncLoading && syncMessage && (
            <div className="small text-warning" role="status">
              {syncMessage}
            </div>
          )}
          {!syncLoading && !syncMessage && (
            <>
              {renderActiveSync()}
              {renderRecentJobs()}
            </>
          )}
        </div>
      </div>
      <ul className="nav nav-tabs mb-3">
        {[
          { id: "browser" as const, label: "Market Browser" },
          { id: "tradeup" as const, label: "Trade-Up Calculator" },
          { id: "collections" as const, label: "Анализ коллекций" },
        ].map((tab) => (
          <li key={tab.id} className="nav-item">
            <button
              className={`nav-link ${activeTab === tab.id ? "active" : ""}`}
              type="button"
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          </li>
        ))}
      </ul>
      {activeTab === "tradeup" ? (
        <TradeupBuilder />
      ) : activeTab === "collections" ? (
        <CollectionAnalyzer />
      ) : (
        <SkinsBrowser />
      )}
    </div>
  );
};

export default App;
