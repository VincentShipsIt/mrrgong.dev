import type { SaleKind } from "./types.ts";

export const SaleKindLabel: Record<SaleKind, string> = {
  one_time: "sale",
  new_subscription: "new subscriber",
  renewal: "renewal",
};
