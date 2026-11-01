// Ink colours and sizes. Kept free of imports: the Stream Deck plugin bundles this file too.
export const COLORS = [
  { argb: 0xffe53935, name: "Red" },
  { argb: 0xfffb8c00, name: "Orange" },
  { argb: 0xfffdd835, name: "Yellow" },
  { argb: 0xff43a047, name: "Green" },
  { argb: 0xff1e88e5, name: "Blue" },
  { argb: 0xff8e24aa, name: "Purple" },
  { argb: 0xff212121, name: "Black" },
  { argb: 0xffffffff, name: "White" },
] as const;

export const SIZE_NAMES = ["Thin", "Medium", "Thick"] as const;
