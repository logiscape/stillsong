// Curated drawing palette: true primaries a drawing needs, tuned slightly
// warm/desaturated so the swatch row sits comfortably on the Twilight Gallery
// ground. These hexes are artwork data, not UI styling — exempted from the
// design-kit hex lint.

export interface PaletteColor {
  name: string;
  hex: string;
}

export const PALETTE: readonly PaletteColor[] = [
  { name: 'Ink', hex: '#26201b' },
  { name: 'Charcoal', hex: '#55504a' },
  { name: 'Stone', hex: '#8b847c' },
  { name: 'Fog', hex: '#c4bcb2' },
  { name: 'White', hex: '#ffffff' },
  { name: 'Wine', hex: '#7e2a28' },
  { name: 'Red', hex: '#c9473d' },
  { name: 'Ember', hex: '#d97b31' },
  { name: 'Amber', hex: '#d9a53a' },
  { name: 'Sun', hex: '#e8cf6a' },
  { name: 'Olive', hex: '#7a7d3e' },
  { name: 'Forest', hex: '#3f6b3d' },
  { name: 'Sage', hex: '#6f9c72' },
  { name: 'Teal', hex: '#3f7d76' },
  { name: 'Sky', hex: '#6ea3c4' },
  { name: 'Blue', hex: '#3d5a99' },
  { name: 'Indigo', hex: '#4a4480' },
  { name: 'Violet', hex: '#7c5296' },
  { name: 'Rose', hex: '#b1538c' },
  { name: 'Brown', hex: '#7a5138' },
  { name: 'Tan', hex: '#c9a97e' },
];
