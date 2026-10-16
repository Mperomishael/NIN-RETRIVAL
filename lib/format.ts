export type Service = { id: string; name: string; description: string; category: string; price_kobo: number; enabled: boolean };

export const money = (kobo: number) =>
  new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(kobo / 100);

export const dateText = (value: string) =>
  new Date(value).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" });
