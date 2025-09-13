import { useState } from "react";
import { type ExpandMode, type Rarity } from "../services";
import useProgressiveLoader from "./useProgressiveLoader";

export default function useSkinsBrowser() {
  const [rarity, setRarity] = useState<Rarity>("Classified");
  const [aggregate, setAggregate] = useState(true);
  const [normalOnly, setNormalOnly] = useState(true);
  const [expandExteriors, setExpandExteriors] = useState<ExpandMode>("all");

  const loader = useProgressiveLoader({
    rarity,
    aggregate,
    normalOnly,
    expandExteriors,
  });

  return {
    rarity,
    setRarity,
    aggregate,
    setAggregate,
    normalOnly,
    setNormalOnly,
    expandExteriors,
    setExpandExteriors,
    loader,
  } as const;
}
