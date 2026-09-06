import fs from 'fs';
import path from 'path';

const COMMISSIONS_FILE = path.join(process.cwd(), 'data', 'commissions.json');
const DEFAULT_COMMISSION = 150.0;

// In-memory fallback if filesystem write fails in serverless
let inMemoryCommissions: Record<string, number> = {
  // Default sample technicians
  '6475550301': 150.0, // Dave Miller
  '6475550302': 150.0, // Sam Chen
};

function readCommissionsFromFile(): Record<string, number> {
  try {
    if (fs.existsSync(COMMISSIONS_FILE)) {
      const data = fs.readFileSync(COMMISSIONS_FILE, 'utf-8');
      const parsed = JSON.parse(data);
      inMemoryCommissions = { ...inMemoryCommissions, ...parsed };
      return inMemoryCommissions;
    }
  } catch (err) {
    console.warn('[Commissions] Failed reading commissions file, using in-memory store:', err);
  }
  return inMemoryCommissions;
}

function writeCommissionsToFile(commissions: Record<string, number>) {
  inMemoryCommissions = commissions;
  try {
    const dir = path.dirname(COMMISSIONS_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(COMMISSIONS_FILE, JSON.stringify(commissions, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[Commissions] Failed saving commissions to disk, persisted in memory:', err);
  }
}

export function getTechnicianCommissions(): Record<string, number> {
  return readCommissionsFromFile();
}

export function getTechnicianCommission(identifier: string): number {
  const all = readCommissionsFromFile();
  if (all[identifier] !== undefined) {
    return all[identifier];
  }
  return DEFAULT_COMMISSION;
}

export function setTechnicianCommission(identifier: string, amount: number): number {
  const all = readCommissionsFromFile();
  all[identifier] = amount;
  writeCommissionsToFile(all);
  return amount;
}
