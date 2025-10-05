import React from "react";
import TradeupSummary from "./components/TradeupSummary";
import CollectionSelectorSection from "./components/CollectionSelectorSection";
import TargetSelectionSection from "./components/TargetSelectionSection";
import InputsTableSection from "./components/InputsTableSection";
import FloatlessAnalysisSection from "./components/FloatlessAnalysisSection";
import ResultsSection from "./components/ResultsSection";
import useTradeupBuilder from "./hooks/useTradeupBuilder";
import "./TradeupBuilder.css";

/**
 * Основной компонент-конструктор. Комбинирует хук useTradeupBuilder и отображает все шаги:
 * загрузку коллекций из Steam, выбор целевого скина, заполнение входов и показ результатов.
 */
export default function TradeupBuilder() {
  const {
    steamCollections,
    collectionOptions,
    loadSteamCollections,
    loadingSteamCollections,
    steamCollectionError,
    activeCollectionTag,
    targetRarity,
    setTargetRarity,
    selectCollection,
    collectionTargets,
    loadingTargets,
    targetsError,
    selectedTarget,
    selectTarget,
    inputsLoading,
    inputsError,
    rows,
    updateRow,
    buyerFeePercent,
    setBuyerFeePercent,
    buyerToNetRate,
    averageFloat,
    totalBuyerCost,
    totalNetCost,
    selectedCollectionDetails,
    singleCovertCollectionTags,
    autofillPrices,
    priceLoading,
    calculate,
    calculation,
    calculating,
    calculationError,
    floatlessAnalysis,
    availabilityState,
    checkAvailability,
  } = useTradeupBuilder();

  return (
    <div className="tradeup-builder card bg-dark text-white p-3 mb-4">
      <div className="d-flex flex-column flex-md-row justify-content-between gap-3">
        <div>
          <h2 className="h4">Trade-Up Constructor</h2>
          <p className="text-muted small mb-0">
            Подберите 10 входов, выберите целевые коллекции и рассчитайте ожидаемое значение.
          </p>
        </div>
        <TradeupSummary
          averageFloat={averageFloat}
          totalBuyerCost={totalBuyerCost}
          totalNetCost={totalNetCost}
          buyerFeePercent={buyerFeePercent}
          buyerToNetRate={buyerToNetRate}
          onBuyerFeeChange={(value) => setBuyerFeePercent(value)}
        />
      </div>

      <hr className="border-secondary" />

      <CollectionSelectorSection
        steamCollections={steamCollections}
        loadSteamCollections={loadSteamCollections}
        loadingSteamCollections={loadingSteamCollections}
        steamCollectionError={steamCollectionError}
        activeCollectionTag={activeCollectionTag}
        selectCollection={selectCollection}
        selectedCollectionDetails={selectedCollectionDetails}
        singleCovertCollectionTags={singleCovertCollectionTags}
      />

      <hr className="border-secondary" />

      <TargetSelectionSection
        activeCollectionTag={activeCollectionTag}
        targetRarity={targetRarity}
        setTargetRarity={setTargetRarity}
        collectionTargets={collectionTargets}
        loadingTargets={loadingTargets}
        targetsError={targetsError}
        selectedTarget={selectedTarget}
        selectTarget={selectTarget}
        inputsLoading={inputsLoading}
        inputsError={inputsError}
      />

      <hr className="border-secondary" />

      <InputsTableSection
        rows={rows}
        collectionOptions={collectionOptions}
        buyerToNetRate={buyerToNetRate}
        updateRow={updateRow}
        autofillPrices={autofillPrices}
        priceLoading={priceLoading}
        calculate={calculate}
        calculating={calculating}
        calculationError={calculationError}
      />

      <FloatlessAnalysisSection floatlessAnalysis={floatlessAnalysis} />

      {calculation && (
        <ResultsSection
          calculation={calculation}
          totalBuyerCost={totalBuyerCost}
          availabilityState={availabilityState}
          onCheckAvailability={checkAvailability}
        />
      )}
    </div>
  );
}
