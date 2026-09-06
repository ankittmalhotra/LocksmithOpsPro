export interface CatalogItem {
  id: string;
  category: 'RESIDENTIAL' | 'COMMERCIAL' | 'AUTOMOTIVE' | 'KEYS';
  name: string;
  defaultCost: number;
  defaultPrice: number;
  description: string;
}

export const LOCKSMITH_CATALOG: CatalogItem[] = [
  {
    id: 'db-std',
    category: 'RESIDENTIAL',
    name: 'Standard Grade 2 Deadbolt (SC1/KW1)',
    defaultCost: 22.0,
    defaultPrice: 65.0,
    description: 'Residential brass/nickel deadbolt with 2 keys',
  },
  {
    id: 'cyl-mortise-hs',
    category: 'COMMERCIAL',
    name: 'High-Security Mortise Cylinder (1-1/8")',
    defaultCost: 45.0,
    defaultPrice: 120.0,
    description: 'Commercial drill-resistant mortise cylinder',
  },
  {
    id: 'cam-adams-rite',
    category: 'COMMERCIAL',
    name: 'Adams Rite Storefront Mortise Lock (1-1/8")',
    defaultCost: 28.0,
    defaultPrice: 75.0,
    description: 'Aluminum storefront door mortise mechanism',
  },
  {
    id: 'lever-comm-g1',
    category: 'COMMERCIAL',
    name: 'Commercial Grade 1 Heavy Duty Leverset',
    defaultCost: 65.0,
    defaultPrice: 165.0,
    description: 'ADA compliant exterior commercial locking lever',
  },
  {
    id: 'cyl-rim-std',
    category: 'RESIDENTIAL',
    name: 'Standard Rim Cylinder (Brass)',
    defaultCost: 12.0,
    defaultPrice: 35.0,
    description: 'Universal replacement rim cylinder with tailpiece',
  },
  {
    id: 'rekey-per-cyl',
    category: 'KEYS',
    name: 'Cylinder Re-pin / Re-keying Service (Per Keyhole)',
    defaultCost: 3.5,
    defaultPrice: 25.0,
    description: 'Recombination of bottom pins and new keys provided',
  },
  {
    id: 'key-blank-std',
    category: 'KEYS',
    name: 'Key Duplication (SC1 / KW1 Brass)',
    defaultCost: 0.75,
    defaultPrice: 8.0,
    description: 'Precision cut brass cylinder key blank',
  },
  {
    id: 'auto-transponder-fob',
    category: 'AUTOMOTIVE',
    name: 'Transponder Chip Key & On-Site Programming',
    defaultCost: 35.0,
    defaultPrice: 145.0,
    description: '46/48/4D transponder chip decoded and synced to immobilizer',
  },
  {
    id: 'auto-smart-fob',
    category: 'AUTOMOTIVE',
    name: 'Proximity Smart Fob (Push-To-Start)',
    defaultCost: 65.0,
    defaultPrice: 225.0,
    description: 'OEM-equivalent PEPS remote programmed to BCM',
  },
];
