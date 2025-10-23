import React from "react";
import {
  requestTradeupAvailability,
  type TradeupCalculationResponse,
} from "../../services/api";
import type { TradeupAvailabilityState } from "../types";

/**
 * Управляет запросом доступности входов для выбранного исхода trade-up'а
 * и хранит локальное состояние выполнения/ошибок.
 */

interface AvailabilityCheckerOptions {
  calculation: TradeupCalculationResponse | null;
}

const createInitialState = (): TradeupAvailabilityState => ({
  activeOutcomeKey: null,
  loading: false,
  error: null,
  result: null,
  outcomeLabel: null,
  outcomeMarketHashName: null,
});

export const useAvailabilityChecker = ({
  calculation,
}: AvailabilityCheckerOptions) => {
  const [availabilityState, setAvailabilityState] = React.useState<TradeupAvailabilityState>(
    () => createInitialState(),
  );

  const resetAvailability = React.useCallback(() => {
    setAvailabilityState(createInitialState());
  }, []);

  const checkAvailability = React.useCallback(
    async (outcome: TradeupCalculationResponse["outcomes"][number]) => {
      if (!calculation) {
        resetAvailability();
        setAvailabilityState((prev) => ({
          ...prev,
          error: "Сначала рассчитайте trade-up",
        }));
        return;
      }

      const slots = calculation.inputs.map((input, index) => ({
        index,
        marketHashName: input.marketHashName,
      }));

      const outcomeKey = `${outcome.collectionId}:${outcome.marketHashName}`;
      const outcomeLabel = `${outcome.baseName} (${outcome.exterior})`;

      setAvailabilityState((prev) => ({
        ...prev,
        activeOutcomeKey: outcomeKey,
        loading: true,
        error: null,
        outcomeLabel,
        outcomeMarketHashName: outcome.marketHashName,
      }));

      try {
        const payload = {
          outcome: {
            marketHashName: outcome.marketHashName,
            minFloat: outcome.minFloat,
            maxFloat: outcome.maxFloat,
            rollFloat: outcome.rollFloat,
          },
          slots,
          limit: 50,
          targetAverageFloat: calculation.averageFloat,
        } satisfies Parameters<typeof requestTradeupAvailability>[0];
        const result = await requestTradeupAvailability(payload);
        setAvailabilityState((prev) => ({
          ...prev,
          loading: false,
          result,
          error: null,
        }));
      } catch (error: any) {
        setAvailabilityState((prev) => ({
          ...prev,
          loading: false,
          result: null,
          error: String(error?.message || error),
        }));
      }
    },
    [calculation, resetAvailability],
  );

  return { availabilityState, checkAvailability, resetAvailability };
};
