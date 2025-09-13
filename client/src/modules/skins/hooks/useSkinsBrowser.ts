import { useMemo, useState } from "react";
import {
  fetchSkins,
  type ApiAggResp,
  type ApiFlatResp,
  type ExpandMode,
  type Rarity,
} from "../services";
import useProgressiveLoader from "./useProgressiveLoader";

export default function useSkinsBrowser() {
  const [rarity, setRarity] = useState<Rarity>("Classified");
  const [aggregate, setAggregate] = useState(true);
  const [prices, setPrices] = useState(false);
  const [normalOnly, setNormalOnly] = useState(true);
  const [expandExteriors, setExpandExteriors] = useState<ExpandMode>("all");
  const [limit, setLimit] = useState(100);

  const [data, setData] = useState<ApiAggResp | ApiFlatResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loader = useProgressiveLoader({
    rarity,
    aggregate,
    prices,
    normalOnly,
    expandExteriors,
  });

  async function load() {
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const resp = await fetchSkins({
        rarities: [rarity],
        limit,
        aggregate,
        prices,
        normalOnly,
        expandExteriors,
      });
      setData(resp);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  const meta = (data as any)?.meta ?? null;
  const hint = useMemo(() => {
    if (!data) return "Choose params and click Load or Load progressively.";
    if (meta) {
      return `Totals: ${Object.entries(meta.totals || {})
        .map(([k, v]) => `${k}=${v}`)
        .join(", ")} • Recommended: ${meta.recommendedLimit} • Applied: ${meta.appliedLimit}${meta.capped ? " (capped)" : ""}`;
    }
    return null;
  }, [data, meta]);

  return {
    rarity,
    setRarity,
    aggregate,
    setAggregate,
    prices,
    setPrices,
    normalOnly,
    setNormalOnly,
    expandExteriors,
    setExpandExteriors,
    limit,
    setLimit,
    data,
    loading,
    error,
    hint,
    load,
    loader,
  } as const;
}
