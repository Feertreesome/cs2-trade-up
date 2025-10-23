import React from "react";

export const useBuyerFee = () => {
  const [buyerFeePercent, setBuyerFeePercent] = React.useState<number>(15);
  const buyerToNetRate = React.useMemo(
    () => 1 + Math.max(0, buyerFeePercent) / 100,
    [buyerFeePercent],
  );
  return { buyerFeePercent, setBuyerFeePercent, buyerToNetRate } as const;
};
